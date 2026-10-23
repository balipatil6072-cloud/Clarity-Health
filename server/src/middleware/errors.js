const { maxUploadMb } = require('../config/uploadLimits');

function notFound(req,res){res.status(404).json({error:'That API route was not found.'});}
function errorHandler(err,req,res,next){
  if(err?.name==='MulterError') return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?`File is too large. Maximum size is ${maxUploadMb} MB.`:'Could not upload this file.'});
  const status=err.status||500;
  if(status>=500) console.error('Request failed:',err.message);
  res.status(status).json({error:err.publicMessage||(status>=500?'Something went wrong. Please try again.':err.message)});
}
module.exports={notFound,errorHandler};
