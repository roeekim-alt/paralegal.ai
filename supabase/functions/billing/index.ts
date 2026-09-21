// ═══════════════════════════════════════════════════════════════════
// billing — sends the user to Stripe
//
//   { action: "checkout", plan: "practitioner" | "firm" }  → Stripe Checkout
//   { action: "portal" }                                   → Stripe customer portal
//
// Returns { url } for the workspace to redirect to.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRACTITIONER, STRIPE_PRICE_FIRM,
//          SITE_URL, ALLOWED_ORIGIN (optional, comma-separated)
// ═══════════════════════════════════════════════════════════════════

import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const STRIPE_KEY     = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL       = Deno.env.get("SITE_URL") ?? "";

const PRICE_FOR: Record<string, string | undefined> = {
  practitioner: Deno.env.get("STRIPE_PRICE_PRACTITIONER"),
  firm:         Deno.env.get("STRIPE_PRICE_FIRM"),
};

const stripe = new Stripe(STRIPE_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

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

function reply(cors: Record<string, string>, status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return reply(cors, 405, { error: "Use POST." });
  if (!STRIPE_KEY || !SITE_URL) return reply(cors, 500, { error: "Billing is not configured on the server yet." });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return reply(cors, 401, { error: "Sign in again, then try once more." });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, email, full_name, stripe_customer_id")
    .eq("id", who.user.id)
    .single();
  if (error || !profile) return reply(cors, 404, { error: "Your account profile is missing." });

  try {
    if (action === "checkout") {
      const plan = String(body?.plan ?? "");
      const price = PRICE_FOR[plan];
      if (!price) return reply(cors, 400, { error: "That plan is not available." });

      let customer = profile.stripe_customer_id as string | null;
      if (!customer) {
        const created = await stripe.customers.create({
          email: profile.email,
          name: profile.full_name ?? undefined,
          metadata: { user_id: profile.id },
        });
        customer = created.id;
        await db.from("profiles").update({ stripe_customer_id: customer }).eq("id", profile.id);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        line_items: [{ price, quantity: 1 }],
        client_reference_id: profile.id,
        subscription_data: { metadata: { user_id: profile.id, plan } },
        allow_promotion_codes: true,
        success_url: SITE_URL + "?billing=success",
        cancel_url:  SITE_URL + "?billing=cancel",
      });
      return reply(cors, 200, { url: session.url });
    }

    if (action === "portal") {
      if (!profile.stripe_customer_id) return reply(cors, 400, { error: "There is no billing account on this profile yet." });
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: SITE_URL,
      });
      return reply(cors, 200, { url: portal.url });
    }

    return reply(cors, 400, { error: "Unknown billing action." });
  } catch (err) {
    console.error("billing", err);
    return reply(cors, 500, { error: "Stripe did not accept the request: " + (err as Error).message });
  }
});
