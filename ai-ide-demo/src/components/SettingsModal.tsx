import { useEffect, useState } from 'react';

interface SettingsModalProps {
  initialApiKey: string;
  onClose: () => void;
  onSave: (apiKey: string) => void;
}

export function SettingsModal({ initialApiKey, onClose, onSave }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div className="bg-[#252526] rounded-lg shadow-xl w-[520px] max-w-[92vw]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-white font-semibold text-sm">设置</h3>
          <button type="button" className="text-gray-400 hover:text-white" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-2">DeepSeek API Key</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="请输入 API Key"
              className="w-full bg-[#3c3c3c] text-white text-sm px-3 py-2 rounded border border-[#555] focus:outline-none focus:border-[#007acc]"
            />
            <div className="text-[11px] text-gray-500 mt-2">
              Key 会保存在本机浏览器 localStorage 中
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(apiKey.trim())}
            className="px-4 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#005a8f] transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

