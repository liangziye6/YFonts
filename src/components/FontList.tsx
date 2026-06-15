import { Copy, EyeOff, FolderOpen, Layers, RotateCcw, Star, XCircle } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { getActiveVariant, isVariableFontVariant } from "../lib/localFontIndex";
import { getSourceLabel } from "../lib/platform";
import {
  getFontVariationSettings,
  resolveFontPreviewText,
  type FontAxisValues
} from "../lib/preview";
import type { FontAsset } from "../types";

type FontListProps = {
  fonts: FontAsset[];
  selectedId?: string;
  previewText: string;
  previewSize: number;
  activePreviewFamily?: string;
  hiddenFontIds: Set<string>;
  removedFontIds: Set<string>;
  selectedFontIds: Set<string>;
  activeVariantIds: Record<string, string>;
  fontAxisValues: Record<string, FontAxisValues>;
  scrollTarget?: { fontId: string; requestId: number };
  emptyTitle?: string;
  emptyHint?: string;
  onSelect: (fontId: string, options?: { range?: boolean }) => void;
  onToggleSelection: (fontId: string) => void;
  onSelectVariant: (fontId: string, variantId: string) => void;
  onToggleFavorite: (fontId: string) => void;
  onHideFont: (fontId: string) => void;
  onRestoreFont: (fontId: string) => void;
  onRemoveFromLibrary: (fontId: string) => void;
  onRestoreToLibrary: (fontId: string) => void;
  isProjectPackView?: boolean;
  onRemoveFromProjectPack?: (fontId: string) => void;
  onOpenLocation: (font: FontAsset) => void;
  onCopyFontName: (font: FontAsset) => void;
  onCopyFontPath: (font: FontAsset) => void;
  onVisibleFontIdsChange?: (fontIds: string[]) => void;
};

type MenuState =
  | { fontId: string; mode: "variants" }
  | { fontId: string; mode: "context"; x: number; y: number };

function getLicenseTone(font: FontAsset) {
  if (["ofl", "free-commercial", "apache", "cc0"].includes(font.license)) return "good";
  if (font.license === "unknown") return "warn";
  return "muted";
}

