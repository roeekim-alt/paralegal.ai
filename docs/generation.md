# Document generation recovery and progress

Draft agreements and business plans now request streaming responses on the direct Anthropic API path. The existing hosted JSON path remains compatible. The stream parser handles UTF-8 boundaries, CRLF, text deltas, usage, stop reasons and errors; a stream without message_stop is not treated as a completed document. Reading has a 90-second idle limit and a six-minute stream limit. Header connection timeout remains two minutes.

For max_tokens, generation continues from the prior response, up to three requests of 8,000 output tokens each. This uses additional API tokens for long documents. A result is shown as complete only on end_turn or stop_sequence. Failed/overlong responses offer a clearly labeled incomplete TXT download in the current browser session; forms remain intact. No automatic retry is made after ambiguous network or billing failures.

Progress percentages are explicitly estimates, based on received text with a small initial waiting stage. They remain below 100 until a complete response is rendered. The dialog reports elapsed time and actual received character count. Missing browser keys are explained at the form, and billing/authentication errors remain visible rather than disappearing only in a toast.

Verified with Chromium and mocked API responses: agreement rendering, max_tokens continuation, modal progress, billing errors, incomplete stream preservation, byte-split Hebrew/emoji, mobile layout, busy-state recovery and business-plan generation. No user's browser key, real client document, account balance or paid API response was accessed. These fixes address observed code failure paths; the specific user's account-side cause is not independently established.
