use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::Emitter;

const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc", "woff", "woff2"];
const INSTALLABLE_FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontIndex {
    generated_at: String,
    root: String,
    total_fonts: usize,
    fonts: Vec<FontRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontRecord {
    id: String,
    family: String,
    style_name: String,
    category: String,
    source_library: String,
    language: String,
    path: String,
    relative_path: String,
    library_root: String,
    extension: String,
    size: u64,
    size_label: String,
    font_url: Option<String>,
    font_format: String,
    weight: u16,
    added_at: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct FontNames {
    family: Option<String>,
    style: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileResult {
    status: String,
    path: Option<String>,
    filename: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportFontFile {
    source_path: String,
    family: String,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProjectPackResult {
    status: String,
    path: Option<String>,
    copied_files: usize,
    skipped_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontSystemOperationResult {
    target_dir: String,
    paths: Vec<String>,
    completed_files: usize,
    skipped_files: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFontFile {
    url: String,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFontDownloadResult {
    status: String,
    target_dir: Option<String>,
    paths: Vec<String>,
    failed_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFontDetectionResult {
    installed: bool,
    matches: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontLocationDiagnostic {
    input_path: String,
    normalized_path: String,
    exists: bool,
    is_file: bool,
    is_dir: bool,
    extension: Option<String>,
    supported_font_file: bool,
    parent: Option<String>,
    parent_exists: bool,
    target_folder: Option<String>,
}

#[tauri::command]
fn scan_font_folder(path: String) -> Result<FontIndex, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Err("Folder does not exist".to_string());
    }
    if !root.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    let mut fonts = Vec::new();
    collect_font_files(&root, &root, &mut fonts)?;
    fonts.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(FontIndex {
        generated_at: current_date_label(),
        root: root.to_string_lossy().to_string(),
        total_fonts: fonts.len(),
        fonts,
    })
}

#[tauri::command]
fn pick_font_files() -> Result<Option<FontIndex>, String> {
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("Font files", &["ttf", "otf", "ttc", "woff", "woff2"])
        .pick_files()
    else {
        return Ok(None);
    };

    let root = common_parent_dir(&paths).unwrap_or_else(|| {
        env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });
    let mut fonts = Vec::new();

    for path in paths {
        if !path.is_file() || !is_font_file(&path) {
            continue;
        }
        push_font_record(&root, &path, &mut fonts)?;
    }

    fonts.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(Some(FontIndex {
        generated_at: current_date_label(),
        root: root.to_string_lossy().to_string(),
        total_fonts: fonts.len(),
        fonts,
    }))
}

#[tauri::command]
fn pick_font_folder_path(suggested_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose font source folder");

    if let Some(path) = suggested_path
        .as_deref()
        .and_then(existing_dialog_directory)
    {
        dialog = dialog.set_directory(path);
    }

    let Some(path) = dialog.pick_folder()
    else {
        return Ok(None);
    };

    Ok(Some(path.to_string_lossy().to_string()))
}

fn existing_dialog_directory(path: &str) -> Option<PathBuf> {
    let target = PathBuf::from(path.trim());

    if target.exists() && target.is_dir() {
        return Some(target);
    }

    target
        .parent()
        .filter(|parent| parent.exists() && parent.is_dir())
        .map(Path::to_path_buf)
}

#[tauri::command]
fn open_font_location(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    validate_font_location_target(&target)?;

    reveal_in_file_manager(&target)
}

fn validate_font_location_target(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Err("Font file does not exist".to_string());
    }

    if !target.is_file() {
        if target.is_dir() {
            return Ok(());
        }

        return Err("Path is not a font file or folder".to_string());
    }

    let Some(extension) = target.extension().and_then(|value| value.to_str()) else {
        return Err("Missing font extension".to_string());
    };
    let extension = extension.to_ascii_lowercase();
    if !FONT_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Only font files can be revealed".to_string());
    }

    Ok(())
}

#[tauri::command]
fn diagnose_font_location(path: String) -> Result<FontLocationDiagnostic, String> {
    Ok(diagnose_location_path(&path))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/liangziye6/YFonts/") {
        return Err("Only the official YFonts GitHub page can be opened".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("explorer.exe")
            .arg(&url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening external links is not supported on this platform".to_string())
}

#[tauri::command]
fn detect_system_font(
    family: String,
    filenames: Vec<String>,
) -> Result<SystemFontDetectionResult, String> {
    let mut candidates = vec![family];
    candidates.extend(filenames.into_iter().filter_map(|filename| {
        Path::new(&filename)
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
    }));
    let candidates = candidates
        .into_iter()
        .map(|value| normalize_font_match_key(&value))
        .filter(|value| value.len() >= 3)
        .collect::<Vec<_>>();

    let catalog = system_font_catalog();
    let matches = catalog
        .into_iter()
        .filter(|entry| {
            let normalized_entry = normalize_font_match_key(entry);
            candidates.iter().any(|candidate| {
                normalized_entry == *candidate
                    || (candidate.len() >= 6 && normalized_entry.contains(candidate))
                    || (normalized_entry.len() >= 6 && candidate.contains(&normalized_entry))
            })
        })
        .take(12)
        .collect::<Vec<_>>();

    Ok(SystemFontDetectionResult {
        installed: !matches.is_empty(),
        matches,
    })
}

#[tauri::command]
fn install_font_files(paths: Vec<String>) -> Result<FontSystemOperationResult, String> {
    let target_dir = user_font_dir()?;
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

    let mut installed_paths = Vec::new();
    let mut skipped_files = 0;

    for input_path in paths {
        let source = PathBuf::from(input_path);
        if !is_installable_font_file(&source) {
            skipped_files += 1;
            continue;
        }

        let source = source.canonicalize().map_err(|error| error.to_string())?;
        let filename = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Invalid font filename".to_string())?;
        let source_key = source.to_string_lossy();
        let installed_filename = format!(
            "YFonts-{}-{}",
            create_id(&source_key),
            sanitize_filename(filename)
        );
        let destination = target_dir.join(installed_filename);

        if !destination.exists() {
            fs::copy(&source, &destination).map_err(|error| error.to_string())?;
        }

        if let Err(error) = register_installed_font(&destination) {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }

        installed_paths.push(destination.to_string_lossy().to_string());
    }

    refresh_user_font_cache();

    Ok(FontSystemOperationResult {
        target_dir: target_dir.to_string_lossy().to_string(),
        completed_files: installed_paths.len(),
        skipped_files,
        paths: installed_paths,
    })
}

#[tauri::command]
fn uninstall_font_files(paths: Vec<String>) -> Result<FontSystemOperationResult, String> {
    let target_dir = user_font_dir()?;
    let normalized_target = target_dir
        .canonicalize()
        .unwrap_or_else(|_| target_dir.clone());
    let mut removed_paths = Vec::new();
    let mut skipped_files = 0;

    for input_path in paths {
        let path = PathBuf::from(input_path);
        let normalized_path = path.canonicalize().unwrap_or_else(|_| path.clone());
        let is_yfonts_copy = normalized_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|filename| filename.starts_with("YFonts-"))
            .unwrap_or(false);

        if !normalized_path.starts_with(&normalized_target) || !is_yfonts_copy {
            skipped_files += 1;
            continue;
        }
        if !normalized_path.exists() {
            removed_paths.push(normalized_path.to_string_lossy().to_string());
            continue;
        }

        unregister_installed_font(&normalized_path);
        fs::remove_file(&normalized_path).map_err(|error| error.to_string())?;
        removed_paths.push(normalized_path.to_string_lossy().to_string());
    }

    refresh_user_font_cache();

    Ok(FontSystemOperationResult {
        target_dir: target_dir.to_string_lossy().to_string(),
        completed_files: removed_paths.len(),
        skipped_files,
        paths: removed_paths,
    })
}

#[tauri::command]
fn download_online_font_files(
    family: String,
    files: Vec<OnlineFontFile>,
) -> Result<OnlineFontDownloadResult, String> {
    let Some(parent_dir) = rfd::FileDialog::new()
        .set_title("Choose font download folder")
        .pick_folder()
    else {
        return Ok(OnlineFontDownloadResult {
            status: "cancelled".to_string(),
            target_dir: None,
            paths: Vec::new(),
            failed_files: 0,
        });
    };

    let target_dir = parent_dir.join(sanitize_folder_name(&family));
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("YFonts/1.18")
        .build()
        .map_err(|error| error.to_string())?;
    let mut downloaded_paths = Vec::new();
    let mut failed_files = 0;

    for file in files {
        if !is_allowed_online_font_url(&file.url) {
            failed_files += 1;
            continue;
        }

        let filename = sanitize_filename(&file.filename);
        let extension = Path::new(&filename)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if !extension
            .as_deref()
            .map(|value| FONT_EXTENSIONS.contains(&value))
            .unwrap_or(false)
        {
            failed_files += 1;
            continue;
        }

        let response = match client.get(&file.url).send().and_then(|response| response.error_for_status()) {
            Ok(response) => response,
            Err(_) => {
                failed_files += 1;
                continue;
            }
        };
        if response.content_length().unwrap_or(0) > 128 * 1024 * 1024 {
            failed_files += 1;
            continue;
        }

        let bytes = match response.bytes() {
            Ok(bytes) if bytes.len() <= 128 * 1024 * 1024 => bytes,
            _ => {
                failed_files += 1;
                continue;
            }
        };
        let destination = target_dir.join(&filename);
        if fs::write(&destination, &bytes).is_err() {
            failed_files += 1;
            continue;
        }

        downloaded_paths.push(destination.to_string_lossy().to_string());
    }

    Ok(OnlineFontDownloadResult {
        status: "picked".to_string(),
        target_dir: Some(target_dir.to_string_lossy().to_string()),
        paths: downloaded_paths,
        failed_files,
    })
}

fn is_allowed_online_font_url(value: &str) -> bool {
    value.starts_with("https://cdn.jsdelivr.net/fontsource/fonts/")
}

#[tauri::command]
fn save_text_file(suggested_name: String, content: String) -> Result<SaveTextFileResult, String> {
    let filename = sanitize_filename(&suggested_name);
    let Some(path) = rfd::FileDialog::new()
        .add_filter("YFonts JSON", &["json"])
        .set_file_name(&filename)
        .save_file()
    else {
        return Ok(SaveTextFileResult {
            status: "cancelled".to_string(),
            path: None,
            filename: None,
        });
    };

    fs::write(&path, content).map_err(|error| error.to_string())?;

    Ok(SaveTextFileResult {
        status: "picked".to_string(),
        filename: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string()),
        path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn export_project_pack_bundle(
    suggested_name: String,
    manifest_content: String,
    files: Vec<ExportFontFile>,
) -> Result<ExportProjectPackResult, String> {
    let folder_name = sanitize_folder_name(&suggested_name);
    let Some(parent_dir) = rfd::FileDialog::new()
        .set_title("Choose YFonts export folder")
        .pick_folder()
    else {
        return Ok(ExportProjectPackResult {
            status: "cancelled".to_string(),
            path: None,
            copied_files: 0,
            skipped_files: 0,
        });
    };

    let target_dir = unique_child_dir(&parent_dir, &folder_name);
    let fonts_dir = target_dir.join("fonts");
    fs::create_dir_all(&fonts_dir).map_err(|error| error.to_string())?;
    fs::write(target_dir.join("YFonts-manifest.json"), manifest_content)
        .map_err(|error| error.to_string())?;

    let mut copied_files = 0;
    let mut skipped_files = 0;

    for file in files {
        let source = PathBuf::from(&file.source_path);
        if !is_copyable_font_file(&source) {
            skipped_files += 1;
            continue;
        }

        let family_dir = fonts_dir.join(sanitize_folder_name(&file.family));
        fs::create_dir_all(&family_dir).map_err(|error| error.to_string())?;

        let source_filename = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&file.filename);
        let destination = unique_file_path(&family_dir, &sanitize_filename(source_filename));

        match fs::copy(&source, destination) {
            Ok(_) => copied_files += 1,
            Err(_) => skipped_files += 1,
        }
    }

    Ok(ExportProjectPackResult {
        status: "picked".to_string(),
        path: Some(target_dir.to_string_lossy().to_string()),
        copied_files,
        skipped_files,
    })
}

#[tauri::command]
fn read_app_data_file(file_name: String) -> Result<Option<String>, String> {
    let path = app_data_file_path(&file_name)?;
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err("App data path is not a file".to_string());
    }

    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn write_app_data_file(file_name: String, content: String) -> Result<String, String> {
    let path = app_data_file_path(&file_name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn collect_font_files(root: &Path, path: &Path, fonts: &mut Vec<FontRecord>) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();

        if entry_path.is_dir() {
            collect_font_files(root, &entry_path, fonts)?;
            continue;
        }

        if is_font_file(&entry_path) {
            push_font_record(root, &entry_path, fonts)?;
        }
    }

    Ok(())
}

fn push_font_record(root: &Path, entry_path: &Path, fonts: &mut Vec<FontRecord>) -> Result<(), String> {
    let Some(extension) = entry_path.extension().and_then(|value| value.to_str()) else {
        return Ok(());
    };
    let extension = extension.to_ascii_lowercase();

    if !FONT_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(());
    }

    let metadata = fs::metadata(entry_path).map_err(|error| error.to_string())?;
    let relative_path = entry_path
        .strip_prefix(root)
        .unwrap_or(entry_path)
        .to_string_lossy()
        .to_string();
    let parts: Vec<&str> = relative_path.split(std::path::MAIN_SEPARATOR).collect();
    let directory_parts = if parts.len() > 1 {
        &parts[..parts.len() - 1]
    } else {
        &[][..]
    };
    let base_name = entry_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let root_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Local")
        .to_string();
    let folder_name = pick_family_folder(directory_parts, &root_name);
    let category = infer_category(directory_parts);
    let font_names = read_font_names(entry_path);
    let family = font_names
        .as_ref()
        .and_then(|names| names.family.as_deref())
        .and_then(normalize_internal_font_name)
        .unwrap_or_else(|| clean_family_name(&folder_name, base_name));
    let style_name = font_names
        .as_ref()
        .and_then(|names| names.style.as_deref())
        .and_then(normalize_internal_font_name)
        .unwrap_or_else(|| infer_style_name(base_name));
    let source_library = pick_source_library(directory_parts, &root_name);

    let language = detect_font_language(entry_path).unwrap_or_else(|| {
        infer_language(&source_library, &category, &family, base_name)
    });

    fonts.push(FontRecord {
        id: format!("scan-{}", create_id(&format!("{}|{}", root.to_string_lossy(), relative_path))),
        family: family.clone(),
        style_name: style_name.clone(),
        category: category.clone(),
        source_library: source_library.clone(),
        language,
        path: entry_path.to_string_lossy().to_string(),
        library_root: root.to_string_lossy().to_string(),
        relative_path,
        extension: extension.clone(),
        size: metadata.len(),
        size_label: format_size(metadata.len()),
        font_url: None,
        font_format: font_format(&extension),
        weight: infer_weight(&format!("{base_name} {style_name}")),
        added_at: current_date_label(),
    });

    Ok(())
}

fn is_font_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| FONT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn detect_font_language(path: &Path) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "ttf" | "otf" | "ttc") {
        return None;
    }

    let cmap = read_cmap_table(path).ok()?;
    let chinese_samples = [
        '\u{7684}', '\u{4e00}', '\u{662f}', '\u{5728}', '\u{4eba}', '\u{4e2d}',
        '\u{56fd}', '\u{6587}', '\u{5b57}', '\u{4f53}', '\u{8bbe}', '\u{8ba1}',
        '\u{6c49}', '\u{4e66}', '\u{5b66}', '\u{65b0}', '\u{95e8}', '\u{53d1}',
    ];
    let supported_samples = chinese_samples
        .iter()
        .filter(|character| cmap_has_codepoint(&cmap, **character as u32))
        .count();

    Some(if supported_samples >= 3 {
        "chinese".to_string()
    } else {
        "english".to_string()
    })
}

fn read_font_names(path: &Path) -> Option<FontNames> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "ttf" | "otf" | "ttc") {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    extract_font_names(&bytes)
}

fn extract_font_names(bytes: &[u8]) -> Option<FontNames> {
    let font_offset = if bytes.get(..4)? == b"ttcf" {
        let face_count = read_u32(bytes, 8)?;
        if face_count == 0 {
            return None;
        }
        read_u32(bytes, 12)? as usize
    } else {
        0
    };
    let table_count = read_u16(bytes, font_offset + 4)? as usize;

    for index in 0..table_count {
        let record_offset = font_offset + 12 + index * 16;
        if bytes.get(record_offset..record_offset + 4)? != b"name" {
            continue;
        }

        let table_offset = read_u32(bytes, record_offset + 8)? as usize;
        let table_length = read_u32(bytes, record_offset + 12)? as usize;
        let table = bytes.get(table_offset..table_offset.checked_add(table_length)?)?;
        return extract_names_from_name_table(table);
    }

    None
}

fn extract_names_from_name_table(table: &[u8]) -> Option<FontNames> {
    let record_count = read_u16(table, 2)? as usize;
    let strings_offset = read_u16(table, 4)? as usize;
    let mut family: Option<(u16, String)> = None;
    let mut style: Option<(u16, String)> = None;

    for index in 0..record_count {
        let record_offset = 6 + index * 12;
        let platform_id = read_u16(table, record_offset)?;
        let encoding_id = read_u16(table, record_offset + 2)?;
        let language_id = read_u16(table, record_offset + 4)?;
        let name_id = read_u16(table, record_offset + 6)?;
        if !matches!(name_id, 1 | 2 | 16 | 17) {
            continue;
        }

        let length = read_u16(table, record_offset + 8)? as usize;
        let offset = read_u16(table, record_offset + 10)? as usize;
        let start = strings_offset.checked_add(offset)?;
        let raw = table.get(start..start.checked_add(length)?)?;
        let Some(value) = decode_font_name(platform_id, encoding_id, raw) else {
            continue;
        };
        let score = font_name_score(platform_id, language_id, name_id);
        let target = if matches!(name_id, 1 | 16) {
            &mut family
        } else {
            &mut style
        };
        if target
            .as_ref()
            .map_or(true, |(current_score, _)| score > *current_score)
        {
            *target = Some((score, value));
        }
    }

    let names = FontNames {
        family: family.map(|(_, value)| value),
        style: style.map(|(_, value)| value),
    };
    if names.family.is_none() && names.style.is_none() {
        None
    } else {
        Some(names)
    }
}

fn decode_font_name(platform_id: u16, _encoding_id: u16, bytes: &[u8]) -> Option<String> {
    let value = if matches!(platform_id, 0 | 3) {
        if bytes.len() % 2 != 0 {
            return None;
        }
        let units = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        String::from_utf16(&units).ok()?
    } else if platform_id == 1 && bytes.iter().all(|byte| byte.is_ascii()) {
        String::from_utf8(bytes.to_vec()).ok()?
    } else {
        return None;
    };

    let cleaned = value
        .trim_matches(|character: char| character.is_whitespace() || character == '\0')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

fn font_name_score(platform_id: u16, language_id: u16, name_id: u16) -> u16 {
    let name_score = match name_id {
        16 | 17 => 100,
        1 | 2 => 50,
        _ => 0,
    };
    let platform_score = match platform_id {
        3 => 30,
        0 => 20,
        1 => 10,
        _ => 0,
    };
    let language_score = match language_id {
        0x0804 | 0x1004 | 0x0404 | 0x0c04 => 8,
        0x0409 => 6,
        _ => 0,
    };
    name_score + platform_score + language_score
}

fn normalize_internal_font_name(value: &str) -> Option<String> {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() < 2
        || is_generic_font_folder(&cleaned)
        || is_broad_category_folder(&cleaned)
    {
        return None;
    }
    Some(cleaned)
}

fn read_cmap_table(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header)
        .map_err(|error| error.to_string())?;

    let font_offset = if &header[..4] == b"ttcf" {
        let face_count = read_u32(&header, 8).ok_or_else(|| "Invalid TTC header".to_string())?;
        if face_count == 0 {
            return Err("Empty TTC collection".to_string());
        }

        let mut offset_bytes = [0u8; 4];
        file.read_exact(&mut offset_bytes)
            .map_err(|error| error.to_string())?;
        u32::from_be_bytes(offset_bytes) as u64
    } else {
        0
    };

    file.seek(SeekFrom::Start(font_offset))
        .map_err(|error| error.to_string())?;
    file.read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    let table_count =
        read_u16(&header, 4).ok_or_else(|| "Invalid font table directory".to_string())?;

    for _ in 0..table_count {
        let mut record = [0u8; 16];
        file.read_exact(&mut record)
            .map_err(|error| error.to_string())?;
        if &record[..4] != b"cmap" {
            continue;
        }

        let table_offset =
            read_u32(&record, 8).ok_or_else(|| "Invalid cmap offset".to_string())? as u64;
        let table_length =
            read_u32(&record, 12).ok_or_else(|| "Invalid cmap length".to_string())? as usize;
        if table_length == 0 || table_length > 32 * 1024 * 1024 {
            return Err("Invalid cmap table size".to_string());
        }

        let return_position = file
            .stream_position()
            .map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(table_offset))
            .map_err(|error| error.to_string())?;
        let mut cmap = vec![0u8; table_length];
        file.read_exact(&mut cmap)
            .map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(return_position))
            .map_err(|error| error.to_string())?;
        return Ok(cmap);
    }

    Err("Font has no cmap table".to_string())
}

fn cmap_has_codepoint(cmap: &[u8], codepoint: u32) -> bool {
    let Some(table_count) = read_u16(cmap, 2) else {
        return false;
    };
    let mut preferred_subtables = Vec::new();

    for index in 0..table_count as usize {
        let record_offset = 4 + index * 8;
        let Some(platform_id) = read_u16(cmap, record_offset) else {
            continue;
        };
        let Some(encoding_id) = read_u16(cmap, record_offset + 2) else {
            continue;
        };
        let Some(subtable_offset) = read_u32(cmap, record_offset + 4) else {
            continue;
        };
        let subtable_offset = subtable_offset as usize;
        let Some(format) = read_u16(cmap, subtable_offset) else {
            continue;
        };

        let priority = match (format, platform_id, encoding_id) {
            (12 | 13, 3, 10) => 0,
            (12 | 13, 0, _) => 1,
            (4, 3, 1 | 10) => 2,
            (4, 0, _) => 3,
            _ => continue,
        };
        preferred_subtables.push((priority, subtable_offset, format));
    }

    preferred_subtables.sort_by_key(|(priority, _, _)| *priority);
    preferred_subtables.into_iter().any(|(_, offset, format)| {
        match format {
            4 => cmap_format_4_has_codepoint(cmap, offset, codepoint),
            12 => cmap_format_12_has_codepoint(cmap, offset, codepoint, false),
            13 => cmap_format_12_has_codepoint(cmap, offset, codepoint, true),
            _ => false,
        }
    })
}

fn cmap_format_4_has_codepoint(cmap: &[u8], offset: usize, codepoint: u32) -> bool {
    if codepoint > u16::MAX as u32 {
        return false;
    }

    let Some(segment_count_x2) = read_u16(cmap, offset + 6) else {
        return false;
    };
    let segment_count = segment_count_x2 as usize / 2;
    let end_codes_offset = offset + 14;
    let start_codes_offset = end_codes_offset + segment_count * 2 + 2;
    let deltas_offset = start_codes_offset + segment_count * 2;
    let range_offsets_offset = deltas_offset + segment_count * 2;
    let codepoint = codepoint as u16;

    for index in 0..segment_count {
        let Some(end_code) = read_u16(cmap, end_codes_offset + index * 2) else {
            return false;
        };
        let Some(start_code) = read_u16(cmap, start_codes_offset + index * 2) else {
            return false;
        };
        if codepoint < start_code || codepoint > end_code {
            continue;
        }

        let Some(delta) = read_u16(cmap, deltas_offset + index * 2) else {
            return false;
        };
        let range_word_offset = range_offsets_offset + index * 2;
        let Some(range_offset) = read_u16(cmap, range_word_offset) else {
            return false;
        };

        if range_offset == 0 {
            return codepoint.wrapping_add(delta) != 0;
        }

        let glyph_offset =
            range_word_offset + range_offset as usize + (codepoint - start_code) as usize * 2;
        let Some(glyph_id) = read_u16(cmap, glyph_offset) else {
            return false;
        };
        return glyph_id != 0 && glyph_id.wrapping_add(delta) != 0;
    }

    false
}

fn cmap_format_12_has_codepoint(
    cmap: &[u8],
    offset: usize,
    codepoint: u32,
    constant_glyph: bool,
) -> bool {
    let Some(group_count) = read_u32(cmap, offset + 12) else {
        return false;
    };

    for index in 0..group_count as usize {
        let group_offset = offset + 16 + index * 12;
        let Some(start_code) = read_u32(cmap, group_offset) else {
            return false;
        };
        let Some(end_code) = read_u32(cmap, group_offset + 4) else {
            return false;
        };
        if codepoint < start_code {
            return false;
        }
        if codepoint > end_code {
            continue;
        }

        let Some(start_glyph) = read_u32(cmap, group_offset + 8) else {
            return false;
        };
        return if constant_glyph {
            start_glyph != 0
        } else {
            start_glyph.saturating_add(codepoint - start_code) != 0
        };
    }

    false
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let chunk = bytes.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([chunk[0], chunk[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let chunk = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
}

fn diagnose_location_path(path: &str) -> FontLocationDiagnostic {
    let target = PathBuf::from(path.trim());
    let normalized = target
        .canonicalize()
        .unwrap_or_else(|_| target.clone());
    let exists = target.exists();
    let is_file = target.is_file();
    let is_dir = target.is_dir();
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let supported_font_file = extension
        .as_deref()
        .map(|value| FONT_EXTENSIONS.contains(&value))
        .unwrap_or(false);
    let parent = target.parent().map(|value| value.to_string_lossy().to_string());
    let parent_exists = target
        .parent()
        .map(|value| value.exists() && value.is_dir())
        .unwrap_or(false);
    let target_folder = if is_dir {
        Some(normalized.to_string_lossy().to_string())
    } else {
        normalized
            .parent()
            .map(|value| value.to_string_lossy().to_string())
    };

    FontLocationDiagnostic {
        input_path: path.to_string(),
        normalized_path: normalized.to_string_lossy().to_string(),
        exists,
        is_file,
        is_dir,
        extension,
        supported_font_file,
        parent,
        parent_exists,
        target_folder,
    }
}

fn common_parent_dir(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut parents = paths
        .iter()
        .filter_map(|path| path.parent().map(Path::to_path_buf));
    let mut common = parents.next()?;

    for parent in parents {
        while !parent.starts_with(&common) {
            if !common.pop() {
                return None;
            }
        }
    }

    Some(common)
}

fn sanitize_filename(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        "YFonts-project-pack.json".to_string()
    } else {
        cleaned
    }
}

fn sanitize_folder_name(value: &str) -> String {
    let cleaned = sanitize_filename(value)
        .trim_matches(['.', ' '])
        .chars()
        .take(80)
        .collect::<String>();

    if cleaned.is_empty() {
        "YFonts-project-pack".to_string()
    } else {
        cleaned
    }
}

fn is_copyable_font_file(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }

    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    FONT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

fn is_installable_font_file(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }

    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            INSTALLABLE_FONT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
        .unwrap_or(false)
}

fn normalize_font_match_key(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn append_font_files(path: &Path, catalog: &mut Vec<String>, depth: usize) {
    if depth > 5 || !path.is_dir() {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            append_font_files(&entry_path, catalog, depth + 1);
            continue;
        }
        if !is_installable_font_file(&entry_path) {
            continue;
        }
        if let Some(filename) = entry_path.file_stem().and_then(|value| value.to_str()) {
            catalog.push(filename.to_string());
        }
    }
}

fn system_font_catalog() -> Vec<String> {
    let mut catalog = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Some(windows_dir) = env::var_os("WINDIR") {
            append_font_files(&PathBuf::from(windows_dir).join("Fonts"), &mut catalog, 0);
        }
        if let Ok(user_dir) = user_font_dir() {
            append_font_files(&user_dir, &mut catalog, 0);
        }

        for key in [
            r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
            r"HKLM\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
        ] {
            if let Ok(output) = Command::new("reg.exe")
                .args(["query", key])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                catalog.extend(
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                        .map(|line| line.to_string()),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        append_font_files(Path::new("/Library/Fonts"), &mut catalog, 0);
        append_font_files(Path::new("/System/Library/Fonts"), &mut catalog, 0);
        if let Some(home) = env::var_os("HOME") {
            append_font_files(&PathBuf::from(home).join("Library").join("Fonts"), &mut catalog, 0);
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        append_font_files(Path::new("/usr/share/fonts"), &mut catalog, 0);
        append_font_files(Path::new("/usr/local/share/fonts"), &mut catalog, 0);
        if let Ok(user_dir) = user_font_dir() {
            append_font_files(&user_dir, &mut catalog, 0);
        }
    }

    catalog
}

fn user_font_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data =
            env::var_os("LOCALAPPDATA").ok_or_else(|| "LOCALAPPDATA is unavailable".to_string())?;
        return Ok(PathBuf::from(local_app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Fonts"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        return Ok(PathBuf::from(home).join("Library").join("Fonts"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(data_home) = env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home).join("fonts"));
        }

        let home = env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        return Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("fonts"));
    }

    #[allow(unreachable_code)]
    Err("Font installation is not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn register_installed_font(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Graphics::Gdi::AddFontResourceExW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
    };

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid installed font filename".to_string())?;
    let value_name = format!("YFonts::{}", filename);
    let path_value = path.to_string_lossy().to_string();
    let status = Command::new("reg.exe")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
            "/v",
            &value_name,
            "/t",
            "REG_SZ",
            "/d",
            &path_value,
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| error.to_string())?;

    if !status.success() {
        return Err("Unable to register the font for the current Windows user".to_string());
    }

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let added = unsafe { AddFontResourceExW(wide_path.as_ptr(), 0, std::ptr::null_mut()) };
    if added == 0 {
        return Err("Windows could not activate the installed font".to_string());
    }

    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            1000,
            std::ptr::null_mut(),
        );
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_installed_font(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn unregister_installed_font(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Graphics::Gdi::RemoveFontResourceExW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
    };

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    if let Some(filename) = path.file_name().and_then(|value| value.to_str()) {
        let value_name = format!("YFonts::{}", filename);
        let _ = Command::new("reg.exe")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
                "/v",
                &value_name,
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        RemoveFontResourceExW(wide_path.as_ptr(), 0, std::ptr::null_mut());
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            1000,
            std::ptr::null_mut(),
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn unregister_installed_font(_path: &Path) {}

fn refresh_user_font_cache() {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("fc-cache").args(["-f"]).status();
    }
}

fn unique_child_dir(parent: &Path, folder_name: &str) -> PathBuf {
    let mut candidate = parent.join(folder_name);
    let mut index = 2;

    while candidate.exists() {
        candidate = parent.join(format!("{}-{}", folder_name, index));
        index += 1;
    }

    candidate
}

fn unique_file_path(parent: &Path, filename: &str) -> PathBuf {
    let base_path = parent.join(filename);
    if !base_path.exists() {
        return base_path;
    }

    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("font");
    let extension = path.extension().and_then(|value| value.to_str());
    let mut index = 2;

    loop {
        let candidate_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{}-{}.{}", stem, index, extension),
            _ => format!("{}-{}", stem, index),
        };
        let candidate = parent.join(candidate_name);

        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn app_data_file_path(file_name: &str) -> Result<PathBuf, String> {
    if !is_safe_app_data_file_name(file_name) {
        return Err("Invalid app data file name".to_string());
    }

    Ok(yfonts_app_data_dir()?.join(file_name))
}

fn is_safe_app_data_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && !file_name.contains("..")
        && file_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
}

fn yfonts_app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("APPDATA")
            .or_else(|| env::var_os("LOCALAPPDATA"))
            .map(PathBuf::from)
            .ok_or_else(|| "Missing Windows app data directory".to_string())?;

        return Ok(base.join("YFonts"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "Missing HOME directory".to_string())?;

        return Ok(home
            .join("Library")
            .join("Application Support")
            .join("YFonts"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(config_home) = env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
            return Ok(config_home.join("YFonts"));
        }

        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "Missing HOME directory".to_string())?;

        return Ok(home.join(".config").join("YFonts"));
    }
}

fn infer_category(directory_parts: &[&str]) -> String {
    if directory_parts.len() >= 3 {
        return directory_parts[1].to_string();
    }
    if directory_parts.len() >= 2 && !is_generic_font_folder(directory_parts[1]) {
        return directory_parts[1].to_string();
    }
    "Local".to_string()
}

fn pick_family_folder(directory_parts: &[&str], root_name: &str) -> String {
    for folder in directory_parts.iter().rev() {
        if !is_generic_font_folder(folder) && !is_broad_category_folder(folder) {
            return folder.to_string();
        }
    }

    if directory_parts
        .iter()
        .any(|folder| is_broad_category_folder(folder))
    {
        return String::new();
    }
    clean_root_family_label(root_name)
}

fn clean_root_family_label(value: &str) -> String {
    if is_generic_font_folder(value) || is_broad_category_folder(value) {
        return String::new();
    }

    let trimmed = value.trim();
    let lowered = trimmed.to_ascii_lowercase();
    for suffix in ["-main", "_main", " main", "-master", "_master", " master", "-release", "_release", " release", "-source", "_source", " source"] {
        if lowered.ends_with(suffix) {
            return trimmed[..trimmed.len() - suffix.len()]
                .trim_matches(['-', '_', ' '])
                .to_string();
        }
    }
    trimmed.to_string()
}

fn is_generic_font_folder(value: &str) -> bool {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_'], "-");

    normalized.ends_with("-webfont")
        || normalized.ends_with("-webfonts")
        || matches!(
        normalized.as_str(),
        "static"
            | "static-font"
            | "static-fonts"
            | "variable"
            | "variable font"
            | "variable fonts"
            | "variable-font"
            | "variable-fonts"
            | "web"
            | "web-font"
            | "web-fonts"
            | "webfont"
            | "webfonts"
            | "font"
            | "fonts"
            | "font files"
            | "font-files"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
            | "desktop"
            | "truetype"
            | "postscript"
            | "opentype"
            | "opentype-ps"
            | "opentype-tt"
            | "variable-ps"
            | "variable-tt"
            | "web-ps"
            | "web-tt"
        )
}

fn pick_source_library(directory_parts: &[&str], root_name: &str) -> String {
    directory_parts
        .iter()
        .find(|folder| !is_generic_font_folder(folder) && !is_broad_category_folder(folder))
        .copied()
        .unwrap_or(root_name)
        .to_string()
}

fn is_broad_category_folder(value: &str) -> bool {
    if matches!(
        value.trim(),
        "\u{4e2d}\u{6587}"
            | "\u{82f1}\u{6587}"
            | "\u{4e2d}\u{6587}\u{5b57}\u{4f53}"
            | "\u{82f1}\u{6587}\u{5b57}\u{4f53}"
            | "\u{672c}\u{5730}"
            | "\u{9ed1}\u{4f53}"
            | "\u{5b8b}\u{4f53}"
            | "\u{6977}\u{4f53}"
            | "\u{5706}\u{4f53}"
            | "\u{96b6}\u{4e66}"
            | "\u{7bc6}\u{4f53}"
            | "\u{624b}\u{5199}"
            | "\u{624b}\u{5199}\u{4f53}"
            | "\u{590d}\u{53e4}"
            | "\u{590d}\u{53e4}\u{4f53}"
            | "\u{521b}\u{610f}"
            | "\u{521b}\u{610f}\u{4f53}"
            | "\u{7ebf}\u{4f53}"
            | "\u{886c}\u{7ebf}"
            | "\u{65e0}\u{886c}\u{7ebf}"
            | "\u{5361}\u{901a}"
            | "\u{5361}\u{901a}\u{4f53}"
            | "\u{827a}\u{672f}"
            | "\u{827a}\u{672f}\u{4f53}"
    ) {
        return true;
    }

    let normalized = value.trim().to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "local"
            | "serif"
            | "sans"
            | "sans serif"
            | "script"
            | "display"
            | "decorative"
            | "handwriting"
    ) || matches!(
        value.trim(),
        "中文"
            | "英文"
            | "中文字体"
            | "英文字体"
            | "本地"
            | "黑体"
            | "宋体"
            | "楷体"
            | "圆体"
            | "隶书"
            | "篆体"
            | "手写"
            | "手写体"
            | "复古"
            | "复古体"
            | "创意"
            | "创意体"
            | "线体"
            | "衬线"
            | "无衬线"
            | "卡通"
            | "卡通体"
            | "艺术"
            | "艺术体"
    )
}

fn clean_family_name(folder_name: &str, base_name: &str) -> String {
    let folder_candidate = clean_root_family_label(folder_name);
    let folder = strip_family_instance_suffix(
        &(if is_generic_font_folder(&folder_candidate) {
            ""
        } else {
            &folder_candidate
        })
            .trim_start_matches(|value: char| value.is_ascii_digit() || value == '-' || value == '_' || value.is_whitespace())
            .replace("static", "")
            .replace("Static", "")
            .replace("variable fonts", "")
            .replace("Variable Fonts", "")
            .trim()
            .to_string(),
    );
    let base = strip_family_instance_suffix(&strip_style_suffix(base_name));

    if folder.chars().count() >= 2 {
        let should_use_base_casing = normalize_font_match_key(&folder)
            == normalize_font_match_key(&base)
            && folder == folder.to_lowercase()
            && base.chars().any(|character| character.is_ascii_uppercase());
        if should_use_base_casing {
            base
        } else {
            folder
        }
    } else if !base.is_empty() {
        base
    } else {
        base_name.to_string()
    }
}

fn strip_family_instance_suffix(value: &str) -> String {
    let mut result = value.trim_matches(['-', '_', ' ']).to_string();
    let lowered = result.to_ascii_lowercase();

    for (index, character) in lowered.char_indices() {
        if !matches!(character, '-' | '_' | ' ') {
            continue;
        }
        let tail = &lowered[index + character.len_utf8()..];
        let token = tail
            .split(['-', '_', ' '])
            .next()
            .unwrap_or_default();
        let numeric = token
            .strip_suffix("pt")
            .or_else(|| token.strip_suffix("opsz"));
        if numeric.is_some_and(|digits| !digits.is_empty() && digits.chars().all(|digit| digit.is_ascii_digit())) {
            result.truncate(index);
            return result.trim_matches(['-', '_', ' ']).to_string();
        }
    }

    let lowered = result.to_ascii_lowercase();
    for suffix in [
        "ultracondensed",
        "extracondensed",
        "semicondensed",
        "condensed",
        "narrow",
        "semiexpanded",
        "extraexpanded",
        "ultraexpanded",
        "expanded",
        "wide",
    ] {
        if !lowered.ends_with(suffix) {
            continue;
        }
        let start = result.len() - suffix.len();
        let has_boundary = start == 0
            || result[..start]
                .chars()
                .last()
                .is_some_and(|character| matches!(character, '-' | '_' | ' '))
            || result.as_bytes()[start].is_ascii_uppercase();
        if has_boundary {
            result.truncate(start);
            return result.trim_matches(['-', '_', ' ']).to_string();
        }
    }

    result
}

fn strip_style_suffix(value: &str) -> String {
    let lowered = value.to_ascii_lowercase();
    let style_tokens = [
        "thin",
        "extralight",
        "extra-light",
        "light",
        "regular",
        "medium",
        "semibold",
        "semi-bold",
        "bold",
        "extrabold",
        "extra-bold",
        "black",
        "heavy",
        "italic",
        "oblique",
    ];

    for token in style_tokens {
        if let Some(index) = lowered.rfind(&format!("-{}", token)).or_else(|| lowered.rfind(&format!("_{}", token))) {
            return value[..index].trim().to_string();
        }
    }

    value
        .replace("VariableFont", "")
        .replace("variablefont", "")
        .trim_matches(['-', '_', ' '])
        .to_string()
}

fn infer_style_name(name: &str) -> String {
    let normalized = name.to_ascii_lowercase();
    let mut styles = Vec::new();
    let width_tokens = [
        ("ultracondensed", "UltraCondensed"),
        ("extracondensed", "ExtraCondensed"),
        ("semicondensed", "SemiCondensed"),
        ("condensed", "Condensed"),
        ("narrow", "Narrow"),
        ("semiexpanded", "SemiExpanded"),
        ("extraexpanded", "ExtraExpanded"),
        ("ultraexpanded", "UltraExpanded"),
        ("expanded", "Expanded"),
        ("wide", "Wide"),
    ];
    let tokens = [
        ("thin", "Thin"),
        ("extralight", "ExtraLight"),
        ("extra-light", "ExtraLight"),
        ("light", "Light"),
        ("regular", "Regular"),
        ("medium", "Medium"),
        ("semibold", "SemiBold"),
        ("semi-bold", "SemiBold"),
        ("extrabold", "ExtraBold"),
        ("extra-bold", "ExtraBold"),
        ("bold", "Bold"),
        ("black", "Black"),
        ("heavy", "Heavy"),
        ("italic", "Italic"),
        ("oblique", "Oblique"),
    ];

    if normalized.contains("variablefont") || normalized.contains("vf") {
        styles.push("Variable");
    }

    if let Some((_, label)) = width_tokens
        .iter()
        .find(|(token, _)| normalized.contains(token))
    {
        styles.push(label);
    }

    for (token, label) in tokens {
        if normalized.contains(token) && !styles.contains(&label) {
            styles.push(label);
        }
    }

    if styles.is_empty() {
        "Regular".to_string()
    } else {
        styles.join(" / ")
    }
}

fn infer_weight(name: &str) -> u16 {
    let normalized = name.to_ascii_lowercase();
    if normalized.contains("thin") {
        return 100;
    }
    if normalized.contains("extralight") || normalized.contains("extra-light") {
        return 200;
    }
    if normalized.contains("light") {
        return 300;
    }
    if normalized.contains("medium") {
        return 500;
    }
    if normalized.contains("semibold") || normalized.contains("semi-bold") {
        return 600;
    }
    if normalized.contains("extrabold") || normalized.contains("extra-bold") {
        return 800;
    }
    if normalized.contains("black") || normalized.contains("heavy") {
        return 900;
    }
    if normalized.contains("bold") {
        return 700;
    }
    400
}

fn infer_language(source_library: &str, category: &str, family: &str, base_name: &str) -> String {
    let family_text = format!("{} {}", family, base_name);
    let context_text = format!("{} {}", source_library, category);
    let all_text = format!("{} {}", context_text, family_text);
    let normalized_context = context_text.to_ascii_lowercase();
    let normalized_all = all_text.to_ascii_lowercase();

    if contains_cjk(&family_text)
        || contains_any(
            &family_text,
            &[
                "\u{4f53}",
                "\u{62fc}\u{97f3}",
                "\u{9ed1}",
                "\u{5b8b}",
                "\u{6977}",
                "\u{5706}",
                "\u{96b6}",
                "\u{7bc6}",
                "\u{65b9}\u{6b63}",
                "\u{6c49}\u{4eea}",
                "\u{963f}\u{91cc}",
                "\u{6296}\u{97f3}",
                "\u{9489}\u{9489}",
                "\u{5b57}\u{5e93}",
            ],
        )
    {
        return "chinese".to_string();
    }

    if normalized_context.contains("english")
        || context_text.contains("\u{82f1}\u{6587}")
        || normalized_context.contains("latin")
    {
        return "english".to_string();
    }

    if contains_any(
        &context_text,
        &[
            "\u{4e2d}\u{6587}",
            "\u{6c49}\u{5b57}",
            "\u{9ed1}\u{4f53}",
            "\u{5b8b}\u{4f53}",
            "\u{6977}\u{4f53}",
            "\u{5706}\u{4f53}",
        ],
    ) {
        return "chinese".to_string();
    }

    if normalized_all.contains("sans")
        || normalized_all.contains("serif")
        || normalized_all.contains("script")
        || normalized_all.contains("font")
        || normalized_all.contains("display")
        || normalized_all.contains("mono")
        || normalized_all.contains("brush")
        || normalized_all.contains("signature")
    {
        return "english".to_string();
    }

    if family_text.chars().any(|character| character.is_ascii_alphabetic()) {
        return "english".to_string();
    }
    if contains_cjk(&all_text) {
        return "chinese".to_string();
    }
    "chinese".to_string()
}

fn contains_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|character| ('\u{3400}'..='\u{9fff}').contains(&character))
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn font_format(extension: &str) -> String {
    match extension.to_ascii_lowercase().as_str() {
        "otf" => "opentype",
        "ttf" | "ttc" => "truetype",
        "woff" => "woff",
        "woff2" => "woff2",
        _ => "truetype",
    }
    .to_string()
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        return format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0);
    }
    if bytes >= 1024 {
        return format!("{} KB", bytes / 1024);
    }
    format!("{} B", bytes)
}

