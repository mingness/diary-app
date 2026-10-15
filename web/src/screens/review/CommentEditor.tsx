/**
 * The leader's own comment on an entry (spec §6.4, §5.4): a small editor with 暫存 (only this leader sees it)
 * and 提交批注 (the student sees it). The saved text loads as the editor's initial content, so the caret
 * never jumps (spec §5.2). Unsaved changes are protected by the page's UnsavedGuard.
 */
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import type { Node as PmNode } from '@tiptap/pm/model';
import { ENTRY_LIMITS, ErrorCode, visibleCharCount, type MyComment } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { useSaveMyComment } from '../../api/leader.js';
import { Button } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useGuardedEditor } from '../../components/UnsavedGuard.js';
import { useI18n, useT } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { counterTone } from '../diary/rules.js';
import { contentExtensions, countImages } from '../diary/schema.js';
import {
  readToolbarState,
  Toolbar,
  usePhotoInsert,
  type EditorMessage,
} from '../diary/editorParts.js';
import { RichContent } from '../diary/RichContent.js';
import contentStyles from '../diary/content.module.css';
import editorStyles from '../diary/EditorScreen.module.css';
import { commentButtons, mayAutosave, type CommentState } from './rules.js';
import styles from './review.module.css';

const AUTOSAVE_MS = 5 * 60 * 1000;

/**
 * The leader's comment, kept small in a feed of many entries: a 寫批注 button until there is one, then once
 * submitted it reads like the others with 編輯. Only a saved draft opens straight in the editor, since that's
 * writing in progress.
 */
export function CommentEditor({
  documentId,
  saved,
}: {
  documentId: string;
  saved: MyComment | null;
}) {
  const t = useT();
  const [editing, setEditing] = useState(saved?.state === 'draft');
  if (!editing && saved?.state === 'submitted') {
    return <PostedComment saved={saved} onEdit={() => setEditing(true)} />;
  }
  if (!editing) {
    return (
      <div className={styles.commentCollapsed}>
        <Button small variant="secondary" onClick={() => setEditing(true)}>
          <Icon name="pen" />
          {t('comment.write')}
        </Button>
      </div>
    );
  }
  return (
    <CommentForm
      documentId={documentId}
      saved={saved}
      onSubmitted={() => setEditing(false)}
      // A draft has nowhere to fold back to; a submitted comment or an empty one does.
      {...(saved?.state !== 'draft' ? { onCancel: () => setEditing(false) } : {})}
    />
  );
}

function PostedComment({ saved, onEdit }: { saved: MyComment; onEdit: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div className={styles.comment}>
      <div className={styles.commentHead}>
        <h2>{t('comment.title')}</h2>
        <Button small variant="quiet" onClick={onEdit}>
          <Icon name="pen" />
          {t('comment.edit')}
        </Button>
      </div>
      {saved.submittedAt && (
        <span className={styles.muted}>
          {t('comment.submittedAt', { time: formatDateTime(saved.submittedAt, lang) })}
        </span>
      )}
      <RichContent html={saved.body} />
    </div>
  );
}

