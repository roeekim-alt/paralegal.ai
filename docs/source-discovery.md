# PRA Legal — Approved Source Discovery (pilot)

## Overview

The existing PRA Legal web workspace now includes a **מקורות מידע** (Sources) page. This feature is local-first and permission-scoped. It helps a lawyer find relevant documents and explicitly select up to three files for the existing four-stage AI workflow. **No document or email content is sent to a model by indexing/searching/choosing.** The AI workflow still requires the user to press Start and check the disclosure consent checkbox.

### Local computer / network folder (browser)

- In browsers implementing `window.showDirectoryPicker`, click **אשר תיקייה וחפש**. The browser shows a native directory picker. The application requests **read-only** permission to the chosen directory and its permitted descendants.
- It does not read the rest of the computer. The index is held only in page memory. The current browser does not run a persistent background service.
- Scanning is bounded to 700 supported files, 2,400 entries and 5 levels of subdirectories. Hidden and several sensitive/system directories are skipped. Known secrets-like names are not listed. Empty and files over 8 MB are skipped.
- Default keyword matching checks filename and permitted relative path. Users can optionally enable local content matching for small TXT, EML and DOCX files. The content matching occurs in this browser, with a limit of 180 files per explicit query, and is never uploaded by the search process. PDF/images are matched by filename/relative path only; there is no OCR/semantic indexing in this pilot.
- Unsupported browsers get the `webkitdirectory` fallback. Browser availability varies. No automatic full-disk access is possible from this static website.

### Gmail (conditional; not configured in repository)

- The public `config.js` has a new, deliberately empty `gmailOAuthClientId` field.
- After configuring a Google OAuth **Web application client ID**, an authorized JavaScript origin, enabled Gmail API, OAuth consent screen and the necessary verification for the **restricted** `gmail.readonly` scope, the Gmail button can acquire a **temporary, read-only OAuth access token**, kept only in page memory.
- User-initiated Gmail search applies Gmail's own query syntax (max 12 messages). Search fetches only those matching messages and their MIME structure, lists attachment names/metadata, and allows the lawyer to choose individual compatible attachments or a message body.
- Selected emails and attachments are converted to in-memory `File` objects only on selection. Selected contents aren't sent to Anthropic until an explicit AI workflow starts after separate user consent.
- This proof-of-concept deliberately contains **no client secret, refresh token, server credential database, automated inbox watch, bulk mailbox export, write, delete or send capability**.
- Gmail read-only uses a Google **restricted scope**, requiring OAuth verification and possibly a security assessment, especially if the app stores or transmits Gmail data to its server. This implementation is not an assertion of approved OAuth status, and does not constitute a deployed Gmail connection while the client ID is empty. Do not enable for real client mailboxes before legal/privacy/security review.

### Phone

Use **טלפון וקבצים נוספים** and the native system picker to choose files or photos from mobile storage or an available file provider. Supported file types include PDF, DOCX, TXT, Markdown, EML, JPEG, PNG and WebP. The existing AI workflow can now accept supported image parts on explicit approval.

A web app **cannot** directly monitor all smartphone files, WhatsApp messages, SMS or photo libraries in the background. True continuous mobile access requires a separately installed companion app and platform-granted permissions; none has been shipped here.

### Matter-aware discovery

In the AI workflow editor use **חפש לפי פרטי התיק במקורות שאושרו**. The application extracts a small set of visible keywords from the current task name and notes, then searches already-approved local directory indexes; if Gmail has an active read-only token, it also runs a bounded Gmail search. It never silently broadens permissions, automatically selects all matches, or starts an AI call.

### Privacy and safety boundaries

- Selected file bytes are kept in page memory until reload, clear or disconnect. No metadata, file contents, email subject/body or access tokens are stored in `localStorage`, Supabase or GitHub by this connector.
- Search result titles and paths are displayed using `textContent` rather than HTML interpolation.
- The **נקה ובטל בחירה** action clears memory and revokes a temporary Gmail token where Google's API is available. Browsers may separately remember directory permissions; revoke those under browser **Site Settings**.
- File-size/quantity limits exist at both selection time and AI workflow start.
- Browser-local processing is not a guarantee that using third-party CDNs, API calls or AI services is appropriate for privileged client documents. Verify provider policies, consent and professional confidentiality rules before use.
- The feature is not a privileged OS agent and does not claim fully autonomous, cross-device discovery. Persistent scanning and multi-user workspaces require a separate secure desktop/mobile or server connector design.

## Quick acceptance tests

1. Load Sources with an empty config and verify Gmail clearly says it is not configured.
2. On Chrome/Edge HTTPS, choose a disposable test directory (with 1 PDF, 1 DOCX, 1 TXT and a hidden folder). Confirm scoped results and filename search.
3. Enable content search on a small test TXT and verify matching without an AI request.
4. Select 1–3 results. Open AI Workflows and verify the selected filenames appear; leave consent unchecked and confirm the AI call is blocked.
5. Clear the selected sources; the AI workflow should no longer include them.
6. Test iOS/mobile native file picker separately; do not advertise filesystem-wide access.

## Future engineering

For fully autonomous discovery, deploy a **locally installed desktop companion** (explicit scoped folder grants, OS keychain, local encrypted index, idle scans with user controls, signed updates) and separately an **opt-in mobile share extension**. Add production-ready Gmail/Outlook OAuth connectors with explicit tenant isolation, audit logging, provider compliance and user-controlled revocation. A semantic index, OCR, attachment source attribution and resumable server-side agent jobs must be assessed before adding them.
