const { z } = require('zod');
const { pool } = require('../config/db');
const { generateTransferReport, demoTransferReport, answerFromDocs, extractiveAnswer } = require('../services/aiService');

const OPEN = ['open', 'in_progress', 'blocked'];
const id = v => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const STOP = new Set('the and for with what how does that this from are was were have has not you your can will its into about when where which who why should would could there their them then than'.split(' '));
const terms = t => [...new Set(String(t).toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP.has(w)))];

const reportSchema = z.object({
  executive_summary: z.string().min(1), project_overview: z.string(),
  key_processes: z.array(z.string()), key_decisions: z.array(z.object({ decision: z.string(), rationale: z.string() })),
  technical_notes: z.array(z.string()),
  open_work: z.array(z.object({ task_id: z.coerce.number(), title: z.string(), status: z.string(), what_successor_must_know: z.string() })),
  risks: z.array(z.string()),
  onboarding_checklist: z.array(z.object({ title: z.string().min(1), category: z.string().default('general'), document_id: z.coerce.number().nullable().optional() })),
  knowledge_gaps: z.array(z.string())
});

// Lightweight role check: the acting user comes from the X-User-Id header (demo identity, NOT authentication).
async function loadSession(req, res) {
  const sid = id(req.params.id), actor = id(req.get('x-user-id'));
  if (!sid) { fail(res, 400, 'Invalid session ID'); return null; }
  if (!actor) { fail(res, 401, 'Select a user (X-User-Id header is required)'); return null; }
  const [[s]] = await pool.execute('SELECT * FROM transfer_sessions WHERE id=?', [sid]);
  if (!s) { fail(res, 404, 'Transfer session not found'); return null; }
  return { s, actor };
}
const requireRole = (res, ctx, userIdField, label) => ctx.actor === Number(ctx.s[userIdField]) ? true : (fail(res, 403, `Only the ${label} can do this`), false);

async function progress(sessionId, session) {
  const [[inp]] = await pool.execute('SELECT COUNT(*) n FROM transfer_inputs WHERE session_id=?', [sessionId]);
  const [[cl]] = await pool.execute('SELECT COUNT(*) total, COALESCE(SUM(is_done),0) done FROM transfer_checklist_items WHERE session_id=?', [sessionId]);
  const [[tk]] = await pool.execute('SELECT COUNT(*) total, SUM(acknowledged_at IS NOT NULL) acked FROM transfer_tasks WHERE session_id=?', [sessionId]);
  const [[q]] = await pool.execute('SELECT COUNT(*) n FROM transfer_questions WHERE session_id=?', [sessionId]);
  const approved = ['onboarding', 'completed'].includes(session.status);
  const ratio = (a, b) => (b ? Number(a) / Number(b) : approved ? 1 : 0);
  const percent = Math.round((inp.n > 0 ? 15 : 0) + (approved ? 25 : 0) + 30 * ratio(cl.done, cl.total) + 30 * ratio(tk.acked || 0, tk.total));
  return { inputs: inp.n, checklist: { done: Number(cl.done), total: cl.total }, tasks: { transferred: tk.total, acknowledged: Number(tk.acked || 0) }, questions_asked: q.n, percent };
}

async function maybeComplete(req, sessionId) {
  const [[s]] = await pool.execute('SELECT * FROM transfer_sessions WHERE id=?', [sessionId]);
  if (s.status !== 'onboarding') return false;
  const p = await progress(sessionId, s);
  if (p.checklist.total > 0 && p.checklist.done === p.checklist.total && p.tasks.acknowledged === p.tasks.transferred) {
    await pool.execute("UPDATE transfer_sessions SET status='completed',completed_at=NOW() WHERE id=?", [sessionId]);
    req.log.info({ sessionId }, 'Knowledge transfer completed');
    return true;
  }
  return false;
}

