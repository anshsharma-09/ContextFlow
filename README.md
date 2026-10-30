# ContextFlow — AI-Powered Knowledge & Tasks Management Platform

## The knowledge-transfer workflow (primary flow)

1. **Manager initiates** a session (project, senior, successor). A `work_transfer` meeting is created automatically as the session's home.
2. **Senior provides** project information, processes, decisions and technical documentation. Each input is stored as a knowledge document, so it is searchable and citable.
3. **ContextFlow connects** those inputs to the senior's open tasks (with their history), recent meetings, decisions and linked knowledge documents.
4. **Gemini drafts a structured handover report** (summary, processes, decisions, technical notes, open work, risks, knowledge gaps, onboarding checklist). Output is schema-validated; task and document IDs the model invents are discarded.
5. **Manager reviews**: approve, or request changes with a comment (senior adds inputs, report is regenerated as a new version).
6. **On approval** (one DB transaction) the onboarding checklist is created and every open task owned by the senior is **reassigned to the successor under the same ID**, moved to the session meeting, with a `transferred` entry in `action_history`. Nothing is duplicated or deleted.
7. **Successor dashboard**: checklist, transferred tasks with full history (acknowledge each), and **Q&A grounded in stored documentation** (cited sources; if nothing relevant is stored the answer is "not documented", and no AI call is made).
8. **Manager sees completion status**: 15% inputs provided, 25% report approved, 30% checklist, 30% tasks acknowledged. The session auto-completes when the checklist is 100% done and all tasks are acknowledged.

Open **Knowledge transfer** in the sidebar. Use the **Acting as** selector: Ananya (manager, id 1), Rahul (senior, id 2), Kabir (successor, id 5).

Run the automated end-to-end check (27 assertions) against a running backend on a freshly seeded DB: `cd backend && node scripts/e2e-transfer.js`.

**New endpoints** (all require the `X-User-Id` header): `GET/POST /transfers`, `GET /transfers/:id`, `POST /transfers/:id/inputs` (senior), `POST /transfers/:id/report` and `/review` (manager), `PATCH /transfers/:id/checklist/:itemId` and `POST /transfers/:id/tasks/:taskId/acknowledge` (successor), `POST /transfers/:id/ask` (successor/manager). Role rules are enforced server-side.

**Transfer limitations:** `X-User-Id` is a demo identity, **not authentication**; add real login before real use. Q&A retrieval is keyword overlap over paragraph chunks, not embeddings. Without `AI_PROVIDER=gemini` the report and answers are rule-based/extractive and labelled as such. If Gemini fails, the report falls back to the labelled rule-based version and Q&A to extracted passages. The Gemini path and the default model name `gemini-3.8-flash` have **not been tested or verified** by me; confirm the model name in Google's docs and set `GEMINI_MODEL`. The UI was built successfully but not exercised in a browser.

---

ContextFlow keeps team knowledge connected to the work. It captures meetings and work transfers, extracts decisions and action items with AI, requires human review before committing AI suggestions, tracks task ownership and history, connects internal knowledge documents, and creates personalized handover briefs.

> **Demo data notice:** The included team members, meetings, notes, tasks and documents are fictional demonstration records. They are not real company data.

## 1. What is included

- **Meeting & work-transfer capture:** create meetings, add participants, agendas and original notes; inspect the full meeting context.
- **AI meeting extraction:** summarize raw notes and extract decisions, key points, owners, due dates and priorities.
- **Human review:** approve selected decisions and action items or reject the extraction. AI output is not automatically treated as approved business data.
- **Action-item lifecycle:** assign owners, set due dates and priorities, update status, record outcomes and inspect a chronological audit trail.
- **Carry-forward without duplication:** a task keeps its original ID and source meeting while its current meeting is changed. The move is recorded in `action_history`.
- **Knowledge base:** store team guides, policies and reference content; search documents and link them to meetings, decisions or tasks.
- **Knowledge suggestions:** suggest documents related to a task. With Gemini enabled, recommendations use the model; demo mode uses transparent keyword-overlap ranking.
- **Smart Context Handover (special feature):** assemble a person's open tasks, recent meetings, decisions and linked knowledge into a tailored brief.
- **Structured application logs:** Pino JSON logs, request correlation IDs, AI latency/outcome and task lifecycle events; local output is written to `backend/logs/app.log`.
- **Validation and failure handling:** request validation with Zod, parameterized SQL, transactional updates and graceful AI-provider errors.

