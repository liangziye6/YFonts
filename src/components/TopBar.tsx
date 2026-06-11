import {
  ChevronDown,
  Database,
  FileUp,
  FolderOpen,
  Moon,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Sun
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import type { FontLanguage, FontSource, LicenseKind } from "../types";

export type LicenseFilter = "all" | LicenseKind;
export type SourceFilter = "all" | FontSource;
export type LanguageFilter = "all" | FontLanguage;

type TopBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  previewText: string;
  onPreviewTextChange: (value: string) => void;
  licenseFilter: LicenseFilter;
  onLicenseFilterChange: (value: LicenseFilter) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (value: SourceFilter) => void;
  languageFilter: LanguageFilter;
  onLanguageFilterChange: (value: LanguageFilter) => void;
  isImportingFolder: boolean;
  themeMode: "light" | "dark";
  onOpenLibrarySettings: () => void;
  onImportFolder: () => void;
  onImportFiles: () => void;
  onReloadIndex: () => void;
  onToggleTheme: () => void;
};

export function TopBar({
  query,
  onQueryChange,
  previewText,
  onPreviewTextChange,
  licenseFilter,
  onLicenseFilterChange,
  sourceFilter,
  onSourceFilterChange,
  languageFilter,
  onLanguageFilterChange,
  isImportingFolder,
  themeMode,
  onOpenLibrarySettings,
  onImportFolder,
  onImportFiles,
  onReloadIndex,
  onToggleTheme
}: TopBarProps) {
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const ThemeIcon = themeMode === "dark" ? Sun : Moon;
  const activeFilterCount = [languageFilter, licenseFilter, sourceFilter].filter(
    (value) => value !== "all"
  ).length;

  useEffect(() => {
    if (!isImportMenuOpen && !isFilterMenuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!importMenuRef.current?.contains(event.target as Node)) {
        setIsImportMenuOpen(false);
      }
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsImportMenuOpen(false);
        setIsFilterMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFilterMenuOpen, isImportMenuOpen]);

  function runImport(action: () => void) {
    setIsImportMenuOpen(false);
    action();
  }

  return (
    <header className="topbar">
      <div className="search-box">
        <Search size={18} />
        <input
          aria-label={t.searchFont}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t.searchPlaceholder}
        />
      </div>

      <div className="preview-input">
        <input
          aria-label={t.previewText}
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          placeholder={t.previewPlaceholder}
        />
      </div>

      <div className="filter-group desktop-filter-group" title={t.filters}>
        <SlidersHorizontal size={17} />
        <FilterControls
          languageFilter={languageFilter}
          licenseFilter={licenseFilter}
          sourceFilter={sourceFilter}
          onLanguageFilterChange={onLanguageFilterChange}
          onLicenseFilterChange={onLicenseFilterChange}
          onSourceFilterChange={onSourceFilterChange}
        />
      </div>

      <div className="filter-menu-wrap" ref={filterMenuRef}>
        <button
          className={isFilterMenuOpen ? "command-button ghost filter-menu-button active" : "command-button ghost filter-menu-button"}
          type="button"
          aria-expanded={isFilterMenuOpen}
          onClick={() => {
            setIsImportMenuOpen(false);
            setIsFilterMenuOpen((isOpen) => !isOpen);
          }}
        >
          <SlidersHorizontal size={17} />
          {t.filters}
          {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          <ChevronDown size={15} />
        </button>
        {isFilterMenuOpen && (
          <div className="filter-popover">
            <FilterControls
              labelled
              languageFilter={languageFilter}
              licenseFilter={licenseFilter}
              sourceFilter={sourceFilter}
              onLanguageFilterChange={onLanguageFilterChange}
              onLicenseFilterChange={onLicenseFilterChange}
              onSourceFilterChange={onSourceFilterChange}
            />
          </div>
        )}
      </div>

      <button className="command-button ghost library-button" type="button" onClick={onOpenLibrarySettings}>
        <Database size={17} />
        {t.librarySettings}
      </button>

      <div className="import-menu-wrap" ref={importMenuRef}>
        <button
          className="command-button"
          type="button"
          disabled={isImportingFolder}
          onClick={() => {
            setIsFilterMenuOpen(false);
            setIsImportMenuOpen((isOpen) => !isOpen);
          }}
        >
          <FolderOpen size={17} />
          {isImportingFolder ? t.importingFolder : t.import}
          <ChevronDown size={15} />
        </button>
        {isImportMenuOpen && (
          <div className="import-menu">
            <button type="button" onClick={() => runImport(onImportFolder)}>
              <FolderOpen size={15} />
              {t.importFolder}
            </button>
            <button type="button" onClick={() => runImport(onImportFiles)}>
              <FileUp size={15} />
              {t.importFontFiles}
            </button>
          </div>
        )}
      </div>
      <button
        className="icon-button"
        title={themeMode === "dark" ? t.lightMode : t.darkMode}
        aria-label={themeMode === "dark" ? t.lightMode : t.darkMode}
        type="button"
        onClick={onToggleTheme}
      >
        <ThemeIcon size={18} />
      </button>
      <button className="icon-button" title={t.syncIndex} aria-label={t.syncIndex} type="button" onClick={onReloadIndex}>
        <RefreshCcw size={18} />
      </button>
    </header>
  );
}

type FilterControlsProps = {
  labelled?: boolean;
  licenseFilter: LicenseFilter;
  sourceFilter: SourceFilter;
  languageFilter: LanguageFilter;
  onLicenseFilterChange: (value: LicenseFilter) => void;
  onSourceFilterChange: (value: SourceFilter) => void;
  onLanguageFilterChange: (value: LanguageFilter) => void;
};

function FilterControls({
  labelled = false,
  languageFilter,
  licenseFilter,
  sourceFilter,
  onLanguageFilterChange,
  onLicenseFilterChange,
  onSourceFilterChange
}: FilterControlsProps) {
  return (
    <>
      <label className={labelled ? "filter-control labelled" : "filter-control"}>
        {labelled && <span>{t.languageFilter}</span>}
        <select
          aria-label={t.languageFilter}
          value={languageFilter}
          onChange={(event) => onLanguageFilterChange(event.target.value as LanguageFilter)}
        >
          <option value="all">{t.allLanguages}</option>
          <option value="chinese">{t.chinese}</option>
          <option value="english">{t.english}</option>
        </select>
      </label>
      <label className={labelled ? "filter-control labelled" : "filter-control"}>
        {labelled && <span>{t.licenseFilter}</span>}
        <select
          aria-label={t.licenseFilter}
          value={licenseFilter}
          onChange={(event) => onLicenseFilterChange(event.target.value as LicenseFilter)}
        >
          <option value="all">{t.allLicenses}</option>
          <option value="ofl">OFL</option>
          <option value="free-commercial">{t.freeCommercial}</option>
          <option value="apache">Apache</option>
          <option value="cc0">CC0</option>
          <option value="unknown">{t.licenseReview}</option>
          <option value="personal">{t.personalOnly}</option>
        </select>
      </label>
      <label className={labelled ? "filter-control labelled" : "filter-control"}>
        {labelled && <span>{t.sourceFilter}</span>}
        <select
          aria-label={t.sourceFilter}
          value={sourceFilter}
          onChange={(event) => onSourceFilterChange(event.target.value as SourceFilter)}
        >
          <option value="all">{t.allSources}</option>
          <option value="local">{t.local}</option>
          <option value="manual">{t.manualImport}</option>
          <option value="google-fonts">Google Fonts</option>
          <option value="fontsource">Fontsource</option>
        </select>
      </label>
    </>
  );
}
