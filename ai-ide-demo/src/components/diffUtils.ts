export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function computeDiff(original: string, modified: string): DiffLine[] {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const diff: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < originalLines.length || newIdx < modifiedLines.length) {
    if (oldIdx >= originalLines.length) {
      diff.push({ type: 'added', content: modifiedLines[newIdx], newLineNumber: newIdx + 1 });
      newIdx++;
    } else if (newIdx >= modifiedLines.length) {
      diff.push({ type: 'removed', content: originalLines[oldIdx], oldLineNumber: oldIdx + 1 });
      oldIdx++;
    } else if (originalLines[oldIdx] === modifiedLines[newIdx]) {
      diff.push({ type: 'unchanged', content: originalLines[oldIdx], oldLineNumber: oldIdx + 1, newLineNumber: newIdx + 1 });
      oldIdx++;
      newIdx++;
    } else {
      const matchInNew = modifiedLines.indexOf(originalLines[oldIdx], newIdx);
      const matchInOld = originalLines.indexOf(modifiedLines[newIdx], oldIdx);

      if (matchInNew === -1 && matchInOld === -1) {
        diff.push({ type: 'removed', content: originalLines[oldIdx], oldLineNumber: oldIdx + 1 });
        diff.push({ type: 'added', content: modifiedLines[newIdx], newLineNumber: newIdx + 1 });
        oldIdx++;
        newIdx++;
      } else if (matchInNew !== -1 && (matchInOld === -1 || (matchInNew - newIdx) <= (matchInOld - oldIdx))) {
        for (let i = newIdx; i < matchInNew; i++) {
          diff.push({ type: 'added', content: modifiedLines[i], newLineNumber: i + 1 });
        }
        newIdx = matchInNew;
      } else {
        for (let i = oldIdx; i < matchInOld; i++) {
          diff.push({ type: 'removed', content: originalLines[i], oldLineNumber: i + 1 });
        }
        oldIdx = matchInOld;
      }
    }

  }

  return diff;
}
