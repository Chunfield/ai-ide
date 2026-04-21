export function deriveReplacementFromFullFile(params: {
  originalFullText: string;
  modifiedFullText: string;
  from: number;
  to: number;
}): string | null {
  const { originalFullText, modifiedFullText, from, to } = params;
  const safeFrom = Math.max(0, Math.min(from, originalFullText.length));
  const safeTo = Math.max(0, Math.min(to, originalFullText.length));
  const before = originalFullText.slice(0, safeFrom);
  const after = originalFullText.slice(safeTo);

  if (modifiedFullText.startsWith(before) && modifiedFullText.endsWith(after)) {
    return modifiedFullText.slice(before.length, modifiedFullText.length - after.length);
  }

  const beforeTail = before.slice(Math.max(0, before.length - 300));
  const afterHead = after.slice(0, 300);

  const beforeIndex = beforeTail ? modifiedFullText.lastIndexOf(beforeTail) : 0;
  if (beforeIndex === -1) return null;
  const startIndex = beforeIndex + beforeTail.length;

  const afterIndex = afterHead ? modifiedFullText.indexOf(afterHead, startIndex) : modifiedFullText.length;
  if (afterIndex === -1) return null;

  return modifiedFullText.slice(startIndex, afterIndex);
}

