import { t } from "./i18n";
import type { FontAsset, FontLanguage, FontSource, FontVariant } from "../types";

export type LocalFontRecord = {
  id: string;
  family: string;
  styleName: string;
  category: string;
  sourceLibrary: string;
  language: "chinese" | "english";
  path: string;
  relativePath: string;
  libraryRoot?: string;
  extension: string;
  size: number;
  sizeLabel: string;
  fontUrl?: string;
  fontFormat: string;
  weight: number;
  addedAt: string;
};

export type LocalFontIndex = {
  generatedAt: string;
  root: string;
  totalFonts: number;
  fonts: LocalFontRecord[];
};

const fontExtensions = new Set(["ttf", "otf", "ttc", "woff", "woff2"]);
const previewableExtensions = new Set(["ttf", "otf", "woff", "woff2"]);
const previewOrder = ["ttf", "otf", "woff2", "woff", "ttc"];

export function localRecordsToAssets(
  index: LocalFontIndex,
  options: { source?: FontSource } = {}
): FontAsset[] {
  const groups = new Map<
    string,
    {
      records: LocalFontRecord[];
      family: string;
      category: string;
      sourceLibrary: string;
      libraryRoot: string;
      language: FontLanguage;
    }
  >();

  for (const record of index.fonts) {
    const category = normalizeCategory(record);
    const libraryRoot = record.libraryRoot || index.root;
    const key = [libraryRoot, record.sourceLibrary, category, normalizeKey(record.family)].join("|");
    const existing = groups.get(key);

    if (existing) {
      existing.records.push(record);
      continue;
    }

    groups.set(key, {
      records: [record],
      family: record.family,
      category,
      sourceLibrary: record.sourceLibrary,
      libraryRoot,
      language: record.language
    });
  }

  return Array.from(groups.values())
    .map((group, position) => groupToAsset(group, position, options.source ?? "local"))
    .sort((a, b) => {
      if (a.canPreview !== b.canPreview) return a.canPreview ? -1 : 1;
      const language = a.language.localeCompare(b.language);
      if (language !== 0) return language;
      const category = a.category.localeCompare(b.category, "zh-Hans-CN");
      if (category !== 0) return category;
      return a.family.localeCompare(b.family, "zh-Hans-CN");
    });
}

export async function loadLocalFontIndex(): Promise<LocalFontIndex | undefined> {
  const response = await fetch("/font-index.json", { cache: "no-store" });
  if (!response.ok) return undefined;
  return (await response.json()) as LocalFontIndex;
}

export function countImportableFontFiles(files: File[]): number {
  return files.filter(isImportableFontFile).length;
}

export function filesToLocalFontIndex(files: File[], rootLabel: string): LocalFontIndex {
  const now = new Date().toISOString();
  const records = files
    .filter(isImportableFontFile)
    .map((file, index) => {
      const extension = getFileExtension(file.name);
      const relativePath = getFileRelativePath(file);
      const parts = relativePath.split("/");
      const category = parts.length > 2 ? parts[1] : t.local;
      const folderName = parts.length > 2 ? parts[parts.length - 2] : "";
      const baseName = removeExtension(file.name);

      return {
        id: `import-${Date.now().toString(36)}-${index.toString(36)}`,
        family: cleanFamilyName(folderName, baseName),
        styleName: inferStyleName(baseName),
        category,
        sourceLibrary: parts[0] || rootLabel,
        language: inferLanguage(parts[0] || rootLabel, category, baseName),
        path: relativePath,
        relativePath,
        libraryRoot: rootLabel,
        extension,
        size: file.size,
        sizeLabel: formatSize(file.size),
        fontUrl: previewableExtensions.has(extension) ? URL.createObjectURL(file) : undefined,
        fontFormat: toCssFormat(extension),
        weight: inferWeight(baseName),
        addedAt: now.slice(0, 10)
      } satisfies LocalFontRecord;
    });

  return {
    generatedAt: now,
    root: rootLabel,
    totalFonts: records.length,
    fonts: records
  };
}

function isImportableFontFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  const relativePath = getFileRelativePath(file);

  return (
    fontExtensions.has(extension) &&
    !file.name.startsWith("._") &&
    !relativePath.includes("__MACOSX/")
  );
}

export function isVariableFontVariant(variant: FontVariant) {
  return /variable|\[[^\]]+\]/i.test(
    `${variant.styleName} ${variant.path ?? ""} ${variant.relativePath ?? ""}`
  );
}

