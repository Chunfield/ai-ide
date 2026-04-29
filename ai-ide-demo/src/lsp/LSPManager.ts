export interface LSPServerConfig {
  languageId: string;
  serverCommand: string;
  serverArgs?: string[];
  rootPath?: string;
}

export interface LSPConnection {
  languageId: string;
  dispose: () => void;
}

export interface LSPStatus {
  languageId: string;
  status: 'connected' | 'disconnected' | 'starting' | 'error';
  message?: string;
}

export interface LanguageServerInfo {
  command: string;
  versionCommand: string;
  versionArgs?: string[];
  languageIds: string[];
}

export const SUPPORTED_LANGUAGE_SERVERS: LanguageServerInfo[] = [
  {
    command: 'godot-lsp',
    versionCommand: 'godot-lsp',
    versionArgs: ['--version'],
    languageIds: ['gdscript'],
  },
  {
    command: 'typescript-language-server',
    versionCommand: 'typescript-language-server',
    versionArgs: ['--version'],
    languageIds: ['typescript', 'javascript'],
  },
  {
    command: 'pylsp',
    versionCommand: 'pylsp',
    versionArgs: ['--version'],
    languageIds: ['python'],
  },
  {
    command: 'python-lsp-server',
    versionCommand: 'python',
    versionArgs: ['-m', 'pylsp', '--version'],
    languageIds: ['python'],
  },
];

export class LSPManager {
  private status: Map<string, LSPStatus> = new Map();
  private listeners: Set<(status: LSPStatus) => void> = new Set();

  constructor() {
  }

  getStatus(languageId: string): LSPStatus | undefined {
    return this.status.get(languageId);
  }

  getAllStatuses(): LSPStatus[] {
    return Array.from(this.status.values());
  }

  onStatusChange(callback: (status: LSPStatus) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private updateStatus(languageId: string, status: LSPStatus): void {
    this.status.set(languageId, status);
    this.listeners.forEach(cb => cb(status));
  }

  async checkServerAvailability(_config: LSPServerConfig): Promise<boolean> {
    return true;
  }

  async startServer(config: LSPServerConfig): Promise<LSPConnection | null> {
    this.updateStatus(config.languageId, {
      languageId: config.languageId,
      status: 'starting',
      message: `Starting ${config.serverCommand}...`,
    });

    try {
      this.updateStatus(config.languageId, {
        languageId: config.languageId,
        status: 'connected',
        message: `${config.serverCommand} ready`,
      });

      return {
        languageId: config.languageId,
        dispose: () => {
          this.updateStatus(config.languageId, {
            languageId: config.languageId,
            status: 'disconnected',
            message: 'Server stopped',
          });
        },
      };
    } catch (error) {
      this.updateStatus(config.languageId, {
        languageId: config.languageId,
        status: 'error',
        message: `Failed to start: ${error}`,
      });
      return null;
    }
  }

  async stopServer(languageId: string): Promise<void> {
    this.updateStatus(languageId, {
      languageId,
      status: 'disconnected',
      message: 'Server stopped',
    });
  }

  async stopAll(): Promise<void> {
    for (const [languageId] of this.status) {
      await this.stopServer(languageId);
    }
  }

  isServerRunning(languageId: string): boolean {
    const status = this.status.get(languageId);
    return status?.status === 'connected';
  }

  getActiveLanguageIds(): string[] {
    return Array.from(this.status.entries())
      .filter(([, s]) => s.status === 'connected')
      .map(([id]) => id);
  }
}

export function getLanguageIdFromExtension(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mapping: Record<string, string> = {
    gd: 'gdscript',
    gdscript: 'gdscript',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    sass: 'css',
    json: 'json',
  };
  return mapping[ext] || 'plaintext';
}

export function detectAvailableLanguageServers(): LSPServerConfig[] {
  return SUPPORTED_LANGUAGE_SERVERS.map(server => ({
    languageId: server.languageIds[0],
    serverCommand: server.command,
  }));
}

export const DEFAULT_LANGUAGE_IDS = [
  { id: 'gdscript', name: 'GDScript', extension: '.gd' },
  { id: 'typescript', name: 'TypeScript', extension: '.ts' },
  { id: 'javascript', name: 'JavaScript', extension: '.js' },
  { id: 'python', name: 'Python', extension: '.py' },
  { id: 'html', name: 'HTML', extension: '.html' },
  { id: 'css', name: 'CSS', extension: '.css' },
  { id: 'json', name: 'JSON', extension: '.json' },
];