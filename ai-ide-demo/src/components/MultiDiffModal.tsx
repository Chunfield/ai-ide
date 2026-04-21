import { useMemo, useState } from 'react';
import { FilePatch, useWorkspaceStore } from '../store/workspaceStore';
import { computeDiff } from './diffUtils';

interface MultiDiffModalProps {
  patches: FilePatch[];
  onApply: () => void;
  onCancel: () => void;
}

export function MultiDiffModal({ patches, onApply, onCancel }: MultiDiffModalProps) {
  const { files } = useWorkspaceStore();
  const [selectedPath, setSelectedPath] = useState<string>(patches[0]?.path ?? '');

  const selectedPatch = useMemo(() => patches.find((p) => p.path === selectedPath), [patches, selectedPath]);
  
  const originalCode = useMemo(() => {
    if (!selectedPatch) return '';
    if (selectedPatch.action === 'rename' && selectedPatch.oldPath) {
      return files[selectedPatch.oldPath] ?? '';
    }
    return files[selectedPatch.path] ?? '';
  }, [selectedPatch, files]);

  const modifiedCode = useMemo(() => {
    if (!selectedPatch) return '';
    if (selectedPatch.action === 'delete') return '';
    if (selectedPatch.action === 'rename') {
      if (selectedPatch.content !== undefined) return selectedPatch.content;
      if (selectedPatch.oldPath) return files[selectedPatch.oldPath] ?? '';
      return '';
    }
    return selectedPatch.content ?? '';
  }, [files, selectedPatch]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#252526] rounded-lg shadow-xl w-[1000px] h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-white font-semibold">应用多文件修改 ({patches.length} 个文件)</h3>
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
              全部应用
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar: File List */}
          <div className="w-64 border-r border-[#3c3c3c] bg-[#1e1e1e] overflow-y-auto">
            <div className="p-2 text-xs text-gray-400 font-semibold uppercase tracking-wider">
              变更的文件
            </div>
            <ul>
              {patches.map((patch) => {
                const isSelected = patch.path === selectedPath;
                const isNew = patch.action === 'upsert' && files[patch.path] === undefined;
                const isDeleted = patch.action === 'delete';
                const isRenamed = patch.action === 'rename';
                const badgeText = isDeleted ? '删除' : isRenamed ? '重命名' : isNew ? '新增' : '修改';
                const badgeClass = isDeleted
                  ? 'bg-red-900 text-red-300'
                  : isRenamed
                  ? 'bg-purple-900 text-purple-300'
                  : isNew
                  ? 'bg-green-900 text-green-300'
                  : 'bg-blue-900 text-blue-300';
                return (
                  <li key={patch.path}>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                        isSelected ? 'bg-[#37373d] text-white' : 'text-gray-300 hover:bg-[#2a2d2e]'
                      }`}
                      onClick={() => setSelectedPath(patch.path)}
                    >
                      <span className="truncate">{patch.path}</span>
                      <span className={`text-[10px] px-1 rounded ${badgeClass}`}>
                        {badgeText}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right area: Diff Details */}
          <div className="flex-1 relative bg-[#1e1e1e]">
            {selectedPatch ? (
              <div className="absolute inset-0">
                {/* We re-use DiffModal visually by overriding some of its styles via children, or we can just render the logic directly.
                    Since DiffModal is a full-screen modal currently, we need to extract its inner logic or just implement a simple inline diff here.
                    For simplicity, we'll embed the diff logic directly here to fit into the split pane layout.
                */}
                <InlineDiff originalCode={originalCode} modifiedCode={modifiedCode} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                请选择一个文件查看差异
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineDiff({ originalCode, modifiedCode }: { originalCode: string; modifiedCode: string }) {
  const diffLines = useMemo(() => computeDiff(originalCode, modifiedCode), [originalCode, modifiedCode]);
  return (
    <div className="h-full overflow-auto p-4 font-mono text-sm">
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
          <span className="w-6 text-center select-none text-gray-400">
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
  );
}
