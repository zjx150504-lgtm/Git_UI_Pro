import { FolderPlus, GitBranch, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { GitProject } from "../types/domain";

interface ProjectRailProps {
  projects: GitProject[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
}

export function ProjectRail({ projects, selectedProjectId, onSelectProject, onAddProject, onScanProjects, onRemoveProject }: ProjectRailProps) {
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
        <div>
          <strong>项目</strong>
          <span>{projects.length}</span>
        </div>
        <button type="button" className="icon-button compact-icon" title="添加本地 Git 项目" onClick={onAddProject}>
          <FolderPlus size={15} />
        </button>
      </div>

      <button type="button" className="text-button project-scan-row" onClick={onScanProjects}>
        扫描目录
      </button>

      <label className="project-rail-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
      </label>

      <div className="project-rail-list">
        {filteredProjects.map((project) => (
          <button
            type="button"
            className={`project-rail-item ${project.id === selectedProjectId ? "active" : ""}`}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            title={project.path}
          >
            <span className="project-rail-main">
              <span className="project-rail-name">
                {project.favorite ? <Star size={12} fill="currentColor" /> : null}
                {project.name}
              </span>
              <span className="project-rail-branch">
                <GitBranch size={12} />
                {project.status?.currentBranch ?? "未知分支"}
              </span>
            </span>
            <span className="project-rail-side">
              <span className={project.status?.hasConflicts ? "dirty-dot conflict" : "dirty-dot"} />
              <span>{(project.status?.stagedCount ?? 0) + (project.status?.unstagedCount ?? 0) + (project.status?.untrackedCount ?? 0)}</span>
              <span
                role="button"
                tabIndex={0}
                className="remove-project"
                title="移除项目记录"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveProject(project.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    onRemoveProject(project.id);
                  }
                }}
              >
                <Trash2 size={13} />
              </span>
            </span>
          </button>
        ))}
        {filteredProjects.length === 0 ? <div className="empty-inline project-rail-empty">没有匹配项目。</div> : null}
      </div>
    </aside>
  );
}
