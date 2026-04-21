# 阶段 6（规划）：Godot 适配（GDScript + 项目结构识别 + 可选联动）

## 1. 目标
- 将 AI IDE 从通用 Web Demo 推进到“面向 Godot 工程开发”的可用形态：
  - Godot 项目结构识别（`project.godot`）
  - GDScript 语法高亮与基础编辑体验
  - 针对 `.tscn/.tres` 等资源文件的友好展示
  - AI 在提示词中理解 Godot/GDScript 语境
- 与 tools/agent 模式一致：AI 不直接“猜”项目结构与资源引用，优先通过工具读取与检索工程信息，写入走受控审核。

## 2. 范围（In/Out）
**In**
- 工作区层面：识别 `project.godot`、常见目录（scenes/scripts/assets）
- 编辑器层面：GDScript 高亮、基本 snippet（可选）
- AI 层面：针对 Godot 的 system prompt 模板 + tools 驱动的上下文策略（按需 read/search）

**Out（本阶段不强制）**
- 直接启动 Godot、运行/调试、与 Godot Editor 的 IPC/WebSocket 深度联动（可作为下一大版本）

## 3. 交互流程（MVP）
1. 工作区包含 `project.godot` 时，UI 显示“Godot 项目”标识。
2. 打开 `.gd` 文件时：
   - 自动切换到 GDScript 语法高亮
3. 打开 `.tscn` 文件时：
   - 以文本方式展示，并提供“结构折叠/大纲”（可选）
4. AI 改码：
   - 通过 tools 获取工程信息与引用关系（`read_file/search_in_files`）
   - 以 `propose_file_patches` 提交多文件变更提案，用户审核后应用
   - 对 `.gd` 文件的改动遵循 GDScript 风格与 Godot API（优先从工程内现有写法学习）

## 4. 数据结构（建议）
### 4.1 项目识别
- `ProjectMeta`：
  - `type: 'godot' | 'generic'`
  - `godotVersion?: string`
  - `mainScene?: string`
  - `projectName?: string`

### 4.2 文件类型映射
- `FileType`：
  - `gdscript | scene | resource | markdown | web | unknown`
- 用于：编辑器语言、图标、预览策略

### 4.3 AI 工具层（建议新增的 Godot 专用只读工具，按需实现）
- `parse_godot_project({ path: "/project.godot" }) -> ProjectMeta`
- `outline_scene({ path: "/scenes/Main.tscn" }) -> { nodes: Array<{ name,type,parent? }> }`
- 说明：这些工具本质上是“把文件解析成结构化信息”，避免 AI 在纯文本上瞎猜；短期可先用 `read_file` 读取再在前端解析。

## 5. 任务拆分（Implementation Tasks）
### T1：GDScript 语法高亮
- 方案 A（优先）：找到/引入现成 CodeMirror 6 GDScript language extension（若可用）
- 方案 B：自定义 stream parser / Lezer grammar（工作量更大）
- Editor 根据文件扩展名自动选择 language extension（`.gd` → gdscript）

### T2：Godot 项目元信息解析（模拟工作区先做“解析”）
- 从 `project.godot` 中解析：
  - `config/name`
  - `run/main_scene`
- 在 UI 顶部或文件树顶栏显示项目名与主场景

### T3：资源文件体验
- `.tscn/.tres`：
  - 基础语法高亮（ini-like）
  - 大文件性能优化（按需渲染/懒加载）
  - 可选：简单的大纲视图（例如按 `[node]` 分段）

### T4：AI Prompt 模板 + tools 驱动（Godot 语境）
- 当项目识别为 Godot：
  - system prompt 注入 Godot 约束（GDScript 风格、节点树、场景结构）
  - 明确要求：需要引用项目内容时先用 tools 读取/检索；写入必须用 `propose_file_patches`
  - 保留回退：当 tools 不可用时，允许输出 `ai-ide-file-patch` JSON 协议块作为兼容通道

### T5（可选）：与 Godot 的联动（下一版本入口）
- 若切换为 Tauri 本地模式：
  - 提供“打开真实工程/保存到磁盘”
  - 预留后续：调用 Godot headless 或与 Editor 通信的通道

## 6. 验收标准（Acceptance Criteria）
- A1：打开 `.gd` 文件有清晰的语法高亮，且不会明显卡顿
- A2：检测到 `project.godot` 后 UI 显示项目信息（至少项目名）
- A3：AI 能通过 tools 正确读取工程信息/引用并提出变更提案；经 Diff 审核后可应用
- A4：AI 不会在未读取文件的情况下编造节点/脚本内容；需要时会先检索/读取

## 7. 验证方式（Verification）
- 手动：
  - 在模拟工作区打开 `scripts/player.gd`，验证高亮与 AI 改写
  - 修改 `project.godot` 项目名，UI 显示随之变化（若支持动态解析）
- 构建：
  - `npm -C ai-ide-demo run build` 通过
