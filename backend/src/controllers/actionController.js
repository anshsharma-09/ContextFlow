const { z } = require('zod');
const { pool } = require('../config/db');

const statuses = ['open','in_progress','blocked','completed','cancelled'];
const priorities = ['low','medium','high','urgent'];
const idSchema = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

async function listActions(req, res, next) {
  try {
    const where = [];
    const params = [];
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) return res.status(400).json({ success:false,message:'Invalid status filter' });
      where.push('a.status=?'); params.push(req.query.status);
    }
    if (req.query.owner_id) {
      if (!idSchema(req.query.owner_id)) return res.status(400).json({success:false,message:'Invalid owner ID'});
      where.push('a.owner_id=?'); params.push(Number(req.query.owner_id));
    }
    if (req.query.meeting_id) {
      if (!idSchema(req.query.meeting_id)) return res.status(400).json({success:false,message:'Invalid meeting ID'});
      where.push('a.current_meeting_id=?'); params.push(Number(req.query.meeting_id));
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.execute(`SELECT a.*,m.title AS current_meeting_title,s.title AS source_meeting_title,u.full_name AS owner_name,creator.full_name AS creator_name FROM action_items a JOIN meetings m ON m.id=a.current_meeting_id JOIN meetings s ON s.id=a.source_meeting_id LEFT JOIN users u ON u.id=a.owner_id JOIN users creator ON creator.id=a.created_by ${clause} ORDER BY FIELD(a.status,'blocked','in_progress','open','completed','cancelled'),FIELD(a.priority,'urgent','high','medium','low'),a.due_date IS NULL,a.due_date`, params);
    res.json({ success:true,count:rows.length,data:rows });
  } catch (error) { next(error); }
}

async function getAction(req, res, next) {
  const id = Number(req.params.id);
  if (!idSchema(id)) return res.status(400).json({success:false,message:'Invalid action item ID'});
  try {
    const [tasks] = await pool.execute(`SELECT a.*,m.title AS current_meeting_title,s.title AS source_meeting_title,u.full_name AS owner_name,c.full_name AS creator_name FROM action_items a JOIN meetings m ON m.id=a.current_meeting_id JOIN meetings s ON s.id=a.source_meeting_id LEFT JOIN users u ON u.id=a.owner_id JOIN users c ON c.id=a.created_by WHERE a.id=?`, [id]);
    if (!tasks.length) return res.status(404).json({success:false,message:'Action item not found'});
    const [history] = await pool.execute(`SELECT h.*,actor.full_name AS actor_name,oldOwner.full_name AS previous_owner_name,newOwner.full_name AS new_owner_name,f.title AS from_meeting_title,t.title AS to_meeting_title FROM action_history h LEFT JOIN users actor ON actor.id=h.actor_id LEFT JOIN users oldOwner ON oldOwner.id=h.previous_owner_id LEFT JOIN users newOwner ON newOwner.id=h.new_owner_id LEFT JOIN meetings f ON f.id=h.from_meeting_id LEFT JOIN meetings t ON t.id=h.to_meeting_id WHERE h.action_item_id=? ORDER BY h.created_at DESC,h.id DESC`, [id]);
    res.json({success:true,data:{...tasks[0],history}});
  } catch(error) { next(error); }
}

async function createAction(req, res, next) {
  const schema = z.object({
    source_meeting_id:z.number().int().positive(),
    current_meeting_id:z.number().int().positive().optional(),
    title:z.string().trim().min(3).max(255),
    description:z.string().max(10000).optional().nullable(),
    owner_id:z.number().int().positive().optional().nullable(),
    created_by:z.number().int().positive().default(1),
    due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    priority:z.enum(priorities).default('medium')
  }).safeParse(req.body);
  if (!schema.success) return res.status(400).json({success:false,message:'Invalid task data',errors:schema.error.issues});
  const d=schema.data, connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current=d.current_meeting_id || d.source_meeting_id;
    const [result]=await connection.execute("INSERT INTO action_items (source_meeting_id,current_meeting_id,title,description,owner_id,created_by,due_date,priority,status) VALUES (?,?,?,?,?,?,?,?,'open')",[d.source_meeting_id,current,d.title,d.description||null,d.owner_id||null,d.created_by,d.due_date||null,d.priority]);
    await connection.execute("INSERT INTO action_history (action_item_id,event_type,new_status,new_owner_id,from_meeting_id,actor_id,details) VALUES (?,'created','open',?,?,?,?)",[result.insertId,d.owner_id||null,current,d.created_by,'Action item created.']);
    await connection.commit();
    req.log.info({taskId:result.insertId,ownerId:d.owner_id||null},'Action item created');
    res.status(201).json({success:true,data:{id:result.insertId,...d,status:'open',current_meeting_id:current}});
  } catch(error) { await connection.rollback(); if(error.code==='ER_NO_REFERENCED_ROW_2') return res.status(400).json({success:false,message:'Meeting, owner or creator does not exist'}); next(error); }
  finally {connection.release();}
}

