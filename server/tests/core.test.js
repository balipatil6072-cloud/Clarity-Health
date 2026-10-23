const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DEMO_MODE = 'true';
process.env.JWT_SECRET = 'test-secret-with-enough-randomness';
const store = require('../src/services/store');
const { rangeStatus, buildDeterministicAnalysis, buildTrends } = require('../src/services/analysis');
const { extractResults, isMedicalReport, sourceSupportsResult } = require('../src/services/reportParser');
const { app } = require('../src/app');

let server;
let base;
let patient;
let doctor;
let patientCookie;
let demoCredentials;

before(async () => {
  store.setDatabaseEnabled(false);
  for (const key of Object.keys(store.memory)) store.memory[key] = [];
  const seeded = await store.seedDemo();
  [patient, doctor] = seeded.users;
  demoCredentials = store.getDemoCredentials();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoCredentials.find((x) => x.role === 'patient')) });
  assert.equal(login.status, 200);
  patientCookie = login.headers.getSetCookie()[0].split(';')[0];
});

after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

test('range comparison leaves missing reference ranges unknown', () => {
  assert.equal(rangeStatus(10, ''), 'unknown');
  assert.equal(rangeStatus(10, '5 - 15'), 'within');
  assert.equal(rangeStatus(4, '5 - 15'), 'low');
  assert.equal(rangeStatus(16, '5 - 15'), 'high');
});

test('report parser extracts only supported test rows from a marked medical report', () => {
  const source = 'Central Hospital Laboratory Report\nPatient ID: 12345\nHemoglobin 13.4 g/dL 12.0 - 16.0\nWBC 7.2 10^3/uL 4.0 - 11.0\nRevenue 500 0 - 1000';
  assert.equal(isMedicalReport(source), true);
  const rows = extractResults(source);
  assert.deepEqual(rows.map((row) => row.testName), ['Hemoglobin', 'White blood cell count']);
  assert.equal(rows[0].value, 13.4);
  assert.equal(rows[0].unit, 'g/dL');
  assert.equal(rows[0].referenceRange, '12.0 - 16.0');
  assert.equal(rows[1].unit, '10^3/uL');
  assert.equal(sourceSupportsResult(source, rows[0]), true);
  assert.equal(sourceSupportsResult(source, { ...rows[0], value: 999 }), false);
});

test('report parser does not treat arbitrary document rows as medical results', () => {
  const source = 'Annual account summary\nRevenue 500 0 - 1000\nCustomer balance 120 0 - 200';
  assert.equal(isMedicalReport(source), false);
  assert.deepEqual(extractResults(source), []);
});

test('deterministic analysis stays attached to supplied values and source', () => {
  const output = buildDeterministicAnalysis({ originalFilename: 'panel.pdf', reportDate: '2026-01-10', results: [{ testName: 'Example', value: 16, unit: 'mg/dL', referenceRange: '5 - 15' }, { testName: 'Unranged', value: 2, unit: '', referenceRange: '' }] });
  assert.equal(output.provider, 'rules-demo');
  assert.equal(output.findings[0].status, 'high');
  assert.equal(output.findings[1].status, 'unknown');
  assert.match(output.findings[0].evidenceSource, /panel.pdf/);
  assert.equal(output.findings[0].clinicianReviewRequired, true);
});

test('trend comparisons use compatible test names and units', () => {
  const output = buildTrends([
    { _id: 'r1', reportDate: '2026-01-01', originalFilename: 'one.pdf', results: [{ testName: 'Glucose', value: 90, unit: 'mg/dL', status: 'high' }] },
    { _id: 'r2', reportDate: '2026-02-01', originalFilename: 'two.pdf', results: [{ testName: 'Glucose', value: 95, unit: 'mg/dL', status: 'high' }, { testName: 'Glucose', value: 5.2, unit: 'mmol/L', status: 'high' }] },
  ]);
  const glucose = output.find((x) => x.testName === 'Glucose');
  assert.equal(glucose.comparison.change, 5);
  assert.equal(glucose.rows.length, 2);
  assert.equal(glucose.comparison.state, 'change-over-time');
  assert.deepEqual(glucose.incompatibleUnits, ['mmol/L']);
  assert.equal(glucose.pattern, 'repeated-out-of-range-values');
});

