import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, FileText, Info, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import api from '../api';

const dateFmt = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable';

export default function UploadPage({ notify }) {
  const [report, setReport] = useState(null);
  const [file, setFile] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState('Laboratory report');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [medicalConfirmed, setMedicalConfirmed] = useState(false);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const navigate = useNavigate();
  const maxUploadMb = Number(import.meta.env.VITE_MAX_UPLOAD_MB || 10);
  const ephemeralUploads = import.meta.env.VITE_EPHEMERAL_REPORT_UPLOADS === 'true';
  const isImageFile = Boolean(file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)));
  const requiresSourceConfirmation = report && (report.extractionMethod === 'manual-image' || report.extractionMethod?.startsWith('ai-vision'));
  const hasReportContext = report && (report.results?.length || report.documentSummary || report.documentFindings?.length || report.extractionMethod === 'manual-image');

  const uploadFile = async (event) => {
    event.preventDefault();
    if (!file) return setError('Choose a report file first.');
    if (file.size > maxUploadMb * 1024 * 1024) return setError('Choose a file no larger than ' + maxUploadMb + ' MB.');
    if (isImageFile && !medicalConfirmed) return setError('Confirm that this is a hospital or clinic report before uploading.');
    setBusy(true); setError('');
    const body = new FormData();
    body.append('file', file); body.append('reportDate', date); body.append('reportType', type);
    body.append('medicalReportConfirmed', String(medicalConfirmed));
    try {
      const response = await api.post('/reports/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setReport(response.data.report);
      setResults(response.data.report.results?.length ? response.data.report.results : (response.data.report.extractionMethod === 'manual-image' ? [{ testName: '', value: '', unit: '', referenceRange: '' }] : []));
      setSourceConfirmed(false);
      notify(response.data.message);
    } catch (uploadError) { setError(uploadError.message); }
    finally { setBusy(false); }
  };

  const setResult = (index, key, value) => setResults((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  const addRow = () => setResults((previous) => [...previous, { testName: '', value: '', unit: '', referenceRange: '', evidenceQuote: '' }]);
  const analyze = async () => {
    if (!report) return;
    if (requiresSourceConfirmation && !sourceConfirmed) return setError('Check each extracted or transcribed value against the original report and confirm it first.');
    setBusy(true); setError('');
    try {
      const saved = results.filter((row) => row.testName && String(row.value).trim()).map((row) => ({
        testName: row.testName,
        value: row.value !== '' && Number.isFinite(Number(row.value)) ? Number(row.value) : String(row.value),
        unit: row.unit || '', referenceRange: row.referenceRange || '',
        ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
        ...(row.sourcePage === undefined ? {} : { sourcePage: row.sourcePage }),
        ...(row.evidenceQuote ? { evidenceQuote: row.evidenceQuote } : {}),
      }));
      if (saved.length || results.length || report.results?.length || report.extractionMethod === 'manual-image') await api.patch('/reports/' + report._id + '/results', { results: saved, sourceConfirmed });
      const response = await api.post('/reports/' + report._id + '/analyze');
      notify('Source-linked analysis is ready for review.');
      navigate('/app/analysis/' + response.data.analysis._id);
    } catch (analysisError) { setError(analysisError.message); }
    finally { setBusy(false); }
  };

  return <>
    <div className="page-header"><div><span className="eyebrow">REPORT WORKSPACE</span><h1>Add a report</h1><p>Upload a document, review what was extracted, and keep its source attached.</p></div></div>
    <div className="notice-box"><Info size={18} /><p><b>Educational decision support only.</b> Clarity does not diagnose or replace a qualified clinician. Only upload records you are authorized to share. When configured, the server sends the selected report to its AI provider for document reading.</p></div>
    {!report ? <div className="panel upload-panel">
      <div className="upload-heading"><div className="upload-step-num">1</div><div><h2>Choose a report</h2><p>With server-side AI configured, PDFs and report photos are read from the uploaded source. Without it, text PDFs use the local parser and photos require manual transcription.</p></div></div>
      <form onSubmit={uploadFile} className="form-stack upload-form">
        <label className="drop-zone"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setMedicalConfirmed(false); setError(''); }} /><span className="upload-symbol"><Upload size={22} /></span><b>{file ? file.name : 'Choose a PDF or image'}</b><span>PDF, PNG, JPEG, or WebP · up to {maxUploadMb} MB</span></label>
        {isImageFile && <label className="check-row"><input type="checkbox" checked={medicalConfirmed} onChange={(event) => setMedicalConfirmed(event.target.checked)} /><span>This is a hospital or clinic report that I am authorized to upload.</span></label>}
        <div className="form-row"><label>Report date<input type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Category<select value={type} onChange={(event) => setType(event.target.value)}><option>Laboratory report</option><option>Imaging report</option><option>Clinical note</option><option>Other medical report</option></select></label></div>
        {error && <div className="inline-error"><AlertCircle size={16} />{error}</div>}
        <div className="upload-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Reading report…' : 'Upload and review'} <ArrowRight size={16} /></button><small>{ephemeralUploads ? 'Vercel processes the upload temporarily, then removes the original file.' : 'Files are stored privately and are never served as public web files.'}</small></div>
      </form>
    </div> : <div className="panel results-panel">
      <div className="upload-heading"><div className="upload-step-num">2</div><div><h2>Review report content</h2><p>{report.originalFilename} · {dateFmt(report.reportDate)}</p></div><span className="status-pill neutral">{report.processingStatus === 'complete' ? 'Check source' : 'Needs review'}</span></div>
      <div className="extraction-callout"><Info size={17} /><span>{report.extractionMethod?.startsWith('ai-vision') ? 'AI vision read this uploaded file. Values and notes below are candidate extractions, not verified facts. Compare every item with the original before continuing.' : report.extractionMethod === 'manual-image' ? 'No OCR provider is configured. No image values were invented; transcribe the report yourself and confirm them.' : report.results?.length ? 'These values came from supported rows in selectable PDF text. Check each value and quote against the original report.' : 'No supported lab rows were found in this PDF. Add only values you can verify directly from the source.'}</span></div>
      {report.documentSummary && <div className="report-summary-preview"><span className="micro-label">SOURCE-BASED REPORT SUMMARY</span><p>{report.documentSummary}</p>{report.extractionLimitations && <small>Extraction limits: {report.extractionLimitations}</small>}</div>}
      {report.documentFindings?.length > 0 && <div className="report-observations"><h3>Report statements to verify</h3>{report.documentFindings.map((item, index) => <blockquote key={index}><p>{item.text}</p><small>{item.evidenceQuote}{item.sourcePage ? ' · page ' + item.sourcePage : ''}</small></blockquote>)}</div>}
      {(report.results?.length || report.extractionMethod === 'manual-image' || report.reportType === 'Laboratory report') ? <>
        <div className="result-editor"><div className="result-editor-head"><span>TEST</span><span>RESULT</span><span>UNIT</span><span>REFERENCE RANGE</span><span /></div>
          {results.map((row, index) => <div className="result-edit-wrap" key={index}><div className="result-edit-row"><input aria-label="Test name" placeholder="e.g. Hemoglobin" value={row.testName} onChange={(event) => setResult(index, 'testName', event.target.value)} /><input aria-label="Result value" placeholder="Value" value={row.value} onChange={(event) => setResult(index, 'value', event.target.value)} /><input aria-label="Unit" placeholder="e.g. g/dL" value={row.unit} onChange={(event) => setResult(index, 'unit', event.target.value)} /><input aria-label="Reference range" placeholder="e.g. 12.0 - 16.0" value={row.referenceRange} onChange={(event) => setResult(index, 'referenceRange', event.target.value)} /><button type="button" className="icon-button remove-row" onClick={() => setResults(results.filter((_, rowIndex) => rowIndex !== index))} aria-label="Remove result"><X size={16} /></button></div>{row.evidenceQuote && <small className="result-evidence">Source text: “{row.evidenceQuote}”{row.sourcePage ? ' · page ' + row.sourcePage : ''}</small>}</div>)}
        </div>
        <button type="button" className="add-result" onClick={addRow}><span>+</span> Add a result from the report</button>
      </> : <div className="empty-inline"><span className="analysis-icon"><FileText size={18} /></span><span>This report has no structured lab results. Its extracted report summary can still be reviewed.</span></div>}
      {requiresSourceConfirmation && <label className="check-row"><input type="checkbox" checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} /><span>I checked the extracted or transcribed values and report text against the original source.</span></label>}
      {error && <div className="inline-error"><AlertCircle size={16} />{error}</div>}
      <div className="upload-actions"><button className="button button-primary" onClick={analyze} disabled={busy || !hasReportContext}>{busy ? 'Creating analysis…' : 'Save values and analyze'} <Sparkles size={16} /></button><button className="button button-quiet" onClick={() => { setReport(null); setFile(null); setMedicalConfirmed(false); setSourceConfirmed(false); }}>Cancel</button></div>
    </div>}
    <div className="upload-privacy"><ShieldCheck size={16} /> Factual values remain separate from explanations and link back to the selected report.</div>
  </>;
}
