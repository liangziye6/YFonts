import {
  CheckCircle2,
  Download,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Info,
  Pause,
  Play,
  PackageMinus,
  RotateCcw,
  ShieldCheck,
  Type,
  XCircle
} from "lucide-react";
import { t } from "../lib/i18n";
import { getLicenseMetadataLabel, licenseMetadataOptions } from "../lib/fontMetadata";
import { getActiveVariant, isVariableFontVariant } from "../lib/localFontIndex";
import { getSourceLabel } from "../lib/platform";
import {
  getFontVariationSettings,
  resolveFontPreviewText,
  type FontAxisValues
} from "../lib/preview";
import type { FontMetadataOverride } from "../lib/libraryState";
import type { PlatformProfile } from "../lib/platform";
import type { FontAsset, LicenseKind } from "../types";

type DetailsPanelProps = {
  font?: FontAsset;
  platform: PlatformProfile;
  previewText: string;
  activeVariantId?: string;
  detailFontFamily?: string;
  availableCategories: string[];
  isAutoPlayingVariants: boolean;
  canAutoPlayVariants: boolean;
  axisValues?: FontAxisValues;
  isHidden: boolean;
  isRemoved: boolean;
  isDesktopRuntime: boolean;
  isInstalledByYFonts: boolean;
  systemFontStatus?: "checking" | "installed" | "not-installed" | "unavailable";
  isSystemFontBusy: boolean;
  onSelectVariant: (fontId: string, variantId: string) => void;
  onToggleAutoPlayVariants: () => void;
  onAxisValueChange: (fontId: string, axisTag: string, value: number) => void;
  onHideFont: (fontId: string) => void;
  onRestoreFont: (fontId: string) => void;
  onRemoveFromLibrary: (fontId: string) => void;
  onRestoreToLibrary: (fontId: string) => void;
  onUpdateFontMetadata: (fontId: string, patch: FontMetadataOverride) => void;
  onAddToCurrentProjectPack: (fontId: string) => void;
  onInstallFont: (fontId: string) => void;
  onUninstallFont: (fontId: string) => void;
  onOpenLocation: (font: FontAsset) => void;
  onOpenLicense: (font: FontAsset) => void;
};

