// Conservative text parser for common laboratory reports. Unknown labels are
// deliberately ignored so tables, invoices, and other PDFs cannot become labs.
const TESTS = [
  { name: 'Hemoglobin', aliases: ['hemoglobin', 'haemoglobin', 'hb'] },
  { name: 'White blood cell count', aliases: ['white blood cell count', 'white blood cells', 'wbc', 'total leukocyte count', 'tlc'] },
  { name: 'Red blood cell count', aliases: ['red blood cell count', 'red blood cells', 'rbc'] },
  { name: 'Platelet count', aliases: ['platelet count', 'platelets'] },
  { name: 'Hematocrit', aliases: ['hematocrit', 'haematocrit', 'packed cell volume', 'pcv'] },
  { name: 'MCV', aliases: ['mean corpuscular volume', 'mcv'] },
  { name: 'MCH', aliases: ['mean corpuscular hemoglobin', 'mean corpuscular haemoglobin', 'mch'] },
  { name: 'MCHC', aliases: ['mean corpuscular hemoglobin concentration', 'mean corpuscular haemoglobin concentration', 'mchc'] },
  { name: 'Neutrophils', aliases: ['neutrophils', 'neutrophil'] },
  { name: 'Lymphocytes', aliases: ['lymphocytes', 'lymphocyte'] },
  { name: 'Monocytes', aliases: ['monocytes', 'monocyte'] },
  { name: 'Eosinophils', aliases: ['eosinophils', 'eosinophil'] },
  { name: 'Basophils', aliases: ['basophils', 'basophil'] },
  { name: 'Glucose', aliases: ['fasting blood glucose', 'fasting glucose', 'blood glucose', 'glucose'] },
  { name: 'HbA1c', aliases: ['glycated hemoglobin', 'glycated haemoglobin', 'hba1c', 'a1c'] },
  { name: 'Total cholesterol', aliases: ['total cholesterol', 'cholesterol, total'] },
  { name: 'LDL cholesterol', aliases: ['ldl cholesterol', 'ldl'] },
  { name: 'HDL cholesterol', aliases: ['hdl cholesterol', 'hdl'] },
  { name: 'Triglycerides', aliases: ['triglycerides', 'triglyceride'] },
  { name: 'Creatinine', aliases: ['serum creatinine', 'creatinine'] },
  { name: 'Urea', aliases: ['blood urea nitrogen', 'bun', 'urea'] },
  { name: 'ALT', aliases: ['alanine aminotransferase', 'sgpt', 'alt'] },
  { name: 'AST', aliases: ['aspartate aminotransferase', 'sgot', 'ast'] },
  { name: 'Sodium', aliases: ['sodium', 'na+'] },
  { name: 'Potassium', aliases: ['potassium', 'k+'] },
  { name: 'Chloride', aliases: ['chloride', 'cl-'] },
  { name: 'Calcium', aliases: ['calcium'] },
  { name: 'TSH', aliases: ['thyroid stimulating hormone', 'tsh'] },
  { name: 'Vitamin D', aliases: ['25-hydroxy vitamin d', '25-oh vitamin d', 'vitamin d'] },
  { name: 'Vitamin B12', aliases: ['vitamin b12', 'vitamin b-12', 'cobalamin'] },
  { name: 'C-reactive protein', aliases: ['c-reactive protein', 'c reactive protein', 'crp'] },
  { name: 'ESR', aliases: ['erythrocyte sedimentation rate', 'esr'] },
  { name: 'Uric acid', aliases: ['uric acid'] },
  { name: 'Albumin', aliases: ['albumin'] },
  { name: 'Total bilirubin', aliases: ['total bilirubin', 'bilirubin, total'] },
];

const aliases = TESTS.flatMap((test) => test.aliases.map((alias) => ({ ...test, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numberPattern = '[+-]?\\d[\\d,]*(?:\\.\\d+)?';

function canonicalTestName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases.find((entry) => entry.alias.toLowerCase() === normalized)?.name || null;
}

function parseResultLine(line) {
  for (const item of aliases) {
    const label = escapeRegex(item.alias).replace(/\s+/g, '\\s+');
    const match = line.match(new RegExp(`^\\s*${label}(?=\\s|:|\\t|$)\\s*(?::|\\t|\\s)+([<>]=?\\s*${numberPattern}|${numberPattern})(.*)$`, 'i'));
    if (!match) continue;
    const rawValue = match[1].replace(/\s/g, '').replace(/,/g, '');
    const value = /^[<>]/.test(rawValue) ? rawValue : Number(rawValue);
    const tail = match[2] || '';
    const rangeMatch = tail.match(new RegExp(`(${numberPattern})\\s*(?:-|–|—|to)\\s*(${numberPattern})`, 'i'));
    const referenceRange = rangeMatch ? `${rangeMatch[1]} - ${rangeMatch[2]}` : '';
    const withoutRange = rangeMatch ? tail.replace(rangeMatch[0], ' ') : tail;
    const unit = withoutRange.match(/(?:^|\s)(10\^?\d+\s*\/\s*[a-zA-Zµμ]+|%|[a-zA-Zµμ]+(?:\s*\/\s*[a-zA-Zµμ]+)?(?:\^?\d+)?)(?=\s|$)/)?.[1]?.replace(/\s/g, '') || '';
    return { testName: item.name, value, unit, referenceRange, status: 'unknown', confidence: 0.7, sourceExcerpt: line.trim().slice(0, 400) };
  }
  return null;
}

function extractResults(text) {
  const found = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const result = parseResultLine(line);
    if (result && !found.has(result.testName)) found.set(result.testName, result);
  }
  return [...found.values()];
}

function isMedicalReport(text) {
  const source = String(text || '');
  const hasReportMarker = /\b(?:laboratory|lab|pathology|radiology|imaging|medical|clinical)\s+(?:test\s+)?(?:report|results?|record|note)\b|\bpatient\s*(?:name|id|no\.?|number)\s*[:#]|\bspecimen\s*(?:type|id|no\.?)?\s*[:#]?|\bdiagnostic\s+(?:centre|center|report)\b|\bhospital\s+(?:record|report|number)\b/i.test(source);
  const hasClinicalContext = /\b(?:patient|specimen|reference\s+(?:range|interval)|test\s+results?|laboratory|pathology|radiology|clinical|diagnos(?:is|tic)|hospital|clinic)\b/i.test(source);
  return hasReportMarker && hasClinicalContext;
}

function sourceSupportsResult(text, result) {
  const canonical = canonicalTestName(result.testName);
  if (!canonical) return false;
  const numericValue = String(result.value).replace(/,/g, '').trim();
  const candidates = extractResults(text).filter((item) => item.testName === canonical);
  return candidates.some((item) => String(item.value) === numericValue);
}

module.exports = { TESTS, canonicalTestName, parseResultLine, extractResults, isMedicalReport, sourceSupportsResult };
