import {
  ChevronDown,
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
import { detectPlatform } from "../lib/platform";
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
  onImportFolder,
  onImportFiles,
  onReloadIndex,
  onToggleTheme
}: TopBarProps) {
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const ThemeIcon = themeMode === "dark" ? Sun : Moon;
  const searchShortcut = detectPlatform() === "macos" ? "⌘F" : "Ctrl F";

  useEffect(() => {
    if (!isImportMenuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!importMenuRef.current?.contains(event.target as Node)) {
        setIsImportMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsImportMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isImportMenuOpen]);

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
          title={`${t.searchFont} (${searchShortcut})`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t.searchPlaceholder}
        />
        <kbd className="search-shortcut" aria-hidden="true">
          {searchShortcut}
        </kbd>
      </div>

      <div className="preview-input">
        <input
          aria-label={t.previewText}
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          placeholder={t.previewPlaceholder}
        />
      </div>

      <div className="import-menu-wrap" ref={importMenuRef}>
        <button
          className="command-button"
          type="button"
          disabled={isImportingFolder}
          onClick={() => {
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

      <div className="quick-filter-bar" aria-label={t.filters}>
        <SlidersHorizontal className="quick-filter-icon" size={16} aria-hidden="true" />
        <QuickFilterGroup
          label={t.language}
          value={languageFilter}
          options={[
            ["all", t.all],
            ["chinese", t.chinese],
            ["english", t.english]
          ]}
          onChange={onLanguageFilterChange}
        />
        <QuickFilterGroup
          label={t.license}
          value={licenseFilter}
          options={[
            ["all", t.all],
            ["free-commercial", t.freeCommercial],
            ["ofl", "OFL"],
            ["apache", "Apache"],
            ["cc0", "CC0"],
            ["unknown", t.licenseReview],
            ["personal", t.personalOnly]
          ]}
          onChange={onLicenseFilterChange}
        />
        <QuickFilterGroup
          label={t.source}
          value={sourceFilter}
          options={[
            ["all", t.all],
            ["local", t.local],
            ["manual", t.manualImport],
            ["google-fonts", "Google"],
            ["fontsource", "Fontsource"]
          ]}
          onChange={onSourceFilterChange}
        />
      </div>
    </header>
  );
}

function QuickFilterGroup<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: Array<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="quick-filter-group" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            className={value === optionValue ? "active" : undefined}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
