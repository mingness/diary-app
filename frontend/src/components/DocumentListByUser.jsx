import { useState, useEffect, Fragment } from 'react';
import { api } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { LotusSpinner } from './LotusSpinner';
import { TranslateButtons } from './TranslateButton';
import { sanitizeHtml } from '../utils/sanitize';

/** Document列表组件-user_name */
export function DocumentListByUser({ userName, onSelectDoc, showContent = true, showOpenOnly = false }) {
  const { t } = useLanguage();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [allDocs, setAllDocs] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userName) return;
    setLoading(true);
    api.get(`/documents/by-user/${userName}?year=${year}&month=${month}`)
      .then((res) => setAllDocs(res.documents || []))
      .catch(() => setAllDocs([]))
      .finally(() => setLoading(false));
  }, [userName, year, month]);

  // Filter docs based on showOpenOnly
  // - showOpenOnly=false (My Diary): show only the user's own documents
  // - showOpenOnly=true (Open Diary): show only open documents from other users
  const docs = showOpenOnly
    ? allDocs.filter(doc => doc.accessibility === 'Open' && doc.user_name !== userName)
    : allDocs.filter(doc => doc.user_name === userName);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const getAccessibilityBadge = (doc) => {
    if (doc.accessibility === 'Open') {
      return <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>🔓 {t('open') || 'Open'}</span>;
    }
    if (doc.accessibility === 'Wait for open') {
      return <span style={{ color: '#f57c00', fontWeight: 'bold' }}>⏳ {t('waitForOpen') || 'Wait for Open'}</span>;
    }
    return <span style={{ color: '#666' }}>🔒 {t('private') || 'Private'}</span>;
  };

  return (
    <div className="doc-list">
      <h3>{showOpenOnly ? (t('openDiary') || 'Open Diary') : userName} — {year}/{month}</h3>
      {loading ? (
        <LotusSpinner size={80} />
      ) : docs.length === 0 ? (
        <p className="muted">{t('noData')}</p>
      ) : (
      <table>
        <thead>
          <tr>
            {showOpenOnly && <th>{t('userName')}</th>}
            <th>{t('titleField')}</th>
            <th>{t('date')}</th>
            <th>{t('hasComment')}</th>
            {!showOpenOnly && <th>{t('accessibility') || 'Access'}</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <Fragment key={doc.id}>
              <tr className="doc-row">
                {showOpenOnly && <td>{doc.user_name}</td>}
                <td>
                  <span className="link" onClick={() => showOpenOnly ? toggle(doc.id) : onSelectDoc?.(doc)}>
                    {showOpenOnly && '🔓 '}{doc.title || '无标题'}
                  </span>
                </td>
                <td>{doc.date}</td>
                <td>{doc.has_comment ? '✅' : '❌'}</td>
                {!showOpenOnly && <td>{getAccessibilityBadge(doc)}</td>}
                <td>
                  <button className="btn-sm" onClick={() => toggle(doc.id)}>
                    {expanded[doc.id] ? '−' : '+'}
                  </button>
                </td>
              </tr>
              {expanded[doc.id] && showContent && (
                <tr className="doc-expanded">
                  <td colSpan={showOpenOnly ? 5 : 6}>
                    <div className="doc-meta-line">
                      {[
                        doc.title || '无标题',
                        doc.date,
                        showOpenOnly ? doc.user_name : null,
                        (doc.familyName || doc.givenName) ? `${doc.familyName || ''}-${doc.givenName || ''}` : null,
                        !showOpenOnly ? (doc.accessibility || 'Private') : null,
                        doc.has_comment ? '✅' : '❌',
                      ].filter(Boolean).join('\t')}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content || '(encrypted)') }} />
                    <TranslateButtons html={doc.content} />
                    {doc.comment != null && (
                      <>
                        <div className="doc-comment-label">{t('comment') || 'Comment'}:</div>
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.comment) }} />
                        <TranslateButtons html={doc.comment} />
                      </>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      )}
      <div className="pagination">
        <button onClick={() => setYear(y => y - 1)}>{t('prevYear')}</button>
        <button onClick={prevMonth}>{t('prevMonth')}</button>
        <span>{year}/{month}</span>
        <button onClick={nextMonth}>{t('nextMonth')}</button>
        <button onClick={() => setYear(y => y + 1)}>{t('nextYear')}</button>
      </div>
    </div>
  );
}