async function listSessions(req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT s.*, m.full_name manager_name, o.full_name outgoing_name, u.full_name successor_name FROM transfer_sessions s JOIN users m ON m.id=s.manager_id JOIN users o ON o.id=s.outgoing_user_id JOIN users u ON u.id=s.successor_user_id ORDER BY s.created_at DESC, s.id DESC`);
    for (const r of rows) r.progress = await progress(r.id, r);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
}

async function createSession(req, res, next) {
  const actor = id(req.get('x-user-id'));
  const p = z.object({ title: z.string().trim().min(3).max(200), project_name: z.string().trim().min(2).max(150), outgoing_user_id: z.number().int().positive(), successor_user_id: z.number().int().positive(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }).refine(d => d.outgoing_user_id !== d.successor_user_id, { message: 'Senior and successor must be different people' }).safeParse(req.body);
  if (!actor) return fail(res, 401, 'Select a user (X-User-Id header is required)');
  if (!p.success) return fail(res, 400, 'Invalid session data', { errors: p.error.issues });
  const d = p.data, c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[mgr]] = await c.execute('SELECT id FROM users WHERE id=? AND is_active=1', [actor]);
    const [us] = await c.execute('SELECT id FROM users WHERE id IN (?,?) AND is_active=1', [d.outgoing_user_id, d.successor_user_id]);
    if (!mgr || us.length !== 2) { await c.rollback(); return fail(res, 400, 'Manager, senior or successor not found'); }
    const [m] = await c.execute("INSERT INTO meetings (title,meeting_type,agenda,status,facilitator_id,created_by) VALUES (?,'work_transfer',?,'scheduled',?,?)", [`Knowledge transfer: ${d.title}`, `Transfer of ${d.project_name}`, actor, actor]);
    for (const [uid, role] of [[actor, 'Manager'], [d.outgoing_user_id, 'Outgoing Owner'], [d.successor_user_id, 'Incoming Team Member']]) await c.execute('INSERT IGNORE INTO meeting_participants (meeting_id,user_id,participant_role) VALUES (?,?,?)', [m.insertId, uid, role]);
    const [r] = await c.execute('INSERT INTO transfer_sessions (title,project_name,manager_id,outgoing_user_id,successor_user_id,meeting_id,due_date) VALUES (?,?,?,?,?,?,?)', [d.title, d.project_name, actor, d.outgoing_user_id, d.successor_user_id, m.insertId, d.due_date || null]);
    await c.commit();
    req.log.info({ sessionId: r.insertId, managerId: actor, fromUserId: d.outgoing_user_id, toUserId: d.successor_user_id }, 'Knowledge transfer initiated');
    res.status(201).json({ success: true, data: { id: r.insertId, meeting_id: m.insertId } });
  } catch (e) { await c.rollback(); next(e); } finally { c.release(); }
}

async function getSession(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const s = ctx.s, sid = s.id;
    const [[names]] = await pool.execute('SELECT (SELECT full_name FROM users WHERE id=?) manager_name,(SELECT full_name FROM users WHERE id=?) outgoing_name,(SELECT full_name FROM users WHERE id=?) successor_name', [s.manager_id, s.outgoing_user_id, s.successor_user_id]);
    const [inputs] = await pool.execute('SELECT id,input_type,title,content,document_id,created_at FROM transfer_inputs WHERE session_id=? ORDER BY id', [sid]);
    const [reports] = await pool.execute('SELECT id,version,provider_name,content_json,review_status,review_comment,reviewed_at,created_at FROM transfer_reports WHERE session_id=? ORDER BY version DESC', [sid]);
    const [checklist] = await pool.execute('SELECT c.*,d.title document_title FROM transfer_checklist_items c LEFT JOIN knowledge_documents d ON d.id=c.document_id WHERE c.session_id=? ORDER BY c.sort_order,c.id', [sid]);
    const [tasks] = await pool.execute('SELECT a.id,a.title,a.description,a.status,a.priority,a.due_date,a.carry_forward_count,a.outcome,tt.acknowledged_at,tt.transferred_at,fu.full_name from_name FROM transfer_tasks tt JOIN action_items a ON a.id=tt.action_item_id LEFT JOIN users fu ON fu.id=tt.from_user_id WHERE tt.session_id=? ORDER BY a.id', [sid]);
    for (const t of tasks) { const [h] = await pool.execute('SELECT h.event_type,h.details,h.created_at,u.full_name actor_name FROM action_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.action_item_id=? ORDER BY h.created_at DESC,h.id DESC', [t.id]); t.history = h; }
    const [questions] = await pool.execute('SELECT id,asked_by,question,answer,citations,grounded,provider_name,created_at FROM transfer_questions WHERE session_id=? ORDER BY id DESC LIMIT 50', [sid]);
    res.json({ success: true, data: { ...s, ...names, inputs, reports, checklist, tasks, questions, progress: await progress(sid, s), viewer_id: ctx.actor } });
  } catch (e) { next(e); }
}

const typeToDoc = { project_info: 'document', process: 'guide', decision: 'reference', technical_doc: 'document' };
async function addInput(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx || !requireRole(res, ctx, 'outgoing_user_id', 'outgoing senior')) return;
    if (!['initiated', 'capturing', 'changes_requested'].includes(ctx.s.status)) return fail(res, 409, 'Inputs can no longer be added at this stage');
    const p = z.object({ input_type: z.enum(['project_info', 'process', 'decision', 'technical_doc']), title: z.string().trim().min(3).max(255), content: z.string().trim().min(20).max(100000) }).safeParse(req.body);
    if (!p.success) return fail(res, 400, 'Invalid input', { errors: p.error.issues });
    const d = p.data, c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [doc] = await c.execute('INSERT INTO knowledge_documents (title,document_type,content,tags,uploaded_by) VALUES (?,?,?,?,?)', [d.title, typeToDoc[d.input_type], d.content, `${ctx.s.project_name}, handover, ${d.input_type}`, ctx.actor]);
      const [r] = await c.execute('INSERT INTO transfer_inputs (session_id,input_type,title,content,document_id,created_by) VALUES (?,?,?,?,?,?)', [ctx.s.id, d.input_type, d.title, d.content, doc.insertId, ctx.actor]);
      await c.execute('INSERT IGNORE INTO knowledge_links (document_id,meeting_id,relevance_note,linked_by) VALUES (?,?,?,?)', [doc.insertId, ctx.s.meeting_id, 'Provided during knowledge transfer', ctx.actor]);
      await c.execute("UPDATE transfer_sessions SET status='capturing' WHERE id=? AND status='initiated'", [ctx.s.id]);
      await c.commit();
      req.log.info({ sessionId: ctx.s.id, inputId: r.insertId, inputType: d.input_type, documentId: doc.insertId }, 'Transfer input added');
      res.status(201).json({ success: true, data: { id: r.insertId, document_id: doc.insertId } });
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  } catch (e) { next(e); }
}

async function buildContext(s) {
  const [[[out]], [[succ]]] = await Promise.all([pool.execute('SELECT id,full_name,role FROM users WHERE id=?', [s.outgoing_user_id]), pool.execute('SELECT id,full_name,role FROM users WHERE id=?', [s.successor_user_id])]);
  const [inputs] = await pool.execute('SELECT input_type,title,content,document_id FROM transfer_inputs WHERE session_id=? ORDER BY id', [s.id]);
  const [open_tasks] = await pool.execute(`SELECT id,title,description,status,priority,due_date,carry_forward_count FROM action_items WHERE owner_id=? AND status IN ('open','in_progress','blocked') ORDER BY id`, [s.outgoing_user_id]);
  for (const t of open_tasks) { const [h] = await pool.execute('SELECT event_type,details,created_at FROM action_history WHERE action_item_id=? ORDER BY id DESC LIMIT 6', [t.id]); t.history = h; }
  const [meetings] = await pool.execute(`SELECT DISTINCT m.id,m.title,m.agenda,m.scheduled_at FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE mp.user_id=? AND m.id<>? ORDER BY m.scheduled_at DESC LIMIT 5`, [s.outgoing_user_id, s.meeting_id || 0]);
  for (const m of meetings) { const [n] = await pool.execute('SELECT content FROM meeting_notes WHERE meeting_id=? ORDER BY id', [m.id]); m.notes = n.map(x => x.content).join('\n').slice(0, 1500); }
  const mids = meetings.map(m => m.id);
  const [decisions] = mids.length ? await pool.query('SELECT d.decision_text,d.rationale,m.title meeting_title FROM decisions d JOIN meetings m ON m.id=d.meeting_id WHERE d.meeting_id IN (?) ORDER BY d.id DESC LIMIT 15', [mids]) : [[]];
  const tids = open_tasks.map(t => t.id);
  const [related] = await pool.query(`SELECT DISTINCT kd.id,kd.title,kd.document_type,LEFT(kd.content,1200) content FROM knowledge_documents kd JOIN knowledge_links kl ON kl.document_id=kd.id WHERE kd.is_active=1 AND (kl.meeting_id IN (?) OR kl.action_item_id IN (?)) LIMIT 12`, [mids.length ? mids : [0], tids.length ? tids : [0]]);
  const inIds = new Set(inputs.map(i => i.document_id));
  return { project_name: s.project_name, outgoing: out, successor: succ, inputs: inputs.map(i => ({ ...i, content: i.content.slice(0, 4000) })), input_documents: inputs.filter(i => i.document_id).map(i => ({ id: i.document_id, title: i.title })), open_tasks, recent_meetings: meetings, decisions, related_documents: related.filter(r => !inIds.has(r.id)) };
}

async function generateReport(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx || !requireRole(res, ctx, 'manager_id', 'manager')) return;
    const s = ctx.s;
    if (!['capturing', 'changes_requested', 'pending_review'].includes(s.status)) return fail(res, 409, 'A report can be generated only after the senior has provided inputs and before approval');
    const started = Date.now(), context = await buildContext(s);
    if (!context.inputs.length) return fail(res, 400, 'The senior has not provided any knowledge inputs yet');
    let result, degraded = false;
    try { result = await generateTransferReport(context); }
    catch (e) {
      req.log.error({ err: e, sessionId: s.id, outcome: 'failed' }, 'AI transfer report failed; using rule-based fallback');
      result = { output: demoTransferReport(context), provider: 'Rule-based fallback (AI failed)', model: 'demo-transfer' };
      degraded = true;
    }
    const parsed = reportSchema.safeParse(result.output);
    if (!parsed.success) return fail(res, 502, 'AI returned an invalid report. Inputs were preserved; try again.', { requestId: req.id });
    const taskIds = new Set(context.open_tasks.map(t => t.id)), docIds = new Set([...context.input_documents, ...context.related_documents].map(d => d.id));
    const rep = parsed.data;
    rep.open_work = rep.open_work.filter(w => taskIds.has(w.task_id));
    rep.onboarding_checklist = rep.onboarding_checklist.map(i => ({ ...i, document_id: i.document_id && docIds.has(i.document_id) ? i.document_id : null }));
    const latency = Date.now() - started, c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [g] = await c.execute(`INSERT INTO ai_generations (request_id,generation_type,meeting_id,requested_by,provider_name,model_name,output_json,status,review_status,latency_ms) VALUES (?,'transfer_report',?,?,?,?,?,'succeeded','pending',?)`, [req.id, s.meeting_id, ctx.actor, result.provider, result.model, JSON.stringify(rep), latency]);
      await c.execute("UPDATE transfer_reports SET review_status='rejected' WHERE session_id=? AND review_status='pending'", [s.id]);
      const [[v]] = await c.execute('SELECT COALESCE(MAX(version),0)+1 v FROM transfer_reports WHERE session_id=?', [s.id]);
      const [r] = await c.execute('INSERT INTO transfer_reports (session_id,version,generation_id,provider_name,content_json) VALUES (?,?,?,?,?)', [s.id, v.v, g.insertId, degraded ? `${result.provider}` : result.provider, JSON.stringify(rep)]);
      await c.execute("UPDATE transfer_sessions SET status='pending_review' WHERE id=?", [s.id]);
      await c.commit();
      req.log.info({ sessionId: s.id, reportId: r.insertId, version: v.v, provider: result.provider, latencyMs: latency, outcome: degraded ? 'fallback' : 'succeeded' }, 'Transfer report generated');
      res.status(201).json({ success: true, data: { report_id: r.insertId, version: v.v, provider: result.provider, degraded } });
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  } catch (e) { next(e); }
}

async function reviewReport(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx || !requireRole(res, ctx, 'manager_id', 'manager')) return;
    const s = ctx.s;
    const p = z.object({ decision: z.enum(['approved', 'changes_requested']), comment: z.string().max(3000).optional().nullable(), task_ids: z.array(z.number().int().positive()).optional() }).safeParse(req.body);
    if (!p.success) return fail(res, 400, 'Invalid review', { errors: p.error.issues });
    if (p.data.decision === 'changes_requested' && !p.data.comment?.trim()) return fail(res, 400, 'A comment is required when requesting changes');
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [[sess]] = await c.execute('SELECT * FROM transfer_sessions WHERE id=? FOR UPDATE', [s.id]);
      const [[rep]] = await c.execute("SELECT * FROM transfer_reports WHERE session_id=? AND review_status='pending' ORDER BY version DESC LIMIT 1", [s.id]);
      if (sess.status !== 'pending_review' || !rep) { await c.rollback(); return fail(res, 409, 'There is no report awaiting review'); }
      if (p.data.decision === 'changes_requested') {
        await c.execute("UPDATE transfer_reports SET review_status='rejected',reviewer_id=?,review_comment=?,reviewed_at=NOW() WHERE id=?", [ctx.actor, p.data.comment, rep.id]);
        await c.execute("UPDATE transfer_sessions SET status='changes_requested' WHERE id=?", [s.id]);
        await c.commit(); req.log.info({ sessionId: s.id, reportId: rep.id, reviewerId: ctx.actor }, 'Transfer report sent back for changes');
        return res.json({ success: true, message: 'Changes requested. The senior can add inputs, then a new report can be generated.', status: 'changes_requested' });
      }
      const content = typeof rep.content_json === 'string' ? JSON.parse(rep.content_json) : rep.content_json;
      await c.execute("UPDATE transfer_reports SET review_status='approved',reviewer_id=?,review_comment=?,reviewed_at=NOW() WHERE id=?", [ctx.actor, p.data.comment || null, rep.id]);
      // checklist
      await c.execute('DELETE FROM transfer_checklist_items WHERE session_id=?', [s.id]);
      let order = 0;
      for (const it of content.onboarding_checklist) await c.execute('INSERT INTO transfer_checklist_items (session_id,title,category,document_id,sort_order) VALUES (?,?,?,?,?)', [s.id, it.title.slice(0, 255), (it.category || 'general').slice(0, 40), it.document_id || null, order++]);
      // transfer open tasks, preserving identity + history
      const [tasks] = await c.execute("SELECT * FROM action_items WHERE owner_id=? AND status IN ('open','in_progress','blocked') FOR UPDATE", [s.outgoing_user_id]);
      const chosen = p.data.task_ids ? tasks.filter(t => p.data.task_ids.includes(Number(t.id))) : tasks;
      for (const t of chosen) {
        const moved = Number(t.current_meeting_id) !== Number(s.meeting_id);
        await c.execute('UPDATE action_items SET owner_id=?,current_meeting_id=?,carry_forward_count=carry_forward_count+? WHERE id=?', [s.successor_user_id, s.meeting_id, moved ? 1 : 0, t.id]);
        await c.execute("INSERT INTO action_history (action_item_id,event_type,previous_status,new_status,previous_owner_id,new_owner_id,from_meeting_id,to_meeting_id,actor_id,details) VALUES (?,'transferred',?,?,?,?,?,?,?,?)", [t.id, t.status, t.status, t.owner_id, s.successor_user_id, t.current_meeting_id, s.meeting_id, ctx.actor, `Transferred in knowledge transfer #${s.id} (${s.project_name}); original task and history retained.`]);
        await c.execute('INSERT INTO transfer_tasks (session_id,action_item_id,from_user_id,to_user_id) VALUES (?,?,?,?)', [s.id, t.id, s.outgoing_user_id, s.successor_user_id]);
        req.log.info({ taskId: t.id, fromUserId: s.outgoing_user_id, toUserId: s.successor_user_id, sessionId: s.id }, 'Action item reassigned (knowledge transfer)');
      }
      await c.execute("UPDATE transfer_sessions SET status='onboarding',approved_at=NOW() WHERE id=?", [s.id]);
      await c.commit();
      req.log.info({ sessionId: s.id, reportId: rep.id, reviewerId: ctx.actor, tasksTransferred: chosen.length, checklistItems: order }, 'Transfer report approved');
      res.json({ success: true, message: 'Report approved. Successor dashboard is ready.', status: 'onboarding', tasks_transferred: chosen.length, checklist_items: order });
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  } catch (e) { next(e); }
}

