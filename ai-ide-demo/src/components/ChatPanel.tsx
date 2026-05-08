import { useState, useRef, useEffect, useCallback } from 'react';
import { useAI } from '../hooks/useAI';
import { useAIStore } from '../store/aiStore';
import { FilePatch, useWorkspaceStore } from '../store/workspaceStore';

interface ChatPanelProps {
  ai: ReturnType<typeof useAI>;
  currentCode?: string;
  onCodeDetected?: (code: string) => void;
  onPatchesDetected?: (patches: FilePatch[]) => void;
}

interface Command {
  name: string;
  description: string;
  handler: () => void;
}

export function ChatPanel({ ai, currentCode = '', onCodeDetected, onPatchesDetected }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const { clearMessages } = useAIStore();
  const {
    messages,
    isLoading,
    isStreaming,
    isToolRunning,
    activeToolName,
    isAiResponding,
    error,
    sendMessage,
    stopGeneration,
    regenerate,
  } = ai;
  const { selectedContextPaths, clearContext } = useWorkspaceStore();
  const loadingLabel = isToolRunning
    ? `工具调用中${activeToolName ? `: ${activeToolName}` : ''}...`
    : isAiResponding
    ? 'AI 输出中...'
    : '处理中...';

  useEffect(() => {
    if (!messagesEndRef.current) return;
    if (userScrolledUpRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 100;
  }, []);

  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [isStreaming]);

  const handleNewFile = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ai-ide:new-file'));
  }, []);

  const handleClearChat = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  const commands: Command[] = [
    { name: '/new', description: '新建文件', handler: handleNewFile },
    { name: '/clear', description: '清除对话', handler: handleClearChat },
    { name: '/preview', description: '切换预览', handler: () => window.dispatchEvent(new CustomEvent('ai-ide:toggle-preview')) },
  ];

  const parseCommand = useCallback((input: string): { isCommand: boolean; command?: Command; args?: string } => {
    for (const cmd of commands) {
      if (input.startsWith(cmd.name)) {
        return { isCommand: true, command: cmd, args: input.slice(cmd.name.length).trim() };
      }
    }
    return { isCommand: false };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const { isCommand, command } = parseCommand(input);
    if (isCommand && command) {
      command.handler();
      setInput('');
      return;
    }

    await sendMessage(input, currentCode, onCodeDetected, onPatchesDetected);
    setInput('');
  };

  const handleStop = () => {
    stopGeneration();
  };

  const handleRegenerate = () => {
    regenerate();
  };

  const renderContent = (content: string, isStreaming: boolean = false, hideJsonBlocks: boolean = false) => {
    let processedContent = content;

    if (hideJsonBlocks) {
      processedContent = processedContent.replace(/```json\n?([\s\S]*?)```/g, '[正在处理文件...]');
      processedContent = processedContent.replace(/```[\s\S]*?"(action|path|patches|format|type)"[\s\S]*?```/g, '[正在处理文件...]');
    }

    const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let hasCodeBlock = false;

    while ((match = codeBlockRegex.exec(processedContent)) !== null) {
      hasCodeBlock = true;
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{processedContent.slice(lastIndex, match.index)}</span>);
      }
      const code = match[1];
      parts.push(
        <pre key={`code-${match.index}`} className="bg-[#1e1e1e] p-2 rounded overflow-x-auto text-xs my-1">
          <code>{code}</code>
        </pre>
      );
      lastIndex = match.index + match[0].length;
    }

    if (isStreaming && content.includes('```')) {
      const firstCodeBlockStart = content.indexOf('```');
      const beforeCode = content.slice(0, firstCodeBlockStart);
      const afterCode = content.slice(firstCodeBlockStart);

      if (beforeCode.trim()) {
        parts.unshift(<span key="before-code">{beforeCode}</span>);
      }

      const codeMatch = afterCode.match(/^```[\w]*\n?([\s\S]*?)$/);
      let codeContent = codeMatch ? codeMatch[1] : afterCode.replace(/```[\w]*$/, '');
      
      // Filter JSON blocks in streaming content
      if (hideJsonBlocks) {
        const jsonFiltered = codeContent.replace(/```json\n?([\s\S]*?)```/g, '[正在处理文件...]');
        const actionFiltered = jsonFiltered.replace(/```[\s\S]*?"(action|path|patches|format|type)"[\s\S]*?```/g, '[正在处理文件...]');
        if (actionFiltered !== codeContent) {
          codeContent = actionFiltered;
        }
      }

      parts.push(
        <pre key="streaming-code" className="bg-[#1e1e1e] p-2 rounded overflow-x-auto text-xs my-1 opacity-70">
          <code>{codeContent}</code>
        </pre>
      );
    } else if (lastIndex < processedContent.length) {
      parts.push(<span key={`text-${lastIndex}`}>{processedContent.slice(lastIndex)}</span>);
    }

    if (isStreaming && hasCodeBlock) {
      return <div className="font-mono">{parts}</div>;
    }

    return parts.length > 0 ? parts : content;
  };

  const toggleThought = (messageId: string) => {
    setExpandedThoughts(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const renderAssistantMessage = (message: typeof messages[0], isStreaming: boolean) => {
    const content = message.content;
    const thoughtMatch = content.match(/<think>([\s\S]*?)<\/think>/);

    if (!thoughtMatch) {
      return renderContent(content, isStreaming, true);
    }

    const thought = thoughtMatch[1].trim();
    const afterThought = content.slice(thoughtMatch[0].length);
    const isExpanded = expandedThoughts.has(message.id);
    const shortThought = thought.length > 100 ? thought.slice(0, 100) + '...' : thought;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleThought(message.id)}
            className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
          >
            <span className="text-[10px]">{isExpanded ? '▼' : '▶'}</span>
            <span>Thought</span>
          </button>
        </div>
        <div
          className={`text-xs text-gray-500 bg-[#252526] rounded px-2 py-1 cursor-pointer hover:bg-[#2d2d2d] transition-colors ${
            isExpanded ? '' : 'max-h-8 overflow-hidden'
          }`}
          onClick={() => toggleThought(message.id)}
        >
          {isExpanded ? thought : shortThought}
        </div>
        {afterThought.trim() && renderContent(afterThought, isStreaming, true)}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="px-4 py-3 bg-[#252526] border-b border-[#3c3c3c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">AI 助手</h2>
          {(isLoading || isStreaming) && (
            <div className="flex items-center gap-2 text-xs px-2 py-0.5 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-gray-300">
              <span className={`inline-block w-2 h-2 rounded-full ${isToolRunning ? 'bg-yellow-400 animate-ping' : 'bg-[#4cc2ff] animate-pulse'}`}></span>
              <span>{loadingLabel}</span>
            </div>
          )}
          <div className="relative group">
            <span className="text-xs text-gray-500 cursor-help">?</span>
            <div className="absolute left-0 top-full mt-1 bg-[#2d2d2d] rounded shadow-lg py-2 px-3 text-xs hidden group-hover:block z-10 min-w-[120px]">
              {commands.map(cmd => (
                <div key={cmd.name} className="text-gray-300 py-0.5">
                  <span className="text-[#007acc]">{cmd.name}</span> - {cmd.description}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedContextPaths.length > 0 && (
        <div className="px-4 py-2 bg-[#2d2d2d] border-b border-[#3c3c3c] flex items-center justify-between text-xs">
          <div className="text-gray-300">
            <span className="text-[#007acc] mr-1">@上下文</span>
            {selectedContextPaths.length} 个文件
          </div>
          <button 
            onClick={clearContext}
            className="text-gray-500 hover:text-gray-300"
          >
            清空
          </button>
        </div>
      )}

      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-sm">👋 开始和 AI 对话吧！</p>
            <p className="text-xs mt-2">输入「帮我写一个 Todo 列表页面」</p>
            <div className="mt-4 text-xs text-gray-600">
              <p>快捷命令: {commands.map(c => c.name).join(', ')}</p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[85%]">
              <div
                className={`rounded-lg px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                  message.role === 'user'
                    ? 'bg-[#007acc] text-white'
                    : message.role === 'tool'
                    ? 'bg-[#1e1e1e] text-gray-300 border border-[#3c3c3c]'
                    : message.role === 'system'
                    ? 'bg-[#2d2d2d] text-gray-400 border border-[#3c3c3c]'
                    : 'bg-[#2d2d2d] text-gray-200'
                }`}
              >
                {message.role === 'assistant' && isStreaming && message.content === ''
                  ? <span className="text-gray-400">{loadingLabel}</span>
                  : message.role === 'tool'
                  ? (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">
                        tool{message.toolName ? `: ${message.toolName}` : ''}{message.toolCallId ? ` (${message.toolCallId})` : ''}
                      </div>
                      <div className="text-xs text-gray-400">
                        {message.toolName === 'READ_FILE' ? '[读取文件内容]' :
                         message.toolName === 'WRITE_FILE' ? '[写入文件]' :
                         message.toolName === 'SEARCH_FILES' ? '[搜索文件]' :
                         message.toolName === 'LIST_DIRECTORY' ? '[列出目录]' :
                         message.toolName === 'RUN_COMMAND' ? '[执行命令]' :
                         '[工具执行结果]'}
                      </div>
                    </div>
                  )
                  : message.role === 'assistant' ? (
                    renderAssistantMessage(message, isStreaming)
                  ) : (
                    renderContent(message.content, false, message.role !== 'system')
                  )}
              </div>
              {message.role === 'assistant' && !isStreaming && message.content && (
                <div className="flex items-center gap-1 mt-1 pl-1">
                  <button
                    onClick={() => navigator.clipboard.writeText(message.content)}
                    className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#3c3c3c] rounded transition-colors"
                    title="复制"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={handleRegenerate}
                    className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#3c3c3c] rounded transition-colors"
                    title="重新生成"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
          <div className="flex justify-start">
            <div className="bg-[#2d2d2d] rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className={`animate-pulse flex gap-1 ${isToolRunning ? 'text-yellow-400' : 'text-[#007acc]'}`}>
                  <span className={`w-2 h-2 rounded-full ${isToolRunning ? 'bg-yellow-400' : 'bg-[#007acc]'}`}></span>
                  <span className={`w-2 h-2 rounded-full ${isToolRunning ? 'bg-yellow-400' : 'bg-[#007acc]'} animation-delay-200`}></span>
                  <span className={`w-2 h-2 rounded-full ${isToolRunning ? 'bg-yellow-400' : 'bg-[#007acc]'} animation-delay-400`}></span>
                </div>
                {loadingLabel}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/50 text-red-300 rounded-lg px-4 py-2 text-sm">
              ❌ {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 bg-[#252526] border-t border-[#3c3c3c]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? loadingLabel : "输入消息或命令..."}
            className="flex-1 bg-[#3c3c3c] text-white text-sm px-3 py-2 rounded border border-[#555] focus:outline-none focus:border-[#007acc]"
            disabled={isStreaming}
          />
          <button
            type={isStreaming ? "button" : "submit"}
            onClick={isStreaming ? handleStop : undefined}
            className={`group relative px-4 py-2 text-white text-sm rounded transition-colors ${
              isStreaming
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-[#007acc] hover:bg-[#005a8f] disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            disabled={!isStreaming && !input.trim()}
            title={isStreaming ? "停止生成" : "发送消息"}
          >
            {isStreaming ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex justify-center mt-2">
          <span className="text-[10px] text-gray-500">按 Enter 发送，Shift+Enter 换行</span>
        </div>
      </form>
    </div>
  );
}
