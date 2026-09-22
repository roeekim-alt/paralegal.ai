/* ═══════════════════════════════════════════════════════════════════
   PRA Legal — public configuration
   ═══════════════════════════════════════════════════════════════════
   Both values below are PUBLIC by design and safe to commit to GitHub.
   Find them in Supabase → Project Settings → API.

   Leave them empty and the site runs in local mode: no sign-in, and
   every user brings their own Anthropic key.

   NEVER put these here — they belong in Supabase secrets only:
     the service_role key · your Anthropic key · any Stripe key
   ═══════════════════════════════════════════════════════════════════ */

window.PRA_CONFIG = {
  // Project URL, e.g. "https://abcdefghijklmnop.supabase.co"
  supabaseUrl: "",

  // The "anon" / "public" key — a long string starting "eyJ"
  supabaseAnonKey: "",

  // Enable only after Google OAuth is configured in this Supabase project.
  googleSignInEnabled: false,

  // Used only by the back office to show model cost in shekels
  usdToIls: 3.7
};
