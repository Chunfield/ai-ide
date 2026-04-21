# 阶段 A：Rust 后端扩展

**目标：** 在不修改前端代码的前提下，通过 Rust 后端扩展文件系统、子进程管理等原生能力。

**前置条件：** 现有 `ai-ide-demo` 项目结构保持不变

---

## A.1 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| A-1 | 工作区文件读取 | Rust `std::fs` + `#[tauri::command]` | P0 |
| A-2 | 工作区文件写入 | Rust `std::fs` + `#[tauri::command]` | P0 |
| A-3 | 工作区文件列表 | Rust `std::fs::read_dir` | P0 |
| A-4 | 工作区文件搜索 | Rust `std::fs` 遍历 + 匹配 | P0 |
| A-5 | 子进程管理 | `tauri-plugin-shell` 或 Rust `std::process::Command` | P1 |
| A-6 | 全局快捷键 | `tauri-plugin-global-shortcut` | P2 |
| A-7 | 系统托盘 | `tauri-plugin-tray` | P2 |

---

## A.2 Rust 命令设计

### A-1~A-4: 文件系统命令

```rust
// src-tauri/src/lib.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// 文件条目
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

/// 搜索命中
#[derive(Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

/// 读取工作区文件
#[tauri::command]
pub fn read_workspace_file(workspace_path: String, relative_path: String) -> Result<String, String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    fs::read_to_string(&full_path)
        .map_err(|e| format!("读取文件失败 {}: {}", relative_path, e))
}

/// 写入工作区文件
#[tauri::command]
pub fn write_workspace_file(workspace_path: String, relative_path: String, content: String) -> Result<(), String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&full_path, content)
        .map_err(|e| format!("写入文件失败 {}: {}", relative_path, e))
}

/// 列出工作区文件
#[tauri::command]
pub fn list_workspace_files(
    workspace_path: String,
    prefix: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() {
        return Err("工作区不存在".to_string());
    }

    let mut entries = Vec::new();
    let prefix_filter = prefix.as_ref().map(|p| {
        if !p.starts_with('/') {
            format!("/{}{}", p, if p.ends_with('/') { "" } else { "/" })
        } else {
            p.to_string()
        }
    });

    fn walk_dir(
        dir: &Path,
        prefix_filter: &Option<String>,
        entries: &mut Vec<FileEntry>,
    ) -> Result<(), String> {
        let reader = fs::read_dir(dir)
            .map_err(|e| format!("无法读取目录: {}", e))?;

        for entry in reader.flatten() {
            let path = entry.path();
            let relative = path.strip_prefix(dir.parent().unwrap_or(dir))
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if let Some(ref pf) = prefix_filter {
                if !relative.starts_with(&pf[1..]) && !relative.starts_with(pf) {
                    continue;
                }
            }

            entries.push(FileEntry {
                path: format!("/{}", relative),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()),
            });

            if metadata.is_dir() {
                walk_dir(&path, prefix_filter, entries)?;
            }
        }
        Ok(())
    }

    walk_dir(root, &prefix_filter, &mut entries)?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

/// 在工作区中搜索
#[tauri::command]
pub fn search_in_workspace(
    workspace_path: String,
    query: String,
    max_matches: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() {
        return Err("工作区不存在".to_string());
    }

    let max = max_matches.unwrap_or(50);
    let mut hits = Vec::new();

    fn search_file(path: &Path, query: &str, hits: &mut Vec<SearchHit>, max: &usize) -> Result<(), String> {
        if *hits.len() >= *max {
            return Ok(());
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };

        for (line_num, line) in content.lines().enumerate() {
            if line.contains(query) {
                hits.push(SearchHit {
                    path: path.to_string_lossy().to_string(),
                    line: line_num + 1,
                    preview: line.chars().take(240).collect(),
                });
                if hits.len() >= *max {
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    fn walk_dir(
        dir: &Path,
        query: &str,
        hits: &mut Vec<SearchHit>,
        max: usize,
    ) -> Result<(), String> {
        let reader = fs::read_dir(dir)
            .map_err(|e| format!("无法读取目录: {}", e))?;

        for entry in reader.flatten() {
            let path = entry.path();

            if path.is_dir() {
                if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
                    continue;
                }
                walk_dir(&path, query, hits, max)?;
            } else {
                search_file(&path, query, hits, &max)?;
            }

            if hits.len() >= max {
                return Ok(());
            }
        }
        Ok(())
    }

    walk_dir(root, &query, &mut hits, max)?;
    Ok(hits)
}
```

