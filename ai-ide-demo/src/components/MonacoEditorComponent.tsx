import { useRef, useCallback, useEffect, useState } from 'react';
import { forwardRef, useImperativeHandle } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { AICompletionItem, AICompletionRequest } from '../completion/types';
import type { EditorRef } from './Editor';
import { LSPManager, getLanguageIdFromExtension, detectAvailableLanguageServers } from '../lsp/LSPManager';

interface MonacoEditorComponentProps {
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

export const MonacoEditorComponent = forwardRef<EditorRef, MonacoEditorComponentProps>(function MonacoEditorComponent(
  { value, onChange, activePath, languageHint, contextPaths, requestCompletions },
  ref
) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionProviderRef = useRef<Monaco.IDisposable | null>(null);
  const lspManagerRef = useRef<LSPManager>(new LSPManager());
  const [language, setLanguage] = useState('html');
  const [lspStatus, setLspStatus] = useState<string>('');

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
  }));

  const initLSP = useCallback(async () => {
    const availableServers = detectAvailableLanguageServers();
    const currentLangId = languageHint || language;
    const fileLangId = getLanguageIdFromExtension(activePath);

    for (const server of availableServers) {
      if (server.languageId === currentLangId || server.languageId === fileLangId) {
        try {
          await lspManagerRef.current.startServer({
            ...server,
            rootPath: activePath.split('/').slice(0, -1).join('/') || '/',
          });
          setLspStatus(` LSP: ${server.languageId} ✓`);
          console.log(`[LSP] Connected to ${server.languageId} server`);
          break;
        } catch (e) {
          console.warn(`[LSP] Failed to connect to ${server.languageId}:`, e);
        }
      }
    }
  }, [languageHint, language, activePath]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      if (newValue !== value) {
        onChange(newValue);
      }
    });

    monaco.editor.defineTheme('ai-ide-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorCursor.foreground': '#aeafad',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#2a2d2e',
      },
    });
    monaco.editor.setTheme('ai-ide-dark');

    initLSP();
  }, [onChange, value, initLSP]);

  const registerCompletionProvider = useCallback(() => {
    if (!monacoRef.current || !editorRef.current) return;

    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    const monaco = monacoRef.current;

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider(
      languageHint || language,
      {
        triggerCharacters: ['.', '(', ' ', '[', '"', "'"],
        provideCompletionItems: async (model, position) => {
          const wordInfo = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordInfo.startColumn,
            endColumn: wordInfo.endColumn,
          };

          const offset = model.getOffsetAt(position);
          const docLength = model.getValue().length;
          const suffixEnd = Math.min(docLength, offset + 200);

          const prefix = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          }).slice(-2000);

          const suffix = model.getValue().slice(offset, suffixEnd);

          const items = await requestCompletions(
            {
              activePath,
              language: languageHint || language,
              prefix,
              suffix,
              contextPaths,
              maxCandidates: 6,
              explicit: true,
            },
            undefined
          );

          if (!items || items.length === 0) return { suggestions: [] };

          const suggestions: Monaco.languages.CompletionItem[] = items.map((item: AICompletionItem) => {
            const afterText = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: wordInfo.endColumn,
              endLineNumber: position.lineNumber,
              endColumn: Math.min(model.getLineMaxColumn(position.lineNumber), wordInfo.endColumn + 40),
            });

            const overlap = computeSuffixOverlap(item.insertText, afterText);
            const insertText = overlap > 0 ? item.insertText.slice(0, item.insertText.length - overlap) : item.insertText;

            return {
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Text,
              detail: item.detail,
              insertText,
              range,
              sortText: '0',
            };
          });

          return { suggestions };
        },
      }
    );
  }, [activePath, language, languageHint, contextPaths, requestCompletions]);

  useEffect(() => {
    registerCompletionProvider();
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
      }
    };
  }, [registerCompletionProvider]);

  useEffect(() => {
    return () => {
      lspManagerRef.current.stopAll();
    };
  }, []);

  const handleLanguageChange = useCallback((newLanguage: string) => {
    setLanguage(newLanguage);
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        monacoRef.current?.editor.setModelLanguage(model, newLanguage);
      }
    }
    lspManagerRef.current.stopAll();
    setLspStatus('');
    initLSP();
  }, [initLSP]);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <span className="text-sm text-gray-400">语言:</span>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="appearance-none bg-[#3c3c3c] text-white text-sm px-3 py-1 pr-8 rounded border border-[#555] focus:outline-none focus:border-[#007acc] cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
            backgroundPosition: 'right 0.5rem center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '1.5em 1.5em',
          }}
        >
          <option value="html">HTML</option>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="gdscript">GDScript</option>
        </select>
        {lspStatus && (
          <span className="text-xs text-green-400 ml-2">{lspStatus}</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          language={languageHint || language}
          value={value}
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            fontSize: 14,
            fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
            minimap: { enabled: true },
            lineNumbers: 'on',
            renderLineHighlight: 'all',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: {
              other: true,
              comments: false,
              strings: true,
            },
            acceptSuggestionOnEnter: 'on',
            snippetSuggestions: 'top',
            folding: true,
            foldingHighlight: true,
            bracketPairColorization: { enabled: true },
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
});