async function toggleChecklist(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx || !requireRole(res, ctx, 'successor_user_id', 'successor')) return;
    const itemId = id(req.params.itemId), done = z.boolean().safeParse(req.body?.is_done);
    if (!itemId || !done.success) return fail(res, 400, 'Invalid request');
    if (ctx.s.status !== 'onboarding') return fail(res, 409, 'Checklist is active only during onboarding');
    const [r] = await pool.execute('UPDATE transfer_checklist_items SET is_done=?,completed_at=? WHERE id=? AND session_id=?', [done.data, done.data ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, itemId, ctx.s.id]);
    if (!r.affectedRows) return fail(res, 404, 'Checklist item not found');
    req.log.info({ sessionId: ctx.s.id, itemId, done: done.data }, 'Onboarding checklist item updated');
    res.json({ success: true, completed: await maybeComplete(req, ctx.s.id) });
  } catch (e) { next(e); }
}

async function acknowledgeTask(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx || !requireRole(res, ctx, 'successor_user_id', 'successor')) return;
    const tid = id(req.params.taskId); if (!tid) return fail(res, 400, 'Invalid task ID');
    const [r] = await pool.execute('UPDATE transfer_tasks SET acknowledged_at=NOW() WHERE session_id=? AND action_item_id=? AND acknowledged_at IS NULL', [ctx.s.id, tid]);
    if (!r.affectedRows) return fail(res, 404, 'Task not awaiting acknowledgement in this session');
    await pool.execute("INSERT INTO action_history (action_item_id,event_type,actor_id,details) VALUES (?,'comment_added',?,?)", [tid, ctx.actor, 'Successor acknowledged receipt of this task and its history.']);
    req.log.info({ sessionId: ctx.s.id, taskId: tid }, 'Transferred task acknowledged');
    res.json({ success: true, completed: await maybeComplete(req, ctx.s.id) });
  } catch (e) { next(e); }
}

