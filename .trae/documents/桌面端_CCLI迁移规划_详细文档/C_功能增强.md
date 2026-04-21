# 阶段 C：功能增强

**目标：** 在完成桌面端和 CLI 基础功能后，提供可选的高级功能扩展。

**前置条件：** 阶段 A + B 完成

---

## C.1 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| C-1 | 内置 LSP 支持 | 子进程调用 godot-lsp / typescript-language-server | P1 |
| C-2 | 多工作区管理 | Rust 侧管理工作区列表 | P1 |
| C-3 | 云端配置同步 | 读写 ~/.ai-ide/ 配置 | P2 |
| C-4 | Git 集成 | git 命令封装 | P2 |
| C-5 | Godot 专项适配 | GDScript 高亮 + 引擎控制 | P2 |

---

## C-2 LSP 支持

### C-2.1 架构设计

```
┌─────────────────┐     ┌──────────────────┐
│   Web 前端      │     │   Rust 后端      │
│   CodeMirror    │────▶│   LSP Bridge     │
│   (编辑器)      │     │                  │
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     LSP Server          │
                    │  · godot-lsp           │
                    │  · typescript-language-server │
                    │  · python-lsp-server   │
                    └─────────────────────────┘
```

### C-2.2 Rust LSP Bridge

```rust
// src-tauri/src/lsp.rs

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

/// LSP 消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPMessage {
    jsonrpc: String,
    id: Option<u64>,
    method: Option<String>,
    params: Option<serde_json::Value>,
}

/// LSP 服务管理器
pub struct LSPManager {
    servers: HashMap<String, Child>,
}

impl LSPManager {
    pub fn new() -> Self {
        Self {
            servers: HashMap::new(),
        }
    }

    /// 启动 LSP 服务器
    pub fn start_server(&mut self, language: &str, cwd: &std::path::Path) -> Result<(), String> {
        let (cmd, args) = match language {
            "gdscript" | "godot" => ("godot-lsp", vec!["--headless"]),
            "typescript" | "javascript" => ("typescript-language-server", vec!["--stdio"]),
            "python" => ("pylsp", vec![]),
            _ => return Err(format!("不支持的语言: {}", language)),
        };

        let mut child = std::process::Command::new(cmd)
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 LSP 服务器失败: {}", e))?;

        self.servers.insert(language.to_string(), child);
        Ok(())
    }

    /// 发送 LSP 请求
    pub fn send_request(&mut self, language: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let child = self.servers.get_mut(language)
            .ok_or("LSP 服务器未启动")?;

        let stdin = child.stdin.as_mut()
            .ok_or("无法获取 stdin")?;

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        stdin.write_all(format!("{}\n", request).as_bytes())
            .map_err(|e| format!("发送请求失败: {}", e))?;
        stdin.flush()
            .map_err(|e| format!("刷新缓冲区失败: {}", e))?;

        Ok(serde_json::json!({"status": "sent"}))
    }

    /// 停止 LSP 服务器
    pub fn stop_server(&mut self, language: &str) -> Result<(), String> {
        if let Some(mut child) = self.servers.remove(language) {
            child.kill()
                .map_err(|e| format!("停止 LSP 服务器失败: {}", e))?;
        }
        Ok(())
    }
}
```

---

## C-3 多工作区管理

```rust
// src-tauri/src/workspace.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
}

/// 获取工作区列表
pub fn get_workspace_list() -> Result<WorkspaceList, String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法获取配置目录")?
        .join("ai-ide");

    let list_file = config_dir.join("workspaces.toml");

    if !list_file.exists() {
        return Ok(WorkspaceList::default());
    }

    let content = fs::read_to_string(&list_file)
        .map_err(|e| format!("读取工作区列表失败: {}", e))?;

    toml::from_str(&content)
        .map_err(|e| format!("解析工作区列表失败: {}", e))
}

/// 保存工作区列表
pub fn save_workspace_list(list: &WorkspaceList) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法获取配置目录")?
        .join("ai-ide");

    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    let list_file = config_dir.join("workspaces.toml");
    let content = toml::to_string_pretty(list)
        .map_err(|e| format!("序列化工作区列表失败: {}", e))?;

    fs::write(&list_file, content)
        .map_err(|e| format!("保存工作区列表失败: {}", e))
}

/// 添加工作区
#[tauri::command]
pub fn add_workspace(name: String, path: String) -> Result<(), String> {
    let mut list = get_workspace_list()?;

    let workspace = Workspace {
        name,
        path,
        last_opened: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };

    // 移除已存在的同名工作区
    list.workspaces.retain(|w| w.name != workspace.name);
    list.workspaces.push(workspace);

    save_workspace_list(&list)
}

/// 获取最近工作区
#[tauri::command]
pub fn get_recent_workspaces() -> Result<Vec<Workspace>, String> {
    let list = get_workspace_list()?;
    let mut workspaces = list.workspaces;
    workspaces.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(workspaces.into_iter().take(5).collect())
}
```

