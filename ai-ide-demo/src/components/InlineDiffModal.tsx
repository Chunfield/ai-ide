import { useMemo } from 'react';
import { computeDiff } from './diffUtils';

interface InlineDiffModalProps {
  originalText: string;
  modifiedText: string;
  title?: string;
  subtitle?: string;
  onApply: () => void;
  onCancel: () => void;
}

export function InlineDiffModal({ originalText, modifiedText, title = '选区修改预览', subtitle, onApply, onCancel }: InlineDiffModalProps) {
  const diffLines = useMemo(() => computeDiff(originalText, modifiedText), [originalText, modifiedText]);

  const stats = useMemo(() => {
    const added = diffLines.filter(l => l.type === 'added').length;
    const removed = diffLines.filter(l => l.type === 'removed').length;
    return { added, removed };
  }, [diffLines]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#252526] rounded-lg shadow-xl w-[900px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h3 className="text-white font-semibold">{title}</h3>
              <span className="text-xs text-green-400">+{stats.added}</span>
              <span className="text-xs text-red-400">-{stats.removed}</span>
            </div>
            {subtitle && <div className="text-[11px] text-gray-400">{subtitle}</div>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              onClick={onApply}
              className="px-4 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#005a8f] transition-colors"
            >
              应用选区替换
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="font-mono text-sm">
            {diffLines.map((line, idx) => (
              <div
                key={idx}
                className={`flex ${
                  line.type === 'added'
                    ? 'bg-green-900/30'
                    : line.type === 'removed'
                    ? 'bg-red-900/30'
                    : ''
                }`}
              >
                <span className="w-12 text-right pr-3 text-gray-500 select-none border-r border-[#3c3c3c] mr-4">
                  {line.type === 'removed' ? line.oldLineNumber : line.type === 'added' ? line.newLineNumber : line.oldLineNumber}
                </span>
                <span className="w-6 text-center select-none">
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                </span>
                <pre className={`flex-1 whitespace-pre-wrap break-all ${
                  line.type === 'added'
                    ? 'text-green-300'
                    : line.type === 'removed'
                    ? 'text-red-300'
                    : 'text-gray-300'
                }`}>
                  {line.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

