import {
  ChevronRight,
  CloudDownload,
  Grid2X2,
  HardDrive,
  EyeOff,
  ArchiveX,
  Folder,
  FolderPlus,
  Layers3,
  Pencil,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Star,
  Trash2
} from "lucide-react";
import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import appIcon from "../assets/yfonts-icon.png";
import { t } from "../lib/i18n";
import { appVersion } from "../lib/appUpdate";
import type { ProjectPack } from "../types";

export type SectionId =
  | "all"
  | "local"
  | "online"
  | "free"
  | "review"
  | "favorites"
  | "projectPacks"
  | "hidden"
  | "removed";

type SidebarProps = {
  activeSection: SectionId;
  onChange: (section: SectionId) => void;
  counts: Record<SectionId, number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hasSelectedFonts: boolean;
  projectPacks: ProjectPack[];
  selectedProjectPackId?: string;
  onCreateProjectPack: (name: string, parentId?: string) => void;
  onRenameProjectPack: (packId: string, name: string) => void;
  onSelectProjectPack: (packId: string) => void;
  onRemoveProjectPack: (packId: string) => void;
  onDropFontsToProjectPack: (fontIds: string[], packId: string) => void;
};

const sections: Array<{
  id: SectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "all", label: t.allFonts, icon: Grid2X2 },
  { id: "local", label: t.localFontPacks, icon: HardDrive },
  { id: "online", label: t.onlineDiscover, icon: CloudDownload },
  { id: "free", label: t.freeCommercial, icon: ShieldCheck },
  { id: "favorites", label: t.favorites, icon: Star },
  { id: "hidden", label: t.hiddenFonts, icon: EyeOff },
  { id: "removed", label: t.removedFonts, icon: ArchiveX }
];

