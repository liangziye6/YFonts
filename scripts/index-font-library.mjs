import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"]);
const inputRoot = process.argv[2] || process.env.YFONTS_FONT_LIBRARY;
const outputPath = path.resolve("public", "font-index.json");

if (!inputRoot) {
  console.error("Missing font library folder.");
  console.error("Usage: npm run index:fonts -- \"D:\\\\Fonts\"");
  console.error("Or set YFONTS_FONT_LIBRARY to your local font library folder.");
  process.exit(1);
}

const root = path.resolve(inputRoot);

if (!existsSync(root)) {
  throw new Error(`Font library folder not found: ${root}`);
}

const records = [];

async function walk(folder) {
  const entries = await import("node:fs/promises").then((fs) =>
    fs.readdir(folder, { withFileTypes: true })
  );

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "__MACOSX") continue;
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("._")) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!FONT_EXTENSIONS.has(extension)) continue;

    const stats = await import("node:fs/promises").then((fs) => fs.stat(fullPath));
    const relative = path.relative(root, fullPath);
    const parts = relative.split(path.sep);
    const directoryParts = parts.slice(0, -1);
    const library = directoryParts[0] || path.basename(root) || "Local";
    const category = inferCategory(directoryParts);
    const folderName = pickFamilyFolder(directoryParts, path.basename(root));
    const baseName = path.basename(entry.name, extension);
    const family = cleanFamilyName(folderName, baseName);
    const styleName = inferStyleName(baseName);

    records.push({
      id: createId(relative),
      family,
      styleName,
      category,
      sourceLibrary: library,
      language: inferLanguage(library, category, family),
      path: fullPath,
      relativePath: relative,
      libraryRoot: root,
      extension: extension.slice(1),
      size: stats.size,
      sizeLabel: formatSize(stats.size),
      fontUrl: toViteFsUrl(fullPath),
      fontFormat: toCssFormat(extension),
      weight: inferWeight(baseName),
      addedAt: stats.mtime.toISOString().slice(0, 10)
    });
  }
}

function inferCategory(directoryParts) {
  if (directoryParts.length >= 3) return directoryParts[1];
  if (directoryParts.length >= 2 && !isGenericFontFolder(directoryParts[1])) {
    return directoryParts[1];
  }
  return "Local";
}

function pickFamilyFolder(directoryParts, rootName) {
  for (let index = directoryParts.length - 1; index >= 0; index -= 1) {
    const folder = directoryParts[index];
    if (!isGenericFontFolder(folder) && !isBroadCategoryFolder(folder)) return folder;
  }

  return rootName;
}

function isGenericFontFolder(value) {
  return /^(static|variable fonts?|webfonts?|fonts?|font files?|ttf|otf|woff2?|desktop)$/i.test(
    value.trim()
  );
}

function isBroadCategoryFolder(value) {
  return /^(中文|英文|中文字体|英文字体|本地|local|黑体|宋体|楷体|圆体|隶书|篆体|手写|复古|创意|线体|衬线|无衬线|卡通|艺术|serif|sans|sans serif|script|display|decorative|handwriting)$/i.test(
    value.trim()
  );
}

function cleanFamilyName(folderName, baseName) {
  const folder = folderName
    .replace(/^\d+[-_\s]*/, "")
    .replace(/_猫啃网|_字库星球|字体安装包|webfonts|static|variable fonts?/gi, "")
    .trim();

  const base = baseName
    .replace(/[-_](thin|extralight|extra-light|light|regular|medium|semibold|semi-bold|bold|extrabold|extra-bold|black|heavy|italic|oblique).*$/i, "")
    .replace(/[-_]?variablefont.*$/i, "")
    .trim();

  return folder.length >= 2 ? folder : base || baseName;
}

function inferStyleName(name) {
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

function inferWeight(name) {
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

function inferLanguage(library, category, family) {
  const text = `${library} ${category} ${family}`;
  if (/[\u3400-\u9fff]/.test(family)) return "chinese";
  if (/english|英文|latin|sans|serif|script|font|display|mono|brush|signature/i.test(text)) {
    return "english";
  }
  if (/中文|汉字|黑体|宋体|楷体|圆体/.test(`${library} ${category}`)) return "chinese";
  if (/[a-z]/i.test(family)) return "english";
  return /[\u3400-\u9fff]/.test(text) ? "chinese" : "english";
}

function toCssFormat(extension) {
  const formats = {
    ".otf": "opentype",
    ".ttf": "truetype",
    ".ttc": "truetype",
    ".woff": "woff",
    ".woff2": "woff2"
  };
  return formats[extension] || "truetype";
}

function toViteFsUrl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return `/local-font?path=${encodeURIComponent(normalized)}`;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function createId(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(36)}`;
}

await walk(root);

records.sort((a, b) => {
  const library = a.sourceLibrary.localeCompare(b.sourceLibrary, "zh-Hans-CN");
  if (library !== 0) return library;
  const category = a.category.localeCompare(b.category, "zh-Hans-CN");
  if (category !== 0) return category;
  return a.family.localeCompare(b.family, "zh-Hans-CN");
});

const index = {
  generatedAt: new Date().toISOString(),
  root,
  totalFonts: records.length,
  fonts: records
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Indexed ${records.length} font files from ${root}`);
console.log(`Wrote ${outputPath}`);