---

## C-4 Git 集成

```rust
// src-tauri/src/git.rs

use std::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: u64,
}

/// 获取 Git 状态
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let repo = std::path::Path::new(&repo_path);

    // 获取当前分支
    let branch = run_git_command(repo, &["branch", "--show-current"])?
        .trim()
        .to_string();

    // 获取 staged 文件
    let staged_output = run_git_command(repo, &["diff", "--cached", "--name-only"])?;
    let staged: Vec<String> = staged_output.lines().map(|s| s.to_string()).collect();

    // 获取 modified 文件
    let modified_output = run_git_command(repo, &["diff", "--name-only"])?;
    let modified: Vec<String> = modified_output.lines().map(|s| s.to_string()).collect();

    // 获取 untracked 文件
    let untracked_output = run_git_command(repo, &["ls-files", "--others", "--exclude-standard"])?;
    let untracked: Vec<String> = untracked_output.lines().map(|s| s.to_string()).collect();

    Ok(GitStatus {
        branch,
        staged,
        modified,
        untracked,
    })
}

/// 获取提交历史
#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let repo = std::path::Path::new(&repo_path);
    let limit = limit.unwrap_or(20);

    let output = run_git_command(
        repo,
        &["log", &format!("--format=%H|%s|%an|{}", "%ct"), &format!("-{}", limit)],
    )?;

    let commits: Vec<GitCommit> = output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() >= 4 {
                Some(GitCommit {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].parse().unwrap_or(0),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

/// 执行 Git 命令
fn run_git_command(repo: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("执行 git 命令失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git 命令执行失败: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
```

---

## C-5 Godot 专项适配

```rust
// src-tauri/src/godot.rs

use std::process::Command;

/// Godot 项目信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct GodotProject {
    pub name: String,
    pub version: String,
    pub path: String,
}

/// Godot 引擎信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct GodotEngine {
    pub version: String,
    pub path: String,
}

/// 检测 Godot 项目
#[tauri::command]
pub fn detect_godot_project(path: String) -> Result<GodotProject, String> {
    let project_path = std::path::Path::new(&path);
    let project_file = project_path.join("project.godot");

    if !project_file.exists() {
        return Err("不是有效的 Godot 项目（缺少 project.godot）".to_string());
    }

    let content = std::fs::read_to_string(&project_file)
        .map_err(|e| format!("读取 project.godot 失败: {}", e))?;

    // 解析项目名称
    let name = content
        .lines()
        .find(|l| l.trim().starts_with("config/name="))
        .map(|l| l.split('=').nth(1).unwrap_or("Unknown").trim_matches('"').to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(GodotProject {
        name,
        version: "4.x".to_string(), // 简化版
        path,
    })
}

/// 获取 Godot 引擎版本
#[tauri::command]
pub fn get_godot_version(godot_path: Option<String>) -> Result<GodotEngine, String> {
    let cmd = godot_path.unwrap_or_else(|| "godot".to_string());

    let output = Command::new(&cmd)
        .arg("--version")
        .output()
        .map_err(|e| format!("执行 godot --version 失败: {}", e))?;

    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();

    Ok(GodotEngine {
        version,
        path: cmd,
    })
}

/// 运行 Godot 项目
#[tauri::command]
pub fn run_godot(project_path: String, godot_path: Option<String>) -> Result<u32, String> {
    let cmd = godot_path.unwrap_or_else(|| "godot".to_string());

    let mut child = Command::new(&cmd)
        .arg("--path")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("启动 Godot 失败: {}", e))?;

    Ok(child.id())
}
```

---

## C-3 验收标准

- [ ] LSP 服务器能正常启动并提供补全
- [ ] 多工作区切换正常
- [ ] Git 状态显示正确
- [ ] Godot 项目能正常检测和运行

---

## 下一阶段

[阶段 D：打包与分发](./D_打包分发.md)
