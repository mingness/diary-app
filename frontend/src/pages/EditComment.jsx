import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { RichEditor } from '../components/RichEditor';
import { LotusSpinner } from '../components/LotusSpinner';
import { TranslateButtons } from '../components/TranslateButton';
import { sanitizeHtml } from '../utils/sanitize';

export function EditComment() {
  const { id } = useParams();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [comment, setComment] = useState('');
  const [savedComment, setSavedComment] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [accessibility, setAccessibility] = useState('Private');

  useEffect(() => {
    api.get(`/documents/${id}`).then((d) => {
      setDoc(d);
      setComment(d.comment || '');
      setSavedComment(d.comment || '');
      setAccessibility(d.accessibility || 'Private');
    });
  }, [id]);

  const handleDraft = useCallback(async (text) => {
    await api.post(`/documents/${id}/comment/draft`, { comment: text });
    setSavedComment(text);
    setIsDirty(false);
  }, [id]);

  const handleSubmit = async (text) => {
    await api.post(`/documents/${id}/comment/submit`, { comment: text });
    navigate(-1);
  };

  const handleCommentChange = useCallback((text) => {
    setComment(text);
    setIsDirty(text !== savedComment);
  }, [savedComment]);

  const handleAccessibilityChange = async (newAccessibility) => {
    // Only confirm when setting to Open
    if (newAccessibility === 'Open' && !confirm('确认开放此文档？开放后所有普通用户都可以阅读。')) {
      return;
    }
    try {
      await api.post(`/documents/${id}/accessibility`, { accessibility: newAccessibility });
      setAccessibility(newAccessibility);
    } catch (err) {
      alert('Failed to update accessibility: ' + (err.data?.error || err.message));
    }
  };

  if (!doc) return <LotusSpinner size={90} />;

  return (
    <div className="page">
      <header className="top-bar">
        <button className="btn-back" onClick={() => navigate(-1)}>{t('back')}</button>
        <h2>{t('comment')}</h2>
      </header>
      <div className="card">
        <p><b>{t('titleField')}:</b> {doc.title}</p>
        <p><b>{t('date')}:</b> {doc.date}</p>
        <p><b>{t('userName')}:</b> {doc.user_name}</p>
        <div><b>{t('content')}:</b><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content) }} /></div>
        <TranslateButtons html={doc.content} />

        <div style={{ margin: '16px 0', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={accessibility === 'Open'}
              onChange={(e) => handleAccessibilityChange(e.target.checked ? 'Open' : 'Private')}
              style={{ width: '20px', height: '20px' }}
            />
            <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
              {t('openAccess')} (当前: {accessibility})
            </span>
          </label>
          {accessibility === 'Wait for open' && (
            <p style={{ color: '#f57c00', marginTop: '8px' }}>⏳ 用户已申请开放，等待确认</p>
          )}
        </div>

        <h3>{t('comment')}</h3>
        <RichEditor
          initialText={comment}
          onDraft={handleDraft}
          onSubmit={handleSubmit}
          onChange={handleCommentChange}
          draftDisabled={!isDirty}
          submitDisabled={false}
        />
      </div>
    </div>
  );
}
