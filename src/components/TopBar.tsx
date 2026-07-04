import { GitBranch } from "lucide-react";
import { PathTooltip } from "./PathTooltip";
import type { GitProject } from "../types/domain";

export type ThemeMode = "system" | "light" | "dark";

interface TopBarProps {
  project?: GitProject;
  gitVersion: string;
}

export function TopBar({
  project,
  gitVersion
}: TopBarProps) {
  const gitVersionLabel = gitVersion.replace(/^git version\s*/i, "").trim() || gitVersion;

  return (
    <header className="top-bar">
      <div className="project-heading">
        <div className="project-title-row">
          <strong>{project?.name ?? "未选择项目"}</strong>
          {project?.status?.currentBranch ? <span className="project-branch-dot">{project.status.currentBranch}</span> : null}
        </div>
      </div>

      <div className="layout-controls" aria-label="布局控制">
        <PathTooltip content={gitVersion} className="git-version-tooltip">
          <span className="git-version-badge" aria-label={gitVersion}>
            <GitBranch size={13} />
            <span>{gitVersionLabel}</span>
          </span>
        </PathTooltip>
      </div>
    </header>
  );
}
