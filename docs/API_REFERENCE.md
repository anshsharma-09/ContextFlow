# ContextFlow API Reference

Base URL: `http://localhost:5000/api` (all request/response bodies are JSON).

## Dashboard

`GET /dashboard`

Returns summary counts, recent meetings and priority tasks.

## Users

`GET /users` returns active team members.

`POST /users`

```json
{"full_name":"Karan Patil","email":"karan@example.test","role":"Analyst","team":"Operations"}
```

## Meetings

`GET /meetings` lists meetings.

`GET /meetings/:id` returns the meeting, participants, source notes, decisions and current action items.

`POST /meetings`

```json
{
  "title":"Release readiness review",
  "meeting_type":"meeting",
  "agenda":"Review test status and release blockers",
  "scheduled_at":"2026-11-02T10:00:00+05:30",
  "status":"scheduled",
  "facilitator_id":1,
  "created_by":1,
  "participants":[{"user_id":1,"participant_role":"Facilitator"},{"user_id":2}],
  "initial_note":"The team reviewed the release checklist..."
}
```

`POST /meetings/:id/notes`

```json
{"content":"Raw discussion notes...","created_by":1,"note_type":"discussion"}
```

## Action items

`GET /action-items` supports query parameters `status`, `owner_id`, and `meeting_id`.

`GET /action-items/:id` returns the task and audit history.

`POST /action-items`

```json
{"source_meeting_id":1,"title":"Review API contract","description":"Check response and error formats","owner_id":2,"created_by":1,"due_date":"2026-11-04","priority":"high"}
```

`PATCH /action-items/:id`

```json
{"status":"in_progress","actor_id":1}
```

Other accepted fields: `title`, `description`, `owner_id`, `due_date`, `priority`, `outcome`. Closing a task with status `completed` sets `completed_at`; status/owner/outcome changes are appended to `action_history`.

`POST /action-items/:id/carry-forward`

```json
{"to_meeting_id":3,"actor_id":1,"note":"Still open; discussed in work transfer."}
```

The task keeps its ID and source meeting. `current_meeting_id` is changed and a `carried_forward` event is stored in the same transaction.

## AI extraction and review

`POST /ai/meetings/:id/extract`

```json
{"requested_by":1}
```

Returns an AI generation with `review_status: "pending"`. The output has `summary`, `key_points`, `decisions[]`, and `action_items[]`.

`POST /ai/generations/:id/review`

Approve all extracted items:

```json
{"reviewed_by":1,"decision":"approved"}
```

Approve selected zero-based entries:

```json
{"reviewed_by":1,"decision":"approved","approved_decision_indices":[0],"approved_action_item_indices":[0,2]}
```

Reject without writing decisions/tasks:

```json
{"reviewed_by":1,"decision":"rejected"}
```

An AI generation can only be reviewed once. The review endpoint validates IDs, matches task owners against meeting participants, leaves an unmatched owner unassigned, and records task creation in `action_history`.

## Knowledge base

`GET /knowledge?search=jwt` searches title, content and tags.

`POST /knowledge`

```json
{"title":"API standards","document_type":"guide","content":"Use consistent REST naming...","tags":"api,rest","uploaded_by":1}
```

`GET /knowledge/:id` returns the document content.

`POST /knowledge/recommend/:taskId` ranks relevant documents for a task using Gemini or demo-mode keyword overlap.

`POST /knowledge/links`

```json
{"document_id":1,"action_item_id":2,"relevance_note":"Explains the API authentication flow","linked_by":1}
```

Exactly one target field is required: `meeting_id`, `action_item_id`, or `decision_id`.

## Smart Context Handover

`POST /handover/:userId/generate`

```json
{"requested_by":1}
```

Builds a context bundle from the selected user's open tasks, recent meetings, decisions and linked knowledge documents, then generates a tailored brief. The generated brief and source-context counts are returned; a generation record is stored.

## Error format

```json
{"success":false,"message":"Human-readable error","requestId":"request-correlation-id"}
```

The request ID can be matched against `backend/logs/app.log`.
