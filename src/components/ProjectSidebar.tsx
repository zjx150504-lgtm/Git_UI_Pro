import { FolderPlus, GitBranch, Search, Star, Trash2 } from "lucide-react";
import { PathTooltip } from "./PathTooltip";
import type { GitProject } from "../types/domain";

interface ProjectSidebarProps {
  projects: GitProject[];
  selectedProjectId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onScanProjects: () => void;
  onRemoveProject: (projectId: string) => void;
}

const groupLabels: Record<string, string> = {
  work: "工作项目",
  personal: "个人项目",
  client: "客户项目",
  ungrouped: "未分组"
};

export function ProjectSidebar({
  projects,
  selectedProjectId,
  query,
  onQueryChange,
  onSelectProject,
  onAddProject,
  onScanProjects,
  onRemoveProject
}: ProjectSidebarProps) {
  const filteredProjects = projects.filter((project) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return `${project.name} ${project.path} ${project.status?.currentBranch ?? ""}`.toLowerCase().includes(keyword);
  });

  const groupedProjects = filteredProjects.reduce<Record<string, GitProject[]>>((groups, project) => {
    const groupId = project.groupId ?? "ungrouped";
    groups[groupId] = groups[groupId] ?? [];
    groups[groupId].push(project);
    return groups;
  }, {});

  return (
    <aside className="project-sidebar">
      <div className="brand-block">
        <div className="brand-mark">G</div>
        <div>
          <h1>Git UI Pro</h1>
          <p>中文 Git Graph</p>
        </div>
      </div>

      <div className="project-actions">
        <button type="button" className="icon-button" title="添加本地 Git 项目" onClick={onAddProject}>
          <FolderPlus size={18} />
        </button>
        <button type="button" className="text-button" onClick={onScanProjects}>
          扫描目录
        </button>
      </div>

      <label className="search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索项目、路径、分支" />
      </label>

      <div className="project-list">
        {Object.entries(groupedProjects).map(([groupId, groupProjects]) => (
          <section className="project-group" key={groupId}>
            <div className="group-title">{groupLabels[groupId] ?? groupId}</div>
            {groupProjects.map((project) => (
              <button
                type="button"
                className={`project-item ${project.id === selectedProjectId ? "active" : ""}`}
                key={project.id}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-item-main">
                  <span className="project-name-row">
                    <PathTooltip path={project.path} className="project-name">
                      {project.name}
                    </PathTooltip>
                    {project.favorite ? <Star size={14} className="favorite-icon" fill="currentColor" /> : null}
                  </span>
                  <span className="project-meta-row">
                    <span className="branch-chip">
                      <GitBranch size={13} />
                      {project.status?.currentBranch ?? "未知分支"}
                    </span>
                    {project.status ? <SyncBadge ahead={project.status.ahead} behind={project.status.behind} /> : null}
                  </span>
                </span>
                <span className="project-side">
                  <span className={project.status?.hasConflicts ? "dirty-dot conflict" : "dirty-dot"} />
                  <span className="change-count">
                    {(project.status?.stagedCount ?? 0) + (project.status?.unstagedCount ?? 0) + (project.status?.untrackedCount ?? 0)}
                  </span>
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
                    <Trash2 size={14} />
                  </span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function SyncBadge({ ahead, behind }: { ahead: number; behind: number }) {
  if (ahead === 0 && behind === 0) {
    return <span className="sync-badge clean">已同步</span>;
  }

  return (
    <span className="sync-badge">
      ↑{ahead} ↓{behind}
    </span>
  );
}

