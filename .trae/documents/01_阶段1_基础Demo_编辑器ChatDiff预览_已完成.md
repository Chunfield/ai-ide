# 阶段 1（已完成）：基础 Demo（编辑器 + Chat + Diff 应用 + 预览）

## 1. 目标
- 搭建最小可用的 AI IDE Demo：中间可编辑代码，右侧可与 AI 对话，AI 输出代码后可 Review 并应用到编辑器，同时具备 HTML 实时预览。

## 2. 范围（In/Out）
**In**
- CodeMirror 编辑器（基础编辑能力、语法高亮、行号）
- AI Chat（流式输出、停止/重试）
- 从 AI 输出中提取代码 → Diff 预览 → 用户确认后应用
- HTML `iframe srcDoc` 预览 + 视口切换

**Out**
- 文件树/多文件工作区
- Inline Edit（选区局部改写）
- AI 补全（LLM 驱动）
- Godot 相关（GDScript、项目识别、运行联动）

## 3. 主要交互流程
1. 用户在编辑器编辑（默认 HTML）。
2. 用户在 Chat 输入需求（如“帮我写一个 Todo 列表页面”）。
3. AI 流式输出答案。
4. 系统检测答案中是否包含可用代码块：
   - 若检测到代码且与当前代码不同 → 弹出 DiffModal
5. 用户点击“应用修改”后，编辑器内容被更新；预览自动刷新。

## 4. 关键实现（代码入口）
- 主布局（Editor / Preview / Chat 三栏）：[App.tsx](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/App.tsx)
- 编辑器（CodeMirror）：[Editor.tsx](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/components/Editor.tsx)
- Chat UI + 命令（/new /clear /preview）：[ChatPanel.tsx](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/components/ChatPanel.tsx)
- AI 调用（DeepSeek stream）+ 代码提取： [useAI.ts](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/hooks/useAI.ts)
- Diff 预览与应用： [DiffModal.tsx](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/components/DiffModal.tsx)
- 预览（iframe + viewport）：[Preview.tsx](file:///Users/goumomo/Desktop/Project/ai-ide/ai-ide-demo/src/components/Preview.tsx)

## 5. 任务拆解（已完成）
- T1：集成 CodeMirror 编辑器（语言扩展/基础能力）
- T2：实现 ChatPanel（消息列表、输入、停止/重试、简易命令）
- T3：实现 useAI（SSE 风格流式解析、消息更新）
- T4：实现 Preview（iframe srcDoc、安全 sandbox、视口切换）
- T5：实现 DiffModal（显示差异、用户确认应用）
- T6：三栏布局 + resizer 拖拽体验

## 6. 验收标准（已满足）
- A1：编辑器可编辑、语法高亮与行号正常
- A2：Chat 可正常发起请求并流式展示输出
- A3：AI 输出包含代码时可以弹出 Diff 审核并应用
- A4：应用后预览同步刷新，且支持切换视口

## 7. 验证方式（历史验证点）
- 手动：输入“帮我写一个 Todo 列表页面” → 出现 Diff → 应用 → 预览可见 Todo 页面
- 构建：`npm -C ai-ide-demo run build` 可通过