export function FontList({
  fonts,
  selectedId,
  previewText,
  previewSize,
  activePreviewFamily,
  hiddenFontIds,
  removedFontIds,
  selectedFontIds,
  activeVariantIds,
  fontAxisValues,
  scrollTarget,
  emptyTitle,
  emptyHint,
  onSelect,
  onToggleSelection,
  onSelectVariant,
  onToggleFavorite,
  onHideFont,
  onRestoreFont,
  onRemoveFromLibrary,
  onRestoreToLibrary,
  isProjectPackView = false,
  onRemoveFromProjectPack,
  onOpenLocation,
  onCopyFontName,
  onCopyFontPath,
  onVisibleFontIdsChange
}: FontListProps) {
  const [menuState, setMenuState] = useState<MenuState>();
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 720 });
  const listRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const isSelectionMode = selectedFontIds.size > 0;
  const rowGap = 10;
  const rowHeight = Math.ceil(previewSize * 1.56 + 86);
  const rowStride = rowHeight + rowGap;
  const shouldVirtualize = fonts.length > 36;
  const overscanRows = 6;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(viewport.scrollTop / rowStride) - overscanRows)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(
        fonts.length,
        Math.ceil((viewport.scrollTop + viewport.height) / rowStride) + overscanRows
      )
    : fonts.length;
  const renderedFonts = useMemo(
    () => fonts.slice(startIndex, endIndex),
    [endIndex, fonts, startIndex]
  );
  const renderedFontIds = useMemo(
    () => renderedFonts.map((font) => font.id),
    [renderedFonts]
  );
  const renderedFontIdKey = renderedFontIds.join("|");
  const listIdentity = `${fonts.length}:${fonts[0]?.id ?? ""}:${fonts[fonts.length - 1]?.id ?? ""}`;
  const topSpacerHeight = startIndex > 0 ? startIndex * rowStride - rowGap : 0;
  const remainingRows = fonts.length - endIndex;
  const bottomSpacerHeight = remainingRows > 0 ? remainingRows * rowStride - rowGap : 0;

  useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    function updateViewport() {
      const currentList = listRef.current;
      if (!currentList) return;
      setViewport((current) => {
        const nextHeight = currentList.clientHeight;
        const nextScrollTop = currentList.scrollTop;
        if (current.height === nextHeight && current.scrollTop === nextScrollTop) return current;
        return { height: nextHeight, scrollTop: nextScrollTop };
      });
    }

    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(listElement);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = 0;
    setViewport((current) => ({ ...current, scrollTop: 0 }));
    setMenuState(undefined);
  }, [listIdentity]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !scrollTarget) return;

    const targetIndex = fonts.findIndex((font) => font.id === scrollTarget.fontId);
    if (targetIndex < 0) return;

    const centeredTop = targetIndex * rowStride - Math.max(0, (list.clientHeight - rowHeight) / 2);
    list.scrollTo({
      top: Math.max(0, centeredTop),
      behavior: "smooth"
    });
  }, [fonts, rowHeight, rowStride, scrollTarget]);

  useEffect(() => {
    onVisibleFontIdsChange?.(renderedFontIds);
  }, [onVisibleFontIdsChange, renderedFontIdKey]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!menuState) return;

    function closeMenu() {
      setMenuState(undefined);
    }

    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeWithKeyboard);
    document.addEventListener("yfonts:close-context-menus", closeMenu);

    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeWithKeyboard);
      document.removeEventListener("yfonts:close-context-menus", closeMenu);
    };
  }, [menuState]);

  if (fonts.length === 0) {
    return (
      <div className="empty-state">
        <strong>{emptyTitle ?? t.noMatches}</strong>
        <span>{emptyHint ?? t.changeQuery}</span>
      </div>
    );
  }

  function handleScroll() {
    if (scrollFrameRef.current !== undefined) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      const list = listRef.current;
      if (!list) return;
      setViewport({ scrollTop: list.scrollTop, height: list.clientHeight });
      setMenuState((current) => (current ? undefined : current));
    });
  }

  return (
    <div
      ref={listRef}
      className={shouldVirtualize ? "font-list virtualized" : "font-list"}
      onScroll={handleScroll}
      style={
        {
          "--preview-size": `${previewSize}px`,
          "--virtual-row-height": `${rowHeight}px`
        } as CSSProperties
      }
    >
      {topSpacerHeight > 0 && (
        <div className="font-list-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" />
      )}
      {renderedFonts.map((font) => {
        const activeVariant = getActiveVariant(font, activeVariantIds[font.id]);
        const preview = resolveFontPreviewText(font, previewText);
        const previewWeight = activeVariant.weight || font.weights[0] || 400;
        const isSelected = selectedId === font.id;
        const previewFamily =
          isSelected && activePreviewFamily && activeVariant.fontUrl && activeVariant.isPreviewable
            ? `"${activePreviewFamily}", ${font.cssFamily}`
            : font.cssFamily;
        const language = font.language === "english" ? t.english : t.chinese;
        const isHidden = hiddenFontIds.has(font.id);
        const isRemoved = removedFontIds.has(font.id);
        const isSelectedForBatch = selectedFontIds.has(font.id);
        const activeVariantIsVariable = isVariableFontVariant(activeVariant);
        const variationSettings = activeVariantIsVariable
          ? getFontVariationSettings(font, fontAxisValues[font.id])
          : undefined;
        const variableWeight = activeVariantIsVariable
          ? fontAxisValues[font.id]?.wght ??
            font.variableAxes?.find((axis) => axis.tag === "wght")?.value
          : undefined;

        return (
          <article
            key={font.id}
            draggable={false}
            className={[
              "font-row",
              isSelected ? "selected" : "",
              !isRemoved ? "draggable" : "",
              isSelectionMode ? "selection-mode" : "",
              isSelectedForBatch ? "batch-selected" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onPointerDown={(event) => {
              if (event.button !== 0 || isRemoved || isInteractivePointerTarget(event.target)) return;

              const draggedIds =
                isSelectedForBatch && selectedFontIds.size > 1
                  ? Array.from(selectedFontIds)
                  : [font.id];

              beginProjectPointerDrag({
                event,
                family: font.family,
                fontIds: draggedIds
              });
            }}
            onMouseDown={(event) => {
              if (event.shiftKey) event.preventDefault();
            }}
            onClick={(event) => {
              if (window.__YFONTS_DID_CUSTOM_DRAG__) {
                window.__YFONTS_DID_CUSTOM_DRAG__ = undefined;
                return;
              }

              onSelect(font.id, { range: event.shiftKey });
            }}
          >
            <div className={isSelectionMode ? "font-row-top selection-mode" : "font-row-top"}>
              {isSelectionMode && (
                <button
                  className={isSelectedForBatch ? "row-select-button active" : "row-select-button"}
                  title={isSelectedForBatch ? t.cancelSelect : t.selectFont}
                  aria-label={isSelectedForBatch ? t.cancelSelect : t.selectFont}
                  aria-pressed={isSelectedForBatch}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelection(font.id);
                  }}
                >
                  {isSelectedForBatch && (
                    <svg
                      className="row-select-check"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M3 6.35 5.08 8.35 9.05 3.75" />
                    </svg>
                  )}
                </button>
              )}

              <button
                className={font.isFavorite ? "star-button active" : "star-button"}
                title={font.isFavorite ? t.cancelFavorite : t.favorite}
                aria-label={font.isFavorite ? t.cancelFavorite : t.favorite}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(font.id);
                }}
              >
                <Star size={16} />
              </button>

              <div className="font-title-line">
                <strong>{font.family}</strong>
                <span>{font.styleName}</span>
                <em>
                  {font.category} · {language} · {getSourceLabel(font.source)}
                </em>
              </div>

              <span className={`license-pill ${getLicenseTone(font)}`}>{font.licenseLabel}</span>

              <div className="row-menu-wrap">
                <button
                  className={
                    menuState?.fontId === font.id && menuState.mode === "variants"
                      ? "row-menu-button active"
                      : "row-menu-button"
                  }
                  type="button"
                  title={t.viewWeightsAndFiles}
                  aria-label={t.viewWeightsAndFiles}
                  onClick={(event) => {
                    event.stopPropagation();
                    document.dispatchEvent(new Event("yfonts:close-context-menus"));
                    setMenuState(
                      menuState?.fontId === font.id && menuState.mode === "variants"
                        ? undefined
                        : { fontId: font.id, mode: "variants" }
                    );
                  }}
                >
                  <Layers size={16} />
                </button>

                {menuState?.fontId === font.id && menuState.mode === "variants" && (
                  <FontVariantPopover
                    font={font}
                    activeVariantId={activeVariant.id}
                    onClose={() => setMenuState(undefined)}
                    onSelectVariant={(variantId) => {
                      onSelect(font.id);
                      onSelectVariant(font.id, variantId);
                    }}
                  />
                )}
              </div>
            </div>

            <p
              className={font.canPreview ? "font-preview" : "font-preview preview-fallback"}
              style={{
                fontFamily: previewFamily,
                fontWeight: variableWeight ?? previewWeight,
                fontStyle: activeVariant.isItalic ? "italic" : "normal",
                fontVariationSettings: variationSettings
              }}
              title={font.canPreview ? undefined : t.previewLimited}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                document.dispatchEvent(new Event("yfonts:close-context-menus"));
                onSelect(font.id);
                setMenuState({
                  fontId: font.id,
                  mode: "context",
                  ...getContextMenuPosition(event)
                });
              }}
            >
              {preview}
            </p>

            {menuState?.fontId === font.id && menuState.mode === "context" && (
              <FontActionMenu
                className="row-menu context-menu"
                style={{ left: menuState.x, top: menuState.y }}
                font={font}
                isHidden={isHidden}
                isRemoved={isRemoved}
                onClose={() => setMenuState(undefined)}
                onToggleFavorite={onToggleFavorite}
                onHideFont={onHideFont}
                onRestoreFont={onRestoreFont}
                onRemoveFromLibrary={onRemoveFromLibrary}
                onRestoreToLibrary={onRestoreToLibrary}
                isProjectPackView={isProjectPackView}
                onRemoveFromProjectPack={onRemoveFromProjectPack}
                onOpenLocation={onOpenLocation}
                onCopyFontName={onCopyFontName}
                onCopyFontPath={onCopyFontPath}
              />
            )}
          </article>
        );
      })}
      {bottomSpacerHeight > 0 && (
        <div className="font-list-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" />
      )}
    </div>
  );
}

