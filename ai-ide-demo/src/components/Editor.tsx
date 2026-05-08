import { forwardRef } from 'react';
import { MonacoEditorComponent } from './MonacoEditorComponent';
import type * as Monaco from 'monaco-editor';
import type { AICompletionItem, AICompletionRequest } from '../completion/types';

export interface EditorRef {
  getEditor: () => Monaco.editor.IStandaloneCodeEditor | null;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  activePath: string;
  languageHint: string;
  contextPaths: string[];
  requestCompletions: (req: AICompletionRequest, signal?: AbortSignal) => Promise<AICompletionItem[]>;
  onInlineEdit: (selection: { text: string; lineFrom: number; lineTo: number }) => void;
}

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  { value, onChange, activePath, languageHint, contextPaths, requestCompletions, onInlineEdit },
  ref
) {
  return (
    <MonacoEditorComponent
      ref={ref}
      value={value}
      onChange={onChange}
      activePath={activePath}
      languageHint={languageHint}
      contextPaths={contextPaths}
      requestCompletions={requestCompletions}
      onInlineEdit={onInlineEdit}
    />
  );
});