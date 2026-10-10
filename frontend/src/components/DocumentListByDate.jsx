import { useState, useEffect, Fragment } from 'react';
import { api } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { LotusSpinner } from './LotusSpinner';
import { TranslateButtons } from './TranslateButton';
import { sanitizeHtml } from '../utils/sanitize';

/** Document列表组件-date */
export function DocumentListByDate({ date, onSelectDoc }) {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    api.get(`/documents/by-date/${date}?page=${page}&pageSize=${pageSize}`)
      .then((res) => { setDocs(res.documents); setTotal(res.total); })
      .catch(() => { setDocs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [date, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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
      <h3>{t('date')}: {date}</h3>
      <div className="page-controls">
        <label>{t('pageSize')}</label>
        <input type="number" min={1} max={100} value={pageSize}
          onChange={(e) => { setPageSize(parseInt(e.target.value, 10) || 20); setPage(1); }} />
      </div>
      {loading ? (
        <LotusSpinner size={80} />
      ) : docs.length === 0 ? (
        <p className="muted">{t('noData')}</p>
      ) : (
      <table>
        <thead>
          <tr>
            <th>{t('userName')}</th>
            <th>{t('titleField')}</th>
            <th>{t('date')}</th>
            <th>{t('hasComment')}</th>
            <th>{t('accessibility') || 'Access'}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <Fragment key={doc.id}>
              <tr className="doc-row">
                <td>{doc.user_name}</td>
                <td>
                  <span className="link" onClick={() => onSelectDoc?.(doc)}>{doc.title || '无标题'}</span>
                </td>
                <td>{doc.date}</td>
                <td>{doc.has_comment ? '✅' : '❌'}</td>
                <td>{getAccessibilityBadge(doc)}</td>
                <td>
                  <button className="btn-sm" onClick={() => toggle(doc.id)}>
                    {expanded[doc.id] ? '−' : '+'}
                  </button>
                </td>
              </tr>
              {expanded[doc.id] && (
                <tr className="doc-expanded">
                  <td colSpan={6}>
                    <div className="doc-meta-line">
                      {[
                        doc.title || '无标题',
                        doc.date,
                        doc.user_name,
                        (doc.familyName || doc.givenName) ? `${doc.familyName || ''}-${doc.givenName || ''}` : null,
                        doc.accessibility || 'Private',
                        doc.has_comment ? '✅' : '❌',
                      ].filter(Boolean).join('\t')}
                    </div>
                    {doc.content != null && (
                      <>
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content) }} />
                        <TranslateButtons html={doc.content} />
                      </>
                    )}
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
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>◀</button>
        <span>{t('page')} {page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>▶</button>
      </div>
    </div>
  );
}
