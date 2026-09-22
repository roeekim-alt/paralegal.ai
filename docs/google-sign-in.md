# Google sign-in activation

The sign-in UI and Supabase OAuth integration are implemented. They remain disabled until the backend is configured. No OAuth client secret belongs in this repository.

1. Choose or create the Supabase project dedicated to Paralegal. The existing site has no Supabase project configured. Do not reuse a project belonging to another product without the owner's decision.
2. In Google Auth Platform, create a Web application OAuth client for Paralegal. Configure the consent screen and audience. In testing mode, add the intended users as test users.
3. Authorized JavaScript origin: `https://roeekim-alt.github.io`.
4. Authorized redirect URI: `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback` (copy the exact URL from Supabase's Google provider settings).
5. In Supabase → Authentication → Sign In / Providers → Google, enable Google and enter the Client ID and Client Secret there, not in config.js or chat.
6. In Supabase → Authentication → URL Configuration, set the Site URL and allowed redirect URL to `https://roeekim-alt.github.io/paralegal.ai/`. Also allow `https://roeekim-alt.github.io/paralegal.ai/index.html` if that entrypoint will be used.
7. In config.js, set `supabaseUrl` and `supabaseAnonKey` to that project's public URL and publishable/anon key. Set `googleSignInEnabled: true`. Never use a secret/service-role key.
8. Publish and test: open the workspace → Continue with Google → choose an account → verify return to the workspace. Test cancel, reload and sign-out. The SDK handles PKCE and exchanges the authorization code.

Google sign-in identifies the user; it does not provide Anthropic API credit or cloud document storage. Existing account/billing database migrations must be installed in the chosen project if those features are enabled. Documents remain saved in this browser and are separated by account. Existing guest documents remain in the guest store and are not automatically assigned to a Google account.

References:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls
