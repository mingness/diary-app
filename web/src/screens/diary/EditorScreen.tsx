/**
 * The diary editor (FRONTEND.md §4.3, spec §5.2). Its first job is never to lose writing: a visible save
 * status, autosave every 5 minutes and whenever the app goes to the background, a warning before leaving with
 * unsaved changes, and limits that refuse a submit without touching the text.
 *
 * A new entry exists only in the editor until its first save; that save creates it on the server and the
 * address changes from /diary/new/edit to the entry's own, without remounting the editor.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  DAILY_LIMITS,
  ENTRY_LIMITS,
  ErrorCode,
  visibleCharCount,
  type Access,
} from '@diary/shared';
import { ApiError, NETWORK_ERROR } from '../../api/client.js';
import {
  saveEntry,
  storeOwnDocument,
  useEntry,
  type EntryContent,
  type OwnerEntry,
} from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { DetailHeader } from '../../components/DetailHeader.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { TextField } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { Notice, type NoticeKind } from '../../components/Notice.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { beijingDate, formatDiaryDate, formatTime } from '../../lib/dates.js';
import { formatBytes, PhotoError, preparePhoto } from '../../lib/images.js';
import { HistorySheet } from './HistorySheet.js';
import { counterTone, editorButtons } from './rules.js';
import {
  contentExtensions,
  countImages,
  FONTS,
  fontKeyOf,
  SIZES,
  sizeKeyOf,
  type FontKey,
  type SizeKey,
} from './schema.js';
import { ShareToggle } from './ShareToggle.js';
import contentStyles from './content.module.css';
import styles from './EditorScreen.module.css';

const AUTOSAVE_MS = 5 * 60 * 1000;

export function EditorScreen() {
  const { t } = useI18n();
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const query = useEntry(isNew ? null : id);

  if (!isNew && query.isPending) return <LoadingState />;
  if (!isNew && (query.isError || query.data?.view !== 'owner')) {
    const notFound =
      query.data !== undefined ||
      (query.error instanceof ApiError && query.error.code === ErrorCode.NotFound);
    return (
      <>
        <DetailHeader fallback="/diary" />
        {notFound ? (
          <EmptyState title={t('entry.notFound')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }
  // Same element in both cases, so the first save of a new entry (which changes the address) keeps it mounted.
  return <EntryEditor initial={isNew ? null : (query.data as OwnerEntry)} />;
}

/** What the editor knows about the entry on the server, updated after every write. */
interface ServerState {
  id: string | null;
  diaryDate: string;
  access: Access;
  submittedOnce: boolean;
  pendingDraft: boolean;
}

type SaveStatus =
  | { kind: 'idle'; at: string | null; submitted: boolean }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string; submitted: boolean }
  | { kind: 'offline' }
  | { kind: 'failed' };

interface Message {
  kind: NoticeKind;
  text: string;
  requestId?: string | null;
}

function serverStateOf(entry: OwnerEntry | null): ServerState {
  return {
    id: entry?.id ?? null,
    diaryDate: entry?.diaryDate ?? beijingDate(new Date()),
    access: entry?.access ?? 'private',
    submittedOnce: entry ? entry.submitted !== null : false,
    pendingDraft: entry ? entry.draft !== null : false,
  };
}