export function Sidebar({
  activeSection,
  onChange,
  counts,
  collapsed,
  onToggleCollapsed,
  hasSelectedFonts,
  projectPacks,
  selectedProjectPackId,
  onCreateProjectPack,
  onRenameProjectPack,
  onSelectProjectPack,
  onRemoveProjectPack,
  onDropFontsToProjectPack
}: SidebarProps) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creatingParentId, setCreatingParentId] = useState<string>();
  const [dragOverPackId, setDragOverPackId] = useState<string>();
  const [isProjectTreeDragging, setIsProjectTreeDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ packId: string; x: number; y: number }>();
  const [renamingPackId, setRenamingPackId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!contextMenu) return;

    function closeContextMenu() {
      setContextMenu(undefined);
    }

    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") closeContextMenu();
    }

    document.addEventListener("click", closeContextMenu);
    document.addEventListener("keydown", closeWithKeyboard);
    document.addEventListener("yfonts:close-context-menus", closeContextMenu);

    return () => {
      document.removeEventListener("click", closeContextMenu);
      document.removeEventListener("keydown", closeWithKeyboard);
      document.removeEventListener("yfonts:close-context-menus", closeContextMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    function removeSelectedProjectPack(event: KeyboardEvent) {
      if (activeSection !== "projectPacks" || !selectedProjectPackId) return;
      if (hasSelectedFonts) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === "Delete") {
        event.preventDefault();
        onRemoveProjectPack(selectedProjectPackId);
        setContextMenu(undefined);
        setRenamingPackId(undefined);
      }

      if (event.key === "F2" && !collapsed) {
        event.preventDefault();
        startRenamingProject(selectedProjectPackId);
      }
    }

    document.addEventListener("keydown", removeSelectedProjectPack);

    return () => {
      document.removeEventListener("keydown", removeSelectedProjectPack);
    };
  }, [activeSection, hasSelectedFonts, onRemoveProjectPack, selectedProjectPackId]);

  useEffect(() => {
    function handleProjectDragMove(event: Event) {
      const detail = (event as CustomEvent<{ packId?: string }>).detail;
      setIsProjectTreeDragging(true);
      setDragOverPackId(detail?.packId);
    }

    function handleProjectDrop(event: Event) {
      const detail = (event as CustomEvent<{ packId?: string; fontIds?: string[] }>).detail;
      const fontIds = detail?.fontIds?.filter((fontId): fontId is string => typeof fontId === "string") ?? [];

      if (detail?.packId && fontIds.length > 0) {
        onDropFontsToProjectPack(fontIds, detail.packId);
      }

      setIsProjectTreeDragging(false);
      setDragOverPackId(undefined);
    }

    function handleProjectDragEnd() {
      setIsProjectTreeDragging(false);
      setDragOverPackId(undefined);
    }

    document.addEventListener("yfonts-project-drag-move", handleProjectDragMove);
    document.addEventListener("yfonts-project-drop", handleProjectDrop);
    document.addEventListener("yfonts-project-drag-end", handleProjectDragEnd);

    return () => {
      document.removeEventListener("yfonts-project-drag-move", handleProjectDragMove);
      document.removeEventListener("yfonts-project-drop", handleProjectDrop);
      document.removeEventListener("yfonts-project-drag-end", handleProjectDragEnd);
    };
  }, [onDropFontsToProjectPack]);

  function submitProjectPack() {
    const name = projectName.trim();
    if (!name) return;

    onCreateProjectPack(name, creatingParentId);
    setProjectName("");
    setCreatingParentId(undefined);
    setIsCreatingProject(false);
  }

  function getDraggedFontIds(event: DragEvent<HTMLElement>) {
    const listPayload = event.dataTransfer.getData("application/x-yfonts-font-ids");
    if (listPayload) {
      try {
        const parsed = JSON.parse(listPayload);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        return [];
      }
    }

    const singleFontId = event.dataTransfer.getData("application/x-yfonts-font-id");
    if (singleFontId) return [singleFontId];

    const textPayload = event.dataTransfer.getData("text/plain");
    if (textPayload.startsWith("yfonts:")) {
      try {
        const parsed = JSON.parse(textPayload.slice("yfonts:".length));
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        return [];
      }
    }

    return window.__YFONTS_DRAG_FONT_IDS__ ?? [];
  }

  function hasYFontsDrag(event: DragEvent<HTMLElement>) {
    return (
      Array.from(event.dataTransfer.types).some((type) => type.startsWith("application/x-yfonts")) ||
      Array.from(event.dataTransfer.types).includes("text/plain") ||
      Boolean(window.__YFONTS_DRAG_FONT_IDS__?.length)
    );
  }

  function acceptProjectDrag(event: DragEvent<HTMLElement>, packId: string) {
    if (!hasYFontsDrag(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsProjectTreeDragging(true);
    setDragOverPackId(packId);
  }

  function findDropPackId(event: DragEvent<HTMLElement>) {
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-project-pack-id]");
    return target?.dataset.projectPackId;
  }

  function openProjectContextMenu(event: MouseEvent<HTMLElement>, packId: string) {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new Event("yfonts:close-context-menus"));
    setContextMenu({ packId, ...getContextMenuPosition(event) });
  }

  function startCreatingProject(parentId?: string) {
    setCreatingParentId(parentId);
    setProjectName("");
    setIsCreatingProject(true);
    setContextMenu(undefined);
  }

  function startRenamingProject(packId: string) {
    const pack = projectPacks.find((item) => item.id === packId);
    if (!pack) return;

    setRenamingPackId(pack.id);
    setRenameValue(pack.name);
    setContextMenu(undefined);
    setIsCreatingProject(false);
  }

  function submitRenamingProject() {
    if (!renamingPackId) return;
    const name = renameValue.trim();
    if (!name) return;

    onRenameProjectPack(renamingPackId, name);
    setRenamingPackId(undefined);
    setRenameValue("");
  }

  const rootPacks = projectPacks.filter((pack) => !pack.parentId);
  const childPacksByParentId = new Map<string, ProjectPack[]>();

  for (const pack of projectPacks) {
    if (!pack.parentId) continue;
    const childPacks = childPacksByParentId.get(pack.parentId) ?? [];
    childPacks.push(pack);
    childPacksByParentId.set(pack.parentId, childPacks);
  }

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-mark">
            <img src={appIcon} alt="" />
          </div>
          <div>
            <strong>YFonts {appVersion}</strong>
            <span>{t.appSubtitle}</span>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? t.expandSidebar : t.collapseSidebar}
          aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
        >
          <ToggleIcon size={16} />
        </button>
      </div>

      <nav className="nav-list" aria-label={t.allFonts}>
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              className={activeSection === section.id ? "nav-item active" : "nav-item"}
              onClick={() => onChange(section.id)}
              type="button"
              title={section.label}
            >
              <Icon size={18} />
              <span>{section.label}</span>
              <em>{counts[section.id]}</em>
            </button>
          );
        })}
      </nav>

      <section
        className={isProjectTreeDragging ? "project-tree dragging-font" : "project-tree"}
        aria-label={t.projectPacks}
        onDragEnter={(event) => {
          if (!hasYFontsDrag(event)) return;
          event.preventDefault();
          setIsProjectTreeDragging(true);
          const packId = findDropPackId(event);
          if (packId) setDragOverPackId(packId);
        }}
        onDragOver={(event) => {
          if (!hasYFontsDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          setIsProjectTreeDragging(true);
          const packId = findDropPackId(event);
          if (packId) setDragOverPackId(packId);
        }}
        onDragEnd={() => {
          setIsProjectTreeDragging(false);
          setDragOverPackId(undefined);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setIsProjectTreeDragging(false);
          setDragOverPackId(undefined);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const packId = dragOverPackId ?? findDropPackId(event);
          const fontIds = getDraggedFontIds(event);
          if (packId && fontIds.length > 0) onDropFontsToProjectPack(fontIds, packId);
          window.__YFONTS_DRAG_FONT_IDS__ = undefined;
          setIsProjectTreeDragging(false);
          setDragOverPackId(undefined);
        }}
      >
        <div className="project-tree-head">
          <button
            className={
              activeSection === "projectPacks" && !selectedProjectPackId
                ? "project-tree-title active"
                : "project-tree-title"
            }
            type="button"
            onClick={() => onChange("projectPacks")}
            title={t.projectPacks}
          >
            <Layers3 size={17} />
            <span>{t.projectPacks}</span>
            <em>{rootPacks.length}</em>
          </button>
          <button
            className="project-add-button"
            type="button"
            onClick={() => startCreatingProject()}
            title={t.newPack}
            aria-label={t.newPack}
          >
            <FolderPlus size={16} />
          </button>
        </div>

        {isCreatingProject && !collapsed && (
          <div className="project-create-inline">
            <input
              autoFocus
              value={projectName}
              placeholder={
                creatingParentId ? t.projectCategoryNamePlaceholder : t.projectPackNamePlaceholder
              }
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitProjectPack();
              if (event.key === "Escape") {
                setProjectName("");
                setCreatingParentId(undefined);
                setIsCreatingProject(false);
              }
              }}
            />
          </div>
        )}

        <div className="project-pack-list">
          {rootPacks.map((pack) => {
            const isActive = activeSection === "projectPacks" && selectedProjectPackId === pack.id;
            const isDropTarget = dragOverPackId === pack.id;
            const childPacks = childPacksByParentId.get(pack.id) ?? [];

            return (
              <div className="project-pack-group" key={pack.id}>
                <ProjectPackItem
                  pack={pack}
                  active={isActive}
                  contextTarget={contextMenu?.packId === pack.id}
                  dropTarget={isDropTarget}
                  count={getPackDisplayCount(projectPacks, pack)}
                  renaming={renamingPackId === pack.id}
                  renameValue={renameValue}
                  onRenameValueChange={setRenameValue}
                  onSubmitRename={submitRenamingProject}
                  onCancelRename={() => setRenamingPackId(undefined)}
                  onContextMenu={openProjectContextMenu}
                  onSelect={onSelectProjectPack}
                  onDragAccept={acceptProjectDrag}
                  onDragLeave={() => setDragOverPackId(undefined)}
                  onDropFonts={(fontIds) => onDropFontsToProjectPack(fontIds, pack.id)}
                  getDraggedFontIds={getDraggedFontIds}
                  onDropEnd={() => {
                    setIsProjectTreeDragging(false);
                    setDragOverPackId(undefined);
                  }}
                />
                {childPacks.length > 0 && (
                  <div className="project-subpack-list">
                    {childPacks.map((childPack) => (
                      <ProjectPackItem
                        key={childPack.id}
                        pack={childPack}
                        child
                        active={activeSection === "projectPacks" && selectedProjectPackId === childPack.id}
                        contextTarget={contextMenu?.packId === childPack.id}
                        dropTarget={dragOverPackId === childPack.id}
                        count={childPack.fontIds.length}
                        renaming={renamingPackId === childPack.id}
                        renameValue={renameValue}
                        onRenameValueChange={setRenameValue}
                        onSubmitRename={submitRenamingProject}
                        onCancelRename={() => setRenamingPackId(undefined)}
                        onContextMenu={openProjectContextMenu}
                        onSelect={onSelectProjectPack}
                        onDragAccept={acceptProjectDrag}
                        onDragLeave={() => setDragOverPackId(undefined)}
                        onDropFonts={(fontIds) => onDropFontsToProjectPack(fontIds, childPack.id)}
                        getDraggedFontIds={getDraggedFontIds}
                        onDropEnd={() => {
                          setIsProjectTreeDragging(false);
                          setDragOverPackId(undefined);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {contextMenu && (
          <div
            className="project-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button type="button" onClick={() => startRenamingProject(contextMenu.packId)}>
              <Pencil size={14} />
              {t.renameProjectPack}
            </button>
            {!projectPacks.find((pack) => pack.id === contextMenu.packId)?.parentId && (
              <button
                type="button"
                onClick={() => startCreatingProject(contextMenu.packId)}
              >
                <FolderPlus size={14} />
                {t.createProjectCategory}
              </button>
            )}
            <button
              className="danger"
              type="button"
              onClick={() => {
                onRemoveProjectPack(contextMenu.packId);
                setContextMenu(undefined);
              }}
            >
              <Trash2 size={14} />
              {t.removeProjectPack}
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}

function ProjectPackItem({
  pack,
  child = false,
  active,
  contextTarget,
  dropTarget,
  count,
  renaming,
  renameValue,
  onRenameValueChange,
  onSubmitRename,
  onCancelRename,
  onContextMenu,
  onSelect,
  onDragAccept,
  onDragLeave,
  onDropFonts,
  getDraggedFontIds,
  onDropEnd
}: {
  pack: ProjectPack;
  child?: boolean;
  active: boolean;
  contextTarget: boolean;
  dropTarget: boolean;
  count: number;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, packId: string) => void;
  onSelect: (packId: string) => void;
  onDragAccept: (event: DragEvent<HTMLElement>, packId: string) => void;
  onDragLeave: () => void;
  onDropFonts: (fontIds: string[]) => void;
  getDraggedFontIds: (event: DragEvent<HTMLElement>) => string[];
  onDropEnd: () => void;
}) {
  return (
    <div
      className={[
        "project-pack-item",
        child ? "child" : "",
        active ? "active" : "",
        contextTarget ? "context-target" : "",
        dropTarget ? "drop-target" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-project-pack-id={pack.id}
      onContextMenu={(event) => {
        if (renaming) return;
        onContextMenu(event, pack.id);
      }}
      onDragEnter={(event) => onDragAccept(event, pack.id)}
      onDragOver={(event) => onDragAccept(event, pack.id)}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        onDragLeave();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const fontIds = getDraggedFontIds(event);
        if (fontIds.length > 0) onDropFonts(fontIds);
        window.__YFONTS_DRAG_FONT_IDS__ = undefined;
        onDropEnd();
      }}
    >
      {renaming ? (
        <div className="project-rename-inline">
          {child ? <ChevronRight size={14} /> : <Folder size={16} />}
          <input
            autoFocus
            value={renameValue}
            aria-label={t.renameProjectPack}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={onSubmitRename}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmitRename();
              if (event.key === "Escape") onCancelRename();
            }}
          />
        </div>
      ) : (
        <button type="button" title={pack.name} onClick={() => onSelect(pack.id)}>
          {child ? <ChevronRight size={14} /> : <Folder size={16} />}
          <span>{pack.name}</span>
          <em>{count}</em>
        </button>
      )}
    </div>
  );
}

function getPackDisplayCount(packs: ProjectPack[], pack: ProjectPack) {
  const fontIds = new Set(pack.fontIds);

  for (const childPack of packs) {
    if (childPack.parentId !== pack.id) continue;
    childPack.fontIds.forEach((fontId) => fontIds.add(fontId));
  }

  return fontIds.size;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function getContextMenuPosition(event: MouseEvent<HTMLElement>) {
  const menuWidth = 156;
  const menuHeight = 44;
  const padding = 8;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

  return {
    x: Math.max(padding, x),
    y: Math.max(padding, y)
  };
}