---

## A-5: 子进程管理

### 方案一：使用 tauri-plugin-shell（推荐，已集成）

```rust
// 已有 tauri-plugin-shell，可直接使用
// 前端调用方式：
import { Command } from '@tauri-apps/plugin-shell';

const command = Command.create('godot', ['--version']);
const output = await command.execute();
console.log(output.stdout);
```

### 方案二：Rust 原生进程管理

```rust
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::Arc;
use std::process::Child;

/// 进程管理状态
struct ProcessManager {
    processes: std::collections::HashMap<u32, Child>,
}

impl ProcessManager {
    fn new() -> Self {
        Self {
            processes: std::collections::HashMap::new(),
        }
    }
}

/// 运行外部命令
#[tauri::command]
pub fn run_command(
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let mut command = ProcessCommand::new(&cmd);
    command.args(&args);

    if let Some(cwd_path) = cwd {
        command.current_dir(cwd_path);
    }

    let child = command.spawn()
        .map_err(|e| format!("启动进程失败: {}", e))?;

    let pid = child.id();
    Ok(pid)
}

/// 终止进程
#[tauri::command]
pub fn kill_process(pid: u32) -> Result<(), String> {
    ProcessCommand::new("kill")
        .arg("-9")
        .arg(pid.to_string())
        .spawn()
        .map_err(|e| format!("终止进程失败: {}", e))?;
    Ok(())
}
```

---

## A-3 前端适配

### 修改 `useAI.ts` 中的 executeTool

```typescript
// src/hooks/useAI.ts

// 替换 import
// import { useWorkspaceStore } from '../store/workspaceStore';
import { invoke } from '@tauri-apps/api/tauri';

// 修改 executeTool 函数中的文件系统操作
if (toolName === 'list_files') {
  // 原有内存实现改为 Rust 调用
  const prefix = typeof args.prefix === 'string' ? args.prefix : '';
  const result = await invoke<{ paths: string[] }>('list_workspace_files', {
    workspacePath: '/path/to/workspace', // 从 workspaceStore 获取
    prefix,
  });
  return result;
}

if (toolName === 'read_file') {
  const path = typeof args.path === 'string' ? args.path : '';
  const maxChars = typeof args.maxChars === 'number' ? args.maxChars : 12000;
  const result = await invoke<{ content: string; truncated: boolean }>('read_workspace_file', {
    workspacePath: '/path/to/workspace',
    relativePath: path,
  });
  return {
    path,
    content: result.truncated ? result.content.slice(0, maxChars) : result.content,
    truncated: result.truncated,
  };
}

if (toolName === 'search_in_files') {
  const query = typeof args.query === 'string' ? args.query : '';
  const maxMatches = typeof args.maxMatches === 'number' ? args.maxMatches : 50;
  const result = await invoke<{ matches: Array<{ path: string; line: number; preview: string }> }>('search_in_workspace', {
    workspacePath: '/path/to/workspace',
    query,
    maxMatches,
  });
  return { query, matches: result.matches };
}

if (toolName === 'propose_file_patches') {
  // 写入操作
  const patches = Array.isArray(args.patches) ? args.patches : [];
  for (const patch of patches) {
    if (patch.action === 'upsert' && typeof patch.content === 'string') {
      await invoke('write_workspace_file', {
        workspacePath: '/path/to/workspace',
        relativePath: patch.path,
        content: patch.content,
      });
    }
  }
  return { queued: true, patchCount: patches.length };
}
```

---

## A-4 验收标准

- [ ] `invoke('read_workspace_file')` 能读取真实文件系统文件
- [ ] `invoke('write_workspace_file')` 能写入文件并创建目录
- [ ] `invoke('list_workspace_files')` 返回正确文件列表
- [ ] `invoke('search_in_workspace')` 能搜索文件内容
- [ ] `invoke('run_command')` 能执行外部命令
- [ ] 现有 Web UI 功能不受影响

---

## 预计改动文件

| 文件 | 改动说明 |
|------|----------|
| `src-tauri/src/lib.rs` | 新增所有 #[tauri::command] |
| `src-tauri/Cargo.toml` | 新增依赖（如需要） |
| `src/hooks/useAI.ts` | 将 executeTool 中的内存操作改为 invoke 调用 |
| `src-tauri/tauri.conf.json` | 配置 devtools: true 便于调试 |

---

## 下一阶段

[阶段 B：CLI 入口](./B_CLI入口.md)
