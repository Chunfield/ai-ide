import { useEffect, useMemo, useState } from 'react';

interface InlineEditPromptModalProps {
  title?: string;
  selectionSummary?: string;
  initialInstruction?: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (instruction: string) => void;
}

export function InlineEditPromptModal({
  title = 'Inline Edit',
  selectionSummary,
  initialInstruction = '',
  isSubmitting = false,
  onClose,
  onSubmit,
}: InlineEditPromptModalProps) {
  const [instruction, setInstruction] = useState(initialInstruction);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const trimmed = useMemo(() => instruction.trim(), [instruction]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div className="bg-[#252526] rounded-lg shadow-xl w-[640px] max-w-[92vw]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex flex-col">
            <h3 className="text-white font-semibold text-sm">{title}</h3>
            {selectionSummary && <div className="text-[11px] text-gray-400 mt-1">{selectionSummary}</div>}
          </div>
          <button type="button" className="text-gray-400 hover:text-white" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-2">改写指令</div>
            <input
              autoFocus
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例如：把这段代码改成 TypeScript 风格，并加错误处理"
              className="w-full bg-[#3c3c3c] text-white text-sm px-3 py-2 rounded border border-[#555] focus:outline-none focus:border-[#007acc]"
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
            disabled={isSubmitting}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSubmit(trimmed)}
            className="px-4 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#005a8f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting || !trimmed}
          >
            {isSubmitting ? '处理中...' : '开始改写'}
          </button>
        </div>
      </div>
    </div>
  );
}

