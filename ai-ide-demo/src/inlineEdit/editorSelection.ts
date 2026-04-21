import type { EditorView } from '@codemirror/view';
import type { SelectionRange } from './types';

export function getSelectionRange(view: EditorView): SelectionRange | null {
  const sel = view.state.selection.main;
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (from === to) return null;
  const text = view.state.doc.sliceString(from, to);
  const lineFrom = view.state.doc.lineAt(from).number;
  const lineTo = view.state.doc.lineAt(to).number;
  return { from, to, text, lineFrom, lineTo };
}

export function replaceRange(view: EditorView, from: number, to: number, replacementText: string) {
  const start = Math.max(0, Math.min(from, view.state.doc.length));
  const end = Math.max(0, Math.min(to, view.state.doc.length));
  const safeFrom = Math.min(start, end);
  const safeTo = Math.max(start, end);
  const nextCursor = safeFrom + replacementText.length;
  view.dispatch({
    changes: { from: safeFrom, to: safeTo, insert: replacementText },
    selection: { anchor: nextCursor },
    scrollIntoView: true,
  });
}

