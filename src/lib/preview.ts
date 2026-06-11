import { t } from "./i18n";
import type { FontAsset } from "../types";

export type FontAxisValues = Record<string, number>;

export function resolveFontPreviewText(font: FontAsset, customText: string) {
  const trimmed = customText.trim();
  if (trimmed) return trimmed;
  return font.sampleText || getLanguageSample(font);
}

export function getLanguageSample(font: FontAsset) {
  if (font.language === "english") return t.defaultSampleEn;
  if (font.language === "mixed") return `${t.defaultPreview} / ${t.defaultSampleEn}`;
  return t.defaultPreview;
}

export function getFontVariationSettings(font: FontAsset, values?: FontAxisValues) {
  if (!font.variableAxes?.length) return undefined;

  return font.variableAxes
    .map((axis) => {
      const value = values?.[axis.tag] ?? axis.value;
      const clampedValue = Math.min(axis.max, Math.max(axis.min, value));
      return `"${axis.tag}" ${clampedValue}`;
    })
    .join(", ");
}
