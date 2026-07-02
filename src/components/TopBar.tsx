import {
  CloudDownload,
  CloudUpload,
  GitBranch,
  GitCommitHorizontal,
  Moon,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
} from "lucide-react";
import type { GitProject, MainView } from "../types/domain";

export type ThemeMode = "system" | "light" | "dark";

interface TopBarProps {
  project?: GitProject;
  view: MainView;
  gitVersion: string;
  statusMessage: string;
  themeMode: ThemeMode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  consoleOpen: boolean;
  onChangeView: (view: MainView) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleConsole: () => void;
  onOperation: (operation: string) => void;
}

const operations = [
  { label: "fetch", text: "抓取", title: "fetch 抓取远程更新", icon: RefreshCw },
  { label: "pull", text: "拉取", title: "pull 拉取当前分支", icon: CloudDownload },
  { label: "push", text: "推送", title: "push 推送当前分支", icon: CloudUpload },
  { label: "新建分支", title: "从当前 HEAD 新建分支", icon: Plus },
  { label: "切换分支", title: "切换到其他本地或远程分支", icon: GitBranch },
  { label: "删除分支", title: "删除本地分支", icon: Trash2 },
  { label: "提交", title: "提交已暂存改动", icon: GitCommitHorizontal }
];

export function TopBar({
  project,
  view,
  gitVersion,
  statusMessage,
  themeMode,
  leftCollapsed,
  rightCollapsed,
  consoleOpen,
  onChangeView,
  onThemeModeChange,
  onToggleLeft,
  onToggleRight,
  onToggleConsole,
  onOperation
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
          <span>{statusMessage}</span>
        </div>
      </div>

      <div className="view-switch" role="tablist" aria-label="主视图">
        <button type="button" className={view === "history" ? "active" : ""} onClick={() => onChangeView("history")}>
          历史图
        </button>
        <button type="button" className={view === "workspace" ? "active" : ""} onClick={() => onChangeView("workspace")}>
          工作区
        </button>
      </div>

      <div className="operation-strip">
        {operations.map((operation) => {
          const Icon = operation.icon;
          return (
            <button type="button" className="toolbar-button icon-only" title={operation.title} key={operation.label} onClick={() => onOperation(operation.label)}>
              <Icon size={16} />
            </button>
          );
        })}
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
