import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { FileTree } from './components/FileTree';
import { Editor, EditorRef } from './components/Editor';
import { ChatPanel } from './components/ChatPanel';
import { Preview } from './components/Preview';
import { DiffModal } from './components/DiffModal';
import { MultiDiffModal } from './components/MultiDiffModal';
import { InlineEditPromptModal } from './components/InlineEditPromptModal';
import { InlineDiffModal } from './components/InlineDiffModal';
import { Resizer } from './components/Resizer';
import { useWorkspaceStore, FilePatch, getActiveFileLanguage } from './store/workspaceStore';
import { useAI } from './hooks/useAI';
import { getMonacoSelectionRange, replaceMonacoRange } from './inlineEdit/monacoSelection';
import type { InlineEditRequest, SelectionRange } from './inlineEdit/types';

function App() {
  const { activePath, files, updateFile, createFile, clearActiveFile, applyFilePatches, selectedContextPaths } = useWorkspaceStore();
  const code = files[activePath] ?? '';
  const setCode = useCallback((value: string) => updateFile(activePath, value), [activePath, updateFile]);
  const ai = useAI();
  const editorRef = useRef<EditorRef | null>(null);

  const isHtmlFile = useMemo(() => {
    const p = activePath.toLowerCase();
    return p.endsWith('.html') || p.endsWith('.htm');
  }, [activePath]);

  const [showPreview, setShowPreview] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [originalCode, setOriginalCode] = useState('');
  const [modifiedCode, setModifiedCode] = useState('');

  const [showMultiDiff, setShowMultiDiff] = useState(false);
  const [pendingPatches, setPendingPatches] = useState<FilePatch[]>([]);

  const [showInlinePrompt, setShowInlinePrompt] = useState(false);
  const [inlinePromptSelection, setInlinePromptSelection] = useState<SelectionRange | null>(null);
  const [inlineRunning, setInlineRunning] = useState(false);
  const [inlineRequest, setInlineRequest] = useState<InlineEditRequest | null>(null);
  const [inlineReplacementText, setInlineReplacementText] = useState('');
  const [showInlineDiff, setShowInlineDiff] = useState(false);

  const RESIZER_SIZE = 8;
  const MIN_EDITOR = 240;
  const MIN_PREVIEW = 240;
  const MAX_PREVIEW = 900;
  const MIN_CHAT = 280;
  const MAX_CHAT = 480;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const [previewWidth, setPreviewWidth] = useState(400);
  const [chatWidth, setChatWidth] = useState(380);

  const handleNewFile = useCallback(() => {
    createFile('/', 'untitled.html', '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n');
  }, [createFile]);

  const handleClearEditor = useCallback(() => {
    clearActiveFile();
  }, [clearActiveFile]);

  const handleApplyDiff = useCallback((appliedCode: string) => {
    updateFile(activePath, appliedCode);
    setShowDiff(false);
  }, [activePath, updateFile]);

  const handleCancelDiff = useCallback(() => {
    setShowDiff(false);
  }, []);

  const handleCodeDetected = useCallback((detectedCode: string) => {
    if (detectedCode !== code) {
      setOriginalCode(code);
      setModifiedCode(detectedCode);
      setShowDiff(true);
    }
  }, [code]);

  const handlePatchesDetected = useCallback((patches: FilePatch[]) => {
    setPendingPatches(patches);
    setShowMultiDiff(true);
  }, []);

  const handleApplyMultiDiff = useCallback(() => {
    applyFilePatches(pendingPatches);
    setShowMultiDiff(false);
    setPendingPatches([]);
  }, [applyFilePatches, pendingPatches]);

  const handleCancelMultiDiff = useCallback(() => {
    setShowMultiDiff(false);
    setPendingPatches([]);
  }, []);

  const openInlineEdit = useCallback(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const selection = getMonacoSelectionRange(editor);
    if (!selection) {
      window.alert('请先在编辑器中选中一段要改写的内容');
      return;
    }
    const MAX_SELECTION_CHARS = 6000;
    if (selection.text.length > MAX_SELECTION_CHARS) {
      window.alert(`选区过长（${selection.text.length} 字符），请缩小选区后再试`);
      return;
    }
    setInlinePromptSelection(selection);
    setShowInlinePrompt(true);
  }, []);

  const handleSubmitInlinePrompt = useCallback(async (instruction: string) => {
    if (!inlinePromptSelection) return;
    const request: InlineEditRequest = {
      instruction,
      activePath,
      selection: inlinePromptSelection,
      contextPaths: useWorkspaceStore.getState().selectedContextPaths,
      languageHint: getActiveFileLanguage(activePath),
    };

    setShowInlinePrompt(false);
    setInlineRunning(true);
    setInlineRequest(request);
    setInlineReplacementText('');
    setShowInlineDiff(false);

    try {
      const result = await ai.requestInlineEdit(request);
      if (!result) return;
      if (useWorkspaceStore.getState().activePath !== request.activePath) {
        window.alert('活动文件已切换，已取消本次 Inline Edit');
        return;
      }
      setInlineReplacementText(result.replacementText);
      setShowInlineDiff(true);
    } finally {
      setInlineRunning(false);
    }
  }, [activePath, ai, inlinePromptSelection]);

  const handleApplyInlineDiff = useCallback(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor || !inlineRequest) return;
    if (useWorkspaceStore.getState().activePath !== inlineRequest.activePath) {
      window.alert('活动文件已切换，无法应用该选区修改');
      setShowInlineDiff(false);
      return;
    }
    const model = editor.getModel();
    if (!model) return;
    const currentText = model.getValueInRange({
      startLineNumber: inlineRequest.selection.lineFrom,
      startColumn: 1,
      endLineNumber: inlineRequest.selection.lineTo,
      endColumn: model.getLineMaxColumn(inlineRequest.selection.lineTo),
    });
    if (currentText !== inlineRequest.selection.text) {
      window.alert('选区内容已变化，无法安全应用该提案');
      return;
    }
    replaceMonacoRange(editor, inlineRequest.selection.from, inlineRequest.selection.to, inlineReplacementText);
    updateFile(inlineRequest.activePath, editor.getValue());
    setShowInlineDiff(false);
  }, [inlineReplacementText, inlineRequest, updateFile]);

  const handleCancelInlineDiff = useCallback(() => {
    setShowInlineDiff(false);
  }, []);

  const handleTogglePreview = useCallback(() => {
    setShowPreview(prev => !prev);
  }, []);

  const clamp = useCallback((v: number, min: number, max: number) => Math.max(min, Math.min(max, v)), []);

  const resizerCount = useMemo(() => (showPreview ? 2 : 1), [showPreview]);

  const maxChatBySpace = useMemo(() => {
    if (!containerWidth) return MAX_CHAT;
    const reserved = MIN_EDITOR + resizerCount * RESIZER_SIZE + (showPreview ? MIN_PREVIEW : 0);
    return Math.min(MAX_CHAT, Math.max(MIN_CHAT, containerWidth - reserved));
  }, [MAX_CHAT, MIN_CHAT, MIN_EDITOR, MIN_PREVIEW, RESIZER_SIZE, containerWidth, resizerCount, showPreview]);

  const maxPreviewBySpace = useMemo(() => {
    if (!containerWidth) return MAX_PREVIEW;
    const reserved = MIN_EDITOR + chatWidth + resizerCount * RESIZER_SIZE;
    return Math.min(MAX_PREVIEW, Math.max(MIN_PREVIEW, containerWidth - reserved));
  }, [MAX_PREVIEW, MIN_PREVIEW, MIN_EDITOR, RESIZER_SIZE, chatWidth, containerWidth, resizerCount]);

  const rafRef = useRef<number | null>(null);
  const pendingPreviewDeltaRef = useRef(0);
  const pendingChatDeltaRef = useRef(0);

  const flushResizeRaf = useCallback(() => {
    rafRef.current = null;
    const previewDelta = pendingPreviewDeltaRef.current;
    const chatDelta = pendingChatDeltaRef.current;
    pendingPreviewDeltaRef.current = 0;
    pendingChatDeltaRef.current = 0;

    if (showPreview && previewDelta) {
      setPreviewWidth(prev => clamp(prev - previewDelta, MIN_PREVIEW, maxPreviewBySpace));
    }
    if (chatDelta) {
      setChatWidth(prev => clamp(prev - chatDelta, MIN_CHAT, maxChatBySpace));
    }
  }, [MIN_CHAT, MIN_PREVIEW, clamp, maxChatBySpace, maxPreviewBySpace, showPreview]);

  const scheduleResizeRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(flushResizeRaf);
  }, [flushResizeRaf]);

  const handleEditorPreviewResize = useCallback((delta: number) => {
    if (!showPreview) {
      pendingChatDeltaRef.current += delta;
      scheduleResizeRaf();
      return;
    }
    pendingPreviewDeltaRef.current += delta;
    scheduleResizeRaf();
  }, [scheduleResizeRaf, showPreview]);

  const handlePreviewChatResize = useCallback((delta: number) => {
    pendingChatDeltaRef.current += delta;
    scheduleResizeRaf();
  }, [scheduleResizeRaf]);

  useEffect(() => {
    const handleNewFileEvent = () => handleNewFile();
    const handleTogglePreviewEvent = () => handleTogglePreview();

    window.addEventListener('ai-ide:new-file', handleNewFileEvent);
    window.addEventListener('ai-ide:toggle-preview', handleTogglePreviewEvent);

    return () => {
      window.removeEventListener('ai-ide:new-file', handleNewFileEvent);
      window.removeEventListener('ai-ide:toggle-preview', handleTogglePreviewEvent);
    };
  }, [handleNewFile, handleTogglePreview]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'i') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (target as any)?.isContentEditable) return;
      if (showDiff || showMultiDiff || showInlinePrompt || showInlineDiff) return;
      e.preventDefault();
      openInlineEdit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openInlineEdit, showDiff, showInlineDiff, showInlinePrompt, showMultiDiff]);

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      setContainerWidth(el.clientWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    setChatWidth(prev => clamp(prev, MIN_CHAT, maxChatBySpace));
  }, [MIN_CHAT, clamp, maxChatBySpace]);

  useEffect(() => {
    if (!showPreview) return;
    setPreviewWidth(prev => clamp(prev, MIN_PREVIEW, maxPreviewBySpace));
  }, [MIN_PREVIEW, clamp, maxPreviewBySpace, showPreview]);

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      <Toolbar
        onNewFile={handleNewFile}
        onClearEditor={handleClearEditor}
        onTogglePreview={handleTogglePreview}
        onInlineEdit={openInlineEdit}
        showPreview={showPreview}
      />

      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div className="h-full overflow-hidden flex-1 min-w-[240px] flex">
          <div style={{ width: 240 }} className="h-full overflow-hidden flex-shrink-0 border-r border-[#3c3c3c]">
            <FileTree />
          </div>
          <div className="h-full overflow-hidden flex-1 min-w-[240px]">
            <Editor
              ref={editorRef}
              value={code}
              onChange={setCode}
              activePath={activePath}
              languageHint={getActiveFileLanguage(activePath)}
              contextPaths={selectedContextPaths}
              requestCompletions={ai.requestCompletions}
            />
          </div>
        </div>

        <Resizer direction="horizontal" onResize={handleEditorPreviewResize} />

        {showPreview && (
          <>
            <div style={{ width: previewWidth, willChange: 'width' }} className="h-full overflow-hidden flex-shrink-0 min-w-[240px]">
              {isHtmlFile ? (
                <Preview code={code} />
              ) : (
                <div className="flex flex-col h-full bg-[#1e1e1e]">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
                    <span className="text-sm text-gray-400">预览</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                    当前文件不支持预览
                  </div>
                </div>
              )}
            </div>
            <Resizer direction="horizontal" onResize={handlePreviewChatResize} />
          </>
        )}

        <div style={{ width: chatWidth, willChange: 'width' }} className="h-full overflow-hidden flex-shrink-0 min-w-[280px] max-w-[480px]">
          <ChatPanel ai={ai} currentCode={code} onCodeDetected={handleCodeDetected} onPatchesDetected={handlePatchesDetected} />
        </div>
      </div>

      {showDiff && (
        <DiffModal
          originalCode={originalCode}
          modifiedCode={modifiedCode}
          onApply={handleApplyDiff}
          onCancel={handleCancelDiff}
        />
      )}

      {showMultiDiff && (
        <MultiDiffModal
          patches={pendingPatches}
          onApply={handleApplyMultiDiff}
          onCancel={handleCancelMultiDiff}
        />
      )}

      {showInlinePrompt && inlinePromptSelection && (
        <InlineEditPromptModal
          title="Inline Edit"
          selectionSummary={`${activePath} · L${inlinePromptSelection.lineFrom}-L${inlinePromptSelection.lineTo} · ${inlinePromptSelection.text.length} 字符`}
          isSubmitting={inlineRunning}
          onClose={() => setShowInlinePrompt(false)}
          onSubmit={handleSubmitInlinePrompt}
        />
      )}

      {showInlineDiff && inlineRequest && (
        <InlineDiffModal
          title="变更提案：选区改写"
          originalText={inlineRequest.selection.text}
          modifiedText={inlineReplacementText}
          subtitle={`${inlineRequest.activePath} · L${inlineRequest.selection.lineFrom}-L${inlineRequest.selection.lineTo}`}
          onApply={handleApplyInlineDiff}
          onCancel={handleCancelInlineDiff}
        />
      )}
    </div>
  );
}

export default App;
