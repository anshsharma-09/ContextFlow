function tryParseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('Gemini returned content that was not valid JSON.'); }
}

function demoMeetingExtraction({ notes, participants }) {
  const sentences = String(notes).split(/(?<=[.!?])\s+/).filter(Boolean);
  const names = participants.map(p => p.full_name);
  const decisions = sentences
    .filter(s => /\b(agreed|decided|approved|selected|will use)\b/i.test(s))
    .map(s => ({ decision_text: s.trim(), rationale: 'Demo-mode extraction from an explicit decision phrase in the source notes.' }));
  const actionSentences = sentences.filter(s => /\b(will|must|needs? to|to complete|assigned to)\b/i.test(s));
  const action_items = actionSentences.slice(0, 8).map(sentence => {
    const owner = names.find(name => sentence.toLowerCase().includes(name.toLowerCase()))
      || names.find(name => sentence.toLowerCase().includes(name.split(' ')[0].toLowerCase()))
      || '';
    const dateMatch = sentence.match(/\b(?:by|before|on)\s+([A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/);
    let due_date = '';
    if (dateMatch) {
      const parsed = new Date(`${dateMatch[1]} ${dateMatch[1].includes(',') ? '' : new Date().getFullYear()}`);
      if (!Number.isNaN(parsed.getTime())) due_date = parsed.toISOString().slice(0, 10);
    }
    return {
      title: sentence.trim().slice(0, 180),
      description: sentence.trim(),
      owner_name: owner,
      due_date,
      priority: /urgent|critical|immediately/i.test(sentence) ? 'urgent' : 'medium'
    };
  });
  return {
    summary: `Demo-mode recap based on ${sentences.length} sentence(s) in the original notes. Configure Gemini to use live AI analysis.`,
    key_points: sentences.slice(0, 5).map(s => s.trim()),
    decisions,
    action_items
  };
}

function demoHandoverBrief(context) {
  const openTasks = context.open_tasks || [];
  const recentMeetings = context.recent_meetings || [];
  return {
    headline: `Handover brief for ${context.user.full_name}`,
    summary: `There are ${openTasks.length} open or active task(s) currently assigned to ${context.user.full_name}. Review the latest team meetings, decisions and linked knowledge before taking action. This brief was assembled in clearly labelled demo mode.`,
    immediate_priorities: openTasks.slice(0, 5).map(task => `${task.title} (${task.status}; due ${task.due_date || 'not specified'})`),
    recent_context: recentMeetings.map(m => `${m.title}: ${m.agenda || 'No agenda recorded'}`),
    recommended_next_steps: [
      'Review each assigned task and confirm its current status with the owner or facilitator.',
      'Read the linked knowledge documents before changing implementation decisions.',
      'Record progress and outcomes in ContextFlow so the next handover retains the history.'
    ],
    risks_or_unknowns: openTasks.filter(t => !t.due_date || !t.description).map(t => `Confirm missing details for: ${t.title}`)
  };
}

async function callGeminiJson(prompt, schemaDescription = 'Return valid JSON only.') {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured. Set AI_PROVIDER=demo or add a Gemini API key.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 60000);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${schemaDescription}` }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message || `Gemini HTTP ${response.status}`);
        error.status = response.status;
        if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
        lastError = error;
      } else {
        const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
        if (!text) throw new Error('Gemini returned no text. Check safety filters and model availability.');
        return { output: tryParseJson(text), provider: 'Google Gemini', model };
      }
    } catch (error) {
      lastError = error;
      if (error.status && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200 * (2 ** attempt)));
  }
  throw lastError || new Error('Gemini request failed after retries.');
}

async function extractMeeting({ meeting, notes, participants }) {
  const provider = (process.env.AI_PROVIDER || 'demo').toLowerCase();
  if (provider !== 'gemini') {
    return { output: demoMeetingExtraction({ notes, participants }), provider: 'Demo fallback', model: 'demo-extractor' };
  }
  const prompt = `You are ContextFlow, a meeting analysis assistant. Analyze the original meeting record. Never invent facts, decisions, owners, dates or commitments. Match owners only to supplied participants; return the participant's exact full_name value. If unclear use an empty string. Use empty due_date when no exact date is present. Separate firm decisions from action items. Keep output concise.\nMEETING: ${meeting.title}\nAGENDA: ${meeting.agenda || 'Not provided'}\nPARTICIPANTS: ${JSON.stringify(participants)}\nRAW NOTES:\n${notes}\nReturn this JSON shape: {"summary":"string","key_points":["string"],"decisions":[{"decision_text":"string","rationale":"string"}],"action_items":[{"title":"string","description":"string","owner_name":"string","due_date":"YYYY-MM-DD or empty string","priority":"low|medium|high|urgent"}]}`;
  return callGeminiJson(prompt, 'Return a single JSON object with the exact fields shown in the requested shape.');
}

async function generateHandover(context) {
  const provider = (process.env.AI_PROVIDER || 'demo').toLowerCase();
  if (provider !== 'gemini') return { output: demoHandoverBrief(context), provider: 'Demo fallback', model: 'demo-handover' };
  const prompt = `Create a personalized, concise work handover brief for ${context.user.full_name} (${context.user.role || 'team member'}). Use ONLY the supplied records. Do not invent dates, commitments or decisions. Call out missing information as unknown. Return JSON with keys headline, summary, immediate_priorities (array of strings), recent_context (array of strings), recommended_next_steps (array of strings), risks_or_unknowns (array of strings). CONTEXT: ${JSON.stringify(context)}`;
  return callGeminiJson(prompt, 'Return valid JSON with the exact keys specified.');
}

async function recommendKnowledge({ task, documents }) {
  const provider = (process.env.AI_PROVIDER || 'demo').toLowerCase();
  if (provider !== 'gemini') {
    const terms = `${task.title} ${task.description || ''}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const ranked = documents.map(doc => {
      const text = `${doc.title} ${doc.content} ${doc.tags || ''}`.toLowerCase();
      const score = terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
      return { document_id: doc.id, reason: 'Demo-mode keyword overlap; verify relevance before linking.', relevance_score: score };
    }).filter(x => x.relevance_score > 0).sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5);
    return { output: { recommendations: ranked }, provider: 'Demo keyword ranking', model: 'demo-ranker' };
  }
  const prompt = `Recommend up to five genuinely useful internal knowledge documents for this action item. Only use document IDs supplied. Do not invent IDs. Return JSON: {"recommendations":[{"document_id":1,"reason":"short reason","relevance_score":0.8}]}. Task: ${JSON.stringify(task)}. Documents: ${JSON.stringify(documents.map(d => ({ id: d.id, title: d.title, document_type: d.document_type, content: String(d.content).slice(0, 2500), tags: d.tags })))}`;
  return callGeminiJson(prompt, 'Return a JSON object with recommendations array; document_id is an integer and relevance_score is a number from 0 to 1.');
}


// ---------- Knowledge-transfer report ----------
function demoTransferReport(c) {
  const t = c.open_tasks || [];
  const docs = [...(c.input_documents || []), ...(c.related_documents || [])];
  const byType = type => (c.inputs || []).filter(i => i.input_type === type);
  const firstLine = x => String(x.content).split(/\n/)[0].slice(0, 220);
  return {
    executive_summary: `${c.outgoing.full_name} is handing over "${c.project_name}" to ${c.successor.full_name}. ${t.length} open task(s), ${(c.inputs || []).length} knowledge input(s) and ${(c.recent_meetings || []).length} recent meeting(s) were found. Rule-based summary: no AI model was used.`,
    project_overview: byType('project_info').map(i => `${i.title}: ${firstLine(i)}`).join(' ') || 'No project overview was supplied by the outgoing owner.',
    key_processes: byType('process').map(i => `${i.title}: ${firstLine(i)}`),
    key_decisions: [...byType('decision').map(i => ({ decision: i.title, rationale: firstLine(i) })), ...(c.decisions || []).map(d => ({ decision: d.decision_text, rationale: d.rationale || 'See meeting: ' + d.meeting_title }))],
    technical_notes: byType('technical_doc').map(i => `${i.title}: ${firstLine(i)}`),
    open_work: t.map(x => ({ task_id: x.id, title: x.title, status: x.status, what_successor_must_know: `Priority ${x.priority}, due ${x.due_date || 'not set'}, carried forward ${x.carry_forward_count} time(s). History events: ${(x.history || []).length}.` })),
    risks: [...t.filter(x => !x.due_date).map(x => `No due date on "${x.title}"`), ...t.filter(x => x.status === 'blocked').map(x => `"${x.title}" is blocked`)],
    onboarding_checklist: [...docs.slice(0, 8).map(d => ({ title: `Read: ${d.title}`, category: 'reading', document_id: d.id })), ...t.map(x => ({ title: `Review history of "${x.title}"`, category: 'tasks', document_id: null })), { title: `Meet ${c.outgoing.full_name} for a walkthrough`, category: 'people', document_id: null }],
    knowledge_gaps: ['Rule-based fallback cannot detect missing knowledge; the reviewer should check coverage.']
  };
}
async function generateTransferReport(context) {
  if ((process.env.AI_PROVIDER || 'demo').toLowerCase() !== 'gemini') return { output: demoTransferReport(context), provider: 'Demo fallback', model: 'demo-transfer' };
  const prompt = `You are ContextFlow. Write a knowledge-transfer handover report from ${context.outgoing.full_name} to ${context.successor.full_name} for project "${context.project_name}". Use ONLY the supplied records; never invent facts, dates, owners or decisions. List unknowns under knowledge_gaps. open_work.task_id must be an id from open_tasks; checklist document_id must be an id from documents or null. Return JSON: {"executive_summary":"","project_overview":"","key_processes":[""],"key_decisions":[{"decision":"","rationale":""}],"technical_notes":[""],"open_work":[{"task_id":1,"title":"","status":"","what_successor_must_know":""}],"risks":[""],"onboarding_checklist":[{"title":"","category":"reading|tasks|people|systems","document_id":null}],"knowledge_gaps":[""]}. CONTEXT: ${JSON.stringify(context)}`;
  return callGeminiJson(prompt, 'Return a single JSON object with exactly these keys.');
}

// ---------- Grounded Q&A ----------
function extractiveAnswer(chunks) {
  return { answer: 'Closest passages in the stored documentation:\n' + chunks.slice(0, 2).map(c => `- ${c.text.slice(0, 400)} [${c.title}]`).join('\n'), source_ids: [...new Set(chunks.slice(0, 2).map(c => c.document_id))], answerable: true };
}
async function answerFromDocs({ question, chunks }) {
  if ((process.env.AI_PROVIDER || 'demo').toLowerCase() !== 'gemini') return { output: extractiveAnswer(chunks), provider: 'Extractive (demo mode)', model: 'extractive' };
  const prompt = `Answer the question using ONLY the numbered sources. If they do not contain the answer set answerable=false and say so. Cite document_ids you used. Return JSON {"answer":"","source_ids":[1],"answerable":true}.\nQUESTION: ${question}\nSOURCES: ${JSON.stringify(chunks.map(c => ({ document_id: c.document_id, title: c.title, text: c.text })))}`;
  return callGeminiJson(prompt, 'Return a single JSON object with keys answer, source_ids, answerable.');
}

module.exports = { extractMeeting, generateHandover, recommendKnowledge, generateTransferReport, demoTransferReport, answerFromDocs, extractiveAnswer };
