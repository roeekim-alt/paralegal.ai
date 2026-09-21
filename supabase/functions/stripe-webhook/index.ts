// ═══════════════════════════════════════════════════════════════════
// stripe-webhook — Stripe tells us when a subscription changes
//
// Deploy with --no-verify-jwt: Stripe does not send a Supabase session.
// Every request is instead verified with the Stripe signing secret.
//
// Listens for:
//   checkout.session.completed
//   customer.subscription.created | updated | deleted
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//          STRIPE_PRICE_PRACTITIONER, STRIPE_PRICE_FIRM
// ═══════════════════════════════════════════════════════════════════

import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const PLAN_FOR_PRICE: Record<string, string> = {};
const pp = Deno.env.get("STRIPE_PRICE_PRACTITIONER");
const pf = Deno.env.get("STRIPE_PRICE_FIRM");
if (pp) PLAN_FOR_PRICE[pp] = "practitioner";
if (pf) PLAN_FOR_PRICE[pf] = "firm";

// Stripe has more states than we need. Collapse them to ours.
function statusFor(s: string): string {
  switch (s) {
    case "active":             return "active";
    case "trialing":           return "trialing";
    case "past_due":
    case "unpaid":
    case "paused":             return "past_due";
    case "canceled":
    case "incomplete_expired": return "canceled";
    default:                   return "none";
  }
}

async function applySubscription(sub: Stripe.Subscription, fallbackUserId?: string | null) {
  const status   = statusFor(sub.status);
  const priceId  = sub.items?.data?.[0]?.price?.id ?? "";
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const plan     = status === "canceled" || status === "none"
    ? "own_key"
    : (PLAN_FOR_PRICE[priceId] ?? "own_key");

  const patch = {
    plan,
    subscription_status: status,
    stripe_subscription_id: sub.id,
    stripe_customer_id: customer,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  const userId = sub.metadata?.user_id || fallbackUserId || null;
  const query = db.from("profiles").update(patch);
  const { error, count } = userId
    ? await query.eq("id", userId).select("id", { count: "exact", head: true })
    : await query.eq("stripe_customer_id", customer).select("id", { count: "exact", head: true });

  if (error) throw new Error("profile update failed: " + error.message);
  if (!count) console.warn("no profile matched subscription", sub.id, "customer", customer);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  const signature = req.headers.get("Stripe-Signature");
  if (!signature || !WEBHOOK_SECRET) return new Response("Missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    return new Response("Bad signature: " + (err as Error).message, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscription(sub, session.client_reference_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break; // other events are acknowledged and ignored
    }
  } catch (err) {
    console.error("webhook", event.type, err);
    return new Response("Handler error", { status: 500 }); // Stripe will retry
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  });
});
