# Phase 5 Progress: Triage, Matching, and Appointments

Use this file to resume work without rereading the entire session. Update the checkboxes as each feature is implemented and verified.

## Decisions and constraints

- [x] Work on branch `feature/health-bridge-phase-5`.
- [x] Consultations are free for now; no payment processing is part of this phase.
- [x] Suggested-slot holds expire after 1 minute.
- [x] Never read or modify `.env`.
- [x] Use Drizzle and pnpm; do not add unrequested dependencies.
- [x] Preserve HALT behavior: critical or uncertain risk must never produce an appointment suggestion.
- [x] Patient confirmation is required before an appointment becomes confirmed.
- [x] Created the phase branch and this resumable checkpoint before feature edits.

## Phase 5 checklist

- [x] Add triage persistence and validated AI output, using a single bounded request only when the patient asks to prepare a care summary.
- [x] Route triage to a matching department and rank only verified doctors using specialty, language, consult mode, and earliest available time.
- [x] Generate slots from doctor availability and time zone; exclude planned leave and active appointments/holds.
- [x] Add one-minute slot holds and transaction-safe booking with database enforcement against overlapping appointments.
- [x] Add patient proposal review, alternate choices, explicit confirmation, decline, cancellation, and appointment history.
- [x] Add verified-doctor appointment queue and editable SOAP-note review.
- [x] Add Drizzle migration and update generated migration metadata.
- [x] Verify with `pnpm run build`, lint/type checks available from package scripts, and local dev-server route checks without consuming AI calls.

## Current repository findings

- Existing chat saves messages and risk events, and halts when the risk check is critical, uncertain, unavailable, or rate limited.
- Verified doctor search and profile pages exist; doctor profiles have specialty, languages, consultation modes, weekly availability, time zone, slot length, buffer, and planned leave.
- Patient appointment and doctor queue pages are now implemented; triage and appointment persistence are in the new Drizzle migration.
- `HEALTH-BRIDGE.md` leaves payments and hold duration as decisions; the user selected free consultations and a one-minute hold.

## Resume notes

- Keep the care summary request explicit and bounded; do not call OpenAI for every booking view or slot refresh.
- Do not log health message content, SOAP text, or clinician registration identifiers.
- After each completed subsystem, update this checklist with implementation and verification status.

## Completed so far

- Repository audit found an existing guarded patient conversation API and verified-doctor directory, but no appointment or triage persistence.
- Read the installed Next.js 16 Server Functions and data-fetching guides before changing route/action patterns.
- Confirmed user choices: free consultations for now; 1-minute hold.
- Consulted developer reports on booking concurrency; implementation will serialize reservations in PostgreSQL transactions and retain a database uniqueness constraint as a backstop.
- Added Drizzle tables for triage summaries, appointments, and doctor SOAP notes; generated migrations `0007` and `0008`.
- Added one explicit bounded OpenAI triage call behind the patient action, with Zod validation and emergency-level HALT/no-suggestion behavior.
- Added verified-doctor matching and time-zone-aware 14-day slot generation that omits leave and occupied/held intervals.
- Added one-minute slot holds, explicit patient confirmation, patient cancellation, and doctor-authenticated SOAP/outcome actions.
- Replaced patient appointment placeholder with upcoming/history views and added the next confirmed appointment to the patient dashboard; replaced the doctor dashboard placeholder with a severity-ranked assigned-patient queue and editable SOAP forms.
- Added patient cancellation and rescheduling; the prior confirmed appointment stays booked unless the patient confirms the replacement, at which point it is cancelled in the same transaction.
- Applied Drizzle migrations `0007` and `0008` to local Docker Postgres using the known local connection outside `.env`; `drizzle-kit check` passes.
- `pnpm lint` passes; `pnpm run build` passes with Next.js 16.3.5 and TypeScript.
- `pnpm dev` is running; unauthenticated triage and hold requests return 401. No AI calls were made during verification.
- Authenticated patient-to-doctor booking and SOAP flows still need a manual browser walkthrough with real local accounts; no automated tests were added.
