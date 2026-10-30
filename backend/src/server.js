require('dotenv').config();
const express=require('express');
const cors=require('cors');
const crypto=require('crypto');
const pinoHttp=require('pino-http');
const logger=require('./utils/logger');
const {pool,testConnection}=require('./config/db');
const apiRoutes=require('./routes');
const {notFound,errorHandler}=require('./middleware/errorHandler');

const app=express();
const PORT=Number(process.env.PORT)||5000;
app.disable('x-powered-by');
app.use(pinoHttp({logger,genReqId:()=>crypto.randomUUID()}));
app.use(cors({origin:(process.env.FRONTEND_URL||'http://localhost:5173').split(',').map(x=>x.trim()),credentials:false}));
app.use(express.json({limit:'2mb'}));
app.use('/api',apiRoutes);
app.get('/api/health',async(req,res)=>{
  try{await pool.query('SELECT 1');res.json({success:true,application:'ContextFlow',status:'healthy',database:'connected',aiProvider:process.env.AI_PROVIDER||'demo',requestId:req.id,timestamp:new Date().toISOString()});}
  catch(error){req.log.error({err:error},'Health check database failure');res.status(503).json({success:false,application:'ContextFlow',status:'degraded',database:'disconnected',requestId:req.id});}
});
app.use(notFound);
app.use(errorHandler);

async function start(){
  try{
    await testConnection();
    const server=app.listen(PORT,()=>{
      logger.info({application:'ContextFlow',port:PORT,environment:process.env.NODE_ENV||'development',aiProvider:process.env.AI_PROVIDER||'demo'},'ContextFlow backend started');
      console.log(`ContextFlow API: http://localhost:${PORT}/api`);
      console.log(`Health check:   http://localhost:${PORT}/api/health`);
      console.log(`AI provider:    ${process.env.AI_PROVIDER||'demo'}`);
    });
    server.on('error',error=>{logger.error({err:error},'HTTP server error');});
    const shutdown=async signal=>{
      logger.info({signal},'Backend shutting down');
      server.close(async()=>{await pool.end();process.exit(0);});
      setTimeout(()=>process.exit(1),10000).unref();
    };
    process.on('SIGINT',()=>shutdown('SIGINT'));
    process.on('SIGTERM',()=>shutdown('SIGTERM'));
  }catch(error){
    logger.fatal({err:error},'ContextFlow startup failed. Check MySQL settings and run npm run db:setup.');
    console.error('Backend startup failed:',error.message);
    process.exit(1);
  }
}
if (require.main === module) {
  start();
}

module.exports = app;
