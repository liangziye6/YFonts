import {
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileUp,
  FolderOpen,
  HardDrive,
  Layers2,
  RefreshCcw,
  Rocket,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  appVersion,
  checkForAppUpdate,
  isNewerAppVersion,
  openExternalUrl,
  type AppRelease
} from "../lib/appUpdate";
import { t } from "../lib/i18n";
import type { LocalFontIndex } from "../lib/localFontIndex";
import type { PlatformProfile } from "../lib/platform";
import type { FontSource } from "../types";

export type LibrarySettingsStats = {
  families: number;
  files: number;
  visible: number;
  hidden: number;
  removed: number;
  favorites: number;
  previewable: number;
  desktopOnly: number;
  categories: number;
};

export type LibrarySourceSummary = {
  id: string;
  label: string;
  kindLabel: string;
  source: FontSource;
  root: string;
  families: number;
  files: number;
  previewable: number;
};

export type LibraryDuplicateFont = {
  id: string;
  family: string;
  styleName: string;
  sourceLabel: string;
  fileCount: number;
  isFavorite: boolean;
  canPreview: boolean;
};

export type LibraryDuplicateGroup = {
  id: string;
  label: string;
  count: number;
  files: number;
  fonts: LibraryDuplicateFont[];
};

type LibrarySettingsPanelProps = {
  open: boolean;
  localIndex?: LocalFontIndex;
  platform: PlatformProfile;
  stats: LibrarySettingsStats;
  sources: LibrarySourceSummary[];
  duplicateGroups: LibraryDuplicateGroup[];
  isImportingFolder: boolean;
  onClose: () => void;
  onImportFolder: () => void;
  onImportFiles: () => void;
  onReloadIndex: () => void;
  onCopyRoot: () => void;
  onFocusSource: (source: LibrarySourceSummary) => void;
  onRescanSource: (source: LibrarySourceSummary) => void;
  onRemoveSource: (source: LibrarySourceSummary) => void;
  onFocusDuplicate: (group: LibraryDuplicateGroup) => void;
  onHideDuplicateExtras: (group: LibraryDuplicateGroup) => void;
  onRemoveDuplicateExtras: (group: LibraryDuplicateGroup) => void;
  onRemoveAllDuplicateExtras: () => void;
};

type UpdateCheckState =
  | { status: "idle" | "checking" }
  | { status: "current" | "available" | "ahead"; release: AppRelease }
  | { status: "error" };

