import { useState, useRef, useCallback } from 'react';
import { useAIStore, Message } from '../store/aiStore';
import { FilePatch } from '../store/workspaceStore';
import type { InlineEditRequest, InlineEditResult } from '../inlineEdit/types';
import { deriveReplacementFromFullFile } from '../inlineEdit/deriveReplacement';
import type { AICompletionItem, AICompletionRequest } from '../completion/types';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const MAX_TOOL_ITERATIONS = 4;

type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
  };
};

type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type ApiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function useAI() {
  const { messages, isLoading, addMessage, setLoading, updateMessage } = useAIStore();
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const completionCacheRef = useRef<Map<string, { expiresAt: number; items: AICompletionItem[] }>>(new Map());
  const completionAbortRef = useRef<AbortController | null>(null);
  const completionSeqRef = useRef(0);
  const completionRecentRef = useRef<number[]>([]);

  const extractFilePatches = (content: string): FilePatch[] | null => {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed && parsed.type === 'ai-ide-file-patch' && Array.isArray(parsed.patches)) {
          return parsed.patches.filter((p: any) => p && p.path && p.action && p.path.startsWith('/'));
        }
      } catch (e) {
        // ignore JSON parse error
      }
    }
    return null;
  };

  const buildToolDefinitions = (opts?: { enableSelectionEdit?: boolean }): ToolDefinition[] => {
    const base: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: '列出工作区内文件路径。可选按前缀过滤。',
          parameters: {
            type: 'object',
            properties: {
              prefix: { type: 'string', description: '可选。只返回以该前缀开头的路径，例如 /web' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取工作区内指定文件的内容（可能截断）。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径，必须以 / 开头' },
              maxChars: { type: 'number', description: '可选。最大返回字符数，默认 12000' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_in_files',
          description: '在工作区文件中搜索关键字，返回匹配片段。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键字（简单包含匹配）' },
              paths: { type: 'array', items: { type: 'string' }, description: '可选。限定搜索的文件路径列表' },
              maxMatches: { type: 'number', description: '可选。最大返回匹配条数，默认 50' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'propose_file_patches',
          description: '提出对工作区文件的变更（不会自动应用，需用户在 UI 中审核确认）。',
          parameters: {
            type: 'object',
            properties: {
              patches: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    action: { type: 'string', enum: ['upsert', 'delete', 'rename'] },
                    content: { type: 'string' },
                    oldPath: { type: 'string' },
                  },
                  required: ['path', 'action'],
                  additionalProperties: false,
                },
              },
            },
            required: ['patches'],
            additionalProperties: false,
          },
        },
      },
    ];

    if (opts?.enableSelectionEdit) {
      base.push({
        type: 'function',
        function: {
          name: 'propose_selection_edit',
          description: '提出对活动文件当前选区的替换提案（不会自动应用，需用户在 UI 中审核确认）。',
          parameters: {
            type: 'object',
            properties: {
              activePath: { type: 'string', description: '活动文件路径，必须以 / 开头' },
              selection: {
                type: 'object',
                properties: {
                  from: { type: 'number', description: '选区起始 doc offset' },
                  to: { type: 'number', description: '选区结束 doc offset' },
                },
                required: ['from', 'to'],
                additionalProperties: false,
              },
              replacementText: { type: 'string', description: '用于替换选区的文本（完整替换内容）' },
            },
            required: ['activePath', 'selection', 'replacementText'],
            additionalProperties: false,
          },
        },
      });
    }

    return base;
  };

  const executeTool = async (
    toolName: string,
    args: Record<string, any>,
    handlers?: {
      onPatchesDetected?: (patches: FilePatch[]) => void;
      onSelectionEditDetected?: (proposal: { activePath: string; from: number; to: number; replacementText: string }) => void;
    }
  ): Promise<Record<string, any>> => {
    const workspaceState = (await import('../store/workspaceStore')).useWorkspaceStore.getState();
    const files = workspaceState.files;

    if (toolName === 'list_files') {
      const prefix = typeof args.prefix === 'string' ? args.prefix : '';
      const paths = Object.keys(files).filter((p) => (prefix ? p.startsWith(prefix) : true)).sort();
      return { paths };
    }

    if (toolName === 'read_file') {
      const path = typeof args.path === 'string' ? args.path : '';
      const maxChars = typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) ? Math.max(1, Math.floor(args.maxChars)) : 12000;
      if (!path.startsWith('/')) return { error: 'path 必须以 / 开头' };
      const content = files[path];
      if (content === undefined) return { error: `文件不存在: ${path}` };
      const truncated = content.length > maxChars;
      return { path, content: truncated ? content.slice(0, maxChars) : content, truncated };
    }

    if (toolName === 'search_in_files') {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query) return { error: 'query 不能为空' };
      const maxMatches = typeof args.maxMatches === 'number' && Number.isFinite(args.maxMatches) ? Math.max(1, Math.floor(args.maxMatches)) : 50;

      const allowPaths = Array.isArray(args.paths) ? args.paths.filter((p: any) => typeof p === 'string') : null;
      const candidates = allowPaths ? allowPaths : Object.keys(files);

      const matches: Array<{ path: string; line: number; preview: string }> = [];
      for (const p of candidates) {
        const content = files[p];
        if (content === undefined) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({ path: p, line: i + 1, preview: lines[i].slice(0, 240) });
            if (matches.length >= maxMatches) break;
          }
        }
        if (matches.length >= maxMatches) break;
      }

      return { query, matches };
    }

    if (toolName === 'propose_file_patches') {
      const patches = Array.isArray(args.patches) ? args.patches : [];
      const normalized: FilePatch[] = patches
        .filter((p: any) => p && typeof p.path === 'string' && typeof p.action === 'string' && p.path.startsWith('/'))
        .map((p: any) => ({
          path: p.path,
          action: p.action,
          content: typeof p.content === 'string' ? p.content : undefined,
          oldPath: typeof p.oldPath === 'string' ? p.oldPath : undefined,
        }));

      if (normalized.length === 0) return { error: 'patches 为空或无有效项' };
      if (handlers?.onPatchesDetected) handlers.onPatchesDetected(normalized);
      return { queued: true, patchCount: normalized.length };
    }

    if (toolName === 'propose_selection_edit') {
      const activePath = typeof args.activePath === 'string' ? args.activePath : '';
      const selection = args.selection && typeof args.selection === 'object' ? args.selection : {};
      const from = typeof selection.from === 'number' && Number.isFinite(selection.from) ? Math.max(0, Math.floor(selection.from)) : NaN;
      const to = typeof selection.to === 'number' && Number.isFinite(selection.to) ? Math.max(0, Math.floor(selection.to)) : NaN;
      const replacementText = typeof args.replacementText === 'string' ? args.replacementText : '';

      if (!activePath.startsWith('/')) return { error: 'activePath 必须以 / 开头' };
      if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'selection.from/to 必须为数字' };
      if (replacementText === '') return { error: 'replacementText 不能为空' };

      handlers?.onSelectionEditDetected?.({ activePath, from: Math.min(from, to), to: Math.max(from, to), replacementText });
      return { queued: true, activePath, from: Math.min(from, to), to: Math.max(from, to), replacementLength: replacementText.length };
    }

    return { error: `未知工具: ${toolName}` };
  };

  const formatToolLog = (toolName: string, args: Record<string, any>, result: Record<string, any>) => {
    const payload: Record<string, any> = { tool: toolName };
    if (toolName === 'read_file') {
      payload.args = { path: args.path, maxChars: args.maxChars };
      payload.result = {
        path: result.path,
        truncated: result.truncated,
        contentPreview: typeof result.content === 'string' ? result.content.slice(0, 600) : undefined,
      };
    } else if (toolName === 'list_files') {
      payload.args = { prefix: args.prefix };
      payload.result = { count: Array.isArray(result.paths) ? result.paths.length : undefined, paths: result.paths };
    } else if (toolName === 'search_in_files') {
      payload.args = { query: args.query, paths: args.paths, maxMatches: args.maxMatches };
      payload.result = { query: result.query, matchCount: Array.isArray(result.matches) ? result.matches.length : undefined, matches: result.matches };
    } else if (toolName === 'propose_file_patches') {
      const patches = Array.isArray(args.patches) ? args.patches : [];
      payload.args = {
        patchCount: patches.length,
        patches: patches
          .filter((p: any) => p && typeof p.path === 'string' && typeof p.action === 'string')
          .map((p: any) => ({ path: p.path, action: p.action, oldPath: p.oldPath })),
      };
      payload.result = result;
    } else if (toolName === 'propose_selection_edit') {
      payload.args = {
        activePath: args.activePath,
        selection: args.selection,
        replacementLength: typeof args.replacementText === 'string' ? args.replacementText.length : undefined,
      };
      payload.result = result;
    } else {
      payload.args = args;
      payload.result = result;
    }
    return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  };

  const streamChat = async (
    apiKey: string,
    apiMessages: ApiMessage[],
    tools: ToolDefinition[] | undefined,
    signal: AbortSignal,
    onTextDelta: (delta: string) => void,
    onActivity?: () => void
  ): Promise<{ assistantText: string; toolCalls: ToolCall[] }> => {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        tools,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.error?.message || errorDetail;
      } catch {}
      throw new Error(`API 错误: ${errorDetail}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    const toolCallByIndex = new Map<number, ToolCall>();
    let doneSeen = false;

    const processDataLine = (data: string) => {
      onActivity?.();
      const trimmed = data.trim();
      if (trimmed === '[DONE]') {
        doneSeen = true;
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const textDelta = delta?.content;
        if (typeof textDelta === 'string' && textDelta) {
          fullContent += textDelta;
          onTextDelta(textDelta);
        }

        const toolDeltas = delta?.tool_calls;
        if (Array.isArray(toolDeltas)) {
          for (const td of toolDeltas) {
            const index = typeof td.index === 'number' ? td.index : 0;
            const existing = toolCallByIndex.get(index) ?? {
              id: td.id ?? '',
              type: 'function',
              function: { name: td.function?.name ?? '', arguments: '' },
            };

            if (typeof td.id === 'string' && td.id) existing.id = td.id;
            if (td.function?.name) existing.function.name = td.function.name;
            if (typeof td.function?.arguments === 'string') {
              existing.function.arguments += td.function.arguments;
            }

            toolCallByIndex.set(index, existing);
          }
        }

        if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
          doneSeen = true;
        }
      } catch {}
    };

    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        processDataLine(data);
        if (doneSeen) break;
      }
      if (doneSeen) break;
    }
    if (!doneSeen && buffer.trim().startsWith('data: ')) {
      processDataLine(buffer.trim().slice(6));
    }

    const toolCalls = Array.from(toolCallByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter((c) => c && c.id && c.function?.name);

    return { assistantText: fullContent, toolCalls };
  };

  const runStreamRound = async (
    apiKey: string,
    apiMessages: ApiMessage[],
    tools: ToolDefinition[] | undefined,
    assistantMessageId: string,
    signal: AbortSignal
  ): Promise<{ content: string; toolCalls: ToolCall[] }> => {
    let fullVisibleContent = '';
    const startAt = Date.now();
    const idleTimeoutMs = 30000;
    let timeoutId: number | undefined;
    let rejectTimeout: ((e: Error) => void) | null = null;

    const roundTimeout = new Promise<{ content: string; toolCalls: ToolCall[] }>((_, reject) => {
      rejectTimeout = reject;
    });

    const armTimeout = () => {
      if (!rejectTimeout) return;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const e = new Error('round_timeout') as Error & { elapsedMs?: number };
        e.elapsedMs = Date.now() - startAt;
        rejectTimeout?.(e);
      }, idleTimeoutMs);
    };

    armTimeout();
    signal.addEventListener('abort', () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    });

    const roundResult = streamChat(apiKey, apiMessages, tools, signal, (delta) => {
      fullVisibleContent += delta;
      updateMessage(assistantMessageId, fullVisibleContent);
    }, armTimeout);
    try {
      const { toolCalls } = await Promise.race([roundResult, roundTimeout]);
      return { content: fullVisibleContent, toolCalls };
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  const extractCodeFromMessage = (content: string): string | null => {
    const codeMatch = content.match(/```[\w]*\n?([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
      const extracted = codeMatch[1].trim();
      if (extracted.length > 50) {
        return extracted;
      }
    }

    const htmlMatch = content.match(/<html[\s\S]*?<\/html>/i) ||
                      content.match(/<!DOCTYPE[\s\S]*?<\/html>/i) ||
                      content.match(/<body[\s\S]*?<\/body>/i) ||
                      content.match(/<div[\s\S]*<\/div>/i);
    if (htmlMatch && htmlMatch[0].length > 100) {
      return htmlMatch[0];
    }

    if (content.includes('<!DOCTYPE') || content.includes('<html') || content.includes('<body')) {
      const lines = content.split('\n');
      const codeLines = lines.filter(line =>
        line.includes('<!DOCTYPE') || line.includes('<html') ||
        line.includes('<body') || line.includes('<div') ||
        line.includes('</html>') || line.includes('</body>') ||
        line.includes('<head>') || line.includes('<style') ||
        line.includes('function') || line.includes('class ')
      );
      if (codeLines.length > 5) {
        return codeLines.join('\n');
      }
    }

    return null;
  };

  const parseCompletionItems = (raw: string): AICompletionItem[] => {
    const text = raw.trim();
    const jsonMatch = text.match(/```json\n?([\s\S]*?)```/);
    const candidate = jsonMatch?.[1]?.trim() ?? text;

    const bracketStart = candidate.indexOf('[');
    const bracketEnd = candidate.lastIndexOf(']');
    const maybeJson = bracketStart !== -1 && bracketEnd !== -1 ? candidate.slice(bracketStart, bracketEnd + 1) : candidate;

    let parsed: any;
    try {
      parsed = JSON.parse(maybeJson);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const items: AICompletionItem[] = [];
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue;
      const label = typeof it.label === 'string' ? it.label.trim() : '';
      const insertText = typeof it.insertText === 'string' ? it.insertText : '';
      const detail = typeof it.detail === 'string' ? it.detail : undefined;
      if (!insertText.trim()) continue;
      items.push({ label: label || insertText.slice(0, 24), insertText, detail });
    }

    const seen = new Set<string>();
    const deduped: AICompletionItem[] = [];
    for (const item of items) {
      const key = item.insertText;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= 8) break;
    }
    return deduped;
  };

  const requestCompletions = async (req: AICompletionRequest, signal?: AbortSignal): Promise<AICompletionItem[]> => {
    const apiKey = useAIStore.getState().apiKey;
    if (!apiKey) return [];

    const now = Date.now();
    const recent = completionRecentRef.current.filter((t) => now - t < 1000);
    completionRecentRef.current = recent;
    const isExplicit = !!req.explicit;
    if (!isExplicit && recent.length >= 2) return [];
    completionRecentRef.current.push(now);

    completionAbortRef.current?.abort();
    completionAbortRef.current = new AbortController();
    const localSignal = completionAbortRef.current.signal;
    if (signal) {
      if (signal.aborted) completionAbortRef.current.abort();
      else signal.addEventListener('abort', () => completionAbortRef.current?.abort(), { once: true });
    }

    completionSeqRef.current += 1;
    const seq = completionSeqRef.current;

    const language = req.language || 'plain';
    const prefix = (req.prefix ?? '').slice(-4000);
    const suffix = (req.suffix ?? '').slice(0, 400);
    const contextPaths = Array.isArray(req.contextPaths) ? req.contextPaths.filter((p) => typeof p === 'string') : [];
    const activePath = req.activePath;

    const cacheKey = `${language}\n${activePath}\n${prefix}\n${suffix}\n${contextPaths.join('|')}\n${req.maxCandidates}`;
    const cached = completionCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.items;

    const lastLine = prefix.slice(Math.max(0, prefix.lastIndexOf('\n') + 1));
    const token = (lastLine.match(/[A-Za-z_][\w-]{1,40}$/) ?? [])[0] ?? '';
    const query = token.length >= 2 ? token : '';

    let searchSummary = '';
    let readSummary = '';

    if (query && !localSignal.aborted) {
      const searchRes = await executeTool('search_in_files', { query, paths: contextPaths.length ? contextPaths : undefined, maxMatches: 8 });
      if (Array.isArray((searchRes as any).matches)) {
        const matches = (searchRes as any).matches as Array<{ path: string; line: number; preview: string }>;
        if (matches.length > 0) {
          searchSummary = matches
            .slice(0, 8)
            .map((m) => `${m.path}:${m.line} ${m.preview}`)
            .join('\n');
          const bestPath = matches[0]?.path;
          if (bestPath) {
            const readRes = await executeTool('read_file', { path: bestPath, maxChars: 1400 });
            if (typeof (readRes as any).content === 'string') {
              readSummary = `File: ${bestPath}\n${(readRes as any).content}`;
            }
          }
        }
      }
    }

    if (localSignal.aborted) return [];
    if (seq !== completionSeqRef.current) return [];

    const system = [
      '你是一个代码补全引擎，只输出 JSON 数组，不要解释。',
      '每个元素形如：{"label":"...","insertText":"...","detail":"..."}',
      `候选数量不超过 ${Math.max(1, Math.min(8, Math.floor(req.maxCandidates || 5)))} 条。`,
      '候选必须短小，适合作为补全，不要输出完整文件。',
      '尽量匹配当前语言风格（缩进、引号、分号）。',
      '不要凭空假设项目中存在某个函数/样式；可参考提供的检索/片段信息。',
    ].join('\n');

    const userParts: string[] = [];
    userParts.push(`language: ${language}`);
    userParts.push(`activePath: ${activePath}`);
    userParts.push(`prefix:\n${prefix}`);
    if (suffix) userParts.push(`suffix:\n${suffix}`);
    if (searchSummary) userParts.push(`search_in_files hits:\n${searchSummary}`);
    if (readSummary) userParts.push(`read_file snippet:\n${readSummary}`);
    userParts.push('请输出候选 JSON 数组。');

    let content = '';
    try {
      const res = await runNonStreamRound(apiKey, [{ role: 'system', content: system }, { role: 'user', content: userParts.join('\n\n') }], undefined, localSignal);
      content = res.content ?? '';
    } catch {
      return [];
    }

    if (localSignal.aborted) return [];
    if (seq !== completionSeqRef.current) return [];

    const items = parseCompletionItems(content);
    completionCacheRef.current.set(cacheKey, { expiresAt: now + 60_000, items });
    return items;
  };

  const hasCodeModificationIntent = (userMessage: string): boolean => {
    const codeKeywords = [
      '代码', '页面', 'html', 'css', 'javascript', 'js', 'todo', '列表',
      '登录', '注册', '表单', '按钮', '输入框', '卡片', '菜单', '导航',
      '表格', '弹窗', '模态', '轮播', '动画', '特效',
      'build', 'create', 'generate', 'make', 'write', 'code', 'page', 'app',
    ];
    const actionKeywords = [
      '写', '生成', '创建', '实现', '做', '给我', '帮我',
      '修改', '改变', '更新', '调整', '改成', '改为',
      '添加', '增加', '删除', '移除', '去掉',
      '把', '让', '给', '将', '在', '用',
      'change', 'modify', 'update', 'add', 'remove', 'delete', 'edit',
    ];

    const lowerMessage = userMessage.toLowerCase();
    const hasActionKeyword = actionKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasCodeKeyword = codeKeywords.some(keyword => lowerMessage.includes(keyword));

    return hasActionKeyword && hasCodeKeyword;
  };

  const sendMessage = async (content: string, currentCode?: string, onCodeDetected?: (code: string) => void, onPatchesDetected?: (patches: FilePatch[]) => void) => {
    const apiKey = useAIStore.getState().apiKey;
    if (!apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setError(null);
    setIsStreaming(true);
    setIsAiResponding(true);
    setIsToolRunning(false);
    setActiveToolName(null);

    const assistantMessageId = crypto.randomUUID();
    currentMessageIdRef.current = assistantMessageId;

    addMessage({ role: 'user', content });
    addMessage({ role: 'assistant', content: '' }, assistantMessageId);
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      let systemContent = '你是一个专业的网页开发助手，具备受控的工具调用能力。';
      systemContent += '\n\n【工具使用规则】\n- 需要查看项目文件时，先使用 list_files / read_file / search_in_files。\n- 需要修改多个文件或新建文件时，必须调用 propose_file_patches 提交变更提案，等待用户在 UI 中审核后才会真正应用。\n- 不要编造文件内容；没读到就先读。\n';

      const workspaceState = (await import('../store/workspaceStore')).useWorkspaceStore.getState();
      const selectedPaths = workspaceState.selectedContextPaths;
      if (selectedPaths.length > 0) {
        systemContent += `\n用户选择的上下文文件路径（如需内容请调用 read_file）：\n${selectedPaths.map((p) => `- ${p}`).join('\n')}\n`;
      }

      if (currentCode) {
        systemContent += `\n当前编辑器中的代码（活动文件）如下：\n\`\`\`\n${currentCode}\n\`\`\`\n`;
      }

      systemContent += `\n\n【兼容回退】\n如果工具不可用，且用户要求多文件生成/修改，请输出一个 \`\`\`json ...\`\`\` 代码块，格式为：\n{\n  \"type\": \"ai-ide-file-patch\",\n  \"version\": 1,\n  \"patches\": [ {\"path\":\"/web/index.html\",\"action\":\"upsert\",\"content\":\"...\"} ]\n}\n并且不要在代码块前后输出任何额外文字。`;

      const toolDefs = buildToolDefinitions();
      const history: ApiMessage[] = messages
        .filter((m) => m.role !== 'system' && m.role !== 'tool')
        .map((m: Message) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      let apiMessages: ApiMessage[] = [{ role: 'system', content: systemContent }, ...history, { role: 'user', content }];

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (abortControllerRef.current?.signal.aborted) break;
        if (iter > 0) {
          updateMessage(assistantMessageId, '');
        }
        setIsAiResponding(true);
        setIsToolRunning(false);
        setActiveToolName(null);

        let fullVisibleContent = '';
        let toolCalls: ToolCall[] = [];
        try {
          const result = await runStreamRound(
            apiKey,
            apiMessages,
            toolDefs,
            assistantMessageId,
            abortControllerRef.current.signal
          );
          fullVisibleContent = result.content;
          toolCalls = result.toolCalls;
          setIsAiResponding(false);
        } catch (err) {
          setIsAiResponding(false);
          setIsToolRunning(false);
          setActiveToolName(null);
          if (err instanceof Error && err.message === 'round_timeout') {
            const elapsedMs = (err as Error & { elapsedMs?: number }).elapsedMs;
            const msgs = useAIStore.getState().messages;
            const msg = msgs.find((m) => m.id === assistantMessageId);
            const base = msg?.content ?? '';
            const elapsedText = typeof elapsedMs === 'number' ? `（${Math.max(1, Math.round(elapsedMs / 1000))}s）` : '';
            updateMessage(assistantMessageId, base + `\n\n⚠️ 本轮响应超时${elapsedText}，请重试。`);
          } else if (err instanceof Error && err.name !== 'AbortError') {
            updateMessage(assistantMessageId, `❌ 错误: ${err.message}`);
          }
          break;
        }

        const hasToolCalls = toolCalls.length > 0;
        if (!hasToolCalls) {
          const isGenerateRequest = content.includes('写') || content.includes('生成') || content.includes('创建') || content.includes('给我') || content.includes('帮我');
          const patches = extractFilePatches(fullVisibleContent);
          if (patches && patches.length > 0) {
            if (onPatchesDetected) onPatchesDetected(patches);
          } else if (onCodeDetected && hasCodeModificationIntent(content)) {
            if (isGenerateRequest || (currentCode && currentCode.trim().length > 0)) {
              const detectedCode = extractCodeFromMessage(fullVisibleContent);
              if (detectedCode && (!currentCode || detectedCode !== currentCode)) {
                onCodeDetected(detectedCode);
              }
            }
          }
          break;
        }

        apiMessages = [
          ...apiMessages,
          {
            role: 'assistant',
            content: fullVisibleContent ? fullVisibleContent : null,
            tool_calls: toolCalls,
          },
        ];

        const allPatches: FilePatch[] = [];

        for (const tc of toolCalls) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            parsedArgs = { _raw: tc.function.arguments };
          }

          setIsToolRunning(true);
          setActiveToolName(tc.function.name);
          let toolResult: Record<string, any>;
          try {
            toolResult = await executeTool(tc.function.name, parsedArgs);
          } finally {
            setIsToolRunning(false);
            setActiveToolName(null);
          }

          addMessage(
            { role: 'tool', content: formatToolLog(tc.function.name, parsedArgs, toolResult), toolName: tc.function.name, toolCallId: tc.id },
          );

          if (tc.function.name === 'propose_file_patches' && Array.isArray(parsedArgs.patches)) {
            const normalized: FilePatch[] = parsedArgs.patches
              .filter((p: any) => p && typeof p.path === 'string' && typeof p.action === 'string' && p.path.startsWith('/'))
              .map((p: any) => ({
                path: p.path,
                action: p.action,
                content: typeof p.content === 'string' ? p.content : undefined,
                oldPath: typeof p.oldPath === 'string' ? p.oldPath : undefined,
              }));
            if (normalized.length > 0) allPatches.push(...normalized);
          }

          apiMessages = [
            ...apiMessages,
            {
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            },
          ];
        }

        if (allPatches.length > 0 && onPatchesDetected) {
          onPatchesDetected(allPatches);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('请求已中止');
      } else {
        const errorMessage = err instanceof Error ? err.message : '发生未知错误';
        setError(errorMessage);
        updateMessage(assistantMessageId, `❌ 错误: ${errorMessage}`);
      }
    } finally {
      setIsStreaming(false);
      setIsAiResponding(false);
      setIsToolRunning(false);
      setActiveToolName(null);
      setLoading(false);
      currentMessageIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const generateCode = async (prompt: string, insertCallback: (code: string) => void) => {
    const apiKey = useAIStore.getState().apiKey;
    if (!apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setError(null);
    setIsStreaming(true);
    setIsAiResponding(true);
    setIsToolRunning(false);
    setActiveToolName(null);

    const assistantMessageId = crypto.randomUUID();
    currentMessageIdRef.current = assistantMessageId;

    addMessage({ role: 'user', content: prompt });
    addMessage({ role: 'assistant', content: '' }, assistantMessageId);
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const apiMessages: ApiMessage[] = [
        {
          role: 'system',
          content: '你是一个专业的网页开发助手。用户要求你生成代码时，请直接返回代码，不要有其他解释。代码要用完整的可运行的格式返回。',
        },
        {
          role: 'user',
          content: `请生成一个完整的 HTML 页面，包含 CSS 和 JavaScript，实现以下功能：\n${prompt}\n\n只返回代码，不要有任何解释。`,
        },
      ];

      const { content: fullContent } = await runStreamRound(apiKey, apiMessages, undefined, assistantMessageId, abortControllerRef.current.signal);
      const codeMatch = fullContent.match(/```(?:html)?\n?([\s\S]*?)```/) || [null, fullContent];
      const cleanCode = codeMatch[1] || fullContent;

      insertCallback(cleanCode);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('请求已中止');
      } else {
        const errorMessage = err instanceof Error ? err.message : '发生未知错误';
        setError(errorMessage);
        updateMessage(assistantMessageId, `❌ 错误: ${errorMessage}`);
      }
    } finally {
      setIsStreaming(false);
      setIsAiResponding(false);
      setIsToolRunning(false);
      setActiveToolName(null);
      setLoading(false);
      currentMessageIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setIsAiResponding(false);
      setIsToolRunning(false);
      setActiveToolName(null);
    }
  }, []);

  const regenerate = useCallback(() => {
    if (messages.length < 2) return;
    let assistantIdx = -1;
    let userIdx = -1;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (assistantIdx === -1 && messages[i].role === 'assistant') {
        assistantIdx = i;
        continue;
      }
      if (assistantIdx !== -1 && messages[i].role === 'user') {
        userIdx = i;
        break;
      }
    }

    if (assistantIdx === -1 || userIdx === -1) return;
    const userContent = messages[userIdx].content;
    useAIStore.getState().setMessages(messages.slice(0, userIdx));

    if (userContent.includes('请生成') || userContent.includes('帮我写')) {
      const prompt = userContent.replace(/请生成一个完整的 HTML 页面.*?：\n/, '').replace(/只返回代码.*/, '').trim();
      generateCode(prompt, () => {});
    } else {
      sendMessage(userContent);
    }
  }, [messages, sendMessage, generateCode]);

  const modifyCode = async (userRequest: string, currentCode: string, updateCode: (code: string) => void) => {
    const apiKey = useAIStore.getState().apiKey;
    if (!apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setError(null);
    setIsStreaming(true);
    setIsAiResponding(true);
    setIsToolRunning(false);
    setActiveToolName(null);

    const assistantMessageId = crypto.randomUUID();
    currentMessageIdRef.current = assistantMessageId;

    addMessage({ role: 'user', content: userRequest });
    addMessage({ role: 'assistant', content: '' }, assistantMessageId);
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const apiMessages: ApiMessage[] = [
        {
          role: 'system',
          content: `你是一个专业的网页开发助手。用户会提供一段代码和修改要求，你需要根据要求修改代码。

重要规则：
1. 只返回修改后的完整代码，不要有任何解释
2. 将代码放在 HTML 代码块中返回
3. 代码必须是完整的、可运行的
4. 保持原有的代码结构和格式，只修改需要修改的部分`,
        },
        {
          role: 'user',
          content: `当前代码：\n\`\`\`html\n${currentCode}\n\`\`\`\n\n修改要求：${userRequest}\n\n请返回修改后的完整代码，不要有任何解释。`,
        },
      ];

      const { content: fullContent } = await runStreamRound(apiKey, apiMessages, undefined, assistantMessageId, abortControllerRef.current.signal);
      const codeMatch = fullContent.match(/```(?:html)?\n?([\s\S]*?)```/) || [null, fullContent];
      const cleanCode = codeMatch[1] || fullContent;

      if (cleanCode.trim()) {
        updateCode(cleanCode);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('请求已中止');
      } else {
        const errorMessage = err instanceof Error ? err.message : '发生未知错误';
        setError(errorMessage);
        updateMessage(assistantMessageId, `❌ 错误: ${errorMessage}`);
      }
    } finally {
      setIsStreaming(false);
      setIsAiResponding(false);
      setIsToolRunning(false);
      setActiveToolName(null);
      setLoading(false);
      currentMessageIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const runNonStreamRound = async (
    apiKey: string,
    apiMessages: ApiMessage[],
    tools: ToolDefinition[] | undefined,
    signal: AbortSignal
  ): Promise<{ content: string; toolCalls: ToolCall[] }> => {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        tools,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.error?.message || errorDetail;
      } catch {}
      throw new Error(`API 错误: ${errorDetail}`);
    }

    const json = await response.json();
    const msg = json.choices?.[0]?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const toolCalls: ToolCall[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    return { content, toolCalls };
  };

  const requestInlineEdit = async (request: InlineEditRequest): Promise<InlineEditResult | null> => {
    const apiKey = useAIStore.getState().apiKey;
    if (!apiKey) {
      setError('请先在设置中配置 API Key');
      return null;
    }
    if (!request.activePath || !request.activePath.startsWith('/')) {
      setError('Inline Edit: activePath 非法');
      return null;
    }

    setError(null);
    setIsAiResponding(true);
    setIsToolRunning(false);
    setActiveToolName(null);
    setLoading(true);

    const assistantMessageId = crypto.randomUUID();
    addMessage({ role: 'user', content: `[Inline Edit] ${request.instruction}` });
    addMessage({ role: 'assistant', content: '' }, assistantMessageId);

    const abortController = new AbortController();

    try {
      const toolDefs = buildToolDefinitions({ enableSelectionEdit: true });
      const workspaceState = (await import('../store/workspaceStore')).useWorkspaceStore.getState();
      const originalFullText = workspaceState.files[request.activePath] ?? '';

      let systemContent = '你是一个专业的代码编辑助手，具备受控的工具调用能力。';
      systemContent += '\n\n【Inline Edit 模式】';
      systemContent += `\n- 活动文件: ${request.activePath}`;
      if (request.languageHint) systemContent += `\n- 语言提示: ${request.languageHint}`;
      systemContent += `\n- 选区: from=${request.selection.from}, to=${request.selection.to} (L${request.selection.lineFrom}-L${request.selection.lineTo})`;
      systemContent += `\n\n选区文本如下：\n\`\`\`\n${request.selection.text}\n\`\`\``;
      systemContent += '\n\n【输出规则】';
      systemContent += '\n- 只允许修改选区内容，不要改动选区外任何文本。';
      systemContent += '\n- 必须通过工具提交变更提案：优先调用 propose_selection_edit。';
      systemContent += '\n- 若无法使用 propose_selection_edit，可回退为对活动文件调用 propose_file_patches(upsert)，但仍必须只修改选区部分。';
      systemContent += '\n- 不要在正文中直接输出“最终代码”作为自动应用依据。';
      systemContent += '\n\n【工具使用规则】';
      systemContent += '\n- 需要查看项目文件时，先使用 list_files / read_file / search_in_files。';
      systemContent += '\n- 变更必须通过 propose_selection_edit 或 propose_file_patches 提交提案。';

      const contextPaths = request.contextPaths && request.contextPaths.length > 0 ? request.contextPaths : workspaceState.selectedContextPaths;
      if (contextPaths.length > 0) {
        systemContent += `\n\n用户选择的上下文文件路径（如需内容请调用 read_file）：\n${contextPaths.map((p) => `- ${p}`).join('\n')}\n`;
      }

      let apiMessages: ApiMessage[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: request.instruction },
      ];

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const { content, toolCalls } = await runNonStreamRound(apiKey, apiMessages, toolDefs, abortController.signal);
        updateMessage(assistantMessageId, content);
        setIsAiResponding(false);

        if (!toolCalls || toolCalls.length === 0) {
          const extracted = extractCodeFromMessage(content);
          const replacementText = (extracted ?? content).trim();
          if (replacementText) {
            return { replacementText };
          }
          setError('Inline Edit 未返回可用提案');
          return null;
        }

        apiMessages = [
          ...apiMessages,
          { role: 'assistant', content: content ? content : null, tool_calls: toolCalls },
        ];

        let fallbackUpsertContent: string | null = null;
        let capturedReplacement: string | null = null;

        for (const tc of toolCalls) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            parsedArgs = { _raw: tc.function.arguments };
          }

          if (tc.function.name === 'propose_selection_edit') {
            if (typeof parsedArgs.replacementText === 'string' && parsedArgs.replacementText.trim()) {
              capturedReplacement = parsedArgs.replacementText;
            }
          }

          if (tc.function.name === 'propose_file_patches' && Array.isArray(parsedArgs.patches)) {
            const patch = parsedArgs.patches.find((p: any) => p && p.action === 'upsert' && p.path === request.activePath && typeof p.content === 'string');
            if (patch && typeof patch.content === 'string') {
              fallbackUpsertContent = patch.content;
            }
          }

          setIsToolRunning(true);
          setActiveToolName(tc.function.name);
          let toolResult: Record<string, any>;
          try {
            toolResult = await executeTool(tc.function.name, parsedArgs);
          } finally {
            setIsToolRunning(false);
            setActiveToolName(null);
          }

          addMessage(
            { role: 'tool', content: formatToolLog(tc.function.name, parsedArgs, toolResult), toolName: tc.function.name, toolCallId: tc.id },
          );

          apiMessages = [
            ...apiMessages,
            { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) },
          ];
        }

        if (capturedReplacement && capturedReplacement.trim()) {
          return { replacementText: capturedReplacement };
        }

        if (fallbackUpsertContent) {
          const derived = deriveReplacementFromFullFile({
            originalFullText,
            modifiedFullText: fallbackUpsertContent,
            from: request.selection.from,
            to: request.selection.to,
          });
          if (derived !== null) return { replacementText: derived };
          setError('Inline Edit: 无法从文件提案中提取选区替换内容');
          return null;
        }

        setIsAiResponding(true);
      }

      setError('Inline Edit: 超过最大工具轮次仍未得到提案');
      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '发生未知错误';
      setError(errorMessage);
      updateMessage(assistantMessageId, `❌ 错误: ${errorMessage}`);
      return null;
    } finally {
      setIsAiResponding(false);
      setIsToolRunning(false);
      setActiveToolName(null);
      setLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    isStreaming,
    isToolRunning,
    activeToolName,
    isAiResponding,
    error,
    sendMessage,
    generateCode,
    modifyCode,
    requestInlineEdit,
    requestCompletions,
    stopGeneration,
    regenerate,
  };
}
