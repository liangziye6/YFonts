/// <reference types="node" />
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const allowedFontExtensions = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"]);
const fontIndexPath = path.resolve("public", "font-index.json");
const runtimeAllowedFontRoots = new Set<string>();

function localFontServer(): Plugin {
  return {
    name: "yfonts-local-font-server",
    configureServer(server) {
      server.middlewares.use("/local-font", (request, response, next) => {
        try {
          const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
          const requestedPath = requestUrl.searchParams.get("path");
          if (!requestedPath) {
            next();
            return;
          }

          const fontPath = path.normalize(requestedPath);
          const extension = path.extname(fontPath).toLowerCase();
          const roots = getAllowedFontRoots();
          if (!allowedFontExtensions.has(extension)) {
            response.statusCode = 403;
            response.end("Unsupported font file");
            return;
          }

          if (!isPathInsideAllowedRoots(fontPath, roots)) {
            response.statusCode = 403;
            response.end("Font path is outside the configured library roots");
            return;
          }

          if (!fs.existsSync(fontPath) || !fs.statSync(fontPath).isFile()) {
            response.statusCode = 404;
            response.end("Font file not found");
            return;
          }

          response.setHeader("Content-Type", getFontMimeType(extension));
          response.setHeader("Cache-Control", "no-cache");
          fs.createReadStream(fontPath).pipe(response);
        } catch (error) {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : "Unable to read font file");
        }
      });

      server.middlewares.use("/open-location", (request, response, next) => {
        try {
          if (request.method !== "POST") {
            next();
            return;
          }

          const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
          const requestedPath = requestUrl.searchParams.get("path");
          if (!requestedPath) {
            response.statusCode = 400;
            response.end("Missing path");
            return;
          }

          const targetPath = path.normalize(requestedPath);
          const extension = path.extname(targetPath).toLowerCase();
          if (!allowedFontExtensions.has(extension)) {
            response.statusCode = 403;
            response.end("Only font files can be revealed");
            return;
          }

          if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
            response.statusCode = 404;
            response.end("Font file not found");
            return;
          }

          revealInFileManager(targetPath);
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ ok: true }));
        } catch (error) {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : "Unable to open location");
        }
      });

      server.middlewares.use("/scan-folder", async (request, response, next) => {
        try {
          if (request.method !== "POST") {
            next();
            return;
          }

          const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
          const requestedPath = requestUrl.searchParams.get("path");
          if (!requestedPath) {
            response.statusCode = 400;
            response.end("Missing path");
            return;
          }

          const root = path.resolve(path.normalize(requestedPath));
          if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
            response.statusCode = 404;
            response.end("Folder not found");
            return;
          }

          const index = await scanFontFolderIndex(root);
          runtimeAllowedFontRoots.add(root);
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(index));
        } catch (error) {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : "Unable to scan folder");
        }
      });
    }
  };
}

async function scanFontFolderIndex(root: string) {
  const records: Array<Record<string, unknown>> = [];
  await walkFontFolder(root, root, records);

  records.sort((a, b) => {
    const left = String(a.relativePath ?? "");
    const right = String(b.relativePath ?? "");
    return left.localeCompare(right, "zh-Hans-CN");
  });

  return {
    generatedAt: new Date().toISOString(),
    root,
    totalFonts: records.length,
    fonts: records
  };
}

async function walkFontFolder(root: string, folder: string, records: Array<Record<string, unknown>>) {
  const entries = await fs.promises.readdir(folder, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "__MACOSX" || entry.name.startsWith("._")) continue;

    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      await walkFontFolder(root, fullPath, records);
      continue;
    }

    if (!entry.isFile()) continue;

    const extensionWithDot = path.extname(entry.name).toLowerCase();
    if (!allowedFontExtensions.has(extensionWithDot)) continue;

    const stats = await fs.promises.stat(fullPath);
    const relativePath = path.relative(root, fullPath);
    const parts = relativePath.split(path.sep);
    const directoryParts = parts.slice(0, -1);
    const extension = extensionWithDot.slice(1);
    const category = inferScannedCategory(directoryParts);
    const folderName = pickScannedFamilyFolder(directoryParts, path.basename(root));
    const baseName = path.basename(entry.name, extensionWithDot);
    const family = cleanScannedFamilyName(folderName, baseName);
    const sourceLibrary = directoryParts[0] || path.basename(root) || "Local";

    records.push({
      id: `scan-${createScanId(relativePath)}`,
      family,
      styleName: inferScannedStyleName(baseName),
      category,
      sourceLibrary,
      language: inferScannedLanguage(sourceLibrary, category, family, baseName),
      path: fullPath,
      relativePath,
      libraryRoot: root,
      extension,
      size: stats.size,
      sizeLabel: formatScanSize(stats.size),
      fontUrl: toViteFsUrl(fullPath),
      fontFormat: getFontCssFormat(extensionWithDot),
      weight: inferScannedWeight(baseName),
      addedAt: stats.mtime.toISOString().slice(0, 10)
    });
  }
}

function inferScannedCategory(directoryParts: string[]) {
  if (directoryParts.length >= 3) return directoryParts[1];
  if (directoryParts.length >= 2 && !isGenericFontFolder(directoryParts[1])) {
    return directoryParts[1];
  }
  return "Local";
}

function pickScannedFamilyFolder(directoryParts: string[], rootName: string) {
  for (let index = directoryParts.length - 1; index >= 0; index -= 1) {
    const folder = directoryParts[index];
    if (!isGenericFontFolder(folder) && !isBroadCategoryFolder(folder)) return folder;
  }

  return rootName;
}

