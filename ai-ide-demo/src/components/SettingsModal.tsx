import { useEffect, useState } from 'react';
import { useAIStore } from '../store/aiStore';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { apiKey, setApiKey, autoComplete, setAutoComplete } = useAIStore();
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [localAutoComplete, setLocalAutoComplete] = useState(autoComplete);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSave = () => {
    setApiKey(localApiKey.trim());
    setAutoComplete(localAutoComplete);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div className="bg-[#252526] rounded-lg shadow-xl w-[520px] max-w-[92vw]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-white font-semibold text-sm">设置</h3>
          <button type="button" className="text-gray-400 hover:text-white" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs text-gray-400 mb-2">DeepSeek API Key</div>
            <input
              type="password"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder="请输入 API Key"
              className="w-full bg-[#3c3c3c] text-white text-sm px-3 py-2 rounded border border-[#555] focus:outline-none focus:border-[#007acc]"
            />
            <div className="text-[11px] text-gray-500 mt-2">
              Key 会保存在本机浏览器 localStorage 中
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white">AI 自动补全</div>
              <div className="text-[11px] text-gray-500">输入时自动预测并显示虚影补全，按 Tab 接受</div>
            </div>
            <button
              type="button"
              onClick={() => setLocalAutoComplete(!localAutoComplete)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                localAutoComplete ? 'bg-[#007acc]' : 'bg-[#555]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  localAutoComplete ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          <div className="pt-3 border-t border-[#3c3c3c]">
            <div className="text-xs text-gray-500 text-center">AI IDE v1.1.0</div>
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
            onClick={handleSave}
            className="px-4 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#005a8f] transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}