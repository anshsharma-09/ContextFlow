const { z } = require('zod');
const { pool } = require('../config/db');
const logger = require('../utils/logger');
const { extractMeeting, generateHandover } = require('../services/aiService');

const extractionSchema = z.object({
  summary:z.string(),
  key_points:z.array(z.string()),
  decisions:z.array(z.object({decision_text:z.string().min(1),rationale:z.string()})),
  action_items:z.array(z.object({title:z.string().min(1),description:z.string(),owner_name:z.string(),due_date:z.string(),priority:z.enum(['low','medium','high','urgent'])}))
});
const reviewSchema = z.object({
  reviewed_by:z.number().int().positive(),
  decision:z.enum(['approved','rejected']),
  approved_decision_indices:z.array(z.number().int().nonnegative()).optional(),
  approved_action_item_indices:z.array(z.number().int().nonnegative()).optional()
});
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

async function extractMeetingNotes(req,res,next){
  const meetingId=Number(req.params.id),started=Date.now();
  if(!Number.isSafeInteger(meetingId)||meetingId<1)return res.status(400).json({success:false,message:'Invalid meeting ID'});
  let source='';
  try{
    const [[meeting]]=await pool.execute('SELECT id,title,agenda FROM meetings WHERE id=?',[meetingId]);
    if(!meeting)return res.status(404).json({success:false,message:'Meeting not found'});
    const [notes]=await pool.execute('SELECT content FROM meeting_notes WHERE meeting_id=? ORDER BY created_at,id',[meetingId]);
    if(!notes.length)return res.status(400).json({success:false,message:'This meeting has no notes to analyze'});
    const [participants]=await pool.execute('SELECT u.id,u.full_name,u.role FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=?',[meetingId]);
    source=notes.map(n=>n.content).join('\n\n');
    const requestedBy=req.body?.requested_by ? Number(req.body.requested_by) : null;
    if(requestedBy){const [[user]]=await pool.execute('SELECT id FROM users WHERE id=? AND is_active=1',[requestedBy]);if(!user)return res.status(400).json({success:false,message:'Requesting user not found'});}
    const result=await extractMeeting({meeting,notes:source,participants});
    const parsed=extractionSchema.safeParse(result.output);
    if(!parsed.success)throw new Error(`AI output validation failed: ${parsed.error.issues.map(i=>i.message).join('; ')}`);
    const latency=Date.now()-started;
    const [saved]=await pool.execute(`INSERT INTO ai_generations (request_id,generation_type,meeting_id,requested_by,provider_name,model_name,input_text,output_json,status,review_status,latency_ms) VALUES (?,'meeting_extraction',?,?,?,?,?,?,'succeeded','pending',?)`,[req.id,meetingId,requestedBy,result.provider,result.model,source,JSON.stringify(parsed.data),latency]);
    req.log.info({generationId:saved.insertId,meetingId,provider:result.provider,model:result.model,latencyMs:latency,outcome:'succeeded'},'AI meeting extraction completed');
    res.json({success:true,message:'Extraction complete. Review before saving decisions and tasks.',generation_id:saved.insertId,provider:result.provider,model:result.model,review_status:'pending',latency_ms:latency,data:parsed.data});
  }catch(error){
    const latency=Date.now()-started;
    try{await pool.execute(`INSERT INTO ai_generations (request_id,generation_type,meeting_id,requested_by,provider_name,model_name,input_text,status,review_status,latency_ms,error_message) VALUES (?,'meeting_extraction',?,?,'Google Gemini',?,?, 'failed','not_required',?,?)`,[req.id,meetingId,req.body?.requested_by||null,process.env.GEMINI_MODEL||null,source||null,latency,String(error.message).slice(0,2000)]);}catch(dbError){req.log.error({err:dbError},'Failed to persist AI failure record');}
    req.log.error({err:error,meetingId,latencyMs:latency,outcome:'failed'},'AI meeting extraction failed');
    res.status(502).json({success:false,message:'AI extraction failed. Original notes were preserved.',requestId:req.id,detail:process.env.NODE_ENV==='development'?error.message:undefined});
  }
}