function isGenericFontFolder(value: string) {
  return /^(static|variable fonts?|webfonts?|fonts?|font files?|ttf|otf|woff2?|desktop)$/i.test(
    value.trim()
  );
}

function isBroadCategoryFolder(value: string) {
  return /^(中文|英文|中文字体|英文字体|本地|local|黑体|宋体|楷体|圆体|隶书|篆体|手写|复古|创意|线体|衬线|无衬线|卡通|艺术|serif|sans|sans serif|script|display|decorative|handwriting)$/i.test(
    value.trim()
  );
}

function cleanScannedFamilyName(folderName: string, baseName: string) {
  const folder = folderName
    .replace(/^\d+[-_\s]*/, "")
    .replace(/static|variable fonts?/gi, "")
    .trim();
  const base = baseName
    .replace(
      /[-_](thin|extralight|extra-light|light|regular|medium|semibold|semi-bold|bold|extrabold|extra-bold|black|heavy|italic|oblique).*$/i,
      ""
    )
    .replace(/[-_]?variablefont.*$/i, "")
    .trim();

  return folder.length >= 2 ? folder : base || baseName;
}

function inferScannedStyleName(name: string) {
  const normalized = name.toLowerCase();
  const styles = [
    ["thin", "Thin"],
    ["extralight", "ExtraLight"],
    ["extra-light", "ExtraLight"],
    ["light", "Light"],
    ["regular", "Regular"],
    ["medium", "Medium"],
    ["semibold", "SemiBold"],
    ["semi-bold", "SemiBold"],
    ["extrabold", "ExtraBold"],
    ["extra-bold", "ExtraBold"],
    ["bold", "Bold"],
    ["black", "Black"],
    ["heavy", "Heavy"],
    ["italic", "Italic"],
    ["oblique", "Oblique"]
  ];
  const found = styles.filter(([token]) => normalized.includes(token)).map(([, label]) => label);
  if (normalized.includes("variablefont") || normalized.includes("vf")) found.unshift("Variable");
  return found.length > 0 ? Array.from(new Set(found)).join(" / ") : "Regular";
}

function inferScannedWeight(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("thin")) return 100;
  if (normalized.includes("extralight") || normalized.includes("extra-light")) return 200;
  if (normalized.includes("light")) return 300;
  if (normalized.includes("medium")) return 500;
  if (normalized.includes("semibold") || normalized.includes("semi-bold")) return 600;
  if (normalized.includes("extrabold") || normalized.includes("extra-bold")) return 800;
  if (normalized.includes("black") || normalized.includes("heavy")) return 900;
  if (normalized.includes("bold")) return 700;
  return 400;
}

function inferScannedLanguage(
  sourceLibrary: string,
  category: string,
  family: string,
  baseName: string
) {
  const familyText = `${family} ${baseName}`;
  const contextText = `${sourceLibrary} ${category}`;
  const allText = `${contextText} ${familyText}`;

  if (/[\u3400-\u9fff]/.test(familyText)) return "chinese";
  if (/体|拼音|黑|宋|楷|圆|隶|篆|方正|汉仪|阿里|抖音|钉钉|字库/.test(familyText)) {
    return "chinese";
  }
  if (/english|英文|latin/i.test(contextText)) return "english";
  if (/中文|汉字|黑体|宋体|楷体|圆体/.test(contextText)) return "chinese";
  if (/sans|serif|script|font|display|mono|brush|signature/i.test(allText)) return "english";
  if (/[a-z]/i.test(familyText)) return "english";
  return /[\u3400-\u9fff]/.test(allText) ? "chinese" : "english";
}

function toViteFsUrl(filePath: string) {
  return `/local-font?path=${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
}

function getFontCssFormat(extension: string) {
  const formats: Record<string, string> = {
    ".otf": "opentype",
    ".ttf": "truetype",
    ".ttc": "truetype",
    ".woff": "woff",
    ".woff2": "woff2"
  };
  return formats[extension] || "truetype";
}

function formatScanSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function createScanId(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getAllowedFontRoots(): string[] {
  const envRoots = (process.env.YFONTS_FONT_ROOTS ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const singleEnvRoot = process.env.YFONTS_FONT_LIBRARY;
  const indexRoot = readFontIndexRoot();
  const roots = [...runtimeAllowedFontRoots, ...envRoots, singleEnvRoot, indexRoot]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value));

  return Array.from(new Set(roots));
}

function readFontIndexRoot(): string | undefined {
  if (!fs.existsSync(fontIndexPath)) return undefined;

  try {
    const index = JSON.parse(fs.readFileSync(fontIndexPath, "utf8")) as { root?: unknown };
    return typeof index.root === "string" ? index.root : undefined;
  } catch {
    return undefined;
  }
}

function isPathInsideAllowedRoots(targetPath: string, roots: string[]): boolean {
  if (roots.length === 0) return false;

  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function revealInFileManager(targetPath: string): void {
  if (os.platform() === "win32") {
    const child = spawn("explorer.exe", [path.dirname(targetPath)], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return;
  }

  if (os.platform() === "darwin") {
    const child = spawn("open", ["-R", targetPath], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return;
  }

  const child = spawn("xdg-open", [path.dirname(targetPath)], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function getFontMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".ttc": "font/collection",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}

export default defineConfig(({ command }) => ({
  plugins: [react(), localFontServer()],
  publicDir: command === "serve" ? "public" : false,
  build: {
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: ["."]
    }
  },
  clearScreen: false
}));
