function rangeStatus(value, range) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !range) return 'unknown';
  const nums = String(range).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (nums.length >= 2) return value < Math.min(nums[0], nums[1]) ? 'low' : value > Math.max(nums[0], nums[1]) ? 'high' : 'within';
  if (nums.length === 1) return value > nums[0] ? 'high' : 'unknown';
  return 'unknown';
}

const explain = (status) => {
  if (status === 'unknown') return 'A stated numeric reference range was not available, so this result cannot be classified against a range.';
  if (status === 'within') return 'This value falls within the reference range printed on this report. Reference ranges are not a complete assessment of health.';
  return `This value is ${status} the reference range printed on this report. A single result does not establish a diagnosis and should be interpreted in context.`;
};

function numbersAreSourceBacked(text, report) {
  const source = JSON.stringify({
    results: (report.results || []).map(({ value, referenceRange, evidenceQuote }) => ({ value, referenceRange, evidenceQuote })),
    observations: (report.documentFindings || []).map(({ evidenceQuote }) => ({ evidenceQuote })),
  });
  const allowed = new Set((source.match(/\d+(?:[,.]\d+)*/g) || []).map((value) => value.replace(/,/g, '')));
  return (String(text || '').match(/\d+(?:[,.]\d+)*/g) || []).every((value) => allowed.has(value.replace(/,/g, '')));
}

function buildDeterministicAnalysis(report) {
  const results = report.results || [];
  const testFindings = results.map((result) => {
    const status = rangeStatus(Number(result.value), result.referenceRange);
    const aiExtracted = report.extractionMethod?.startsWith('ai-vision');
    return {
      testName: result.testName, observedValue: result.value, unit: result.unit || '',
      referenceRange: result.referenceRange || '', status,
      interpretation: explain(status),
      evidenceSource: `${report.originalFilename}${result.sourcePage ? ` | page ${result.sourcePage}` : ''}`,
      evidenceQuote: result.evidenceQuote || '', sourcePage: result.sourcePage, confidence: result.confidence,
      uncertainty: report.extractionMethod === 'manual-image'
        ? 'This value was manually transcribed and not checked by OCR. Verify it against the original image.'
        : aiExtracted
          ? 'A vision model extracted this value. Verify it against the original report before relying on it.'
          : status === 'unknown'
            ? 'Unable to compare because a numeric reference range or numeric result is missing.'
            : 'Interpretation is limited to the stated reference range and extracted value.',
      recommendedNextSteps: status === 'high' || status === 'low'
        ? ['Discuss this result with your clinician, who can interpret it with your history and other findings.']
        : ['Keep this result with your medical history and discuss questions at your next appointment.'],
      clinicianReviewRequired: true,
    };
  });
  const documentFindings = (report.documentFindings || []).map((item, index) => ({
    testName: `Report observation ${index + 1}`, observedValue: item.text, unit: '', referenceRange: '', status: 'unknown',
    interpretation: 'This is a plain-language rendering of text detected in the uploaded report. Verify the wording against the original document with a clinician.',
    evidenceSource: `${report.originalFilename}${item.sourcePage ? ` | page ${item.sourcePage}` : ''}`,
    evidenceQuote: item.evidenceQuote || '', sourcePage: item.sourcePage, confidence: item.confidence,
    uncertainty: item.confidence < 0.7 ? 'Extraction confidence is low. Verify the source wording before relying on it.' : 'This observation was extracted from report text and is not an independent diagnosis.',
    recommendedNextSteps: ['Ask your clinician to explain this statement in the context of your history and the full report.'],
    clinicianReviewRequired: true,
  }));
  const findings = [...testFindings, ...documentFindings];
  const flagged = testFindings.filter((finding) => finding.status === 'high' || finding.status === 'low').length;
  const resultSummary = results.length
    ? `${results.length} result${results.length === 1 ? '' : 's'} reviewed against the reference ranges printed on this report. ${flagged ? `${flagged} value${flagged === 1 ? '' : 's'} fall outside those stated ranges.` : 'No value falls outside those stated ranges.'}`
    : findings.length ? 'No supported numeric lab values were extracted. The observations below are source-linked report text and need clinician review.' : 'No structured findings were available to analyze.';
  const summary = [report.documentSummary, resultSummary].filter(Boolean).join(' ');
  return {
    summary: `${summary} This informational summary is not a diagnosis and cannot rule out an emergency.`,
    findings,
    suggestedNextSteps: ['Review the source report and discuss its results with a qualified clinician.'],
    questionsForClinician: report.questionsForClinician || [],
    extractionLimitations: report.extractionLimitations || '',
    provider: 'rules-demo', model: 'deterministic-reference-range-v1', version: 1,
  };
}

