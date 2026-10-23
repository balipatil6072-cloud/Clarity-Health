const jwt = require('jsonwebtoken');
const store = require('../services/store');

async function authRequired(req, res, next) {
  try {
    const token = req.cookies?.clarity_session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'development-only-secret-change-me');
    const account = await store.findUserById(payload.sub);
    if (!account || account.status !== 'active') return res.status(401).json({ error: 'Your account is unavailable. Please contact an administrator.' });
    req.user = { id: payload.sub, role: account.role };
    return next();
  } catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
const roleRequired = (...roles) => (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({error:'You do not have access to this feature.'});
async function canAccessPatient(user, patientId) {
  if (user.role === 'patient') return String(user.id) === String(patientId);
  if (user.role !== 'doctor') return false;
  const doctor = await store.findUserById(user.id);
  return (doctor?.doctorPatientIds || []).some((id) => String(id) === String(patientId));
}
async function patientAccess(req,res,next) {
  const patientId = req.params.id || req.params.patientId;
  if (await canAccessPatient(req.user, patientId)) return next();
  return res.status(403).json({error:'You are not authorized to access this patient record.'});
}
module.exports={authRequired,roleRequired,patientAccess,canAccessPatient};
