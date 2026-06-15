import { t } from "./i18n";
import type { FontAsset, FontLanguage, FontVariant } from "../types";

const googleCatalogUrl = "https://api.fontsource.org/v1/fonts?type=google";
const fontsourceCatalogUrl = "https://api.fontsource.org/v1/fonts?type=other";
const fontUrl = "https://api.fontsource.org/v1/fonts";
const cacheKey = "yfonts:fontsource-catalog:v2";
const cacheDuration = 24 * 60 * 60 * 1000;

type FontsourceSummary = {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  variable: boolean;
  lastModified: string;
  category: string;
  version: string;
  type: string;
};

type FontsourceDetail = FontsourceSummary & {
  variants?: Record<
    string,
    Record<string, Record<string, { url?: Record<string, string> }>>
  >;
};

type CachedCatalog = {
  cachedAt: number;
  fonts: FontsourceSummary[];
};

export async function loadFontsourceCatalog(options?: {
  allowStaleCache?: boolean;
}): Promise<FontAsset[]> {
  const cached = readCatalogCache(options?.allowStaleCache ?? false);
  const summaries =
    cached ??
    (
      await Promise.all([
        fetchJson<FontsourceSummary[]>(googleCatalogUrl),
        fetchJson<FontsourceSummary[]>(fontsourceCatalogUrl)
      ])
    ).flat();

  if (!cached) writeCatalogCache(summaries);
  return summaries.map(summaryToFontAsset).sort(sortCatalog);
}

export async function loadFontsourceDetails(font: FontAsset): Promise<FontAsset> {
  if (!font.remoteId || font.remoteDetailsLoaded) return font;

  const detail = await fetchJson<FontsourceDetail>(
    `${fontUrl}/${encodeURIComponent(font.remoteId)}`
  );
  const variants = detailToVariants(detail);
  if (variants.length === 0) return { ...font, remoteDetailsLoaded: true };

  const defaultVariant = pickDefaultVariant(variants);
  const weights = Array.from(new Set(variants.map((variant) => variant.weight))).sort(
    (left, right) => left - right
  );
  const formats = Array.from(new Set(variants.map((variant) => variant.format)));

  return {
    ...font,
    styleName: summarizeVariants(variants, weights),
    formats,
    path: defaultVariant.path,
    fontUrl: defaultVariant.fontUrl,
    fontFormat: defaultVariant.fontFormat,
    weights,
    activeVariantId: defaultVariant.id,
    variants,
    totalFiles: variants.length,
    remoteDetailsLoaded: true
  };
}

export function isOnlineFont(font?: FontAsset): boolean {
  return font?.source === "fontsource" || font?.source === "google-fonts";
}

function summaryToFontAsset(summary: FontsourceSummary): FontAsset {
  const isGoogleFont = summary.type === "google";
  const language = inferLanguage(summary.subsets);
  const category = mapCategory(summary.category);
  const weight = pickDefaultWeight(summary.weights);
  const style = summary.styles.includes("normal") ? "normal" : summary.styles[0] ?? "normal";
  const subset = pickPreviewSubset(summary.subsets, summary.defSubset);
  const variant = createVariant(summary.id, weight, style, subset);
  const totalFiles = Math.max(1, summary.weights.length * summary.styles.length);

  return {
    id: `${isGoogleFont ? "google-fonts" : "fontsource"}-${summary.id}`,
    family: summary.family,
    styleName:
      totalFiles > 1
        ? `${summary.weights.length} ${t.weightCount} · ${totalFiles} ${t.fileCount}`
        : formatStyleName(style),
    category,
    moodTags: [
      language === "chinese" ? t.chinese : t.english,
      summary.variable ? t.variableAxes : t.previewable,
      summary.category
    ],
    source: isGoogleFont ? "google-fonts" : "fontsource",
    language,
    license: "free-commercial",
    licenseLabel: "开源可商用",
    status: "indexed",
    formats: ["TTF"],
    path: variant.path,
    sizeLabel: "在线",
    languageSupport:
      language === "chinese" ? [t.chinese, t.english, t.number] : [t.english, t.number],
    sampleText: language === "chinese" ? t.defaultPreview : t.defaultSampleEn,
    cssFamily: `"YFonts Online ${createId(summary.id)}", ${
      language === "chinese"
        ? "'Microsoft YaHei', 'PingFang SC', sans-serif"
        : "'Segoe UI', Arial, sans-serif"
    }`,
    previewFamily: `YFonts Online ${createId(summary.id)}`,
    fontUrl: variant.fontUrl,
    fontFormat: variant.fontFormat,
    weights: summary.weights.length > 0 ? summary.weights : [weight],
    activeVariantId: variant.id,
    variants: [variant],
    totalFiles,
    canPreview: true,
    licenseUrl: isGoogleFont
      ? `https://fonts.google.com/specimen/${encodeURIComponent(summary.family).replace(/%20/g, "+")}`
      : `https://fontsource.org/fonts/${summary.id}`,
    remoteId: summary.id,
    remoteDetailsLoaded: false,
    foundry: isGoogleFont ? "Google Fonts · Fontsource CDN" : "Fontsource",
    addedAt: summary.lastModified,
    isFavorite: false
  };
}