export function getDefaultPreviewVariant(font: FontAsset): FontVariant {
  const previewableVariants = font.variants.filter((variant) => variant.isPreviewable);
  const candidates = previewableVariants.length > 0 ? previewableVariants : font.variants;
  const variableVariant =
    candidates.find((variant) => isVariableFontVariant(variant) && !variant.isItalic) ??
    candidates.find(isVariableFontVariant);

  if (variableVariant) return variableVariant;

  return (
    [...candidates].sort((left, right) => {
      const weightDistance = Math.abs(left.weight - 500) - Math.abs(right.weight - 500);
      if (weightDistance !== 0) return weightDistance;
      if (left.isItalic !== right.isItalic) return left.isItalic ? 1 : -1;
      return left.styleName.localeCompare(right.styleName);
    })[0] ?? font.variants[0]
  );
}

export function getActiveVariant(font: FontAsset, variantId?: string): FontVariant {
  return font.variants.find((variant) => variant.id === variantId) ?? getDefaultPreviewVariant(font);
}

export function activateFontVariant(font: FontAsset, variantId: string): FontAsset {
  const variant = font.variants.find((item) => item.id === variantId);
  if (!variant) return font;

  return {
    ...font,
    activeVariantId: variant.id,
    fontUrl: variant.fontUrl,
    fontFormat: variant.fontFormat,
    path: variant.path,
    sizeLabel: variant.sizeLabel
  };
}

function groupToAsset(
  group: {
    records: LocalFontRecord[];
    family: string;
    category: string;
    sourceLibrary: string;
    libraryRoot: string;
    language: FontLanguage;
  },
  _position: number,
  source: FontSource
): FontAsset {
  const variants = group.records.map(recordToVariant).sort(sortVariants);
  const activeVariant = variants.find((variant) => variant.isPreviewable) ?? variants[0];
  const weights = uniqueSorted(variants.map((variant) => variant.weight));
  const formats = uniqueSorted(variants.map((variant) => variant.format));
  const totalSize = variants.reduce((sum, variant) => sum + variant.size, 0);
  const familyKey = [group.libraryRoot, group.sourceLibrary, group.category, group.family].join("|");
  const previewFamily = `YFonts Family ${createId(familyKey)}`;
  const canPreview = variants.some((variant) => variant.isPreviewable);
  const variableAxes = inferVariableAxes(variants);

  return {
    id: `family-${createId([group.libraryRoot, group.sourceLibrary, group.category, group.family].join("|"))}`,
    family: group.family,
    styleName: summarizeVariants(variants, weights),
    category: group.category,
    moodTags: inferMoodTags(group, variants, canPreview),
    source,
    language: group.language,
    license: "free-commercial",
    licenseLabel: t.localCommercial,
    status: "indexed",
    formats,
    path: activeVariant?.path,
    libraryRoot: group.libraryRoot,
    sizeLabel: formatSize(totalSize),
    languageSupport:
      group.language === "chinese" ? [t.chinese, t.english, t.number] : [t.english, t.number],
    sampleText: getSampleText(group.language, group.category),
    cssFamily: `"${previewFamily}", ${
      group.language === "chinese"
        ? "'Microsoft YaHei', 'PingFang SC', sans-serif"
        : "'Segoe UI', Arial, sans-serif"
    }`,
    previewFamily,
    fontUrl: activeVariant?.fontUrl,
    fontFormat: activeVariant?.fontFormat,
    weights,
    activeVariantId: activeVariant?.id,
    variants,
    totalFiles: variants.length,
    canPreview,
    variableAxes,
    foundry: group.sourceLibrary,
    addedAt: group.records[0]?.addedAt ?? new Date().toISOString().slice(0, 10),
    isFavorite: false
  };
}