function CommentForm({
  documentId,
  saved,
  onSubmitted,
  onCancel,
}: {
  documentId: string;
  saved: MyComment | null;
  onSubmitted: () => void;
  /** Closes the editor of a submitted comment, unchanged. */
  onCancel?: () => void;
}) {
  const { t, tError, lang } = useI18n();
  const toast = useToast();
  const save = useSaveMyComment(documentId);
  const [message, setMessage] = useState<EditorMessage | null>(null);
  const savedDoc = useRef<PmNode | null>(null);
  const state: CommentState = saved?.state ?? 'none';

  const editor = useEditor({
    extensions: [
      ...contentExtensions(),
      UndoRedo,
      Placeholder.configure({ placeholder: t('comment.placeholder') }),
    ],
    content: saved?.body ?? '',
    injectCSS: false,
    editorProps: {
      attributes: {
        'aria-label': t('comment.body'),
        'aria-multiline': 'true',
        role: 'textbox',
        class: `${editorStyles.body ?? ''} ${styles.commentBody ?? ''}`,
      },
    },
    onCreate: ({ editor: created }) => {
      savedDoc.current = created.state.doc;
    },
  });

  const view = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        dirty: savedDoc.current !== null && !e.state.doc.eq(savedDoc.current),
        chars: visibleCharCount(e.state.doc.textContent),
        images: countImages(e.state.doc),
        ...readToolbarState(e),
      },
  });
  const dirty = view?.dirty ?? false;
  const chars = view?.chars ?? 0;
  const buttons = commentButtons({
    dirty,
    busy: save.isPending,
    state,
    hasContent: chars > 0 || (view?.images ?? 0) > 0,
    chars,
  });
  const photo = usePhotoInsert(editor, setMessage);

  async function persist(next: 'draft' | 'submitted'): Promise<boolean> {
    if (!editor || save.isPending) return false;
    const doc = editor.state.doc;
    setMessage(null);
    try {
      await save.mutateAsync({ body: editor.getHTML(), state: next });
      savedDoc.current = doc;
      toast.show(t(next === 'submitted' ? 'comment.sent' : 'comment.saved'));
      if (next === 'submitted') onSubmitted();
      return true;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const limit = apiError?.code === ErrorCode.LimitReached ? apiError.details.limit : null;
      setMessage({
        kind: limit ? 'warning' : 'error',
        text:
          limit === 'images' || limit === 'chars'
            ? `${t(`limit.${limit}`, { max: ENTRY_LIMITS[limit] })} ${t('limit.kept')}`
            : `${tError(apiError?.code ?? ErrorCode.Internal)} ${t('limit.kept')}`,
        requestId: apiError?.requestId ?? null,
      });
      return false;
    }
  }

  // Autosave drafts only (see mayAutosave), every 5 minutes and when the app goes to the background.
  const latest = useRef({ dirty, state, persist });
  useEffect(() => {
    latest.current = { dirty, state, persist };
  });
  useEffect(() => {
    const autosave = () => {
      const { dirty: d, state: s, persist: p } = latest.current;
      if (mayAutosave(s, d)) void p('draft');
    };
    const timer = window.setInterval(autosave, AUTOSAVE_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') autosave();
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty) event.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // The page's guard asks before a navigation would lose unsaved changes.
  useGuardedEditor({
    dirty,
    canSaveDraft: state !== 'submitted',
    saveDraft: () => persist('draft'),
  });

  const tone = counterTone(chars);
  const statusText =
    state === 'submitted' && saved?.submittedAt
      ? t('comment.submittedAt', { time: formatDateTime(saved.submittedAt, lang) })
      : state === 'draft'
        ? t('comment.draft')
        : t('comment.none');

  return (
    <div className={styles.comment}>
      <div className={styles.commentHead}>
        <h2>{t('comment.title')}</h2>
        <span className={styles.muted} role="status">
          {statusText}
        </span>
      </div>
      {editor && view && (
        <Toolbar
          compact
          editor={editor}
          state={view}
          imagesFull={view.images >= ENTRY_LIMITS.images}
          photoBusy={photo.busy}
          onPhoto={photo.choose}
        />
      )}
      {photo.input}
      <EditorContent
        editor={editor}
        className={`${contentStyles.content} ${editorStyles.editor}`}
      />
      {tone !== 'hidden' && (
        <p className={tone === 'quiet' ? styles.muted : styles.amber}>
          {t('editor.counter', {
            n: chars.toLocaleString(),
            max: ENTRY_LIMITS.chars.toLocaleString(),
          })}
        </p>
      )}
      {state === 'submitted' && dirty && <p className={styles.muted}>{t('comment.retract')}</p>}
      {buttons.submitBlockedBy === 'empty' && dirty && (
        <p className={styles.muted}>{t('comment.needsContent')}</p>
      )}
      {buttons.submitBlockedBy === 'tooLong' && (
        <p className={styles.amber}>
          {t('editor.tooLong', { max: ENTRY_LIMITS.chars.toLocaleString() })}
        </p>
      )}
      <div aria-live="polite">
        {message && (
          <Notice kind={message.kind} requestId={message.requestId} live={false}>
            {message.text}
          </Notice>
        )}
      </div>
      <div className={styles.commentActions}>
        {onCancel && (
          <Button small variant="quiet" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button small disabled={!buttons.draft} onClick={() => void persist('draft')}>
          {t('editor.saveDraft')}
        </Button>
        <Button
          small
          variant="primary"
          disabled={!buttons.submit}
          onClick={() => void persist('submitted')}
        >
          {t(buttons.submitLabel === 'update' ? 'comment.update' : 'comment.submit')}
        </Button>
      </div>
    </div>
  );
}