function detailToVariants(detail: FontsourceDetail): FontVariant[] {
  const variants: FontVariant[] = [];
  const subset = pickPreviewSubset(detail.subsets, detail.defSubset);

  for (const [weightKey, styles] of Object.entries(detail.variants ?? {})) {
    const weight = Number(weightKey);
    if (!Number.isFinite(weight)) continue;

    for (const [style, subsets] of Object.entries(styles ?? {})) {
      const subsetRecord =
        subsets[subset] ??
        subsets[detail.defSubset] ??
        subsets.latin ??
        Object.values(subsets)[0];
      const urls = subsetRecord?.url;
      if (!urls) continue;

      const previewUrl = urls.woff2 ?? urls.woff ?? urls.ttf;
      const downloadUrl = urls.ttf ?? urls.woff2 ?? urls.woff;
      if (!previewUrl || !downloadUrl) continue;

      const extension = getUrlExtension(downloadUrl);
      variants.push({
        id: `fontsource-${detail.id}-${weight}-${style}-${subset}`,
        styleName: formatStyleName(style),
        weight,
        format: extension.toUpperCase(),
        extension,
        size: 0,
        sizeLabel: "在线",
        path: downloadUrl,
        relativePath: `${detail.family}-${weight}-${style}.${extension}`,
        fontUrl: previewUrl,
        downloadUrl,
        fontFormat: toCssFormat(getUrlExtension(previewUrl)),
        isPreviewable: true,
        isItalic: style === "italic" || style === "oblique"
      });
    }
  }

  return variants.sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return Number(left.isItalic) - Number(right.isItalic);
  });
}

function createVariant(
  id: string,
  weight: number,
  style: string,
  subset: string
): FontVariant {
  const baseUrl = `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${subset}-${weight}-${style}`;
  const previewUrl = `${baseUrl}.woff2`;
  const downloadUrl = `${baseUrl}.ttf`;

  return {
    id: `fontsource-${id}-${weight}-${style}-${subset}`,
    styleName: formatStyleName(style),
    weight,
    format: "TTF",
    extension: "ttf",
    size: 0,
    sizeLabel: "在线",
    path: downloadUrl,
    relativePath: `${id}-${weight}-${style}.ttf`,
    fontUrl: previewUrl,
    downloadUrl,
    fontFormat: "woff2",
    isPreviewable: true,
    isItalic: style === "italic" || style === "oblique"
  };
}

function pickDefaultVariant(variants: FontVariant[]): FontVariant {
  return [...variants].sort((left, right) => {
    const weightDistance = Math.abs(left.weight - 500) - Math.abs(right.weight - 500);
    if (weightDistance !== 0) return weightDistance;
    return Number(left.isItalic) - Number(right.isItalic);
  })[0];
}

function pickDefaultWeight(weights: number[]): number {
  return (
    [...weights].sort(
      (left, right) => Math.abs(left - 500) - Math.abs(right - 500)
    )[0] ?? 400
  );
}

function pickPreviewSubset(subsets: string[], defaultSubset: string): string {
  return (
    [
      "chinese-simplified",
      "chinese-traditional",
      "chinese-hongkong",
      defaultSubset,
      "latin",
      ...subsets
    ].find((subset) => subset && subsets.includes(subset)) ??
    defaultSubset ??
    "latin"
  );
}

function inferLanguage(subsets: string[]): FontLanguage {
  return subsets.some(
    (subset) => subset.startsWith("chinese") || subset === "cjk" || subset === "korean"
  )
    ? "chinese"
    : "english";
}

function mapCategory(category: string): string {
  if (category === "serif") return t.serif;
  if (category === "sans-serif") return t.sans;
  if (category === "monospace") return t.line;
  if (category === "handwriting") return t.handwriting;
  if (category === "display") return t.art;
  return t.enOther;
}

function formatStyleName(style: string): string {
  if (style === "normal") return "Regular";
  return `${style.slice(0, 1).toUpperCase()}${style.slice(1)}`;
}

function summarizeVariants(variants: FontVariant[], weights: number[]): string {
  if (variants.length === 1) return variants[0].styleName;
  return `${weights.length} ${t.weightCount} · ${variants.length} ${t.fileCount}`;
}

function getUrlExtension(url: string): string {
  return url.split("?")[0].split(".").pop()?.toLowerCase() || "ttf";
}

function toCssFormat(extension: string): string {
  if (extension === "woff2") return "woff2";
  if (extension === "woff") return "woff";
  if (extension === "otf") return "opentype";
  return "truetype";
}

function sortCatalog(left: FontAsset, right: FontAsset): number {
  const language = left.language.localeCompare(right.language);
  if (language !== 0) return language;
  return left.family.localeCompare(right.family, "en");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Fontsource ${response.status}`);
  }
  return (await response.json()) as T;
}

function readCatalogCache(allowStaleCache: boolean): FontsourceSummary[] | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedCatalog;
    if (
      !Array.isArray(cached.fonts) ||
      typeof cached.cachedAt !== "number" ||
      (!allowStaleCache && Date.now() - cached.cachedAt > cacheDuration)
    ) {
      return undefined;
    }
    return cached.fonts;
  } catch {
    return undefined;
  }
}

function writeCatalogCache(fonts: FontsourceSummary[]) {
  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({ cachedAt: Date.now(), fonts } satisfies CachedCatalog)
    );
  } catch {
    // The catalog can be fetched again when browser storage is unavailable.
  }
}

function createId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
