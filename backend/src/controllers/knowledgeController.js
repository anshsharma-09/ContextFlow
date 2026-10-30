const { z } = require('zod');
const { pool } = require('../config/db');
const { recommendKnowledge } = require('../services/aiService');

async function listDocuments(req,res,next){
  try{
    const search=String(req.query.search||'').trim();
    let rows;
    if(search){
      [rows]=await pool.execute(`SELECT id,title,document_type,source_url,tags,uploaded_by,created_at,LEFT(content,450) AS excerpt FROM knowledge_documents WHERE is_active=1 AND (title LIKE ? OR content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT 100`,[`%${search}%`,`%${search}%`,`%${search}%`]);
    }else{
      [rows]=await pool.query(`SELECT id,title,document_type,source_url,tags,uploaded_by,created_at,LEFT(content,450) AS excerpt FROM knowledge_documents WHERE is_active=1 ORDER BY updated_at DESC LIMIT 100`);
    }
    res.json({success:true,count:rows.length,data:rows});
  }catch(error){next(error);}
}

async function createDocument(req,res,next){
  const parsed=z.object({title:z.string().trim().min(3).max(255),document_type:z.enum(['document','policy','guide','reference','meeting_record','other']).default('document'),content:z.string().trim().min(10).max(100000),source_url:z.string().url().optional().nullable(),tags:z.string().max(500).optional().nullable(),uploaded_by:z.number().int().positive().default(1)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({success:false,message:'Invalid document information',errors:parsed.error.issues});
  try{
    const d=parsed.data;const [result]=await pool.execute('INSERT INTO knowledge_documents (title,document_type,content,source_url,tags,uploaded_by) VALUES (?,?,?,?,?,?)',[d.title,d.document_type,d.content,d.source_url||null,d.tags||null,d.uploaded_by]);
    req.log.info({documentId:result.insertId},'Knowledge document created');
    res.status(201).json({success:true,data:{id:result.insertId,title:d.title,document_type:d.document_type}});
  }catch(error){next(error);}
}

async function getDocument(req,res,next){
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({success:false,message:'Invalid document ID'});
  try{
    const [[document]]=await pool.execute('SELECT * FROM knowledge_documents WHERE id=? AND is_active=1',[id]);
    if(!document)return res.status(404).json({success:false,message:'Knowledge document not found'});
    res.json({success:true,data:document});
  }catch(error){next(error);}
}

async function recommendForTask(req,res,next){
  const taskId=Number(req.params.taskId);if(!Number.isSafeInteger(taskId)||taskId<1)return res.status(400).json({success:false,message:'Invalid task ID'});
  const started=Date.now();
  try{
    const [[task]]=await pool.execute('SELECT id,title,description,priority,status FROM action_items WHERE id=?',[taskId]);
    if(!task)return res.status(404).json({success:false,message:'Task not found'});
    const [documents]=await pool.query('SELECT id,title,document_type,content,tags FROM knowledge_documents WHERE is_active=1 ORDER BY updated_at DESC LIMIT 100');
    const result=await recommendKnowledge({task,documents});
    const ids=new Set(documents.map(d=>Number(d.id)));
    const recommendations=(result.output.recommendations||[]).filter(r=>ids.has(Number(r.document_id))).slice(0,5);
    const latency=Date.now()-started;
    await pool.execute(`INSERT INTO ai_generations (request_id,generation_type,requested_by,provider_name,model_name,input_text,output_json,status,review_status,latency_ms) VALUES (?,'knowledge_recommendation',? ,?,?,?,?,'succeeded','not_required',?)`,[req.id,req.body?.requested_by||null,result.provider,result.model,JSON.stringify({task,documents:documents.map(d=>({id:d.id,title:d.title,tags:d.tags}))}),JSON.stringify({recommendations}),latency]);
    req.log.info({taskId,provider:result.provider,latencyMs:latency,recommendationCount:recommendations.length},'Knowledge recommendations generated');
    res.json({success:true,provider:result.provider,data:recommendations.map(r=>({...r,document:documents.find(d=>Number(d.id)===Number(r.document_id))}))});
  }catch(error){req.log.error({err:error,taskId},'Knowledge recommendation failed');next(error);}
}

async function createLink(req,res,next){
  const parsed=z.object({document_id:z.number().int().positive(),meeting_id:z.number().int().positive().optional(),action_item_id:z.number().int().positive().optional(),decision_id:z.number().int().positive().optional(),relevance_note:z.string().max(2000).optional().nullable(),linked_by:z.number().int().positive().default(1)}).refine(d=>[d.meeting_id,d.action_item_id,d.decision_id].filter(Boolean).length===1,{message:'Provide exactly one target: meeting_id, action_item_id or decision_id'}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({success:false,message:'Invalid knowledge link',errors:parsed.error.issues});
  try{
    const d=parsed.data;const target=d.meeting_id?'meeting_id':d.action_item_id?'action_item_id':'decision_id';
    const [result]=await pool.execute(`INSERT INTO knowledge_links (document_id,${target},relevance_note,linked_by) VALUES (?,?,?,?)`,[d.document_id,d[target],d.relevance_note||null,d.linked_by]);
    req.log.info({linkId:result.insertId,documentId:d.document_id,targetType:target},'Knowledge document linked');
    res.status(201).json({success:true,data:{id:result.insertId}});
  }catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({success:false,message:'Document is already linked to this item'});if(error.code==='ER_NO_REFERENCED_ROW_2')return res.status(404).json({success:false,message:'Document or target record not found'});next(error);}
}

module.exports={listDocuments,createDocument,getDocument,recommendForTask,createLink};
