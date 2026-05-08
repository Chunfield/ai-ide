mod cli;
mod features;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command as ProcessCommand;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use walkdir::WalkDir;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[tauri::command]
fn read_workspace_file(workspace_path: String, relative_path: String) -> Result<String, String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    fs::read_to_string(&full_path)
        .map_err(|e| format!("读取文件失败 {}: {}", relative_path, e))
}

#[tauri::command]
fn write_workspace_file(workspace_path: String, relative_path: String, content: String) -> Result<(), String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&full_path, content)
        .map_err(|e| format!("写入文件失败 {}: {}", relative_path, e))
}

#[tauri::command]
fn list_workspace_files(
    workspace_path: String,
    prefix: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() {
        return Err("工作区不存在".to_string());
    }

    let mut entries = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(path);
        let relative_str = relative.to_string_lossy().replace('\\', "/");

        if let Some(ref pf) = prefix {
            if !relative_str.starts_with(pf) && !relative_str.starts_with(&pf[1..]) {
                continue;
            }
        }

        if relative_str.starts_with('.') || relative_str.contains("/.") {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        entries.push(FileEntry {
            path: format!("/{}", relative_str),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

#[derive(Serialize)]
pub struct WorkspaceLoadResult {
    pub tree: FileTreeNode,
    pub files: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FileTreeNode>,
}

#[tauri::command]
fn load_folder_as_workspace(folder_path: String) -> Result<WorkspaceLoadResult, String> {
    let root = Path::new(&folder_path);
    if !root.exists() {
        return Err("文件夹不存在".to_string());
    }
    if !root.is_dir() {
        return Err("路径不是文件夹".to_string());
    }

    fn build_tree(dir: &Path, base: &Path) -> Result<FileTreeNode, String> {
        let relative = dir.strip_prefix(base).unwrap_or(dir);
        let name = relative.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| dir.to_string_lossy().to_string());

        let path = format!("/{}", relative.to_string_lossy().replace('\\', "/").replace('"', "/"));

        let mut children: Vec<FileTreeNode> = Vec::new();

        let entries = std::fs::read_dir(dir)
            .map_err(|e| format!("读取目录失败: {}", e))?;

        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

        for entry in entries {
            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            if file_name.starts_with('.') {
                continue;
            }

            if entry_path.is_dir() {
                children.push(build_tree(&entry_path, base)?);
            } else {
                children.push(FileTreeNode {
                    name: file_name,
                    path: format!("{}/{}", path.trim_end_matches('/'), entry.file_name().to_string_lossy()),
                    children: vec![],
                });
            }
        }

        children.sort_by(|a, b| {
            if a.children.is_empty() != b.children.is_empty() {
                return if a.children.is_empty() { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
            }
            a.name.cmp(&b.name)
        });

        Ok(FileTreeNode {
            name,
            path: if path == "/" { "/".to_string() } else { path },
            children,
        })
    }

    let root_name = root.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    let mut tree = FileTreeNode {
        name: root_name,
        path: "/".to_string(),
        children: vec![],
    };

    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut files: Vec<(String, String)> = Vec::new();

    for entry in entries {
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.starts_with('.') {
            continue;
        }

        if entry_path.is_dir() {
            tree.children.push(build_tree(&entry_path, root)?);
        } else {
            let relative = entry_path.strip_prefix(root).unwrap_or(&entry_path);
            let file_path = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
            let content = fs::read_to_string(&entry_path).ok();
            if let Some(c) = content {
                files.push((file_path.clone(), c));
            }
            tree.children.push(FileTreeNode {
                name: file_name,
                path: file_path,
                children: vec![],
            });
        }
    }

    tree.children.sort_by(|a, b| {
        if a.children.is_empty() != b.children.is_empty() {
            return if a.children.is_empty() { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
        }
        a.name.cmp(&b.name)
    });

    Ok(WorkspaceLoadResult { tree, files })
}

#[tauri::command]
fn search_in_workspace(
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

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let relative_str = path.strip_prefix(root).unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if relative_str.starts_with('.') || relative_str.contains("/.") {
            continue;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_num, line) in content.lines().enumerate() {
            if line.contains(&query) {
                hits.push(SearchHit {
                    path: relative_str.clone(),
                    line: line_num + 1,
                    preview: line.chars().take(240).collect(),
                });
                if hits.len() >= max {
                    return Ok(hits);
                }
            }
        }
    }

    Ok(hits)
}

#[tauri::command]
fn run_command(cmd: String, args: Vec<String>, cwd: Option<String>) -> Result<CommandResult, String> {
    let mut command = ProcessCommand::new(&cmd);
    command.args(&args);

    if let Some(cwd_path) = cwd {
        command.current_dir(cwd_path);
    }

    match command.output() {
        Ok(output) => {
            Ok(CommandResult {
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code(),
            })
        }
        Err(e) => Err(format!("执行命令失败: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("AI IDE - Godot Assistant")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_workspace_file,
            write_workspace_file,
            list_workspace_files,
            load_folder_as_workspace,
            search_in_workspace,
            run_command,
            features::detect_godot_project,
            features::get_godot_version,
            features::run_godot,
            features::git_status,
            features::git_log,
            features::add_workspace,
            features::get_recent_workspaces,
            features::get_workspace_list,
            features::remove_workspace,
            features::detect_workspace_type,
            features::detect_language_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}