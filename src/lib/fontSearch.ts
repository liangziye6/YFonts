import type { FontAsset } from "../types";

export function getFontSearchScore(font: FontAsset, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const family = normalizeSearchText(font.family);
  const familyTokens = tokenizeSearchText(font.family);
  const foundry = normalizeSearchText(font.foundry);
  const fileNames = font.variants.flatMap((variant) =>
    getSearchFileNames(variant.path, variant.relativePath)
  );
  const fileTokens = fileNames.flatMap(tokenizeSearchText);

  if (family === normalizedQuery) return 1000;
  if (family.startsWith(normalizedQuery)) return 950;
  if (fileNames.some((name) => name.startsWith(normalizedQuery))) return 850;
  if (normalizedQuery.length === 1) return -1;

  if (familyTokens.some((token) => token.startsWith(normalizedQuery))) return 900;
  if (fileTokens.some((token) => token.startsWith(normalizedQuery))) return 825;
  if (tokenizeSearchText(font.foundry).some((token) => token.startsWith(normalizedQuery))) {
    return 800;
  }
  if (family.includes(normalizedQuery)) return 750;
  if (fileNames.some((name) => name.includes(normalizedQuery))) return 700;
  if (foundry.includes(normalizedQuery)) return 650;

  const metadata = normalizeSearchText(
    [
      font.styleName,
      font.category,
      ...font.moodTags,
      ...font.variants.map((variant) => `${variant.styleName} ${variant.format} ${variant.weight}`)
    ].join(" ")
  );

  return metadata.includes(normalizedQuery) ? 500 : -1;
}

function getSearchFileNames(...paths: Array<string | undefined>) {
  return paths
    .filter((path): path is string => Boolean(path))
    .map((path) => normalizeSearchText(path.split(/[\\/]/).filter(Boolean).pop() ?? ""));
}

function tokenizeSearchText(value: string) {
  const normalized = normalizeSearchText(value);
  return Array.from(
    new Set([normalized, ...normalized.split(/[\s._\-()[\]{}]+/).filter(Boolean)])
  );
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
