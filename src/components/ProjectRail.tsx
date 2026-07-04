import { FolderGit2, FolderPlus, FolderSearch, GitBranch, Pin, PinOff, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
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

const PROJECT_CONTEXT_MENU_WIDTH = 168;
const PROJECT_CONTEXT_MENU_HEIGHT = 76;

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
  const keyword = query.trim();
  const filteredProjects = useMemo(() => {
    if (!keyword) {
      return projects;
    }

    return projects
      .map((project, index) => ({ project, index, score: fuzzyProjectScore(project, keyword) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.project.favorite) - Number(a.project.favorite) || a.index - b.index)
      .map((item) => item.project);
  }, [projects, keyword]);
  const canReorder = keyword.length === 0;
  const visibleProjectIds = filteredProjects.map((project) => project.id);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    document.addEventListener("pointerdown", closeContextMenu);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      document.removeEventListener("pointerdown", closeContextMenu);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [contextMenu]);

  function openProjectContextMenu(event: MouseEvent<HTMLDivElement>, project: GitProject) {
    event.preventDefault();
    event.stopPropagation();
    onSelectProject(project.id);
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

      <label className="project-rail-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
      </label>

      <div className="project-rail-list">
        {filteredProjects.map((project) => (
          <div
            role="button"
            tabIndex={0}
            draggable={canReorder}
            aria-grabbed={draggedProjectId === project.id}
            className={`project-rail-item ${project.id === selectedProjectId ? "active" : ""} ${project.favorite ? "pinned" : ""} ${
              draggedProjectId === project.id ? "dragging" : ""
            } ${dragOverProjectId === project.id ? `drag-over drag-over-${dragOverPlacement}` : ""}`}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
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
                {project.favorite ? (
                  <span className="project-rail-pin-indicator" title="已置顶">
                    <Pin size={12} />
                  </span>
                ) : null}
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
