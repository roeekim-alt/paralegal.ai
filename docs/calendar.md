# Local legal diary

Open **לוח שנה** in the workspace rail. The calendar supports month and full agenda views, source/search/status filters, and all-day deadlines, hearings, payments, renewals and tasks. Click a date or **הוספת מועד** to add an entry. The document editor links directly to that document's diary; expanded matters link to their diary.

Existing matter dates and tasks are displayed live, including undated tasks in the agenda. Editing/completing/deleting these entries updates the original matter record. New entries are stored separately and can link to a matter or saved document. Dates are not extracted from document text by this module. Existing extracted matter dates start unverified; users must check dates and applicable deadline calculation rules themselves.

Storage: `pra.diary.v1.<account-id or local>` in localStorage. Existing matter entries keep using the application's `pra.matters` store. This is local browser storage, not authenticated cloud storage, a backup service or cross-device sync. Google sign-in remains unconfigured. The module makes no network or AI calls. Erase-everything includes the current diary. Storage failures leave the edit form open and do not report success.

Upcoming indicators appear only while using the app. There are no background, email or push notifications. ICS export downloads the currently filtered entries with valid dates as all-day events (exclusive next-day DTEND); importing into an external calendar is a user action, not ongoing synchronization. JSON export contains all diary entries, including source-derived entries, for an offline backup; automated JSON restoration is not implemented.

Validation performed in Chromium: create/edit/delete, reload persistence, completion filters, editing matter tasks, linking documents, invalid/leap dates, ICS year boundary, storage quota failure, mobile overflow and JavaScript runtime errors. No real client documents or paid AI requests were used.
