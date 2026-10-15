/**
 * Pieces shared by the diary editor and the leader's comment editor (spec §5.2: one editor for both): the
 * formatting toolbar, what it shows for the current selection, and inserting a photo.
 */
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { useT } from '../../i18n/index.js';
import { formatBytes, PhotoError, preparePhoto } from '../../lib/images.js';
import { Button } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import type { NoticeKind } from '../../components/Notice.js';
import { FONTS, fontKeyOf, SIZES, sizeKeyOf, type FontKey, type SizeKey } from './schema.js';
import styles from './EditorScreen.module.css';

export interface ToolbarState {
  bold: boolean;
  underline: boolean;
  block: 'p' | 'h1' | 'h2' | 'h3';
  font: FontKey | 'default';
  size: SizeKey;
}

/** The toolbar's view of the current selection; for `useEditorState` selectors. */
export function readToolbarState(editor: Editor): ToolbarState {
  const style = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string };
  const level = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l }));
  return {
    bold: editor.isActive('bold'),
    underline: editor.isActive('underline'),
    block: level ? (`h${level}` as const) : 'p',
    font: fontKeyOf(style.fontFamily) ?? 'default',
    size: sizeKeyOf(style.fontSize),
  };
}

export interface EditorMessage {
  kind: NoticeKind;
  text: string;
  requestId?: string | null;
}

/**
 * A hidden file input and the steps after it: prepare the photo (ARCHITECTURE §8.3), insert it after the
 * selection, and report what was done through `onMessage`.
 */
export function usePhotoInsert(editor: Editor | null, onMessage: (m: EditorMessage) => void) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editor) return;
    setBusy(true);
    onMessage({ kind: 'info', text: t('editor.imageWorking') });
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
      onMessage({
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
      onMessage({
        kind: 'warning',
        text: t(tooLarge ? 'editor.imageTooLarge' : 'editor.imageUnreadable'),
      });
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    choose: () => input.current?.click(),
    input: <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void add(e)} />,
  };
}

/** The formatting toolbar; `compact` (comments) keeps bold, underline and photos only. */
export function Toolbar({
  editor,
  state,
  imagesFull,
  photoBusy,
  onPhoto,
  compact = false,
}: {
  editor: Editor;
  state: ToolbarState;
  imagesFull: boolean;
  photoBusy: boolean;
  onPhoto: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const chain = () => editor.chain().focus();
  // Buttons that don't take focus on press, so the caret stays in the text and typing carries on at once.
  const keepEditorFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('editor.toolbar')}>
      {!compact && (
        <>
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
        </>
      )}
      <Button
        small
        variant={state.bold ? 'secondary' : 'quiet'}
        aria-pressed={state.bold}
        aria-label={t('editor.bold')}
        onMouseDown={keepEditorFocus}
        onClick={() => chain().toggleBold().run()}
      >
        <b aria-hidden="true">B</b>
      </Button>
      <Button
        small
        variant={state.underline ? 'secondary' : 'quiet'}
        aria-pressed={state.underline}
        aria-label={t('editor.underline')}
        onMouseDown={keepEditorFocus}
        onClick={() => chain().toggleUnderline().run()}
      >
        <u aria-hidden="true">U</u>
      </Button>
      <Button small variant="quiet" disabled={imagesFull || photoBusy} onClick={onPhoto}>
        <Icon name="image" />
        {t('editor.image')}
      </Button>
    </div>
  );
}
