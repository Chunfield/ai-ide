import { useRef, useCallback, useEffect, useState } from 'react';
import { forwardRef, useImperativeHandle } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { AICompletionItem, AICompletionRequest } from '../completion/types';
import type { EditorRef } from './Editor';
import { LSPManager, getLanguageIdFromExtension, detectAvailableLanguageServers } from '../lsp/LSPManager';
import { useAIStore } from '../store/aiStore';

interface SelectionInfo {
  text: string;
  lineFrom: number;
  lineTo: number;
  startColumn: number;
  endColumn: number;
}

interface CompletionState {
  isLoading: boolean;
  hasAI: boolean;
}

interface MonacoEditorComponentProps {
  value: string;
  onChange: (value: string) => void;
  activePath: string;
  languageHint: string;
  contextPaths: string[];
  requestCompletions: (req: AICompletionRequest, signal?: AbortSignal) => Promise<AICompletionItem[]>;
  onInlineEdit: (selection: { text: string; lineFrom: number; lineTo: number }) => void;
}

function computeSuffixOverlap(a: string, b: string, limit = 80) {
  if (!a || !b) return 0;
  const max = Math.min(limit, a.length, b.length);
  for (let len = max; len > 0; len--) {
    if (a.endsWith(b.slice(0, len))) return len;
  }
  return 0;
}

function cleanInsertText(insertText: string, existingText: string): string {
  const trimmed = insertText.trim();
  if (!trimmed || !existingText) return insertText;

  const existingLeading = existingText.match(/^[\s\n]*/)?.[0] || '';

  let cleaned = trimmed;
  if (existingLeading && !cleaned.startsWith('\n')) {
    const lines = cleaned.split('\n');
    if (lines.length > 1) {
      lines[0] = existingLeading + lines[0].trimStart();
      cleaned = lines.join('\n');
    }
  }

  return cleaned;
}