function inferVariableAxes(variants: FontVariant[]): FontAsset["variableAxes"] {
  const variableVariants = variants.filter(isVariableFontVariant);
  if (variableVariants.length === 0) return undefined;

  const axisTags = new Set<string>();
  for (const variant of variableVariants) {
    const descriptor = `${variant.path ?? ""} ${variant.relativePath ?? ""}`;
    const match =
      descriptor.match(/\[([^\]]+)\]/) ??
      descriptor.match(/variablefont[_-]([a-z]{4}(?:,[a-z]{4})*)/i);
    match?.[1]
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => axisTags.add(tag.toLowerCase() === "grad" ? "GRAD" : tag.toLowerCase()));
  }
  if (axisTags.size === 0) axisTags.add("wght");

  const definitions: Record<
    string,
    { label: string; min: number; max: number; value: number }
  > = {
    wght: { label: t.weightsAndStyles, min: 100, max: 900, value: 500 },
    wdth: { label: "字宽", min: 75, max: 125, value: 100 },
    slnt: { label: "倾斜", min: -12, max: 0, value: 0 },
    ital: { label: "斜体", min: 0, max: 1, value: 0 },
    opsz: { label: "光学尺寸", min: 8, max: 144, value: 14 },
    GRAD: { label: "字阶", min: -200, max: 150, value: 0 }
  };

  return Array.from(axisTags)
    .map((tag) => {
      const definition = definitions[tag];
      return definition ? { tag, ...definition } : undefined;
    })
    .filter((axis): axis is NonNullable<typeof axis> => Boolean(axis));
}

function recordToVariant(record: LocalFontRecord): FontVariant {
  return {
    id: record.id,
    styleName: record.styleName,
    weight: record.weight,
    format: record.extension.toUpperCase(),
    extension: record.extension,
    size: record.size,
    sizeLabel: record.sizeLabel,
    path: record.path,
    relativePath: record.relativePath,
    libraryRoot: record.libraryRoot,
    fontUrl: record.fontUrl,
    fontFormat: record.fontFormat,
    isPreviewable: previewableExtensions.has(record.extension),
    isItalic: /italic|oblique/i.test(record.styleName)
  };
}

function sortVariants(a: FontVariant, b: FontVariant): number {
  if (a.isPreviewable !== b.isPreviewable) return a.isPreviewable ? -1 : 1;
  if (a.weight !== b.weight) return a.weight - b.weight;
  const format = previewOrder.indexOf(a.extension) - previewOrder.indexOf(b.extension);
  if (format !== 0) return format;
  return a.styleName.localeCompare(b.styleName);
}

function normalizeCategory(record: LocalFontRecord): string {
  const text = `${record.category} ${record.family} ${record.styleName}`;

  if (record.language === "english") {
    if (hasAny(text, ["\u65e0\u886c\u7ebf"])) return t.sans;
    if (hasAny(text, ["\u886c\u7ebf"])) return t.serif;
    if (hasAny(text, ["\u624b\u5199"]) || /script|signature|brush/i.test(text)) {
      return t.handwriting;
    }
    if (hasAny(text, ["\u5706\u4f53"]) || /rounded|round/i.test(text)) return t.round;
    if (hasAny(text, ["\u5361\u901a"]) || /cartoon|comic|child|happy/i.test(text)) {
      return t.cartoon;
    }
    if (hasAny(text, ["\u827a\u672f"]) || /display|decorative|poster/i.test(text)) return t.art;
    return t.enOther;
  }

  if (
    hasAny(text, [
      "\u9ed1",
      "Sans",
      "\u666e\u60e0",
      "\u5065\u5eb7\u4f53",
      "\u6570\u9ed1",
      "\u9e3f\u8499",
      "OPPO",
      "vivo",
      "\u8363\u8000",
      "\u9489\u9489",
      "\u6296\u97f3",
      "\u65e0\u754c",
      "\u6807\u9898"
    ])
  ) {
    return t.sansCn;
  }
  if (hasAny(text, ["\u5b8b", "\u660e\u671d", "Serif"])) return t.song;
  if (hasAny(text, ["\u6977", "\u6977\u66f8", "\u5927\u6977"])) return t.kai;
  if (hasAny(text, ["\u5706", "\u65b9\u5706", "\u9ea6\u5706"])) return t.round;
  if (hasAny(text, ["\u96b6"])) return t.lishu;
  if (hasAny(text, ["\u7bc6"])) return t.seal;
  if (
    hasAny(text, [
      "\u624b\u5199",
      "\u4e66\u4f53",
      "\u98de\u626c",
      "\u8f7b\u677e",
      "\u7ae5",
      "\u840c",
      "\u767d\u65e0\u5e38",
      "\u6d82\u9e26"
    ])
  ) {
    return t.handwriting;
  }
  if (hasAny(text, ["\u590d\u53e4", "\u5eb7\u7199", "\u5b57\u5178", "\u65e7", "\u6469\u767b"])) {
    return t.retro;
  }
  if (hasAny(text, ["\u521b\u610f", "\u539a\u5e95", "Smiley", "\u827a\u672f"])) {
    return t.creative;
  }
  if (hasAny(text, ["\u7ebf"])) return t.line;
  return t.cnOther;
}

