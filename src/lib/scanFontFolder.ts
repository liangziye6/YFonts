import type { LocalFontIndex } from "./localFontIndex";
import { invokeTauri, isTauriRuntime } from "./tauri";

export async function scanFontFolder(path: string): Promise<LocalFontIndex> {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("Missing folder path");

  try {
    const result = await invokeTauri<LocalFontIndex>("scan_font_folder", {
      path: normalizedPath
    });
    return withTauriFontUrls(result);
  } catch (error) {
    if (isTauriRuntime()) throw error;
  }

  const response = await fetch(`/scan-folder?path=${encodeURIComponent(normalizedPath)}`, {
    method: "POST"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to scan folder");
  }

  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Folder scanning is only available in the desktop app");
  }

  return (await response.json()) as LocalFontIndex;
}

export async function pickNativeFontFiles(): Promise<LocalFontIndex | undefined> {
  try {
    const result = await invokeTauri<LocalFontIndex | null>("pick_font_files");
    return result ? withTauriFontUrls(result) : undefined;
  } catch (error) {
    if (isTauriRuntime()) throw error;
    return undefined;
  }
}

async function withTauriFontUrls(index: LocalFontIndex): Promise<LocalFontIndex> {
  const convertFileSrc = await getConvertFileSrc();
  if (!convertFileSrc) return index;

  return {
    ...index,
    fonts: index.fonts.map((record) => ({
      ...record,
      libraryRoot: record.libraryRoot || index.root,
      fontUrl: record.fontUrl || convertFileSrc(record.path)
    }))
  };
}

async function getConvertFileSrc() {
  if (window.__TAURI_INTERNALS__?.convertFileSrc) {
    return window.__TAURI_INTERNALS__.convertFileSrc;
  }

  try {
    const core = await import("@tauri-apps/api/core");
    return core.convertFileSrc;
  } catch {
    return undefined;
  }
}