export const MonacoEditorComponent = forwardRef<EditorRef, MonacoEditorComponentProps>(function MonacoEditorComponent(
  { value, onChange, activePath, languageHint, contextPaths, requestCompletions, onInlineEdit },
  ref
) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionProviderRef = useRef<Monaco.IDisposable | null>(null);
  const lspManagerRef = useRef<LSPManager>(new LSPManager());
  const [language, setLanguage] = useState('html');
  const [lspStatus, setLspStatus] = useState<string>('');
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState>({ isLoading: false, hasAI: false });
  const completionDebounceRef = useRef<number | null>(null);
  const lastCompletionRequestRef = useRef<{ prefix: string; suffix: string } | null>(null);
  const ghostTextRef = useRef<string>('');
  const ghostTextWidgetRef = useRef<Monaco.editor.IContentWidget | null>(null);
  const autoCompleteDebounceRef = useRef<number | null>(null);

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

    const autoComplete = useAIStore.getState().autoComplete;

    const showGhostText = (text: string) => {
      if (!editor || !text) return;

      ghostTextRef.current = text;

      if (ghostTextWidgetRef.current) {
        editor.removeContentWidget(ghostTextWidgetRef.current);
      }

      const position = editor.getPosition();
      if (!position) return;

      ghostTextWidgetRef.current = {
        getId: () => 'ai-ghost-text',
        getDomNode: () => {
          const node = document.createElement('span');
          node.style.color = '#6A9955';
          node.style.fontStyle = 'italic';
          node.style.pointerEvents = 'none';
          node.textContent = text;
          return node;
        },
        getPosition: () => ({
          position,
          preference: [monaco.editor.ContentWidgetPosition.EXACT],
        }),
      };

      editor.addContentWidget(ghostTextWidgetRef.current);
    };

    const hideGhostText = () => {
      ghostTextRef.current = '';
      if (ghostTextWidgetRef.current && editor) {
        editor.removeContentWidget(ghostTextWidgetRef.current);
        ghostTextWidgetRef.current = null;
      }
    };

    const requestGhostCompletion = async () => {
      console.log('[DEBUG] requestGhostCompletion called');
      console.log('[DEBUG] autoComplete:', autoComplete, 'editor:', !!editor);

      if (!autoComplete || !editor) {
        console.log('[DEBUG] Early return: autoComplete or editor is falsy');
        return;
      }

      const model = editor.getModel();
      if (!model) {
        console.log('[DEBUG] Early Return: model is null');
        return;
      }

      const position = editor.getPosition();
      if (!position) {
        console.log('[DEBUG] Early Return: position is null');
        return;
      }

      const offset = model.getOffsetAt(position);
      const fullText = model.getValue();
      const prefix = fullText.slice(Math.max(0, offset - 500), offset);
      const suffix = fullText.slice(offset, Math.min(fullText.length, offset + 200));

      console.log('[DEBUG] Context - offset:', offset, 'prefix length:', prefix.length, 'suffix length:', suffix.length);
      console.log('[DEBUG] prefix (last 100):', prefix.slice(-100));
      console.log('[DEBUG] suffix (first 50):', suffix.slice(0, 50));

      if (lastCompletionRequestRef.current?.prefix.slice(-50) === prefix.slice(-50) &&
          lastCompletionRequestRef.current?.suffix.slice(0, 30) === suffix.slice(0, 30)) {
        console.log('[DEBUG] Early Return: Duplicate request detected');
        return;
      }

      lastCompletionRequestRef.current = { prefix, suffix };

      try {
        console.log('[DEBUG] Calling requestCompletions...');
        const items = await requestCompletions({
          activePath,
          language: languageHint || language,
          prefix,
          suffix,
          contextPaths,
          maxCandidates: 1,
          explicit: false,
        });

        console.log('[DEBUG] requestCompletions returned:', items?.length, 'items');

        if (items && items.length > 0) {
          console.log('[DEBUG] Item 0:', JSON.stringify(items[0]));
          const cleanText = items[0].insertText.trim();
          const currentWord = model.getWordUntilPosition(position);
          const afterCursor = fullText.slice(offset, fullText.indexOf('\n', offset) === -1 ? fullText.length : fullText.indexOf('\n', offset));

          console.log('[DEBUG] cleanText:', cleanText.slice(0, 100));
          console.log('[DEBUG] currentWord:', currentWord);
          console.log('[DEBUG] afterCursor:', afterCursor.slice(0, 50));

          let ghostText = cleanText;
          if (cleanText.startsWith(currentWord.word)) {
            ghostText = cleanText.slice(currentWord.word.length);
          }

          console.log('[DEBUG] ghostText:', ghostText.slice(0, 100));
          console.log('[DEBUG] shouldShow:', ghostText && !afterCursor.trim().startsWith(ghostText.slice(0, 20)));

          if (ghostText && !afterCursor.trim().startsWith(ghostText.slice(0, 20))) {
            showGhostText(ghostText);
            console.log('[DEBUG] showGhostText called');
          }
        } else {
          console.log('[DEBUG] No items returned from requestCompletions');
        }
      } catch (e) {
        console.error('[Ghost Text] Request failed:', e);
      }
    };

    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      if (newValue !== value) {
        onChange(newValue);
      }

      console.log('[DEBUG] onDidChangeModelContent - autoComplete:', autoComplete);

      if (autoComplete) {
        if (autoCompleteDebounceRef.current !== null) {
          clearTimeout(autoCompleteDebounceRef.current);
        }
        autoCompleteDebounceRef.current = window.setTimeout(() => {
          console.log('[DEBUG] Debounce triggered, calling requestGhostCompletion');
          hideGhostText();
          requestGhostCompletion();
        }, 500);
      } else {
        console.log('[DEBUG] autoComplete is false, skipping completion');
      }
    });

    editor.onDidChangeCursorPosition(() => {
      hideGhostText();
    });

    editor.addCommand(monaco.KeyCode.Tab, () => {
      if (ghostTextRef.current && editor) {
        const position = editor.getPosition();
        if (!position) return;

        const model = editor.getModel();
        if (!model) return;

        const offset = model.getOffsetAt(position);
        const fullText = model.getValue();
        const lineEnd = fullText.indexOf('\n', offset);
        const lineEndOffset = lineEnd === -1 ? fullText.length : lineEnd;

        editor.executeEdits('ai-ghost-text', [{
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, lineEndOffset + 1),
          text: ghostTextRef.current + '\n',
        }]);

        hideGhostText();
      } else {
        editor.trigger('keyboard', 'tab', {});
      }
    });

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) {
        setSelectionInfo(null);
        return;
      }
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValueInRange(sel);
      if (!text.trim()) {
        setSelectionInfo(null);
        return;
      }
      setSelectionInfo({
        text,
        lineFrom: sel.startLineNumber,
        lineTo: sel.endLineNumber,
        startColumn: sel.startColumn,
        endColumn: sel.endColumn,
      });
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
        triggerCharacters: ['.', '(', ' ', '[', '"', "'", ':', '='],
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

          if (completionDebounceRef.current !== null) {
            clearTimeout(completionDebounceRef.current);
          }

          return new Promise<{ suggestions: Monaco.languages.CompletionItem[] }>((resolve) => {
            setCompletionState({ isLoading: true, hasAI: false });
            completionDebounceRef.current = window.setTimeout(async () => {
              lastCompletionRequestRef.current = { prefix, suffix };

              const items = await requestCompletions(
                {
                  activePath,
                  language: languageHint || language,
                  prefix,
                  suffix,
                  contextPaths,
                  maxCandidates: 6,
                  explicit: false,
                },
                undefined
              );

              if (!items || items.length === 0) {
                setCompletionState({ isLoading: false, hasAI: false });
                resolve({ suggestions: [] });
                return;
              }

              const suggestions: Monaco.languages.CompletionItem[] = items.map((item: AICompletionItem) => {
                const afterText = model.getValueInRange({
                  startLineNumber: position.lineNumber,
                  startColumn: wordInfo.endColumn,
                  endLineNumber: position.lineNumber,
                  endColumn: Math.min(model.getLineMaxColumn(position.lineNumber), wordInfo.endColumn + 80),
                });

                const overlap = computeSuffixOverlap(item.insertText, afterText);
                let insertText = overlap > 0 ? item.insertText.slice(0, item.insertText.length - overlap) : item.insertText;
                insertText = cleanInsertText(insertText, afterText);

                const label = item.label.length > 40 ? item.label.slice(0, 40) + '...' : item.label;

                return {
                  label,
                  kind: monaco.languages.CompletionItemKind.Text,
                  detail: item.detail || 'AI 补全',
                  insertText,
                  range,
                  sortText: '0',
                };
              });

              setCompletionState({ isLoading: false, hasAI: true });
              resolve({ suggestions });
            }, 150);
          });
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
    console.log('[DEBUG Monaco] useEffect triggered - activePath:', activePath, 'value length:', value?.length);
    if (editorRef.current && value !== undefined) {
      const currentValue = editorRef.current.getValue();
      console.log('[DEBUG Monaco] currentValue length:', currentValue.length, 'new value length:', value.length);
      if (currentValue !== value) {
        console.log('[DEBUG Monaco] Setting new value');
        editorRef.current.setValue(value);
      } else {
        console.log('[DEBUG Monaco] Values are equal, no update needed');
      }
    } else {
      console.log('[DEBUG Monaco] editorRef or value is null/undefined');
    }
  }, [activePath, value]);

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
    <div className="relative flex flex-col h-full bg-[#1e1e1e]">
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
        {completionState.isLoading && (
          <span className="text-xs text-yellow-400 ml-2 animate-pulse">AI 补全中...</span>
        )}
        {completionState.hasAI && !completionState.isLoading && (
          <span className="text-xs text-blue-400 ml-2">✨ AI</span>
        )}
      </div>
      {selectionInfo && (
        <div
          className="absolute z-50 flex items-center gap-1 px-2 py-1 bg-[#252526] border border-[#3c3c3c] rounded shadow-lg"
          style={{
            top: -36,
            left: 0,
            transform: 'translateX(0)',
          }}
        >
          <span className="text-xs text-gray-400">已选 {selectionInfo.lineFrom}-{selectionInfo.lineTo} 行</span>
          <button
            onClick={() => onInlineEdit({ text: selectionInfo.text, lineFrom: selectionInfo.lineFrom, lineTo: selectionInfo.lineTo })}
            className="px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            AI 修改
          </button>
        </div>
      )}
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