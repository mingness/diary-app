import { useRef, useEffect, useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';

/**
 * 富文本编辑界面：字体、字号、加粗、下划线、标题、图片、暂存/提交/历史版本
 */
export function RichEditor({
  initialText = '',
  onDraft,
  onSubmit,
  onHistory,
  draftDisabled = true,
  submitDisabled = true,
  autoDraftInterval = 300000,
  showTitleBar = false,
  accessibility,
  onAccessibilityChange,
  onChange,
  externalDirty = 0,
}) {
  const { t } = useLanguage();
  const editorRef = useRef(null);
  const initializedRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [canDraft, setCanDraft] = useState(!draftDisabled);
  const [canSubmit, setCanSubmit] = useState(!submitDisabled);

  // Only set innerHTML once on initial mount to avoid cursor jumping
  useEffect(() => {
    if (editorRef.current && !initializedRef.current) {
      editorRef.current.innerHTML = initialText || '';
      initializedRef.current = true;
    }
  }, [initialText]);

  // Activate buttons when external fields (title/date) change
  useEffect(() => {
    if (externalDirty > 0) {
      setDirty(true);
      setCanDraft(true);
      setCanSubmit(true);
    }
  }, [externalDirty]);

  const getContent = () => editorRef.current?.innerHTML || '';

  const markDirty = () => {
    setDirty(true);
    setCanDraft(true);
    setCanSubmit(true);
    onChange?.(getContent());
  };

  const exec = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    markDirty();
  };

  const insertImage = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const dataUrl = await processImageForInsert(file);
        exec('insertImage', dataUrl);
      } catch (err) {
        console.error('Image insert failed:', err);
        alert('图片插入失败: ' + err.message);
      }
    };
    input.click();
  };

  /**
   * Insert-time image processing to save storage space.
   *   - ≤ 500KB: keep original bytes (re-encoding a small JPEG often makes it bigger).
   *   - > 500KB: apply lossy JPEG compression with progressively smaller
   *     dimensions and lower quality the bigger the source is, so the
   *     inserted image ends up well under the 500KB threshold.
   */
  const processImageForInsert = (file) => {
    return new Promise((resolve, reject) => {
      // Small image: skip re-encoding entirely; just read as data URL.
      if (file.size <= 500 * 1024) {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
        return;
      }

      // Pick aggressive params based on source size.
      let maxWidth, quality;
      if (file.size <= 1024 * 1024) {
        maxWidth = 1280; quality = 0.7;
      } else if (file.size <= 2 * 1024 * 1024) {
        maxWidth = 1024; quality = 0.7;
      } else if (file.size <= 4 * 1024 * 1024) {
        maxWidth = 1024;  quality = 0.7;
      } else {
        maxWidth = 1024;  quality = 0.8;
      }

      // Decode via a blob object URL — no giant base64 string in memory.
      // (readAsDataURL on a multi-MB photo can fail on the first try in
      // Android WebView; object URLs stream directly into the decoder.)
      const encode = (img, width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', quality);
      };

      const finishWithImg = (img, revoke) => {
        try {
          let { width, height } = img;
          if (!width || !height) throw new Error('Failed to load image');
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          resolve(encode(img, width, height));
        } catch (err) {
          reject(err);
        } finally {
          if (revoke) URL.revokeObjectURL(revoke);
        }
      };

      const tryWithObjectUrl = () => {
        const objUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => finishWithImg(img, objUrl);
        img.onerror = () => {
          URL.revokeObjectURL(objUrl);
          // Fallback: old FileReader path (some WebViews only decode this way)
          const reader = new FileReader();
          reader.onload = (e) => {
            const img2 = new Image();
            img2.onload = () => finishWithImg(img2, null);
            img2.onerror = () => reject(new Error('图片格式不支持 / Unsupported image format (try a JPG/PNG)'));
            img2.src = e.target.result;
          };
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        };
        img.src = objUrl;
      };

      // Prefer createImageBitmap where available (handles EXIF orientation);
      // otherwise fall back to the object-URL <img> path.
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file)
          .then((bmp) => {
            try {
              let { width, height } = bmp;
              if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(bmp, 0, 0, width, height);
              bmp.close();
              resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (err) {
              try { bmp.close(); } catch {}
              tryWithObjectUrl();
            }
          })
          .catch(tryWithObjectUrl);
      } else {
        tryWithObjectUrl();
      }
    });
  };

  const handleDraft = useCallback(async () => {
    if (!canDraft) return;
    await onDraft?.(getContent());
    setCanDraft(false);
    // Requirement: after draft, submit button must be active
    setCanSubmit(true);
    setDirty(false);
  }, [canDraft, onDraft]);

  const submittingRef = useRef(false);
  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setCanSubmit(false);
    try {
      await onSubmit?.(getContent());
      setCanDraft(false);
      setDirty(false);
    } finally {
      submittingRef.current = false;
    }
  };

  // Auto draft every 5 minutes when dirty
  useEffect(() => {
    if (!dirty || !onDraft) return;
    const timer = setInterval(() => {
      if (dirty) handleDraft();
    }, autoDraftInterval);
    return () => clearInterval(timer);
  }, [dirty, handleDraft, autoDraftInterval, onDraft]);

  return (
    <div className="rich-editor">
      <div className="toolbar">
        <select onChange={(e) => exec('fontName', e.target.value)} defaultValue="">
          <option value="" disabled>字体</option>
          <option value="SimSun">宋体</option>
          <option value="SimHei">黑体</option>
          <option value="KaiTi">楷体</option>
          <option value="Arial">Arial</option>
        </select>
        <select onChange={(e) => exec('fontSize', e.target.value)} defaultValue="3">
          <option value="1">小</option>
          <option value="3">中</option>
          <option value="5">大</option>
          <option value="7">特大</option>
        </select>
        <button type="button" onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" onClick={() => exec('underline')}><u>U</u></button>
        <button type="button" onClick={() => exec('formatBlock', 'p')}>正文</button>
        <button type="button" onClick={() => exec('formatBlock', 'h1')}>H1</button>
        <button type="button" onClick={() => exec('formatBlock', 'h2')}>H2</button>
        <button type="button" onClick={() => exec('formatBlock', 'h3')}>H3</button>
        <button type="button" onClick={insertImage}>图片</button>
      </div>
      <div
        ref={editorRef}
        className="editor-content"
        contentEditable
        onInput={markDirty}
        suppressContentEditableWarning
      />
      <div className="editor-actions">
        {onAccessibilityChange && (
          <label className="accessibility-toggle">
            <input
              type="checkbox"
              checked={accessibility === 'Open' || accessibility === 'Wait for open'}
              onChange={(e) => {
                onAccessibilityChange(e.target.checked ? 'Open' : 'Private');
                // Activate draft and submit buttons when accessibility changes
                setCanDraft(true);
                setCanSubmit(true);
                setDirty(true);
              }}
            />
            {t('openAccess')}
          </label>
        )}
        {onDraft && (
          <button type="button" disabled={!canDraft} onClick={handleDraft}>{t('draft')}</button>
        )}
        {onSubmit && (
          <button type="button" disabled={!canSubmit} onClick={handleSubmit} className="btn-primary">{t('submit')}</button>
        )}
        {onHistory && (
          <button type="button" onClick={onHistory}>{t('history')}</button>
        )}
      </div>
    </div>
  );
}