async function reviewGeneration(req,res,next){
  const generationId=Number(req.params.id),parsed=reviewSchema.safeParse(req.body);
  if(!Number.isSafeInteger(generationId)||generationId<1)return res.status(400).json({success:false,message:'Invalid generation ID'});
  if(!parsed.success)return res.status(400).json({success:false,message:'Invalid review data',errors:parsed.error.issues});
  const d=parsed.data,connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.execute('SELECT * FROM ai_generations WHERE id=? FOR UPDATE',[generationId]);
    if(!rows.length){await connection.rollback();return res.status(404).json({success:false,message:'AI generation not found'});}
    const gen=rows[0];
    if(gen.status!=='succeeded'||gen.review_status!=='pending'){await connection.rollback();return res.status(409).json({success:false,message:'Generation is not awaiting review'});}
    const [[reviewer]]=await connection.execute('SELECT id FROM users WHERE id=? AND is_active=1',[d.reviewed_by]);
    if(!reviewer){await connection.rollback();return res.status(400).json({success:false,message:'Reviewer not found'});}
    if(d.decision==='rejected'){
      await connection.execute("UPDATE ai_generations SET review_status='rejected' WHERE id=?",[generationId]);
      await connection.commit();
      req.log.info({generationId,reviewerId:d.reviewed_by},'AI generation rejected');
      return res.json({success:true,message:'AI suggestions rejected. No tasks or decisions were inserted.',review_status:'rejected'});
    }
    const output=typeof gen.output_json==='string'?JSON.parse(gen.output_json):gen.output_json;
    const decisions=Array.isArray(output?.decisions)?output.decisions:[];
    const tasks=Array.isArray(output?.action_items)?output.action_items:[];
    const decisionIndexes=d.approved_decision_indices ?? decisions.map((_,i)=>i);
    const taskIndexes=d.approved_action_item_indices ?? tasks.map((_,i)=>i);
    if([...decisionIndexes].some(i=>i>=decisions.length)||[...taskIndexes].some(i=>i>=tasks.length)||new Set(decisionIndexes).size!==decisionIndexes.length||new Set(taskIndexes).size!==taskIndexes.length){await connection.rollback();return res.status(400).json({success:false,message:'Selected item index is invalid'});}
    const [participants]=await connection.execute('SELECT u.id,u.full_name FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=?',[gen.meeting_id]);
    const ownerMap=new Map(participants.map(p=>[p.full_name.trim().toLowerCase(),p.id]));
    for(const index of decisionIndexes){const item=decisions[index];if(!item.decision_text?.trim())throw new Error(`Decision ${index} is empty`);await connection.execute('INSERT INTO decisions (meeting_id,decision_text,rationale,decided_by) VALUES (?,?,?,?)',[gen.meeting_id,item.decision_text,item.rationale||null,d.reviewed_by]);}
    let unassigned=0;
    for(const index of taskIndexes){
      const item=tasks[index];if(!item.title?.trim())throw new Error(`Action item ${index} has no title`);
      const owner=ownerMap.get(String(item.owner_name||'').trim().toLowerCase())||null;if(item.owner_name&&!owner)unassigned++;
      const due=isDate(item.due_date)?item.due_date:null;
      const priority=['low','medium','high','urgent'].includes(item.priority)?item.priority:'medium';
      const [result]=await connection.execute("INSERT INTO action_items (source_meeting_id,current_meeting_id,title,description,owner_id,created_by,due_date,priority,status) VALUES (?,?,?,?,?,?,?,?,'open')",[gen.meeting_id,gen.meeting_id,item.title,item.description||null,owner,d.reviewed_by,due,priority]);
      await connection.execute("INSERT INTO action_history (action_item_id,event_type,new_status,new_owner_id,from_meeting_id,actor_id,details) VALUES (?,'created','open',?,?,?,?)",[result.insertId,owner,gen.meeting_id,d.reviewed_by,'AI-extracted action item reviewed and approved by a human.']);
    }
    await connection.execute("UPDATE ai_generations SET review_status='approved' WHERE id=?",[generationId]);
    await connection.commit();
    req.log.info({generationId,reviewerId:d.reviewed_by,decisionsCreated:decisionIndexes.length,actionItemsCreated:taskIndexes.length,unassignedTasks:unassigned},'AI extraction approved');
    res.json({success:true,message:'Approved information saved to ContextFlow.',review_status:'approved',decisions_created:decisionIndexes.length,action_items_created:taskIndexes.length,unassigned_tasks:unassigned});
  }catch(error){await connection.rollback();next(error);}finally{connection.release();}
}