export function LibrarySettingsPanel({
  open,
  localIndex,
  platform,
  stats,
  sources,
  duplicateGroups,
  isImportingFolder,
  onClose,
  onImportFolder,
  onImportFiles,
  onReloadIndex,
  onCopyRoot,
  onFocusSource,
  onRescanSource,
  onRemoveSource,
  onFocusDuplicate,
  onHideDuplicateExtras,
  onRemoveDuplicateExtras,
  onRemoveAllDuplicateExtras
}: LibrarySettingsPanelProps) {
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ status: "idle" });

  useEffect(() => {
    if (!open) return;

    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeWithKeyboard);

    return () => {
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || updateCheck.status !== "idle") return;
    void runUpdateCheck(false);
  }, [open, updateCheck.status]);

  if (!open) return null;

  const hasLocalIndex = Boolean(localIndex);
  const root = localIndex?.root ?? t.previewLibrary;
  const generatedAt = localIndex ? formatDateTime(localIndex.generatedAt) : t.previewOnly;

  async function runUpdateCheck(force: boolean) {
    setUpdateCheck({ status: "checking" });
    try {
      const release = await checkForAppUpdate(force);
      setUpdateCheck({
        status: isNewerAppVersion(release.version)
          ? "available"
          : isNewerAppVersion(appVersion, release.version)
            ? "ahead"
            : "current",
        release
      });
    } catch {
      setUpdateCheck({ status: "error" });
    }
  }

  return (
    <div className="library-drawer-shell" role="dialog" aria-modal="true" aria-label={t.librarySettings}>
      <div className="library-drawer-scrim" onClick={onClose} />
      <aside className="library-drawer">
        <header className="library-drawer-head">
          <div>
            <span>
              <Settings2 size={16} />
              {t.librarySettings}
            </span>
            <strong>{t.librarySettingsTitle}</strong>
          </div>
          <button className="drawer-close-button" type="button" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </header>

        <section className="library-status-card">
          <div className="library-status-title">
            <span className={hasLocalIndex ? "status-dot good" : "status-dot warn"} />
            <div>
              <strong>{hasLocalIndex ? t.localIndexLoaded : t.previewIndexActive}</strong>
              <span>{generatedAt}</span>
            </div>
          </div>
          <p>{root}</p>
          <div className="library-action-row">
            <button
              className="command-button"
              type="button"
              disabled={isImportingFolder}
              onClick={onImportFolder}
            >
              <FolderOpen size={16} />
              {isImportingFolder ? t.importingFolder : t.importFolder}
            </button>
            <button
              className="command-button ghost"
              type="button"
              disabled={isImportingFolder}
              onClick={onImportFiles}
            >
              <FileUp size={16} />
              {t.importFontFiles}
            </button>
            <button className="command-button ghost" type="button" onClick={onReloadIndex}>
              <RefreshCcw size={16} />
              {t.syncIndex}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={onCopyRoot}
              disabled={!hasLocalIndex}
              title={t.copyLibraryRoot}
              aria-label={t.copyLibraryRoot}
            >
              <Clipboard size={16} />
            </button>
          </div>
        </section>

        <section className="drawer-section app-update-section">
          <div className="drawer-section-head">
            <h3>
              <Rocket size={16} />
              {t.appUpdate}
            </h3>
            <span className="update-version-chip">v{appVersion}</span>
          </div>
          <div
            className={
              updateCheck.status === "available"
                ? "app-update-card update-available"
                : "app-update-card"
            }
          >
            <div className="app-update-status">
              <span
                className={
                  updateCheck.status === "available"
                    ? "status-dot update"
                    : updateCheck.status === "current"
                      ? "status-dot good"
                      : "status-dot"
                }
              />
              <div>
                <strong>
                  {updateCheck.status === "checking" || updateCheck.status === "idle"
                    ? t.checkingForUpdates
                    : updateCheck.status === "available"
                      ? `${t.updateAvailable}: v${updateCheck.release.version}`
                      : updateCheck.status === "ahead"
                        ? t.appAheadOfRelease
                      : updateCheck.status === "current"
                        ? t.appUpToDate
                        : t.updateCheckFailed}
                </strong>
                <span>
                  {updateCheck.status === "available" || updateCheck.status === "current"
                    ? `${t.currentVersion} v${appVersion} · ${t.latestVersion} v${updateCheck.release.version}`
                    : updateCheck.status === "ahead"
                      ? `${t.currentVersion} v${appVersion} · ${t.publishedVersion} v${updateCheck.release.version}`
                    : `${t.currentVersion} v${appVersion}`}
                </span>
              </div>
            </div>
            <div className="app-update-actions">
              {updateCheck.status === "available" && (
                <button
                  className="command-button"
                  type="button"
                  onClick={() =>
                    void openExternalUrl(
                      updateCheck.release.downloadUrl ?? updateCheck.release.releaseUrl
                    )
                  }
                >
                  <Download size={15} />
                  {t.downloadUpdate}
                </button>
              )}
              {(updateCheck.status === "available" ||
                updateCheck.status === "current" ||
                updateCheck.status === "ahead") && (
                <button
                  className="command-button ghost"
                  type="button"
                  onClick={() => void openExternalUrl(updateCheck.release.releaseUrl)}
                >
                  <ExternalLink size={15} />
                  {t.viewRelease}
                </button>
              )}
              {updateCheck.status === "error" && (
                <button
                  className="command-button ghost"
                  type="button"
                  onClick={() => void runUpdateCheck(true)}
                >
                  <RefreshCcw size={15} />
                  {t.checkAgain}
                </button>
              )}
              {(updateCheck.status === "checking" || updateCheck.status === "idle") && (
                <RefreshCcw className="update-check-spinner" size={16} aria-hidden="true" />
              )}
            </div>
          </div>
          <p className="drawer-section-note">{t.updateCheckHint}</p>
        </section>

        <section className="drawer-section">
          <h3>
            <Database size={16} />
            {t.indexOverview}
          </h3>
          <div className="library-stat-grid">
            <StatItem label={t.fontFamilies} value={stats.families} />
            <StatItem label={t.fontFiles} value={stats.files} />
            <StatItem label={t.visibleFonts} value={stats.visible} />
            <StatItem label={t.favorites} value={stats.favorites} />
            <StatItem label={t.hiddenFonts} value={stats.hidden} />
            <StatItem label={t.removedFonts} value={stats.removed} />
            <StatItem label={t.previewable} value={stats.previewable} />
            <StatItem label={t.desktopOnly} value={stats.desktopOnly} />
          </div>
        </section>

        <section className="drawer-section">
          <h3>
            <HardDrive size={16} />
            {t.librarySources}
          </h3>
          <div className="source-list">
            {sources.map((source) => (
              <article className="source-item" key={source.id}>
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.kindLabel}</span>
                  {source.root && <em>{source.root}</em>}
                </div>
                <dl>
                  <div>
                    <dt>{t.fontFamilies}</dt>
                    <dd>{source.families}</dd>
                  </div>
                  <div>
                    <dt>{t.fontFiles}</dt>
                    <dd>{source.files}</dd>
                  </div>
                  <div>
                    <dt>{t.previewable}</dt>
                    <dd>{source.previewable}</dd>
                  </div>
                </dl>
                <div className="source-actions">
                  <button type="button" onClick={() => onFocusSource(source)}>
                    <Eye size={14} />
                    {t.viewSource}
                  </button>
                  <button
                    type="button"
                    disabled={isImportingFolder || source.source !== "local" || !source.root}
                    onClick={() => onRescanSource(source)}
                  >
                    <RefreshCcw size={14} />
                    {t.rescanSource}
                  </button>
                  <button className="danger" type="button" onClick={() => onRemoveSource(source)}>
                    <Trash2 size={14} />
                    {t.removeSource}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <div className="drawer-section-head">
            <h3>
              <Layers2 size={16} />
              {t.duplicateCleanup}
            </h3>
            {duplicateGroups.length > 0 && (
              <button
                className="drawer-section-action danger"
                type="button"
                onClick={onRemoveAllDuplicateExtras}
              >
                <Trash2 size={14} />
                {t.removeAllDuplicateExtras}
              </button>
            )}
          </div>
          <p className="drawer-section-note">{t.duplicateCleanupHint}</p>
          {duplicateGroups.length > 0 ? (
            <div className="duplicate-list">
              {duplicateGroups.slice(0, 6).map((group) => (
                <article className="duplicate-item" key={group.id}>
                  <div className="duplicate-item-head">
                    <div>
                      <strong>{group.label}</strong>
                      <span>
                        {group.count} {t.fontFamilies} / {group.files} {t.filesUnit}
                      </span>
                    </div>
                    <button type="button" onClick={() => onFocusDuplicate(group)}>
                      <Eye size={14} />
                      {t.focusDuplicate}
                    </button>
                  </div>
                  <div className="duplicate-font-list">
                    {group.fonts.slice(0, 4).map((font, index) => (
                      <span key={font.id} className={index === 0 ? "keeper" : undefined}>
                        {index === 0 ? t.keepFirstFont : font.family}
                      </span>
                    ))}
                  </div>
                  <div className="duplicate-actions">
                    <button type="button" onClick={() => onHideDuplicateExtras(group)}>
                      {t.hideDuplicateExtras}
                    </button>
                    <button className="danger" type="button" onClick={() => onRemoveDuplicateExtras(group)}>
                      {t.removeDuplicateExtras}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-duplicate-state">{t.noDuplicateFonts}</div>
          )}
        </section>

        <section className="drawer-section">
          <h3>
            <HardDrive size={16} />
            {t.platformReadiness}
          </h3>
          <div className="platform-readiness">
            <div>
              <span>{t.currentPlatform}</span>
              <strong>{platform.label}</strong>
            </div>
            <div>
              <span>{t.defaultInstallTarget}</span>
              <strong>{platform.installTarget}</strong>
            </div>
          </div>
          <div className="path-list">
            {platform.defaultFontDirs.map((fontDir) => (
              <span key={fontDir}>{fontDir}</span>
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <h3>
            <CheckCircle2 size={16} />
            {t.migrationChecklist}
          </h3>
          <div className="checklist">
            <ChecklistItem done={hasLocalIndex} label={t.libraryRootKnown} />
            <ChecklistItem done={stats.files > 0} label={t.fontFilesIndexed} />
            <ChecklistItem done={stats.previewable > 0} label={t.previewFilesReady} />
            <ChecklistItem done label={t.localStateReady} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="library-stat-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={done ? "checklist-item done" : "checklist-item"}>
      <CheckCircle2 size={15} />
      <span>{label}</span>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