test('register never accepts a self-selected privileged role', async () => {
  const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Patient', email: 'new.patient@example.test', password: 'long-enough-password', role: 'admin' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.role, 'patient');
});

test('patient ownership checks block access to another patient and doctor records', async () => {
  const other = await store.createUser({ name: 'Other Patient', email: 'other@example.test', role: 'patient', status: 'active', passwordHash: 'not-used', doctorPatientIds: [] });
  const otherPatient = await fetch(`${base}/patients/${store.id(other)}/timeline`, { headers: { Cookie: patientCookie } });
  assert.equal(otherPatient.status, 403);
  const doctorRecord = await fetch(`${base}/patients/${store.id(doctor)}/timeline`, { headers: { Cookie: patientCookie } });
  assert.equal(doctorRecord.status, 403);
});

test('assigned doctor can read the demo patient timeline and patient upload rejects a missing file', async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoCredentials.find((x) => x.role === 'doctor')) });
  const doctorCookie = login.headers.getSetCookie()[0].split(';')[0];
  const allowed = await fetch(`${base}/patients/${store.id(patient)}/timeline`, { headers: { Cookie: doctorCookie } });
  assert.equal(allowed.status, 200);
  const missing = await fetch(`${base}/reports/upload`, { method: 'POST', headers: { Cookie: patientCookie }, body: new FormData() });
  assert.equal(missing.status, 400);
});

test('synthetic image upload supports manual results, analysis, and clinician review', async () => {
  const unconfirmedForm = new FormData();
  unconfirmedForm.set('reportDate', '2026-03-12');
  unconfirmedForm.set('file', new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'unconfirmed.png');
  const rejectedUpload = await fetch(`${base}/reports/upload`, { method: 'POST', headers: { Cookie: patientCookie }, body: unconfirmedForm });
  assert.equal(rejectedUpload.status, 400);

  const form = new FormData();
  form.set('reportDate', '2026-03-12');
  form.set('reportType', 'Laboratory report');
  form.set('medicalReportConfirmed', 'true');
  form.set('file', new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'synthetic-panel.png');
  const uploaded = await fetch(`${base}/reports/upload`, { method: 'POST', headers: { Cookie: patientCookie }, body: form });
  assert.equal(uploaded.status, 201);
  const report = (await uploaded.json()).report;
  assert.equal(report.processingStatus, 'manual-entry');
  assert.equal(report.storageKey, undefined);
  const unconfirmed = await fetch(`${base}/reports/${report._id}/results`, { method: 'PATCH', headers: { Cookie: patientCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [{ testName: 'Hemoglobin', value: 17, unit: 'g/dL', referenceRange: '5 - 15' }] }) });
  assert.equal(unconfirmed.status, 400);
  const unsupported = await fetch(`${base}/reports/${report._id}/results`, { method: 'PATCH', headers: { Cookie: patientCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceConfirmed: true, results: [{ testName: 'Revenue', value: 17, unit: '', referenceRange: '' }] }) });
  assert.equal(unsupported.status, 400);
  const corrected = await fetch(`${base}/reports/${report._id}/results`, { method: 'PATCH', headers: { Cookie: patientCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceConfirmed: true, results: [{ testName: 'Hemoglobin', value: 17, unit: 'g/dL', referenceRange: '5 - 15' }] }) });
  assert.equal(corrected.status, 200);
  const response = await fetch(`${base}/reports/${report._id}/analyze`, { method: 'POST', headers: { Cookie: patientCookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201);
  const analysis = (await response.json()).analysis;
  assert.equal(analysis.findings[0].status, 'high');
  assert.match(analysis.findings[0].uncertainty, /not checked by OCR/i);
  assert.match(analysis.findings[0].evidenceSource, /synthetic-panel.png/);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoCredentials.find((x) => x.role === 'doctor')) });
  const doctorCookie = login.headers.getSetCookie()[0].split(';')[0];
  const reviewed = await fetch(`${base}/analyses/${analysis._id}/review`, { method: 'POST', headers: { Cookie: doctorCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote: 'Synthetic demonstration review', status: 'reviewed' }) });
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).analysis.reviewStatus, 'reviewed');
  const deleted = await fetch(`${base}/reports/${report._id}`, { method: 'DELETE', headers: { Cookie: patientCookie } });
  assert.equal(deleted.status, 200);
});
