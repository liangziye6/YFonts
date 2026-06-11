use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc", "woff", "woff2"];

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
    let family = clean_family_name(&folder_name, base_name);
    let source_library = directory_parts
        .first()
        .copied()
        .unwrap_or(&root_name)
        .to_string();

    let language = detect_font_language(entry_path).unwrap_or_else(|| {
        infer_language(&source_library, &category, &family, base_name)
    });

    fonts.push(FontRecord {
        id: format!("scan-{}", create_id(&format!("{}|{}", root.to_string_lossy(), relative_path))),
        family: family.clone(),
        style_name: infer_style_name(base_name),
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
        weight: infer_weight(base_name),
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

    root_name.to_string()
}

fn is_generic_font_folder(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "static"
            | "variable font"
            | "variable fonts"
            | "webfont"
            | "webfonts"
            | "font"
            | "fonts"
            | "font files"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
            | "desktop"
    )
}

fn is_broad_category_folder(value: &str) -> bool {
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
            | "复古"
            | "创意"
            | "线体"
            | "衬线"
            | "无衬线"
            | "卡通"
            | "艺术"
    )
}

fn clean_family_name(folder_name: &str, base_name: &str) -> String {
    let folder = folder_name
        .trim_start_matches(|value: char| value.is_ascii_digit() || value == '-' || value == '_' || value.is_whitespace())
        .replace("static", "")
        .replace("Static", "")
        .replace("variable fonts", "")
        .replace("Variable Fonts", "")
        .trim()
        .to_string();
    let base = strip_style_suffix(base_name);

    if folder.chars().count() >= 2 {
        folder
    } else if !base.is_empty() {
        base
    } else {
        base_name.to_string()
    }
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
    use super::{detect_font_language, infer_language, validate_font_location_target};
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_font_folder,
            pick_font_files,
            pick_font_folder_path,
            open_font_location,
            diagnose_font_location,
            save_text_file,
            export_project_pack_bundle,
            read_app_data_file,
            write_app_data_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running YFonts");
}
