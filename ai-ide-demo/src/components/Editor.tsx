import { useState, useCallback, forwardRef, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { autocompletion, pickedCompletion, startCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import type { AICompletionItem, AICompletionRequest } from '../completion/types';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  activePath: string;
  languageHint: string;
  contextPaths: string[];
  requestCompletions: (req: AICompletionRequest, signal?: AbortSignal) => Promise<AICompletionItem[]>;
}

function computeSuffixOverlap(a: string, b: string, limit = 24) {
  const max = Math.min(limit, a.length, b.length);
  for (let len = max; len > 0; len--) {
    if (a.endsWith(b.slice(0, len))) return len;
  }
  return 0;
}

export const Editor = forwardRef<ReactCodeMirrorRef, EditorProps>(function Editor(
  { value, onChange, activePath, languageHint, contextPaths, requestCompletions }: EditorProps,
  ref
) {
  const [language, setLanguage] = useState('html');

  const getLanguageExtension = useCallback(() => {
    switch (language) {
      case 'javascript':
        return javascript();
      case 'python':
        return python();
      case 'html':
      default:
        return html();
    }
  }, [language]);

  const aiCompletionExt = useMemo(() => {
    const source = async (context: CompletionContext) => {
      const word = context.matchBefore(/[A-Za-z_][\w-]{0,80}$/);
      const from = word?.from ?? context.pos;
      const to = context.pos;

      if (!context.explicit) {
        if (!word || word.text.length < 2) return null;
      }

      const doc = context.state.doc;
      const prefix = doc.sliceString(Math.max(0, context.pos - 2000), context.pos);
      const suffix = doc.sliceString(context.pos, Math.min(doc.length, context.pos + 200));

      const controller = new AbortController();
      context.addEventListener('abort', () => controller.abort(), { onDocChange: true });

      const items = await requestCompletions(
        {
          activePath,
          language: languageHint || language,
          prefix,
          suffix,
          contextPaths,
          maxCandidates: 6,
          explicit: context.explicit,
        },
        controller.signal
      );

      if (context.aborted || controller.signal.aborted) return null;
      if (!items || items.length === 0) return null;

      const options: Completion[] = items.map((it) => ({
        label: it.label,
        detail: it.detail,
        type: 'text',
        apply: (view, completion, f, t) => {
          const after = view.state.doc.sliceString(t, Math.min(view.state.doc.length, t + 40));
          const overlap = computeSuffixOverlap(it.insertText, after);
          const insertText = overlap > 0 ? it.insertText.slice(0, it.insertText.length - overlap) : it.insertText;
          view.dispatch({
            changes: { from: f, to: t, insert: insertText },
            selection: { anchor: f + insertText.length },
            annotations: pickedCompletion.of(completion),
            scrollIntoView: true,
          });
        },
      }));

      return {
        from,
        to,
        options,
        validFor: /^[A-Za-z_][\w-]{0,80}$/,
      };
    };

    return [
      autocompletion({ override: [source] }),
      keymap.of([
        { key: 'Ctrl-Space', run: startCompletion },
        { key: 'Cmd-Space', run: startCompletion },
      ]),
    ];
  }, [activePath, contextPaths, language, languageHint, requestCompletions]);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <span className="text-sm text-gray-400">语言:</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-[#3c3c3c] text-white text-sm px-2 py-1 rounded border border-[#555] focus:outline-none focus:border-[#007acc]"
        >
          <option value="html">HTML</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
        </select>
      </div>
      <div className="flex-1 overflow-hidden">
        <CodeMirror
          ref={ref}
          value={value}
          height="100%"
          theme={vscodeDark}
          extensions={[getLanguageExtension(), aiCompletionExt]}
          onChange={onChange}
          className="h-full"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: true,
            historyKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
        />
      </div>
    </div>
  );
});
