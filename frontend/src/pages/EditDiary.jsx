import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { RichEditor } from '../components/RichEditor';
import { LotusSpinner } from '../components/LotusSpinner';
import { TranslateButtons } from '../components/TranslateButton';
import { sanitizeHtml } from '../utils/sanitize';

export function EditDiary() {
  const { id } = useParams();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState('');
  const [docId, setDocId] = useState(id);
  const docIdRef = useRef(id);
  const creatingRef = useRef(false);
  const [versions, setVersions] = useState(null);
  const [accessibility, setAccessibility] = useState('Private');
  const [submitted, setSubmitted] = useState(false);
  const [comment, setComment] = useState(null);
  const [loaded, setLoaded] = useState(!id);
  const [dirtyFlag, setDirtyFlag] = useState(0);

  useEffect(() => {
    if (id) {
      setLoaded(false);
      Promise.all([
        api.get(`/documents/${id}`),
        api.get(`/documents/${id}/draft`).catch(() => ({ draft: null }))
      ]).then(([doc, draftData]) => {
        setTitle(doc.title);
        setDate(doc.date);
        setDocId(doc.id);
        docIdRef.current = doc.id;
        setAccessibility(doc.accessibility || 'Private');
        setSubmitted(!!doc.submitted);
        setComment(doc.comment != null ? doc.comment : null);
        const draftContent = draftData?.draft;
        setContent(draftContent !== null && draftContent !== undefined ? draftContent : (doc.content || ''));
        setLoaded(true);
      });
    }
  }, [id]);

  // Use ref to prevent duplicate document creation from concurrent calls
  const ensureDoc = async () => {
    if (docIdRef.current) return docIdRef.current;
    if (creatingRef.current) {
      // Wait for the in-flight creation to finish
      while (creatingRef.current) {
        await new Promise(r => setTimeout(r, 50));
      }
      return docIdRef.current;
    }
    creatingRef.current = true;
    try {
      const res = await api.post('/documents', { title: title || '无标题', content: '', date });
      docIdRef.current = res.id;
      setDocId(res.id);
      return res.id;
    } finally {
      creatingRef.current = false;
    }
  };

  const handleDraft = async (text) => {
    const did = await ensureDoc();
    await api.post(`/documents/${did}/draft`, {
      title,
      date,
      content: text,
      accessibility
    });
  };

  const handleSubmit = async (text) => {
    const did = await ensureDoc();
    await api.post(`/documents/${did}/submit`, { title, content: text, date, accessibility });
    setSubmitted(true);
    navigate('/home');
  };

  const handleHistory = async () => {
    const did = docIdRef.current || await ensureDoc();
    const res = await api.get(`/documents/${did}/versions`);
    setVersions(res.versions);
  };

  return (
    <div className="page">
      <header className="top-bar">
        <button className="btn-back" onClick={() => navigate(-1)}>{t('back')}</button>
        <h2>{t('writeDiary')}</h2>
      </header>
      <div className="card">
        <label>{t('titleField')}<input value={title} onChange={(e) => { setTitle(e.target.value); setDirtyFlag(f => f + 1); }} /></label>
        <label>{t('date')}<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setDirtyFlag(f => f + 1); }} /></label>
        {loaded ? (
          <RichEditor
            initialText={content}
            onDraft={handleDraft}
            onSubmit={handleSubmit}
            onHistory={handleHistory}
            submitDisabled={submitted}
            accessibility={accessibility}
            onAccessibilityChange={(val) => {
              // Normal user: check = 'Wait for open' (pending approval), uncheck = 'Private'
              setAccessibility(val === 'Open' ? 'Wait for open' : 'Private');
            }}
            externalDirty={dirtyFlag}
          />
        ) : (
          <LotusSpinner size={90} />
        )}
      </div>
      {comment != null && (
        <div className="card comment-section">
          <h3>{t('comment') || 'Comment'} (SUPER_ADMIN)</h3>
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment) }} />
          <TranslateButtons html={comment} />
        </div>
      )}
      {versions && (
        <div className="card versions-panel">
          <h3>{t('history')}</h3>
          {versions.map((v) => (
            <div key={v.version_number} className="version-item">
              <small>v{v.version_number} — {v.created_at}</small>
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(v.content) }} />
            </div>
          ))}
          <button className="btn-back" onClick={() => setVersions(null)}>{t('back')}</button>
        </div>
      )}
    </div>
  );
}