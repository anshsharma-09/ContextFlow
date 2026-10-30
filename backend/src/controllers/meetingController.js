const { z } = require('zod');
const { pool } = require('../config/db');

const meetingSchema = z.object({
  title: z.string().trim().min(3).max(200),
  meeting_type: z.enum(['meeting','work_transfer']).default('meeting'),
  agenda: z.string().max(10000).optional().nullable(),
  scheduled_at: z.string().optional().nullable(),
  status: z.enum(['draft','scheduled','completed','cancelled']).default('scheduled'),
  facilitator_id: z.number().int().positive().optional().nullable(),
  created_by: z.number().int().positive().default(1),
  participants: z.array(z.object({ user_id: z.number().int().positive(), participant_role: z.string().max(80).optional().nullable(), attendance_status: z.enum(['invited','attended','absent']).default('invited') })).default([]),
  initial_note: z.string().trim().max(50000).optional().nullable()
});

async function listMeetings(req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT m.id,m.title,m.meeting_type,m.agenda,m.scheduled_at,m.status,m.created_at,u.full_name AS facilitator_name,(SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id=m.id) AS participants_count,(SELECT COUNT(*) FROM action_items ai WHERE ai.current_meeting_id=m.id AND ai.status NOT IN ('cancelled')) AS action_items_count FROM meetings m LEFT JOIN users u ON u.id=m.facilitator_id ORDER BY m.scheduled_at DESC,m.id DESC`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) { next(error); }
}

async function getMeeting(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, message: 'Invalid meeting ID' });
  try {
    const [meetings] = await pool.execute(`SELECT m.*,f.full_name AS facilitator_name,c.full_name AS creator_name FROM meetings m LEFT JOIN users f ON f.id=m.facilitator_id LEFT JOIN users c ON c.id=m.created_by WHERE m.id=?`, [id]);
    if (!meetings.length) return res.status(404).json({ success: false, message: 'Meeting not found' });
    const [participants] = await pool.execute(`SELECT u.id AS user_id,u.full_name,u.email,u.role,mp.participant_role,mp.attendance_status FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=? ORDER BY u.full_name`, [id]);
    const [notes] = await pool.execute('SELECT id,note_type,content,created_by,created_at FROM meeting_notes WHERE meeting_id=? ORDER BY created_at DESC,id DESC', [id]);
    const [decisions] = await pool.execute('SELECT d.id,d.decision_text,d.rationale,d.decision_date,u.full_name AS decided_by_name FROM decisions d LEFT JOIN users u ON u.id=d.decided_by WHERE d.meeting_id=? ORDER BY d.decision_date DESC', [id]);
    const [actions] = await pool.execute(`SELECT a.id,a.source_meeting_id,a.current_meeting_id,a.title,a.description,a.owner_id,u.full_name AS owner_name,a.due_date,a.priority,a.status,a.outcome,a.carry_forward_count FROM action_items a LEFT JOIN users u ON u.id=a.owner_id WHERE a.current_meeting_id=? ORDER BY a.due_date IS NULL,a.due_date`, [id]);
    res.json({ success: true, data: { ...meetings[0], participants, notes, decisions, action_items: actions } });
  } catch (error) { next(error); }
}

async function createMeeting(req, res, next) {
  const parsed = meetingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid meeting data', errors: parsed.error.issues });
  const data = parsed.data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let scheduledAt = null;
    if (data.scheduled_at) {
      const date = new Date(data.scheduled_at);
      if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid scheduled_at date'), { status: 400 });
      scheduledAt = date.toISOString().slice(0,19).replace('T',' ');
    }
    const [result] = await connection.execute('INSERT INTO meetings (title,meeting_type,agenda,scheduled_at,status,facilitator_id,created_by) VALUES (?,?,?,?,?,?,?)', [data.title,data.meeting_type,data.agenda || null,scheduledAt,data.status,data.facilitator_id || null,data.created_by]);
    const meetingId = result.insertId;
    for (const p of data.participants) {
      await connection.execute('INSERT INTO meeting_participants (meeting_id,user_id,attendance_status,participant_role) VALUES (?,?,?,?)', [meetingId,p.user_id,p.attendance_status,p.participant_role || null]);
    }
    if (data.initial_note) await connection.execute("INSERT INTO meeting_notes (meeting_id,note_type,content,created_by) VALUES (?,'discussion',?,?)", [meetingId,data.initial_note,data.created_by]);
    await connection.commit();
    req.log.info({ meetingId, participantCount: data.participants.length }, 'Meeting created');
    res.status(201).json({ success: true, message: 'Meeting created', data: { id: meetingId, title: data.title } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Duplicate participant in meeting' });
    if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, message: 'Referenced user does not exist' });
    next(error);
  } finally { connection.release(); }
}

async function addMeetingNote(req, res, next) {
  const id = Number(req.params.id);
  const parsed = z.object({ content: z.string().trim().min(5).max(50000), created_by: z.number().int().positive().default(1), note_type: z.enum(['agenda','discussion','transcript','summary','other']).default('discussion') }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success:false,message:'Invalid meeting ID' });
  if (!parsed.success) return res.status(400).json({ success:false,message:'Invalid note',errors:parsed.error.issues });
  try {
    const [result] = await pool.execute('INSERT INTO meeting_notes (meeting_id,note_type,content,created_by) VALUES (?,?,?,?)', [id,parsed.data.note_type,parsed.data.content,parsed.data.created_by]);
    req.log.info({ meetingId:id,noteId:result.insertId }, 'Meeting note added');
    res.status(201).json({ success:true,data:{ id:result.insertId,meeting_id:id } });
  } catch (error) { if (error.code==='ER_NO_REFERENCED_ROW_2') return res.status(404).json({success:false,message:'Meeting or user not found'}); next(error); }
}

module.exports = { listMeetings, getMeeting, createMeeting, addMeetingNote };
