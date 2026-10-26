# PRA Legal — Premium Dashboard + Agentic Workflows (pilot)

## Included in this change

The workspace now has a dedicated Home dashboard with a deep-navy and gold theme, using the repository's own `assets/split-brain-justice.png`. The existing legal document canvas and court pagination deliberately remain white for readability and compliant output. The marketing landing page and the existing workspace tools are not removed.

`assets/premium.css` is loaded last, so its styles override the legacy workspace components. `assets/agent-workflows.js` adds **Dashboard** and **AI Workflows** navigation.

### Workflow pilot: two legal tasks

1. Civil defence preparation (טיוטת כתב הגנה), with an explicit warning that its procedural and formal requirements require independent checking.
2. Contract analysis / risk report.

Both follow four sequential operations using the existing `Api.send` adapter:

1. Intake and factual mapping (`workflow-intake`, fast model)
2. Issue/evidence gap mapping (`workflow-issues`, fast model)
3. Drafting (`workflow-draft`, primary model)
4. Independent model review plus deterministic warnings (`workflow-review`, fast model)

The requested model uses the current account configuration: either the existing hosted proxy (where configured and authorised), or the user's own Anthropic key. There are **no new secrets in GitHub**, no new permissions, no database migrations, and no external communication other than the existing authorised model calls.

Input: notes and up to three PDF, DOCX, TXT, or Markdown files, subject to size and text-extraction limits. TXT and DOCX are checked against explicit size caps rather than silently truncated. Output: a local first draft, red-flag report and the option to open the draft in the existing editor or export TXT.

**Human gate:** The system never sends, signs, serves or files the document. Marking a run as reviewed requires a separate checkbox; this is not an assertion that filing requirements are met.

### Privacy and technical limits

- Run records and generated outputs are stored under `pra.workflows.v1.<account-id or local>` in the browser's localStorage, up to eight runs. Uploaded original files are not copied to history. Generated summaries/drafts may still contain confidential information.
- The user's document content is sent to the model provider only when a run is explicitly started after the processing-consent checkbox.
- The existing "erase everything" command also clears local workflow records for the current account.
- Workflow execution is foreground, in the active browser tab. "Stop" prevents starting subsequent stages but cannot cancel an API request that is already in flight.
- No background worker, real-time case-law verification, integrated legal research connector, clock/calendar calculation, automated court filing, cloud synchronisation, team tenancy or production server-side agent execution is claimed.
- PDF is passed to the provider in the format supported by the existing `Api.part` method; it is not OCR'd or retained on the server by this feature.
- The project `config.js` currently has empty Supabase details. In that configuration, the feature uses the current local/own-key mode, not an independently deployed backend.

### Smoke tests performed

- JS parser validation of both updated scripts
- New stylesheet and script linked to `index.html`
- Module mocked in a non-DOM environment and run through four simulated model stages; completed result was marked `ready` with all four steps `done`
- Workflow local save/load and erase integration verified in source
- Existing DOCX editor and Israeli pleading module code retained

### Next engineering milestones (not included)

- Real server-side job orchestrator with idempotent step execution and reliable queues
- Tenant-isolated encrypted case file storage, RBAC, audit trails and secure secret management
- Verified external legal research tools with source pinning and actual evidence provenance
- Deterministic procedural-rule validator, deadline calculator and integrated reviewed-DOCX workflow
- Authorized and isolated accounting workspace for `PRA Accounting`

Do not pilot on real privileged client documents until the model processing, confidentiality, access control and data-security requirements have been reviewed for the selected deployment.
