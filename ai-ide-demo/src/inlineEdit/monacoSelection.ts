import * as Monaco from 'monaco-editor';
import type { SelectionRange } from './types';

export function getMonacoSelectionRange(editor: Monaco.editor.IStandaloneCodeEditor): SelectionRange | null {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return null;

  const model = editor.getModel();
  if (!model) return null;

  const from = selection.startLineNumber;
  const to = selection.endLineNumber;
  const text = model.getValueInRange(selection);

  return { from, to, text, lineFrom: from, lineTo: to };
}

export function replaceMonacoRange(
  editor: Monaco.editor.IStandaloneCodeEditor,
  from: number,
  to: number,
  replacementText: string
) {
  const model = editor.getModel();
  if (!model) return;

  const fullText = model.getValue();
  const lines = fullText.split('\n');
  let offset = 0;
  let startLine = 1, startCol = 1;
  let endLine = 1, endCol = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1;
    if (offset + lineLen > from) {
      startLine = i + 1;
      startCol = from - offset + 1;
    }
    if (offset + lineLen >= to) {
      endLine = i + 1;
      endCol = to - offset + 1;
      break;
    }
    offset += lineLen;
  }

  const range = new Monaco.Range(startLine, startCol, endLine, endCol);
  editor.executeEdits('', [{
    range,
    text: replacementText,
    forceMoveMarkers: true,
  }]);

  const newPos = model.getPositionAt(from + replacementText.length);
  editor.setPosition(newPos);
  editor.revealLineInCenter(newPos.lineNumber);
}