## 2. Quick start on Windows (existing MySQL installation)

Requirements: Node.js 20.19+ (Node 24 recommended), npm, and MySQL Server 8.0+ (the schema is tested/design-targeted for MySQL 8.4). The project has a separate database name, `contextflow_platform`, so it does not overwrite the earlier `contextflow_db` you may already have.

### A. Configure backend

Open PowerShell in the extracted `ContextFlow_Complete` folder:

```powershell
Set-Location .\backend
Copy-Item .env.example .env
notepad .env
```

Set your local MySQL values in `backend/.env`:

```env
PORT=5000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
LOG_LEVEL=info
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=contextflow_platform
AI_PROVIDER=demo
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=60000
```

Use your own MySQL password. Do not commit or share `.env`.

Install backend packages and create the schema plus demonstration records:

```powershell
npm install
npm run db:setup
npm run dev
```

Expected messages include `ContextFlow backend started` and the API address `http://localhost:5000/api`.

### B. Start the React frontend

Open a **second** PowerShell terminal:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` requests to the backend on port 5000.

### C. Confirm the API

Open http://localhost:5000/api/health. The JSON should show `database: connected` and `aiProvider: demo` (unless you configured Gemini).

## 3. AI provider modes

### Demo mode (default; no key needed)

`AI_PROVIDER=demo` lets you explore the complete UI and test the extraction/review/handover workflow without an external API key. Demo results are explicitly marked as **Demo fallback** in the UI/API. The extraction is a transparent local heuristic based on the supplied text; it is not a live Gemini response and must not be represented as one in an assessment.

### Gemini mode (real AI)

1. Create a key in [Google AI Studio](https://aistudio.google.com/api-keys).
2. Put it only in `backend/.env`.
3. Set:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=60000
```

4. Restart the backend.

The backend uses Google's Gemini `generateContent` API and expects JSON output. It retries transient HTTP 429/5xx responses up to three attempts with short backoff. Provider errors are logged and reported without deleting the original notes. If a provider is overloaded or the project has no quota, the request can still fail; switch back to `AI_PROVIDER=demo` for local UI/demo work.

