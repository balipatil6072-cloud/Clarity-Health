require('dotenv').config();
const { app } = require('./app');
const { connectDatabase } = require('./config/db');
const store = require('./services/store');

async function start() {
  if(process.env.NODE_ENV==='production'){
    if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new Error('Production requires a JWT_SECRET of at least 32 characters.');
    if(process.env.DEMO_MODE==='true')throw new Error('Set DEMO_MODE=false in production.');
    if(process.env.COOKIE_SECURE!=='true')throw new Error('Production requires COOKIE_SECURE=true behind HTTPS.');
    if(!process.env.MONGODB_URI)throw new Error('Production requires a persistent MONGODB_URI.');
  }
  let connected=false;
  if(process.env.MONGODB_URI){
    try{connected=await connectDatabase(process.env.MONGODB_URI);}
    catch(err){if(process.env.DEMO_MODE==='true')console.warn('MongoDB unavailable; starting with in-memory demo data.');else throw err;}
  }
  store.setDatabaseEnabled(connected);
  if(process.env.DEMO_MODE==='true') await store.seedDemo();
  const port=Number(process.env.PORT||4000);
  app.listen(port,()=>console.log(`Clarity Health API listening on http://localhost:${port} (${connected?'MongoDB':'in-memory demo'} mode)`));
}
if(require.main===module)start().catch((err)=>{console.error('Could not start server:',err.message);process.exit(1);});
module.exports={start};
