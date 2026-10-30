function notFound(req,res){
  res.status(404).json({success:false,message:'API endpoint not found',requestId:req.id});
}
function errorHandler(err,req,res,next){
  req.log?.error({err,requestId:req.id},'Unhandled request error');
  const status=Number(err.status)||500;
  res.status(status).json({success:false,message:status>=500?'Internal server error':err.message,requestId:req.id});
}
module.exports={notFound,errorHandler};