function EntryEditor({ initial }: { initial: OwnerEntry | null }) {
  const { t, tError, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const start = initial?.draft ?? initial?.submitted ?? { title: '', body: '' };
  const [server, setServer] = useState<ServerState>(() => serverStateOf(initial));
  const [title, setTitle] = useState(start.title);
  const [status, setStatus] = useState<SaveStatus>(() => ({
    kind: 'idle',
    at: initial?.draft?.savedAt ?? initial?.submitted?.at ?? null,
    submitted: initial ? !initial.draft && initial.submitted !== null : false,
  }));
  const [message, setMessage] = useState<Message | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // What was last saved, to tell whether there are unsaved changes. Comparing documents (not HTML) is cheap
  // even with photos, and undoing back to the saved text counts as unchanged.
  const savedDoc = useRef<PmNode | null>(null);
  const [savedTitle, setSavedTitle] = useState(start.title);
  const busy = useRef(false);
  /** The address the first save moves to, which the leave guard must let through. */
  const ownAddress = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      ...contentExtensions(),
      UndoRedo,
      Placeholder.configure({ placeholder: t('editor.placeholder') }),
    ],
    content: start.body,
    injectCSS: false,
    editorProps: {
      attributes: {
        'aria-label': t('editor.body'),
        'aria-multiline': 'true',
        role: 'textbox',
        class: styles.body ?? '',
      },
    },
    onCreate: ({ editor: created }) => {
      savedDoc.current = created.state.doc;
    },
  });

  const view = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const style = e.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string };
      return {
        bodyChanged: savedDoc.current !== null && !e.state.doc.eq(savedDoc.current),
        chars: visibleCharCount(e.state.doc.textContent),
        images: countImages(e.state.doc),
        bold: e.isActive('bold'),
        underline: e.isActive('underline'),
        block: e.isActive('heading', { level: 1 })
          ? 'h1'
          : e.isActive('heading', { level: 2 })
            ? 'h2'
            : e.isActive('heading', { level: 3 })
              ? 'h3'
              : 'p',
        font: (fontKeyOf(style.fontFamily) ?? 'default') as FontKey | 'default',
        size: sizeKeyOf(style.fontSize),
      };
    },
  });

  // Sharing changes go straight to the server (ShareToggle) and land in the cached entry.
  const live = useEntry(server.id).data;
  const access = live?.view === 'owner' ? live.access : server.access;

  const dirty = (view?.bodyChanged ?? false) || title !== savedTitle;
  const chars = view?.chars ?? 0;
  const saving = status.kind === 'saving';
  const buttons = editorButtons({
    dirty,
    busy: saving,
    submittedOnce: server.submittedOnce,
    pendingDraft: server.pendingDraft,
    chars,
  });

  /** Saves a draft or submits; on success the editor's contents become the saved baseline. */
  async function persist(
    kind: 'draft' | 'submit',
    options: { leaving?: boolean } = {},
  ): Promise<boolean> {
    {
      if (!editor || busy.current) return false;
      busy.current = true;
      const doc = editor.state.doc;
      const sentTitle = title;
      const content: EntryContent = { title: sentTitle.trim(), body: editor.getHTML() };
      setStatus({ kind: 'saving' });
      setMessage(null);
      try {
        let id = server.id;
        let saved = null;
        if (!id) {
          // The first save creates the entry, with this content as its draft.
          saved = await saveEntry.create(content);
          id = saved.id;
          storeOwnDocument(queryClient, saved);
          if (!options.leaving) {
            ownAddress.current = `/diary/${id}/edit`;
            void navigate(ownAddress.current, { replace: true });
          }
        }
        if (kind === 'submit' || !saved) {
          saved = await (kind === 'submit' ? saveEntry.submit : saveEntry.draft)(id, content);
          storeOwnDocument(queryClient, saved);
        }
        savedDoc.current = doc;
        setSavedTitle(sentTitle);
        setServer({
          id: saved.id,
          diaryDate: saved.diaryDate,
          access: saved.access,
          submittedOnce: saved.submitted !== null,
          pendingDraft: saved.draft !== null,
        });
        setStatus({
          kind: 'saved',
          at: kind === 'submit' ? (saved.submitted?.at ?? saved.updatedAt) : saved.updatedAt,
          submitted: kind === 'submit',
        });
        if (kind === 'submit') {
          toast.show(t(server.submittedOnce ? 'editor.updated' : 'editor.submitted'));
        }
        return true;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        setStatus({ kind: apiError?.code === NETWORK_ERROR ? 'offline' : 'failed' });
        setMessage(messageFor(apiError));
        return false;
      } finally {
        busy.current = false;
      }
    }
  }

  function messageFor(error: ApiError | null): Message {
    if (error?.code === ErrorCode.LimitReached) {
      const limit = String(error.details.limit ?? '');
      if (limit === 'create' || limit === 'submit' || limit === 'update') {
        return {
          kind: 'warning',
          text: `${t(`limit.${limit}`, { max: DAILY_LIMITS[limit] })} ${t('limit.resets')}`,
        };
      }
      if (limit === 'images' || limit === 'chars') {
        return {
          kind: 'warning',
          text: `${t(`limit.${limit}`, { max: ENTRY_LIMITS[limit] })} ${t('limit.kept')}`,
        };
      }
    }
    if (error?.code === ErrorCode.TooLarge || error?.code === ErrorCode.PayloadTooLarge) {
      return { kind: 'warning', text: `${tError(error.code)} ${t('limit.kept')}` };
    }
    return {
      kind: 'error',
      text: `${tError(error?.code ?? ErrorCode.Internal)} ${t('limit.kept')}`,
      requestId: error?.requestId ?? null,
    };
  }

  // Autosave (spec §5.2) and save-on-hide, so locking the phone doesn't lose text. Refs keep the timers from
  // restarting on every keystroke.
  const latest = useRef({ dirty, persist });
  useEffect(() => {
    latest.current = { dirty, persist };
  });
  useEffect(() => {
    const autosave = () => {
      if (latest.current.dirty) void latest.current.persist('draft');
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

  // Leaving with unsaved changes asks first. The address change after a new entry's first save is not leaving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      nextLocation.pathname !== ownAddress.current,
  );

  async function addPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editor) return;
    setPhotoBusy(true);
    setMessage({ kind: 'info', text: t('editor.imageWorking') });
    try {
      const photo = await preparePhoto(file);
      // After the selection: right after inserting, the previous photo is selected and would be replaced.
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.selection.to, {
          type: 'image',
          attrs: { src: photo.dataUrl, alt: '' },
        })
        .run();
      const shrunk =
        photo.result.width !== photo.original.width || photo.result.bytes < photo.original.bytes;
      setMessage({
        kind: 'info',
        text: shrunk
          ? t('editor.imageShrunk', {
              from: `${photo.original.width}×${photo.original.height} (${formatBytes(photo.original.bytes)})`,
              to: `${photo.result.width}×${photo.result.height} (${formatBytes(photo.result.bytes)})`,
            })
          : t('editor.imageStripped'),
      });
    } catch (error) {
      const tooLarge = error instanceof PhotoError && error.reason === 'tooLarge';
      setMessage({
        kind: 'warning',
        text: t(tooLarge ? 'editor.imageTooLarge' : 'editor.imageUnreadable'),
      });
    } finally {
      setPhotoBusy(false);
    }
  }

  const tone = counterTone(chars);
  const imagesFull = (view?.images ?? 0) >= ENTRY_LIMITS.images;

  return (
    <div className={styles.page}>
      <DetailHeader fallback="/diary" aside={<StatusText status={status} dirty={dirty} />} />
      <h1 className="visually-hidden">
        {server.id ? t('editor.editTitle') : t('editor.newTitle')}
      </h1>

      <TextField
        label={t('editor.title')}
        className={styles.titleInput}
        maxLength={ENTRY_LIMITS.titleChars}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className={styles.date}>
        <span className={styles.dateLabel}>{t('editor.date')}</span>
        <span>{formatDiaryDate(server.diaryDate, lang)}</span>
        <span className={styles.help}>{t('editor.dateHelp')}</span>
      </div>

      {editor && view && (
        <Toolbar
          editor={editor}
          state={view}
          imagesFull={imagesFull}
          photoBusy={photoBusy}
          onPhoto={() => fileInput.current?.click()}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void addPhoto(e)}
      />
      {imagesFull && <p className={styles.help}>{t('editor.imageLimit')}</p>}

      <EditorContent editor={editor} className={`${contentStyles.content} ${styles.editor}`} />

      {tone !== 'hidden' && (
        <div className={`${styles.counter} ${tone === 'quiet' ? '' : styles.counterNear}`}>
          <span>
            {t('editor.counter', {
              n: chars.toLocaleString(),
              max: ENTRY_LIMITS.chars.toLocaleString(),
            })}
          </span>
          <span>
            {tone === 'over'
              ? t('editor.tooLong', { max: ENTRY_LIMITS.chars.toLocaleString() })
              : t('editor.lengthCare')}
          </span>
        </div>
      )}

      <ShareToggle documentId={server.id} access={access} submitted={server.submittedOnce} />

      <div aria-live="polite">
        {message && (
          <Notice kind={message.kind} requestId={message.requestId} live={false}>
            {message.text}
          </Notice>
        )}
      </div>

      <div className={styles.bar}>
        <Button disabled={!buttons.draft} onClick={() => void persist('draft')}>
          {t('editor.saveDraft')}
        </Button>
        <Button
          variant="primary"
          disabled={!buttons.submit}
          onClick={() => void persist('submit')}
          aria-describedby={buttons.submitBlockedBy === 'tooLong' ? 'too-long' : undefined}
        >
          {t(buttons.submitLabel === 'update' ? 'editor.update' : 'editor.submit')}
        </Button>
        <Button
          variant="quiet"
          disabled={!server.id || !server.submittedOnce}
          onClick={() => setHistoryOpen(true)}
        >
          <Icon name="history" />
          {t('editor.history')}
        </Button>
        {buttons.submitBlockedBy === 'tooLong' && (
          <span id="too-long" className="visually-hidden">
            {t('editor.tooLong', { max: ENTRY_LIMITS.chars.toLocaleString() })}
          </span>
        )}
      </div>

      {server.id && (
        <HistorySheet
          documentId={server.id}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t('leave.title')}
        onCancel={() => blocker.reset?.()}
        actions={
          <>
            <Button variant="quiet" onClick={() => blocker.reset?.()}>
              {t('leave.stay')}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t('leave.discard')}
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              onClick={() =>
                void persist('draft', { leaving: true }).then((ok) =>
                  ok ? blocker.proceed?.() : blocker.reset?.(),
                )
              }
            >
              {t('leave.save')}
            </Button>
          </>
        }
      >
        <p>{t('leave.body')}</p>
      </ConfirmDialog>
    </div>
  );
}