function FontVariantPopover({
  font,
  activeVariantId,
  onClose,
  onSelectVariant
}: {
  font: FontAsset;
  activeVariantId: string;
  onClose: () => void;
  onSelectVariant: (variantId: string) => void;
}) {
  return (
    <div
      className="variant-popover"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="variant-popover-head">
        <strong>{t.weightsAndFiles}</strong>
        <span>
          {font.weights.length} {t.weightCount} / {font.variants.length} {t.fileCount}
        </span>
      </div>
      <div className="variant-popover-list">
        {font.variants.map((variant) => (
          <button
            key={variant.id}
            className={variant.id === activeVariantId ? "variant-popover-item active" : "variant-popover-item"}
            type="button"
            title={variant.path ?? variant.relativePath}
            onClick={() => {
              onSelectVariant(variant.id);
              onClose();
            }}
          >
            <strong>{variant.weight}</strong>
            <span>{variant.styleName}</span>
            <em>
              {variant.format} / {variant.sizeLabel}
            </em>
          </button>
        ))}
      </div>
    </div>
  );
}

function FontActionMenu({
  className,
  style,
  font,
  isHidden,
  isRemoved,
  onClose,
  onToggleFavorite,
  onHideFont,
  onRestoreFont,
  onRemoveFromLibrary,
  onRestoreToLibrary,
  isProjectPackView,
  onRemoveFromProjectPack,
  onOpenLocation,
  onCopyFontName,
  onCopyFontPath
}: {
  className: string;
  style?: CSSProperties;
  font: FontAsset;
  isHidden: boolean;
  isRemoved: boolean;
  onClose: () => void;
  onToggleFavorite: (fontId: string) => void;
  onHideFont: (fontId: string) => void;
  onRestoreFont: (fontId: string) => void;
  onRemoveFromLibrary: (fontId: string) => void;
  onRestoreToLibrary: (fontId: string) => void;
  isProjectPackView: boolean;
  onRemoveFromProjectPack?: (fontId: string) => void;
  onOpenLocation: (font: FontAsset) => void;
  onCopyFontName: (font: FontAsset) => void;
  onCopyFontPath: (font: FontAsset) => void;
}) {
  const onlineFont =
    font.source === "fontsource" ||
    font.source === "google-fonts";

  function runAction(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      className={className}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {isRemoved ? (
        <button type="button" onClick={() => runAction(() => onRestoreToLibrary(font.id))}>
          <RotateCcw size={15} />
          {t.restoreToLibrary}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => runAction(() => onToggleFavorite(font.id))}>
            <Star size={15} />
            {font.isFavorite ? t.cancelFavorite : t.favorite}
          </button>
          {!onlineFont && (
            <button
              type="button"
              onClick={() =>
                runAction(() => (isHidden ? onRestoreFont(font.id) : onHideFont(font.id)))
              }
            >
              {isHidden ? <RotateCcw size={15} /> : <EyeOff size={15} />}
              {isHidden ? t.restoreFont : t.hideFont}
            </button>
          )}
        </>
      )}
      {isProjectPackView && onRemoveFromProjectPack && !isRemoved && (
        <button type="button" onClick={() => runAction(() => onRemoveFromProjectPack(font.id))}>
          <XCircle size={15} />
          {t.removeFontFromPack}
        </button>
      )}
      {!onlineFont && (
        <button type="button" onClick={() => runAction(() => onOpenLocation(font))}>
          <FolderOpen size={15} />
          {t.openLocation}
        </button>
      )}
      <button type="button" onClick={() => runAction(() => onCopyFontName(font))}>
        <Copy size={15} />
        {t.copyFontName}
      </button>
      <button type="button" onClick={() => runAction(() => onCopyFontPath(font))}>
        <Copy size={15} />
        {t.copyFontPath}
      </button>
      {!onlineFont && !isRemoved && (
        <button
          className="danger"
          type="button"
          onClick={() => runAction(() => onRemoveFromLibrary(font.id))}
        >
          <XCircle size={15} />
          {t.removeFromLibrary}
        </button>
      )}
    </div>
  );
}

