import { invokeTauri, isTauriRuntime } from "./tauri";

export type FontLocationDiagnostic = {
  inputPath: string;
  normalizedPath: string;
  exists: boolean;
  isFile: boolean;
  isDir: boolean;
  extension?: string;
  supportedFontFile: boolean;
  parent?: string;
  parentExists: boolean;
  targetFolder?: string;
};

export async function openFontLocation(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("Missing font path");

  try {
    await invokeTauri("open_font_location", { path: normalizedPath });
    return;
  } catch (error) {
    if (isTauriRuntime()) throw error;
  }

  const response = await fetch(`/open-location?path=${encodeURIComponent(normalizedPath)}`, {
    method: "POST"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to open location");
  }
}

export async function diagnoseFontLocation(path: string): Promise<FontLocationDiagnostic | undefined> {
  const normalizedPath = path.trim();
  if (!normalizedPath || !isTauriRuntime()) return undefined;

  return invokeTauri<FontLocationDiagnostic>("diagnose_font_location", {
    path: normalizedPath
  });
}
