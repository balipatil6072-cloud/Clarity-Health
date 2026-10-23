const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const models = require('../models');

const memory = { users: [], reports: [], analyses: [], notes: [], followUps: [], audit: [], profiles: [] };
let databaseEnabled = false;
let demoAccountCredentials = [];
const id = (v) => String(v?._id || v?.id || v);
const clean = (v) => v?.toObject ? v.toObject() : v;

function setDatabaseEnabled(value) { databaseEnabled = Boolean(value); }
function list(collection) { return databaseEnabled ? models[collection].find().lean() : Promise.resolve(memory[collection].map((x) => ({ ...x }))); }
async function findUserByEmail(email) { return databaseEnabled ? models.User.findOne({ email: email.toLowerCase() }) : memory.users.find((x) => x.email === email.toLowerCase()) || null; }
async function findUserById(userId) { return databaseEnabled ? models.User.findById(userId) : memory.users.find((x) => id(x) === id(userId)) || null; }
async function createUser(user) {
  const doc = databaseEnabled ? await models.User.create(user) : { ...user, _id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date() };
  if (!databaseEnabled) memory.users.push(doc);
  return clean(doc);
}
async function saveUser(user) {
  if (databaseEnabled) {
    if (typeof user?.save === 'function') {
      await user.save();
      return clean(user);
    }
    const updated = await models.User.findByIdAndUpdate(id(user), { $set: user }, { new: true, runValidators: true });
    return clean(updated);
  }
  const at = memory.users.findIndex((x) => id(x) === id(user)); if (at >= 0) memory.users[at] = { ...memory.users[at], ...user }; return memory.users[at];
}
async function listReports(patientId) { return databaseEnabled ? models.MedicalReport.find({ patientId }).sort({ reportDate: -1 }).lean() : memory.reports.filter((x) => id(x.patientId) === id(patientId)).sort((a,b) => new Date(b.reportDate)-new Date(a.reportDate)).map((x) => ({...x})); }
async function getReport(reportId) { return databaseEnabled ? models.MedicalReport.findById(reportId).select('+extractedText') : memory.reports.find((x) => id(x) === id(reportId)) || null; }
async function createReport(report) { const doc = databaseEnabled ? await models.MedicalReport.create(report) : { ...report, _id: `r_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, createdAt: new Date(), updatedAt: new Date() }; if (!databaseEnabled) memory.reports.push(doc); return clean(doc); }
async function saveReport(report) { if (databaseEnabled) { await models.MedicalReport.findByIdAndUpdate(id(report), report); return getReport(id(report)); } const at=memory.reports.findIndex((x)=>id(x)===id(report)); if(at>=0) memory.reports[at]={...memory.reports[at],...report}; return memory.reports[at]; }
async function deleteReport(reportId) { const report=databaseEnabled?await models.MedicalReport.findByIdAndDelete(reportId):(()=>{const at=memory.reports.findIndex((x)=>id(x)===id(reportId));return at<0?null:memory.reports.splice(at,1)[0];})(); if(!report)return null; if(databaseEnabled)await models.Analysis.deleteMany({reportIds:reportId});else memory.analyses=memory.analyses.filter((x)=>!(x.reportIds||[]).some((rid)=>id(rid)===id(reportId))); return report; }
async function createAnalysis(data) { const doc=databaseEnabled?await models.Analysis.create(data):{...data,_id:`a_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:new Date(),updatedAt:new Date()}; if(!databaseEnabled)memory.analyses.push(doc); return clean(doc); }
async function getAnalysis(analysisId) { return databaseEnabled?models.Analysis.findById(analysisId):memory.analyses.find((x)=>id(x)===id(analysisId))||null; }
async function listAnalyses(patientId) { return databaseEnabled?models.Analysis.find({patientId}).sort({createdAt:-1}).lean():memory.analyses.filter((x)=>id(x.patientId)===id(patientId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((x)=>({...x})); }
async function saveAnalysis(a) { if(databaseEnabled){await models.Analysis.findByIdAndUpdate(id(a),a);return getAnalysis(id(a));}const at=memory.analyses.findIndex((x)=>id(x)===id(a));if(at>=0)memory.analyses[at]={...memory.analyses[at],...a};return memory.analyses[at]; }
async function createNote(d) { const doc=databaseEnabled?await models.ClinicalNote.create(d):{...d,_id:`n_${Date.now()}`,createdAt:new Date()};if(!databaseEnabled)memory.notes.push(doc);return clean(doc); }
async function notesForPatient(patientId) { return databaseEnabled?models.ClinicalNote.find({patientId}).sort({createdAt:-1}).lean():memory.notes.filter((x)=>id(x.patientId)===id(patientId)); }
async function createFollowUp(d) { const doc=databaseEnabled?await models.FollowUpTask.create(d):{...d,_id:`f_${Date.now()}`,createdAt:new Date(),updatedAt:new Date()};if(!databaseEnabled)memory.followUps.push(doc);return clean(doc); }
async function followUpsForPatient(patientId) { return databaseEnabled?models.FollowUpTask.find({patientId}).sort({dueDate:1}).lean():memory.followUps.filter((x)=>id(x.patientId)===id(patientId)); }
async function getFollowUp(taskId) { return databaseEnabled?models.FollowUpTask.findById(taskId):memory.followUps.find((x)=>id(x)===id(taskId))||null; }
async function saveFollowUp(task) { if(databaseEnabled){await models.FollowUpTask.findByIdAndUpdate(id(task),task);return getFollowUp(id(task));}const at=memory.followUps.findIndex((x)=>id(x)===id(task));if(at>=0)memory.followUps[at]={...memory.followUps[at],...task};return memory.followUps[at]; }
async function audit(actorId, action, resourceType, resourceId, metadata={}) { const item={actorId,action,resourceType,resourceId:String(resourceId||''),metadata};if(databaseEnabled)return models.AuditLog.create(item);const doc={...item,_id:`l_${Date.now()}_${Math.random()}`,createdAt:new Date()};memory.audit.push(doc);return doc; }
async function auditLogs() { return databaseEnabled?models.AuditLog.find().sort({createdAt:-1}).limit(200).lean():memory.audit.slice().reverse().slice(0,200); }

async function seedDemo() {
  const specs = [
    { name: 'Alex Morgan', email: 'patient@clarity.demo', role: 'patient' },
    { name: 'Dr. Jamie Chen', email: 'doctor@clarity.demo', role: 'doctor' },
    { name: 'Sam Administrator', email: 'admin@clarity.demo', role: 'admin' },
  ];
  const users = []; demoAccountCredentials = [];
  for (const spec of specs) {
    const configuredPassword = process.env[`DEMO_${spec.role.toUpperCase()}_PASSWORD`];
    const password = configuredPassword || crypto.randomBytes(18).toString('base64url');
    let user = await findUserByEmail(spec.email);
    if (!user) user = await createUser({ name: spec.name, email: spec.email, role: spec.role, status: 'active', passwordHash: await bcrypt.hash(password, 10), doctorPatientIds: [] });
    else { user.passwordHash = await bcrypt.hash(password, 10); user.role = spec.role; user.status = 'active'; await saveUser(user); }
    users.push(user);
    demoAccountCredentials.push({ role: spec.role, email: spec.email, password });
  }
  const [patient, doctor] = users;
  if (doctor) { const ids = (doctor.doctorPatientIds || []).map(id); if (!ids.includes(id(patient))) { doctor.doctorPatientIds = [...(doctor.doctorPatientIds || []), id(patient)]; await saveUser(doctor); } }
  let reports = await listReports(id(patient));
  if (!reports.length) {
    const prior = await createReport({ patientId: id(patient), originalFilename: 'demo-panel-january.pdf', reportType: 'Laboratory report', reportDate: new Date('2026-01-10'), uploadStatus: 'processed', processingStatus: 'complete', results: [
      { testName: 'Hemoglobin', value: 13.4, unit: 'g/dL', referenceRange: '12.0 - 16.0', status: 'within', confidence: 1, sourcePage: 1 },
      { testName: 'Glucose, fasting', value: 96, unit: 'mg/dL', referenceRange: '70 - 99', status: 'within', confidence: 1, sourcePage: 1 },
      { testName: 'LDL cholesterol', value: 129, unit: 'mg/dL', referenceRange: '0 - 100', status: 'high', confidence: 1, sourcePage: 1 },
    ] });
    const current = await createReport({ patientId: id(patient), originalFilename: 'demo-panel-april.pdf', reportType: 'Laboratory report', reportDate: new Date('2026-04-12'), uploadStatus: 'processed', processingStatus: 'complete', results: [
      { testName: 'Hemoglobin', value: 13.7, unit: 'g/dL', referenceRange: '12.0 - 16.0', status: 'within', confidence: 1, sourcePage: 1 },
      { testName: 'Glucose, fasting', value: 102, unit: 'mg/dL', referenceRange: '70 - 99', status: 'high', confidence: 1, sourcePage: 1 },
      { testName: 'LDL cholesterol', value: 121, unit: 'mg/dL', referenceRange: '0 - 100', status: 'high', confidence: 1, sourcePage: 1 },
    ] });
    reports = [current, prior];
    const { buildDeterministicAnalysis } = require('./analysis');
    await createAnalysis({ ...buildDeterministicAnalysis(current), patientId: id(patient), reportIds: [id(current)] });
  }
  return { users, reports };
}

module.exports = { memory, id, clean, setDatabaseEnabled, list, findUserByEmail, findUserById, createUser, saveUser, listReports, getReport, createReport, saveReport, deleteReport, createAnalysis, getAnalysis, listAnalyses, saveAnalysis, createNote, notesForPatient, createFollowUp, followUpsForPatient, getFollowUp, saveFollowUp, audit, auditLogs, seedDemo, getDemoCredentials: () => demoAccountCredentials.map((x) => ({ ...x })) };