function getContextMenuPosition(event: MouseEvent<HTMLElement>) {
  const menuWidth = 176;
  const menuHeight = 220;
  const padding = 8;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

  return {
    x: Math.max(padding, x),
    y: Math.max(padding, y)
  };
}

function beginProjectPointerDrag({
  event,
  family,
  fontIds
}: {
  event: ReactPointerEvent<HTMLElement>;
  family: string;
  fontIds: string[];
}) {
  const dragSource = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragImage: HTMLElement | undefined;
  let hasStarted = false;

  try {
    dragSource.setPointerCapture(pointerId);
  } catch {
    // Some WebView builds refuse capture during synthetic or interrupted pointer streams.
  }

  function startDrag(pointerEvent: PointerEvent) {
    hasStarted = true;
    window.__YFONTS_DRAG_FONT_IDS__ = fontIds;
    publishDragDiagnostic({
      stage: "start",
      fontIds,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY
    });
    dragImage = createFontDragImage(family, fontIds.length);
    dragImage.classList.add("custom-pointer-drag");
    dragImage.style.left = "0";
    dragImage.style.top = "0";
    document.body.classList.add("project-font-dragging");
    moveDragImage(dragImage, pointerEvent.clientX, pointerEvent.clientY);
  }

  function updateDropTarget(pointerEvent: PointerEvent) {
    const packId = getProjectPackIdAtPoint(pointerEvent.clientX, pointerEvent.clientY);
    publishDragDiagnostic({
      stage: packId ? "hover-pack" : "hover-empty",
      fontIds,
      packId,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY
    });
    document.dispatchEvent(
      new CustomEvent("yfonts-project-drag-move", {
        detail: { packId }
      })
    );
  }

  function cleanup() {
    dragImage?.remove();
    dragImage = undefined;
    document.body.classList.remove("project-font-dragging");
    window.__YFONTS_DRAG_FONT_IDS__ = undefined;
    try {
      if (dragSource.hasPointerCapture(pointerId)) {
        dragSource.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture may already be gone after a system-level cancel.
    }
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(pointerEvent: PointerEvent) {
    const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
    if (!hasStarted && distance < 8) return;
    if (!hasStarted) startDrag(pointerEvent);

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    if (dragImage) moveDragImage(dragImage, pointerEvent.clientX, pointerEvent.clientY);
    updateDropTarget(pointerEvent);
  }

  function handlePointerUp(pointerEvent: PointerEvent) {
    if (!hasStarted) {
      cleanup();
      return;
    }

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    window.__YFONTS_DID_CUSTOM_DRAG__ = true;
    const packId = getProjectPackIdAtPoint(pointerEvent.clientX, pointerEvent.clientY);
    if (packId) {
      publishDragDiagnostic({
        stage: "drop-pack",
        fontIds,
        packId,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY
      });
      document.dispatchEvent(
        new CustomEvent("yfonts-project-drop", {
          detail: { packId, fontIds }
        })
      );
    } else {
      publishDragDiagnostic({
        stage: "drop-miss",
        fontIds,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        reason: "No project pack under pointer"
      });
      document.dispatchEvent(new CustomEvent("yfonts-project-drag-end"));
    }
    window.setTimeout(() => {
      window.__YFONTS_DID_CUSTOM_DRAG__ = undefined;
    }, 0);
    cleanup();
  }

  function handlePointerCancel() {
    publishDragDiagnostic({
      stage: "cancel",
      fontIds,
      reason: "Pointer cancelled"
    });
    document.dispatchEvent(new CustomEvent("yfonts-project-drag-end"));
    cleanup();
  }

  document.addEventListener("pointermove", handlePointerMove, { passive: false });
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerCancel);
}

function isInteractivePointerTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button, input, select, textarea, .variant-popover, .row-menu"));
}

function getProjectPackIdAtPoint(x: number, y: number) {
  return document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-project-pack-id]")
    ?.dataset.projectPackId;
}

function moveDragImage(element: HTMLElement, x: number, y: number) {
  element.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
}

function publishDragDiagnostic(diagnostic: NonNullable<Window["__YFONTS_LAST_DRAG_DIAGNOSTIC__"]>) {
  window.__YFONTS_LAST_DRAG_DIAGNOSTIC__ = diagnostic;
  document.dispatchEvent(
    new CustomEvent("yfonts-drag-diagnostic", {
      detail: diagnostic
    })
  );
}

function createFontDragImage(family: string, count: number) {
  const element = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("span");

  element.className = "font-drag-image";
  element.style.position = "fixed";
  element.style.left = "-9999px";
  element.style.top = "-9999px";
  title.textContent = family;
  meta.textContent = count > 1 ? `${count} ${t.fontsUnit}` : t.projectPacks;
  element.append(title, meta);
  document.body.append(element);

  return element;
}
