import { FolderGit2, FolderPlus, FolderSearch, GitBranch, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { PathTooltip } from "./PathTooltip";
import type { GitProject } from "../types/domain";

interface ProjectRailProps {
  projects: GitProject[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
  onSwitchBranch: (project: GitProject) => void;
  footer?: ReactNode;
}

export function ProjectRail({ projects, selectedProjectId, onSelectProject, onAddProject, onScanProjects, onRemoveProject, onSwitchBranch, footer }: ProjectRailProps) {
  const [query, setQuery] = useState("");
  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return projects;
    }

    return projects.filter((project) => `${project.name} ${project.path} ${project.status?.currentBranch ?? ""}`.toLowerCase().includes(keyword));
  }, [projects, query]);

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
            className={`project-rail-item ${project.id === selectedProjectId ? "active" : ""}`}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                onSelectProject(project.id);
              }
            }}
          >
            <span className="project-rail-icon">
              <FolderGit2 size={16} />
            </span>
            <span className="project-rail-main">
              <PathTooltip path={project.path} className="project-rail-name">
                {project.favorite ? <Star size={12} fill="currentColor" /> : null}
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
            <button
              type="button"
              className="remove-project"
              title="移除项目记录"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveProject(project.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {filteredProjects.length === 0 ? <div className="empty-inline project-rail-empty">没有匹配项目。</div> : null}
      </div>
      {footer ? <div className="project-rail-footer">{footer}</div> : null}
    </aside>
  );
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