async function createHandover(req,res,next){
  const userId=Number(req.params.userId),started=Date.now();
  if(!Number.isSafeInteger(userId)||userId<1)return res.status(400).json({success:false,message:'Invalid user ID'});
  try{
    const [[user]]=await pool.execute('SELECT id,full_name,email,role,team FROM users WHERE id=? AND is_active=1',[userId]);
    if(!user)return res.status(404).json({success:false,message:'Team member not found'});
    const [openTasks]=await pool.execute(`SELECT a.id,a.title,a.description,a.status,a.priority,a.due_date,a.carry_forward_count,m.title AS current_meeting_title FROM action_items a JOIN meetings m ON m.id=a.current_meeting_id WHERE a.owner_id=? AND a.status IN ('open','in_progress','blocked') ORDER BY FIELD(a.priority,'urgent','high','medium','low'),a.due_date IS NULL,a.due_date`,[userId]);
    const [recentMeetings]=await pool.execute(`SELECT DISTINCT m.id,m.title,m.meeting_type,m.scheduled_at,m.agenda FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE mp.user_id=? ORDER BY m.scheduled_at DESC LIMIT 5`,[userId]);
    const [decisions]=await pool.execute(`SELECT d.id,d.decision_text,d.rationale,m.title AS meeting_title FROM decisions d JOIN meetings m ON m.id=d.meeting_id JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE mp.user_id=? ORDER BY d.decision_date DESC LIMIT 10`,[userId]);
    const [documents]=await pool.execute(`SELECT DISTINCT kd.id,kd.title,kd.document_type,kd.content,kd.tags FROM knowledge_documents kd JOIN knowledge_links kl ON kl.document_id=kd.id LEFT JOIN meetings m ON m.id=kl.meeting_id LEFT JOIN action_items a ON a.id=kl.action_item_id LEFT JOIN decisions d ON d.id=kl.decision_id LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE kd.is_active=1 AND (mp.user_id=? OR a.owner_id=? OR d.decided_by=?) LIMIT 10`,[userId,userId,userId]);
    const context={user,open_tasks:openTasks,recent_meetings:recentMeetings,decisions,knowledge_documents:documents.map(({content,...d})=>({...d,content:String(content||'').slice(0,1400)}))};
    const result=await generateHandover(context);
    const latency=Date.now()-started;
    await pool.execute(`INSERT INTO ai_generations (request_id,generation_type,requested_by,target_user_id,provider_name,model_name,input_text,output_json,status,review_status,latency_ms) VALUES (?,'catch_up_brief',?,?,?,?,?,?,'succeeded','not_required',?)`,[req.id,req.body?.requested_by||null,userId,result.provider,result.model,JSON.stringify(context),JSON.stringify(result.output),latency]);
    req.log.info({targetUserId:userId,provider:result.provider,latencyMs:latency,outcome:'succeeded'},'Smart context handover generated');
    res.json({success:true,provider:result.provider,latency_ms:latency,data:{...result.output,source_context:{open_tasks:openTasks.length,recent_meetings:recentMeetings.length,decisions:decisions.length,knowledge_documents:documents.length}}});
  }catch(error){req.log.error({err:error,userId},'Handover brief generation failed');next(error);}
}

module.exports={extractMeetingNotes,reviewGeneration,createHandover};
