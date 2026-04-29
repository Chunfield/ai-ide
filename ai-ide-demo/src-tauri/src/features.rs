use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GodotProject {
    pub name: String,
    pub version: String,
    pub path: String,
    pub has_lsp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GodotEngine {
    pub version: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
}

fn detect_godot_project_internal(path: &str) -> Result<GodotProject, String> {
    let project_path = std::path::Path::new(path);
    let project_file = project_path.join("project.godot");

    if !project_file.exists() {
        return Err("不是有效的 Godot 项目（缺少 project.godot）".to_string());
    }

    let content = std::fs::read_to_string(&project_file)
        .map_err(|e| format!("读取 project.godot 失败: {}", e))?;

    let name = content
        .lines()
        .find(|l| l.trim().starts_with("config/name="))
        .map(|l| l.split('=').nth(1).unwrap_or("Unknown").trim_matches('"').to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let has_lsp = project_path.join(".godot/lsp").exists();

    Ok(GodotProject {
        name,
        version: "4.x".to_string(),
        path: path.to_string(),
        has_lsp,
    })
}

#[tauri::command]
pub fn detect_godot_project(path: String) -> Result<GodotProject, String> {
    detect_godot_project_internal(&path)
}

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

#[tauri::command]
pub fn run_godot(project_path: String, godot_path: Option<String>) -> Result<u32, String> {
    let cmd = godot_path.unwrap_or_else(|| "godot".to_string());

    let child = Command::new(&cmd)
        .arg("--path")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("启动 Godot 失败: {}", e))?;

    Ok(child.id())
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let repo = std::path::Path::new(&repo_path);

    if !repo.join(".git").exists() {
        return Err("不是 Git 仓库".to_string());
    }

    let branch = run_git_command(repo, &["branch", "--show-current"])?
        .trim()
        .to_string();

    let staged_output = run_git_command(repo, &["diff", "--cached", "--name-only"])?;
    let staged: Vec<String> = staged_output.lines().map(|s| s.to_string()).collect();

    let modified_output = run_git_command(repo, &["diff", "--name-only"])?;
    let modified: Vec<String> = modified_output.lines().map(|s| s.to_string()).collect();

    let untracked_output = run_git_command(repo, &["ls-files", "--others", "--exclude-standard"])?;
    let untracked: Vec<String> = untracked_output.lines().map(|s| s.to_string()).collect();

    Ok(GitStatus {
        branch,
        staged,
        modified,
        untracked,
    })
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let repo = std::path::Path::new(&repo_path);
    let limit = limit.unwrap_or(20);

    let output = run_git_command(
        repo,
        &["log", "--format=%H|%s|%an|%ct", &format!("-{}", limit)],
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

fn get_workspace_list_internal() -> Result<WorkspaceList, String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法获取配置目录")?
        .join("ai-ide");

    let list_file = config_dir.join("workspaces.toml");

    if !list_file.exists() {
        return Ok(WorkspaceList::default());
    }

    let content = std::fs::read_to_string(&list_file)
        .map_err(|e| format!("读取工作区列表失败: {}", e))?;

    toml::from_str(&content)
        .map_err(|e| format!("解析工作区列表失败: {}", e))
}

fn save_workspace_list_internal(list: &WorkspaceList) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法获取配置目录")?
        .join("ai-ide");

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    let list_file = config_dir.join("workspaces.toml");
    let content = toml::to_string_pretty(list)
        .map_err(|e| format!("序列化工作区列表失败: {}", e))?;

    std::fs::write(&list_file, content)
        .map_err(|e| format!("保存工作区列表失败: {}", e))
}

#[tauri::command]
pub fn add_workspace(name: String, path: String) -> Result<(), String> {
    let mut list = get_workspace_list_internal()?;

    let workspace = Workspace {
        name,
        path,
        last_opened: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };

    list.workspaces.retain(|w| w.name != workspace.name);
    list.workspaces.push(workspace);

    save_workspace_list_internal(&list)
}

#[tauri::command]
pub fn get_recent_workspaces() -> Result<Vec<Workspace>, String> {
    let list = get_workspace_list_internal()?;
    let mut workspaces = list.workspaces;
    workspaces.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(workspaces.into_iter().take(5).collect())
}

#[tauri::command]
pub fn get_workspace_list() -> Result<WorkspaceList, String> {
    get_workspace_list_internal()
}

#[tauri::command]
pub fn remove_workspace(name: String) -> Result<(), String> {
    let mut list = get_workspace_list_internal()?;
    list.workspaces.retain(|w| w.name != name);
    save_workspace_list_internal(&list)
}

#[tauri::command]
pub fn detect_workspace_type(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);

    if p.join("project.godot").exists() {
        return Ok("godot".to_string());
    }

    if p.join(".git").exists() {
        return Ok("git".to_string());
    }

    if p.join("Cargo.toml").exists() {
        return Ok("rust".to_string());
    }

    if p.join("package.json").exists() {
        return Ok("node".to_string());
    }

    if p.join("pyproject.toml").exists() || p.join("setup.py").exists() {
        return Ok("python".to_string());
    }

    Ok("unknown".to_string())
}

#[tauri::command]
pub fn detect_language_server(project_path: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&project_path);

    if path.join("project.godot").exists() {
        return Ok(Some("godot".to_string()));
    }

    if path.join("Cargo.toml").exists() {
        return Ok(Some("rust".to_string()));
    }

    if path.join("package.json").exists() {
        return Ok(Some("typescript".to_string()));
    }

    if path.join("pyproject.toml").exists() || path.join("setup.py").exists() || path.join("requirements.txt").exists() {
        return Ok(Some("python".to_string()));
    }

    Ok(None)
}