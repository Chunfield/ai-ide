import { create } from 'zustand';

export type WorkspaceNodeType = 'file' | 'folder';

export interface WorkspaceNode {
  type: WorkspaceNodeType;
  name: string;
  path: string;
  children?: WorkspaceNode[];
}

export type FileMap = Record<string, string>;

export interface FilePatch {
  path: string;
  action: 'upsert' | 'delete' | 'rename';
  content?: string;
  oldPath?: string;
}

interface WorkspaceStore {
  tree: WorkspaceNode;
  files: FileMap;
  activePath: string;
  selectedContextPaths: string[];
  openFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  createFile: (parentPath: string, name: string, initialContent?: string) => string;
  clearActiveFile: () => void;
  toggleContextPath: (path: string) => void;
  clearContext: () => void;
  applyFilePatches: (patches: FilePatch[]) => void;
}

const DEFAULT_TREE: WorkspaceNode = {
  type: 'folder',
  name: 'demo-project',
  path: '/',
  children: [
    { type: 'file', name: 'README.md', path: '/README.md' },
    { type: 'file', name: 'project.godot', path: '/project.godot' },
    {
      type: 'folder',
      name: 'scenes',
      path: '/scenes',
      children: [{ type: 'file', name: 'Main.tscn', path: '/scenes/Main.tscn' }],
    },
    {
      type: 'folder',
      name: 'scripts',
      path: '/scripts',
      children: [{ type: 'file', name: 'player.gd', path: '/scripts/player.gd' }],
    },
    {
      type: 'folder',
      name: 'web',
      path: '/web',
      children: [{ type: 'file', name: 'index.html', path: '/web/index.html' }],
    },
  ],
};

const DEFAULT_FILES: FileMap = {
  '/README.md': `# AI IDE Demo\n\n- 在左侧文件树切换文件\n- 在中间编辑器编辑内容\n- 在右侧用 AI 修改当前文件，然后在 Diff 弹窗中应用修改\n`,
  '/project.godot': `[gd_project]\nconfig_version=5\n\n[application]\nconfig/name=\"AI IDE Demo\"\nrun/main_scene=\"res://scenes/Main.tscn\"\n`,
  '/scenes/Main.tscn': `[gd_scene load_steps=2 format=3]\n\n[node name=\"Main\" type=\"Node2D\"]\n`,
  '/scripts/player.gd': `extends CharacterBody2D\n\nvar speed := 200.0\n\nfunc _physics_process(delta: float) -> void:\n\tvar input_dir := Vector2.ZERO\n\tinput_dir.x = Input.get_action_strength(\"ui_right\") - Input.get_action_strength(\"ui_left\")\n\tinput_dir.y = Input.get_action_strength(\"ui_down\") - Input.get_action_strength(\"ui_up\")\n\tvelocity = input_dir.normalized() * speed\n\tmove_and_slide()\n`,
  '/web/index.html': `<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>AI 生成页面</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body {\n      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n      min-height: 100vh;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n    .container {\n      background: white;\n      padding: 2rem;\n      border-radius: 16px;\n      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);\n      text-align: center;\n    }\n    h1 { color: #333; margin-bottom: 1rem; }\n    p { color: #666; }\n  </style>\n</head>\n<body>\n  <div class=\"container\">\n    <h1>AI IDE Demo</h1>\n    <p>在右侧输入：帮我把背景改成深色，并加一个按钮</p>\n  </div>\n</body>\n</html>\n`,
};

function findNodeByPath(node: WorkspaceNode, path: string): WorkspaceNode | null {
  if (node.path === path) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

function insertChild(folder: WorkspaceNode, child: WorkspaceNode): WorkspaceNode {
  if (folder.type !== 'folder') return folder;
  const existing = folder.children ?? [];
  return { ...folder, children: [...existing, child] };
}

function isValidWorkspacePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/')) return false;
  if (path.length > 1 && path.endsWith('/')) return false;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return path === '/';
  if (parts.some((p) => p === '.' || p === '..')) return false;
  return true;
}

function updateTreeNode(node: WorkspaceNode, targetPath: string, updater: (n: WorkspaceNode) => WorkspaceNode): WorkspaceNode {
  if (node.path === targetPath) return updater(node);
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => updateTreeNode(c, targetPath, updater)) };
}

function ensureFolderPath(root: WorkspaceNode, folderPath: string): WorkspaceNode {
  if (!isValidWorkspacePath(folderPath)) return root;
  if (folderPath === '/') return root;

  const parts = folderPath.split('/').filter(Boolean);
  let nextRoot = root;
  let currentPath = '';

  for (const part of parts) {
    const parentPath = currentPath === '' ? '/' : currentPath;
    currentPath = currentPath === '' ? `/${part}` : `${currentPath}/${part}`;

    const existing = findNodeByPath(nextRoot, currentPath);
    if (existing) continue;

    const parentNode = findNodeByPath(nextRoot, parentPath);
    if (!parentNode || parentNode.type !== 'folder') continue;

    const newFolder: WorkspaceNode = { type: 'folder', name: part, path: currentPath, children: [] };
    nextRoot = updateTreeNode(nextRoot, parentPath, (n) => insertChild(n, newFolder));
  }

  return nextRoot;
}

