# 阶段 4（规划）：Inline Edit（选区改写 + 局部应用）

## 1. 目标
- 在编辑器内实现 Cursor/Trae 类似的“选中一段代码 → AI 改写 → 预览差异 → 局部应用”的核心体验。
- 与阶段 3 的 tools/agent 能力兼容：Inline Edit 允许 AI 通过工具读取项目上下文，但最终写入必须走“变更提案 → 审核 → 应用”的受控链路。

## 2. 范围（In/Out）
**In**
- 选区获取：支持单选区（MVP），后续可扩展多选区
- 触发方式：Toolbar 按钮 + 快捷键 +（可选）右键菜单
- AI 改写协议（优先 tools）：AI 通过工具提交“选区变更提案”或“文件变更提案”
- 预览与应用：显示选区级别 diff，用户确认后只替换选区，不影响文件其他部分

**Out**
- 复杂重构（跨文件自动修改）作为阶段 3 的 multi-file patch 能力处理
- 语义重排/格式化器集成（可后续）

## 3. 交互流程（MVP）
1. 用户在编辑器选中一段文本（如一个函数/一段 HTML）。
2. 点击 Toolbar「Inline Edit」或按快捷键（建议 `Cmd/Ctrl + I`）。
3. 弹出输入框（或复用 Chat）填写改写指令（例如“把这段代码改成 TypeScript 风格，并加错误处理”）。
4. 系统构造 Inline Edit 请求，包含：活动文件路径、选区文本、选区位置、用户指令，以及（可选）上下文文件路径列表。
5. AI 通过 tools 读取必要文件（`read_file/search_in_files`），并返回以下两种之一：
   - 方案 A（推荐）：调用 `propose_selection_edit` 工具提交选区替换提案
   - 方案 B（回退）：调用 `propose_file_patches` 对活动文件提交一次 `upsert`（完整文件内容），但 UI 仍以选区 diff 形式展示，仅应用选区部分
6. 弹出 InlineDiffModal 展示 Before/After（仅选区），支持：
   - 应用（替换选区）
   - 取消
7. 应用后：编辑器光标与选区位置更新；若当前文件可预览则同步刷新。

## 4. 数据结构（建议）
### 4.1 选区模型
- `SelectionRange`：
  - `from: number`（doc offset）
  - `to: number`
  - `text: string`
  - `lineFrom: number`（可选：用于展示）
  - `lineTo: number`

### 4.2 Inline Edit 请求/响应
- `InlineEditRequest`：
  - `instruction: string`
  - `activePath: string`
  - `selection: SelectionRange`
  - `contextPaths?: string[]`（来自阶段 3 的上下文选择；内容由 AI 自行通过 tools 读取）
  - `languageHint?: string`
- `InlineEditResult`：
  - `replacementText: string`

### 4.3 UI 状态
- `inlineEdit`：
  - `status: 'idle' | 'running' | 'review'`
  - `request?: InlineEditRequest`
  - `result?: InlineEditResult`
  - `error?: string`

## 5. 提示词（建议）
系统提示词强调：
- 只修改用户选中的内容，不要改动选区之外文本
- 优先通过 tools 读取必要上下文；不要凭空引用未读取的文件内容
- 必须通过工具提交变更提案；不要直接在正文里输出整段代码作为“自动应用”的依据

## 6. 任务拆分（Implementation Tasks）
### T1：编辑器能力暴露（获取选区/替换选区）
- 让 Editor 能把 CodeMirror `view` 暴露给 App（例如通过 `ref` 或回调）
- 提供 helper：
  - `getSelectionRange(view) -> SelectionRange | null`
  - `replaceSelection(view, replacementText)`

### T2：触发入口（Toolbar/快捷键）
- Toolbar 增加 Inline Edit 按钮
- 注册快捷键（`Cmd/Ctrl + I`），触发同一逻辑

### T3：Inline Edit 请求与 tools 接入
- 增加 `inlineEdit` 编排：
  - 输入：instruction + selection +（可选）contextPaths
  - 输出：通过 tool 提交的 `SelectionEditProposal` 或对活动文件的 `FilePatch`

### T4：InlineDiffModal
- 新增 `InlineDiffModal.tsx`
- 展示选区 Before/After，支持应用/取消
- 应用时调用 `replaceSelection`

### T5：安全与边界处理
- 无选区时提示用户先选中内容
- 选区过长做截断或提醒
- 应用后保证光标位置合理（定位到替换末尾或保持）
- 不允许工具直接落地写入；必须经由 UI 审核

## 7. 验收标准（Acceptance Criteria）
- A1：选中一段文本后能触发 Inline Edit；无选区时有明确提示
- A2：AI 返回内容可预览，并只替换选区，不影响其他内容
- A3：替换后编辑器状态正常（撤销/重做可用）
- A4：对 HTML 文件，替换后预览同步更新
- A5：AI 的写入行为可追溯：必须出现“变更提案”并经用户确认

## 8. 验证方式（Verification）
- 手动：
  - 选中一段 HTML，指令“把按钮改成渐变并加 hover” → 应用后仅该段变化
  - 撤销/重做验证
- 构建：
  - `npm -C ai-ide-demo run build` 通过
