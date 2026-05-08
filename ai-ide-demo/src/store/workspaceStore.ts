import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

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
  workspacePath: string;
  openFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  createFile: (parentPath: string, name: string, initialContent?: string) => string;
  createFolder: (parentPath: string, name: string) => string;
  setWorkspace: (path: string, tree: WorkspaceNode, files: FileMap) => void;
  clearActiveFile: () => void;
  toggleContextPath: (path: string) => void;
  clearContext: () => void;
  applyFilePatches: (patches: FilePatch[]) => void;
}

const EMPTY_TREE: WorkspaceNode = {
  type: 'folder',
  name: '空工作区',
  path: '/',
  children: [],
};

const EMPTY_FILES: FileMap = {};

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
  tree: EMPTY_TREE,
  files: EMPTY_FILES,
  activePath: '',
  selectedContextPaths: [],
  workspacePath: '',

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

    const { workspacePath } = get();

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

          if (workspacePath && patch.path.startsWith('/')) {
            const relativePath = patch.path.slice(1);
            invoke('write_workspace_file', { workspacePath, relativePath, content: patch.content }).catch(console.error);
          }
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

          if (workspacePath && patch.path.startsWith('/')) {
            const relativePath = patch.path.slice(1);
            invoke('write_workspace_file', { workspacePath, relativePath, content }).catch(console.error);
          }
          continue;
        }
      }

      return { files: nextFiles, tree: nextTree, activePath: newActivePath, selectedContextPaths: nextSelectedContextPaths };
    });
  },

  openFile: (path) => {
    const { files } = get();
    console.log('[DEBUG workspaceStore] openFile called:', path);
    console.log('[DEBUG workspaceStore] available files:', Object.keys(files));
    if (files[path] === undefined) {
      console.log('[DEBUG workspaceStore] file not found in store:', path);
      return;
    }
    console.log('[DEBUG workspaceStore] setting activePath to:', path);
    set({ activePath: path });
  },

  updateFile: (path, content) => {
    set((state) => ({ files: { ...state.files, [path]: content } }));
    const { workspacePath } = get();
    if (workspacePath && path.startsWith('/')) {
      const relativePath = path.slice(1);
      invoke('write_workspace_file', { workspacePath, relativePath, content }).catch(console.error);
    }
  },

  createFile: (parentPath, name, initialContent = '') => {
    const { files, tree, workspacePath } = get();
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

    if (workspacePath && newPath.startsWith('/')) {
      const relativePath = newPath.slice(1);
      invoke('write_workspace_file', { workspacePath, relativePath, content: initialContent }).catch(console.error);
    }
    return newPath;
  },

  createFolder: (parentPath, name) => {
    const { tree } = get();
    const parent = findNodeByPath(tree, parentPath);
    if (!parent || parent.type !== 'folder') return '';

    const normalizedParent = parentPath === '/' ? '' : parentPath;
    const newPath = `${normalizedParent}/${name}`;

    const existing = findNodeByPath(tree, newPath);
    if (existing) return '';

    const child: WorkspaceNode = { type: 'folder', name, path: newPath, children: [] };
    set((state) => ({
      tree: updateTreeNode(state.tree, parentPath, (n) => insertChild(n, child)),
    }));
    return newPath;
  },

  setWorkspace: (path, tree, files) => {
    set({
      workspacePath: path,
      tree,
      files,
      activePath: '',
      selectedContextPaths: [],
    });
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