function StatusText({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  const { t, lang } = useI18n();
  let text = '';
  if (status.kind === 'saving') text = t('status.saving');
  else if (status.kind === 'offline') text = t('status.offline');
  else if (status.kind === 'failed') text = t('status.failed');
  else if (dirty) text = t('status.dirty');
  else if (status.at) {
    text = t(status.submitted ? 'status.submitted' : 'status.saved', {
      time: formatTime(status.at, lang),
    });
  }
  return (
    <span className={styles.status} role="status">
      {text}
    </span>
  );
}

interface ToolbarState {
  bold: boolean;
  underline: boolean;
  block: string;
  font: FontKey | 'default';
  size: SizeKey;
}

function Toolbar({
  editor,
  state,
  imagesFull,
  photoBusy,
  onPhoto,
}: {
  editor: Editor;
  state: ToolbarState;
  imagesFull: boolean;
  photoBusy: boolean;
  onPhoto: () => void;
}) {
  const { t } = useI18n();
  const chain = () => editor.chain().focus();
  // Buttons that don't take focus on press, so the caret stays in the text and typing carries on at once.
  const keepEditorFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('editor.toolbar')}>
      <span className={styles.tool}>
        <select
          aria-label={t('editor.font')}
          value={state.font}
          onChange={(e) => {
            const key = e.target.value as FontKey | 'default';
            if (key === 'default') chain().unsetFontFamily().run();
            else chain().setFontFamily(FONTS[key]).run();
          }}
        >
          <option value="default">
            {t('editor.font')}：{t('editor.fontDefault')}
          </option>
          <option value="serif">{t('editor.fontSerif')}</option>
          <option value="sans">{t('editor.fontSans')}</option>
          <option value="kai">{t('editor.fontKai')}</option>
        </select>
      </span>
      <span className={styles.tool}>
        <select
          aria-label={t('editor.style')}
          value={state.block}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'p') chain().setParagraph().run();
            else
              chain()
                .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="p">{t('editor.styleP')}</option>
          <option value="h1">{t('editor.styleH1')}</option>
          <option value="h2">{t('editor.styleH2')}</option>
          <option value="h3">{t('editor.styleH3')}</option>
        </select>
      </span>
      <span className={styles.tool}>
        <select
          aria-label={t('editor.size')}
          value={state.size}
          onChange={(e) => {
            const key = e.target.value as SizeKey;
            if (key === 'normal') chain().unsetFontSize().run();
            else chain().setFontSize(SIZES[key]).run();
          }}
        >
          <option value="small">{t('editor.sizeSmall')}</option>
          <option value="normal">
            {t('editor.size')}：{t('editor.sizeNormal')}
          </option>
          <option value="large">{t('editor.sizeLarge')}</option>
          <option value="xlarge">{t('editor.sizeXLarge')}</option>
        </select>
      </span>
      <Button
        variant={state.bold ? 'secondary' : 'quiet'}
        aria-pressed={state.bold}
        aria-label={t('editor.bold')}
        onMouseDown={keepEditorFocus}
        onClick={() => chain().toggleBold().run()}
      >
        <b aria-hidden="true">B</b>
      </Button>
      <Button
        variant={state.underline ? 'secondary' : 'quiet'}
        aria-pressed={state.underline}
        aria-label={t('editor.underline')}
        onMouseDown={keepEditorFocus}
        onClick={() => chain().toggleUnderline().run()}
      >
        <u aria-hidden="true">U</u>
      </Button>
      <Button variant="quiet" disabled={imagesFull || photoBusy} onClick={onPhoto}>
        <Icon name="image" />
        {t('editor.image')}
      </Button>
    </div>
  );
}
