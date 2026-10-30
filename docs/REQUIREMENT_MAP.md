# DigiPlus Assignment Requirement Map

| Assignment area | ContextFlow implementation | Verification path |
|---|---|---|
| Capture/persist meetings and work transfers | `meetings`, `meeting_participants`, `meeting_notes`; create/list/detail/note routes | UI → Meetings; `POST /api/meetings`; `GET /api/meetings/:id` |
| Agenda, participants, notes, decisions, action items | Meeting form and related relational tables | Open a meeting detail in the UI |
| Track action item lifecycle | `action_items` with owner, due date, status, priority and outcome | UI → Action items; `PATCH /api/action-items/:id` |
| Carry open tasks forward preserving history | `source_meeting_id`, `current_meeting_id`, `carry_forward_count`, transactional `action_history` event | UI → Action items → Carry to… |
| AI recap and extraction | `aiService.js`, `aiController.js`; Gemini option plus labelled demo mode | UI → Meetings → select a meeting → Extract with AI |
| Human verification of AI output | Pending generation status and selected-item review endpoint | AI review panel; `POST /api/ai/generations/:id/review` |
| Catch-up brief for absent/taking-over person | `POST /api/handover/:userId/generate`; assembles tasks, meetings, decisions and linked documents | UI → Handover center |
| Knowledge base | `knowledge_documents`, search/create/retrieve APIs | UI → Knowledge base |
| Link tasks/meetings/decisions to knowledge | `knowledge_links`, recommendation and link endpoints | UI → Action items → book icon → Link |
| Record outcome | `action_items.outcome` and `outcome_recorded` history event | `PATCH /api/action-items/:id` with `outcome` |
| Validation and error handling | Zod schemas, parameterized SQL, consistent error middleware, transactions | Invalid/duplicate requests and API error responses |
| Structured application logs | Pino/Pino HTTP, request IDs, AI latency/outcome and task lifecycle logs | `backend/logs/app.log` |
| Original special feature | Smart Context Handover | UI → Handover center; see `README.md` |
| README/setup/deployment | Root README, setup scripts, Dockerfiles and Compose | Follow README |

## Important demo distinction

`AI_PROVIDER=demo` keeps the app usable without API credentials, but the generated text is explicitly a demo fallback. A genuine AI demonstration requires `AI_PROVIDER=gemini`, a valid Gemini key and a currently available model ID. Keep a clear record of which mode was used during assessment.