fn current_date_label() -> String {
    "2026-06-03".to_string()
}

fn create_id(value: &str) -> String {
    let mut hash: u32 = 2166136261;
    for byte in value.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("{:x}", hash)
}

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let folder = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        };

        Command::new("explorer.exe")
            .arg(folder)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().unwrap_or(path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clean_family_name, detect_font_language, extract_font_names, infer_language,
        is_generic_font_folder, pick_family_folder, pick_source_library, read_font_names,
        scan_font_folder, validate_font_location_target, FontNames,
    };
    use std::collections::HashSet;
    use std::env;
    use std::fs;
    use std::path::Path;

    #[test]
    fn keeps_chinese_family_in_chinese_even_under_english_context() {
        assert_eq!(
            infer_language(
                "\u{82f1}\u{6587}",
                "\u{82f1}\u{6587}\u{5176}\u{4ed6}",
                "\u{963f}\u{91cc}\u{5065}\u{5eb7}\u{4f53}4.2\u{62fc}\u{97f3}",
                "\u{963f}\u{91cc}\u{5065}\u{5eb7}\u{4f53}4.2\u{62fc}\u{97f3}"
            ),
            "chinese"
        );
    }

    #[test]
    fn keeps_latin_family_in_english_when_folder_says_english_fonts() {
        assert_eq!(
            infer_language(
                "\u{514d}\u{8d39}\u{82f1}\u{6587}\u{5b57}\u{4f53}",
                "\u{827a}\u{672f}",
                "CinzelDecorative",
                "CinzelDecorative-Regular"
            ),
            "english"
        );
    }

    #[test]
    fn treats_delivery_format_folders_as_technical_structure() {
        for folder in [
            "WEB",
            "Variable",
            "Static Fonts",
            "NoirPro-Webfont",
            "OpenType-PS",
            "OpenType-TT",
            "Variable-TT",
            "Web-PS",
            "Web-TT",
        ] {
            assert!(is_generic_font_folder(folder), "{folder} should be generic");
        }
    }

    #[test]
    fn reads_typographic_family_and_style_from_font_name_table() {
        let family = utf16_be("Example Sans Cond");
        let style = utf16_be("Bold Italic");
        let strings_offset = 30_u16;
        let table_length = strings_offset as usize + family.len() + style.len();
        let mut bytes = vec![0_u8; 28 + table_length];

        bytes[0..4].copy_from_slice(&[0x00, 0x01, 0x00, 0x00]);
        write_u16(&mut bytes, 4, 1);
        bytes[12..16].copy_from_slice(b"name");
        write_u32(&mut bytes, 20, 28);
        write_u32(&mut bytes, 24, table_length as u32);

        let table_offset = 28;
        write_u16(&mut bytes, table_offset, 0);
        write_u16(&mut bytes, table_offset + 2, 2);
        write_u16(&mut bytes, table_offset + 4, strings_offset);

        write_name_record(
            &mut bytes,
            table_offset + 6,
            16,
            family.len() as u16,
            0,
        );
        write_name_record(
            &mut bytes,
            table_offset + 18,
            17,
            style.len() as u16,
            family.len() as u16,
        );
        let strings_start = table_offset + strings_offset as usize;
        bytes[strings_start..strings_start + family.len()].copy_from_slice(&family);
        bytes[strings_start + family.len()..strings_start + family.len() + style.len()]
            .copy_from_slice(&style);

        assert_eq!(
            extract_font_names(&bytes),
            Some(FontNames {
                family: Some("Example Sans Cond".to_string()),
                style: Some("Bold Italic".to_string())
            })
        );
    }

    #[test]
    fn keeps_one_family_across_desktop_variable_and_web_folders() {
        let desktop_path = ["Example Sans", "OpenType-TT"];
        let web_path = ["Example Sans", "Web-TT"];

        assert_eq!(
            pick_family_folder(&desktop_path, "Font Library"),
            "Example Sans"
        );
        assert_eq!(
            pick_family_folder(&web_path, "Font Library"),
            "Example Sans"
        );
        assert_eq!(
            pick_source_library(&desktop_path, "Font Library"),
            "Example Sans"
        );
        assert_eq!(
            pick_source_library(&web_path, "Font Library"),
            "Example Sans"
        );
    }

    #[test]
    fn derives_single_file_family_from_filename_inside_technical_folder() {
        assert_eq!(
            clean_family_name("OpenType-TT", "ExampleSans-Bold"),
            "ExampleSans"
        );
        assert_eq!(
            clean_family_name("Web-PS", "ExampleSans-Regular"),
            "ExampleSans"
        );
        assert_eq!(
            clean_family_name("RobotoSerif_120pt_ExtraExpanded", "RobotoSerif-Regular"),
            "RobotoSerif"
        );
        assert_eq!(
            clean_family_name("MonaSansSemiCondensed", "MonaSansSemiCondensed-Regular"),
            "MonaSans"
        );
        assert_eq!(
            clean_family_name("BodoniModa_72pt", "BodoniModa_72pt-Regular"),
            "BodoniModa"
        );
    }

    #[test]
    fn scans_multi_format_package_as_one_family_identity() {
        let parent = env::temp_dir().join(format!(
            "yfonts-family-package-test-{}",
            std::process::id()
        ));
        let root = parent.join("Example Sans");
        let fixtures = [
            ("OpenType-TT", "ExampleSans-Regular.ttf"),
            ("OpenType-PS", "ExampleSans-Bold.otf"),
            ("Variable-TT", "ExampleSans-VariableFont_wght.ttf"),
            ("Web-TT", "ExampleSans-Regular.woff2"),
        ];

        for (folder, filename) in fixtures {
            let directory = root.join(folder);
            fs::create_dir_all(&directory).expect("create format directory");
            fs::write(directory.join(filename), [0_u8; 4]).expect("write font fixture");
        }

        let index = scan_font_folder(root.to_string_lossy().to_string())
            .expect("scan multi-format font package");
        let families = index
            .fonts
            .iter()
            .map(|font| font.family.as_str())
            .collect::<HashSet<_>>();
        let sources = index
            .fonts
            .iter()
            .map(|font| font.source_library.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(index.total_fonts, 4);
        assert_eq!(families, HashSet::from(["Example Sans"]));
        assert_eq!(sources, HashSet::from(["Example Sans"]));

        fs::remove_dir_all(parent).expect("remove family package test directory");
    }

    #[test]
    fn missing_font_is_not_accepted_when_parent_folder_exists() {
        let parent = env::temp_dir().join(format!(
            "yfonts-location-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&parent).expect("create location test directory");
        let missing_font = parent.join("missing-font.ttf");

        assert!(validate_font_location_target(&missing_font).is_err());

        fs::remove_dir_all(parent).expect("remove location test directory");
    }

    #[test]
    fn detects_real_font_glyph_coverage_when_paths_are_provided() {
        let Ok(chinese_font) = env::var("YFONTS_TEST_CHINESE_FONT") else {
            return;
        };
        let Ok(english_font) = env::var("YFONTS_TEST_ENGLISH_FONT") else {
            return;
        };

        assert_eq!(
            detect_font_language(Path::new(&chinese_font)).as_deref(),
            Some("chinese")
        );
        assert_eq!(
            detect_font_language(Path::new(&english_font)).as_deref(),
            Some("english")
        );
    }

    #[test]
    fn reads_expected_family_from_real_font_when_path_is_provided() {
        let Ok(font_path) = env::var("YFONTS_TEST_NAME_FONT") else {
            return;
        };
        let Ok(expected_family) = env::var("YFONTS_TEST_EXPECTED_FAMILY") else {
            return;
        };

        let names = read_font_names(Path::new(&font_path)).expect("read real font names");
        assert_eq!(names.family.as_deref(), Some(expected_family.as_str()));
    }

    fn utf16_be(value: &str) -> Vec<u8> {
        value
            .encode_utf16()
            .flat_map(u16::to_be_bytes)
            .collect::<Vec<_>>()
    }

    fn write_name_record(
        bytes: &mut [u8],
        offset: usize,
        name_id: u16,
        length: u16,
        string_offset: u16,
    ) {
        write_u16(bytes, offset, 3);
        write_u16(bytes, offset + 2, 1);
        write_u16(bytes, offset + 4, 0x0409);
        write_u16(bytes, offset + 6, name_id);
        write_u16(bytes, offset + 8, length);
        write_u16(bytes, offset + 10, string_offset);
    }

    fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
    }

    fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(build_macos_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with("yfonts-") {
                let _ = app.emit("yfonts-menu-action", id);
            }
        });

    builder
        .invoke_handler(tauri::generate_handler![
            scan_font_folder,
            pick_font_files,
            pick_font_folder_path,
            open_font_location,
            diagnose_font_location,
            open_external_url,
            detect_system_font,
            install_font_files,
            uninstall_font_files,
            download_online_font_files,
            save_text_file,
            export_project_pack_bundle,
            read_app_data_file,
            write_app_data_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running YFonts");
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItemBuilder::with_id("yfonts-settings", "字体库设置…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let import_folder = MenuItemBuilder::with_id("yfonts-import-folder", "导入字体文件夹…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let import_files = MenuItemBuilder::with_id("yfonts-import-files", "导入字体文件…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let sync_index = MenuItemBuilder::with_id("yfonts-sync-index", "同步字体索引")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let search = MenuItemBuilder::with_id("yfonts-search", "搜索字体")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let show_all = MenuItemBuilder::with_id("yfonts-show-all", "全部字体")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let show_local = MenuItemBuilder::with_id("yfonts-show-local", "本地字体包")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let show_online = MenuItemBuilder::with_id("yfonts-show-online", "在线发现")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let show_favorites = MenuItemBuilder::with_id("yfonts-show-favorites", "收藏字体")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let show_projects = MenuItemBuilder::with_id("yfonts-show-projects", "项目字体包")
        .accelerator("CmdOrCtrl+5")
        .build(app)?;
    let manage_categories = MenuItemBuilder::with_id("yfonts-manage-categories", "管理字体分类…")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("yfonts-toggle-sidebar", "显示或隐藏侧边栏")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let toggle_theme = MenuItemBuilder::with_id("yfonts-toggle-theme", "切换深色与浅色外观")
        .build(app)?;
    let check_updates = MenuItemBuilder::with_id("yfonts-check-updates", "检查更新…")
        .build(app)?;
    let open_github = MenuItemBuilder::with_id("yfonts-open-github", "打开 YFonts GitHub")
        .build(app)?;

    let about = AboutMetadata {
        name: Some("YFonts".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        copyright: Some("© 2026 LYZ".to_string()),
        credits: Some("Created by LYZ".to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "YFonts")
        .about_with_text("关于 YFonts", Some(about))
        .item(&settings)
        .separator()
        .services_with_text("服务")
        .separator()
        .hide_with_text("隐藏 YFonts")
        .hide_others_with_text("隐藏其他应用")
        .show_all_with_text("全部显示")
        .separator()
        .quit_with_text("退出 YFonts")
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&import_folder)
        .item(&import_files)
        .separator()
        .item(&sync_index)
        .separator()
        .close_window_with_text("关闭窗口")
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo_with_text("撤销")
        .redo_with_text("重做")
        .separator()
        .cut_with_text("剪切")
        .copy_with_text("复制")
        .paste_with_text("粘贴")
        .select_all_with_text("全选")
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&search)
        .separator()
        .item(&show_all)
        .item(&show_local)
        .item(&show_online)
        .item(&show_favorites)
        .item(&show_projects)
        .separator()
        .item(&manage_categories)
        .item(&toggle_sidebar)
        .item(&toggle_theme)
        .separator()
        .fullscreen_with_text("进入或退出全屏")
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize_with_text("最小化")
        .maximize_with_text("缩放")
        .separator()
        .bring_all_to_front_with_text("前置全部窗口")
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&check_updates)
        .item(&open_github)
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}