Current model availability can change. Check [Gemini API model documentation](https://ai.google.dev/gemini-api/docs/models) before submission if you need to change `GEMINI_MODEL`.

## 4. Docker Compose option

Docker Compose starts an isolated MySQL 8.4 database, backend and frontend. It maps MySQL to host port **3307** to avoid colliding with a local MySQL Server on 3306.

From the project root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set a strong local `MYSQL_ROOT_PASSWORD`. To use live Gemini also set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`. Then run:

```powershell
docker compose up --build
```

Open http://localhost:5173. The API is at http://localhost:5000. To stop:

```powershell
docker compose down
```

To remove the Docker database volume as well (this deletes its stored demo/application data):

```powershell
docker compose down -v
```

## 5. Demo walkthrough

1. Open **Meetings** and select `Sprint Planning - Authentication Module`.
2. Review the original notes and click **Extract with AI**.
3. Review the summary, decisions and proposed tasks; select the items to approve.
4. Click **Approve selected**. The approved decisions enter `decisions`; approved tasks enter `action_items` and receive initial `action_history` records.
5. Open **Action items**. Update a task status, inspect priority and owner, or carry an unfinished task into a different meeting. The task ID is retained.
6. Open **Knowledge base**. Add a guide or search existing documents.
7. From an action item's book icon, request relevant knowledge suggestions and link a document.
8. Open **Handover center**, select a team member and generate a personalized context brief.

Demo user IDs: Ananya `1`, Rahul `2`, Priya `3`, Arjun `4`.

## 6. API overview

All endpoints are prefixed with `/api`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Backend/database/AI mode health |
| GET | `/dashboard` | Dashboard metrics and current priorities |
| GET, POST | `/users` | List or add team members |
| GET, POST | `/meetings` | List or create meetings/work transfers |
| GET | `/meetings/:id` | Meeting with participants, notes, decisions and current tasks |
| POST | `/meetings/:id/notes` | Add raw meeting notes |
| GET, POST | `/action-items` | List or create tasks |
| GET | `/action-items/:id` | Task details and history |
| PATCH | `/action-items/:id` | Update task, owner, status, date or outcome |
| POST | `/action-items/:id/carry-forward` | Carry a task to another meeting without duplicating it |
| POST | `/ai/meetings/:id/extract` | Generate meeting summary/decisions/tasks |
| POST | `/ai/generations/:id/review` | Approve selected suggestions or reject the generation |
| GET, POST | `/knowledge` | Search/list or create knowledge documents |
| GET | `/knowledge/:id` | Retrieve a document |
| POST | `/knowledge/recommend/:taskId` | Recommend relevant documents for a task |
| POST | `/knowledge/links` | Link a document to exactly one meeting/task/decision |
| POST | `/handover/:userId/generate` | Generate a personalized handover/catch-up brief |

More details and request examples are in [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

## 7. Database design

The schema is in `database/schema.sql`; demo records are in `database/seed.sql`. `npm run db:setup` creates the database if needed, applies all tables (including `knowledge_transfer.sql`) and inserts deterministic demo rows using `INSERT IGNORE`.

Core tables:

- `users`, `meetings`, `meeting_participants`, `meeting_notes`
- `decisions`, `action_items`, `action_history`
- `knowledge_documents`, `knowledge_links`, `ai_generations`

`action_items.source_meeting_id` preserves the origin; `current_meeting_id` represents the latest meeting/work transfer. Carry-forward updates `current_meeting_id` and records the transition in `action_history` inside one transaction. It does not create a second task.

## 8. Logging and reliability

- Logs are newline-delimited JSON at `backend/logs/app.log` (Docker mounts this directory as a persistent host folder).
- `pino-http` attaches a unique request ID to each request.
- Task create/reassign/close/carry-forward, AI success/failure and handover events are logged with relevant IDs and latency.
- Authorization, cookies and API-key-related fields are redacted. Request bodies and secrets are not intentionally logged.
- Database writes for meeting creation, action creation, task updates, carry-forward and AI approval use transactions where multiple related records must remain consistent.
- AI extraction does not modify the original meeting notes. AI output is stored as `pending` and only becomes decisions/tasks after human approval.

## 9. Special feature: Smart Context Handover

The special feature is **Smart Context Handover**. Instead of handing a teammate a bare task list, ContextFlow assembles assigned open/blocked/in-progress tasks, recent meetings, decisions and relevant linked knowledge documents. Gemini can synthesize this context into a personalized catch-up brief. Demo mode creates a labelled, deterministic brief from the same stored records. This directly targets context loss when a person is absent or a responsibility changes hands.

## 10. Assumptions and limitations

- The bundled dataset is fictional demo data; replace it with real records only when authorized.
- The sample app uses demo user ID `1` for the facilitator/reviewer and does **not** implement production authentication/role-based authorization. Do not deploy it with real confidential information until authentication, authorization and tenant isolation are added.
- Knowledge content is stored as text in MySQL; the included UI supports pasting text, not binary document upload, OCR or PDF parsing.
- AI output can be incomplete or wrong. A human review step is mandatory before creating decisions/tasks; an unclear task owner remains unassigned.
- Demo AI fallback is not a substitute for a live model. Use `AI_PROVIDER=gemini` for real AI evidence.
- Gemini availability, rate limits and pricing are governed by the Google project/key and can change.
- The brief currently uses a bounded recent-context query and linked knowledge links; a larger production system may use embeddings/vector search, access controls and explicit relevance feedback.
- Local file logging is suitable for this assessment. A production deployment should also stream logs to an external observability service and use durable storage/volumes.

## 11. Deployment notes

The included Dockerfiles and Compose configuration provide a reproducible container deployment. For Vercel, create two projects from this repository: set the backend project's Root Directory to `backend` and the frontend project's Root Directory to `frontend`. The backend exposes its Express app through `backend/api/[...path].js`; configure `DB_*`, `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `FRONTEND_URL` in the backend project. Set the frontend project's `VITE_API_URL` to the backend deployment origin (without a trailing slash). Use a managed MySQL database reachable from Vercel, and run `npm run db:setup` once per environment before the backend accepts traffic. Never commit secrets.

## 12. Development and debugging

Backend syntax check:

```powershell
Set-Location .\backend
npm run check
```

Inspect recent logs:

```powershell
Get-Content .\logs\app.log -Tail 30
```

If port 5000 is occupied, stop the other process or choose another `PORT` and update the frontend Vite proxy in `frontend/vite.config.js`.

---

Built as an assessment-ready reference implementation. Verify the complete workflow in your own environment before submission and describe honestly which AI provider mode you used during the demonstration.
