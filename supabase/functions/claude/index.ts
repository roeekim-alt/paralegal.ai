// ═══════════════════════════════════════════════════════════════════
// claude — the model proxy
//
// The workspace sends model requests here instead of straight to
// Anthropic whenever the user is on a paid plan. This function:
//   1. confirms who is asking (Supabase session)
//   2. checks the plan is active, not suspended, and under its allowance
//   3. forwards the request to Anthropic with YOUR key
//   4. records the tokens and cost against the user
//
// Your Anthropic key never reaches the browser.
//
// Secrets: ANTHROPIC_API_KEY, ALLOWED_ORIGIN (optional, comma-separated)
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// USD per million tokens. Update if Anthropic's prices change.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5":         { input: 1, output: 5 },
};
const DEFAULT_MODEL  = "claude-sonnet-4-20250514";
const MAX_OUTPUT     = 8000;
const LIVE_STATUSES  = ["active", "trialing", "comped"];

const ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Answer with the caller's origin when it is on the list.
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ORIGINS.includes("*") ? "*" : (ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? "");
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Errors use Anthropic's own shape so the workspace handles both the same way.
function fail(cors: Record<string, string>, status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return fail(cors, 405, "invalid_request_error", "Use POST.");
  if (!ANTHROPIC_KEY)           return fail(cors, 500, "api_error", "The server has no Anthropic key configured.");

  // ── 1. Who is asking ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(cors, 401, "authentication_error", "Sign in again to keep drafting.");

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(jwt);
  if (whoErr || !who?.user) return fail(cors, 401, "authentication_error", "Your session has ended. Sign in again.");
  const userId = who.user.id;

  // ── 2. Are they allowed ──
  const { data: state, error: stateErr } = await db.rpc("usage_state", { uid: userId });
  if (stateErr || !state) return fail(cors, 500, "api_error", "Could not read your account. Try again in a moment.");

  if (state.suspended) {
    return fail(cors, 403, "permission_error", "This account is suspended. Contact PRA Legal support.");
  }
  if (!state.hosted || !LIVE_STATUSES.includes(state.status)) {
    return fail(cors, 402, "plan_error", "Your plan does not include hosted drafting. Choose a plan, or add your own Anthropic key.");
  }
  if (Number(state.used) >= Number(state.allowance)) {
    return fail(cors, 429, "quota_error", "You have used this month's drafting allowance. It resets on the 1st, or upgrade for more.");
  }

  // ── 3. Validate and forward ──
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return fail(cors, 400, "invalid_request_error", "The request body was not valid JSON."); }

  const model = typeof body.model === "string" && PRICES[body.model] ? body.model : DEFAULT_MODEL;
  const requested = Number(body.max_tokens) || 2000;
  const feature = typeof body.feature === "string" ? body.feature.slice(0, 40) : null;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return fail(cors, 400, "invalid_request_error", "No messages were sent.");
  }

  const upstream: Record<string, unknown> = {
    model,
    max_tokens: Math.max(1, Math.min(requested, MAX_OUTPUT)),
    messages: body.messages,
  };
  if (typeof body.system === "string" && body.system) upstream.system = body.system;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstream),
    });
  } catch (_) {
    return fail(cors, 502, "api_error", "Could not reach Anthropic. Try again.");
  }

  const data = await res.json().catch(() => null);
  if (!data) return fail(cors, 502, "api_error", "Anthropic returned something unreadable.");

  // Anthropic rejected our server key: the user can't fix this, so say so.
  if (data?.error?.type === "authentication_error") {
    return fail(cors, 500, "api_error", "The service's model key was rejected. PRA Legal has been notified.");
  }

  // ── 4. Record usage ──
  if (data.usage) {
    const inTok  = Number(data.usage.input_tokens)  || 0;
    const outTok = Number(data.usage.output_tokens) || 0;
    const price  = PRICES[model];
    const cost   = (inTok * price.input + outTok * price.output) / 1_000_000;

    const { error: logErr } = await db.from("usage").insert({
      user_id: userId,
      feature,
      model,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: Number(cost.toFixed(6)),
    });
    if (logErr) console.error("usage insert failed", logErr.message);
  }

  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...cors, "content-type": "application/json" },
  });
});
