# PRA Legal

An AI paralegal for Israeli legal practice. Frank drafts agreements, reads contracts, keeps matters and client files, and writes business plans in the Investment Authority format — in Hebrew or English.

This repository holds the whole product: the workspace lawyers use, the back office you use to run the business, and the server code that connects them to accounts, billing and the model.

---

## What's in the repository

```
index.html                          The workspace — what your users see
admin.html                          The back office — only you see this
config.js                           Your Supabase address and public key
.env.example                        Template for the server secrets
supabase/
  migrations/0001_init.sql          The database: tables, security, functions
  functions/
    claude/index.ts                 Model proxy — calls Anthropic with your key
    billing/index.ts                Sends users to Stripe checkout and billing
    stripe-webhook/index.ts         Hears from Stripe when a subscription changes
```

## How it fits together

```
   Browser                       Supabase                          Outside
 ─────────────                 ─────────────────────             ───────────
                               ┌──────────────────┐
 index.html  ── sign in ─────▶ │  Auth            │
    │                          └──────────────────┘
    │                          ┌──────────────────┐
    ├── paid plan ───────────▶ │  claude function │ ── your key ──▶ Anthropic
    │                          │  checks plan,    │
    │                          │  logs usage      │
    │                          └────────┬─────────┘
    │                                   ▼
    │                          ┌──────────────────┐
    ├── own-key plan ──────────┼──────────────────┼──── their key ─▶ Anthropic
    │                          │  Database        │
    │                          │  accounts, plans │
    ├── upgrade ─────────────▶ │  usage, events   │ ◀── webhook ──── Stripe
    │                          └──────────────────┘                    ▲
    │                          ┌──────────────────┐                    │
    └──────────────────────▶   │ billing function │ ── checkout ───────┘
                               └──────────────────┘
 admin.html  ── admin only ──▶  Database (admin functions)
```

**What your server stores:** accounts, plans, subscription status, token counts per request, and a one-line log of actions such as "drafted a lease agreement".

**What it never stores:** client names, documents, matters, drafts or conversations. Those live in each lawyer's own browser. When a firm asks where its client data goes, the answer is: nowhere but their machine and the model call.

## The two ways the workspace runs

| | Local mode | Connected mode |
|---|---|---|
| When | `config.js` is empty | `config.js` has your Supabase values |
| Sign-in | None | Email and password |
| Drafting | User's own Anthropic key | Own key, or your key through a paid plan |
| Billing | None | Stripe subscriptions |
| Back office | Not available | `admin.html` |

Local mode is what you get the moment you upload the files. It works, but anyone with the link can use it and there's no way to charge. Connected mode is the setup below.

---

## Setting it up

