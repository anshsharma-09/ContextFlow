const { pool } = require('../config/db');

async function getDashboard(req, res, next) {
  try {
    const [[users]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_active=1');
    const [[meetings]] = await pool.query('SELECT COUNT(*) AS total FROM meetings');
    const [[openTasks]] = await pool.query("SELECT COUNT(*) AS total FROM action_items WHERE status IN ('open','in_progress','blocked')");
    const [[overdue]] = await pool.query("SELECT COUNT(*) AS total FROM action_items WHERE status NOT IN ('completed','cancelled') AND due_date < CURDATE()");
    const [recentMeetings] = await pool.query(`SELECT m.id,m.title,m.meeting_type,m.scheduled_at,m.status, u.full_name AS facilitator_name FROM meetings m LEFT JOIN users u ON u.id=m.facilitator_id ORDER BY m.scheduled_at DESC,m.id DESC LIMIT 5`);
    const [priorityTasks] = await pool.query(`SELECT a.id,a.title,a.status,a.priority,a.due_date,u.full_name AS owner_name FROM action_items a LEFT JOIN users u ON u.id=a.owner_id WHERE a.status NOT IN ('completed','cancelled') ORDER BY FIELD(a.priority,'urgent','high','medium','low'),a.due_date IS NULL,a.due_date LIMIT 6`);
    res.json({ success: true, data: { metrics: { users: users.total, meetings: meetings.total, open_tasks: openTasks.total, overdue_tasks: overdue.total }, recent_meetings: recentMeetings, priority_tasks: priorityTasks } });
  } catch (error) { next(error); }
}
module.exports = { getDashboard };