async function analyzeWithProvider(report, apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1') {
  const local = buildDeterministicAnalysis(report);
  if (!apiKey) return local;
  const prompt = {
    role: 'user',
    content: JSON.stringify({
      instruction: 'Return JSON only with keys summary, findings, suggestedNextSteps, questionsForClinician. Explain only facts present in this one supplied report. Do not use synthetic examples or other patients. Never diagnose, prescribe, say normal when a reference range is absent, or invent evidence. Keep uncertainty visible. Preserve each finding testName, observedValue, unit, referenceRange, status, evidenceSource and evidenceQuote exactly as supplied. Recommendations must be conservative and point to clinician discussion.',
      report: {
        reportDate: report.reportDate, reportType: report.reportType, originalFilename: report.originalFilename,
        documentSummary: report.documentSummary || '', documentFindings: report.documentFindings || [],
        extractionLimitations: report.extractionLimitations || '',
      },
      groundedFindings: local.findings,
    }),
  };
  const providerError = (message) => Object.assign(new Error('Configured analysis provider request failed.'), { status: 502, publicMessage: message });
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model, temperature: 0.1, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You provide cautious, source-grounded explanations of the one supplied medical report for clinician review. You are not a doctor. Do not introduce facts, values, diagnoses, or treatment advice.' },
          prompt,
        ],
      }),
    });
  } catch { throw providerError('Could not reach the configured analysis provider. Check server connectivity and try again.'); }
  if (!response.ok) throw providerError('The configured analysis provider is unavailable or rejected the request. Check server configuration and try again.');
  let body;
  try { body = await response.json(); } catch { throw providerError('The configured analysis provider returned an unreadable response. Try again.'); }
  let parsed;
  try { parsed = JSON.parse(body.choices?.[0]?.message?.content || '{}'); } catch { throw providerError('The configured analysis provider returned an invalid response. Try again.'); }
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings) || parsed.findings.length !== local.findings.length) throw providerError('The configured analysis provider returned an invalid response. Try again.');
  const unsafeText = /\b(you (?:may |might |probably )?have|diagnos(?:e|is|ed|tic)|prescrib(?:e|ed|ing)|dosage|dose|treatment|stop taking|discontinue (?:your )?medication|start taking|change your medication)\b/i;
  const findings = parsed.findings.map((finding, index) => {
    const original = local.findings[index];
    const interpretation = String(finding.interpretation || '').slice(0, 1200);
    const steps = Array.isArray(finding.recommendedNextSteps)
      ? finding.recommendedNextSteps.filter((item) => typeof item === 'string' && item.length <= 300 && !unsafeText.test(item) && numbersAreSourceBacked(item, report)).slice(0, 4)
      : [];
    const uncertainty = String(finding.uncertainty || original.uncertainty).slice(0, 800);
    return {
      ...original,
      interpretation: interpretation && !unsafeText.test(interpretation) && numbersAreSourceBacked(interpretation, report) ? interpretation : original.interpretation,
      uncertainty: numbersAreSourceBacked(uncertainty, report) ? uncertainty : original.uncertainty,
      recommendedNextSteps: steps.length ? steps : original.recommendedNextSteps,
    };
  });
  const summary = parsed.summary.length <= 1800 && !unsafeText.test(parsed.summary) && numbersAreSourceBacked(parsed.summary, report) ? parsed.summary : local.summary;
  const suggestedNextSteps = Array.isArray(parsed.suggestedNextSteps)
    ? parsed.suggestedNextSteps.filter((item) => typeof item === 'string' && item.length <= 300 && !unsafeText.test(item) && numbersAreSourceBacked(item, report)).slice(0, 8)
    : [];
  const questionsForClinician = Array.isArray(parsed.questionsForClinician)
    ? parsed.questionsForClinician.filter((item) => typeof item === 'string' && item.length <= 240).slice(0, 8)
    : [];
  return {
    ...local, summary, findings,
    suggestedNextSteps: suggestedNextSteps.length ? suggestedNextSteps : local.suggestedNextSteps,
    questionsForClinician: questionsForClinician.length ? questionsForClinician : local.questionsForClinician,
    provider: 'openai-compatible', model,
  };
}

function buildTrends(reports) {
  const points = new Map();
  reports.forEach((report) => (report.results || []).forEach((result) => {
    if (typeof result.value !== 'number' || !Number.isFinite(result.value)) return;
    const key = result.testName.trim().toLowerCase();
    const values = points.get(key) || { testName: result.testName, unit: result.unit || '', rows: [], incompatibleUnits: [] };
    if (values.unit === (result.unit || '')) values.rows.push({ date: report.reportDate, value: result.value, status: result.status || 'unknown', referenceRange: result.referenceRange || '', source: report.originalFilename, reportId: String(report._id || report.id) });
    else if (!values.incompatibleUnits.includes(result.unit || '(unit not stated)')) values.incompatibleUnits.push(result.unit || '(unit not stated)');
    points.set(key, values);
  }));
  return [...points.values()].filter((item) => item.rows.length).map((item) => {
    const rows = item.rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    const outOfRangeCount = rows.filter((row) => row.status === 'high' || row.status === 'low').length;
    return { ...item, rows, outOfRangeCount, pattern: outOfRangeCount > 1 ? 'repeated-out-of-range-values' : outOfRangeCount === 1 ? 'single-out-of-range-value' : 'no-out-of-range-values', comparison: rows.length < 2 ? { state: 'insufficient-data' } : { state: 'change-over-time', previous: rows.at(-2), latest: rows.at(-1), change: Number((rows.at(-1).value - rows.at(-2).value).toFixed(3)) } };
  });
}

module.exports = { rangeStatus, buildDeterministicAnalysis, analyzeWithProvider, buildTrends };
