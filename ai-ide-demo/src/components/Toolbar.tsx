import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SettingsModal } from './SettingsModal';

interface ToolbarProps {
  onNewFile: () => void;
  onClearEditor: () => void;
  onTogglePreview: () => void;
  showPreview: boolean;
}

export function Toolbar({ onNewFile, onClearEditor, onTogglePreview, showPreview }: ToolbarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const workspaceName = workspacePath ? workspacePath.split('/').pop() || workspacePath : null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[#323233] border-b border-[#3c3c3c]">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎮</span>
        <h1 className="text-white font-semibold text-sm">AI IDE</h1>
        {workspaceName && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-[#2d2d2d] rounded text-xs">
            <span className="text-gray-400">📂</span>
            <span className="text-gray-300 truncate max-w-[200px]" title={workspacePath}>{workspaceName}</span>
          </div>
        )}
      </div>

      <div className="flex-1"></div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-[#3c3c3c] rounded transition-colors"
        >
          设置
        </button>
        <button
          onClick={onTogglePreview}
          className={`px-3 py-1.5 text-xs rounded transition-colors ${
            showPreview
              ? 'text-white bg-[#007acc] hover:bg-[#005a8f]'
              : 'text-gray-300 hover:text-white hover:bg-[#3c3c3c]'
          }`}
        >
          {showPreview ? '隐藏预览' : '显示预览'}
        </button>
        <button
          onClick={onNewFile}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-[#3c3c3c] rounded transition-colors"
        >
          新建
        </button>
        <button
          onClick={onClearEditor}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-[#3c3c3c] rounded transition-colors"
        >
          清空
        </button>
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}