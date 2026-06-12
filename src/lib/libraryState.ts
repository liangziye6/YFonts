import type { FontAsset, LicenseKind, ProjectPack } from "../types";
import { invokeTauri, isTauriRuntime } from "./tauri";

const stateVersion = 1;
const keyPrefix = "yfonts:library-state:";
const folderRootsKey = "yfonts:folder-roots";
const folderRootsFileName = "folder-roots.json";
const sourceRootMappingsKey = "yfonts:source-root-mappings";
const sourceRootMappingsFileName = "source-root-mappings.json";

export type StoredLibraryState = {
  version: number;
  updatedAt: string;
  favoriteFontIds: string[];
  hiddenFontIds: string[];
  removedFontIds: string[];
  recentFontIds: string[];
  activeVariantIds: Record<string, string>;
  fontOverrides: Record<string, FontMetadataOverride>;
  installedFontFiles: Record<string, string[]>;
  categoryLabels: string[];
  previewSize: number;
  projectPacks: ProjectPack[];
};

export type FontMetadataOverride = {
  category?: string;
  license?: LicenseKind;
  licenseLabel?: string;
};

export const sampleLibraryKey = "sample";

export function getLibraryStateKey(root?: string) {
  return root?.trim() ? createHash(root.trim().toLowerCase()) : sampleLibraryKey;
}

