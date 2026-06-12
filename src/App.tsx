import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from "react";
import { GripVertical, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { DetailsPanel } from "./components/DetailsPanel";
import { FontList } from "./components/FontList";
import {
  LibrarySettingsPanel,
  type LibraryDuplicateGroup,
  type LibrarySettingsStats,
  type LibrarySourceSummary
} from "./components/LibrarySettingsPanel";
import { Sidebar, type SectionId } from "./components/Sidebar";
import {
  TopBar,
  type LanguageFilter,
  type LicenseFilter,
  type SourceFilter
} from "./components/TopBar";
import { WindowTitleBar } from "./components/WindowTitleBar";
import { getLicenseMetadataLabel, licenseMetadataOptions } from "./lib/fontMetadata";
import { t } from "./lib/i18n";
import {
  countImportableFontFiles,
  filesToLocalFontIndex,
  getActiveVariant,
  isVariableFontVariant,
  loadLocalFontIndex,
  localRecordsToAssets,
  type LocalFontIndex
} from "./lib/localFontIndex";
import {
  applyLibraryState,
  type FontMetadataOverride,
  filterExistingFontIds,
  filterExistingProjectPacks,
  filterExistingVariantIds,
  getLibraryStateKey,
  loadLibraryStateAsync,
  loadSavedFolderRootsAsync,
  loadSourceRootMappingsAsync,
  removeSavedFolderRootAsync,
  sampleLibraryKey,
  saveFolderRootAsync,
  saveLibraryStateAsync,
  saveSourceRootMappingAsync
} from "./lib/libraryState";
import { diagnoseFontLocation, openFontLocation } from "./lib/openLocation";
import { detectPlatform, platformProfiles } from "./lib/platform";
import {
  getFontVariationSettings,
  resolveFontPreviewText,
  type FontAxisValues
} from "./lib/preview";
import { pickNativeFontFiles, scanFontFolder } from "./lib/scanFontFolder";
import { getFontSearchScore } from "./lib/fontSearch";
import { invokeTauri, isTauriRuntime } from "./lib/tauri";
import type { FontAsset, FontSource, FontVariant, LicenseKind, ProjectPack } from "./types";

const freeLicenses = new Set(["ofl", "free-commercial", "apache", "cc0"]);
const detailFontFamily = "YFonts Detail Preview";
const browserImportFileLimit = 3500;
const themeStorageKey = "yfonts:theme-mode";
const builtInCategories = [
  t.sansCn,
  t.song,
  t.kai,
  t.round,
  t.lishu,
  t.seal,
  t.handwriting,
  t.serif,
  t.sans,
  t.line,
  t.retro,
  t.creative,
  t.cartoon,
  t.art,
  t.cnOther,
  t.enOther
];

type ThemeMode = "light" | "dark";

type FontSystemOperationResult = {
  targetDir: string;
  paths: string[];
  completedFiles: number;
  skippedFiles: number;
};

type SystemFontDetectionResult = {
  installed: boolean;
  matches: string[];
};

type SystemFontStatus = "checking" | "installed" | "not-installed" | "unavailable";

function getFontFaceWeightDescriptor(font: FontAsset, variant: FontVariant) {
  const weightAxis = isVariableFontVariant(variant)
    ? font.variableAxes?.find((axis) => axis.tag === "wght")
    : undefined;
  return weightAxis ? `${weightAxis.min} ${weightAxis.max}` : `${variant.weight || 400}`;
}

function getSectionMatch(section: SectionId, font: FontAsset) {
  if (section === "all") return true;
  if (section === "local") return font.source === "local" || font.source === "manual";
  if (section === "online") return font.source === "google-fonts" || font.source === "fontsource";
  if (section === "free") return freeLicenses.has(font.license);
  if (section === "review") return font.license === "unknown" || font.license === "personal";
  if (section === "favorites") return font.isFavorite;
  return true;
}

function loadThemeMode(): ThemeMode {
  try {
    const savedMode = window.localStorage.getItem(themeStorageKey);
    if (savedMode === "dark" || savedMode === "light") return savedMode;
  } catch {
    // Use light mode when local storage is unavailable.
  }

  return "light";
}

function App() {
  const [fonts, setFonts] = useState<FontAsset[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [localIndex, setLocalIndex] = useState<LocalFontIndex>();
  const [activeSection, setActiveSection] = useState<SectionId>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewSize, setPreviewSize] = useState(64);
  const [category, setCategory] = useState(t.all);
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [activeVariantIds, setActiveVariantIds] = useState<Record<string, string>>({});
  const [fontOverrides, setFontOverrides] = useState<Record<string, FontMetadataOverride>>({});
  const [installedFontFiles, setInstalledFontFiles] = useState<Record<string, string[]>>({});
  const [categoryLabels, setCategoryLabels] = useState<string[]>(builtInCategories);
  const [recentFontIds, setRecentFontIds] = useState<string[]>([]);
  const [hiddenFontIds, setHiddenFontIds] = useState<Set<string>>(new Set());
  const [removedFontIds, setRemovedFontIds] = useState<Set<string>>(new Set());
  const [selectedFontIds, setSelectedFontIds] = useState<Set<string>>(new Set());
  const [visibleListFontIds, setVisibleListFontIds] = useState<string[]>([]);
  const [fontAxisValues, setFontAxisValues] = useState<Record<string, FontAxisValues>>({});
  const [libraryKey, setLibraryKey] = useState(sampleLibraryKey);
  const [isLibraryStateReady, setIsLibraryStateReady] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLibrarySettingsOpen, setIsLibrarySettingsOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isFolderImportDialogOpen, setIsFolderImportDialogOpen] = useState(false);
  const [folderImportPath, setFolderImportPath] = useState("");
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [isBrowserImportPreviewSafeMode, setIsBrowserImportPreviewSafeMode] = useState(false);
  const [isAutoPlayingVariants, setIsAutoPlayingVariants] = useState(false);
  const [isComparePanelOpen, setIsComparePanelOpen] = useState(false);
  const [projectPacks, setProjectPacks] = useState<ProjectPack[]>([]);
  const [selectedProjectPackId, setSelectedProjectPackId] = useState<string>();
  const [systemFontBusyId, setSystemFontBusyId] = useState<string>();
  const [systemFontStatuses, setSystemFontStatuses] = useState<Record<string, SystemFontStatus>>({});
  const [notice, setNotice] = useState("");

  const platform = platformProfiles[detectPlatform()];

  useEffect(() => {
    void (async () => {
      await hydrateLibraryState([], sampleLibraryKey);
      await reloadLocalIndex(false);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  const managedFonts = useMemo(
    () => fonts.filter((font) => !removedFontIds.has(font.id)),
    [fonts, removedFontIds]
  );

  const visibleFonts = useMemo(
    () => managedFonts.filter((font) => !hiddenFontIds.has(font.id)),
    [hiddenFontIds, managedFonts]
  );

  const hiddenFonts = useMemo(
    () => managedFonts.filter((font) => hiddenFontIds.has(font.id)),
    [hiddenFontIds, managedFonts]
  );

  const removedFonts = useMemo(
    () => fonts.filter((font) => removedFontIds.has(font.id)),
    [fonts, removedFontIds]
  );

  const selectedProjectPack =
    projectPacks.find((pack) => pack.id === selectedProjectPackId) ?? projectPacks[0];

  const projectPackFonts = useMemo(() => {
    const packFontIds = getProjectPackFontIds(projectPacks, selectedProjectPack?.id);
    return visibleFonts.filter((font) => packFontIds.has(font.id));
  }, [projectPacks, selectedProjectPack, visibleFonts]);

  const sectionBaseFonts =
    activeSection === "projectPacks"
      ? projectPackFonts
      : activeSection === "hidden"
      ? hiddenFonts
      : activeSection === "removed"
        ? removedFonts
        : visibleFonts;

  const categories = useMemo(() => {
    const nextCategories = uniqueStrings([
      ...categoryLabels,
      ...sectionBaseFonts.map((font) => font.category)
    ]);
    return [t.all, ...nextCategories];
  }, [categoryLabels, sectionBaseFonts]);

  const metadataCategories = useMemo(() => {
    return uniqueStrings([...categoryLabels, ...fonts.map((font) => font.category)]);
  }, [categoryLabels, fonts]);

  const counts = useMemo(() => {
    const sectionIds: SectionId[] = ["all", "local", "online", "free", "review", "favorites"];

    const visibleCounts = sectionIds.reduce(
      (result, sectionId) => ({
        ...result,
        [sectionId]: visibleFonts.filter((font) => getSectionMatch(sectionId, font)).length
      }),
      {} as Record<SectionId, number>
    );

    return {
      ...visibleCounts,
      projectPacks: projectPacks.filter((pack) => !pack.parentId).length,
      hidden: hiddenFonts.length,
      removed: removedFonts.length
    };
  }, [hiddenFonts.length, projectPacks.length, removedFonts.length, visibleFonts]);

  const filteredFonts = useMemo(() => {
    const hasQuery = query.trim().length > 0;

    return sectionBaseFonts
      .map((font, index) => ({
        font,
        index,
        searchScore: hasQuery ? getFontSearchScore(font, query) : 0
      }))
      .filter(({ font, searchScore }) => {
        const matchesSection =
          activeSection === "hidden" ||
          activeSection === "removed" ||
          getSectionMatch(activeSection, font);
        const matchesCategory = category === t.all || font.category === category;
        const matchesLicense = licenseFilter === "all" || font.license === licenseFilter;
        const matchesSource = sourceFilter === "all" || font.source === sourceFilter;
        const matchesLanguage = languageFilter === "all" || font.language === languageFilter;

        return (
          matchesSection &&
          matchesCategory &&
          matchesLicense &&
          matchesSource &&
          matchesLanguage &&
          searchScore >= 0
        );
      })
      .sort((a, b) => {
        if (!hasQuery) return a.index - b.index;
        return b.searchScore - a.searchScore || a.font.family.localeCompare(b.font.family);
      })
      .map(({ font }) => font);
  }, [activeSection, category, languageFilter, licenseFilter, query, sectionBaseFonts, sourceFilter]);

  const selectedFont =
    (selectedId ? fonts.find((font) => font.id === selectedId) : undefined) ??
    (isBrowserImportPreviewSafeMode ? undefined : filteredFonts[0]);
  const selectedVariantId = selectedFont ? activeVariantIds[selectedFont.id] : undefined;
  const selectedDetailFontFamily = useMemo(() => {
    if (!selectedFont) return detailFontFamily;
    const activeVariant = getActiveVariant(selectedFont, selectedVariantId);
    const familyKey = `${selectedFont.id}_${activeVariant.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `YFontsDetail_${familyKey}`;
  }, [selectedFont, selectedVariantId]);
  const selectedFontIsHidden = selectedFont ? hiddenFontIds.has(selectedFont.id) : false;
  const selectedFontIsRemoved = selectedFont ? removedFontIds.has(selectedFont.id) : false;
  const selectedFilteredFonts = useMemo(
    () => filteredFonts.filter((font) => selectedFontIds.has(font.id)),
    [filteredFonts, selectedFontIds]
  );
  const areSelectedFontsAllFavorite =
    selectedFilteredFonts.length > 0 && selectedFilteredFonts.every((font) => font.isFavorite);
  const selectedPreviewableVariants = useMemo(
    () => selectedFont?.variants.filter((variant) => variant.isPreviewable) ?? [],
    [selectedFont]
  );

  const licenseOverview = useMemo(() => {
    const freeCount = visibleFonts.filter((font) => freeLicenses.has(font.license)).length;
    const reviewCount = visibleFonts.filter(
      (font) => font.license === "unknown" || font.license === "personal"
    ).length;

    return {
      freeCount,
      reviewCount,
      totalCount: visibleFonts.length
    };
  }, [visibleFonts]);

  const recentFonts = useMemo(() => {
    const fontsById = new Map(visibleFonts.map((font) => [font.id, font]));
    const historyFonts = recentFontIds.map((fontId) => fontsById.get(fontId));
    const favoriteFonts = visibleFonts.filter((font) => font.isFavorite);

    return uniqueFonts([...historyFonts, ...favoriteFonts, ...filteredFonts]).slice(0, 6);
  }, [filteredFonts, recentFontIds, visibleFonts]);

  const fontFaceFonts = useMemo(
    () => {
      const visibleFontIds = new Set(visibleListFontIds);
      const visiblePreviewFonts = filteredFonts.filter((font) => visibleFontIds.has(font.id));
      const initialPreviewFonts =
        visiblePreviewFonts.length > 0 ? visiblePreviewFonts : filteredFonts.slice(0, 12);
      const safePreviewFonts = isBrowserImportPreviewSafeMode
        ? initialPreviewFonts.filter((font) => font.source !== "manual")
        : initialPreviewFonts;
      const safeRecentFonts = isBrowserImportPreviewSafeMode
        ? recentFonts.filter((font) => font.source !== "manual")
        : recentFonts;

      return uniqueFonts([...safePreviewFonts, ...safeRecentFonts, selectedFont]);
    },
    [
      filteredFonts,
      isBrowserImportPreviewSafeMode,
      recentFonts,
      selectedFont,
      visibleListFontIds
    ]
  );

  const totalFontFiles = useMemo(
    () => fonts.reduce((total, font) => total + font.totalFiles, 0),
    [fonts]
  );

  const libraryStats: LibrarySettingsStats = useMemo(
    () => ({
      families: fonts.length,
      files: totalFontFiles,
      visible: visibleFonts.length,
      hidden: hiddenFonts.length,
      removed: removedFonts.length,
      favorites: fonts.filter((font) => font.isFavorite).length,
      previewable: fonts.filter((font) => font.canPreview).length,
      desktopOnly: fonts.filter((font) => !font.canPreview).length,
      categories: new Set(fonts.map((font) => font.category)).size
    }),
    [fonts, hiddenFonts.length, removedFonts.length, totalFontFiles, visibleFonts.length]
  );

  const librarySources = useMemo(() => summarizeLibrarySources(fonts), [fonts]);
  const libraryDuplicateGroups = useMemo(
    () => summarizeDuplicateGroups(visibleFonts),
    [visibleFonts]
  );

  useEffect(() => {
    if (isBrowserImportPreviewSafeMode && !selectedId) return;

    if (filteredFonts.length > 0 && !filteredFonts.some((font) => font.id === selectedId)) {
      setSelectedId(filteredFonts[0].id);
    }
    if (activeSection === "projectPacks" && filteredFonts.length === 0 && selectedId) {
      setSelectedId(undefined);
    }
  }, [activeSection, filteredFonts, isBrowserImportPreviewSafeMode, selectedId]);

  useEffect(() => {
    const filteredIds = new Set(filteredFonts.map((font) => font.id));

    setSelectedFontIds((currentIds) => {
      const nextIds = new Set(Array.from(currentIds).filter((fontId) => filteredIds.has(fontId)));
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [filteredFonts]);

  useEffect(() => {
    if (!categories.includes(category)) {
      setCategory(t.all);
    }
  }, [categories, category]);

  useEffect(() => {
    const fontCategories = fonts.map((font) => font.category).filter(Boolean);
    setCategoryLabels((currentLabels) => uniqueStrings([...currentLabels, ...fontCategories]));
  }, [fonts]);

  useEffect(() => {
    if (selectedFontIds.size === 0) return;

    function exitSelectionMode(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedFontIds(new Set());
    }

    document.addEventListener("keydown", exitSelectionMode);

    return () => {
      document.removeEventListener("keydown", exitSelectionMode);
    };
  }, [selectedFontIds.size]);

  useEffect(() => {
    if (activeSection !== "projectPacks" || selectedFontIds.size === 0) return;

    function removeProjectSelectionWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Delete" || isEditableTarget(event.target)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      removeSelectedFontsFromProjectPack();
    }

    document.addEventListener("keydown", removeProjectSelectionWithKeyboard);

    return () => {
      document.removeEventListener("keydown", removeProjectSelectionWithKeyboard);
    };
  }, [activeSection, selectedFontIds.size, selectedFilteredFonts, selectedProjectPack?.id]);

  useEffect(() => {
    if (!selectedFont) return;

    setRecentFontIds((currentIds) => [
      selectedFont.id,
      ...currentIds.filter((fontId) => fontId !== selectedFont.id)
    ].slice(0, 12));
  }, [selectedFont?.id]);

  useEffect(() => {
    if (!selectedFont) return;

    const fontId = selectedFont.id;
    if ((installedFontFiles[fontId]?.length ?? 0) > 0) {
      setSystemFontStatuses((currentStatuses) => ({
        ...currentStatuses,
        [fontId]: "installed"
      }));
      return;
    }
    if (!isTauriRuntime()) {
      setSystemFontStatuses((currentStatuses) => ({
        ...currentStatuses,
        [fontId]: "unavailable"
      }));
      return;
    }
    if (systemFontStatuses[fontId] && systemFontStatuses[fontId] !== "checking") return;

    let cancelled = false;
    setSystemFontStatuses((currentStatuses) => ({
      ...currentStatuses,
      [fontId]: "checking"
    }));

    void invokeTauri<SystemFontDetectionResult>("detect_system_font", {
      family: selectedFont.family,
      filenames: selectedFont.variants
        .map((variant) => variant.path ?? variant.relativePath ?? "")
        .filter(Boolean)
    })
      .then((result) => {
        if (cancelled) return;
        setSystemFontStatuses((currentStatuses) => ({
          ...currentStatuses,
          [fontId]: result.installed ? "installed" : "not-installed"
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSystemFontStatuses((currentStatuses) => ({
          ...currentStatuses,
          [fontId]: "unavailable"
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [installedFontFiles, selectedFont?.id]);

  useEffect(() => {
    if (!isLibraryStateReady) return;

    void saveLibraryStateAsync(libraryKey, {
      favoriteFontIds: fonts.filter((font) => font.isFavorite).map((font) => font.id),
      hiddenFontIds: Array.from(hiddenFontIds),
      removedFontIds: Array.from(removedFontIds),
      recentFontIds,
      activeVariantIds,
      fontOverrides,
      installedFontFiles,
      categoryLabels,
      previewSize,
      projectPacks
    });
  }, [
    activeVariantIds,
    categoryLabels,
    fontOverrides,
    fonts,
    hiddenFontIds,
    isLibraryStateReady,
    installedFontFiles,
    libraryKey,
    previewSize,
    projectPacks,
    recentFontIds,
    removedFontIds
  ]);

  useEffect(() => {
    if (isAutoPlayingVariants && selectedPreviewableVariants.length < 2) {
      setIsAutoPlayingVariants(false);
    }
  }, [isAutoPlayingVariants, selectedPreviewableVariants.length]);

  useEffect(() => {
    if (!isAutoPlayingVariants || !selectedFont || selectedPreviewableVariants.length < 2) return;

    const timerId = window.setInterval(() => {
      setActiveVariantIds((currentIds) => {
        const currentVariantId =
          currentIds[selectedFont.id] ??
          selectedFont.activeVariantId ??
          selectedPreviewableVariants[0]?.id;
        const currentIndex = selectedPreviewableVariants.findIndex(
          (variant) => variant.id === currentVariantId
        );
        const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
        const nextVariant =
          selectedPreviewableVariants[nextIndex % selectedPreviewableVariants.length];

        return { ...currentIds, [selectedFont.id]: nextVariant.id };
      });
    }, 3000);

    return () => window.clearInterval(timerId);
  }, [isAutoPlayingVariants, selectedFont, selectedPreviewableVariants]);

  useEffect(() => {
    function handleDragDiagnostic(event: Event) {
      const diagnostic = (event as CustomEvent<NonNullable<Window["__YFONTS_LAST_DRAG_DIAGNOSTIC__"]>>)
        .detail;
      if (!diagnostic) return;

      if (diagnostic.stage === "drop-miss" || diagnostic.stage === "cancel") {
        setNotice(
          `拖拽诊断: ${diagnostic.stage}, fonts=${diagnostic.fontIds.length}, pack=${diagnostic.packId ?? "-"}, reason=${diagnostic.reason ?? "-"}`
        );
      }
    }

    document.addEventListener("yfonts-drag-diagnostic", handleDragDiagnostic);

    return () => {
      document.removeEventListener("yfonts-drag-diagnostic", handleDragDiagnostic);
    };
  }, []);

  async function hydrateLibraryState(
    nextFonts: FontAsset[],
    nextLibraryKey: string,
    preferredSelectedId?: string
  ) {
    const savedState = await loadLibraryStateAsync(nextLibraryKey);
    const hydratedFonts = applyLibraryState(nextFonts, savedState);
    const hiddenIds = filterExistingFontIds(savedState?.hiddenFontIds ?? [], hydratedFonts);
    const removedIds = filterExistingFontIds(savedState?.removedFontIds ?? [], hydratedFonts);
    const recentIds = filterExistingFontIds(savedState?.recentFontIds ?? [], hydratedFonts).slice(0, 12);
    const hydratedProjectPacks = filterExistingProjectPacks(
      savedState?.projectPacks ?? [],
      hydratedFonts
    );
    const selectableIds = new Set(hydratedFonts.map((font) => font.id));
    const preferredId =
      preferredSelectedId &&
      selectableIds.has(preferredSelectedId) &&
      !hiddenIds.includes(preferredSelectedId) &&
      !removedIds.includes(preferredSelectedId)
        ? preferredSelectedId
        : undefined;
    const fallbackFont =
      hydratedFonts.find((font) => !hiddenIds.includes(font.id) && !removedIds.includes(font.id)) ??
      hydratedFonts[0];

    setLibraryKey(nextLibraryKey);
    setFonts(hydratedFonts);
    setSelectedId(preferredId ?? fallbackFont?.id);
    setActiveVariantIds(filterExistingVariantIds(savedState?.activeVariantIds ?? {}, hydratedFonts));
    setFontOverrides(savedState?.fontOverrides ?? {});
    setInstalledFontFiles(savedState?.installedFontFiles ?? {});
    setSystemFontStatuses({});
    setCategoryLabels(
      uniqueStrings([
        ...(savedState?.categoryLabels?.length ? savedState.categoryLabels : builtInCategories),
        ...hydratedFonts.map((font) => font.category)
      ])
    );
    setHiddenFontIds(new Set(hiddenIds));
    setRemovedFontIds(new Set(removedIds));
    setRecentFontIds(recentIds);
    setPreviewSize(savedState?.previewSize ?? 64);
    setProjectPacks(hydratedProjectPacks);
    setSelectedProjectPackId((currentId) =>
      hydratedProjectPacks.some((pack) => pack.id === currentId)
        ? currentId
        : hydratedProjectPacks[0]?.id
    );
    setIsLibraryStateReady(true);
  }

  async function reloadLocalIndex(showNotice = true) {
    if (isTauriRuntime()) {
      await reloadDesktopFontSources(showNotice);
      return;
    }

    const index = await loadLocalFontIndex();
    if (!index) return;

    const localAssets = localRecordsToAssets(index);
    if (localAssets.length === 0) return;

    revokeFontObjectUrls(fonts);
    setIsBrowserImportPreviewSafeMode(false);
    await hydrateLibraryState(localAssets, getLibraryStateKey(index.root), localAssets[0].id);
    setCategory(t.all);
    setLanguageFilter("all");
    setLocalIndex(index);
    const restoredCount = await restoreSavedFolderImports(index.root);
    if (showNotice) {
      const restoredText = restoredCount > 0 ? ` / ${t.restoredSources}: ${restoredCount}` : "";
      setNotice(`${t.indexLoaded}: ${localAssets.length} ${t.fontsUnit}${restoredText}`);
    }
  }

  async function reloadDesktopFontSources(showNotice = true) {
    if (isImportingFolder) return;

    const roots = getReloadableFolderRoots(localIndex, librarySources, await loadSavedFolderRootsAsync());
    if (roots.length === 0) {
      if (showNotice) setNotice(t.importFolder);
      return;
    }

    setIsImportingFolder(true);
    if (showNotice) setNotice(`${t.scanningFolder}: ${roots.length} ${t.folderCount}`);

    try {
      let nextFonts = fonts;
      let nextIndex = localIndex;
      let refreshedFamilies = 0;
      let failedSources = 0;

      for (const root of roots) {
        try {
          const index = await scanFontFolder(root);
          const localAssets = localRecordsToAssets(index, { source: "local" });
          if (localAssets.length === 0) continue;

          const sourceId = getLibrarySourceId("local", index.root);
          nextFonts = replaceSourceFonts(nextFonts, sourceId, localAssets);
          nextIndex = replaceLocalIndexSource(nextIndex, index, sourceId);
          refreshedFamilies += localAssets.length;
          void saveFolderRootAsync(index.root);
        } catch {
          failedSources += 1;
        }
      }

      if (refreshedFamilies === 0) {
        if (showNotice) {
          setNotice(failedSources > 0 ? t.folderScanFailed : t.noMatches);
        }
        return;
      }

      const nextFontIds = new Set(nextFonts.map((font) => font.id));
      const fallbackFont = nextFonts.find(
        (font) => !hiddenFontIds.has(font.id) && !removedFontIds.has(font.id)
      );

      setFonts(nextFonts);
      setLocalIndex(nextIndex);
      setIsBrowserImportPreviewSafeMode(false);
      setHiddenFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setRemovedFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setSelectedFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setRecentFontIds((currentIds) => currentIds.filter((fontId) => nextFontIds.has(fontId)));
      setActiveVariantIds((currentIds) => filterVariantIdsByFontIds(currentIds, nextFontIds));
      setProjectPacks((currentPacks) => keepKnownProjectPackFonts(currentPacks, nextFontIds));
      if (selectedId && !nextFontIds.has(selectedId)) setSelectedId(fallbackFont?.id ?? nextFonts[0]?.id);
      setCategory(t.all);
      setLanguageFilter("all");

      if (showNotice) {
        const failedText = failedSources > 0 ? ` / ${failedSources} ${t.sourceScanFailed}` : "";
        setNotice(`${t.indexLoaded}: ${refreshedFamilies} ${t.fontsUnit}${failedText}`);
      }
    } finally {
      setIsImportingFolder(false);
    }
  }

  async function restoreSavedFolderImports(baseRoot?: string) {
    const baseRootKey = normalizeLibraryRoot(baseRoot);
    const roots = (await loadSavedFolderRootsAsync()).filter(
      (root) => normalizeLibraryRoot(root) !== baseRootKey
    );
    let restoredCount = 0;

    for (const root of roots) {
      try {
        const index = await scanFontFolder(root);
        const localAssets = localRecordsToAssets(index, { source: "local" });
        if (localAssets.length === 0) continue;

        addAssetsToLibrary(index, localAssets);
        restoredCount += localAssets.length;
      } catch {
        // Missing external folders should not stop the main library from opening.
      }
    }

    return restoredCount;
  }

  async function importFolder() {
    if (isImportingFolder) return;

    if (isTauriRuntime()) {
      const suggestedPath = getSuggestedFolderImportPath(localIndex?.root, librarySources);
      const selectedPath = await pickFontSourceRoot(suggestedPath).catch(() => undefined);
      if (!selectedPath) return;

      await submitFolderImport(selectedPath);
      return;
    }

    setFolderImportPath(getSuggestedFolderImportPath(localIndex?.root, librarySources));
    setIsFolderImportDialogOpen(true);
  }

  async function submitFolderImport(folderPath = folderImportPath) {
    if (isImportingFolder) return;
    if (!folderPath?.trim()) return;

    const normalizedFolderPath = folderPath.trim();
    setIsImportingFolder(true);
    setNotice(`${t.scanningFolder}: ${normalizedFolderPath}`);

    try {
      const index = await scanFontFolder(normalizedFolderPath);
      const localAssets = localRecordsToAssets(index, { source: "local" });
      if (localAssets.length === 0) {
        setNotice(t.noMatches);
        return;
      }

      addAssetsToLibrary(index, localAssets, { persistRoot: true, selectFirst: true });
      setIsFolderImportDialogOpen(false);
      setIsBrowserImportPreviewSafeMode(false);
      setNotice(`${t.folderImported}: ${localAssets.length} ${t.fontsUnit}`);
    } catch (error) {
      setNotice(`${t.folderScanFailed}: ${error instanceof Error ? error.message : t.copyFailed}`);
    } finally {
      setIsImportingFolder(false);
    }
  }

  async function importNativeFiles() {
    if (isImportingFolder) return;

    setIsImportingFolder(true);
    setNotice(t.importingFolder);

    try {
      const index = await pickNativeFontFiles();
      if (!index) {
        setNotice(t.projectPackExportCancelled);
        return;
      }

      const localAssets = localRecordsToAssets(index, { source: "local" });
      if (localAssets.length === 0) {
        setNotice(t.noMatches);
        return;
      }

      addAssetsToLibrary(index, localAssets, { selectFirst: true, persistRoot: true });
      setIsBrowserImportPreviewSafeMode(false);
      setNotice(`${t.fontFilesImported}: ${localAssets.length} ${t.fontsUnit}`);
    } catch (error) {
      setNotice(`${t.folderImportFailed}: ${error instanceof Error ? error.message : t.copyFailed}`);
    } finally {
      setIsImportingFolder(false);
    }
  }

  function importFiles() {
    if (isImportingFolder) return;

    if (isTauriRuntime()) {
      void importNativeFiles();
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".ttf,.otf,.ttc,.woff,.woff2";

    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      void handleImportedFiles(files, t.manualImport, t.fontFilesImported);
    };

    input.click();
  }

  function chooseFolderFiles() {
    if (isImportingFolder) return;

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".ttf,.otf,.ttc,.woff,.woff2";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");

    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      const folderName = getImportedFolderName(files);
      void handleImportedFiles(files, folderName, t.folderImported, { closeFolderDialog: true });
    };

    input.click();
  }

  async function handleImportedFiles(
    files: File[],
    rootLabel: string,
    successLabel: string,
    options: { closeFolderDialog?: boolean } = {}
  ) {
    if (files.length === 0) {
      setNotice(t.browserImportUnsupported);
      return;
    }

    const fontFileCount = countImportableFontFiles(files);
    if (fontFileCount === 0) {
      setNotice(t.noMatches);
      return;
    }

    if (fontFileCount > browserImportFileLimit) {
      setNotice(`${t.browserImportTooLarge}: ${fontFileCount} ${t.filesUnit}`);
      return;
    }

    setIsImportingFolder(true);
    setNotice(`${t.importingFolder}: ${fontFileCount} ${t.filesUnit}`);

    window.setTimeout(() => {
      try {
        const index = filesToLocalFontIndex(files, rootLabel);
        const localAssets = localRecordsToAssets(index, { source: "manual" });
        if (localAssets.length === 0) {
          setNotice(t.noMatches);
          return;
        }

        addAssetsToLibrary(index, localAssets, { selectFirst: true });
        setIsBrowserImportPreviewSafeMode(!isTauriRuntime());
        if (options.closeFolderDialog) setIsFolderImportDialogOpen(false);
        setNotice(
          `${successLabel}: ${localAssets.length} ${t.fontsUnit}${
            isTauriRuntime() ? "" : ` / ${t.browserImportSafePreview}`
          }`
        );
      } catch (error) {
        setNotice(`${t.folderImportFailed}: ${error instanceof Error ? error.message : t.copyFailed}`);
      } finally {
        setIsImportingFolder(false);
      }
    }, 0);
  }

  function addAssetsToLibrary(
    index: LocalFontIndex,
    localAssets: FontAsset[],
    options: { persistRoot?: boolean; selectFirst?: boolean } = {}
  ) {
    setFonts((currentFonts) => mergeFontAssets(currentFonts, localAssets));
    setLocalIndex((currentIndex) => mergeLocalIndexes(currentIndex, index));
    if (options.persistRoot) void saveFolderRootAsync(index.root);
    if (options.selectFirst && localAssets[0]) setSelectedId(localAssets[0].id);
    setActiveSection("all");
    setCategory(t.all);
    setLanguageFilter("all");
  }

  function toggleFavorite(fontId: string) {
    setFonts((currentFonts) =>
      currentFonts.map((font) =>
        font.id === fontId ? { ...font, isFavorite: !font.isFavorite } : font
      )
    );
  }

  function selectFont(fontId: string, options?: { range?: boolean }) {
    if (!options?.range) {
      setSelectedId(fontId);
      return;
    }

    const targetIndex = filteredFonts.findIndex((font) => font.id === fontId);
    const anchorIndex = filteredFonts.findIndex((font) => font.id === selectedId);

    setSelectedFontIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (targetIndex < 0) return nextIds;
      if (anchorIndex < 0) {
        nextIds.add(fontId);
        return nextIds;
      }

      const startIndex = Math.min(anchorIndex, targetIndex);
      const endIndex = Math.max(anchorIndex, targetIndex);
      filteredFonts
        .slice(startIndex, endIndex + 1)
        .forEach((font) => nextIds.add(font.id));

      return nextIds;
    });
    setSelectedId(fontId);
  }

  function toggleFontSelection(fontId: string) {
    setSelectedFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(fontId)) {
        nextIds.delete(fontId);
      } else {
        nextIds.add(fontId);
      }
      return nextIds;
    });
    setSelectedId(fontId);
  }

  function clearFontSelection() {
    setSelectedFontIds(new Set());
  }

  function getSelectedFontIds() {
    const knownFontIds = new Set(fonts.map((font) => font.id));
    return new Set(Array.from(selectedFontIds).filter((fontId) => knownFontIds.has(fontId)));
  }

  function toggleFavoriteForSelectedFonts() {
    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;

    const shouldFavorite = !areSelectedFontsAllFavorite;
    setFonts((currentFonts) =>
      currentFonts.map((font) =>
        selectedIds.has(font.id) ? { ...font, isFavorite: shouldFavorite } : font
      )
    );
    setNotice(shouldFavorite ? t.selectedFontsFavorited : t.selectedFontsUnfavorited);
  }

  function hideSelectedFonts() {
    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;

    setHiddenFontIds((currentIds) => new Set([...currentIds, ...selectedIds]));
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !selectedIds.has(fontId)));
    clearFontSelection();
    setNotice(t.selectedFontsHidden);
  }

  function removeSelectedFontsFromLibrary() {
    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;

    setRemovedFontIds((currentIds) => new Set([...currentIds, ...selectedIds]));
    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      selectedIds.forEach((fontId) => nextIds.delete(fontId));
      return nextIds;
    });
    setProjectPacks((currentPacks) => removeFontsFromProjectPacks(currentPacks, selectedIds));
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !selectedIds.has(fontId)));
    clearFontSelection();
    setNotice(t.selectedFontsRemoved);
  }

  function removeSelectedFontsFromProjectPack() {
    if (!selectedProjectPack) return;

    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;

    setProjectPacks((currentPacks) =>
      removeFontsFromProjectPackCascade(currentPacks, selectedProjectPack.id, selectedIds)
    );
    clearFontSelection();
    setNotice(t.selectedFontsRemovedFromPack);
  }

  function restoreSelectedFonts() {
    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;
    const [firstSelectedId] = selectedIds;

    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      selectedIds.forEach((fontId) => nextIds.delete(fontId));
      return nextIds;
    });
    setRemovedFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      selectedIds.forEach((fontId) => nextIds.delete(fontId));
      return nextIds;
    });
    setActiveSection("all");
    setCategory(t.all);
    setSelectedId(firstSelectedId);
    clearFontSelection();
    setNotice(t.selectedFontsRestored);
  }

  function selectVariant(fontId: string, variantId: string) {
    setActiveVariantIds((current) => ({ ...current, [fontId]: variantId }));
  }

  function updateFontAxisValue(fontId: string, axisTag: string, value: number) {
    const font = fonts.find((candidate) => candidate.id === fontId);
    const variableVariant = font?.variants.find(isVariableFontVariant);
    if (variableVariant && activeVariantIds[fontId] !== variableVariant.id) {
      setActiveVariantIds((current) => ({ ...current, [fontId]: variableVariant.id }));
    }

    setFontAxisValues((currentValues) => ({
      ...currentValues,
      [fontId]: {
        ...currentValues[fontId],
        [axisTag]: value
      }
    }));
  }

  function hideFont(fontId: string) {
    setHiddenFontIds((currentIds) => new Set(currentIds).add(fontId));
    setNotice(t.fontHidden);
  }

  function restoreFont(fontId: string) {
    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(fontId);
      return nextIds;
    });
    setActiveSection("all");
    setCategory(t.all);
    setSelectedId(fontId);
    setNotice(t.fontRestored);
  }

  function removeFromLibrary(fontId: string) {
    setRemovedFontIds((currentIds) => new Set(currentIds).add(fontId));
    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(fontId);
      return nextIds;
    });
    setRecentFontIds((currentIds) => currentIds.filter((currentId) => currentId !== fontId));
    setProjectPacks((currentPacks) => removeFontsFromProjectPacks(currentPacks, new Set([fontId])));
    setNotice(t.fontRemovedFromLibrary);
  }

  function restoreToLibrary(fontId: string) {
    setRemovedFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(fontId);
      return nextIds;
    });
    setActiveSection("all");
    setCategory(t.all);
    setSelectedId(fontId);
    setNotice(t.fontRestoredToLibrary);
  }

  function updateFontMetadata(fontId: string, patch: FontMetadataOverride) {
    if (patch.category) {
      setCategoryLabels((currentLabels) => uniqueStrings([...currentLabels, patch.category!]));
    }
    setFonts((currentFonts) =>
      currentFonts.map((font) => (font.id === fontId ? { ...font, ...patch } : font))
    );
    setFontOverrides((currentOverrides) => ({
      ...currentOverrides,
      [fontId]: {
        ...currentOverrides[fontId],
        ...patch
      }
    }));
    setNotice(t.metadataUpdated);
  }

  async function installFont(fontId: string) {
    const font = fonts.find((candidate) => candidate.id === fontId);
    if (!font) return;
    if (!isTauriRuntime()) {
      setNotice(t.desktopInstallOnly);
      return;
    }

    const paths = uniqueStrings(
      font.variants
        .filter((variant) => ["ttf", "otf", "ttc"].includes(variant.extension.toLowerCase()))
        .map((variant) => variant.path ?? "")
        .filter(Boolean)
    );
    if (paths.length === 0) {
      setNotice(t.noInstallableFontFiles);
      return;
    }

    setSystemFontBusyId(fontId);
    try {
      const result = await invokeTauri<FontSystemOperationResult>("install_font_files", { paths });
      if (result.paths.length === 0) {
        setNotice(t.noInstallableFontFiles);
        return;
      }

      setInstalledFontFiles((currentFiles) => ({
        ...currentFiles,
        [fontId]: result.paths
      }));
      setSystemFontStatuses((currentStatuses) => ({
        ...currentStatuses,
        [fontId]: "installed"
      }));
      setFonts((currentFonts) =>
        currentFonts.map((currentFont) =>
          currentFont.id === fontId ? { ...currentFont, status: "installed" } : currentFont
        )
      );
      setNotice(`${t.fontInstalled}: ${result.completedFiles} ${t.fileCount}`);
    } catch (error) {
      setNotice(`${t.fontInstallFailed}: ${getErrorMessage(error)}`);
    } finally {
      setSystemFontBusyId(undefined);
    }
  }

  async function uninstallFont(fontId: string) {
    const paths = installedFontFiles[fontId] ?? [];
    if (paths.length === 0) return;
    if (!isTauriRuntime()) {
      setNotice(t.desktopInstallOnly);
      return;
    }
    if (!window.confirm(t.confirmUninstallFont)) return;

    setSystemFontBusyId(fontId);
    try {
      const result = await invokeTauri<FontSystemOperationResult>("uninstall_font_files", {
        paths
      });
      setInstalledFontFiles((currentFiles) => {
        const nextFiles = { ...currentFiles };
        delete nextFiles[fontId];
        return nextFiles;
      });
      setSystemFontStatuses((currentStatuses) => {
        const nextStatuses = { ...currentStatuses };
        delete nextStatuses[fontId];
        return nextStatuses;
      });
      setFonts((currentFonts) =>
        currentFonts.map((currentFont) =>
          currentFont.id === fontId ? { ...currentFont, status: "indexed" } : currentFont
        )
      );
      setNotice(`${t.fontUninstalled}: ${result.completedFiles} ${t.fileCount}`);
    } catch (error) {
      setNotice(`${t.fontUninstallFailed}: ${getErrorMessage(error)}`);
    } finally {
      setSystemFontBusyId(undefined);
    }
  }

  function updateSelectedFontsMetadata(patch: FontMetadataOverride) {
    const selectedIds = getSelectedFontIds();
    if (selectedIds.size === 0) return;

    if (patch.category) {
      setCategoryLabels((currentLabels) => uniqueStrings([...currentLabels, patch.category!]));
    }
    setFonts((currentFonts) =>
      currentFonts.map((font) => (selectedIds.has(font.id) ? { ...font, ...patch } : font))
    );
    setFontOverrides((currentOverrides) => {
      const nextOverrides = { ...currentOverrides };

      selectedIds.forEach((fontId) => {
        nextOverrides[fontId] = {
          ...nextOverrides[fontId],
          ...patch
        };
      });

      return nextOverrides;
    });
    setNotice(`${t.selectedFontsMetadataUpdated}: ${selectedIds.size} ${t.fontsUnit}`);
  }

  function createCategoryLabel(nameInput: string) {
    const name = nameInput.trim();
    if (!name) return;
    if (categoryLabels.some((label) => label.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setNotice(t.categoryAlreadyExists);
      return;
    }

    setCategoryLabels((currentLabels) => [...currentLabels, name]);
    setNotice(`${t.categoryCreated}: ${name}`);
  }

  function renameCategoryLabel(currentName: string, nameInput: string) {
    const nextName = nameInput.trim();
    if (!nextName || nextName === currentName) return;
    if (
      categoryLabels.some(
        (label) =>
          label !== currentName && label.toLocaleLowerCase() === nextName.toLocaleLowerCase()
      )
    ) {
      setNotice(t.categoryAlreadyExists);
      return;
    }

    const affectedFontIds = fonts
      .filter((font) => font.category === currentName)
      .map((font) => font.id);
    setFonts((currentFonts) =>
      currentFonts.map((font) =>
        font.category === currentName ? { ...font, category: nextName } : font
      )
    );
    setFontOverrides((currentOverrides) => {
      const nextOverrides = { ...currentOverrides };
      affectedFontIds.forEach((fontId) => {
        nextOverrides[fontId] = { ...nextOverrides[fontId], category: nextName };
      });
      return nextOverrides;
    });
    setCategoryLabels((currentLabels) =>
      uniqueStrings(currentLabels.map((label) => (label === currentName ? nextName : label)))
    );
    if (category === currentName) setCategory(nextName);
    setNotice(`${t.categoryRenamed}: ${currentName} → ${nextName}`);
  }

  function removeCategoryLabel(categoryName: string) {
    const affectedFonts = fonts.filter((font) => font.category === categoryName);
    if (
      affectedFonts.length > 0 &&
      !window.confirm(
        `${t.confirmRemoveCategory}\n\n${categoryName}\n${affectedFonts.length} ${t.fontsUnit}`
      )
    ) {
      return;
    }

    const fallbackByFontId = new Map(
      affectedFonts.map((font) => [
        font.id,
        font.language === "english" ? t.enOther : t.cnOther
      ])
    );
    setFonts((currentFonts) =>
      currentFonts.map((font) => {
        const fallback = fallbackByFontId.get(font.id);
        return fallback ? { ...font, category: fallback } : font;
      })
    );
    setFontOverrides((currentOverrides) => {
      const nextOverrides = { ...currentOverrides };
      fallbackByFontId.forEach((fallback, fontId) => {
        nextOverrides[fontId] = { ...nextOverrides[fontId], category: fallback };
      });
      return nextOverrides;
    });
    setCategoryLabels((currentLabels) =>
      uniqueStrings([
        ...currentLabels.filter((label) => label !== categoryName),
        ...fallbackByFontId.values()
      ])
    );
    if (category === categoryName) setCategory(t.all);
    setNotice(`${t.categoryRemoved}: ${categoryName}`);
  }

  function moveCategoryLabel(
    categoryName: string,
    targetName: string,
    placement: "before" | "after"
  ) {
    if (categoryName === targetName) return;

    setCategoryLabels((currentLabels) => {
      const sourceIndex = currentLabels.indexOf(categoryName);
      const targetIndex = currentLabels.indexOf(targetName);
      if (sourceIndex < 0 || targetIndex < 0) return currentLabels;

      const nextLabels = currentLabels.filter((label) => label !== categoryName);
      const nextTargetIndex = nextLabels.indexOf(targetName);
      const insertionIndex = nextTargetIndex + (placement === "after" ? 1 : 0);
      nextLabels.splice(insertionIndex, 0, categoryName);

      return nextLabels.every((label, index) => label === currentLabels[index])
        ? currentLabels
        : nextLabels;
    });
  }

  function updateDetailFontMetadata(fontId: string, patch: FontMetadataOverride) {
    if (selectedFontIds.has(fontId) && getSelectedFontIds().size > 1) {
      updateSelectedFontsMetadata(patch);
      return;
    }

    updateFontMetadata(fontId, patch);
  }

  function createProjectPack(nameInput: string, parentId?: string) {
    const name = nameInput.trim();
    if (!name) {
      setNotice(t.projectPackNameRequired);
      return;
    }

    const existingPack = projectPacks.find(
      (pack) => pack.name === name && pack.parentId === parentId
    );
    if (existingPack) {
      setSelectedProjectPackId(existingPack.id);
      setNotice(t.projectPackAlreadyExists);
      return;
    }

    const pack: ProjectPack = {
      id: createProjectPackId(),
      name,
      description: t.projectPackDefaultDescription,
      fontIds: [],
      parentId
    };

    setProjectPacks((currentPacks) => insertProjectPack(currentPacks, pack));
    setSelectedProjectPackId(pack.id);
    setActiveSection("projectPacks");
    setNotice(parentId ? t.projectCategoryCreated : t.projectPackCreated);
  }

  function removeProjectPack(packId: string) {
    const targetPack = projectPacks.find((pack) => pack.id === packId);
    if (!targetPack) return;

    const removedIds = getProjectPackCascadeIds(projectPacks, packId);
    const fontCount = getProjectPackFontIds(projectPacks, packId).size;
    const childCount = removedIds.size - 1;

    if (
      (fontCount > 0 || childCount > 0) &&
      !window.confirm(
        `${t.confirmRemoveProjectPack}\n\n${targetPack.name}\n${fontCount} ${t.fontsUnit}${
          childCount > 0 ? ` / ${childCount} ${t.projectCategoriesUnit}` : ""
        }`
      )
    ) {
      return;
    }

    const nextPacks = projectPacks.filter((pack) => !removedIds.has(pack.id));
    setProjectPacks(nextPacks);
    setSelectedProjectPackId((currentId) =>
      currentId && removedIds.has(currentId) ? nextPacks[0]?.id : currentId
    );
    setNotice(t.projectPackRemoved);
  }

  function renameProjectPack(packId: string, nameInput: string) {
    const name = nameInput.trim();
    if (!name) {
      setNotice(t.projectPackNameRequired);
      return;
    }

    const targetPack = projectPacks.find((pack) => pack.id === packId);
    if (!targetPack) return;

    const existingPack = projectPacks.find(
      (pack) => pack.id !== packId && pack.parentId === targetPack.parentId && pack.name === name
    );
    if (existingPack) {
      setNotice(t.projectPackAlreadyExists);
      return;
    }

    setProjectPacks((currentPacks) =>
      currentPacks.map((pack) => (pack.id === packId ? { ...pack, name } : pack))
    );
    setNotice(t.projectPackRenamed);
  }

  function addFontsToProjectPack(fontIds: string[], packId: string) {
    const targetPack = projectPacks.find((pack) => pack.id === packId);
    if (!targetPack) {
      const diagnostic = window.__YFONTS_LAST_DRAG_DIAGNOSTIC__;
      setNotice(
        `拖拽诊断: pack-not-found, pack=${packId}, fonts=${fontIds.length}, last=${diagnostic?.stage ?? "-"}`
      );
      return;
    }

    const fontIdSet = new Set(fonts.map((font) => font.id));
    const incomingIds = fontIds.filter((fontId) => fontIdSet.has(fontId));
    const newFontIds = incomingIds.filter((fontId) => !targetPack.fontIds.includes(fontId));

    if (incomingIds.length > 0) {
      setSelectedFontIds(new Set());
    }

    if (newFontIds.length === 0) {
      const diagnostic = window.__YFONTS_LAST_DRAG_DIAGNOSTIC__;
      setNotice(
        incomingIds.length === 0
          ? `拖拽诊断: no-valid-fonts, pack=${targetPack.name}, input=${fontIds.length}, last=${diagnostic?.stage ?? "-"}`
          : t.fontAlreadyInPack
      );
      return;
    }

    setProjectPacks((currentPacks) =>
      currentPacks.map((pack) =>
        pack.id === packId ? { ...pack, fontIds: [...newFontIds, ...pack.fontIds] } : pack
      )
    );
    const diagnostic = window.__YFONTS_LAST_DRAG_DIAGNOSTIC__;
    setNotice(
      diagnostic?.stage === "drop-pack"
        ? `拖拽诊断: ok, pack=${targetPack.name}, fonts=${newFontIds.length}`
        : `${t.addedToPack}: ${targetPack.name} / ${newFontIds.length} ${t.fontsUnit}`
    );
  }

  function addFontToCurrentProjectPack(fontId: string) {
    if (!selectedProjectPack) return;

    const selectedIds = getSelectedFontIds();
    const fontIds = selectedIds.has(fontId) && selectedIds.size > 1 ? Array.from(selectedIds) : [fontId];
    addFontsToProjectPack(fontIds, selectedProjectPack.id);
  }

  function removeFontFromProjectPack(fontId: string) {
    if (!selectedProjectPack) return;

    setProjectPacks((currentPacks) =>
      removeFontsFromProjectPackCascade(currentPacks, selectedProjectPack.id, new Set([fontId]))
    );
    setNotice(t.fontRemovedFromPack);
  }

  async function copyFontName(font: FontAsset) {
    await copyText(font.family, t.fontNameCopied);
  }

  async function copyFontPath(font: FontAsset) {
    const variant = getActiveVariant(font, activeVariantIds[font.id]);
    const path = variant.path ?? font.path;
    if (!path) return;

    await copyText(path, t.fontPathCopied);
  }

  async function copyLibraryRoot() {
    if (!localIndex?.root) {
      setNotice(t.noLibraryRoot);
      return;
    }

    await copyText(localIndex.root, t.libraryRootCopied);
  }

  function focusLibrarySource(source: LibrarySourceSummary) {
    setActiveSection("all");
    setSourceFilter(source.source);
    setQuery(source.label);
    setCategory(t.all);
    setLanguageFilter("all");
    setIsLibrarySettingsOpen(false);
  }

  function removeLibrarySource(source: LibrarySourceSummary) {
    const removedIds = new Set(
      fonts.filter((font) => getFontLibrarySourceId(font) === source.id).map((font) => font.id)
    );
    if (removedIds.size === 0) return;

    const fallbackFont = fonts.find((font) => !removedIds.has(font.id));

    setFonts((currentFonts) =>
      currentFonts.filter((font) => getFontLibrarySourceId(font) !== source.id)
    );
    setLocalIndex((currentIndex) => removeLocalIndexSource(currentIndex, source.id));
    setHiddenFontIds((currentIds) => withoutIds(currentIds, removedIds));
    setRemovedFontIds((currentIds) => withoutIds(currentIds, removedIds));
    setSelectedFontIds((currentIds) => withoutIds(currentIds, removedIds));
    setProjectPacks((currentPacks) => removeFontsFromProjectPacks(currentPacks, removedIds));
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !removedIds.has(fontId)));
    if (selectedId && removedIds.has(selectedId)) setSelectedId(fallbackFont?.id);
    if (source.root && source.root !== t.manualImport) void removeSavedFolderRootAsync(source.root);
    setNotice(`${t.sourceRemoved}: ${source.label}`);
  }

  async function rescanLibrarySource(source: LibrarySourceSummary) {
    if (isImportingFolder) return;
    if (source.source !== "local" || !source.root || source.root === t.manualImport) {
      setNotice(t.sourceCannotRescan);
      return;
    }

    setIsImportingFolder(true);
    setNotice(`${t.scanningFolder}: ${source.root}`);

    try {
      const index = await scanFontFolder(source.root);
      const localAssets = localRecordsToAssets(index, { source: "local" });
      if (localAssets.length === 0) {
        setNotice(t.noMatches);
        return;
      }

      const nextFonts = replaceSourceFonts(fonts, source.id, localAssets);
      const nextFontIds = new Set(nextFonts.map((font) => font.id));

      setFonts(nextFonts);
      setLocalIndex((currentIndex) => replaceLocalIndexSource(currentIndex, index, source.id));
      setHiddenFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setRemovedFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setSelectedFontIds((currentIds) => keepKnownIds(currentIds, nextFontIds));
      setRecentFontIds((currentIds) => currentIds.filter((fontId) => nextFontIds.has(fontId)));
      setActiveVariantIds((currentIds) => filterVariantIdsByFontIds(currentIds, nextFontIds));
      setProjectPacks((currentPacks) => keepKnownProjectPackFonts(currentPacks, nextFontIds));
      if (selectedId && !nextFontIds.has(selectedId)) setSelectedId(localAssets[0]?.id ?? nextFonts[0]?.id);
      void saveFolderRootAsync(index.root);
      setNotice(`${t.sourceRescanned}: ${source.label} / ${localAssets.length} ${t.fontsUnit}`);
    } catch (error) {
      setNotice(`${t.folderScanFailed}: ${error instanceof Error ? error.message : t.copyFailed}`);
    } finally {
      setIsImportingFolder(false);
    }
  }

  function focusDuplicateGroup(group: LibraryDuplicateGroup) {
    const keeperId = group.fonts[0]?.id;
    if (!keeperId) return;

    setActiveSection("all");
    setCategory(t.all);
    setQuery("");
    setSelectedId(keeperId);
    setIsLibrarySettingsOpen(false);
  }

  function hideDuplicateExtras(group: LibraryDuplicateGroup) {
    const extraIds = getDuplicateExtraIds(group);
    if (extraIds.size === 0) return;

    setHiddenFontIds((currentIds) => new Set([...currentIds, ...extraIds]));
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !extraIds.has(fontId)));
    setNotice(`${t.duplicateExtrasHidden}: ${extraIds.size} ${t.fontsUnit}`);
  }

  function removeDuplicateExtras(group: LibraryDuplicateGroup) {
    const extraIds = getDuplicateExtraIds(group);
    if (extraIds.size === 0) return;

    const keeperId = group.fonts[0]?.id;
    setRemovedFontIds((currentIds) => new Set([...currentIds, ...extraIds]));
    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      extraIds.forEach((fontId) => nextIds.delete(fontId));
      return nextIds;
    });
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !extraIds.has(fontId)));
    setSelectedFontIds((currentIds) => withoutIds(currentIds, extraIds));
    setProjectPacks((currentPacks) => removeFontsFromProjectPacks(currentPacks, extraIds));
    if (selectedId && extraIds.has(selectedId)) setSelectedId(keeperId);
    setNotice(`${t.duplicateExtrasRemoved}: ${extraIds.size} ${t.fontsUnit}`);
  }

  function removeAllDuplicateExtras() {
    const extraIds = new Set<string>();
    const keeperByExtraId = new Map<string, string>();

    for (const group of libraryDuplicateGroups) {
      const keeperId = group.fonts[0]?.id;
      if (!keeperId) continue;
      for (const font of group.fonts.slice(1)) {
        extraIds.add(font.id);
        keeperByExtraId.set(font.id, keeperId);
      }
    }

    if (extraIds.size === 0) return;
    if (!window.confirm(`${t.removeAllDuplicateConfirm}\n\n${extraIds.size} ${t.fontsUnit}`)) return;

    setRemovedFontIds((currentIds) => new Set([...currentIds, ...extraIds]));
    setHiddenFontIds((currentIds) => {
      const nextIds = new Set(currentIds);
      extraIds.forEach((fontId) => nextIds.delete(fontId));
      return nextIds;
    });
    setRecentFontIds((currentIds) => currentIds.filter((fontId) => !extraIds.has(fontId)));
    setSelectedFontIds((currentIds) => withoutIds(currentIds, extraIds));
    setProjectPacks((currentPacks) => removeFontsFromProjectPacks(currentPacks, extraIds));

    if (selectedId && extraIds.has(selectedId)) {
      setSelectedId(keeperByExtraId.get(selectedId));
    }

    setNotice(`${t.allDuplicateExtrasRemoved}: ${extraIds.size} ${t.fontsUnit}`);
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.append(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand("copy");
      textarea.remove();

      setNotice(copied ? successMessage : t.copyFailed);
    }
  }

  function bindFontToSourceRoot(fontId: string, sourceRoot: string, activePath: string) {
    setFonts((currentFonts) =>
      currentFonts.map((currentFont) => {
        if (currentFont.id !== fontId) return currentFont;

        const activeVariant = getActiveVariant(currentFont, activeVariantIds[currentFont.id]);
        const variants = currentFont.variants.map((currentVariant) => ({
          ...currentVariant,
          libraryRoot: sourceRoot,
          path:
            currentVariant.id === activeVariant.id
              ? activePath
              : resolveBoundFontPath(
                  sourceRoot,
                  currentVariant.relativePath ?? currentVariant.path
                )
        }));

        return {
          ...currentFont,
          libraryRoot: sourceRoot,
          path: activePath,
          variants
        };
      })
    );

    setLocalIndex((currentIndex) => {
      if (!currentIndex) return currentIndex;

      const font = fonts.find((currentFont) => currentFont.id === fontId);
      if (!font) return currentIndex;

      const activeVariant = getActiveVariant(font, activeVariantIds[font.id]);
      const variantIds = new Set(font.variants.map((currentVariant) => currentVariant.id));

      return {
        ...currentIndex,
        fonts: currentIndex.fonts.map((record) =>
          variantIds.has(record.id)
            ? {
                ...record,
                libraryRoot: sourceRoot,
                path:
                  record.id === activeVariant.id
                    ? activePath
                    : resolveBoundFontPath(sourceRoot, record.relativePath || record.path) ??
                      record.path
              }
            : record
        )
      };
    });
  }

  async function openLocation(font: FontAsset) {
    const variant = getActiveVariant(font, activeVariantIds[font.id]);
    const sourceKey = getFontLocationSourceKey(font, variant);
    const sourceRootMappings = await loadSourceRootMappingsAsync();
    const mappedRoot = sourceRootMappings[sourceKey];
    const candidatePaths = resolveFontLocationCandidates(font, variant, [mappedRoot]);
    let allCandidatePaths = [...candidatePaths];
    const path = candidatePaths[0];
    if (!path) return;
    const failedErrors: string[] = [];

    for (const candidatePath of candidatePaths) {
      try {
        await openFontLocation(candidatePath);
        setNotice(
          candidatePath === path
            ? t.locationOpened
            : `${t.locationOpened}: ${candidatePath}`
        );
        return;
      } catch (error) {
        failedErrors.push(
          `${candidatePath}: ${error instanceof Error ? error.message : "failed"}`
        );
      }
    }

    if (isTauriRuntime()) {
      setNotice(getFontSourceRelinkNotice(path));
      const locatedRoot = await pickFontSourceRoot(getSuggestedFolderPickerPath(candidatePaths)).catch(
        () => undefined
      );
      if (locatedRoot) {
        const relocatedCandidates = resolveFontLocationCandidates(font, variant, [locatedRoot]);
        allCandidatePaths = uniqueStrings([...relocatedCandidates, ...allCandidatePaths]);

        for (const candidatePath of relocatedCandidates) {
          try {
            await openFontLocation(candidatePath);
            const boundRoot = inferBoundSourceRoot(locatedRoot, candidatePath, variant);
            bindFontToSourceRoot(font.id, boundRoot, candidatePath);
            void saveSourceRootMappingAsync(sourceKey, boundRoot);
            void saveFolderRootAsync(boundRoot);
            setNotice(`${t.locationOpened}: ${candidatePath}`);
            return;
          } catch (error) {
            failedErrors.push(
              `${candidatePath}: ${error instanceof Error ? error.message : "failed"}`
            );
          }
        }
      }
    }

    const diagnosticPath = allCandidatePaths.find(isAbsoluteFilesystemPath) ?? path;
    const diagnostic = await diagnoseFontLocation(diagnosticPath).catch(() => undefined);
    const diagnosticText = diagnostic
      ? ` / ${t.openLocationDiagnostic}: exists=${diagnostic.exists}, file=${diagnostic.isFile}, parent=${diagnostic.parentExists}, folder=${diagnostic.targetFolder ?? "-"}`
      : "";
    const candidatesText = ` / candidates=${allCandidatePaths.slice(0, 6).join(" | ")}`;

    try {
      await navigator.clipboard.writeText(diagnosticPath);
      setNotice(
        `${t.openLocationFailed}: ${failedErrors[0] ?? t.copiedPath}${diagnosticText}${candidatesText}`
      );
    } catch {
      window.prompt(t.openLocation, path);
    }
  }

  async function exportProjectPackManifest() {
    if (!selectedProjectPack) return;

    const packFontIds = getProjectPackFontIds(projectPacks, selectedProjectPack.id);
    const packFonts = fonts.filter((font) => packFontIds.has(font.id) && !removedFontIds.has(font.id));

    if (packFonts.length === 0) {
      setNotice(t.projectPackExportEmpty);
      return;
    }

    const manifest = createProjectPackManifest({
      pack: selectedProjectPack,
      packs: projectPacks,
      fonts: packFonts,
      activeVariantIds,
      platformLabel: platform.label
    });
    const filename = `${sanitizeFilename(selectedProjectPack.name)}-YFonts.json`;
    const manifestText = JSON.stringify(manifest, null, 2);

    try {
      if (isTauriRuntime()) {
        const result = (await invokeTauri("export_project_pack_bundle", {
          suggestedName: sanitizeFilename(selectedProjectPack.name),
          manifestContent: manifestText,
          files: createProjectPackBundleFiles(packFonts)
        })) as ProjectPackBundleResult;

        if (result.status === "cancelled") {
          setNotice(t.projectPackExportCancelled);
          return;
        }

        const skippedFiles = result.skippedFiles ?? 0;
        setNotice(
          skippedFiles > 0
            ? `${t.projectPackBundleExported}: ${result.path} / ${result.copiedFiles ?? 0} ${t.filesUnit} / ${skippedFiles} ${t.projectPackSkippedFiles}`
            : `${t.projectPackBundleExported}: ${result.path} / ${result.copiedFiles ?? 0} ${t.filesUnit}`
        );
        return;
      }

      const result = await saveTextFile(filename, manifestText, "application/json");
      if (result.status === "cancelled") {
        setNotice(t.projectPackExportCancelled);
        return;
      }

      setNotice(
        result.status === "picked"
          ? `${t.projectPackExportedToChosenPath}: ${result.path ?? result.filename}`
          : `${t.projectPackExportedToDownloads}: ${result.filename} / ${t.browserManifestOnly}`
      );
    } catch (error) {
      setNotice(`${t.projectPackExportFailed}: ${error instanceof Error ? error.message : t.copyFailed}`);
    }
  }

  function openLicense(font: FontAsset) {
    const url =
      font.licenseUrl ??
      `https://www.google.com/search?q=${encodeURIComponent(`${font.family} font license`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className={[
        "app-shell",
        isSidebarCollapsed ? "sidebar-collapsed" : "",
        themeMode === "dark" ? "dark" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ListFontFaceDefinitions fonts={fontFaceFonts} activeVariantIds={activeVariantIds} />
      <DetailFontFaceDefinition
        font={selectedFont}
        variantId={selectedVariantId}
        familyName={selectedDetailFontFamily}
      />
      <WindowTitleBar themeMode={themeMode} />
      <Sidebar
        activeSection={activeSection}
        onChange={setActiveSection}
        counts={counts}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
        hasSelectedFonts={selectedFontIds.size > 0}
        projectPacks={projectPacks}
        selectedProjectPackId={selectedProjectPack?.id}
        onCreateProjectPack={createProjectPack}
        onRenameProjectPack={renameProjectPack}
        onSelectProjectPack={(packId) => {
          setSelectedProjectPackId(packId);
          setActiveSection("projectPacks");
        }}
        onRemoveProjectPack={removeProjectPack}
        onDropFontsToProjectPack={addFontsToProjectPack}
      />

      <main className="workspace">
        <TopBar
          query={query}
          onQueryChange={setQuery}
          previewText={previewText}
          onPreviewTextChange={setPreviewText}
          licenseFilter={licenseFilter}
          onLicenseFilterChange={setLicenseFilter}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          languageFilter={languageFilter}
          onLanguageFilterChange={setLanguageFilter}
          isImportingFolder={isImportingFolder}
          onOpenLibrarySettings={() => setIsLibrarySettingsOpen(true)}
          onImportFolder={importFolder}
          onImportFiles={importFiles}
          onReloadIndex={() => void reloadLocalIndex(true)}
          themeMode={themeMode}
          onToggleTheme={() => setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))}
        />

        <div className="workspace-grid">
          <section className="browser-pane">
            <div className="browser-header">
              <div>
                <strong>
                  {activeSection === "all"
                    ? t.fontLibrary
                    : activeSection === "projectPacks"
                      ? t.projectPacks
                      : t.filteredResults}
                </strong>
                <span>
                  {filteredFonts.length} / {managedFonts.length} {t.fontsUnit}
                  {totalFontFiles ? ` · ${totalFontFiles} ${t.filesUnit}` : ""} · {platform.label}
                </span>
                {localIndex && <em>{localIndex.root}</em>}
                {notice && <p className="notice-line">{notice}</p>}
                {activeSection === "projectPacks" && selectedProjectPack && (
                  <button
                    className="mini-tool header-action"
                    type="button"
                    onClick={() => void exportProjectPackManifest()}
                  >
                    {t.exportProjectPack}
                  </button>
                )}
              </div>
              <div className="browser-tools">
                <div
                  className="category-tabs"
                  aria-label={t.filters}
                  onWheel={scrollCategoryTabs}
                >
                  {categories.map((item) => (
                    <button
                      key={item}
                      className={category === item ? "tab active" : "tab"}
                      type="button"
                      onClick={() => setCategory(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <button
                  className="icon-button category-manage-button"
                  type="button"
                  title={t.manageCategories}
                  aria-label={t.manageCategories}
                  onClick={() => setIsCategoryManagerOpen(true)}
                >
                  <Tags size={17} />
                </button>
                <div className="preview-scale-control">
                  <input
                    aria-label={t.previewScale}
                    type="range"
                    min="42"
                    max="104"
                    step="2"
                    value={previewSize}
                    onChange={(event) => setPreviewSize(Number(event.target.value))}
                  />
                </div>
              </div>
            </div>

            <LicenseOverviewBar
              freeCount={licenseOverview.freeCount}
              reviewCount={licenseOverview.reviewCount}
              totalCount={licenseOverview.totalCount}
              onOpenReview={() => {
                setActiveSection("review");
                setCategory(t.all);
                setLicenseFilter("all");
                setSourceFilter("all");
              }}
            />

            <BulkActionBar
              activeSection={activeSection}
              selectedCount={selectedFilteredFonts.length}
              totalCount={filteredFonts.length}
              allFavorite={areSelectedFontsAllFavorite}
              availableCategories={metadataCategories}
              onClear={clearFontSelection}
              onToggleFavorite={toggleFavoriteForSelectedFonts}
              onHide={hideSelectedFonts}
              onRemove={
                activeSection === "projectPacks"
                  ? removeSelectedFontsFromProjectPack
                  : removeSelectedFontsFromLibrary
              }
              onRestore={restoreSelectedFonts}
              onUpdateMetadata={updateSelectedFontsMetadata}
              onOpenCompare={() => setIsComparePanelOpen(true)}
            />

            {!query.trim() && (
              <RecentFontStrip
                fonts={recentFonts}
                selectedId={selectedFont?.id}
                previewText={previewText}
                activeVariantIds={activeVariantIds}
                fontAxisValues={fontAxisValues}
                activePreviewFamily={selectedDetailFontFamily}
                onSelect={setSelectedId}
              />
            )}

            <FontList
              fonts={filteredFonts}
              selectedId={selectedFont?.id}
              previewText={previewText}
              previewSize={previewSize}
              activePreviewFamily={selectedDetailFontFamily}
              hiddenFontIds={hiddenFontIds}
              removedFontIds={removedFontIds}
              selectedFontIds={selectedFontIds}
              activeVariantIds={activeVariantIds}
              fontAxisValues={fontAxisValues}
              emptyTitle={activeSection === "projectPacks" ? t.packEmpty : undefined}
              emptyHint={activeSection === "projectPacks" ? t.projectPackDropHint : undefined}
              onSelect={selectFont}
              onToggleSelection={toggleFontSelection}
              onSelectVariant={selectVariant}
              onToggleFavorite={toggleFavorite}
              onHideFont={hideFont}
              onRestoreFont={restoreFont}
              onRemoveFromLibrary={removeFromLibrary}
              onRestoreToLibrary={restoreToLibrary}
              isProjectPackView={activeSection === "projectPacks"}
              onRemoveFromProjectPack={removeFontFromProjectPack}
              onOpenLocation={(font) => void openLocation(font)}
              onCopyFontName={(font) => void copyFontName(font)}
              onCopyFontPath={(font) => void copyFontPath(font)}
              onVisibleFontIdsChange={setVisibleListFontIds}
            />
          </section>

          <div className="side-stack">
            <DetailsPanel
              font={selectedFont}
              platform={platform}
              previewText={previewText}
              activeVariantId={selectedVariantId}
              detailFontFamily={selectedDetailFontFamily}
              availableCategories={metadataCategories}
              isAutoPlayingVariants={isAutoPlayingVariants}
              canAutoPlayVariants={selectedPreviewableVariants.length > 1}
              axisValues={selectedFont ? fontAxisValues[selectedFont.id] : undefined}
              isHidden={selectedFontIsHidden}
              isRemoved={selectedFontIsRemoved}
              isDesktopRuntime={isTauriRuntime()}
              isInstalledByYFonts={
                selectedFont ? (installedFontFiles[selectedFont.id]?.length ?? 0) > 0 : false
              }
              systemFontStatus={
                selectedFont ? systemFontStatuses[selectedFont.id] : undefined
              }
              isSystemFontBusy={selectedFont?.id === systemFontBusyId}
              onSelectVariant={selectVariant}
              onToggleAutoPlayVariants={() =>
                setIsAutoPlayingVariants((isAutoPlaying) => !isAutoPlaying)
              }
              onAxisValueChange={updateFontAxisValue}
              onHideFont={hideFont}
              onRestoreFont={restoreFont}
              onRemoveFromLibrary={removeFromLibrary}
              onRestoreToLibrary={restoreToLibrary}
              onUpdateFontMetadata={updateDetailFontMetadata}
              onAddToCurrentProjectPack={addFontToCurrentProjectPack}
              onInstallFont={installFont}
              onUninstallFont={uninstallFont}
              onOpenLocation={openLocation}
              onOpenLicense={openLicense}
            />
          </div>
        </div>
      </main>

      <LibrarySettingsPanel
        open={isLibrarySettingsOpen}
        localIndex={localIndex}
        platform={platform}
        stats={libraryStats}
        sources={librarySources}
        duplicateGroups={libraryDuplicateGroups}
        isImportingFolder={isImportingFolder}
        onClose={() => setIsLibrarySettingsOpen(false)}
        onImportFolder={importFolder}
        onImportFiles={importFiles}
        onReloadIndex={() => void reloadLocalIndex(true)}
        onCopyRoot={() => void copyLibraryRoot()}
        onFocusSource={focusLibrarySource}
        onRescanSource={(source) => void rescanLibrarySource(source)}
        onRemoveSource={removeLibrarySource}
        onFocusDuplicate={focusDuplicateGroup}
        onHideDuplicateExtras={hideDuplicateExtras}
        onRemoveDuplicateExtras={removeDuplicateExtras}
        onRemoveAllDuplicateExtras={removeAllDuplicateExtras}
      />

      <CategoryManagerDialog
        open={isCategoryManagerOpen}
        categories={categoryLabels}
        fonts={fonts}
        onClose={() => setIsCategoryManagerOpen(false)}
        onCreate={createCategoryLabel}
        onRename={renameCategoryLabel}
        onRemove={removeCategoryLabel}
        onMove={moveCategoryLabel}
      />

      <FolderScanDialog
        open={isFolderImportDialogOpen}
        value={folderImportPath}
        isScanning={isImportingFolder}
        onChange={setFolderImportPath}
        onClose={() => setIsFolderImportDialogOpen(false)}
        onChooseFolder={chooseFolderFiles}
        onSubmit={() => void submitFolderImport()}
      />

      <FontComparePanel
        open={isComparePanelOpen}
        fonts={selectedFilteredFonts}
        previewText={previewText}
        previewSize={previewSize}
        activeVariantIds={activeVariantIds}
        fontAxisValues={fontAxisValues}
        onClose={() => setIsComparePanelOpen(false)}
      />
    </div>
  );
}

function CategoryManagerDialog({
  open,
  categories,
  fonts,
  onClose,
  onCreate,
  onRename,
  onRemove,
  onMove
}: {
  open: boolean;
  categories: string[];
  fonts: FontAsset[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (currentName: string, nextName: string) => void;
  onRemove: (name: string) => void;
  onMove: (name: string, targetName: string, placement: "before" | "after") => void;
}) {
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<string>();
  const [editingValue, setEditingValue] = useState("");
  const [draggingCategory, setDraggingCategory] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    name: string;
    placement: "before" | "after";
  }>();
  const [dragPreview, setDragPreview] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const categoryListRef = useRef<HTMLDivElement>(null);
  const dragListenersCleanupRef = useRef<() => void>();
  const dragStateRef = useRef<{
    categoryName: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    handle: HTMLButtonElement;
    targetName?: string;
    placement?: "before" | "after";
  }>();

  useEffect(() => {
    if (!open) {
      setNewCategory("");
      setEditingCategory(undefined);
      setEditingValue("");
      setDraggingCategory(undefined);
      setDropTarget(undefined);
      setDragPreview(undefined);
      dragListenersCleanupRef.current?.();
      dragListenersCleanupRef.current = undefined;
      dragStateRef.current = undefined;
      return;
    }

    function handleKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editingCategory) {
        setEditingCategory(undefined);
        setEditingValue("");
      } else {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [editingCategory, onClose, open]);

  useEffect(() => {
    return () => {
      dragListenersCleanupRef.current?.();
    };
  }, []);

  if (!open) return null;

  const categoryCounts = new Map<string, number>();
  fonts.forEach((font) => {
    categoryCounts.set(font.category, (categoryCounts.get(font.category) ?? 0) + 1);
  });

  function submitNewCategory() {
    const name = newCategory.trim();
    if (!name) return;
    onCreate(name);
    setNewCategory("");
  }

  function startEditing(name: string) {
    setEditingCategory(name);
    setEditingValue(name);
  }

  function submitRename() {
    if (!editingCategory) return;
    onRename(editingCategory, editingValue);
    setEditingCategory(undefined);
    setEditingValue("");
  }

  function beginCategoryDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    categoryName: string
  ) {
    if (event.button !== 0) return;

    const categoryItem = event.currentTarget.closest<HTMLElement>(".category-manager-item");
    if (!categoryItem) return;

    const itemRect = categoryItem.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      categoryName,
      pointerId: event.pointerId,
      offsetX: event.clientX - itemRect.left,
      offsetY: event.clientY - itemRect.top,
      handle: event.currentTarget
    };
    setDraggingCategory(categoryName);
    setDropTarget(undefined);
    setDragPreview({
      left: itemRect.left,
      top: itemRect.top,
      width: itemRect.width,
      height: itemRect.height
    });

    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      pointerEvent.preventDefault();
      updateCategoryDrag(pointerEvent.pointerId, pointerEvent.clientX, pointerEvent.clientY);
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      completeCategoryDrag(pointerEvent.pointerId, true);
    }

    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      completeCategoryDrag(pointerEvent.pointerId, false);
    }

    const cleanupListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
    dragListenersCleanupRef.current?.();
    dragListenersCleanupRef.current = cleanupListeners;
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }

  function updateCategoryDrag(pointerId: number, clientX: number, clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;

    setDragPreview((currentPreview) =>
      currentPreview
        ? {
            ...currentPreview,
            left: clientX - dragState.offsetX,
            top: clientY - dragState.offsetY
          }
        : currentPreview
    );

    const list = categoryListRef.current;
    if (list) {
      const listRect = list.getBoundingClientRect();
      const edgeSize = 42;
      if (clientY < listRect.top + edgeSize) list.scrollTop -= 14;
      if (clientY > listRect.bottom - edgeSize) list.scrollTop += 14;
    }

    const targetItem = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".category-manager-item[data-category-name]");
    const targetName = targetItem?.dataset.categoryName;
    if (!targetItem || !targetName || targetName === dragState.categoryName) {
      setDropTarget(undefined);
      dragState.targetName = undefined;
      dragState.placement = undefined;
      return;
    }

    const targetRect = targetItem.getBoundingClientRect();
    const placement = clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
    dragState.targetName = targetName;
    dragState.placement = placement;
    setDropTarget({ name: targetName, placement });
  }

  function completeCategoryDrag(pointerId: number, shouldCommit: boolean) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;

    if (dragState.handle.hasPointerCapture(pointerId)) {
      dragState.handle.releasePointerCapture(pointerId);
    }
    if (
      shouldCommit &&
      dragState.targetName &&
      dragState.placement &&
      dragState.targetName !== dragState.categoryName
    ) {
      onMove(dragState.categoryName, dragState.targetName, dragState.placement);
    }
    dragListenersCleanupRef.current?.();
    dragListenersCleanupRef.current = undefined;
    dragStateRef.current = undefined;
    setDraggingCategory(undefined);
    setDropTarget(undefined);
    setDragPreview(undefined);
  }

  function moveCategoryWithKeyboard(categoryName: string, direction: -1 | 1) {
    const categoryIndex = categories.indexOf(categoryName);
    const targetIndex = categoryIndex + direction;
    const targetName = categories[targetIndex];
    if (!targetName) return;

    onMove(categoryName, targetName, direction < 0 ? "before" : "after");
  }

  return (
    <div className="category-manager-shell" role="dialog" aria-modal="true" aria-label={t.manageCategories}>
      <button className="category-manager-scrim" type="button" aria-label={t.close} onClick={onClose} />
      <section className="category-manager-dialog">
        <header>
          <div>
            <span>{t.styleCategory}</span>
            <strong>{t.manageCategories}</strong>
          </div>
          <button className="icon-button" type="button" title={t.close} aria-label={t.close} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <form
          className="category-create-row"
          onSubmit={(event) => {
            event.preventDefault();
            submitNewCategory();
          }}
        >
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder={t.newCategoryName}
            autoFocus
          />
          <button className="command-button" type="submit" disabled={!newCategory.trim()}>
            <Plus size={16} />
            {t.createCategory}
          </button>
        </form>

        <div
          className={`category-manager-list${draggingCategory ? " reordering" : ""}`}
          ref={categoryListRef}
        >
          {categories.map((categoryName) => {
            const isEditing = editingCategory === categoryName;
            const isProtected = categoryName === t.cnOther || categoryName === t.enOther;
            const dropPlacement =
              dropTarget?.name === categoryName ? ` drop-${dropTarget.placement}` : "";
            return (
              <div
                className={`category-manager-item${
                  draggingCategory === categoryName ? " dragging" : ""
                }${dropPlacement}`}
                data-category-name={categoryName}
                key={categoryName}
              >
                {isEditing ? (
                  <form
                    className="category-rename-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitRename();
                    }}
                  >
                    <input
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      autoFocus
                    />
                    <button className="mini-tool active" type="submit" disabled={!editingValue.trim()}>
                      {t.confirm}
                    </button>
                    <button
                      className="mini-tool"
                      type="button"
                      onClick={() => {
                        setEditingCategory(undefined);
                        setEditingValue("");
                      }}
                    >
                      {t.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="category-drag-handle"
                      type="button"
                      title={t.reorderCategory}
                      aria-label={`${t.reorderCategory}: ${categoryName}`}
                      aria-pressed={draggingCategory === categoryName}
                      onPointerDown={(event) => beginCategoryDrag(event, categoryName)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveCategoryWithKeyboard(categoryName, -1);
                        }
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveCategoryWithKeyboard(categoryName, 1);
                        }
                      }}
                    >
                      <GripVertical size={16} />
                    </button>
                    <div className="category-manager-item-label">
                      <strong>{categoryName}</strong>
                      <span>
                        {categoryCounts.get(categoryName) ?? 0} {t.fontsUnit}
                      </span>
                    </div>
                    <button
                      className="category-icon-button"
                      type="button"
                      title={t.renameCategory}
                      aria-label={`${t.renameCategory}: ${categoryName}`}
                      disabled={isProtected}
                      onClick={() => startEditing(categoryName)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="category-icon-button danger"
                      type="button"
                      title={t.removeCategory}
                      aria-label={`${t.removeCategory}: ${categoryName}`}
                      disabled={isProtected}
                      onClick={() => onRemove(categoryName)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="category-manager-note">{t.categoryManagerHint}</p>
      </section>
      {dragPreview && draggingCategory ? (
        <div
          className="category-drag-preview"
          style={
            {
              "--category-drag-left": `${dragPreview.left}px`,
              "--category-drag-top": `${dragPreview.top}px`,
              "--category-drag-width": `${dragPreview.width}px`,
              "--category-drag-height": `${dragPreview.height}px`
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span className="category-drag-preview-handle">
            <GripVertical size={16} />
          </span>
          <div className="category-manager-item-label">
            <strong>{draggingCategory}</strong>
            <span>
              {categoryCounts.get(draggingCategory) ?? 0} {t.fontsUnit}
            </span>
          </div>
          <span className="category-drag-preview-action">
            <Pencil size={15} />
          </span>
          <span className="category-drag-preview-action">
            <Trash2 size={15} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function FolderScanDialog({
  open,
  value,
  isScanning,
  onChange,
  onClose,
  onChooseFolder,
  onSubmit
}: {
  open: boolean;
  value: string;
  isScanning: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onChooseFolder: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyboard);

    return () => {
      document.removeEventListener("keydown", handleKeyboard);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="folder-scan-shell" role="dialog" aria-modal="true" aria-label={t.scanFolderTitle}>
      <button className="folder-scan-scrim" type="button" aria-label={t.close} onClick={onClose} />
      <form
        className="folder-scan-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <span>{t.importFolder}</span>
          <strong>{t.scanFolderTitle}</strong>
        </header>
        <label>
          <span>{t.folderPath}</span>
          <div className="folder-path-row">
            <input
              autoFocus
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="C:\\Users\\...\\Fonts"
            />
            <button
              className="command-button ghost"
              type="button"
              disabled={isScanning}
              onClick={onChooseFolder}
            >
              {t.chooseFolder}
            </button>
          </div>
        </label>
        <div className="folder-scan-actions">
          <button className="command-button ghost" type="button" onClick={onClose}>
            {t.close}
          </button>
          <button className="command-button" type="submit" disabled={isScanning || !value.trim()}>
            {isScanning ? t.scanningFolder : t.startScan}
          </button>
        </div>
      </form>
    </div>
  );
}

function FontComparePanel({
  open,
  fonts,
  previewText,
  previewSize,
  activeVariantIds,
  fontAxisValues,
  onClose
}: {
  open: boolean;
  fonts: FontAsset[];
  previewText: string;
  previewSize: number;
  activeVariantIds: Record<string, string>;
  fontAxisValues: Record<string, FontAxisValues>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyboard);

    return () => {
      document.removeEventListener("keydown", handleKeyboard);
    };
  }, [onClose, open]);

  if (!open) return null;

  const comparedFonts = fonts.slice(0, 8);

  return (
    <div className="compare-shell" role="dialog" aria-modal="true" aria-label={t.compareFonts}>
      <button className="compare-scrim" type="button" aria-label={t.close} onClick={onClose} />
      <section className="compare-panel">
        <header>
          <div>
            <span>{t.compareFonts}</span>
            <strong>
              {comparedFonts.length} / {fonts.length} {t.fontsUnit}
            </strong>
          </div>
          <button className="mini-tool" type="button" onClick={onClose}>
            {t.close}
          </button>
        </header>
        <div className="compare-list" style={{ "--compare-size": `${Math.min(previewSize, 78)}px` } as CSSProperties}>
          {comparedFonts.map((font) => {
            const activeVariant = getActiveVariant(font, activeVariantIds[font.id]);
            const preview = resolveFontPreviewText(font, previewText);
            const activeVariantIsVariable = isVariableFontVariant(activeVariant);
            const variationSettings = activeVariantIsVariable
              ? getFontVariationSettings(font, fontAxisValues[font.id])
              : undefined;
            const previewWeight = activeVariantIsVariable
              ? fontAxisValues[font.id]?.wght ??
                font.variableAxes?.find((axis) => axis.tag === "wght")?.value ??
                500
              : activeVariant.weight || 500;

            return (
              <article className="compare-row" key={font.id}>
                <div className="compare-meta">
                  <strong>{font.family}</strong>
                  <span>
                    {activeVariant.styleName} / {font.category} / {font.licenseLabel}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: font.cssFamily,
                    fontWeight: previewWeight,
                    fontStyle: activeVariant.isItalic ? "italic" : "normal",
                    fontVariationSettings: variationSettings
                  }}
                >
                  {preview}
                </p>
              </article>
            );
          })}
        </div>
        {fonts.length > comparedFonts.length && (
          <p className="compare-note">{t.compareLimitHint}</p>
        )}
      </section>
    </div>
  );
}

function LicenseOverviewBar({
  freeCount,
  reviewCount,
  totalCount,
  onOpenReview
}: {
  freeCount: number;
  reviewCount: number;
  totalCount: number;
  onOpenReview: () => void;
}) {
  if (totalCount === 0) return null;

  return (
    <div className="license-overview-bar">
      <div>
        <strong>{t.licenseOverview}</strong>
        <span>
          {t.freeCommercial} {freeCount} / {t.licenseReview} {reviewCount}
        </span>
      </div>
      <button className="mini-tool" type="button" disabled={reviewCount === 0} onClick={onOpenReview}>
        {reviewCount === 0 ? t.licenseAllClear : t.viewLicenseReview}
      </button>
    </div>
  );
}

function BulkActionBar({
  activeSection,
  selectedCount,
  totalCount,
  allFavorite,
  availableCategories,
  onClear,
  onToggleFavorite,
  onHide,
  onRemove,
  onRestore,
  onUpdateMetadata,
  onOpenCompare
}: {
  activeSection: SectionId;
  selectedCount: number;
  totalCount: number;
  allFavorite: boolean;
  availableCategories: string[];
  onClear: () => void;
  onToggleFavorite: () => void;
  onHide: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onUpdateMetadata: (patch: FontMetadataOverride) => void;
  onOpenCompare: () => void;
}) {
  const [isMetadataMenuOpen, setIsMetadataMenuOpen] = useState(false);

  const isRemovedView = activeSection === "removed";
  const isHiddenView = activeSection === "hidden";
  const isProjectPackView = activeSection === "projectPacks";

  if (selectedCount === 0) return null;

  function applyCategory(category: string) {
    if (!category) return;
    onUpdateMetadata({ category });
  }

  function applyLicense(license: LicenseKind) {
    onUpdateMetadata({
      license,
      licenseLabel: getLicenseMetadataLabel(license)
    });
  }

  return (
    <div className="bulk-action-bar">
      <div className="bulk-summary">
        <strong>
          {t.selectedCount} {selectedCount} {t.fontsUnit}
        </strong>
        <span>
          {t.filteredResults} {totalCount} {t.fontsUnit} / {t.selectionHint}
        </span>
      </div>
      <div className="bulk-actions">
        <button className="mini-tool" type="button" onClick={onClear}>
          {t.clearSelection}
        </button>
        <button
          className="mini-tool"
          type="button"
          disabled={selectedCount < 2}
          onClick={onOpenCompare}
        >
          {t.compareFonts}
        </button>
        {!isRemovedView && (
          <div
            className="bulk-mark-wrap"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              className={isMetadataMenuOpen ? "mini-tool active" : "mini-tool"}
              type="button"
              onClick={() => setIsMetadataMenuOpen((isOpen) => !isOpen)}
            >
              {t.batchMetadata}
            </button>
            {isMetadataMenuOpen && (
              <div className="bulk-mark-menu">
                <label>
                  <span>{t.styleCategory}</span>
                  <select
                    value=""
                    onChange={(event) => applyCategory(event.target.value)}
                  >
                    <option value="" disabled>
                      {t.chooseStyleCategory}
                    </option>
                    {availableCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t.licenseMark}</span>
                  <select
                    value=""
                    onChange={(event) => applyLicense(event.target.value as LicenseKind)}
                  >
                    <option value="" disabled>
                      {t.chooseLicenseMark}
                    </option>
                    {licenseMetadataOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}
        {isRemovedView ? (
          <button className="mini-tool active" type="button" onClick={onRestore}>
            {t.batchRestore}
          </button>
        ) : isHiddenView ? (
          <>
            <button className="mini-tool active" type="button" onClick={onRestore}>
              {t.batchRestore}
            </button>
            <button className="mini-tool danger" type="button" onClick={onRemove}>
              {t.batchRemove}
            </button>
          </>
        ) : (
          <>
            <button className="mini-tool" type="button" onClick={onToggleFavorite}>
              {allFavorite ? t.batchCancelFavorite : t.batchFavorite}
            </button>
            <button className="mini-tool" type="button" onClick={onHide}>
              {t.batchHide}
            </button>
            <button className="mini-tool danger" type="button" onClick={onRemove}>
              {isProjectPackView ? t.batchRemoveFromPack : t.batchRemove}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RecentFontStrip({
  fonts,
  selectedId,
  previewText,
  activeVariantIds,
  fontAxisValues,
  activePreviewFamily,
  onSelect
}: {
  fonts: FontAsset[];
  selectedId?: string;
  previewText: string;
  activeVariantIds: Record<string, string>;
  fontAxisValues: Record<string, FontAxisValues>;
  activePreviewFamily: string;
  onSelect: (fontId: string) => void;
}) {
  if (fonts.length === 0) return null;

  return (
    <section className="recent-strip" aria-label={t.recentFonts}>
      <div className="recent-strip-title">
        <span>{t.recentFonts}</span>
        <em>{t.recentFontsHint}</em>
      </div>
      <div className="recent-font-grid">
        {fonts.map((font) => {
          const activeVariant = getActiveVariant(font, activeVariantIds[font.id]);
          const activeVariantIsVariable = isVariableFontVariant(activeVariant);
          const variationSettings = activeVariantIsVariable
            ? getFontVariationSettings(font, fontAxisValues[font.id])
            : undefined;
          const previewWeight = activeVariantIsVariable
            ? fontAxisValues[font.id]?.wght ??
              font.variableAxes?.find((axis) => axis.tag === "wght")?.value ??
              500
            : activeVariant.weight || 500;
          const previewFamily =
            selectedId === font.id && activeVariant.fontUrl && activeVariant.isPreviewable
              ? `"${activePreviewFamily}", ${font.cssFamily}`
              : font.cssFamily;
          const preview = resolveFontPreviewText(font, previewText);

          return (
            <button
              key={font.id}
              className={selectedId === font.id ? "recent-font active" : "recent-font"}
              type="button"
              onClick={() => onSelect(font.id)}
              title={font.family}
            >
              <strong>{font.family}</strong>
              <span
                style={{
                  fontFamily: previewFamily,
                  fontWeight: previewWeight,
                  fontStyle: activeVariant.isItalic ? "italic" : "normal",
                  fontVariationSettings: variationSettings
                }}
              >
                {preview}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ListFontFaceDefinitions({
  fonts,
  activeVariantIds
}: {
  fonts: FontAsset[];
  activeVariantIds: Record<string, string>;
}) {
  const styleRef = useRef<HTMLStyleElement>(null);
  const registeredRulesRef = useRef(new Set<string>());

  useEffect(() => {
    const sheet = styleRef.current?.sheet;
    if (!sheet) return;

    for (const font of fonts) {
      const variant = getActiveVariant(font, activeVariantIds[font.id]);
      if (!font.previewFamily || !variant.fontUrl || !variant.isPreviewable) continue;

      const ruleKey = `${font.previewFamily}|${variant.id}|${variant.fontUrl}`;
      if (registeredRulesRef.current.has(ruleKey)) continue;

      const rule = `@font-face {
  font-family: "${escapeCssString(font.previewFamily)}";
  src: url("${escapeCssString(variant.fontUrl)}") format("${variant.fontFormat ?? "truetype"}");
  font-weight: ${getFontFaceWeightDescriptor(font, variant)};
  font-style: ${variant.isItalic ? "italic" : "normal"};
  font-display: swap;
}`;

      try {
        sheet.insertRule(rule, sheet.cssRules.length);
        registeredRulesRef.current.add(ruleKey);
      } catch {
        // A malformed font URL should not interrupt the rest of the preview list.
      }
    }
  }, [activeVariantIds, fonts]);

  return <style ref={styleRef} data-yfonts-preview-fonts />;
}

function DetailFontFaceDefinition({
  font,
  variantId,
  familyName
}: {
  font?: FontAsset;
  variantId?: string;
  familyName: string;
}) {
  const styleRef = useRef<HTMLStyleElement>(null);
  const registeredRulesRef = useRef(new Set<string>());

  useEffect(() => {
    if (!font) return;
    const variant = getActiveVariant(font, variantId);
    if (!variant.fontUrl || !variant.isPreviewable) return;

    const sheet = styleRef.current?.sheet;
    if (!sheet) return;
    const ruleKey = `${familyName}|${variant.id}|${variant.fontUrl}`;
    if (registeredRulesRef.current.has(ruleKey)) return;

    const rule = `@font-face {
  font-family: "${escapeCssString(familyName)}";
  src: url("${escapeCssString(variant.fontUrl)}") format("${variant.fontFormat ?? "truetype"}");
  font-weight: ${getFontFaceWeightDescriptor(font, variant)};
  font-style: ${variant.isItalic ? "italic" : "normal"};
  font-display: swap;
}`;

    try {
      sheet.insertRule(rule, sheet.cssRules.length);
      registeredRulesRef.current.add(ruleKey);
    } catch {
      // Keep the existing detail preview when a single font source cannot be registered.
    }
  }, [familyName, font, variantId]);

  return <style ref={styleRef} data-yfonts-detail-font />;
}

function getImportedFolderName(files: File[]): string {
  if (files.length === 0) return t.manualImport;

  const firstFile = files[0] as File & { webkitRelativePath?: string };
  return firstFile.webkitRelativePath?.split("/")[0] || t.manualImport;
}

async function pickFontSourceRoot(suggestedPath?: string) {
  const result = await invokeTauri<string | null>("pick_font_folder_path", {
    suggestedPath: suggestedPath ?? null
  });
  return result?.trim() || undefined;
}

function getFontSourceRelinkNotice(path: string) {
  const firstSegment = getFirstPathSegment(path);
  const filename = getFilesystemBasename(path);

  if (firstSegment && filename && firstSegment !== filename) {
    return `请选择包含「${firstSegment}」的真实源目录；如果不确定，也可以直接选择「${filename}」所在文件夹。`;
  }

  return "请选择字体所在的真实源目录，YFonts 会尝试自动重连这条本地路径。";
}

function getSuggestedFolderPickerPath(candidatePaths: string[]) {
  const absolutePath = candidatePaths.find(isAbsoluteFilesystemPath);
  if (!absolutePath) return undefined;

  return absolutePath;
}

function resolveFontLocationCandidates(
  font: FontAsset,
  variant: FontVariant,
  rootCandidates: Array<string | undefined>
) {
  const directPath = variant.path ?? font.path;
  const root = variant.libraryRoot ?? font.libraryRoot;
  const relativePaths = uniqueStrings([variant.relativePath, directPath].filter(Boolean) as string[]);
  const roots = uniqueStrings([root, font.libraryRoot, ...rootCandidates].filter(Boolean) as string[]);
  const candidates: string[] = [];

  if (directPath && isAbsoluteFilesystemPath(directPath)) candidates.push(directPath);

  for (const candidateRoot of roots) {
    if (!isAbsoluteFilesystemPath(candidateRoot)) continue;

    for (const relativePath of relativePaths) {
      if (isAbsoluteFilesystemPath(relativePath)) {
        candidates.push(relativePath);
        continue;
      }

      candidates.push(joinFilesystemPath(candidateRoot, relativePath));
      candidates.push(...resolveFlexibleRootCandidates(candidateRoot, relativePath));
    }
  }

  if (directPath) candidates.push(directPath);
  return uniqueStrings(candidates);
}

function getFontLocationSourceKey(font: FontAsset, variant: FontVariant) {
  const relativePath = variant.relativePath ?? variant.path ?? font.path ?? "";
  const sourceLabel =
    variant.libraryRoot ||
    font.libraryRoot ||
    getFirstPathSegment(relativePath) ||
    font.foundry ||
    font.id;

  return `source:${normalizeLibraryRoot(sourceLabel).toLowerCase()}`;
}

function inferBoundSourceRoot(
  selectedRoot: string,
  resolvedPath: string,
  variant: FontVariant
) {
  const relativePath = variant.relativePath ?? variant.path ?? "";
  const firstSegment = getFirstPathSegment(relativePath);
  if (!firstSegment) return selectedRoot;

  if (getFilesystemBasename(selectedRoot).toLowerCase() === firstSegment.toLowerCase()) {
    return selectedRoot;
  }

  const normalizedPath = resolvedPath.replace(/\\/g, "/");
  const marker = `/${firstSegment.toLowerCase()}/`;
  const markerIndex = normalizedPath.toLowerCase().lastIndexOf(marker);
  if (markerIndex < 0) return selectedRoot;

  const sourceRoot = normalizedPath.slice(0, markerIndex + marker.length - 1);
  return selectedRoot.includes("\\") ? sourceRoot.replace(/\//g, "\\") : sourceRoot;
}

function resolveBoundFontPath(sourceRoot: string, path?: string) {
  if (!path || isAbsoluteFilesystemPath(path)) return path;

  const segments = getPathSegments(path);
  if (
    segments.length > 1 &&
    segments[0].toLowerCase() === getFilesystemBasename(sourceRoot).toLowerCase()
  ) {
    return joinFilesystemPath(sourceRoot, segments.slice(1).join("\\"));
  }

  return joinFilesystemPath(sourceRoot, path);
}

function resolveFlexibleRootCandidates(candidateRoot: string, relativePath: string) {
  const rootParent = getFilesystemDirname(candidateRoot);
  const rootBase = getFilesystemBasename(candidateRoot);
  const relativeSegments = getPathSegments(relativePath);
  const candidates: string[] = [];

  if (!rootBase || relativeSegments.length === 0) return candidates;

  relativeSegments.forEach((segment, index) => {
    if (segment !== rootBase) return;

    if (rootParent) {
      candidates.push(joinFilesystemPath(rootParent, relativeSegments.slice(index).join("\\")));
    }

    const remainingSegments = relativeSegments.slice(index + 1);
    if (remainingSegments.length > 0) {
      candidates.push(joinFilesystemPath(candidateRoot, remainingSegments.join("\\")));
    }
  });

  const filename = relativeSegments[relativeSegments.length - 1];
  if (filename && filename !== rootBase) {
    candidates.push(joinFilesystemPath(candidateRoot, filename));
  }

  return candidates;
}

function isAbsoluteFilesystemPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\/.test(path) || path.startsWith("/");
}

function joinFilesystemPath(root: string, relativePath: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRelativePath = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${cleanRoot}${separator}${cleanRelativePath}`;
}

function getFilesystemBasename(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function getFilesystemDirname(path: string) {
  const cleanPath = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleanPath.lastIndexOf("\\"), cleanPath.lastIndexOf("/"));
  if (index <= 0) return "";
  return cleanPath.slice(0, index);
}

function getFirstPathSegment(path: string) {
  return path.replace(/^[\\/]+/, "").split(/[\\/]/).filter(Boolean)[0] ?? "";
}

function getPathSegments(path: string) {
  return path.replace(/^[\\/]+/, "").split(/[\\/]/).filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim()).map((value) => value.trim())));
}

function escapeCssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "YFonts-project-pack";
}

function getPathFilename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

type SaveTextFileResult =
  | { status: "picked"; filename: string; path?: string }
  | { status: "downloaded"; filename: string }
  | { status: "cancelled" };

type ProjectPackBundleFile = {
  sourcePath: string;
  family: string;
  filename: string;
};

type ProjectPackBundleResult = {
  status: "picked" | "cancelled";
  path?: string;
  copiedFiles?: number;
  skippedFiles?: number;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{
      write: (content: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

async function saveTextFile(
  filename: string,
  content: string,
  mimeType: string
): Promise<SaveTextFileResult> {
  if (isTauriRuntime()) {
    const result = (await invokeTauri("save_text_file", {
      suggestedName: filename,
      content
    })) as Partial<SaveTextFileResult>;

    if (result.status === "cancelled") return { status: "cancelled" };
    if (result.status === "picked") {
      return {
        status: "picked",
        filename: result.filename || filename,
        path: result.path
      };
    }

    throw new Error(t.projectPackExportFailed);
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;

  if (savePicker) {
    try {
      const handle = await savePicker({
        suggestedName: filename,
        types: [
          {
            description: "YFonts JSON",
            accept: {
              [mimeType]: [".json"]
            }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();

      return { status: "picked", filename: handle.name || filename };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "cancelled" };
      }

      throw error;
    }
  }

  downloadTextFile(filename, blob);
  return { status: "downloaded", filename };
}

function downloadTextFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uniqueFonts(fonts: Array<FontAsset | undefined>) {
  const nextFonts: FontAsset[] = [];
  const seen = new Set<string>();

  for (const font of fonts) {
    if (!font || seen.has(font.id)) continue;
    seen.add(font.id);
    nextFonts.push(font);
  }

  return nextFonts;
}

function mergeFontAssets(currentFonts: FontAsset[], incomingFonts: FontAsset[]) {
  const fontsById = new Map(currentFonts.map((font) => [font.id, font]));

  for (const font of incomingFonts) {
    const existingFont = fontsById.get(font.id);
    fontsById.set(font.id, existingFont ? { ...font, isFavorite: existingFont.isFavorite } : font);
  }

  return Array.from(fontsById.values()).sort((a, b) => {
    const source = a.source.localeCompare(b.source);
    if (source !== 0) return source;
    const language = a.language.localeCompare(b.language);
    if (language !== 0) return language;
    const category = a.category.localeCompare(b.category, "zh-Hans-CN");
    if (category !== 0) return category;
    return a.family.localeCompare(b.family, "zh-Hans-CN");
  });
}

function mergeLocalIndexes(currentIndex: LocalFontIndex | undefined, incomingIndex: LocalFontIndex) {
  if (!currentIndex) return incomingIndex;

  const recordsByPath = new Map(
    currentIndex.fonts.map((record) => [
      record.path || record.relativePath || record.id,
      { ...record, libraryRoot: record.libraryRoot || currentIndex.root }
    ])
  );

  for (const record of incomingIndex.fonts) {
    recordsByPath.set(record.path || record.relativePath || record.id, {
      ...record,
      libraryRoot: record.libraryRoot || incomingIndex.root
    });
  }

  const fonts = Array.from(recordsByPath.values());

  return {
    generatedAt: incomingIndex.generatedAt,
    root: currentIndex.root === incomingIndex.root ? incomingIndex.root : t.mixedLibrary,
    totalFonts: fonts.length,
    fonts
  };
}

function replaceSourceFonts(
  currentFonts: FontAsset[],
  sourceId: string,
  incomingFonts: FontAsset[]
) {
  const currentFontsById = new Map(currentFonts.map((font) => [font.id, font]));
  const untouchedFonts = currentFonts.filter((font) => getFontLibrarySourceId(font) !== sourceId);
  const hydratedIncomingFonts = incomingFonts.map((font) => {
    const existingFont = currentFontsById.get(font.id);
    return existingFont ? { ...font, isFavorite: existingFont.isFavorite } : font;
  });

  return mergeFontAssets(untouchedFonts, hydratedIncomingFonts);
}

function replaceLocalIndexSource(
  currentIndex: LocalFontIndex | undefined,
  incomingIndex: LocalFontIndex,
  sourceId: string
) {
  if (!currentIndex) return incomingIndex;

  const baseIndex = {
    ...currentIndex,
    fonts: currentIndex.fonts.filter(
      (record) => getRecordLibrarySourceId(record, currentIndex.root) !== sourceId
    )
  };

  return mergeLocalIndexes(baseIndex, incomingIndex);
}

function summarizeLibrarySources(fonts: FontAsset[]): LibrarySourceSummary[] {
  const sourcesById = new Map<string, LibrarySourceSummary>();

  for (const font of fonts) {
    const id = getFontLibrarySourceId(font);
    const existingSource = sourcesById.get(id);

    if (existingSource) {
      existingSource.families += 1;
      existingSource.files += font.totalFiles;
      existingSource.previewable += font.canPreview ? 1 : 0;
      continue;
    }

    const root = normalizeLibraryRoot(font.libraryRoot || font.foundry);
    sourcesById.set(id, {
      id,
      label: getSourceLabel(root, font.foundry),
      kindLabel: getSourceKindLabel(font.source),
      source: font.source,
      root,
      families: 1,
      files: font.totalFiles,
      previewable: font.canPreview ? 1 : 0
    });
  }

  return Array.from(sourcesById.values()).sort((a, b) => {
    const source = a.source.localeCompare(b.source);
    if (source !== 0) return source;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });
}

function summarizeDuplicateGroups(fonts: FontAsset[]): LibraryDuplicateGroup[] {
  const fontsByDuplicateKey = new Map<string, FontAsset[]>();

  for (const font of fonts) {
    const duplicateKey = getDuplicateKey(font.family);
    if (!duplicateKey) continue;

    const bucket = fontsByDuplicateKey.get(duplicateKey) ?? [];
    bucket.push(font);
    fontsByDuplicateKey.set(duplicateKey, bucket);
  }

  return Array.from(fontsByDuplicateKey.entries())
    .map(([id, groupFonts]) => {
      const sortedFonts = sortDuplicateFonts(groupFonts);

      return {
        id,
        label: getDuplicateLabel(sortedFonts),
        count: sortedFonts.length,
        files: sortedFonts.reduce((total, font) => total + font.totalFiles, 0),
        fonts: sortedFonts.map((font) => ({
          id: font.id,
          family: font.family,
          styleName: font.styleName,
          sourceLabel: getSourceLabel(normalizeLibraryRoot(font.libraryRoot || font.foundry), font.foundry),
          fileCount: font.totalFiles,
          isFavorite: font.isFavorite,
          canPreview: font.canPreview
        }))
      };
    })
    .filter((group) => group.count > 1)
    .sort((a, b) => {
      const count = b.count - a.count;
      if (count !== 0) return count;
      return a.label.localeCompare(b.label, "zh-Hans-CN");
    });
}

function sortDuplicateFonts(fonts: FontAsset[]) {
  return [...fonts].sort((a, b) => {
    const favorite = Number(b.isFavorite) - Number(a.isFavorite);
    if (favorite !== 0) return favorite;
    const previewable = Number(b.canPreview) - Number(a.canPreview);
    if (previewable !== 0) return previewable;
    const files = b.totalFiles - a.totalFiles;
    if (files !== 0) return files;
    return a.family.localeCompare(b.family, "zh-Hans-CN");
  });
}

function getDuplicateLabel(fonts: FontAsset[]) {
  const shortestFamily = [...fonts].sort((a, b) => a.family.length - b.family.length)[0]?.family;
  return stripCopySuffix(shortestFamily ?? fonts[0]?.family ?? "");
}

function getDuplicateExtraIds(group: LibraryDuplicateGroup) {
  return new Set(group.fonts.slice(1).map((font) => font.id));
}

function removeFontsFromProjectPacks(packs: ProjectPack[], removedIds: Set<string>) {
  return packs.map((pack) => ({
    ...pack,
    fontIds: pack.fontIds.filter((fontId) => !removedIds.has(fontId))
  }));
}

function removeFontsFromProjectPackCascade(
  packs: ProjectPack[],
  packId: string,
  removedIds: Set<string>
) {
  const packIds = getProjectPackCascadeIds(packs, packId);

  return packs.map((pack) =>
    packIds.has(pack.id)
      ? { ...pack, fontIds: pack.fontIds.filter((fontId) => !removedIds.has(fontId)) }
      : pack
  );
}

function keepKnownProjectPackFonts(packs: ProjectPack[], knownIds: Set<string>) {
  return packs.map((pack) => ({
    ...pack,
    fontIds: pack.fontIds.filter((fontId) => knownIds.has(fontId))
  }));
}

function createProjectPackManifest({
  pack,
  packs,
  fonts,
  activeVariantIds,
  platformLabel
}: {
  pack: ProjectPack;
  packs: ProjectPack[];
  fonts: FontAsset[];
  activeVariantIds: Record<string, string>;
  platformLabel: string;
}) {
  const packIds = getProjectPackCascadeIds(packs, pack.id);
  const includedPacks = packs
    .filter((item) => packIds.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      parentId: item.parentId,
      fontCount: item.fontIds.length
    }));

  return {
    type: "YFonts Project Pack Manifest",
    version: 1,
    exportedAt: new Date().toISOString(),
    platform: platformLabel,
    projectPack: {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      includedPacks
    },
    summary: {
      families: fonts.length,
      files: fonts.reduce((total, font) => total + font.totalFiles, 0)
    },
    fonts: fonts.map((font) => {
      const activeVariant = getActiveVariant(font, activeVariantIds[font.id]);

      return {
        id: font.id,
        family: font.family,
        styleName: font.styleName,
        category: font.category,
        language: font.language,
        license: font.license,
        licenseLabel: font.licenseLabel,
        source: font.source,
        foundry: font.foundry,
        libraryRoot: font.libraryRoot,
        activeVariantId: activeVariant.id,
        activeVariantPath: activeVariant.path ?? activeVariant.relativePath,
        files: font.variants.map((variant) => ({
          id: variant.id,
          styleName: variant.styleName,
          weight: variant.weight,
          format: variant.format,
          sizeLabel: variant.sizeLabel,
          path: variant.path,
          relativePath: variant.relativePath
        }))
      };
    })
  };
}

function createProjectPackBundleFiles(fonts: FontAsset[]): ProjectPackBundleFile[] {
  const files: ProjectPackBundleFile[] = [];
  const seenPaths = new Set<string>();

  for (const font of fonts) {
    for (const variant of font.variants) {
      const sourcePath = variant.path ?? "";
      if (!sourcePath || seenPaths.has(sourcePath)) continue;

      seenPaths.add(sourcePath);
      files.push({
        sourcePath,
        family: font.family,
        filename: getPathFilename(sourcePath) || `${font.family}-${variant.styleName}.${variant.extension}`
      });
    }
  }

  return files;
}

function insertProjectPack(packs: ProjectPack[], pack: ProjectPack) {
  if (!pack.parentId) return [pack, ...packs];

  const parentIndex = packs.findIndex((currentPack) => currentPack.id === pack.parentId);
  if (parentIndex < 0) return [...packs, pack];

  let insertIndex = parentIndex + 1;
  while (insertIndex < packs.length && packs[insertIndex]?.parentId === pack.parentId) {
    insertIndex += 1;
  }

  return [...packs.slice(0, insertIndex), pack, ...packs.slice(insertIndex)];
}

function getProjectPackFontIds(packs: ProjectPack[], packId?: string) {
  if (!packId) return new Set<string>();

  const packIds = getProjectPackCascadeIds(packs, packId);
  const fontIds = new Set<string>();

  for (const pack of packs) {
    if (!packIds.has(pack.id)) continue;
    pack.fontIds.forEach((fontId) => fontIds.add(fontId));
  }

  return fontIds;
}

function getProjectPackCascadeIds(packs: ProjectPack[], packId: string) {
  const ids = new Set([packId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const pack of packs) {
      if (!pack.parentId || ids.has(pack.id) || !ids.has(pack.parentId)) continue;
      ids.add(pack.id);
      changed = true;
    }
  }

  return ids;
}

function getDuplicateKey(family: string) {
  return stripCopySuffix(family)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function stripCopySuffix(value: string) {
  return value
    .trim()
    .replace(/\s*[\(（](?:\d+|copy|副本)[\)）]\s*$/i, "")
    .replace(/(?:\s+|-|_)+(?:copy|副本)\s*$/i, "")
    .trim();
}

function createProjectPackId() {
  return `project-pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function scrollCategoryTabs(event: WheelEvent<HTMLDivElement>) {
  const tabs = event.currentTarget;
  if (tabs.scrollWidth <= tabs.clientWidth) return;

  event.preventDefault();
  tabs.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
}

function removeLocalIndexSource(currentIndex: LocalFontIndex | undefined, sourceId: string) {
  if (!currentIndex) return currentIndex;

  const fonts = currentIndex.fonts.filter(
    (record) => getRecordLibrarySourceId(record, currentIndex.root) !== sourceId
  );

  return {
    ...currentIndex,
    totalFonts: fonts.length,
    fonts
  };
}

function getFontLibrarySourceId(font: FontAsset) {
  return getLibrarySourceId(font.source, font.libraryRoot || font.foundry);
}

function getRecordLibrarySourceId(record: LocalFontIndex["fonts"][number], indexRoot: string) {
  const root = record.libraryRoot || indexRoot || record.sourceLibrary;
  const source: FontSource = normalizeLibraryRoot(root) === normalizeLibraryRoot(t.manualImport) ? "manual" : "local";
  return getLibrarySourceId(source, root);
}

function getLibrarySourceId(source: FontSource, root: string) {
  return `${source}|${normalizeLibraryRoot(root)}`;
}

function normalizeLibraryRoot(root?: string) {
  return root?.trim().replace(/\\/g, "/") ?? "";
}

function getSourceLabel(root: string, fallback: string) {
  if (!root) return fallback;
  if (root === t.manualImport) return t.manualImport;

  const parts = root.split("/").filter(Boolean);
  return parts[parts.length - 1] || fallback || root;
}

function getSourceKindLabel(source: FontSource) {
  if (source === "manual") return t.manualImport;
  if (source === "local") return t.local;
  if (source === "google-fonts") return "Google Fonts";
  return "Fontsource";
}

function getSuggestedFolderImportPath(root: string | undefined, sources: LibrarySourceSummary[]) {
  const normalizedRoot = normalizeLibraryRoot(root);
  if (
    normalizedRoot &&
    normalizedRoot !== normalizeLibraryRoot(t.mixedLibrary) &&
    normalizedRoot !== normalizeLibraryRoot(t.manualImport)
  ) {
    return root ?? "";
  }

  const localSource = sources.find(
    (source) =>
      source.source === "local" &&
      source.root &&
      source.root !== normalizeLibraryRoot(t.mixedLibrary) &&
      source.root !== normalizeLibraryRoot(t.manualImport)
  );

  return localSource?.root ?? "";
}

function getReloadableFolderRoots(
  index: LocalFontIndex | undefined,
  sources: LibrarySourceSummary[],
  savedRoots: string[]
) {
  const roots = [
    index?.root,
    ...sources
      .filter((source) => source.source === "local")
      .map((source) => source.root),
    ...savedRoots
  ];
  const seenRoots = new Set<string>();
  const reloadableRoots: string[] = [];

  for (const root of roots) {
    const normalizedRoot = normalizeLibraryRoot(root);
    if (!isReloadableFolderRoot(normalizedRoot) || seenRoots.has(normalizedRoot)) continue;

    seenRoots.add(normalizedRoot);
    reloadableRoots.push(root ?? normalizedRoot);
  }

  return reloadableRoots;
}

function isReloadableFolderRoot(root: string) {
  return (
    root.length > 0 &&
    root !== normalizeLibraryRoot(t.mixedLibrary) &&
    root !== normalizeLibraryRoot(t.manualImport)
  );
}

function withoutIds(ids: Set<string>, removedIds: Set<string>) {
  const nextIds = new Set(ids);
  removedIds.forEach((id) => nextIds.delete(id));
  return nextIds;
}

function keepKnownIds(ids: Set<string>, knownIds: Set<string>) {
  return new Set(Array.from(ids).filter((id) => knownIds.has(id)));
}

function filterVariantIdsByFontIds(ids: Record<string, string>, knownIds: Set<string>) {
  return Object.fromEntries(Object.entries(ids).filter(([fontId]) => knownIds.has(fontId)));
}

function revokeFontObjectUrls(fonts: FontAsset[]) {
  const urls = new Set<string>();

  for (const font of fonts) {
    if (font.fontUrl?.startsWith("blob:")) urls.add(font.fontUrl);

    for (const variant of font.variants) {
      if (variant.fontUrl?.startsWith("blob:")) urls.add(variant.fontUrl);
    }
  }

  urls.forEach((url) => URL.revokeObjectURL(url));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