You need accounts at [Supabase](https://supabase.com) and [Stripe](https://stripe.com), both free to start, plus [Node.js](https://nodejs.org) installed on your computer for the command-line steps. Budget about an hour. Do everything in Stripe's **test mode** first.

### 1. Create the Supabase project

1. At [supabase.com/dashboard](https://supabase.com/dashboard), choose **New project**.
2. Pick a region close to Israel — **Frankfurt (eu-central-1)** is the nearest.
3. Save the database password somewhere safe — `supabase link` asks for it in step 5, and Supabase won't show it again.
4. When the project is ready, open **Project Settings → API** and keep that tab open. You'll need three things from it:
   - **Project URL** — `https://xxxxxxxx.supabase.co`
   - **anon public** key — goes in `config.js`, safe to publish
   - **Reference ID** — the `xxxxxxxx` part of the URL

### 2. Build the database

1. In Supabase, open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql`.
3. Choose **Run**. You should see *Success. No rows returned.*

This creates the tables, locks them down with row-level security, and adds the functions the workspace and back office call. Run it once only; running it again fails because the tables already exist.

### 3. Configure sign-in

In Supabase, open **Authentication**:

1. **URL Configuration** → **Site URL**: `https://roeekim-alt.github.io/leagalease.ai/`
2. Same page, **Redirect URLs** → add `https://roeekim-alt.github.io/leagalease.ai/**`
3. **Sign In / Providers → Email** → set **Minimum password length** to `8`, and leave **Confirm email** on.

> **Before launch:** Supabase's built-in email sender only allows a handful of messages an hour and is meant for testing. Before real users sign up, set up your own sender under **Authentication → Emails → SMTP Settings**. [Resend](https://resend.com) and Postmark both work and have free tiers.

### 4. Create the plans in Stripe

At [dashboard.stripe.com](https://dashboard.stripe.com), with **Test mode** switched on:

1. **Product catalog → Add product**
   - Name: `PRA Legal — Practitioner`
   - Price: `199`, currency **ILS**, **Recurring**, **Monthly**
   - Save, open the price, and copy its ID — it starts with `price_`
2. Repeat for `PRA Legal — Firm` at `599` ILS monthly. Copy that price ID too.
3. **Settings → Billing → Customer portal** → choose **Activate** and save. Without this, the *Manage billing* button returns an error.
4. **Developers → API keys** → copy the **Secret key** (`sk_test_…`).

### 5. Deploy the server functions

In a terminal, inside the repository folder:

```bash
npx supabase login
npx supabase init                                  # answer N to the editor questions
npx supabase link --project-ref YOUR_REFERENCE_ID
```

Copy the secrets template and fill it in with the values from steps 1–4:

```bash
cp .env.example supabase/.env
```

Leave `STRIPE_WEBHOOK_SECRET` as it is for now — you'll get it in step 6. Then:

```bash
npx supabase secrets set --env-file supabase/.env

npx supabase functions deploy claude
npx supabase functions deploy billing
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is deliberate. Stripe can't send a Supabase login, so that function checks Stripe's own signature on every request instead.

`supabase/.env` is listed in `.gitignore`, so it won't be uploaded. Double-check it isn't in your commit anyway — it holds your Anthropic and Stripe keys.

<details>
<summary>No terminal? Deploy from the dashboard instead</summary>

In Supabase, open **Edge Functions → Deploy a new function → Via editor**. Create three functions named exactly `claude`, `billing` and `stripe-webhook`, pasting in each `index.ts`. For `stripe-webhook`, turn **Enforce JWT verification** off in its settings. Then add each secret from `.env.example` under **Edge Functions → Secrets**.
</details>

### 6. Connect the Stripe webhook

1. In Stripe: **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://YOUR_REFERENCE_ID.supabase.co/functions/v1/stripe-webhook`
3. Select these four events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save, then reveal the **Signing secret** (`whsec_…`).
5. Put it in `supabase/.env` and push it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

### 7. Point the site at your project

Open `config.js` and fill in the two values from step 1:

```js
window.PRA_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
  usdToIls: 3.7
};
```

Both are public by design. Security comes from the database rules, not from hiding these.

### 8. Publish on GitHub Pages

1. In your repository on GitHub: **Add file → Upload files**. Drag in everything from this folder, including the `supabase` folder, and choose **Commit changes**.
2. Check that `.gitignore` and `.env.example` arrived. Files starting with a dot are sometimes skipped by drag-and-drop; if they're missing, create them with **Add file → Create new file** and paste the contents.
3. **Settings → Pages** → **Source**: *Deploy from a branch*, **Branch**: `main`, folder `/ (root)` → **Save**.

After a minute or two:

- Workspace: `https://roeekim-alt.github.io/leagalease.ai/`
- Back office: `https://roeekim-alt.github.io/leagalease.ai/admin.html`

### 9. Make yourself an administrator

1. Open the workspace and create an account with your own email. Confirm it from the email you receive.
2. In Supabase **SQL Editor**, run:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

3. Open `admin.html` and sign in with that account.

From then on you can give other people back office access from inside the back office. Nobody can make themselves an administrator — the database refuses.

### 10. Test the whole loop

Still in Stripe test mode:

- [ ] Create a second account in a private window
- [ ] Choose **Practitioner** and pay with test card `4242 4242 4242 4242`, any future date, any CVC
- [ ] Back in the workspace, the account panel shows *Practitioner* with a usage meter
- [ ] Draft an agreement — the meter moves
- [ ] In the back office, the user appears as *Paying*, with tokens and cost this month
- [ ] Suspend them from the back office — their next draft is refused
- [ ] Restore them, then cancel the subscription from **Manage billing** — they drop back to *Own key*

When every box is ticked, switch Stripe to live mode, create the two products again with live prices, add a live webhook, and update the four Stripe secrets.

---

## Plans and allowances

| Plan | Price | Model tokens a month | Model cost at full use* | Margin at full use |
|---|---|---|---|---|
| Own key | Free | Their own key | Paid by them | — |
| Practitioner | ₪199 | 3,000,000 | about ₪133 | about ₪66 |
| Firm | ₪599 | 8,000,000 | about ₪355 | about ₪244 |

\* Assumes Claude Sonnet 4 at $3 in / $15 out per million tokens, a quarter of tokens as input, and ₪3.7 to the dollar. One drafted agreement uses roughly 4,700 tokens, about ₪0.23. Stripe's transaction fee comes off the margin too.

Most users won't approach their allowance. The limits exist so one heavy account can't cost you more than it pays.

**To change a plan's price or allowance**, update the database and Stripe together:

```sql
update public.plans set monthly_tokens = 4000000 where id = 'practitioner';
update public.plans set price_ils = 249       where id = 'practitioner';
```

A price change also needs a new price in Stripe, with the new `price_…` ID set as `STRIPE_PRICE_PRACTITIONER`. Stripe prices can't be edited — you create a new one.

**To track Anthropic's prices**, edit the `PRICES` table at the top of `supabase/functions/claude/index.ts` and redeploy that function.

---

## Using the back office

**Overview** — monthly revenue, paying accounts, weekly actives, tokens and model cost this month, and gross margin. The chart shows tokens per day for the last 30 days; hover a bar for the day's cost.

**Users** — every account, with plan, billing state, and how much of their allowance they've used. Filter by paying, overdue, suspended and more. Search by name, email or firm. **Export CSV** downloads the list. Click anyone to open their record, where you can:

- **Change plan** — moving someone onto a paid plan here gives access without charging them, and they show as *On the house*. This never touches Stripe. If someone pays through Stripe, cancel or change it in Stripe as well.
- **Add extra monthly tokens** — on top of their plan, until you set it back to zero
- **Suspend or restore** — takes effect on their next request
- **Give or remove back office access** — you can't change your own

**Activity** — the last 150 actions across the workspace. Only the kind of action is recorded, never its content.

**Admin changes** — every change made from the back office: who made it, to whom, and when.

---

## Security

- **Row-level security** is on every table. A signed-in user can read only their own profile, usage and activity.
- **Users can edit only their name and firm.** Plan, billing status, allowance and admin flag are written by the server or by an administrator. This is enforced by the database, and tested.
- **Every back office function checks `is_admin` itself.** Finding `admin.html` gets a non-admin nothing.
- **Your Anthropic key lives only in Supabase secrets.** The browser never sees it.
- **The proxy caps each request** at 8,000 output tokens and accepts only the models listed in its price table.
- **`ALLOWED_ORIGIN`** limits which websites may call the functions. It takes a comma-separated list, so for local testing you can add `http://localhost:8080` next to your GitHub address.
- **Own-key users' keys stay in their browser** and go straight to Anthropic, never through your server.

What to keep out of GitHub: `supabase/.env`, the `service_role` key, your Anthropic key, and any Stripe secret key.

---

## Working on it locally

Open the folder through a local server rather than double-clicking the file — sign-in redirects don't work from `file://`:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. To use your real Supabase project from there, add `http://localhost:8080` to **Redirect URLs** in Supabase and to `ALLOWED_ORIGIN`.

With `config.js` left empty, everything runs in local mode with no server at all.

**Keyboard in the workspace:** `⌘K` / `Ctrl+K` opens the command palette, `⌘J` opens Frank, and `⌘1` to `⌘5` switch views.

---

## When something goes wrong

| What you see | What to check |
|---|---|
| Back office says *Not connected yet* | `config.js` is empty, or wasn't uploaded |
| *Not an administrator* | Step 9 — run the `update` with the exact email you signed up with |
| Confirmation email never arrives | Supabase's built-in sender is rate-limited; set up SMTP (step 3) |
| Sign-up link opens the wrong page | **Site URL** and **Redirect URLs** in step 3 |
| *Your plan does not include hosted drafting* | They're on Own key, or their subscription lapsed — check Users |
| Paid in Stripe, still shows Own key | Webhook: Stripe → Webhooks → your endpoint → recent deliveries. A failed signature means `STRIPE_WEBHOOK_SECRET` doesn't match |
| *Manage billing* errors | Customer portal not activated (step 4.3) |
| Browser console shows a CORS error | `ALLOWED_ORIGIN` must match the site's origin exactly — `https://roeekim-alt.github.io`, no path, no trailing slash |
| *The service's model key was rejected* | `ANTHROPIC_API_KEY` in Supabase secrets is wrong or out of credit |
| Business plans time out | They're the longest request. Check the `claude` function's logs in Supabase; retry once |
| Free Supabase project stops responding | Free projects pause after a week without activity. Restore it from the dashboard, or move to the Pro plan before launch |

Function logs are in Supabase under **Edge Functions → select a function → Logs**.

---

## Not built yet

These are the honest gaps between this build and a finished product:

- **Team accounts.** Each account is one person. Firms can't share matters or add colleagues.
- **Frank's voice.** The ElevenLabs fields exist in settings, but the rebuilt workspace doesn't speak yet.
- **Matters and clients don't sync between devices.** They stay in the browser where they were created. That's the privacy guarantee — and a limitation.
- **Terms of Service and Privacy Policy pages.** You need both before taking payment.
- **Invoices with Israeli VAT.** Stripe issues receipts, but not a חשבונית מס. Check with your accountant whether you need a separate invoicing service such as Green Invoice.

---

Output is a first draft for a qualified lawyer to review. It is not legal advice, and using the workspace does not create an attorney–client relationship.

© 2026 PRA Legal