export function loadLibraryState(libraryKey: string): StoredLibraryState | undefined {
  try {
    const raw = window.localStorage.getItem(`${keyPrefix}${libraryKey}`);
    if (!raw) return undefined;

    return parseLibraryState(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function saveLibraryState(libraryKey: string, state: Omit<StoredLibraryState, "version" | "updatedAt">) {
  const nextState = createStoredLibraryState(state);

  window.localStorage.setItem(`${keyPrefix}${libraryKey}`, JSON.stringify(nextState));
}

export async function loadLibraryStateAsync(libraryKey: string): Promise<StoredLibraryState | undefined> {
  const desktopState = await readAppDataJson<StoredLibraryState>(libraryStateFileName(libraryKey));
  if (desktopState) return parseLibraryState(desktopState);

  return loadLibraryState(libraryKey);
}

export async function saveLibraryStateAsync(
  libraryKey: string,
  state: Omit<StoredLibraryState, "version" | "updatedAt">
) {
  const nextState = createStoredLibraryState(state);

  try {
    window.localStorage.setItem(`${keyPrefix}${libraryKey}`, JSON.stringify(nextState));
  } catch {
    // Desktop persistence below is the source of truth in the packaged app.
  }

  await writeAppDataJson(libraryStateFileName(libraryKey), nextState);
}

export function applyLibraryState(fonts: FontAsset[], state?: StoredLibraryState) {
  if (!state) return fonts;

  const favoriteFontIds = new Set(state.favoriteFontIds);
  return fonts.map((font) => ({
    ...font,
    ...state.fontOverrides[font.id],
    status: state.installedFontFiles[font.id]?.length ? "installed" : font.status,
    isFavorite: favoriteFontIds.has(font.id)
  }));
}

export function loadSavedFolderRoots() {
  try {
    const raw = window.localStorage.getItem(folderRootsKey);
    if (!raw) return [];

    return parseSavedFolderRoots(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function loadSavedFolderRootsAsync() {
  const desktopRoots = await readAppDataJson<unknown>(folderRootsFileName);
  const parsedDesktopRoots = parseSavedFolderRoots(desktopRoots);

  if (parsedDesktopRoots.length > 0) return parsedDesktopRoots;
  return loadSavedFolderRoots();
}

export function saveFolderRoot(root: string) {
  const normalizedRoot = normalizeRootLabel(root);
  if (!normalizedRoot) return;

  const roots = [normalizedRoot, ...loadSavedFolderRoots().filter((item) => item !== normalizedRoot)];
  window.localStorage.setItem(folderRootsKey, JSON.stringify(roots));
}

export async function saveFolderRootAsync(root: string) {
  const normalizedRoot = normalizeRootLabel(root);
  if (!normalizedRoot) return;

  const roots = [
    normalizedRoot,
    ...(await loadSavedFolderRootsAsync()).filter((item) => item !== normalizedRoot)
  ];
  persistFolderRoots(roots);
  await writeAppDataJson(folderRootsFileName, roots);
}

export function removeSavedFolderRoot(root: string) {
  const normalizedRoot = normalizeRootLabel(root);
  if (!normalizedRoot) return;

  const roots = loadSavedFolderRoots().filter((item) => item !== normalizedRoot);
  window.localStorage.setItem(folderRootsKey, JSON.stringify(roots));
}

export async function removeSavedFolderRootAsync(root: string) {
  const normalizedRoot = normalizeRootLabel(root);
  if (!normalizedRoot) return;

  const roots = (await loadSavedFolderRootsAsync()).filter((item) => item !== normalizedRoot);
  persistFolderRoots(roots);
  await writeAppDataJson(folderRootsFileName, roots);
}

export async function loadSourceRootMappingsAsync() {
  const desktopMappings = await readAppDataJson<unknown>(sourceRootMappingsFileName);
  const parsedDesktopMappings = parseSourceRootMappings(desktopMappings);

  if (Object.keys(parsedDesktopMappings).length > 0) return parsedDesktopMappings;

  try {
    return parseSourceRootMappings(JSON.parse(window.localStorage.getItem(sourceRootMappingsKey) ?? "{}"));
  } catch {
    return {};
  }
}

export async function saveSourceRootMappingAsync(sourceKey: string, root: string) {
  const normalizedKey = normalizeSourceKey(sourceKey);
  const normalizedRoot = normalizeRootLabel(root);
  if (!normalizedKey || !normalizedRoot) return;

  const mappings = {
    ...(await loadSourceRootMappingsAsync()),
    [normalizedKey]: normalizedRoot
  };

  try {
    window.localStorage.setItem(sourceRootMappingsKey, JSON.stringify(mappings));
  } catch {
    // The desktop app also persists mappings to its app data directory.
  }

  await writeAppDataJson(sourceRootMappingsFileName, mappings);
}

export function filterExistingFontIds(ids: string[], fonts: FontAsset[]) {
  const fontIds = new Set(fonts.map((font) => font.id));
  return ids.filter((id) => fontIds.has(id));
}

export function filterExistingVariantIds(ids: Record<string, string>, fonts: FontAsset[]) {
  const nextIds: Record<string, string> = {};

  for (const font of fonts) {
    const variantId = ids[font.id];
    if (variantId && font.variants.some((variant) => variant.id === variantId)) {
      nextIds[font.id] = variantId;
    }
  }

  return nextIds;
}

export function filterExistingProjectPacks(packs: ProjectPack[], fonts: FontAsset[]) {
  const fontIds = new Set(fonts.map((font) => font.id));
  const packIds = new Set(packs.map((pack) => pack.id));

  return packs
    .map((pack) => ({
      ...pack,
      parentId: pack.parentId && packIds.has(pack.parentId) ? pack.parentId : undefined,
      fontIds: pack.fontIds.filter((fontId) => fontIds.has(fontId)).filter(uniqueValues)
    }))
    .filter((pack) => pack.name.trim().length > 0);
}

function createStoredLibraryState(state: Omit<StoredLibraryState, "version" | "updatedAt">) {
  return {
    ...state,
    version: stateVersion,
    updatedAt: new Date().toISOString()
  };
}

function parseLibraryState(value: unknown): StoredLibraryState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const parsed = value as Partial<StoredLibraryState>;
  if (parsed.version !== stateVersion) return undefined;

  return {
    version: stateVersion,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    favoriteFontIds: Array.isArray(parsed.favoriteFontIds) ? parsed.favoriteFontIds : [],
    hiddenFontIds: Array.isArray(parsed.hiddenFontIds) ? parsed.hiddenFontIds : [],
    removedFontIds: Array.isArray(parsed.removedFontIds) ? parsed.removedFontIds : [],
    recentFontIds: Array.isArray(parsed.recentFontIds) ? parsed.recentFontIds : [],
    activeVariantIds: isRecord(parsed.activeVariantIds) ? parsed.activeVariantIds : {},
    fontOverrides: parseFontOverrides(parsed.fontOverrides),
    installedFontFiles: parseInstalledFontFiles(parsed.installedFontFiles),
    categoryLabels: parseCategoryLabels(parsed.categoryLabels),
    previewSize: typeof parsed.previewSize === "number" ? parsed.previewSize : 64,
    projectPacks: parseProjectPacks(parsed.projectPacks)
  };
}

function parseCategoryLabels(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .filter(uniqueValues);
}

function parseInstalledFontFiles(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};

  const installedFiles: Record<string, string[]> = {};

  for (const [fontId, rawPaths] of Object.entries(value)) {
    if (!Array.isArray(rawPaths)) continue;

    const paths = rawPaths
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => path.trim())
      .filter(uniqueValues);

    if (paths.length > 0) installedFiles[fontId] = paths;
  }

  return installedFiles;
}

function parseSavedFolderRoots(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(normalizeRootLabel)
    .filter(uniqueValues);
}

function parseSourceRootMappings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const mappings: Record<string, string> = {};
  for (const [sourceKey, root] of Object.entries(value)) {
    if (typeof root !== "string") continue;

    const normalizedKey = normalizeSourceKey(sourceKey);
    const normalizedRoot = normalizeRootLabel(root);
    if (normalizedKey && normalizedRoot) mappings[normalizedKey] = normalizedRoot;
  }

  return mappings;
}

function persistFolderRoots(roots: string[]) {
  try {
    window.localStorage.setItem(folderRootsKey, JSON.stringify(roots));
  } catch {
    // The desktop app also writes folder roots to the app data directory.
  }
}

function libraryStateFileName(libraryKey: string) {
  return `library-state-${sanitizeAppDataFileSegment(libraryKey)}.json`;
}

function sanitizeAppDataFileSegment(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80);

  return cleaned || sampleLibraryKey;
}

async function readAppDataJson<T>(fileName: string): Promise<T | undefined> {
  if (!isTauriRuntime()) return undefined;

  try {
    const raw = await invokeTauri<string | null>("read_app_data_file", {
      fileName
    });
    if (!raw) return undefined;

    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeAppDataJson(fileName: string, value: unknown) {
  if (!isTauriRuntime()) return;

  await invokeTauri("write_app_data_file", {
    fileName,
    content: JSON.stringify(value, null, 2)
  });
}

function parseProjectPacks(value: unknown): ProjectPack[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Partial<ProjectPack> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id : createPackId(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      parentId: typeof item.parentId === "string" && item.parentId.trim() ? item.parentId : undefined,
      fontIds: Array.isArray(item.fontIds)
        ? item.fontIds.filter((fontId): fontId is string => typeof fontId === "string")
        : []
    }))
    .filter((item) => item.name.trim().length > 0);
}

function parseFontOverrides(value: unknown): Record<string, FontMetadataOverride> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const overrides: Record<string, FontMetadataOverride> = {};

  for (const [fontId, rawOverride] of Object.entries(value)) {
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) continue;
    const override = rawOverride as Partial<FontMetadataOverride>;
    const nextOverride: FontMetadataOverride = {};

    if (typeof override.category === "string" && override.category.trim()) {
      nextOverride.category = override.category.trim();
    }
    if (isLicenseKind(override.license)) {
      nextOverride.license = override.license;
    }
    if (typeof override.licenseLabel === "string" && override.licenseLabel.trim()) {
      nextOverride.licenseLabel = override.licenseLabel.trim();
    }

    if (Object.keys(nextOverride).length > 0) overrides[fontId] = nextOverride;
  }

  return overrides;
}

function isRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function isLicenseKind(value: unknown): value is LicenseKind {
  return (
    value === "ofl" ||
    value === "free-commercial" ||
    value === "apache" ||
    value === "cc0" ||
    value === "personal" ||
    value === "unknown"
  );
}

function normalizeRootLabel(value: string) {
  return value.trim().replace(/\\/g, "/");
}

function normalizeSourceKey(value: string) {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function uniqueValues(value: string, index: number, values: string[]) {
  return values.indexOf(value) === index;
}

function createPackId() {
  return `pack-${Date.now().toString(36)}`;
}

function createHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
