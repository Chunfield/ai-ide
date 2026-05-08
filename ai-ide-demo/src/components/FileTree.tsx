import { useMemo, useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { WorkspaceNode, useWorkspaceStore } from '../store/workspaceStore';

interface FileTreeProps {
  className?: string;
}

interface LoadedTreeNode {
  name: string;
  path: string;
  children: LoadedTreeNode[];
}

function sortChildren(children: WorkspaceNode[]): WorkspaceNode[] {
  return [...children].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function convertLoadedNode(node: LoadedTreeNode): WorkspaceNode {
  const hasChildren = node.children && node.children.length > 0;
  return {
    type: hasChildren ? 'folder' : 'file',
    name: node.name,
    path: node.path,
    children: node.children?.map(c => convertLoadedNode(c)) ?? [],
  };
}

function NodeItem({
  node,
  depth,
  expanded,
  toggleFolder,
  activePath,
  onOpenFile,
  selectedContextPaths,
  onToggleContext,
  onNewFolder,
}: {
  node: WorkspaceNode;
  depth: number;
  expanded: Record<string, boolean>;
  toggleFolder: (path: string) => void;
  activePath: string;
  onOpenFile: (path: string) => void;
  selectedContextPaths: string[];
  onToggleContext: (path: string) => void;
  onNewFolder?: (parentPath: string) => void;
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = expanded[node.path] ?? (depth <= 1);
  const children = useMemo(() => (node.children ? sortChildren(node.children) : []), [node.children]);
  const isContextSelected = selectedContextPaths.includes(node.path);

  return (
    <div>
      <div
        className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs text-left hover:bg-[#2a2d2e] ${
          !isFolder && activePath === node.path ? 'bg-[#094771] text-white' : 'text-gray-300'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          onClick={() => {
            console.log('[DEBUG FileTree] clicked node:', node.name, node.path);
            if (isFolder) toggleFolder(node.path);
            else onOpenFile(node.path);
          }}
          className="flex items-center gap-2 flex-1 truncate"
        >
          <span className="w-4 text-center select-none">
            {isFolder ? (isExpanded ? '▾' : '▸') : ' '}
          </span>
          <span className="w-4 text-center select-none">{isFolder ? '📁' : '📄'}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {!isFolder && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleContext(node.path);
            }}
            title={isContextSelected ? "移除上下文" : "加入上下文"}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isContextSelected
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'border-gray-500 hover:border-gray-300'
            }`}
          >
            {isContextSelected && <span className="text-[10px]">✓</span>}
          </button>
        )}
        {isFolder && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onNewFolder) onNewFolder(node.path);
            }}
            title="新建子文件夹"
            className="w-4 h-4 rounded border border-gray-500 hover:border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span className="text-[10px]">+</span>
          </button>
        )}
      </div>

      {isFolder && isExpanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <NodeItem
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggleFolder={toggleFolder}
              activePath={activePath}
              onOpenFile={onOpenFile}
              selectedContextPaths={selectedContextPaths}
              onToggleContext={onToggleContext}
              onNewFolder={onNewFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ className }: FileTreeProps) {
  const { tree, activePath, openFile, selectedContextPaths, toggleContextPath, clearContext, createFolder, setWorkspace } = useWorkspaceStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [tree.path]: true });

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择文件夹作为工作区',
      });

      if (!selected) return;

      const result = await invoke<{ tree: LoadedTreeNode; files: [string, string][] }>('load_folder_as_workspace', {
        folderPath: selected,
      });

      const newTree = convertLoadedNode(result.tree);
      const newFiles: Record<string, string> = {};
      for (const [path, content] of result.files) {
        newFiles[path] = content;
      }

      setWorkspace(selected, newTree, newFiles);
    } catch (err) {
      console.error('打开文件夹失败:', err);
    }
  }, [setWorkspace]);

  const handleNewFolder = useCallback((parentPath: string) => {
    const name = prompt('输入文件夹名称:');
    if (!name || !name.trim()) return;
    createFolder(parentPath, name.trim());
  }, [createFolder]);

  const hasFiles = tree.children && tree.children.length > 0;

  return (
    <div className={`flex flex-col h-full bg-[#1e1e1e] ${className ?? ''}`}>
      <div className="px-3 py-2 bg-[#252526] border-b border-[#3c3c3c] flex justify-between items-center gap-2">
        <div className="text-xs text-gray-400">文件</div>
        <div className="flex gap-1">
          <button
            onClick={handleOpenFolder}
            className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
            title="打开文件夹"
          >
            📂 打开
          </button>
          {selectedContextPaths.length > 0 && (
            <button
              onClick={clearContext}
              className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
              title="清空所有已选上下文"
            >
              清空 ({selectedContextPaths.length})
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {hasFiles ? (
          <NodeItem
            node={tree}
            depth={0}
            expanded={expanded}
            toggleFolder={(path) => setExpanded((prev) => ({ ...prev, [path]: !(prev[path] ?? true) }))}
            activePath={activePath}
            onOpenFile={openFile}
            selectedContextPaths={selectedContextPaths}
            onToggleContext={toggleContextPath}
            onNewFolder={handleNewFolder}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-4">
            <div>暂无文件</div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenFolder}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                📂 打开文件夹
              </button>
              <button
                onClick={() => handleNewFolder('/')}
                className="text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
              >
                📁 新建文件夹
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}