# 阶段 5（规划）：AI 补全（Completion / Inline Suggest）

## 1. 目标
- 将 LLM 接入编辑器补全体系，实现：
  - 触发补全：输入时自动触发 + 手动触发（快捷键）
  - 候选列表：在 CodeMirror completion UI 中展示建议
  -（可选）Inline Suggest：灰色幽灵文本预览（Cursor 风格）
- 与 tools/agent 基建一致：补全请求可通过工具检索上下文，而不是把大量文件内容直接塞进 prompt。

## 2. 范围（In/Out）
**In**
- 基于 CodeMirror 6 的自定义 completion source
- 请求节流/去抖、缓存、失败回退
- 语言提示（html/js/python/others）
- 与阶段 3 的多文件上下文兼容：可选择让补全“偏向”某些文件（以路径列表形式提供），具体内容由工具按需读取/检索

**Out**
- 训练/微调模型
- 复杂的语义索引（RAG）与工程级依赖图（可后续）

## 3. 交互流程（MVP）
1. 用户在编辑器输入，满足触发条件（例如连续输入 2 个字符、或按 `Cmd/Ctrl + Space`）。
2. 系统收集补全文本片段：
   - 光标前 N 字符（prefix）
   - 光标后少量字符（suffix，可选）
   - 当前文件路径/语言（activePath）
   -（可选）上下文文件路径列表（contextPaths）
3. 请求补全编排器：
   - 先通过工具进行轻量检索（例如 `search_in_files` 找到相关符号/样式/组件用法）
   - 仅在必要时对少量文件调用 `read_file` 获取片段
4. 请求 LLM 生成候选（返回 3~8 条短建议）。
5. 在 completion 列表展示；用户选择后插入。

## 4. 数据结构（建议）
### 4.1 Completion 请求/响应
- `AICompletionRequest`：
  - `activePath: string`
  - `language: string`
  - `prefix: string`
  - `suffix?: string`
  - `contextPaths?: string[]`
  - `maxCandidates: number`
- `AICompletionItem`：
  - `label: string`
  - `insertText: string`
  - `detail?: string`

### 4.2 缓存键
- `cacheKey = hash(language + prefix + suffix + contextHash)`
- TTL：例如 30~120 秒

## 5. 提示词（建议）
强调输出约束：
- 只输出候选项 JSON（或以分隔符输出），不要解释
- 候选要短（适合补全），避免输出完整文件
- 尽量匹配当前语言/风格（缩进、引号、分号）
- 不要凭空假设项目中存在某个函数/样式；需要时先通过 tools 检索或读取片段

## 6. 任务拆分（Implementation Tasks）
### T1：补全触发与 CodeMirror 集成
- 在 Editor 里注册自定义 completion source
- 支持：
  - 自动触发（输入触发）
  - 手动触发（快捷键）

### T2：补全编排器（tools + LLM）
- 增加 `completionOrchestrator`：
  - 先做工具检索（`search_in_files`）
  - 将检索命中与当前 cursor 上下文组装成短 prompt
  - 再请求 LLM 输出候选 JSON
- 并发控制：同一编辑会话只保留最后一次请求

### T3：候选展示与插入
- 将 LLM 返回映射为 CodeMirror completion items
- 插入时处理：
  - 自动补全括号/引号冲突
  - 与现有文本重复时做去重（简单策略：去掉已存在前缀）

### T4：性能与安全
- 限制请求频率（例如每秒最多 2 次）
- 限制 prefix 长度（例如 2k~4k chars）
- 不发送 API Key、避免把敏感内容写入日志
- 工具检索与读取必须有预算（例如每次补全最多 search 1 次 + read 1~2 个文件）

### T5（可选）：Inline Suggest
- 实现“幽灵文本”展示层
- 支持 Tab 接受 / Esc 取消

## 7. 验收标准（Acceptance Criteria）
- A1：在 HTML/JS/Python 文件输入时，能触发 AI 候选并在列表中展示
- A2：选择候选后插入正确，不破坏编辑器基本体验（撤销/重做正常）
- A3：频繁输入不会卡顿；请求数有上限；断网/失败时无崩溃
- A4：与阶段 3 上下文兼容（选择上下文后候选会更贴近项目风格）
- A5：补全不会注入大段项目文件到 prompt；上下文来自可控的 tools 检索/读取

## 8. 验证方式（Verification）
- 手动：
  - 输入 `function ` / `<div class="` 等常见场景触发补全
  - 断网/无 key/接口报错情况下不崩溃
- 构建：
  - `npm -C ai-ide-demo run build` 通过