async function askQuestion(req, res, next) {
  try {
    const ctx = await loadSession(req, res); if (!ctx) return;
    if (![ctx.s.successor_user_id, ctx.s.manager_id].map(Number).includes(ctx.actor)) return fail(res, 403, 'Only the successor or manager can ask questions');
    const q = z.string().trim().min(5).max(1000).safeParse(req.body?.question);
    if (!q.success) return fail(res, 400, 'Question must be 5-1000 characters');
    const started = Date.now();
    const [docs] = await pool.query('SELECT id,title,content FROM knowledge_documents WHERE is_active=1 ORDER BY id LIMIT 300');
    const [inDocs] = await pool.execute('SELECT document_id FROM transfer_inputs WHERE session_id=?', [ctx.s.id]);
    const boosted = new Set(inDocs.map(d => Number(d.document_id)));
    const qt = terms(q.data), chunks = [];
    for (const d of docs) for (const part of String(d.content).split(/\n\s*\n/)) {
      const text = part.trim(); if (!text) continue;
      const words = new Set(terms(`${d.title} ${text}`)), hits = qt.filter(t => words.has(t)).length;
      if (hits >= Math.min(2, qt.length) && hits > 0) chunks.push({ document_id: Number(d.id), title: d.title, text: text.slice(0, 1200), score: hits * (boosted.has(Number(d.id)) ? 1.5 : 1) });
    }
    chunks.sort((a, b) => b.score - a.score);
    const top = chunks.slice(0, 5);
    let out, provider = 'No AI call (no matching documentation)';
    if (!top.length) out = { answer: 'I could not find this in the stored documentation. Ask the outgoing owner or add a document covering it.', source_ids: [], answerable: false };
    else try { const r = await answerFromDocs({ question: q.data, chunks: top }); out = r.output; provider = r.provider; if (!out || typeof out.answer !== 'string') throw new Error('Malformed AI answer'); }
    catch (e) { req.log.error({ err: e, sessionId: ctx.s.id, outcome: 'failed' }, 'AI answer failed; using extractive fallback'); out = extractiveAnswer(top); provider = 'Extractive fallback (AI unavailable)'; }
    const valid = new Set(top.map(c => c.document_id));
    const ids = (Array.isArray(out.source_ids) ? out.source_ids : []).map(Number).filter(i => valid.has(i));
    const grounded = out.answerable !== false && ids.length > 0;
    const citations = ids.map(i => ({ document_id: i, title: top.find(c => c.document_id === i).title }));
    const [r] = await pool.execute('INSERT INTO transfer_questions (session_id,asked_by,question,answer,citations,grounded,provider_name) VALUES (?,?,?,?,?,?,?)', [ctx.s.id, ctx.actor, q.data, grounded || !top.length ? out.answer : `${out.answer}\n\n(Warning: no valid source citation was returned.)`, JSON.stringify(citations), grounded, provider]);
    req.log.info({ sessionId: ctx.s.id, questionId: r.insertId, questionChars: q.data.length, sources: ids.length, grounded, provider, latencyMs: Date.now() - started }, 'Transfer question answered');
    res.status(201).json({ success: true, data: { id: r.insertId, answer: out.answer, citations, grounded, provider } });
  } catch (e) { next(e); }
}

module.exports = { listSessions, createSession, getSession, addInput, generateReport, reviewReport, toggleChecklist, acknowledgeTask, askQuestion };
