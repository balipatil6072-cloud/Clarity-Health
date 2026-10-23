const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pdfParse = require('pdf-parse');
const store = require('./services/store');
const { analyzeWithProvider, buildTrends } = require('./services/analysis');
const { canonicalTestName, extractResults: extractMedicalResults, isMedicalReport, sourceSupportsResult } = require('./services/reportParser');
const { authRequired, roleRequired, canAccessPatient } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const { maxUploadMb } = require('./config/uploadLimits');

const app = express();
const uploadsDir = process.env.VERCEL ? path.join(os.tmpdir(), 'clarity-health-uploads') : path.resolve(__dirname, '../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req,res,next)=>{
  const sendJson=res.json.bind(res);
  const sanitize=(value)=>{
    if(Array.isArray(value))return value.map(sanitize);
    if(!value||typeof value!=='object'||value instanceof Date)return value;
    const source=value.toObject?value.toObject():value;
    if(Object.getPrototypeOf(source)!==Object.prototype&&Object.getPrototypeOf(source)!==null)return source;
    return Object.fromEntries(Object.entries(source).filter(([key])=>key!=='storageKey'&&key!=='extractedText').map(([key,item])=>[key,sanitize(item)]));
  };
  res.json=(body)=>sendJson(sanitize(body));
  next();
});
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const analysisLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const upload = multer({
  storage: multer.diskStorage({ destination: uploadsDir, filename: (req,file,cb)=>cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: maxUploadMb * 1024 * 1024 },
  fileFilter: (req,file,cb) => {
    const ext=path.extname(file.originalname).toLowerCase();
    const allowed=(ext==='.pdf'&&file.mimetype==='application/pdf') || (['.png','.jpg','.jpeg','.webp'].includes(ext)&&['image/png','image/jpeg','image/webp'].includes(file.mimetype));
    cb(allowed?null:Object.assign(new Error('Upload a PDF, PNG, JPEG, or WebP report.'),{status:400}),allowed);
  },
});

const id = store.id;
const safeUser = (u) => ({ id:id(u), name:u.name, email:u.email, role:u.role, status:u.status, createdAt:u.createdAt });
const issue = (message,status=400) => Object.assign(new Error(message),{status});
const asyncRoute = (fn) => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const sessionCookieOptions = () => ({ httpOnly:true, sameSite:'lax', secure:process.env.COOKIE_SECURE==='true', maxAge: 7*24*60*60*1000, path:'/' });
function issueToken(user){return jwt.sign({sub:id(user),role:user.role},process.env.JWT_SECRET||'development-only-secret-change-me',{expiresIn:'7d'});}

async function checkedFile(req){
  if(!req.file)throw issue('Choose a report file to upload.');
  const bytes=await fs.promises.readFile(req.file.path);const ext=path.extname(req.file.originalname).toLowerCase();
  const valid=ext==='.pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?bytes[0]===255&&bytes[1]===216:ext==='.webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
  if(!valid){await fs.promises.unlink(req.file.path).catch(()=>{});throw issue('The file contents do not match the selected file type. Please choose a valid PDF or image.');}
  return bytes;
}
async function permittedReport(user,reportId){const report=await store.getReport(reportId);if(!report)throw issue('Report not found.',404);if(!(await canAccessPatient(user,report.patientId)))throw issue('You are not authorized to access this report.',403);return report;}
function validateResults(input, report, sourceConfirmed=false){
  const schema=z.array(z.object({testName:z.string().trim().min(1).max(100),value:z.union([z.number().finite(),z.string().trim().min(1).max(100)]),unit:z.string().max(32).optional().default(''),referenceRange:z.string().max(80).optional().default(''),confidence:z.number().min(0).max(1).optional(),sourcePage:z.number().int().positive().optional()}).strict()).max(100);
  const parsed=schema.safeParse(input);if(!parsed.success)throw issue('Check each result: include a test name and a number or short text value.');
  return parsed.data.map((r)=>{
    const canonical=canonicalTestName(r.testName);
    if(!canonical)throw issue(`“${r.testName}” is not a supported lab test. Use a test name shown on the report.`);
    const result={...r,testName:canonical,status:require('./services/analysis').rangeStatus(Number(r.value),r.referenceRange)};
    if(report?.extractionMethod==='pdf-text'&&!sourceSupportsResult(report.extractedText,result))throw issue(`The ${canonical} value, unit, or reference range does not match the uploaded PDF text. Check it against the report and re-upload a readable PDF if the extraction is wrong.`);
    if(report?.extractionMethod==='manual-image'&&!sourceConfirmed)throw issue('Confirm that you checked the original hospital report image and transcribed these values before saving.');
    return result;
  });
}

app.get('/api/health',(req,res)=>res.json({status:'ok',mode:process.env.OPENAI_API_KEY?'ai-enabled':'demo-analysis',database:require('mongoose').connection.readyState===1?'mongodb':'memory-demo'}));
app.get('/api/demo/credentials',(req,res)=>res.json({enabled:process.env.DEMO_MODE==='true',accounts:process.env.DEMO_MODE==='true'?store.getDemoCredentials():[]}));

app.post('/api/auth/register',loginLimit,asyncRoute(async(req,res)=>{
  const schema=z.object({name:z.string().trim().min(2).max(100),email:z.string().email().max(254),password:z.string().min(10).max(128)});
  const parsed=schema.safeParse(req.body);if(!parsed.success)throw issue('Enter your name, a valid email, and a password with at least 10 characters.');
  const {name,email,password}=parsed.data; if(await store.findUserByEmail(email))throw issue('An account with this email already exists.',409);
  const user=await store.createUser({name,email:email.toLowerCase(),role:'patient',status:'active',passwordHash:await bcrypt.hash(password,12),doctorPatientIds:[]});
  await store.audit(id(user),'account.register','User',id(user));
  res.cookie('clarity_session',issueToken(user),sessionCookieOptions()).status(201).json({user:safeUser(user)});
}));
app.post('/api/auth/login',loginLimit,asyncRoute(async(req,res)=>{
  const parsed=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);if(!parsed.success)throw issue('Enter a valid email and password.');
  const user=await store.findUserByEmail(parsed.data.email);if(!user||user.status!=='active'||!(await bcrypt.compare(parsed.data.password,user.passwordHash)))throw issue('Email or password was not recognized.',401);
  res.cookie('clarity_session',issueToken(user),sessionCookieOptions()).json({user:safeUser(user)});
}));
app.post('/api/auth/logout',(req,res)=>res.clearCookie('clarity_session',{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',path:'/'}).json({ok:true}));
app.get('/api/auth/me',authRequired,asyncRoute(async(req,res)=>{const user=await store.findUserById(req.user.id);if(!user||user.status!=='active')throw issue('Account is unavailable.',401);res.json({user:safeUser(user),demoMode:process.env.DEMO_MODE==='true'});}));

app.get('/api/patients/me',authRequired,roleRequired('patient'),asyncRoute(async(req,res)=>{const user=await store.findUserById(req.user.id);res.json({patient:safeUser(user)});}));
app.patch('/api/patients/me',authRequired,roleRequired('patient'),asyncRoute(async(req,res)=>{const schema=z.object({sharingPreferences:z.array(z.string().max(80)).max(20)});const p=schema.safeParse(req.body);if(!p.success)throw issue('Invalid sharing preferences.');const profile={userId:req.user.id,sharingPreferences:p.data.sharingPreferences,consentUpdatedAt:new Date()};if(require('mongoose').connection.readyState===1){const P=require('./models').PatientProfile;await P.findOneAndUpdate({userId:req.user.id},profile,{upsert:true,new:true});}await store.audit(req.user.id,'patient.preferences.update','PatientProfile',req.user.id);res.json({ok:true});}));
app.get('/api/patients/:id',authRequired,asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not authorized to access this patient.',403);const user=await store.findUserById(req.params.id);if(!user||user.role!=='patient')throw issue('Patient not found.',404);res.json({patient:{id:id(user),name:user.name}});}));

app.post('/api/reports/upload',authRequired,roleRequired('patient'),upload.single('file'),asyncRoute(async(req,res)=>{
  const bytes=await checkedFile(req);const date=new Date(req.body.reportDate||'');if(!Number.isFinite(date.getTime())||date>new Date()){await fs.promises.unlink(req.file.path).catch(()=>{});throw issue('Enter a valid report date that is not in the future.');}
  const ext=path.extname(req.file.originalname).toLowerCase();let text='',results=[],processingStatus='manual-entry';
  if(ext==='.pdf'){
    try{text=(await pdfParse(bytes)).text.slice(0,100000);}
    catch{await fs.promises.unlink(req.file.path).catch(()=>{});throw issue('We could not read this PDF. Upload a text-based hospital or clinic report, or use a report photo and transcribe its values manually.',422);}
    if(!text.trim()){await fs.promises.unlink(req.file.path).catch(()=>{});throw issue('This PDF has no readable text (it may be scanned). Upload it as a report image and transcribe its values manually.',422);}
    if(!isMedicalReport(text)){await fs.promises.unlink(req.file.path).catch(()=>{});throw issue('This file does not look like a hospital, clinic, or laboratory report. No report was saved. Upload a medical report with patient/report details.',422);}
    results=extractMedicalResults(text);processingStatus=results.length?'complete':'manual-entry';
  } else if(req.body.medicalReportConfirmed!=='true') {
    await fs.promises.unlink(req.file.path).catch(()=>{});
    throw issue('Confirm that this image is a hospital or clinic report you are authorized to upload.');
  }
  if(process.env.VERCEL) await fs.promises.unlink(req.file.path).catch(()=>{});
  const safeOriginalName=path.posix.basename(req.file.originalname.replace(/\\/g,'/')).slice(0,180);
  const extractionMethod=ext==='.pdf'?'pdf-text':'manual-image';
  const extractionEvidence=results.map((result)=>result.sourceExcerpt).filter(Boolean).join('\n');
  const storedResults=results.map(({sourceExcerpt,...result})=>result);
  const report=await store.createReport({patientId:req.user.id,originalFilename:safeOriginalName,storageKey:process.env.VERCEL?undefined:path.basename(req.file.path),reportType:String(req.body.reportType||'Laboratory report').slice(0,80),reportDate:date,uploadStatus:results.length?'processed':'needs-review',processingStatus,extractionMethod,extractedText:extractionEvidence,results:storedResults});
  await store.audit(req.user.id,'report.upload','MedicalReport',id(report),{fileType:ext,resultCount:results.length});
  const message=ext==='.pdf'?(results.length?'Hospital report recognized. Extracted supported test rows from its text; verify them against the source before analysis.':'Hospital report recognized, but it contains no supported lab rows. No results were invented; this PDF cannot be analyzed until a supported result is present in its text.'):'Image saved as a hospital-report photo. OCR is not available, so no values were extracted; manually transcribe supported lab tests from the image and confirm each one before analysis.';
  res.status(201).json({report:{...report,extractedText:undefined},message});
}));
app.get('/api/reports',authRequired,asyncRoute(async(req,res)=>{
  if(req.user.role!=='patient')throw issue('Use the clinician patient list to view assigned records.',403);
  res.json({reports:await store.listReports(req.user.id)});
}));
app.get('/api/reports/:id',authRequired,asyncRoute(async(req,res)=>{const report=await permittedReport(req.user,req.params.id);res.json({report});}));
app.delete('/api/reports/:id',authRequired,roleRequired('patient'),asyncRoute(async(req,res)=>{const report=await permittedReport(req.user,req.params.id);if(String(report.patientId)!==String(req.user.id))throw issue('You are not authorized to delete this report.',403);await store.deleteReport(req.params.id);if(report.storageKey)await fs.promises.unlink(path.join(uploadsDir,path.basename(report.storageKey))).catch(()=>{});await store.audit(req.user.id,'report.delete','MedicalReport',req.params.id);res.json({ok:true});}));
app.post('/api/reports/:id/extract',authRequired,asyncRoute(async(req,res)=>{const report=await permittedReport(req.user,req.params.id);res.json({results:report.results||[],processingStatus:report.processingStatus||'manual-entry'});}));
app.patch('/api/reports/:id/results',authRequired,asyncRoute(async(req,res)=>{const report=await permittedReport(req.user,req.params.id);if(req.user.role!=='patient')throw issue('Only the patient can correct extracted results.',403);const results=validateResults(req.body.results,report,req.body.sourceConfirmed===true);report.results=results;report.uploadStatus='processed';report.processingStatus=results.length?'complete':'manual-entry';await store.saveReport(report);await store.audit(req.user.id,'report.results.correct','MedicalReport',req.params.id,{resultCount:results.length});res.json({report});}));

app.post('/api/reports/:id/analyze',authRequired,analysisLimit,asyncRoute(async(req,res)=>{const report=await permittedReport(req.user,req.params.id);if(!(report.results||[]).length)throw issue('Add at least one extracted or manually entered test result before analysis.');const output=await analyzeWithProvider(report,process.env.OPENAI_API_KEY,process.env.OPENAI_MODEL,process.env.OPENAI_BASE_URL);const analysis=await store.createAnalysis({...output,patientId:String(report.patientId),reportIds:[id(report)],reviewStatus:'needs-review'});await store.audit(req.user.id,'analysis.create','Analysis',id(analysis),{provider:analysis.provider});res.status(201).json({analysis});}));
app.get('/api/analyses/:id',authRequired,asyncRoute(async(req,res)=>{const analysis=await store.getAnalysis(req.params.id);if(!analysis)throw issue('Analysis not found.',404);if(!(await canAccessPatient(req.user,analysis.patientId)))throw issue('You are not authorized to access this analysis.',403);res.json({analysis});}));
app.get('/api/patients/:id/analyses',authRequired,asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not authorized to access these analyses.',403);res.json({analyses:await store.listAnalyses(req.params.id)});}));
app.post('/api/analyses/:id/review',authRequired,roleRequired('doctor'),asyncRoute(async(req,res)=>{const a=await store.getAnalysis(req.params.id);if(!a)throw issue('Analysis not found.',404);if(!(await canAccessPatient(req.user,a.patientId)))throw issue('You are not assigned to this patient.',403);const parsed=z.object({reviewNote:z.string().trim().max(1500).optional().default(''),status:z.enum(['reviewed','needs-review']).default('reviewed')}).safeParse(req.body);if(!parsed.success)throw issue('Invalid review details.');a.reviewNote=parsed.data.reviewNote;a.reviewStatus=parsed.data.status;a.reviewedBy=req.user.id;a.reviewedAt=new Date();await store.saveAnalysis(a);await store.audit(req.user.id,'analysis.review','Analysis',req.params.id,{status:a.reviewStatus});res.json({analysis:a});}));

app.get('/api/patients/:id/timeline',authRequired,asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not authorized to access this timeline.',403);const [reports,analyses,notes,followUps]=await Promise.all([store.listReports(req.params.id),store.listAnalyses(req.params.id),store.notesForPatient(req.params.id),store.followUpsForPatient(req.params.id)]);const timeline=[...reports.map((x)=>({kind:'report',date:x.reportDate,title:x.originalFilename,record:x})),...analyses.map((x)=>({kind:'analysis',date:x.createdAt,title:'Report analysis',record:x})),...notes.map((x)=>({kind:'note',date:x.createdAt,title:'Clinician note',record:x})),...followUps.map((x)=>({kind:'follow-up',date:x.dueDate||x.createdAt,title:x.description,record:x}))].sort((a,b)=>new Date(b.date)-new Date(a.date));const q=String(req.query.q||'').toLowerCase();const filtered=timeline.filter((x)=>!q||`${x.title} ${x.kind} ${JSON.stringify(x.record.results||[])}`.toLowerCase().includes(q));res.json({timeline:filtered});}));
app.get('/api/patients/:id/trends',authRequired,asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not authorized to access these trends.',403);res.json({trends:buildTrends(await store.listReports(req.params.id))});}));
app.post('/api/patients/:id/notes',authRequired,roleRequired('doctor'),asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not assigned to this patient.',403);const parsed=z.object({content:z.string().trim().min(1).max(4000)}).safeParse(req.body);if(!parsed.success)throw issue('Enter a note of 1 to 4,000 characters.');const note=await store.createNote({patientId:req.params.id,authorId:req.user.id,content:parsed.data.content});await store.audit(req.user.id,'clinical-note.create','ClinicalNote',id(note));res.status(201).json({note});}));
app.post('/api/patients/:id/follow-ups',authRequired,roleRequired('doctor'),asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not assigned to this patient.',403);const parsed=z.object({description:z.string().trim().min(1).max(300),dueDate:z.string().datetime().optional()}).safeParse(req.body);if(!parsed.success)throw issue('Enter a follow-up description and valid due date.');const task=await store.createFollowUp({patientId:req.params.id,assignedTo:req.user.id,description:parsed.data.description,dueDate:parsed.data.dueDate?new Date(parsed.data.dueDate):null,status:'open'});await store.audit(req.user.id,'follow-up.create','FollowUpTask',id(task));res.status(201).json({task});}));
app.get('/api/patients/:id/follow-ups',authRequired,asyncRoute(async(req,res)=>{if(!(await canAccessPatient(req.user,req.params.id)))throw issue('You are not authorized to access follow-ups.',403);res.json({tasks:await store.followUpsForPatient(req.params.id)});}));
app.patch('/api/follow-ups/:id',authRequired,roleRequired('doctor'),asyncRoute(async(req,res)=>{const task=await store.getFollowUp(req.params.id);if(!task)throw issue('Follow-up not found.',404);if(!(await canAccessPatient(req.user,task.patientId)))throw issue('You are not assigned to this patient.',403);const parsed=z.object({status:z.enum(['open','done']),description:z.string().trim().min(1).max(300).optional()}).safeParse(req.body);if(!parsed.success)throw issue('Invalid follow-up update.');Object.assign(task,parsed.data);await store.saveFollowUp(task);await store.audit(req.user.id,'follow-up.update','FollowUpTask',req.params.id);res.json({task});}));

app.get('/api/doctor/patients',authRequired,roleRequired('doctor'),asyncRoute(async(req,res)=>{const doctor=await store.findUserById(req.user.id);const patients=[];for(const patientId of doctor.doctorPatientIds||[]){const patient=await store.findUserById(patientId);if(!patient||patient.role!=='patient')continue;const [reports,analyses]=await Promise.all([store.listReports(id(patient)),store.listAnalyses(id(patient))]);patients.push({patient:{id:id(patient),name:patient.name},reports,analyses});}res.json({patients});}));

app.get('/api/admin/users',authRequired,roleRequired('admin'),asyncRoute(async(req,res)=>{const users=(await store.list('User')).map(safeUser);res.json({users});}));
app.patch('/api/admin/users/:id',authRequired,roleRequired('admin'),asyncRoute(async(req,res)=>{const parsed=z.object({status:z.enum(['active','suspended']).optional(),role:z.enum(['patient','doctor','admin']).optional()}).refine((x)=>x.status||x.role).safeParse(req.body);if(!parsed.success)throw issue('Choose a valid role or account status.');const user=await store.findUserById(req.params.id);if(!user)throw issue('User not found.',404);Object.assign(user,parsed.data);await store.saveUser(user);await store.audit(req.user.id,'admin.user.update','User',req.params.id,parsed.data);res.json({user:safeUser(user)});}));
app.get('/api/admin/audit-logs',authRequired,roleRequired('admin'),asyncRoute(async(req,res)=>res.json({logs:await store.auditLogs()})));

if(process.env.NODE_ENV==='production'&&!process.env.VERCEL){
  const clientDist=path.resolve(__dirname,'../../dist');app.use(express.static(clientDist));app.get('*',(req,res)=>res.sendFile(path.join(clientDist,'index.html')));
}
app.use(notFound);app.use(errorHandler);

module.exports={app};