async function updateAction(req, res, next) {
  const id=Number(req.params.id);
  if(!idSchema(id)) return res.status(400).json({success:false,message:'Invalid task ID'});
  const schema=z.object({title:z.string().trim().min(3).max(255).optional(),description:z.string().max(10000).nullable().optional(),owner_id:z.number().int().positive().nullable().optional(),due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),priority:z.enum(priorities).optional(),status:z.enum(statuses).optional(),outcome:z.string().max(10000).nullable().optional(),actor_id:z.number().int().positive().default(1)}).refine(d=>Object.keys(d).some(k=>k!=='actor_id'),{message:'At least one field is required'}).safeParse(req.body);
  if(!schema.success) return res.status(400).json({success:false,message:'Invalid task update',errors:schema.error.issues});
  const d=schema.data, connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.execute('SELECT * FROM action_items WHERE id=? FOR UPDATE',[id]);
    if(!rows.length){await connection.rollback();return res.status(404).json({success:false,message:'Task not found'});}
    const old=rows[0];
    if(['completed','cancelled'].includes(old.status) && (d.status || d.owner_id!==undefined)) { await connection.rollback(); return res.status(409).json({success:false,message:'Reopen or create a new task before changing a closed task owner/status'}); }
    const fields=['title','description','owner_id','due_date','priority','status','outcome'].filter(k=>Object.hasOwn(d,k));
    if(fields.length){
      const sets=fields.map(k=>`${k}=?`); const vals=fields.map(k=>d[k]);
      if(d.status==='completed') sets.push('completed_at=CURRENT_TIMESTAMP');
      else if(d.status && d.status!=='completed') sets.push('completed_at=NULL');
      vals.push(id); await connection.execute(`UPDATE action_items SET ${sets.join(',')} WHERE id=?`,vals);
    }
    const actor=d.actor_id;
    if(Object.hasOwn(d,'owner_id') && d.owner_id!==old.owner_id){
      await connection.execute("INSERT INTO action_history (action_item_id,event_type,previous_owner_id,new_owner_id,actor_id,details) VALUES (?,'reassigned',?,?,?,?)",[id,old.owner_id,d.owner_id,actor,'Task owner changed.']);
      req.log.info({taskId:id,previousOwnerId:old.owner_id,newOwnerId:d.owner_id},'Action item reassigned');
    }
    if(d.status && d.status!==old.status){
      await connection.execute("INSERT INTO action_history (action_item_id,event_type,previous_status,new_status,actor_id,details) VALUES (?,'status_changed',?,?,?,?)",[id,old.status,d.status,actor,`Status changed from ${old.status} to ${d.status}.`]);
      if(d.status==='completed') req.log.info({taskId:id,actorId:actor},'Action item closed');
    }
    if(Object.hasOwn(d,'outcome') && d.outcome!==old.outcome && d.outcome){
      await connection.execute("INSERT INTO action_history (action_item_id,event_type,actor_id,details) VALUES (?,'outcome_recorded',?,?)",[id,actor,'Task outcome recorded.']);
    }
    await connection.commit();
    res.json({success:true,message:'Action item updated',task_id:id});
  } catch(error){await connection.rollback();if(error.code==='ER_NO_REFERENCED_ROW_2')return res.status(400).json({success:false,message:'Referenced owner does not exist'});next(error);}
  finally{connection.release();}
}

async function carryForward(req,res,next){
  const id=Number(req.params.id);
  const parsed=z.object({to_meeting_id:z.number().int().positive(),actor_id:z.number().int().positive().default(1),note:z.string().max(2000).optional().nullable()}).safeParse(req.body);
  if(!idSchema(id))return res.status(400).json({success:false,message:'Invalid task ID'});
  if(!parsed.success)return res.status(400).json({success:false,message:'Invalid carry-forward data',errors:parsed.error.issues});
  const d=parsed.data,connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.execute('SELECT * FROM action_items WHERE id=? FOR UPDATE',[id]);
    if(!rows.length){await connection.rollback();return res.status(404).json({success:false,message:'Task not found'});}
    const task=rows[0];
    if(['completed','cancelled'].includes(task.status)){await connection.rollback();return res.status(409).json({success:false,message:'Closed tasks cannot be carried forward'});}
    const [meetings]=await connection.execute('SELECT id FROM meetings WHERE id=?',[d.to_meeting_id]);
    if(!meetings.length){await connection.rollback();return res.status(404).json({success:false,message:'Destination meeting not found'});}
    if(Number(task.current_meeting_id)===d.to_meeting_id){await connection.rollback();return res.status(409).json({success:false,message:'Task is already in that meeting'});}
    await connection.execute("INSERT INTO action_history (action_item_id,event_type,previous_status,new_status,previous_owner_id,new_owner_id,from_meeting_id,to_meeting_id,actor_id,details) VALUES (?,'carried_forward',?,?,?,?,?,?,?,?)",[id,task.status,task.status,task.owner_id,task.owner_id,task.current_meeting_id,d.to_meeting_id,d.actor_id,d.note||'Carried forward; original task identity retained.']);
    await connection.execute('UPDATE action_items SET current_meeting_id=?,carry_forward_count=carry_forward_count+1 WHERE id=?',[d.to_meeting_id,id]);
    await connection.commit();
    req.log.info({taskId:id,fromMeetingId:task.current_meeting_id,toMeetingId:d.to_meeting_id},'Action item carried forward');
    res.json({success:true,message:'Task carried forward without duplication',data:{action_item_id:id,from_meeting_id:task.current_meeting_id,to_meeting_id:d.to_meeting_id,original_task_preserved:true}});
  }catch(error){await connection.rollback();next(error);}finally{connection.release();}
}

module.exports={listActions,getAction,createAction,updateAction,carryForward};
