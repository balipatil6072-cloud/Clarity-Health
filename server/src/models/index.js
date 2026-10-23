const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  doctorPatientIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const resultSchema = new Schema({
  testName: { type: String, required: true, trim: true },
  value: { type: Schema.Types.Mixed, required: true },
  unit: { type: String, default: '' },
  referenceRange: { type: String, default: '' },
  status: { type: String, enum: ['within', 'low', 'high', 'unknown'], default: 'unknown' },
  confidence: Number,
  sourcePage: Number,
}, { _id: true });

const reportSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  originalFilename: { type: String, required: true },
  storageKey: String,
  reportType: { type: String, default: 'Laboratory report' },
  reportDate: { type: Date, required: true },
  uploadStatus: { type: String, enum: ['uploaded', 'processed', 'needs-review'], default: 'uploaded' },
  processingStatus: { type: String, enum: ['complete', 'manual-entry', 'failed'], default: 'manual-entry' },
  extractionMethod: { type: String, enum: ['pdf-text', 'manual-image'], default: 'manual-image' },
  extractedText: { type: String, select: false },
  results: [resultSchema],
}, { timestamps: true });
reportSchema.index({ patientId: 1, reportDate: -1 });

const findingSchema = new Schema({
  testName: String, observedValue: Schema.Types.Mixed, unit: String, referenceRange: String,
  status: String, interpretation: String, evidenceSource: String, uncertainty: String,
  recommendedNextSteps: [String], clinicianReviewRequired: { type: Boolean, default: true },
}, { _id: true });
const analysisSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reportIds: [{ type: Schema.Types.ObjectId, ref: 'MedicalReport' }],
  version: { type: Number, default: 1 }, summary: String, findings: [findingSchema],
  suggestedNextSteps: [String], provider: { type: String, default: 'rules-demo' }, model: String,
  reviewStatus: { type: String, enum: ['needs-review', 'reviewed'], default: 'needs-review' },
  reviewNote: String, reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, reviewedAt: Date,
}, { timestamps: true });
const testResultSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reportId: { type: Schema.Types.ObjectId, ref: 'MedicalReport', required: true, index: true },
  testName: { type: String, required: true, trim: true, maxlength: 100 },
  value: { type: Schema.Types.Mixed, required: true }, unit: { type: String, maxlength: 32, default: '' },
  referenceRange: { type: String, maxlength: 80, default: '' },
  status: { type: String, enum: ['within', 'low', 'high', 'unknown'], default: 'unknown' },
  confidence: { type: Number, min: 0, max: 1 }, sourcePage: { type: Number, min: 1 },
}, { timestamps: true });

const patientProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  sharingPreferences: { type: [String], default: [] }, consentUpdatedAt: Date,
}, { timestamps: true });
const clinicalNoteSchema = new Schema({ patientId: Schema.Types.ObjectId, authorId: Schema.Types.ObjectId, content: { type: String, maxlength: 4000 } }, { timestamps: true });
const followUpSchema = new Schema({ patientId: Schema.Types.ObjectId, assignedTo: Schema.Types.ObjectId, description: String, dueDate: Date, status: { type: String, enum: ['open', 'done'], default: 'open' } }, { timestamps: true });
const auditSchema = new Schema({ actorId: Schema.Types.ObjectId, action: String, resourceType: String, resourceId: String, metadata: Schema.Types.Mixed }, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  PatientProfile: mongoose.models.PatientProfile || mongoose.model('PatientProfile', patientProfileSchema),
  MedicalReport: mongoose.models.MedicalReport || mongoose.model('MedicalReport', reportSchema),
  TestResult: mongoose.models.TestResult || mongoose.model('TestResult', testResultSchema),
  Analysis: mongoose.models.Analysis || mongoose.model('Analysis', analysisSchema),
  ClinicalNote: mongoose.models.ClinicalNote || mongoose.model('ClinicalNote', clinicalNoteSchema),
  FollowUpTask: mongoose.models.FollowUpTask || mongoose.model('FollowUpTask', followUpSchema),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema),
};
