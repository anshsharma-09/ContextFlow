import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, CalendarDays,
  Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardList, Clock3,
  FileText, FolderOpen, LayoutDashboard, Link2, ListTodo, LoaderCircle,
  Menu, MessageSquareText, Plus, RefreshCw, Search, Send, Sparkles,
  UserCheck, Users, Workflow, X, Zap
} from 'lucide-react';
import { api, jsonBody } from './api';
import Transfer from './Transfer.jsx';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays },
  { id: 'tasks', label: 'Action items', icon: ListTodo },
  { id: 'knowledge', label: 'Knowledge base', icon: BookOpen },
  { id: 'transfer', label: 'Knowledge transfer', icon: UserCheck },
  { id: 'handover', label: 'Handover center', icon: Workflow }
];

function dateLabel(value) {
  if (!value) return 'No date';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function initials(name = '') { return name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase(); }
function Status({ value }) {
  const cls = String(value || '').replaceAll('_', '-');
  return <span className={`status status-${cls}`}>{String(value || 'unknown').replaceAll('_', ' ')}</span>;
}
function Priority({ value }) { return <span className={`priority priority-${value || 'medium'}`}><i />{value || 'medium'}</span>; }
function Empty({ icon: Icon = FileText, title, text }) {
  return <div className="empty"><span className="empty-icon"><Icon size={21} /></span><b>{title}</b><p>{text}</p></div>;
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function SectionHeading({ eyebrow, title, subtitle, action }) {
  return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export default function App() {
  const [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [meetingDetail, setMeetingDetail] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [selectedDecisions, setSelectedDecisions] = useState([]);
  const [selectedActions, setSelectedActions] = useState([]);
  const [handover, setHandover] = useState(null);
  const [handoverUser, setHandoverUser] = useState('2');
  const [recommendations, setRecommendations] = useState({});
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const notify = (type, message) => {
    setNotice({ type, message });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setNotice(null), 4500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, u, m, t, k, h] = await Promise.all([
        api('/dashboard'), api('/users'), api('/meetings'), api('/action-items'), api('/knowledge'), api('/health')
      ]);
      setDashboard(d.data); setUsers(u.data); setMeetings(m.data); setTasks(t.data); setDocuments(k.data); setHealth(h);
    } catch (error) { notify('error', error.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openMeeting = async id => {
    setBusy(true); setAiResult(null); setMeetingDetail(null);
    try { const result = await api(`/meetings/${id}`); setMeetingDetail(result.data); }
    catch (error) { notify('error', error.message); }
    finally { setBusy(false); }
  };

  const runExtraction = async id => {
    setBusy(true); setAiResult(null);
    try {
      const result = await api(`/ai/meetings/${id}/extract`, { method: 'POST', body: jsonBody({ requested_by: 1 }) });
      setAiResult(result); setSelectedDecisions(result.data.decisions.map((_, i) => i)); setSelectedActions(result.data.action_items.map((_, i) => i));
      notify('success', `Extraction ready using ${result.provider}. Review the suggestions below.`);
      await loadAll();
    } catch (error) { notify('error', error.message); }
    finally { setBusy(false); }
  };

  const reviewAI = async decision => {
    if (!aiResult?.generation_id) return;
    setBusy(true);
    try {
      const result = await api(`/ai/generations/${aiResult.generation_id}/review`, {
        method: 'POST', body: jsonBody({
          reviewed_by: 1, decision,
          approved_decision_indices: selectedDecisions,
          approved_action_item_indices: selectedActions
        })
      });
      notify('success', result.message); setAiResult(null);
      if (meetingDetail) await openMeeting(meetingDetail.id);
      await loadAll();
    } catch (error) { notify('error', error.message); }
    finally { setBusy(false); }
  };

  const createMeeting = async event => {
    event.preventDefault(); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const participantIds = form.getAll('participants').map(Number);
    try {
      await api('/meetings', { method: 'POST', body: jsonBody({
        title: form.get('title'), meeting_type: form.get('meeting_type'), agenda: form.get('agenda'),
        scheduled_at: form.get('scheduled_at') ? new Date(form.get('scheduled_at')).toISOString() : null,
        status: 'scheduled', facilitator_id: Number(form.get('facilitator_id') || 1), created_by: 1,
        participants: participantIds.map(user_id => ({ user_id, attendance_status: 'invited' })),
        initial_note: form.get('initial_note') || null
      }) });
      notify('success', 'Meeting created successfully.'); setShowMeetingForm(false); formElement.reset(); await loadAll();
    } catch (error) { notify('error', error.message); }
    finally { setBusy(false); }
  };

  const createTask = async event => {
    event.preventDefault(); setBusy(true); const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      await api('/action-items', { method: 'POST', body: jsonBody({
        source_meeting_id: Number(form.get('meeting_id')), title: form.get('title'), description: form.get('description'),
        owner_id: form.get('owner_id') ? Number(form.get('owner_id')) : null, created_by: 1,
        due_date: form.get('due_date') || null, priority: form.get('priority')
      }) });
      notify('success', 'Action item created.'); setShowTaskForm(false); formElement.reset(); await loadAll();
    } catch (error) { notify('error', error.message); }
    finally { setBusy(false); }
  };

  const updateTaskStatus = async (task, status) => {
    try { await api(`/action-items/${task.id}`, { method: 'PATCH', body: jsonBody({ status, actor_id: 1 }) }); notify('success', 'Task status updated.'); await loadAll(); }
    catch (error) { notify('error', error.message); }
  };

  const updateTaskOwner = async (task, ownerId) => {
    try { await api(`/action-items/${task.id}`, { method: 'PATCH', body: jsonBody({ owner_id: ownerId ? Number(ownerId) : null, actor_id: 1 }) }); notify('success', 'Task owner updated and history recorded.'); await loadAll(); }
    catch (error) { notify('error', error.message); }
  };

  const recordOutcome = async task => {
    const outcome = window.prompt('Record the outcome for this action item:', task.outcome || '');
    if (outcome === null) return;
    if (!outcome.trim()) { notify('error', 'Enter an outcome before saving.'); return; }
    try { await api(`/action-items/${task.id}`, { method: 'PATCH', body: jsonBody({ outcome: outcome.trim(), actor_id: 1 }) }); notify('success', 'Task outcome recorded in history.'); await loadAll(); }
    catch (error) { notify('error', error.message); }
  };

  const carryTask = async (task, toMeetingId) => {
    if (!toMeetingId) return;
    try { await api(`/action-items/${task.id}/carry-forward`, { method: 'POST', body: jsonBody({ to_meeting_id: Number(toMeetingId), actor_id: 1, note: 'Carried forward from the ContextFlow task workspace.' }) }); notify('success', 'Task carried forward. Original task ID and history preserved.'); await loadAll(); }
    catch (error) { notify('error', error.message); }
  };

  const createDocument = async event => {
    event.preventDefault(); setBusy(true); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { await api('/knowledge', { method:'POST', body:jsonBody({ title:form.get('title'), document_type:form.get('document_type'), content:form.get('content'), tags:form.get('tags'), uploaded_by:1 }) }); notify('success','Knowledge document added.');setShowDocumentForm(false);formElement.reset();await loadAll(); }
    catch(error){notify('error',error.message);} finally{setBusy(false);}
  };

  const generateHandover = async () => {
    setBusy(true); setHandover(null);
    try { const result=await api(`/handover/${handoverUser}/generate`,{method:'POST',body:jsonBody({requested_by:1})});setHandover(result);notify('success',`Handover brief generated using ${result.provider}.`); }
    catch(error){notify('error',error.message);} finally{setBusy(false);}
  };

  const getRecommendations = async task => {
    try { const result=await api(`/knowledge/recommend/${task.id}`,{method:'POST',body:jsonBody({requested_by:1})});setRecommendations(p=>({...p,[task.id]:result.data})); }
    catch(error){notify('error',error.message);}
  };

  const linkDocument = async (docId, taskId, reason) => {
    try { await api('/knowledge/links',{method:'POST',body:jsonBody({document_id:docId,action_item_id:taskId,relevance_note:reason,linked_by:1})});notify('success','Knowledge document linked to task.'); }
    catch(error){notify('error',error.message);}
  };

  const filteredTasks = useMemo(() => tasks.filter(t => `${t.title} ${t.owner_name || ''} ${t.status}`.toLowerCase().includes(search.toLowerCase())), [tasks, search]);
  const filteredMeetings = useMemo(() => meetings.filter(m => `${m.title} ${m.meeting_type}`.toLowerCase().includes(search.toLowerCase())), [meetings, search]);
  const filteredDocs = useMemo(() => documents.filter(d => `${d.title} ${d.document_type} ${d.tags || ''}`.toLowerCase().includes(search.toLowerCase())), [documents, search]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Workflow size={21}/></span><span>context<span className="brand-light">flow</span><small>TEAM CONTEXT, CONNECTED</small></span><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list">{NAV.map(item=>{const Icon=item.icon;return <button key={item.id} className={`nav-item ${tab===item.id?'active':''}`} onClick={()=>{setTab(item.id);setMobileNav(false);setSearch('');}}><Icon size={18}/><span>{item.label}</span>{item.id==='tasks'&&<span className="nav-count">{dashboard?.metrics?.open_tasks ?? ''}</span>}</button>;})}</nav>
        <div className="sidebar-bottom"><div className="workspace-card"><div className="workspace-symbol">CF</div><div><b>Product team</b><span>Demo workspace</span></div><span className="online-dot"/></div><div className="sidebar-footer"><span className="avatar avatar-purple">AD</span><div><b>Ananya Desai</b><span>Project Manager</span></div><span className="more-dot">•••</span></div></div>
      </aside>
      {mobileNav&&<button className="nav-scrim" onClick={()=>setMobileNav(false)} aria-label="Close menu"/>}
      <main className="main-area">
        <header className="topbar"><div className="top-left"><button className="mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <ChevronRight size={14}/><b>{NAV.find(n=>n.id===tab)?.label}</b></div></div><div className="top-actions"><span className={`ai-mode ${health?.aiProvider==='gemini'?'live':'demo'}`}><span/>AI {health?.aiProvider==='gemini'?'Gemini enabled':'demo mode'}</span><button className="icon-button" onClick={loadAll} title="Refresh"><RefreshCw size={17}/></button><div className="top-avatar">AD</div></div></header>
        <div className="page-content">
          {loading&&<div className="loading-bar"><span/></div>}
          {tab==='overview'&&<Overview dashboard={dashboard} tasks={tasks} meetings={meetings} onGo={setTab} onOpenMeeting={openMeeting} />}
          {tab==='meetings'&&<MeetingsPage meetings={filteredMeetings} users={users} showForm={showMeetingForm} setShowForm={setShowMeetingForm} onCreate={createMeeting} onOpen={openMeeting} onExtract={runExtraction} busy={busy} detail={meetingDetail} onCloseDetail={()=>{setMeetingDetail(null);setAiResult(null);}} aiResult={aiResult} selectedDecisions={selectedDecisions} setSelectedDecisions={setSelectedDecisions} selectedActions={selectedActions} setSelectedActions={setSelectedActions} onReview={reviewAI} />}
          {tab==='tasks'&&<TasksPage tasks={filteredTasks} meetings={meetings} users={users} search={search} setSearch={setSearch} showForm={showTaskForm} setShowForm={setShowTaskForm} onCreate={createTask} onStatus={updateTaskStatus} onOwner={updateTaskOwner} onOutcome={recordOutcome} onCarry={carryTask} onRecommend={getRecommendations} recommendations={recommendations} onLink={linkDocument} />}
          {tab==='knowledge'&&<KnowledgePage documents={filteredDocs} search={search} setSearch={setSearch} showForm={showDocumentForm} setShowForm={setShowDocumentForm} onCreate={createDocument}/>} 
          {tab==='transfer'&&<Transfer users={users} notify={notify}/>}
          {tab==='handover'&&<HandoverPage users={users} selectedUser={handoverUser} setSelectedUser={setHandoverUser} onGenerate={generateHandover} result={handover} busy={busy}/>} 
        </div>
        <footer className="page-footer"><span>ContextFlow <span className="footer-dot">•</span> Built for continuity</span><span>AI-assisted. Human-approved.</span></footer>
      </main>
      {notice&&<div className={`toast toast-${notice.type}`}><span>{notice.type==='error'?<CircleAlert size={17}/>:<CheckCircle2 size={17}/>}</span>{notice.message}<button onClick={()=>setNotice(null)}><X size={15}/></button></div>}
    </div>
  );
}

function Overview({dashboard,tasks,meetings,onGo,onOpenMeeting}){
  const metrics=dashboard?.metrics||{};
  return <>
    <div className="welcome-row"><div><div className="eyebrow">FRIDAY, OCTOBER 30, 2026</div><h1>Good afternoon, Ananya <span>✦</span></h1><p>Here's what's happening across your team's work.</p></div><button className="button button-primary" onClick={()=>onGo('meetings')}><Plus size={17}/> New meeting</button></div>
    <div className="hero-strip"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14}/> YOUR TEAM'S SHARED MEMORY</span><h2>Keep the work moving.<br/><em>Keep the context.</em></h2><p>Meetings, decisions and action items connected in one place.</p><button className="hero-link" onClick={()=>onGo('handover')}>Create a handover brief <ArrowRight size={15}/></button></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card art-card-a"><CalendarDays size={15}/><span>Meeting notes</span><b>Captured</b></div><div className="art-card art-card-b"><CheckCircle2 size={15}/><span>Action item</span><b>In progress</b></div><div className="art-core"><Workflow size={32}/></div><div className="art-tag">✦ Context connected</div></div></div>
    <div className="metric-grid">
      <Metric icon={Users} label="Team members" value={metrics.users??'—'} detail="Active collaborators" tone="blue" trend="Users" />
      <Metric icon={CalendarDays} label="Meetings captured" value={metrics.meetings??'—'} detail="Meetings & handovers" tone="violet" trend="Meetings" />
      <Metric icon={ListTodo} label="Open action items" value={metrics.open_tasks??'—'} detail="Need attention" tone="amber" trend="Tasks" />
      <Metric icon={CircleAlert} label="Overdue items" value={metrics.overdue_tasks??'—'} detail="Past due date" tone="rose" trend="Review" />
    </div>
    <div className="content-grid overview-grid"><section className="panel"><div className="panel-head"><div><h3>Priority action items</h3><p>Tasks that need your team's attention</p></div><button className="text-button" onClick={()=>onGo('tasks')}>View all <ArrowRight size={14}/></button></div>{(dashboard?.priority_tasks||[]).length? <div className="task-list">{dashboard.priority_tasks.map(t=><div className="task-row" key={t.id}><span className="task-check"><Check size={13}/></span><div className="task-main"><b>{t.title}</b><span>{t.owner_name||'Unassigned'} <i>·</i> Due {dateLabel(t.due_date)}</span></div><Priority value={t.priority}/><Status value={t.status}/></div>)}</div>:<Empty icon={ListTodo} title="No open tasks" text="Create an action item from a meeting to get started."/>}</section><section className="panel"><div className="panel-head"><div><h3>Recent meetings</h3><p>Latest team conversations</p></div><button className="text-button" onClick={()=>onGo('meetings')}>View all <ArrowRight size={14}/></button></div>{meetings.slice(0,4).map(m=><button className="meeting-mini" key={m.id} onClick={()=>onOpenMeeting(m.id)}><span className="meeting-date"><b>{new Date(m.scheduled_at||Date.now()).getDate()}</b><small>{new Date(m.scheduled_at||Date.now()).toLocaleString('en-IN',{month:'short'})}</small></span><span className="meeting-mini-main"><b>{m.title}</b><span>{m.facilitator_name||'Team'} <i>·</i> {m.participants_count} participants</span></span><ChevronRight size={16}/></button>)}</section></div>
  </>;
}
function Metric({icon:Icon,label,value,detail,tone,trend}){return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18}/></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>}

function MeetingsPage({meetings,users,showForm,setShowForm,onCreate,onOpen,onExtract,busy,detail,onCloseDetail,aiResult,selectedDecisions,setSelectedDecisions,selectedActions,setSelectedActions,onReview}){
  return <>
    <SectionHeading eyebrow="TEAM CONVERSATIONS" title="Meetings & handovers" subtitle="Capture what was discussed, decided and assigned." action={<button className="button button-primary" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/> New meeting</button>}/>
    {showForm&&<form className="panel form-panel" onSubmit={onCreate}><div className="form-title"><div><h3>Create a meeting</h3><p>Capture the meeting context at the source.</p></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)}><X size={17}/></button></div><div className="form-grid"><Field label="Meeting title"><input name="title" required minLength="3" placeholder="e.g. Sprint planning"/></Field><Field label="Type"><select name="meeting_type"><option value="meeting">Meeting</option><option value="work_transfer">Work transfer</option></select></Field><Field label="Scheduled date & time"><input type="datetime-local" name="scheduled_at"/></Field><Field label="Facilitator"><select name="facilitator_id">{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field><Field label="Agenda"><textarea name="agenda" rows="2" placeholder="What should the team discuss?"/></Field><Field label="Initial meeting notes"><textarea name="initial_note" rows="3" placeholder="Paste raw notes or discussion points here..."/></Field></div><div className="participant-picker"><b>Participants</b><div className="checks">{users.map(u=><label key={u.id}><input type="checkbox" name="participants" value={u.id}/><span>{u.full_name}</span></label>)}</div></div><div className="form-actions"><button type="button" className="button button-quiet" onClick={()=>setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Create meeting</button></div></form>}
    <div className="toolbar"><div className="toolbar-note">{meetings.length} meetings captured</div></div>
    {detail&&<div className="panel meeting-detail"><div className="panel-head"><div><div className="eyebrow">MEETING #{detail.id}</div><h3>{detail.title}</h3><p>{detail.meeting_type.replace('_',' ')} · {dateLabel(detail.scheduled_at)} · Facilitated by {detail.facilitator_name||'—'}</p></div><button className="icon-button" onClick={onCloseDetail}><X size={18}/></button></div><p className="detail-agenda">{detail.agenda||'No agenda provided.'}</p><div className="detail-cols"><div><h4>Participants</h4>{detail.participants.map(p=><div className="person-line" key={p.user_id}><span className="avatar">{initials(p.full_name)}</span><span><b>{p.full_name}</b><small>{p.participant_role||p.role||'Participant'} · {p.attendance_status}</small></span></div>)}</div><div><h4>Original notes</h4>{detail.notes.map(n=><div className="note-block" key={n.id}>{n.content}</div>)}</div></div><div className="detail-actions"><button className="button button-primary" onClick={()=>onExtract(detail.id)} disabled={busy}><Sparkles size={16}/>{busy?'Analyzing…':'Extract with AI'}</button><span className="muted-hint">Original notes remain unchanged.</span></div>
      {aiResult&&<div className="ai-review"><div className="ai-review-head"><div><span className="ai-label"><Sparkles size={14}/> AI EXTRACTION</span><h3>Review suggested information</h3><p>Provider: {aiResult.provider} · {aiResult.latency_ms} ms · Pending human approval</p></div><Status value="pending"/></div><div className="ai-summary"><b>Meeting summary</b><p>{aiResult.data.summary}</p><b>Key points</b><ul>{aiResult.data.key_points.map((x,i)=><li key={i}>{x}</li>)}</ul></div><div className="review-section"><h4>Decisions ({aiResult.data.decisions.length})</h4>{aiResult.data.decisions.map((d,i)=><label className="review-item" key={i}><input type="checkbox" checked={selectedDecisions.includes(i)} onChange={e=>setSelectedDecisions(p=>e.target.checked?[...p,i]:p.filter(x=>x!==i))}/><span><b>{d.decision_text}</b><small>{d.rationale}</small></span></label>)}</div><div className="review-section"><h4>Action items ({aiResult.data.action_items.length})</h4>{aiResult.data.action_items.map((a,i)=><label className="review-item" key={i}><input type="checkbox" checked={selectedActions.includes(i)} onChange={e=>setSelectedActions(p=>e.target.checked?[...p,i]:p.filter(x=>x!==i))}/><span><b>{a.title}</b><small>{a.owner_name||'Owner not identified'} · {a.due_date||'No due date'} · {a.priority}</small><small>{a.description}</small></span></label>)}</div><div className="form-actions"><button className="button button-quiet" onClick={()=>onReview('rejected')} disabled={busy}>Reject all</button><button className="button button-primary" onClick={()=>onReview('approved')} disabled={busy||(!selectedDecisions.length&&!selectedActions.length)}><Check size={16}/> Approve selected ({selectedDecisions.length+selectedActions.length})</button></div></div>}
      {detail.decisions.length>0&&<div className="detail-bottom"><h4>Recorded decisions</h4>{detail.decisions.map(d=><div className="bullet-line" key={d.id}><CheckCircle2 size={15}/>{d.decision_text}</div>)}</div>}
    </div>}
    <div className="meeting-grid">{meetings.map(m=><button className={`meeting-card ${detail?.id===m.id?'selected':''}`} key={m.id} onClick={()=>onOpen(m.id)}><div className="meeting-card-top"><span className={`meeting-type ${m.meeting_type}`}>{m.meeting_type==='work_transfer'?'WORK TRANSFER':'TEAM MEETING'}</span><span className="meeting-card-date">{dateLabel(m.scheduled_at)}</span></div><h3>{m.title}</h3><p>{m.agenda||'No agenda recorded.'}</p><div className="meeting-card-foot"><div className="avatar-stack"><span className="avatar">{initials(m.facilitator_name||'Team')}</span><small>{m.participants_count||0} participants</small></div><span className="card-task-count"><ListTodo size={14}/>{m.action_items_count||0} tasks <ChevronRight size={15}/></span></div></button>)}</div>
    {!meetings.length&&<Empty icon={CalendarDays} title="No meetings found" text="Create the first meeting to start capturing team context."/>}
  </>;
}

function TasksPage({tasks,meetings,users,search,setSearch,showForm,setShowForm,onCreate,onStatus,onOwner,onOutcome,onCarry,onRecommend,recommendations,onLink}){
  return <>
    <SectionHeading eyebrow="WORK TRACKING" title="Action items" subtitle="Owners, deadlines and task history stay connected across meetings." action={<button className="button button-primary" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/> New action item</button>}/>
    {showForm&&<form className="panel form-panel" onSubmit={onCreate}><div className="form-title"><div><h3>Create action item</h3><p>Assign a clear owner and due date.</p></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)}><X size={17}/></button></div><div className="form-grid"><Field label="Task title"><input name="title" required minLength="3" placeholder="What needs to be done?"/></Field><Field label="Source meeting"><select name="meeting_id" required>{meetings.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field><Field label="Owner"><select name="owner_id"><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field><Field label="Due date"><input name="due_date" type="date"/></Field><Field label="Priority"><select name="priority"><option>medium</option><option>low</option><option>high</option><option>urgent</option></select></Field><Field label="Description"><textarea name="description" rows="2" placeholder="Add task context..."/></Field></div><div className="form-actions"><button type="button" className="button button-quiet" onClick={()=>setShowForm(false)}>Cancel</button><button className="button button-primary">Create task</button></div></form>}
    <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tasks, owners or status"/></div><span className="toolbar-note">{tasks.length} action items</span></div>
    <div className="panel table-panel"><div className="table-head"><span>Task / source meeting</span><span>Owner</span><span>Priority</span><span>Due date</span><span>Status</span><span>Actions</span></div>{tasks.map(t=><div className="task-table-row" key={t.id}><div className="task-title-cell"><b>{t.title}</b><small>{t.current_meeting_title} <span>·</span> #{t.id}</small>{t.carry_forward_count>0&&<small className="carry-tag"><ArrowDownRight size={12}/> Carried forward {t.carry_forward_count}×</small>}</div><div className="owner-cell"><select className="mini-select owner-select" value={t.owner_id||''} onChange={e=>onOwner(t,e.target.value)} disabled={['completed','cancelled'].includes(t.status)} title="Reassign task owner"><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div><div><Priority value={t.priority}/></div><div className="date-cell">{dateLabel(t.due_date)}</div><div><select className="status-select" value={t.status} onChange={e=>onStatus(t,e.target.value)} disabled={['completed','cancelled'].includes(t.status)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div><div className="row-actions"><select title="Carry forward to meeting" className="mini-select" defaultValue="" onChange={e=>{onCarry(t,e.target.value);e.target.value='';}} disabled={['completed','cancelled'].includes(t.status)}><option value="">Carry to…</option>{meetings.filter(m=>m.id!==t.current_meeting_id).map(m=><option value={m.id} key={m.id}>{m.title.slice(0,24)}</option>)}</select><button className="icon-button small" title={t.outcome||'Record task outcome'} onClick={()=>onOutcome(t)}><ClipboardList size={15}/></button><button className="icon-button small" title="Find relevant knowledge" onClick={()=>onRecommend(t)}><BookOpen size={15}/></button></div>{recommendations[t.id]&&<div className="recommend-row"><b><Sparkles size={14}/> Relevant knowledge suggestions</b>{recommendations[t.id].length?recommendations[t.id].map(r=><div className="recommend-item" key={r.document_id}><span><b>{r.document?.title||`Document #${r.document_id}`}</b><small>{r.reason}</small></span><button className="button button-outline button-xs" onClick={()=>onLink(r.document_id,t.id,r.reason)}><Link2 size={13}/> Link</button></div>):<small>No related documents found. Add more context to the knowledge base.</small>}</div>}</div>)}</div>
    {!tasks.length&&<Empty icon={ListTodo} title="No action items" text="Create a task or extract action items from meeting notes."/>}
  </>;
}

function KnowledgePage({documents,search,setSearch,showForm,setShowForm,onCreate}){
  return <>
    <SectionHeading eyebrow="TEAM MEMORY" title="Knowledge base" subtitle="Keep policies, guides and project references connected to the work." action={<button className="button button-primary" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/> Add document</button>}/>
    {showForm&&<form className="panel form-panel" onSubmit={onCreate}><div className="form-title"><div><h3>Add knowledge document</h3><p>Store a guide or reference the team can reuse.</p></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)}><X size={17}/></button></div><div className="form-grid"><Field label="Document title"><input name="title" required minLength="3" placeholder="e.g. API integration guide"/></Field><Field label="Document type"><select name="document_type"><option value="document">Document</option><option value="policy">Policy</option><option value="guide">Guide</option><option value="reference">Reference</option><option value="other">Other</option></select></Field><Field label="Tags"><input name="tags" placeholder="API, onboarding, security"/></Field><Field label="Content"><textarea name="content" required minLength="10" rows="5" placeholder="Paste document content or key guidance..."/></Field></div><div className="form-actions"><button type="button" className="button button-quiet" onClick={()=>setShowForm(false)}>Cancel</button><button className="button button-primary">Save document</button></div></form>}
    <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search documents and tags"/></div><span className="toolbar-note">{documents.length} resources</span></div>
    <div className="document-grid">{documents.map(doc=><article className="document-card" key={doc.id}><div className="doc-icon"><FileText size={20}/></div><div className="doc-type">{doc.document_type.replace('_',' ')}</div><h3>{doc.title}</h3><p>{doc.excerpt||doc.content}</p><div className="doc-tags">{(doc.tags||'team knowledge').split(',').slice(0,3).map(tag=><span key={tag}>{tag.trim()}</span>)}</div><div className="doc-foot"><span><FolderOpen size={14}/> Added {dateLabel(doc.created_at)}</span><span>#{doc.id}</span></div></article>)}</div>
    {!documents.length&&<Empty icon={BookOpen} title="Knowledge base is empty" text="Add team guides and internal references to support smarter handovers."/>}
    <div className="knowledge-hint"><Sparkles size={16}/><span><b>Context-aware suggestions</b> — open Action Items and use the book icon to ask AI to recommend relevant documents for a task.</span></div>
  </>;
}

function HandoverPage({users,selectedUser,setSelectedUser,onGenerate,result,busy}){
  return <>
    <SectionHeading eyebrow="SMART CONTEXT HANDOVER" title="Handover center" subtitle="Help an incoming teammate understand the work without chasing old conversations."/>
    <div className="handover-hero"><div className="handover-visual"><div className="handover-ring"><Workflow size={42}/></div><span className="handover-node node-one"><Users size={16}/></span><span className="handover-node node-two"><ClipboardList size={16}/></span><span className="handover-node node-three"><BookOpen size={16}/></span></div><div className="handover-copy"><span className="ai-label"><Sparkles size={14}/> CONTEXT-AWARE BRIEF</span><h2>Make the next person<br/>feel already up to speed.</h2><p>Bring together open tasks, prior meetings, decisions and linked knowledge into one personalized handover brief.</p><div className="handover-controls"><Field label="Prepare a brief for"><select value={selectedUser} onChange={e=>setSelectedUser(e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.full_name} — {u.role}</option>)}</select></Field><button className="button button-primary" disabled={busy||!users.length} onClick={onGenerate}><Sparkles size={16}/>{busy?'Preparing…':'Generate handover brief'}</button></div></div></div>
    {result&&<div className="panel handover-result"><div className="panel-head"><div><span className="ai-label"><Sparkles size={14}/> GENERATED HANDOVER</span><h3>{result.data.headline}</h3><p>Generated by {result.provider} · {result.latency_ms} ms</p></div><span className="generated-pill"><CheckCircle2 size={14}/> Ready</span></div><p className="handover-summary">{result.data.summary}</p><div className="brief-grid"><BriefSection title="Immediate priorities" items={result.data.immediate_priorities}/><BriefSection title="Recent context" items={result.data.recent_context}/><BriefSection title="Recommended next steps" items={result.data.recommended_next_steps}/><BriefSection title="Risks & unknowns" items={result.data.risks_or_unknowns}/></div><div className="source-counts">Built from {result.data.source_context.open_tasks} open tasks · {result.data.source_context.recent_meetings} meetings · {result.data.source_context.decisions} decisions · {result.data.source_context.knowledge_documents} linked documents</div></div>}
    <div className="handover-note"><Activity size={17}/><span><b>Special feature:</b> Smart Context Handover combines a teammate's assigned open work with relevant organizational history. It is designed to reduce context loss when responsibilities change.</span></div>
  </>;
}
function BriefSection({title,items}){return <div className="brief-section"><h4>{title}</h4>{items?.length?<ul>{items.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p className="muted-hint">No records found.</p>}</div>}