function inferMoodTags(
  group: { records: LocalFontRecord[]; language: FontLanguage },
  variants: FontVariant[],
  canPreview: boolean
): string[] {
  const tags = new Set<string>();
  tags.add(group.language === "chinese" ? t.chinese : t.english);
  tags.add(canPreview ? t.previewable : t.desktopOnly);
  tags.add(cleanFolderTag(group.records[0]?.category ?? ""));

  for (const format of uniqueSorted(variants.map((variant) => variant.format)).slice(0, 3)) {
    tags.add(format);
  }
  if (variants.some((variant) => variant.styleName.includes("Variable"))) tags.add(t.variableAxes);
  if (variants.some((variant) => variant.isItalic)) tags.add(t.italic);
  if (variants.some((variant) => variant.weight >= 700)) tags.add(t.title);
  if (variants.some((variant) => variant.weight <= 300)) tags.add(t.light);

  return Array.from(tags);
}

function getSampleText(language: FontLanguage, category: string): string {
  if (language === "english") {
    if (category === t.handwriting) return t.handwritingSampleEn;
    if (category === t.serif) return t.serifSampleEn;
    if (category === t.cartoon) return t.cartoonSampleEn;
    return t.defaultSampleEn;
  }

  if (category === t.kai) return t.kaiSample;
  if (category === t.song) return t.serifSample;
  if (category === t.retro) return t.retroSample;
  return t.defaultPreview;
}

function summarizeVariants(variants: FontVariant[], weights: number[]): string {
  if (variants.length === 1) return variants[0].styleName;
  return `${weights.length} ${t.weightCount} · ${variants.length} ${t.fileCount}`;
}

function cleanFamilyName(folderName: string, baseName: string): string {
  const folder = folderName
    .replace(/^\d+[-_\s]*/, "")
    .replace(/_猫啃网|_字库星球|字体安装包|webfonts|static|variable fonts?/gi, "")
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

function inferStyleName(name: string): string {
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

function inferWeight(name: string): number {
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

function inferLanguage(library: string, category: string, family: string): "chinese" | "english" {
  const familyText = family;
  const contextText = `${library} ${category}`;
  const text = `${contextText} ${familyText}`;

  if (/[\u3400-\u9fff]/.test(familyText)) return "chinese";
  if (/\u4f53|\u62fc\u97f3|\u9ed1|\u5b8b|\u6977|\u5706|\u96b6|\u7bc6|\u65b9\u6b63|\u6c49\u4eea|\u963f\u91cc|\u6296\u97f3|\u9489\u9489|\u5b57\u5e93/.test(familyText)) {
    return "chinese";
  }
  if (/english|\u82f1\u6587|latin/i.test(contextText)) {
    return "english";
  }
  if (/\u4e2d\u6587|\u6c49\u5b57|\u9ed1\u4f53|\u5b8b\u4f53|\u6977\u4f53|\u5706\u4f53/.test(contextText)) {
    return "chinese";
  }
  if (/sans|serif|script|font|display|mono|brush|signature/i.test(text)) return "english";
  if (/[a-z]/i.test(familyText)) return "english";
  return /[\u3400-\u9fff]/.test(text) ? "chinese" : "english";
}

function toCssFormat(extension: string): string {
  const formats: Record<string, string> = {
    otf: "opentype",
    ttf: "truetype",
    ttc: "truetype",
    woff: "woff",
    woff2: "woff2"
  };
  return formats[extension] || "truetype";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function createId(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text: string, tokens: string[]): boolean {
  const lowerText = text.toLowerCase();
  return tokens.some((token) => lowerText.includes(token.toLowerCase()));
}

function cleanFolderTag(category: string): string {
  return (
    category
      .replace(/\u5b57\u4f53\u7cfb\u5217|\u7cfb\u5217\u5b57\u4f53|\u5b57\u4f53/g, "")
      .trim() || t.local
  );
}

function uniqueSorted<T extends string | number>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  });
}

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getFileRelativePath(file: File): string {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(
    /\\/g,
    "/"
  );
}

function removeExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}
