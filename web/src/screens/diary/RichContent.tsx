/**
 * Shows stored diary or comment HTML. It goes through a read-only editor with the same schema as the writing
 * editor rather than into innerHTML: the server has sanitised it already, and parsing it into the schema
 * drops anything outside the allowlist a second time, in the browser.
 */
import { EditorContent, useEditor } from '@tiptap/react';
import { contentExtensions } from './schema.js';
import styles from './content.module.css';

export function RichContent({ html }: { html: string }) {
  const editor = useEditor(
    {
      extensions: contentExtensions(),
      content: html,
      editable: false,
      // Tiptap would add a <style> element, which the Content-Security-Policy blocks; content.module.css has it.
      injectCSS: false,
      // Read-only text, not an input: without this, ProseMirror presents it as an (unnamed) text box.
      editorProps: { attributes: { role: 'none' } },
    },
    [html],
  );
  return <EditorContent editor={editor} className={styles.content} />;
}
