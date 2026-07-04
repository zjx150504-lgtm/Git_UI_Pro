import { Check, ChevronDown, Filter, FolderGit2, FolderPlus, FolderSearch, GitBranch, Pin, PinOff, Search, Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { PathTooltip } from "./PathTooltip";
import type { GitProject } from "../types/domain";

interface ProjectRailProps {
  projects: GitProject[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onToggleProjectPinned: (projectId: string) => void;
  onSwitchBranch: (project: GitProject) => void;
  footer?: ReactNode;
}

type ProjectContextMenuState = {
  project: GitProject;
  x: number;
  y: number;
};

type ProjectStatusFilterId = "pinned" | "dirty" | "clean" | "conflict" | "ahead" | "behind" | "diverged" | "unloaded";

const PROJECT_CONTEXT_MENU_WIDTH = 168;
const PROJECT_CONTEXT_MENU_HEIGHT = 76;
const PROJECT_STATUS_FILTER_MENU_WIDTH = 248;
const projectStatusFilterGroups: Array<{
  label: string;
  items: Array<{ id: ProjectStatusFilterId; label: string }>;
}> = [
  {
    label: "工作区",
    items: [
      { id: "dirty", label: "有更改" },
      { id: "clean", label: "干净" },
      { id: "conflict", label: "有冲突" }
    ]
  },
  {
    label: "同步",
    items: [
      { id: "ahead", label: "领先远程" },
      { id: "behind", label: "落后远程" },
      { id: "diverged", label: "领先且落后" }
    ]
  },
  {
    label: "项目",
    items: [
      { id: "pinned", label: "已置顶" },
      { id: "unloaded", label: "未加载状态" }
    ]
  }
];

export function ProjectRail({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onScanProjects,
  onRemoveProject,
  onReorderProjects,
  onToggleProjectPinned,
  onSwitchBranch,
  footer
}: ProjectRailProps) {
  const [query, setQuery] = useState("");
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [dragOverPlacement, setDragOverPlacement] = useState<"before" | "after">("before");
  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState<CSSProperties>({ top: 0, left: 0, width: PROJECT_STATUS_FILTER_MENU_WIDTH });
  const [statusFilters, setStatusFilters] = useState<ProjectStatusFilterId[]>([]);
  const filterMenuButtonRef = useRef<HTMLButtonElement>(null);
  const projectItemRefs = useRef(new Map<string, HTMLDivElement>());
  const contextMenuCloseTimerRef = useRef<number | undefined>();
  const keyword = query.trim();
  const filteredProjects = useMemo(() => {
    const statusFilteredProjects = statusFilters.length > 0 ? projects.filter((project) => projectMatchesStatusFilters(project, statusFilters)) : projects;
    if (!keyword) {
      return statusFilteredProjects;
    }

    return statusFilteredProjects
      .map((project, index) => ({ project, index, score: fuzzyProjectScore(project, keyword) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.project.favorite) - Number(a.project.favorite) || a.index - b.index)
      .map((item) => item.project);
  }, [projects, keyword, statusFilters]);
  const canReorder = keyword.length === 0 && statusFilters.length === 0;
  const visibleProjectIds = filteredProjects.map((project) => project.id);
  const statusFilterSummary = statusFilters.length === 0 ? "全部状态" : `${statusFilters.length} 项状态`;

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeOnPointerDown = () => closeContextMenu();
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.clearTimeout(contextMenuCloseTimerRef.current);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!filterMenuOpen) {
      return;
    }

    const closeFilterMenu = () => setFilterMenuOpen(false);
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFilterMenu();
      }
    };

    document.addEventListener("pointerdown", closeFilterMenu);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeFilterMenu);
    window.addEventListener("resize", closeFilterMenu);
    return () => {
      document.removeEventListener("pointerdown", closeFilterMenu);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeFilterMenu);
      window.removeEventListener("resize", closeFilterMenu);
    };
  }, [filterMenuOpen]);

  function toggleStatusFilter(filterId: ProjectStatusFilterId) {
    setStatusFilters((current) => (current.includes(filterId) ? current.filter((item) => item !== filterId) : [...current, filterId]));
  }

  function closeContextMenu() {
    window.clearTimeout(contextMenuCloseTimerRef.current);
    setContextMenu(null);
  }

  function scheduleContextMenuClose() {
    window.clearTimeout(contextMenuCloseTimerRef.current);
    contextMenuCloseTimerRef.current = window.setTimeout(() => {
      setContextMenu(null);
    }, 140);
  }

  function keepContextMenuOpen() {
    window.clearTimeout(contextMenuCloseTimerRef.current);
  }

  function updateFilterMenuPosition() {
    const rect = filterMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const maxLeft = Math.max(8, window.innerWidth - PROJECT_STATUS_FILTER_MENU_WIDTH - 8);
    setFilterMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left - 1, maxLeft)),
      width: PROJECT_STATUS_FILTER_MENU_WIDTH
    });
  }

  function openProjectContextMenu(event: MouseEvent<HTMLDivElement>, project: GitProject) {
    event.preventDefault();
    event.stopPropagation();
    keepContextMenuOpen();
    setContextMenu({
      project,
      x: Math.min(event.clientX, window.innerWidth - PROJECT_CONTEXT_MENU_WIDTH - 8),
      y: Math.min(event.clientY, window.innerHeight - PROJECT_CONTEXT_MENU_HEIGHT - 8)
    });
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, projectId: string) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }

    setDraggedProjectId(projectId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, projectId: string) {
    if (!canReorder || !draggedProjectId || draggedProjectId === projectId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDragOverProjectId(projectId);
    setDragOverPlacement(event.clientY > rect.top + rect.height / 2 ? "after" : "before");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, targetProjectId: string) {
    event.preventDefault();
    if (!canReorder || !draggedProjectId || draggedProjectId === targetProjectId) {
      clearDragState();
      return;
    }

    onReorderProjects(moveProjectId(visibleProjectIds, draggedProjectId, targetProjectId, dragOverPlacement));
    clearDragState();
  }

  function clearDragState() {
    setDraggedProjectId(null);
    setDragOverProjectId(null);
    setDragOverPlacement("before");
  }

  function setProjectItemRef(projectId: string, node: HTMLDivElement | null) {
    if (node) {
      projectItemRefs.current.set(projectId, node);
      return;
    }

    projectItemRefs.current.delete(projectId);
  }

  function focusProjectItem(projectId: string) {
    window.requestAnimationFrame(() => {
      projectItemRefs.current.get(projectId)?.focus();
    });
  }

  function selectProjectByOffset(offset: 1 | -1) {
    if (filteredProjects.length === 0) {
      return;
    }

    const currentIndex = filteredProjects.findIndex((project) => project.id === selectedProjectId);
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = (baseIndex + offset + filteredProjects.length) % filteredProjects.length;
    const nextProject = filteredProjects[nextIndex];

    closeContextMenu();
    onSelectProject(nextProject.id);
    focusProjectItem(nextProject.id);
  }

  function handleProjectListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, [contenteditable='true']")) {
      return;
    }

    event.preventDefault();
    selectProjectByOffset(event.key === "ArrowDown" ? 1 : -1);
  }

  return (
    <aside className="project-rail">
      <div className="project-rail-header">
        <strong>项目</strong>
        <div className="project-rail-actions">
          <button
            type="button"
            className="icon-button compact-icon"
            title="扫描父目录中的 Git 项目"
            aria-label="扫描父目录中的 Git 项目"
            onClick={onScanProjects}
          >
            <FolderSearch size={15} />
          </button>
          <button type="button" className="icon-button compact-icon" title="添加单个本地 Git 项目" aria-label="添加单个本地 Git 项目" onClick={onAddProject}>
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      <div className="project-rail-filterbar">
        <label className="project-rail-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
        </label>
        <div className="project-status-filter">
          <button
            ref={filterMenuButtonRef}
            type="button"
            className={`project-status-filter-button ${statusFilters.length > 0 ? "active" : ""}`}
            aria-expanded={filterMenuOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setContextMenu(null);
              if (!filterMenuOpen) {
                updateFilterMenuPosition();
              }
              setFilterMenuOpen((value) => !value);
            }}
          >
            <Filter size={14} />
            <span>{statusFilterSummary}</span>
            <ChevronDown size={14} />
          </button>
          {filterMenuOpen && typeof document !== "undefined"
            ? createPortal(
                <div className="floating-menu project-status-filter-menu" role="menu" style={filterMenuPosition} onPointerDown={(event) => event.stopPropagation()}>
                  <div className="project-status-filter-menu-header">
                    <span>筛选项目</span>
                    <small>{statusFilters.length === 0 ? "全部状态" : `已选 ${statusFilters.length}`}</small>
                  </div>
                  <button
                    type="button"
                    className={`project-status-filter-reset ${statusFilters.length === 0 ? "active" : ""}`}
                    role="menuitem"
                    onClick={() => setStatusFilters([])}
                  >
                    <span className="project-status-filter-option-mark" aria-hidden="true">
                      <Check size={12} />
                    </span>
                    <span className="project-status-filter-option-label">全部状态</span>
                  </button>
                  {projectStatusFilterGroups.map((group) => (
                    <div className="project-status-filter-group" role="group" aria-label={group.label} key={group.label}>
                      <div className="project-status-filter-group-title">{group.label}</div>
                      <div className="project-status-filter-options">
                        {group.items.map((item) => {
                          const selected = statusFilters.includes(item.id);
                          return (
                            <button
                              type="button"
                              className={`project-status-filter-option tone-${item.id} ${selected ? "active" : ""}`}
                              role="menuitemcheckbox"
                              aria-checked={selected}
                              key={item.id}
                              onClick={() => toggleStatusFilter(item.id)}
                            >
                              <span className="project-status-filter-option-mark" aria-hidden="true">
                                <Check size={12} />
                              </span>
                              <span className="project-status-filter-option-label">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>,
                document.querySelector(".app-shell") ?? document.body
              )
            : null}
        </div>
      </div>

      <div className="project-rail-list" tabIndex={0} onKeyDown={handleProjectListKeyDown}>
        {filteredProjects.map((project) => (
          <div
            ref={(node) => setProjectItemRef(project.id, node)}
            role="button"
            tabIndex={0}
            draggable={canReorder}
            aria-grabbed={draggedProjectId === project.id}
            className={`project-rail-item ${project.id === selectedProjectId ? "active" : ""} ${project.favorite ? "pinned" : ""} ${
              draggedProjectId === project.id ? "dragging" : ""
            } ${dragOverProjectId === project.id ? `drag-over drag-over-${dragOverPlacement}` : ""}`}
            key={project.id}
            onClick={(event) => {
              event.currentTarget.focus();
              onSelectProject(project.id);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectProject(project.id);
              }
            }}
            onDragStart={(event) => handleDragStart(event, project.id)}
            onDragOver={(event) => handleDragOver(event, project.id)}
            onDragLeave={() => {
              if (dragOverProjectId === project.id) {
                setDragOverProjectId(null);
              }
            }}
            onDrop={(event) => handleDrop(event, project.id)}
            onDragEnd={clearDragState}
            onContextMenu={(event) => openProjectContextMenu(event, project)}
          >
            <span className="project-rail-icon">
              <FolderGit2 size={16} />
            </span>
            <span className="project-rail-main">
              <PathTooltip path={project.path} className="project-rail-name">
                <span className="project-rail-name-text">{project.name}</span>
              </PathTooltip>
              <span className="project-rail-meta">
                <button
                  type="button"
                  className="project-rail-branch"
                  title="切换分支"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectProject(project.id);
                    onSwitchBranch(project);
                  }}
                >
                  <GitBranch size={12} />
                  <span>{project.status?.currentBranch ?? "未知分支"}</span>
                </button>
                {projectStatusTags(project).map((status) => (
                  <span className={`project-status ${status.tone}`} key={`${project.id}-${status.tone}-${status.label}`}>
                    {status.label}
                  </span>
                ))}
              </span>
            </span>
            {project.favorite ? (
              <span className="project-rail-pin-indicator" title="已置顶" aria-label="已置顶">
                <Pin size={12} />
              </span>
            ) : null}
          </div>
        ))}
        {filteredProjects.length === 0 ? <div className="empty-inline project-rail-empty">没有匹配项目。</div> : null}
      </div>
      {contextMenu ? (
        <div
          className="floating-menu project-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onMouseEnter={keepContextMenuOpen}
          onMouseLeave={scheduleContextMenuClose}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleProjectPinned(contextMenu.project.id);
              setContextMenu(null);
            }}
          >
            {contextMenu.project.favorite ? <PinOff size={14} /> : <Pin size={14} />}
            {contextMenu.project.favorite ? "取消置顶" : "置顶项目"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onRemoveProject(contextMenu.project.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={14} />
            移除项目记录
          </button>
        </div>
      ) : null}
      {footer ? <div className="project-rail-footer">{footer}</div> : null}
    </aside>
  );
}

function moveProjectId(projectIds: string[], sourceId: string, targetId: string, placement: "before" | "after"): string[] {
  const nextProjectIds = projectIds.filter((projectId) => projectId !== sourceId);
  const targetIndex = nextProjectIds.indexOf(targetId);
  if (targetIndex < 0) {
    return projectIds;
  }

  nextProjectIds.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, sourceId);
  return nextProjectIds;
}

function projectMatchesStatusFilters(project: GitProject, filters: ProjectStatusFilterId[]): boolean {
  if (filters.length === 0) {
    return true;
  }

  const status = project.status;
  const changedCount = status ? status.stagedCount + status.unstagedCount + status.untrackedCount : 0;
  return filters.some((filter) => {
    switch (filter) {
      case "pinned":
        return project.favorite;
      case "dirty":
        return changedCount > 0;
      case "clean":
        return Boolean(status) && changedCount === 0 && !status?.hasConflicts;
      case "conflict":
        return Boolean(status?.hasConflicts);
      case "ahead":
        return Boolean(status && status.ahead > 0);
      case "behind":
        return Boolean(status && status.behind > 0);
      case "diverged":
        return Boolean(status && status.ahead > 0 && status.behind > 0);
      case "unloaded":
        return !status;
      default:
        return false;
    }
  });
}

function fuzzyProjectScore(project: GitProject, query: string): number {
  const nameScore = fuzzyTextScore(project.name, query) * 3;
  const branchScore = fuzzyTextScore(project.status?.currentBranch ?? "", query) * 1.6;
  const pathScore = fuzzyTextScore(project.path, query);
  return Math.max(nameScore, branchScore, pathScore);
}

function fuzzyTextScore(value: string, query: string): number {
  const text = normalizeSearchText(value);
  const keyword = normalizeSearchText(query);
  if (!keyword) {
    return 1;
  }

  const directIndex = text.indexOf(keyword);
  if (directIndex >= 0) {
    return 1200 - directIndex * 2 + Math.min(keyword.length * 10, 120);
  }

  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const char of keyword) {
    const index = text.indexOf(char, cursor);
    if (index < 0) {
      return 0;
    }

    const gap = index - cursor;
    streak = gap === 0 ? streak + 1 : 0;
    score += 24 + Math.max(0, 14 - gap) + streak * 4;
    cursor = index + 1;
  }

  return score;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

type ProjectStatusTone = "unknown" | "conflict" | "dirty" | "sync" | "clean";

function projectStatusTags(project: GitProject): Array<{ label: string; tone: ProjectStatusTone }> {
  const status = project.status;
  if (!status) {
    return [{ label: "未加载", tone: "unknown" }];
  }

  const tags: Array<{ label: string; tone: ProjectStatusTone }> = [];
  if (status.hasConflicts) {
    tags.push({ label: "有冲突", tone: "conflict" });
  }

  const changedCount = status.stagedCount + status.unstagedCount + status.untrackedCount;
  if (changedCount > 0) {
    tags.push({ label: `${changedCount} 更改`, tone: "dirty" });
  }

  if (status.ahead > 0 || status.behind > 0) {
    tags.push({
      label: [status.ahead > 0 ? `领先 ${status.ahead}` : "", status.behind > 0 ? `落后 ${status.behind}` : ""].filter(Boolean).join(" / "),
      tone: "sync"
    });
  }

  if (tags.length === 0) {
    tags.push({ label: "干净", tone: "clean" });
  }

  return tags;
}
