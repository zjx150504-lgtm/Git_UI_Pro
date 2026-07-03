import { FolderGit2, FolderPlus, GitBranch, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { GitProject } from "../types/domain";

interface ProjectRailProps {
  projects: GitProject[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
  footer?: ReactNode;
}

export function ProjectRail({ projects, selectedProjectId, onSelectProject, onAddProject, onScanProjects, onRemoveProject, footer }: ProjectRailProps) {
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
          <button type="button" className="icon-button compact-icon" title="扫描目录" onClick={onScanProjects}>
            <Search size={15} />
          </button>
          <button type="button" className="icon-button compact-icon" title="添加本地 Git 项目" onClick={onAddProject}>
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
            title={project.path}
          >
            <span className="project-rail-icon">
              <FolderGit2 size={16} />
            </span>
            <span className="project-rail-main">
              <span className="project-rail-name">
                {project.favorite ? <Star size={12} fill="currentColor" /> : null}
                {project.name}
              </span>
              <span className="project-rail-path">{project.path}</span>
              <span className="project-rail-branch">
                <GitBranch size={12} />
                {project.status?.currentBranch ?? "未知分支"}
                <span className={`project-status ${projectStatusTone(project)}`}>{projectStatusText(project)}</span>
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

function projectStatusText(project: GitProject): string {
  const status = project.status;
  if (!status) {
    return "未加载";
  }

  if (status.hasConflicts) {
    return "有冲突";
  }

  const changedCount = status.stagedCount + status.unstagedCount + status.untrackedCount;
  if (changedCount > 0) {
    return `未提交 ${changedCount} 项`;
  }

  if (status.ahead > 0 || status.behind > 0) {
    return [status.ahead > 0 ? `领先 ${status.ahead}` : "", status.behind > 0 ? `落后 ${status.behind}` : ""].filter(Boolean).join(" / ");
  }

  return "干净";
}

function projectStatusTone(project: GitProject): string {
  const status = project.status;
  if (!status) {
    return "unknown";
  }

  if (status.hasConflicts) {
    return "conflict";
  }

  if (status.stagedCount + status.unstagedCount + status.untrackedCount > 0) {
    return "dirty";
  }

  if (status.ahead > 0 || status.behind > 0) {
    return "sync";
  }

  return "clean";
}
