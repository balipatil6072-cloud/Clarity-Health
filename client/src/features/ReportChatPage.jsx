import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, Info, MessageCircle, Send, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api';

const dateFmt = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable';

export default function ReportChatPage() {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports').then(({ data }) => {
      const items = data.reports || [];
      setReports(items);
      if (items[0]) {
        setSelectedId(items[0]._id);
        setMessages([{ role: 'assistant', content: 'Ask about the values or report text shown in the selected file. I will use that report only.' }]);
      }
    }).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const selected = reports.find((item) => item._id === selectedId);
  const chooseReport = (id) => {
    setSelectedId(id);
    setMessages([{ role: 'assistant', content: 'Ask about the values or report text shown in the selected file. I will use that report only.' }]);
    setError('');
  };

  const ask = async (event, suggestedQuestion) => {
    if (event) event.preventDefault();
    const text = String(suggestedQuestion || question).trim();
    if (!selectedId || !text || busy) return;
    const history = messages.slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((previous) => [...previous, { role: 'user', content: text }]);
    setQuestion('');
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/chat', { reportId: selectedId, message: text, history });
      setMessages((previous) => [...previous, { role: 'assistant', content: data.answer, evidence: data.evidence || [], provider: data.provider }]);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return <>
    <div className="page-header"><div><span className="eyebrow">REPORT QUESTION HELPER</span><h1>Ask about your report</h1><p>Get a plain-language explanation grounded in one report you select.</p></div></div>
    <div className="notice-box"><Info size={18} /><p><b>This report helper is not a live doctor.</b> When a server AI key is configured, it uses a language model with the selected report context. Without a key, answers are deterministic and use only saved report data. It cannot diagnose, prescribe, or rule out emergencies. For urgent symptoms, contact local emergency services.</p></div>
    {error && <div className="inline-error"><AlertCircle size={16} />{error}</div>}
    {loading ? <div className="panel skeleton-card" /> : !reports.length ? <section className="panel"><div className="empty-state"><span className="empty-icon"><FileText size={23} /></span><h2>Upload a report to start</h2><p>The assistant will answer from your selected saved report, not from sample patient results.</p><Link className="button button-primary" to="/app/upload">Upload report <ArrowRight size={15} /></Link></div></section> : <>
      <section className="panel report-chat-context">
        <div className="chat-context-icon"><FileText size={19} /></div>
        <label><span className="micro-label">SELECTED SOURCE REPORT</span><select value={selectedId} onChange={(event) => chooseReport(event.target.value)}>{reports.map((item) => <option key={item._id} value={item._id}>{item.originalFilename} · {dateFmt(item.reportDate)}</option>)}</select></label>
        <div className="chat-context-facts"><b>{selected?.results?.length || 0} saved lab results</b><span>{selected?.documentSummary ? 'Report text summary available' : selected?.results?.length ? 'Answers use these saved values' : 'No saved result values'}</span></div>
      </section>
      <section className="panel report-chat-panel">
        <div className="chat-title"><span className="chat-avatar"><Sparkles size={17} /></span><div><h2>Clarity report helper</h2><p>Answers use only the selected report and the conversation above.</p></div><span className="chat-ai-badge">REPORT GROUNDED</span></div>
        <div className="chat-messages" role="log" aria-live="polite">
          {messages.map((item, index) => <article className={'chat-message ' + item.role} key={index}><span className="chat-message-avatar">{item.role === 'assistant' ? <Sparkles size={14} /> : 'You'}</span><div className="chat-bubble"><p>{item.content}</p>{item.provider && <small className="chat-mode">{item.provider === 'openai-compatible' ? 'AI-generated from selected report context' : item.provider === 'source-checked-fallback' ? 'Source-checked answer from selected report data' : item.provider === 'safety-rule' ? 'Urgent-care guidance' : 'Demo answer from selected report data'}</small>}{item.evidence?.length > 0 && <div className="chat-evidence"><b>Report source</b>{item.evidence.map((source, sourceIndex) => <small key={sourceIndex}>{source}</small>)}</div>}</div></article>)}
          {busy && <div className="chat-thinking"><span /> Reading the selected report context…</div>}
        </div>
        <div className="chat-suggestions"><span>Try asking</span>{selected?.results?.[0] && <button type="button" disabled={busy} onClick={() => ask(null, 'What does ' + selected.results[0].testName + ' show in this report?')}>What does {selected.results[0].testName} show?</button>}<button type="button" disabled={busy} onClick={() => ask(null, 'Which reference ranges are printed in this report?')}>What reference ranges are printed?</button></div>
        <form className="report-chat-form" onSubmit={(event) => ask(event)}><label className="sr-only" htmlFor="report-question">Ask about the selected report</label><input id="report-question" value={question} maxLength={1200} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a result in this report…" disabled={busy} /><button className="button button-primary" type="submit" disabled={busy || !question.trim()} aria-label="Send question">{busy ? 'Sending…' : 'Ask'} <Send size={15} /></button></form>
        <div className="chat-privacy"><MessageCircle size={14} /> Chat history is kept in this page session. The server sends only the selected report context to the configured AI provider.</div>
      </section>
    </>}
  </>;
}
