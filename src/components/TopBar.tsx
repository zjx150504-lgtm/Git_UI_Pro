import { Moon, PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sun } from "lucide-react";
import type { GitProject } from "../types/domain";

export type ThemeMode = "system" | "light" | "dark";

interface TopBarProps {
  project?: GitProject;
  gitVersion: string;
  themeMode: ThemeMode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  consoleOpen: boolean;
  onThemeModeChange: (mode: ThemeMode) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleConsole: () => void;
}

export function TopBar({
  project,
  gitVersion,
  themeMode,
  leftCollapsed,
  rightCollapsed,
  consoleOpen,
  onThemeModeChange,
  onToggleLeft,
  onToggleRight,
  onToggleConsole
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="project-heading">
        <div className="project-title-row">
          <strong>{project?.name ?? "未选择项目"}</strong>
          {project?.status?.currentBranch ? <span className="project-branch-dot">{project.status.currentBranch}</span> : null}
        </div>
        <div className="project-subline">
          <span>{project?.path ?? "请先添加一个本地 Git 仓库"}</span>
          <span>{gitVersion}</span>
        </div>
      </div>

      <div className="layout-controls" aria-label="布局控制">
        <button type="button" className="icon-button" title={leftCollapsed ? "展开项目栏" : "收起项目栏"} onClick={onToggleLeft}>
          {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button type="button" className="icon-button" title={rightCollapsed ? "展开详情栏" : "收起详情栏"} onClick={onToggleRight}>
          {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
        <button type="button" className="icon-button" title={consoleOpen ? "关闭控制台" : "打开控制台"} onClick={onToggleConsole}>
          {consoleOpen ? <PanelBottomClose size={16} /> : <PanelBottomOpen size={16} />}
        </button>
        <button
          type="button"
          className="icon-button"
          title={themeMode === "dark" ? "切换浅色主题" : "切换深色主题"}
          onClick={() => onThemeModeChange(themeMode === "dark" ? "light" : "dark")}
        >
          {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