function removeNodeByPath(node: WorkspaceNode, targetPath: string): { node: WorkspaceNode; removed: boolean } {
  if (!node.children || node.children.length === 0) return { node, removed: false };
  let removed = false;
  const nextChildren: WorkspaceNode[] = [];
  for (const child of node.children) {
    if (child.path === targetPath) {
      removed = true;
      continue;
    }
    if (child.children && targetPath.startsWith(child.path + '/')) {
      const res = removeNodeByPath(child, targetPath);
      removed = removed || res.removed;
      nextChildren.push(res.node);
    } else {
      nextChildren.push(child);
    }
  }
  if (!removed) return { node, removed: false };
  return { node: { ...node, children: nextChildren }, removed: true };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  tree: DEFAULT_TREE,
  files: DEFAULT_FILES,
  activePath: '/web/index.html',
  selectedContextPaths: [],

  toggleContextPath: (path) => {
    set((state) => {
      const exists = state.selectedContextPaths.includes(path);
      if (exists) {
        return { selectedContextPaths: state.selectedContextPaths.filter((p) => p !== path) };
      } else {
        return { selectedContextPaths: [...state.selectedContextPaths, path] };
      }
    });
  },

  clearContext: () => {
    set({ selectedContextPaths: [] });
  },

  applyFilePatches: (patches) => {
    if (!patches || patches.length === 0) return;

    set((state) => {
      let nextFiles = { ...state.files };
      let nextTree = state.tree;
      let newActivePath = state.activePath;
      let nextSelectedContextPaths = [...state.selectedContextPaths];

      for (const patch of patches) {
        if (!patch || typeof patch !== 'object') continue;
        if (!patch.path || typeof patch.path !== 'string') continue;

        if (patch.action === 'upsert') {
          if (!isValidWorkspacePath(patch.path) || patch.path === '/') continue;
          if (patch.content === undefined) continue;

          const rawParts = patch.path.split('/').filter(Boolean);
          if (rawParts.length === 0) continue;

          const fileName = rawParts[rawParts.length - 1];
          const parentParts = rawParts.slice(0, -1);
          const parentPath = parentParts.length === 0 ? '/' : '/' + parentParts.join('/');

          nextTree = ensureFolderPath(nextTree, parentPath);
          const existingNode = findNodeByPath(nextTree, patch.path);
          if (!existingNode) {
            const child: WorkspaceNode = { type: 'file', name: fileName, path: patch.path };
            const parentNode = findNodeByPath(nextTree, parentPath);
            if (parentNode && parentNode.type === 'folder') {
              nextTree = updateTreeNode(nextTree, parentPath, (n) => insertChild(n, child));
            }
            newActivePath = patch.path;
          }

          nextFiles[patch.path] = patch.content;
          continue;
        }

        if (patch.action === 'delete') {
          if (!isValidWorkspacePath(patch.path) || patch.path === '/') continue;
          if (nextFiles[patch.path] === undefined) continue;

          delete nextFiles[patch.path];
          nextTree = removeNodeByPath(nextTree, patch.path).node;
          nextSelectedContextPaths = nextSelectedContextPaths.filter((p) => p !== patch.path);
          if (newActivePath === patch.path) {
            const remaining = Object.keys(nextFiles).sort();
            newActivePath = remaining[0] ?? '/web/index.html';
          }
          continue;
        }

        if (patch.action === 'rename') {
          const oldPath = patch.oldPath;
          if (!oldPath || typeof oldPath !== 'string') continue;
          if (!isValidWorkspacePath(oldPath) || oldPath === '/') continue;
          if (!isValidWorkspacePath(patch.path) || patch.path === '/') continue;
          if (nextFiles[oldPath] === undefined) continue;
          if (oldPath === patch.path) continue;

          const content = patch.content ?? nextFiles[oldPath];
          delete nextFiles[oldPath];
          nextTree = removeNodeByPath(nextTree, oldPath).node;
          nextSelectedContextPaths = nextSelectedContextPaths.map((p) => (p === oldPath ? patch.path : p));
          if (newActivePath === oldPath) newActivePath = patch.path;

          const rawParts = patch.path.split('/').filter(Boolean);
          if (rawParts.length === 0) continue;
          const fileName = rawParts[rawParts.length - 1];
          const parentParts = rawParts.slice(0, -1);
          const parentPath = parentParts.length === 0 ? '/' : '/' + parentParts.join('/');
          nextTree = ensureFolderPath(nextTree, parentPath);

          const existingNode = findNodeByPath(nextTree, patch.path);
          if (!existingNode) {
            const child: WorkspaceNode = { type: 'file', name: fileName, path: patch.path };
            const parentNode = findNodeByPath(nextTree, parentPath);
            if (parentNode && parentNode.type === 'folder') {
              nextTree = updateTreeNode(nextTree, parentPath, (n) => insertChild(n, child));
            }
          }

          nextFiles[patch.path] = content;
          continue;
        }
      }

      return { files: nextFiles, tree: nextTree, activePath: newActivePath, selectedContextPaths: nextSelectedContextPaths };
    });
  },

  openFile: (path) => {
    const { files } = get();
    if (files[path] === undefined) return;
    set({ activePath: path });
  },

  updateFile: (path, content) => {
    set((state) => ({ files: { ...state.files, [path]: content } }));
  },

  createFile: (parentPath, name, initialContent = '') => {
    const { files, tree } = get();
    const parent = findNodeByPath(tree, parentPath);
    if (!parent || parent.type !== 'folder') return '';

    const normalizedParent = parentPath === '/' ? '' : parentPath;
    const newPath = `${normalizedParent}/${name}`;
    if (files[newPath] !== undefined) return '';

    const child: WorkspaceNode = { type: 'file', name, path: newPath };
    set((state) => ({
      files: { ...state.files, [newPath]: initialContent },
      tree: updateTreeNode(state.tree, parentPath, (n) => insertChild(n, child)),
      activePath: newPath,
    }));
    return newPath;
  },

  clearActiveFile: () => {
    const { activePath } = get();
    set((state) => ({ files: { ...state.files, [activePath]: '' } }));
  },
}));

export function getActiveFileLanguage(path: string): 'html' | 'javascript' | 'python' | 'plain' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  return 'plain';
}

export function getActiveFileDisplayName(path: string): string {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