export function DetailsPanel({
  font,
  platform,
  previewText,
  activeVariantId,
  detailFontFamily,
  availableCategories,
  isAutoPlayingVariants,
  canAutoPlayVariants,
  axisValues,
  isHidden,
  isRemoved,
  isDesktopRuntime,
  isInstalledByYFonts,
  systemFontStatus,
  isSystemFontBusy,
  onSelectVariant,
  onToggleAutoPlayVariants,
  onAxisValueChange,
  onHideFont,
  onRestoreFont,
  onRemoveFromLibrary,
  onRestoreToLibrary,
  onUpdateFontMetadata,
  onAddToCurrentProjectPack,
  onInstallFont,
  onUninstallFont,
  onOpenLocation,
  onOpenLicense
}: DetailsPanelProps) {
  if (!font) {
    return (
      <aside className="details-panel">
        <div className="empty-state compact">
          <strong>{t.chooseFont}</strong>
          <span>{t.detailsHere}</span>
        </div>
      </aside>
    );
  }

  const activeVariant = getActiveVariant(font, activeVariantId);
  const isSafeLicense = ["ofl", "free-commercial", "apache", "cc0"].includes(font.license);
  const specimen = resolveFontPreviewText(font, previewText);
  const AutoPlayIcon = isAutoPlayingVariants ? Pause : Play;
  const categoryOptions = Array.from(new Set([font.category, ...availableCategories])).filter(Boolean);
  const weightAxis = font.variableAxes?.find((axis) => axis.tag === "wght");
  const activeVariantIsVariable = isVariableFontVariant(activeVariant);
  const variationSettings = activeVariantIsVariable
    ? getFontVariationSettings(font, axisValues)
    : undefined;
  const variableWeight = activeVariantIsVariable
    ? axisValues?.wght ?? weightAxis?.value
    : undefined;
  const staticWeightVariants = getStaticWeightVariants(font, activeVariant.isItalic);
  const staticWeightIndex = Math.max(
    0,
    staticWeightVariants.findIndex((variant) => variant.weight === activeVariant.weight)
  );
  const weightPreviewValue = weightAxis
    ? axisValues?.wght ?? weightAxis.value
    : activeVariant.weight;
  const otherVariableAxes = font.variableAxes?.filter((axis) => axis.tag !== "wght") ?? [];

  return (
    <aside className="details-panel">
      <div className="details-header">
        <span className={isSafeLicense ? "status-dot good" : "status-dot warn"} />
        <div>
          <strong>{font.family}</strong>
          <span>
            {font.foundry} · {font.totalFiles} {t.fileCount}
          </span>
        </div>
      </div>

      <div className="specimen-block">
        <span>{t.applicationPreview}</span>
        <h2
          style={{
            fontFamily: detailFontFamily ?? font.cssFamily,
            fontWeight:
              variableWeight ??
              (activeVariant.weight || font.weights[font.weights.length - 1] || 700),
            fontStyle: activeVariant.isItalic ? "italic" : "normal",
            fontVariationSettings: variationSettings
          }}
        >
          {specimen}
        </h2>
        <p
          style={{
            fontFamily: detailFontFamily ?? font.cssFamily,
            fontWeight: variableWeight,
            fontVariationSettings: variationSettings
          }}
        >
          {t.specimenCopy}
        </p>
        {!font.canPreview && <em className="preview-note">{t.previewLimited}</em>}
      </div>

      <div className="meta-grid">
        <div>
          <span>{t.license}</span>
          <strong>{font.licenseLabel}</strong>
        </div>
        <div>
          <span>{t.source}</span>
          <strong>{getSourceLabel(font.source)}</strong>
        </div>
        <div>
          <span>{t.format}</span>
          <strong>{font.formats.join(" / ")}</strong>
        </div>
        <div>
          <span>{t.size}</span>
          <strong>{font.sizeLabel}</strong>
        </div>
      </div>

      <section className="detail-section">
        <h3>
          <CheckCircle2 size={16} />
          {t.fontMetadata}
        </h3>
        <div className="metadata-editor">
          <label>
            <span>{t.styleCategory}</span>
            <select
              value={font.category}
              onChange={(event) =>
                onUpdateFontMetadata(font.id, { category: event.target.value })
              }
            >
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.licenseMark}</span>
            <select
              value={font.license}
              onChange={(event) => {
                const license = event.target.value as LicenseKind;
                onUpdateFontMetadata(font.id, {
                  license,
                  licenseLabel: getLicenseMetadataLabel(license)
                });
              }}
            >
              {licenseMetadataOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!isRemoved && (
          <div className="metadata-action-row">
            <button
              className="command-button"
              type="button"
              onClick={() => onAddToCurrentProjectPack(font.id)}
            >
              <FolderPlus size={17} />
              {t.addToCurrentProjectPack}
            </button>
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-head">
          <h3>
            <Type size={16} />
            {t.weightsAndStyles}
          </h3>
          <button
            className={isAutoPlayingVariants ? "mini-tool active" : "mini-tool"}
            type="button"
            disabled={!canAutoPlayVariants}
            onClick={onToggleAutoPlayVariants}
            title={isAutoPlayingVariants ? t.pauseAutoPreview : t.playAutoPreview}
            aria-label={isAutoPlayingVariants ? t.pauseAutoPreview : t.playAutoPreview}
          >
            <AutoPlayIcon size={14} />
            <span>{isAutoPlayingVariants ? t.pause : t.play}</span>
          </button>
        </div>
        <div className="weight-preview-control">
          <div className="axis-row">
            <span>{t.weightPreview}</span>
            <input
              aria-label={t.weightPreview}
              type="range"
              min={weightAxis ? weightAxis.min : 0}
              max={weightAxis ? weightAxis.max : Math.max(0, staticWeightVariants.length - 1)}
              step={1}
              disabled={!weightAxis && staticWeightVariants.length < 2}
              value={weightAxis ? weightPreviewValue : staticWeightIndex}
              onInput={(event) => {
                const value = Number(event.currentTarget.value);
                if (weightAxis) {
                  onAxisValueChange(font.id, "wght", value);
                  return;
                }

                const variant = staticWeightVariants[value];
                if (variant) onSelectVariant(font.id, variant.id);
              }}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (weightAxis) {
                  onAxisValueChange(font.id, "wght", value);
                  return;
                }

                const variant = staticWeightVariants[value];
                if (variant) onSelectVariant(font.id, variant.id);
              }}
            />
            <em>{weightPreviewValue}</em>
          </div>
        </div>
        <div className="variant-list">
          {font.variants.map((variant) => (
            <button
              key={variant.id}
              className={variant.id === activeVariant.id ? "variant-button active" : "variant-button"}
              type="button"
              onClick={() => onSelectVariant(font.id, variant.id)}
              title={variant.path}
            >
              <strong>{variant.weight}</strong>
              <span>{variant.styleName}</span>
              <em>{variant.format}</em>
            </button>
          ))}
        </div>
      </section>

      {otherVariableAxes.length > 0 && (
        <section className="detail-section">
          <h3>
            <Info size={16} />
            {t.variableAxes}
          </h3>
          {otherVariableAxes.map((axis) => (
            <div className="axis-row" key={axis.tag}>
              <span>{axis.label}</span>
              <input
                aria-label={`${axis.label} ${axis.tag}`}
                type="range"
                min={axis.min}
                max={axis.max}
                step={1}
                value={axisValues?.[axis.tag] ?? axis.value}
                onInput={(event) =>
                  onAxisValueChange(font.id, axis.tag, Number(event.currentTarget.value))
                }
                onChange={(event) =>
                  onAxisValueChange(font.id, axis.tag, Number(event.target.value))
                }
              />
              <em>{axisValues?.[axis.tag] ?? axis.value}</em>
            </div>
          ))}
        </section>
      )}

      <section className="detail-section">
        <h3>
          <FileText size={16} />
          {t.fontFiles}
        </h3>
        <div className="file-list">
          {font.variants.map((variant) => (
            <button
              key={variant.id}
              className={variant.id === activeVariant.id ? "file-item active" : "file-item"}
              type="button"
              onClick={() => onSelectVariant(font.id, variant.id)}
              title={variant.path ?? variant.relativePath}
            >
              <span>{variant.styleName}</span>
              <strong>
                {variant.weight} / {variant.format} / {variant.sizeLabel}
              </strong>
              <em>{variant.relativePath ?? variant.path}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>
          <ShieldCheck size={16} />
          {t.language}
        </h3>
        <div className="tag-wrap">
          {font.languageSupport.map((language) => (
            <span key={language}>{language}</span>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>
          <CheckCircle2 size={16} />
          {t.crossPlatformPath}
        </h3>
        <p className="detail-note">{activeVariant.path ?? font.path ?? platform.defaultFontDirs[0]}</p>
        <p className="detail-note">
          {t.defaultInstallTarget}: {platform.installTarget}
        </p>
      </section>

      <section className="detail-section">
        <h3>
          <Download size={16} />
          {t.systemFont}
        </h3>
        <div className="system-font-summary">
          <span
            className={
              isInstalledByYFonts || systemFontStatus === "installed"
                ? "system-font-state installed"
                : "system-font-state"
            }
          >
            <i />
            {isSystemFontBusy
              ? isInstalledByYFonts
                ? t.uninstallingFont
                : t.installingFont
              : isInstalledByYFonts
                ? t.installedByYFonts
                : systemFontStatus === "installed"
                  ? t.systemFontInstalled
                  : systemFontStatus === "not-installed"
                    ? t.systemFontNotInstalled
                    : systemFontStatus === "checking"
                      ? t.checkingSystemFont
                      : t.desktopInstallOnly}
          </span>
          {isDesktopRuntime && (isInstalledByYFonts || systemFontStatus === "not-installed") && (
            <button
              className={isInstalledByYFonts ? "mini-tool danger" : "mini-tool"}
              type="button"
              disabled={isSystemFontBusy}
              onClick={() =>
                isInstalledByYFonts ? onUninstallFont(font.id) : onInstallFont(font.id)
              }
              title={isInstalledByYFonts ? t.uninstallFont : t.fontInstallHint}
            >
              {isInstalledByYFonts ? <PackageMinus size={14} /> : <Download size={14} />}
              <span>{isInstalledByYFonts ? t.uninstallFont : t.installFont}</span>
            </button>
          )}
        </div>
      </section>

      <section className="detail-section">
        <h3>
          <Info size={16} />
          {t.managementActions}
        </h3>
        <div className="management-actions">
          {isRemoved ? (
            <button
              className="management-button"
              type="button"
              onClick={() => onRestoreToLibrary(font.id)}
            >
              <RotateCcw size={16} />
              {t.restoreToLibrary}
            </button>
          ) : (
            <>
              <button
                className="management-button"
                type="button"
                onClick={() => (isHidden ? onRestoreFont(font.id) : onHideFont(font.id))}
              >
                {isHidden ? <RotateCcw size={16} /> : <EyeOff size={16} />}
                {isHidden ? t.restoreFont : t.hideFont}
              </button>
              <button
                className="management-button danger"
                type="button"
                onClick={() => onRemoveFromLibrary(font.id)}
              >
                <XCircle size={16} />
                {t.removeFromLibrary}
              </button>
            </>
          )}
        </div>
        <p className="detail-note">{t.safeRemoveHint}</p>
      </section>

      <div className="detail-actions">
        <button className="command-button" type="button" onClick={() => onOpenLocation(font)}>
          <FolderOpen size={17} />
          {t.openLocation}
        </button>
        <button className="command-button ghost" type="button" onClick={() => onOpenLicense(font)}>
          <ExternalLink size={17} />
          {t.licenseSource}
        </button>
      </div>
    </aside>
  );
}

function getStaticWeightVariants(font: FontAsset, preferItalic: boolean) {
  const previewableVariants = font.variants.filter(
    (variant) => variant.isPreviewable && !isVariableFontVariant(variant)
  );
  const variantsByWeight = new Map<number, (typeof previewableVariants)[number]>();

  for (const variant of previewableVariants) {
    const current = variantsByWeight.get(variant.weight);
    if (
      !current ||
      (current.isItalic !== preferItalic && variant.isItalic === preferItalic) ||
      (current.isItalic && !variant.isItalic)
    ) {
      variantsByWeight.set(variant.weight, variant);
    }
  }

  return Array.from(variantsByWeight.values()).sort((left, right) => left.weight - right.weight);
}
