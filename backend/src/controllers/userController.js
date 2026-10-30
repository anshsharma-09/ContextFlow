const { z } = require('zod');
const { pool } = require('../config/db');

const userSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(191),
  role: z.string().trim().max(100).optional().nullable(),
  team: z.string().trim().max(100).optional().nullable()
});

async function listUsers(req, res, next) {
  try {
    const [rows] = await pool.execute('SELECT id,full_name,email,role,team,is_active,created_at FROM users WHERE is_active=1 ORDER BY full_name');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) { next(error); }
}

async function createUser(req, res, next) {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid user information', errors: parsed.error.issues });
  try {
    const { full_name, email, role = null, team = null } = parsed.data;
    const [result] = await pool.execute('INSERT INTO users (full_name,email,role,team) VALUES (?,?,?,?)', [full_name,email,role,team]);
    req.log.info({ userId: result.insertId }, 'Team member created');
    res.status(201).json({ success: true, data: { id: result.insertId, ...parsed.data } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email already exists' });
    next(error);
  }
}

module.exports = { listUsers, createUser };
