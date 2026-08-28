import { Check, ChevronDown, ChevronRight, Filter, FolderClosed, FolderOpen, FolderPlus, FolderSearch, GitBranch, Pencil, Pin, PinOff, Search, Server, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
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
import type { GitProject, ProjectGroup } from "../types/domain";

interface ProjectRailProps {
  projects: GitProject[];
  groups: ProjectGroup[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onAddRemoteProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onToggleProjectPinned: (projectId: string) => void;
  onSetProjectGroup: (projectId: string, groupId?: string) => void | Promise<void>;
  onRenameProject: (projectId: string, name: string) => void | Promise<void>;
  onRenameGroup: (groupId: string, name: string) => void | Promise<void>;
  onSetRemoteConnectionEnabled: (projectId: string, enabled: boolean) => void | Promise<void>;
  onSwitchBranch: (project: GitProject) => void;
  footer?: ReactNode;
}

type ProjectContextMenuState = ({ kind: "project"; project: GitProject } | { kind: "group"; group: ProjectGroup }) & {
  x: number;
  y: number;
};

type InlineRenameTarget = {
  kind: "project" | "group";
  id: string;
};

type ProjectStatusFilterId = "pinned" | "dirty" | "clean" | "conflict" | "ahead" | "behind" | "diverged" | "unloaded";

const PROJECT_CONTEXT_MENU_WIDTH = 216;
const PROJECT_CONTEXT_MENU_VIEWPORT_GAP = 8;
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
  groups,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onAddRemoteProject,
  onScanProjects,
  onRemoveProject,
  onReorderProjects,
  onToggleProjectPinned,
  onSetProjectGroup,
  onRenameProject,
  onRenameGroup,
  onSetRemoteConnectionEnabled,
  onSwitchBranch,
  footer
}: ProjectRailProps) {
  const [query, setQuery] = useState("");
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [dragOverPlacement, setDragOverPlacement] = useState<"before" | "after">("before");
  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<InlineRenameTarget | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState<CSSProperties>({ top: 0, left: 0, width: PROJECT_STATUS_FILTER_MENU_WIDTH });
  const [statusFilters, setStatusFilters] = useState<ProjectStatusFilterId[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [remoteConnectionPendingIds, setRemoteConnectionPendingIds] = useState<string[]>([]);
  const searchControlRef = useRef<HTMLLabelElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterMenuButtonRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuOpenerRef = useRef<HTMLElement | null>(null);
  const projectItemRefs = useRef(new Map<string, HTMLDivElement>());
  const groupHeaderRefs = useRef(new Map<string, HTMLButtonElement>());
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
  const groupedProjects = useMemo(() => {
    const configuredGroups = [...groups].sort((left, right) => left.sortOrder - right.sortOrder);
    const knownGroupIds = new Set(configuredGroups.map((group) => group.id));
    const entries = configuredGroups.map((group) => ({
      id: group.id,
      name: group.name,
      projects: filteredProjects.filter((project) => project.groupId === group.id)
    })).filter((group) => group.projects.length > 0);
    const ungrouped = filteredProjects.filter((project) => !project.groupId || !knownGroupIds.has(project.groupId));
    if (ungrouped.length > 0) {
      entries.push({ id: "__ungrouped__", name: "未分组", projects: ungrouped });
    }
    return entries;
  }, [filteredProjects, groups]);
  const showGroupHeaders = groups.length > 0;
  const hasActiveFiltering = keyword.length > 0 || statusFilters.length > 0;
  const displayedProjects = groupedProjects.flatMap((group) =>
    showGroupHeaders && !hasActiveFiltering && collapsedGroupIds.includes(group.id) ? [] : group.projects
  );
  const canReorder = !hasActiveFiltering && displayedProjects.length === filteredProjects.length;
  const visibleProjectIds = displayedProjects.map((project) => project.id);
  const visibleGroupByProjectId = new Map(groupedProjects.flatMap((group) => group.projects.map((project) => [project.id, group.id] as const)));
  const statusFilterSummary = statusFilters.length === 0 ? "全部状态" : `${statusFilters.length} 项状态`;

  useEffect(() => {
    const closeSearchOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !searchControlRef.current?.contains(target)) {
        searchInputRef.current?.blur();
      }
    };

    document.addEventListener("pointerdown", closeSearchOnPointerDown, true);
    return () => document.removeEventListener("pointerdown", closeSearchOnPointerDown, true);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => focusFirstMenuItem(contextMenuRef.current));
    const closeOnPointerDown = () => closeContextMenu();
    const closeOnWindowChange = () => closeContextMenu();
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu(true);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeOnWindowChange);
    window.addEventListener("resize", closeOnWindowChange);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(contextMenuCloseTimerRef.current);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeOnWindowChange);
      window.removeEventListener("resize", closeOnWindowChange);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return;
    }

    const rect = contextMenuRef.current.getBoundingClientRect();
    const nextX = Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(contextMenu.x, window.innerWidth - rect.width - PROJECT_CONTEXT_MENU_VIEWPORT_GAP));
    const nextY = Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(contextMenu.y, window.innerHeight - rect.height - PROJECT_CONTEXT_MENU_VIEWPORT_GAP));
    if (Math.abs(nextX - contextMenu.x) > 0.5 || Math.abs(nextY - contextMenu.y) > 0.5) {
      setContextMenu((current) => current ? { ...current, x: nextX, y: nextY } : current);
    }
  }, [contextMenu, groups.length]);

  useEffect(() => {
    if (!filterMenuOpen) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => focusFirstMenuItem(filterMenuRef.current));
    const closeFilterMenu = (restoreFocus = false) => {
      setFilterMenuOpen(false);
      if (restoreFocus) {
        window.requestAnimationFrame(() => filterMenuButtonRef.current?.focus());
      }
    };
    const closeOnPointerDown = () => closeFilterMenu();
    const closeOnWindowChange = () => closeFilterMenu();
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFilterMenu(true);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeOnWindowChange);
    window.addEventListener("resize", closeOnWindowChange);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeOnWindowChange);
      window.removeEventListener("resize", closeOnWindowChange);
    };
  }, [filterMenuOpen]);

  function toggleStatusFilter(filterId: ProjectStatusFilterId) {
    setStatusFilters((current) => (current.includes(filterId) ? current.filter((item) => item !== filterId) : [...current, filterId]));
  }

  function closeContextMenu(restoreFocus = false) {
    window.clearTimeout(contextMenuCloseTimerRef.current);
    setContextMenu(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => contextMenuOpenerRef.current?.focus());
    }
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
    showProjectContextMenu(project, event.clientX, event.clientY, event.currentTarget);
  }

  function showProjectContextMenu(project: GitProject, x: number, y: number, opener: HTMLElement) {
    keepContextMenuOpen();
    contextMenuOpenerRef.current = opener;
    setContextMenu({
      kind: "project",
      project,
      x: Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(x, window.innerWidth - PROJECT_CONTEXT_MENU_WIDTH - PROJECT_CONTEXT_MENU_VIEWPORT_GAP)),
      y: Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(y, window.innerHeight - PROJECT_CONTEXT_MENU_VIEWPORT_GAP))
    });
  }

  function openGroupContextMenu(event: MouseEvent<HTMLButtonElement>, group: ProjectGroup) {
    event.preventDefault();
    event.stopPropagation();
    keepContextMenuOpen();
    contextMenuOpenerRef.current = event.currentTarget;
    setContextMenu({
      kind: "group",
      group,
      x: Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(event.clientX, window.innerWidth - PROJECT_CONTEXT_MENU_WIDTH - PROJECT_CONTEXT_MENU_VIEWPORT_GAP)),
      y: Math.max(PROJECT_CONTEXT_MENU_VIEWPORT_GAP, Math.min(event.clientY, window.innerHeight - PROJECT_CONTEXT_MENU_VIEWPORT_GAP))
    });
  }

  function beginInlineRename(target: InlineRenameTarget) {
    closeContextMenu();
    setRenameTarget(target);
  }

  function finishInlineRename(target: InlineRenameTarget) {
    setRenameTarget((current) => current?.kind === target.kind && current.id === target.id ? null : current);
    window.requestAnimationFrame(() => {
      if (target.kind === "project") {
        projectItemRefs.current.get(target.id)?.focus();
      } else {
        groupHeaderRefs.current.get(target.id)?.focus();
      }
    });
  }

  function reorderProjectByKeyboard(project: GitProject, offset: -1 | 1) {
    if (!canReorder) {
      setReorderAnnouncement("筛选或分组折叠时不能调整项目顺序。");
      return;
    }

    const groupId = visibleGroupByProjectId.get(project.id);
    const groupProjectIds = visibleProjectIds.filter((projectId) => {
      const candidate = projects.find((item) => item.id === projectId);
      return visibleGroupByProjectId.get(projectId) === groupId && candidate?.favorite === project.favorite;
    });
    const currentIndex = groupProjectIds.indexOf(project.id);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= groupProjectIds.length) {
      setReorderAnnouncement(`${project.name} 已经位于当前分组${offset < 0 ? "顶部" : "底部"}。`);
      return;
    }

    const targetProjectId = groupProjectIds[nextIndex];
    onReorderProjects(moveProjectId(visibleProjectIds, project.id, targetProjectId, offset < 0 ? "before" : "after"));
    setReorderAnnouncement(`${project.name} 已${offset < 0 ? "上移" : "下移"}到当前分组第 ${nextIndex + 1} 位。`);
    focusProjectItem(project.id);
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
    if (
      !canReorder ||
      !draggedProjectId ||
      draggedProjectId === projectId ||
      visibleGroupByProjectId.get(draggedProjectId) !== visibleGroupByProjectId.get(projectId)
    ) {
      setDragOverProjectId(null);
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
    if (
      !canReorder ||
      !draggedProjectId ||
      draggedProjectId === targetProjectId ||
      visibleGroupByProjectId.get(draggedProjectId) !== visibleGroupByProjectId.get(targetProjectId)
    ) {
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

  function toggleGroup(groupId: string) {
    setCollapsedGroupIds((current) => current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]);
  }

  async function toggleRemoteConnection(event: MouseEvent<HTMLButtonElement>, project: GitProject) {
    event.stopPropagation();
    if (!project.remote || remoteConnectionPendingIds.includes(project.id)) {
      return;
    }

    setRemoteConnectionPendingIds((current) => [...current, project.id]);
    try {
      await onSetRemoteConnectionEnabled(project.id, project.remote.connectionEnabled === false);
    } finally {
      setRemoteConnectionPendingIds((current) => current.filter((projectId) => projectId !== project.id));
    }
  }

  function renderProjectItem(project: GitProject) {
    const renaming = renameTarget?.kind === "project" && renameTarget.id === project.id;
    const remoteConnectionEnabled = project.remote?.connectionEnabled !== false;
    const remoteConnectionPending = remoteConnectionPendingIds.includes(project.id);
    const branchLabel = !remoteConnectionEnabled
      ? "连接已暂停"
      : project.statusError
        ? "状态不可用"
        : project.status?.currentBranch ?? "未加载";
    const branchTooltip = !remoteConnectionEnabled
      ? "远程连接已暂停，不会自动重连"
      : project.statusError ?? (project.status ? "切换分支" : "仓库状态尚未加载");
    const branchAriaLabel = !remoteConnectionEnabled
      ? "远程连接已暂停"
      : project.statusError
        ? "仓库状态不可用"
        : project.status
          ? `切换分支，当前 ${branchLabel}`
          : "仓库状态尚未加载";
    return (
      <div
        ref={(node) => setProjectItemRef(project.id, node)}
        role="button"
        tabIndex={0}
        draggable={canReorder && !renaming}
        aria-grabbed={draggedProjectId === project.id}
        aria-haspopup="menu"
        aria-expanded={contextMenu?.kind === "project" && contextMenu.project.id === project.id}
        aria-describedby="project-reorder-help"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+F10"
        className={`project-rail-item ${project.id === selectedProjectId ? "active" : ""} ${project.favorite ? "pinned" : ""} ${project.remote ? "remote-project" : ""} ${project.remote && !remoteConnectionEnabled ? "remote-paused" : ""} ${draggedProjectId === project.id ? "dragging" : ""} ${dragOverProjectId === project.id ? `drag-over drag-over-${dragOverPlacement}` : ""}`}
        key={project.id}
        onClick={(event) => { event.currentTarget.focus(); onSelectProject(project.id); }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            showProjectContextMenu(project, rect.left + 18, rect.top + 18, event.currentTarget);
            return;
          }

          if (event.target === event.currentTarget && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            reorderProjectByKeyboard(project, event.key === "ArrowUp" ? -1 : 1);
            return;
          }

          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onSelectProject(project.id);
          }
        }}
        onDragStart={(event) => handleDragStart(event, project.id)}
        onDragOver={(event) => handleDragOver(event, project.id)}
        onDragLeave={() => { if (dragOverProjectId === project.id) setDragOverProjectId(null); }}
        onDrop={(event) => handleDrop(event, project.id)}
        onDragEnd={clearDragState}
        onContextMenu={(event) => {
          if (renaming) {
            event.preventDefault();
            return;
          }
          openProjectContextMenu(event, project);
        }}
      >
        <span className="project-rail-icon">
          {project.id === selectedProjectId
            ? <FolderOpen size={16} strokeWidth={1.65} />
            : <FolderClosed size={16} strokeWidth={1.65} />}
        </span>
        <span className="project-rail-main">
          <span className="project-rail-heading">
            {renaming ? (
              <InlineRenameInput
                ariaLabel={`修改项目名称：${project.name}`}
                initialValue={project.name}
                maxLength={80}
                onCommit={(name) => onRenameProject(project.id, name)}
                onFinish={() => finishInlineRename({ kind: "project", id: project.id })}
              />
            ) : (
              <PathTooltip content={projectLocationLabel(project)} className="project-rail-name"><span className="project-rail-name-text">{project.name}</span></PathTooltip>
            )}
            {project.remote ? (
              <PathTooltip
                content={remoteConnectionPending ? "正在保存连接状态" : remoteConnectionEnabled ? "关闭远程连接" : "开启远程连接"}
                className="project-remote-connection-tooltip"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={remoteConnectionEnabled}
                  aria-label={`${remoteConnectionEnabled ? "关闭" : "开启"} ${project.name} 的远程连接`}
                  className={`project-remote-connection-switch ${remoteConnectionEnabled ? "enabled" : ""} ${remoteConnectionPending ? "pending" : ""}`}
                  disabled={remoteConnectionPending}
                  onClick={(event) => void toggleRemoteConnection(event, project)}
                >
                  <span aria-hidden="true" />
                </button>
              </PathTooltip>
            ) : null}
          </span>
          <span className="project-rail-meta">
            <span className="project-rail-meta-badges">
              <PathTooltip content={branchTooltip} className="project-rail-branch-tooltip">
                <button type="button" className="project-rail-branch" aria-label={branchAriaLabel} disabled={!remoteConnectionEnabled || Boolean(project.statusError)} onClick={(event) => { event.stopPropagation(); onSelectProject(project.id); onSwitchBranch(project); }}>
                  <GitBranch size={12} /><span>{branchLabel}</span>
                </button>
              </PathTooltip>
              {projectStatusTags(project).map((status) => <PathTooltip content={status.title} className="project-status-tooltip" key={`${project.id}-${status.tone}-${status.label}`}><span className={`project-status ${status.tone}`}>{status.label}</span></PathTooltip>)}
            </span>
          </span>
        </span>
        {project.favorite ? <PathTooltip content="已置顶" className="project-rail-pin-tooltip"><span className="project-rail-pin-indicator" aria-label="已置顶"><Pin size={12} /></span></PathTooltip> : null}
      </div>
    );
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
    if (displayedProjects.length === 0) {
      return;
    }

    const currentIndex = displayedProjects.findIndex((project) => project.id === selectedProjectId);
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = (baseIndex + offset + displayedProjects.length) % displayedProjects.length;
    const nextProject = displayedProjects[nextIndex];

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
          <PathTooltip content="扫描父目录中的 Git 项目" className="project-action-tooltip">
            <button type="button" className="icon-button compact-icon" aria-label="扫描父目录中的 Git 项目" onClick={onScanProjects}>
              <FolderSearch size={15} />
            </button>
          </PathTooltip>
          <PathTooltip content="添加单个本地 Git 项目" className="project-action-tooltip">
            <button type="button" className="icon-button compact-icon" aria-label="添加单个本地 Git 项目" onClick={onAddProject}>
              <FolderPlus size={15} />
            </button>
          </PathTooltip>
          <PathTooltip content="连接远程 Git 项目" className="project-action-tooltip">
            <button type="button" className="icon-button compact-icon" aria-label="连接远程 Git 项目" onClick={onAddRemoteProject}>
              <Server size={15} />
            </button>
          </PathTooltip>
          <PathTooltip content="搜索项目" className="project-action-tooltip project-search-tooltip">
            <label ref={searchControlRef} className="project-rail-search icon-button compact-icon" data-active={query.trim() ? "true" : "false"}>
              <Search size={15} />
              <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
            </label>
          </PathTooltip>
          <div className="project-status-filter">
            <PathTooltip content={`筛选项目：${statusFilterSummary}`} className="project-action-tooltip project-filter-tooltip">
              <button
                ref={filterMenuButtonRef}
                type="button"
                className={`icon-button compact-icon project-status-filter-button ${statusFilters.length > 0 ? "active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                aria-label={`筛选项目：${statusFilterSummary}`}
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
                <Filter size={15} />
              </button>
            </PathTooltip>
            {filterMenuOpen && typeof document !== "undefined"
              ? createPortal(
                <div ref={filterMenuRef} className="floating-menu project-status-filter-menu" role="menu" style={filterMenuPosition} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => handleMenuKeyDown(event, () => { setFilterMenuOpen(false); window.requestAnimationFrame(() => filterMenuButtonRef.current?.focus()); })}>
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
      </div>

      <div className="project-rail-list" tabIndex={0} onKeyDown={handleProjectListKeyDown}>
        <span className="sr-only" id="project-reorder-help">按 Alt 加上下方向键调整项目顺序，按 Shift 加 F10 打开项目菜单。</span>
        <span className="sr-only" aria-live="polite">{reorderAnnouncement}</span>
        {groupedProjects.map((group) => {
          const collapsed = showGroupHeaders && !hasActiveFiltering && collapsedGroupIds.includes(group.id);
          const configuredGroup = groups.find((item) => item.id === group.id);
          const renaming = renameTarget?.kind === "group" && renameTarget.id === group.id;
          return (
            <section className="project-rail-group" key={group.id}>
              {showGroupHeaders && renaming && configuredGroup ? (
                <div className="project-rail-group-header editing">
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <InlineRenameInput
                    ariaLabel={`修改项目分组名称：${configuredGroup.name}`}
                    initialValue={configuredGroup.name}
                    maxLength={40}
                    onCommit={(name) => onRenameGroup(configuredGroup.id, name)}
                    onFinish={() => finishInlineRename({ kind: "group", id: configuredGroup.id })}
                  />
                  <small>{group.projects.length}</small>
                </div>
              ) : showGroupHeaders ? (
                <button
                  ref={(node) => {
                    if (node) {
                      groupHeaderRefs.current.set(group.id, node);
                    } else {
                      groupHeaderRefs.current.delete(group.id);
                    }
                  }}
                  type="button"
                  className="project-rail-group-header"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group.id)}
                  onContextMenu={(event) => {
                    if (configuredGroup) {
                      openGroupContextMenu(event, configuredGroup);
                    }
                  }}
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span>{group.name}</span>
                  <small>{group.projects.length}</small>
                </button>
              ) : null}
              {!collapsed ? <div className="project-rail-group-items">{group.projects.map(renderProjectItem)}</div> : null}
            </section>
          );
        })}
        {filteredProjects.length === 0 ? <div className="empty-inline project-rail-empty">没有匹配项目。</div> : null}
      </div>
      {contextMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={contextMenuRef}
              className="floating-menu project-context-menu"
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onMouseEnter={keepContextMenuOpen}
              onMouseLeave={scheduleContextMenuClose}
              onKeyDown={(event) => handleMenuKeyDown(event, () => closeContextMenu(true))}
            >
              {contextMenu.kind === "group" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    beginInlineRename({ kind: "group", id: contextMenu.group.id });
                  }}
                >
                  <Pencil size={14} />
                  重命名分组
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => beginInlineRename({ kind: "project", id: contextMenu.project.id })}
                  >
                    <Pencil size={14} />
                    重命名项目
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onToggleProjectPinned(contextMenu.project.id);
                      closeContextMenu(true);
                    }}
                  >
                    {contextMenu.project.favorite ? <PinOff size={14} /> : <Pin size={14} />}
                    {contextMenu.project.favorite ? "取消置顶" : "置顶项目"}
                  </button>
                  <div className="menu-separator" role="separator" />
                  <div className="project-context-menu-label">项目分组</div>
                  <div className="project-context-group-options" role="group" aria-label={`设置 ${contextMenu.project.name} 的项目分组`}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={!contextMenu.project.groupId}
                      className={!contextMenu.project.groupId ? "active" : ""}
                      onClick={() => {
                        if (contextMenu.project.groupId) {
                          void onSetProjectGroup(contextMenu.project.id, undefined);
                        }
                        closeContextMenu(true);
                      }}
                    >
                      <span className="project-context-group-check" aria-hidden="true"><Check size={13} /></span>
                      <span>未分组</span>
                    </button>
                    {[...groups].sort((left, right) => left.sortOrder - right.sortOrder).map((group) => {
                      const selected = contextMenu.project.groupId === group.id;
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={selected ? "active" : ""}
                          key={group.id}
                          onClick={() => {
                            if (!selected) {
                              void onSetProjectGroup(contextMenu.project.id, group.id);
                            }
                            closeContextMenu(true);
                          }}
                        >
                          <span className="project-context-group-check" aria-hidden="true"><Check size={13} /></span>
                          <span>{group.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="menu-separator" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      onRemoveProject(contextMenu.project.id);
                      closeContextMenu();
                    }}
                  >
                    <Trash2 size={14} />
                    移除项目记录
                  </button>
                </>
              )}
            </div>,
            document.querySelector(".app-shell") ?? document.body
          )
        : null}
      {footer ? <div className="project-rail-footer">{footer}</div> : null}
    </aside>
  );
}

function InlineRenameInput({
  ariaLabel,
  initialValue,
  maxLength,
  onCommit,
  onFinish
}: {
  ariaLabel: string;
  initialValue: string;
  maxLength: number;
  onCommit: (name: string) => void | Promise<void>;
  onFinish: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const cancelledRef = useRef(false);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit() {
    if (submittingRef.current || cancelledRef.current) {
      return;
    }
    const name = value.trim();
    if (!name) {
      setError("名称不能为空");
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (name === initialValue) {
      onFinish();
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onCommit(name);
      onFinish();
    } catch (reason) {
      submittingRef.current = false;
      setSaving(false);
      setError(reason instanceof Error ? reason.message : "保存失败");
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }

  return (
    <input
      ref={inputRef}
      className="project-inline-rename"
      value={value}
      maxLength={maxLength}
      disabled={saving}
      aria-label={ariaLabel}
      aria-invalid={Boolean(error)}
      title={error || "Enter 保存，Esc 取消"}
      onChange={(event) => {
        setValue(event.target.value);
        setError("");
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onBlur={() => void submit()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onFinish();
        }
      }}
    />
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

function focusFirstMenuItem(menu: HTMLElement | null) {
  menu?.querySelector<HTMLElement>("[role^='menuitem']:not([disabled])")?.focus();
}

function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, onEscape: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }

  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    return;
  }

  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])"));
  if (items.length === 0) {
    return;
  }

  event.preventDefault();
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex].focus();
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
  const remoteScore = fuzzyTextScore(project.remote ? `${project.remote.username ?? ""}@${project.remote.host}` : "", query);
  return Math.max(nameScore, branchScore, pathScore, remoteScore);
}

function projectLocationLabel(project: GitProject): string {
  if (!project.remote) {
    return project.path;
  }
  const destination = project.remote.username ? `${project.remote.username}@${project.remote.host}` : project.remote.host;
  return `${destination}${project.remote.port ? `:${project.remote.port}` : ""}:${project.path}`;
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

type ProjectStatusTone = "conflict" | "dirty" | "sync" | "clean";

function projectStatusTags(project: GitProject): Array<{ label: string; tone: ProjectStatusTone; title?: string }> {
  const status = project.status;
  if (project.remote?.connectionEnabled === false || project.statusError || !status) {
    return [];
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
