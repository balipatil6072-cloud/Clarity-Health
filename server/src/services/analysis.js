function rangeStatus(value, range) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !range) return 'unknown';
  const nums = String(range).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (nums.length >= 2) return value < Math.min(nums[0], nums[1]) ? 'low' : value > Math.max(nums[0], nums[1]) ? 'high' : 'within';
  if (nums.length === 1) return value > nums[0] ? 'high' : 'unknown';
  return 'unknown';
}

const explain = (result, status) => {
  if (status === 'unknown') return 'A stated numeric reference range was not available, so this result cannot be classified against a range.';
  if (status === 'within') return 'This value falls within the reference range printed on this report. Reference ranges are not a complete assessment of health.';
  return `This value is ${status} the reference range printed on this report. A single result does not establish a diagnosis and should be interpreted in context.`;
};

function buildDeterministicAnalysis(report) {
  const results = report.results || [];
  const findings = results.map((r) => {
    const status = rangeStatus(Number(r.value), r.referenceRange);
    return {
      testName: r.testName, observedValue: r.value, unit: r.unit || '', referenceRange: r.referenceRange || '', status,
      interpretation: explain(r, status), evidenceSource: `${report.originalFilename} · ${new Date(report.reportDate).toLocaleDateString('en-GB')}${report.extractionMethod === 'manual-image' ? ' · patient-transcribed; image not OCR-verified' : ''}`,
      uncertainty: report.extractionMethod === 'manual-image' ? `This value was manually transcribed by the patient and was not checked by OCR. Verify it against the original report. ${status === 'unknown' ? 'A numeric reference range is also unavailable.' : 'The comparison uses only the manually supplied value and reference range.'}` : status === 'unknown' ? 'Unable to compare because a numeric reference range or numeric result is missing.' : 'Interpretation is limited to the report-provided reference range and the extracted value.',
      recommendedNextSteps: status === 'high' || status === 'low' ? ['Discuss this result with your clinician, who can interpret it with your history and other findings.'] : ['Keep this result with your medical history and discuss questions at your next appointment.'],
      clinicianReviewRequired: true,
    };
  });
  const flagged = findings.filter((f) => f.status === 'high' || f.status === 'low').length;
  return {
    summary: findings.length ? `${findings.length} result${findings.length === 1 ? '' : 's'} reviewed against the reference ranges printed on this report. ${flagged ? `${flagged} value${flagged === 1 ? '' : 's'} fall outside those stated ranges.` : 'No value falls outside those stated ranges.'}` : 'No structured test results were available to analyze. Add or correct results to continue.',
    findings, suggestedNextSteps: ['Review each result with a qualified clinician. This informational summary is not a diagnosis and cannot rule out an emergency.'], provider: 'rules-demo', model: 'deterministic-reference-range-v1', version: 1,
  };
}

async function analyzeWithProvider(report, apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1') {
  if (!apiKey) return buildDeterministicAnalysis(report);
  const local = buildDeterministicAnalysis(report);
  const prompt = {
    role: 'user', content: JSON.stringify({ instruction: 'Return JSON only with keys summary, findings, suggestedNextSteps. Explain only the supplied test values. Never diagnose, prescribe, say normal when a reference range is absent, or invent evidence. Keep uncertainty visible. Preserve each finding testName, observedValue, unit, referenceRange, status and evidenceSource exactly as supplied.', report: { reportDate: report.reportDate, originalFilename: report.originalFilename }, groundedFindings: local.findings }),
  };
  const providerError = (message) => Object.assign(new Error('Configured analysis provider request failed.'), { status: 502, publicMessage: message });
  let response;
  try { response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You provide cautious informational explanations of supplied laboratory results for clinician review. You are not a doctor. Do not create medical facts.' }, prompt] }) }); }
  catch { throw providerError('Could not reach the configured analysis provider. Check server connectivity and try again.'); }
  if (!response.ok) throw providerError('The configured analysis provider is unavailable or rejected the request. Check server configuration and try again.');
  let body; try { body = await response.json(); } catch { throw providerError('The configured analysis provider returned an unreadable response. Try again.'); }
  let parsed; try { parsed = JSON.parse(body.choices?.[0]?.message?.content || '{}'); } catch { throw providerError('The configured analysis provider returned an invalid response. Try again.'); }
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings) || parsed.findings.length !== local.findings.length) throw providerError('The configured analysis provider returned an invalid response. Try again.');
  const unsafeText = /\b(you have|confirmed diagnosis|diagnosed with|prescrib(?:e|ed|ing)|dosage|stop taking|discontinue (?:your )?medication|start taking|change your medication)\b/i;
  const findings = parsed.findings.map((f, i) => {
    const text = String(f.interpretation || '').slice(0, 1200);
    return { ...local.findings[i], interpretation: text && !unsafeText.test(text) ? text : local.findings[i].interpretation, uncertainty: String(f.uncertainty || local.findings[i].uncertainty).slice(0, 800), recommendedNextSteps: local.findings[i].recommendedNextSteps };
  });
  return { ...local, findings, provider: 'openai-compatible', model };
}

function buildTrends(reports) {
  const points = new Map();
  reports.forEach((report) => (report.results || []).forEach((r) => {
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return;
    const key = r.testName.trim().toLowerCase();
    const values = points.get(key) || { testName: r.testName, unit: r.unit || '', rows: [], incompatibleUnits: [] };
    if (values.unit === (r.unit || '')) values.rows.push({ date: report.reportDate, value: r.value, status: r.status || 'unknown', referenceRange: r.referenceRange || '', source: report.originalFilename, reportId: String(report._id || report.id) });
    else if (!values.incompatibleUnits.includes(r.unit || '(unit not stated)')) values.incompatibleUnits.push(r.unit || '(unit not stated)');
    points.set(key, values);
  }));
  return [...points.values()].filter((x) => x.rows.length).map((x) => {
    const rows=x.rows.sort((a,b)=>new Date(a.date)-new Date(b.date));
    const outOfRangeCount=rows.filter((r)=>r.status==='high'||r.status==='low').length;
    return { ...x, rows, outOfRangeCount, pattern:outOfRangeCount>1?'repeated-out-of-range-values':outOfRangeCount===1?'single-out-of-range-value':'no-out-of-range-values', comparison: rows.length < 2 ? { state: 'insufficient-data' } : { state: 'change-over-time', previous: rows.at(-2), latest: rows.at(-1), change: Number((rows.at(-1).value-rows.at(-2).value).toFixed(3)) } };
  });
}
module.exports = { rangeStatus, buildDeterministicAnalysis, analyzeWithProvider, buildTrends };
