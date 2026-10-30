import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronLeft, Circle, ClipboardCheck, FileText, MessageSquareText, Plus, Send, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';

const STAGES = [['initiated', 'Initiated'], ['capturing', 'Knowledge capture'], ['pending_review', 'Manager review'], ['onboarding', 'Onboarding'], ['completed', 'Completed']];
const TYPES = { project_info: 'Project information', process: 'Process', decision: 'Decision', technical_doc: 'Technical documentation' };
const stageIndex = s => (s === 'changes_requested' ? 1 : Math.max(0, STAGES.findIndex(x => x[0] === s)));
const fmt = v => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Bar({ value }) { return <div className="kt-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>; }

export default function Transfer({ users, notify }) {
  const [me, setMe] = useState(() => localStorage.getItem('cf_user') || '1');
  const [list, setList] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const call = useCallback(async (path, method = 'GET', body) => {
    const res = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-User-Id': me }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
    return json;
  }, [me]);

  const loadList = useCallback(async () => { try { setList((await call('/transfers')).data); } catch (e) { notify('error', e.message); } }, [call, notify]);
  const loadOne = useCallback(async id => { try { setData((await call(`/transfers/${id}`)).data); } catch (e) { notify('error', e.message); } }, [call, notify]);
  useEffect(() => { localStorage.setItem('cf_user', me); loadList(); if (openId) loadOne(openId); }, [me, openId, loadList, loadOne]);

  const act = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) notify('success', okMsg(r)); await loadOne(openId); await loadList(); return r; } catch (e) { notify('error', e.message); } finally { setBusy(false); } };
  const name = id => users.find(u => String(u.id) === String(id))?.full_name || `User ${id}`;

  const create = async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await call('/transfers', 'POST', { title: f.get('title'), project_name: f.get('project'), outgoing_user_id: Number(f.get('from')), successor_user_id: Number(f.get('to')), due_date: f.get('due') || null });
      notify('success', 'Knowledge transfer initiated'); setShowNew(false); await loadList(); setOpenId(r.data.id);
    } catch (err) { notify('error', err.message); } finally { setBusy(false); }
  };

  const whoPicker = (
    <label className="kt-who"><UserCheck size={15} /> Acting as
      <select value={me} onChange={e => { setMe(e.target.value); setData(null); }}>{users.map(u => <option key={u.id} value={u.id}>{u.full_name} — {u.role}</option>)}</select>
    </label>
  );

  if (!openId) return (
    <div>
      <div className="section-heading"><div><div className="eyebrow">Handover</div><h1>Knowledge transfer</h1><p>Capture what a senior knows, review it, and hand it to a successor with every open task and its history.</p></div>
        <div className="kt-actions">{whoPicker}<button className="button button-primary" onClick={() => setShowNew(!showNew)}><Plus size={15} /> Initiate transfer</button></div></div>
      {showNew && <form className="panel kt-form" onSubmit={create}>
        <label className="field"><span>Title</span><input name="title" required minLength={3} placeholder="Authentication module handover" /></label>
        <label className="field"><span>Project</span><input name="project" required placeholder="Authentication Module" /></label>
        <label className="field"><span>Senior (leaving)</span><select name="from">{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
        <label className="field"><span>Successor</span><select name="to" defaultValue={users[users.length - 1]?.id}>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
        <label className="field"><span>Target date</span><input type="date" name="due" /></label>
        <div className="kt-row"><span className="muted">You ({name(me)}) become the reviewing manager.</span><button className="button button-primary" disabled={busy}>Start session</button></div>
      </form>}
      <div className="kt-list">{list.length === 0 && <div className="panel">No transfers yet. Initiate one to begin.</div>}
        {list.map(s => <button key={s.id} className="panel kt-card" onClick={() => setOpenId(s.id)}>
          <div className="kt-row"><b>{s.title}</b><span className={`status status-${s.status.replaceAll('_', '-')}`}>{s.status.replaceAll('_', ' ')}</span></div>
          <div className="muted">{s.project_name} · {s.outgoing_name} → {s.successor_name} · manager {s.manager_name}</div>
          <Bar value={s.progress.percent} /><div className="muted">{s.progress.percent}% complete</div></button>)}</div>
    </div>
  );

  if (!data) return <div className="panel">Loading… {whoPicker}</div>;
  const s = data, isMgr = Number(me) === Number(s.manager_id), isSenior = Number(me) === Number(s.outgoing_user_id), isSucc = Number(me) === Number(s.successor_user_id);
  const report = s.reports.find(r => r.review_status === 'pending') || s.reports.find(r => r.review_status === 'approved') || s.reports[0];
  const rc = report?.content_json; const idx = stageIndex(s.status);
  const role = isMgr ? 'Manager' : isSenior ? 'Senior' : isSucc ? 'Successor' : 'Viewer';

  return (
    <div className="kt-page">
      <div className="section-heading"><div><button className="text-button" onClick={() => { setOpenId(null); setData(null); }}><ChevronLeft size={14} /> All transfers</button>
        <h1>{s.title}</h1><p>{s.project_name} · {s.outgoing_name} → {s.successor_name} · manager {s.manager_name} · target {fmt(s.due_date)}</p></div>
        <div className="kt-actions">{whoPicker}<span className="kt-role">{role} view</span></div></div>

      <ol className="kt-steps">{STAGES.map(([k, l], i) => <li key={k} className={i < idx ? 'done' : i === idx ? 'now' : ''}>{i < idx ? <CheckCircle2 size={16} /> : <Circle size={16} />} {l}{k === 'capturing' && s.status === 'changes_requested' ? ' (changes requested)' : ''}</li>)}</ol>

      <section className="panel"><div className="kt-row"><h3>Transfer completion</h3><b>{s.progress.percent}%</b></div><Bar value={s.progress.percent} />
        <div className="kt-stats"><span>Inputs: <b>{s.progress.inputs}</b></span><span>Checklist: <b>{s.progress.checklist.done}/{s.progress.checklist.total}</b></span><span>Tasks acknowledged: <b>{s.progress.tasks.acknowledged}/{s.progress.tasks.transferred}</b></span><span>Questions asked: <b>{s.progress.questions_asked}</b></span></div></section>

      <section className="panel"><h3><FileText size={16} /> 1. Knowledge from {s.outgoing_name}</h3>
        {s.inputs.length === 0 && <p className="muted">Nothing provided yet.</p>}
        {s.inputs.map(i => <details key={i.id} className="kt-item"><summary><b>{i.title}</b> <span className="tag">{TYPES[i.input_type]}</span></summary><pre>{i.content}</pre></details>)}
        {isSenior && ['initiated', 'capturing', 'changes_requested'].includes(s.status) && <form className="kt-form" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); const r = await act(() => call(`/transfers/${s.id}/inputs`, 'POST', { input_type: f.get('type'), title: f.get('title'), content: f.get('content') }), () => 'Knowledge added'); if (r) form.reset(); }}>
          <label className="field"><span>Type</span><select name="type">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Title</span><input name="title" required minLength={3} /></label>
          <label className="field wide"><span>Content (min. 20 characters)</span><textarea name="content" required minLength={20} rows={5} /></label>
          <button className="button button-primary" disabled={busy}><Plus size={14} /> Add to handover</button></form>}
        {isSenior && s.status === 'pending_review' && <p className="muted">Waiting for the manager to review the report.</p>}</section>

      <section className="panel"><h3><Sparkles size={16} /> 2. Handover report</h3>
        {isMgr && ['capturing', 'changes_requested', 'pending_review'].includes(s.status) && <button className="button button-primary" disabled={busy || s.inputs.length === 0} onClick={() => act(() => call(`/transfers/${s.id}/report`, 'POST'), r => `Report v${r.data.version} generated (${r.data.provider})`)}>{s.reports.length ? 'Regenerate report' : 'Generate report'}</button>}
        {!report && <p className="muted">No report yet.</p>}
        {report && <div className="kt-report">
          <div className="muted">Version {report.version} · {report.provider_name} · {report.review_status}{report.review_comment ? ` · “${report.review_comment}”` : ''}</div>
          {report.provider_name.toLowerCase().includes('fallback') && <div className="kt-warn">This report was not written by a live AI model. Review it carefully.</div>}
          <h4>Summary</h4><p>{rc.executive_summary}</p>{rc.project_overview && <><h4>Project overview</h4><p>{rc.project_overview}</p></>}
          {[['Key processes', rc.key_processes], ['Technical notes', rc.technical_notes], ['Risks', rc.risks], ['Knowledge gaps', rc.knowledge_gaps]].map(([t, a]) => a.length > 0 && <div key={t}><h4>{t}</h4><ul>{a.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
          {rc.key_decisions.length > 0 && <><h4>Key decisions</h4><ul>{rc.key_decisions.map((d, i) => <li key={i}><b>{d.decision}</b> — {d.rationale}</li>)}</ul></>}
          {rc.open_work.length > 0 && <><h4>Open work to transfer</h4><ul>{rc.open_work.map(w => <li key={w.task_id}><b>{w.title}</b> ({w.status}) — {w.what_successor_must_know}</li>)}</ul></>}
          {isMgr && s.status === 'pending_review' && report.review_status === 'pending' && <form className="kt-review" onSubmit={e => e.preventDefault()}>
            <textarea id="kt-comment" placeholder="Comment (required if requesting changes)" rows={2} />
            <div className="kt-row"><button className="button" disabled={busy} onClick={() => act(() => call(`/transfers/${s.id}/review`, 'POST', { decision: 'changes_requested', comment: document.getElementById('kt-comment').value }), r => r.message)}>Request changes</button>
              <button className="button button-primary" disabled={busy} onClick={() => act(() => call(`/transfers/${s.id}/review`, 'POST', { decision: 'approved', comment: document.getElementById('kt-comment').value || null }), r => `${r.message} ${r.tasks_transferred} task(s) transferred.`)}><ShieldCheck size={14} /> Approve &amp; transfer</button></div></form>}
        </div>}</section>

      {['onboarding', 'completed'].includes(s.status) && <>
        <section className="panel"><h3><ClipboardCheck size={16} /> 3. {isSucc ? 'Your onboarding checklist' : 'Onboarding checklist'}</h3>
          {s.checklist.map(c => <label key={c.id} className={`kt-check ${c.is_done ? 'done' : ''}`}><input type="checkbox" checked={!!c.is_done} disabled={!isSucc || busy || s.status === 'completed'} onChange={e => act(() => call(`/transfers/${s.id}/checklist/${c.id}`, 'PATCH', { is_done: e.target.checked }), r => r.completed ? 'Knowledge transfer completed 🎉' : null)} /> <span>{c.title}{c.document_title && <em> · {c.document_title}</em>}</span><span className="tag">{c.category}</span></label>)}
          {!isSucc && <p className="muted">Only {s.successor_name} can tick items.</p>}</section>

        <section className="panel"><h3><BookOpen size={16} /> 4. Transferred tasks (history preserved)</h3>
          {s.tasks.length === 0 && <p className="muted">No open tasks were transferred.</p>}
          {s.tasks.map(t => <div key={t.id} className="kt-item"><div className="kt-row"><b>#{t.id} {t.title}</b><span className={`status status-${t.status.replaceAll('_', '-')}`}>{t.status.replaceAll('_', ' ')}</span></div>
            <div className="muted">from {t.from_name} · priority {t.priority} · due {fmt(t.due_date)} · carried forward {t.carry_forward_count}×</div>
            <details><summary>History ({t.history.length})</summary><ul>{t.history.map((h, i) => <li key={i}><b>{h.event_type.replaceAll('_', ' ')}</b> · {fmt(h.created_at)}{h.actor_name ? ` · ${h.actor_name}` : ''} — {h.details}</li>)}</ul></details>
            {t.acknowledged_at ? <span className="kt-ok"><CheckCircle2 size={14} /> Acknowledged {fmt(t.acknowledged_at)}</span> : isSucc && <button className="button" disabled={busy} onClick={() => act(() => call(`/transfers/${s.id}/tasks/${t.id}/acknowledge`, 'POST'), r => r.completed ? 'Knowledge transfer completed 🎉' : 'Task acknowledged')}>Acknowledge I own this</button>}</div>)}</section></>}

      {(isSucc || isMgr) && <Ask s={s} call={call} busy={busy} act={act} />}
    </div>
  );
}

function Ask({ s, call, busy, act }) {
  const [q, setQ] = useState('');
  return (
    <section className="panel"><h3><MessageSquareText size={16} /> Ask about the system</h3>
      <p className="muted">Answers come only from stored documentation and are cited. If it isn’t documented, you’ll be told.</p>
      <form className="kt-ask" onSubmit={async e => { e.preventDefault(); const r = await act(() => call(`/transfers/${s.id}/ask`, 'POST', { question: q })); if (r) setQ(''); }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. How long do access tokens last?" minLength={5} required /><button className="button button-primary" disabled={busy}><Send size={14} /> Ask</button></form>
      {s.questions.map(x => <div key={x.id} className="kt-qa"><div className="kt-q">{x.question}</div><div className={`kt-a ${x.grounded ? '' : 'ungrounded'}`}><pre>{x.answer}</pre>
        <div className="muted">{x.grounded ? 'Sources: ' + (x.citations || []).map(c => c.title).join(', ') : 'Not found in documentation'} · {x.provider_name}</div></div></div>)}
    </section>
  );
}
