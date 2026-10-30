# Architecture and Implementation Notes

## System boundary

- React + Vite browser client: meeting/task/knowledge workspace and human review UI.
- Express REST API: request validation, controllers and transaction boundaries.
- MySQL 8.4: relational persistence for meetings, assignments, decisions, knowledge links and audit events.
- Gemini API: optional external inference provider for extraction, knowledge recommendations and handover synthesis.
- Pino: structured JSON logs, request correlation and application-event records.

## Data lifecycle

1. A user creates a meeting/work transfer and stores its original note text.
2. The AI endpoint retrieves meeting metadata, participants and notes from MySQL.
3. The AI service returns a structured object. Zod validates it before it is stored in `ai_generations` with `review_status = pending`.
4. A human approves selected decisions and action items or rejects the generation.
5. Approval inserts decisions and tasks in one database transaction. Each new task receives an `action_history` row.
6. A task carry-forward updates `current_meeting_id`, increments its carry-forward count and inserts a history event in the same transaction. `source_meeting_id` remains unchanged.
7. Knowledge documents can be linked to meetings, decisions or tasks. Handover assembles context for a specific team member and generates a summary.

## Why preserve source and current meeting separately?

`source_meeting_id` answers where a task originated. `current_meeting_id` answers where the task is currently being tracked. This prevents a carry-forward operation from creating copies and allows the task's original context to remain discoverable.

## Human-in-the-loop AI

The AI generation table stores source text, provider/model, latency, output JSON, status and review status. Model output is not considered authoritative. Only reviewed entries become business records. Owner resolution is limited to the meeting's participant list; unresolved names are left unassigned.

## Failure handling

- Transient Gemini HTTP 429/5xx responses are retried with short exponential backoff.
- Model/API/timeout/parsing failures return an error response while original meeting notes remain unchanged.
- AI failures are persisted in `ai_generations` where possible and logged with request ID and latency.
- Demo mode is marked as a demo provider and exists to make the package runnable without a key; live AI requires `AI_PROVIDER=gemini`.

## Validation and transaction boundaries

Zod validates JSON bodies and enums. SQL uses parameterized statements. Multi-record creation and review are transactional so a failed task/history insert does not leave a partially approved generation. Carry-forward is transactional for the same reason.

## Production hardening still required

Add identity and role-based access control, tenant isolation, CSRF strategy if cookie auth is adopted, upload scanning and document-size policy, PII retention controls, external log aggregation/alerting, rate limits, and backup/restore tests before handling confidential production data.
