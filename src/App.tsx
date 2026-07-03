import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Check, FolderGit2, GitBranch, PanelLeftOpen, Plus, Terminal, X } from "lucide-react";
import { apiClient } from "./api/client";
import { ConsolePanel } from "./components/ConsolePanel";
import { GraphSidebar } from "./components/GraphSidebar";
import { ProjectRail } from "./components/ProjectRail";
import { TopBar, type ThemeMode } from "./components/TopBar";
import { WorktreeDetailPanel, type WorktreeEditorTab } from "./components/WorktreeDetailPanel";
import { WorkspaceView } from "./components/WorkspaceView";
import type {
  BranchInfo,
  ChangedFile,
  CommitInput,
  CommitNode,
  GitOperationResult,
  GitProject,
  WorktreeState
} from "./types/domain";

const emptyWorktree: WorktreeState = {
  stagedFiles: [],
  unstagedFiles: []
};

const DEFAULT_SOURCE_PANE_HEIGHT = 320;

type ResizeTarget = "sidebar" | "detail" | "sourceSplit";
type BranchDialogState =
  | { mode: "create"; project: GitProject; branchName: string; checkout: boolean }
  | { mode: "switch"; project: GitProject; branches: BranchInfo[]; query: string };

export function App() {
  const [projects, setProjects] = useState<GitProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState("");
  const [worktree, setWorktree] = useState<WorktreeState>(emptyWorktree);
  const [worktreeTabs, setWorktreeTabs] = useState<WorktreeEditorTab[]>([]);
  const [activeWorktreeTabId, setActiveWorktreeTabId] = useState<string | null>(null);
  const [gitVersion, setGitVersion] = useState("检测中");
  const [statusMessage, setStatusMessage] = useState("准备就绪");
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(readThemeMode()));
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [detailWidth, setDetailWidth] = useState(360);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [commitFocusRequest, setCommitFocusRequest] = useState(0);
  const [sourcePaneHeight, setSourcePaneHeight] = useState(DEFAULT_SOURCE_PANE_HEIGHT);
  const [changesPanelOpen, setChangesPanelOpen] = useState(true);
  const [graphPanelOpen, setGraphPanelOpen] = useState(true);
  const [branchDialog, setBranchDialog] = useState<BranchDialogState | null>(null);
  const [branchDialogBusy, setBranchDialogBusy] = useState(false);
  const autoRefreshBusyRef = useRef(false);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setResolvedTheme(resolveTheme(themeMode));
    syncTheme();
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [themeMode]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );
  const activeWorktreeTab = useMemo(
    () => worktreeTabs.find((tab) => tab.id === activeWorktreeTabId) ?? worktreeTabs[0],
    [activeWorktreeTabId, worktreeTabs]
  );

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setCommits([]);
    setSelectedCommitHash("");
    void loadProjectData(selectedProject);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    let disposed = false;
    const refresh = async () => {
      if (disposed || autoRefreshBusyRef.current) {
        return;
      }

      autoRefreshBusyRef.current = true;
      try {
        await refreshProjectChanges(selectedProject);
      } finally {
        autoRefreshBusyRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1600);
    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedProject?.id, selectedProject?.path]);

  async function loadInitialData() {
    try {
      const [projectList, versionResult] = await Promise.all([apiClient.getProjects(), apiClient.getGitVersion()]);
      setProjects(projectList);
      setSelectedProjectId(projectList[0]?.id ?? null);
      setGitVersion(formatGitVersion(versionResult));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "初始化失败");
    }
  }

  async function loadProjectData(project: GitProject) {
    try {
      setStatusMessage(`正在加载 ${project.name} 的 Git 状态...`);
      const [status, history, worktreeState] = await Promise.all([
        apiClient.getProjectStatus(project),
        apiClient.getHistory(project),
        apiClient.getWorktree(project)
      ]);

      if (status) {
        setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, status } : item)));
      }

      setCommits(history);
      setWorktree(worktreeState);
      clearWorktreeEditorTabs();
      setSelectedCommitHash("");
      setStatusMessage(history.length > 0 ? `已加载 ${history.length} 条提交。` : "当前仓库还没有提交历史。");
    } catch (error) {
      setCommits([]);
      setWorktree(emptyWorktree);
      clearWorktreeEditorTabs();
      setStatusMessage(error instanceof Error ? error.message : "加载项目失败");
    }
  }

  async function handleSelectCommit(hash: string) {
    if (!hash) {
      setSelectedCommitHash("");
      setStatusMessage("已收起提交。");
      return;
    }

    setSelectedCommitHash(hash);
    const commit = commits.find((item) => item.hash === hash);
    setStatusMessage(commit ? `已选中提交 ${commit.shortHash}` : "已选中提交。");
  }

  async function refreshProjectChanges(project: GitProject) {
    try {
      const [status, worktreeState] = await Promise.all([apiClient.getProjectStatus(project), apiClient.getWorktree(project)]);

      if (status) {
        setProjects((current) =>
          current.map((item) => {
            if (item.id !== project.id) {
              return item;
            }

            return statusSignature(item.status) === statusSignature(status) ? item : { ...item, status };
          })
        );
      }

      setWorktree((current) => (worktreeSignature(current) === worktreeSignature(worktreeState) ? current : worktreeState));
    } catch {
      // Background refresh should not replace the user's current status message.
    }
  }

  async function handleSelectCommitFile(commit: CommitNode, file: ChangedFile) {
    await openCommitFile(commit, file, false);
  }

  async function handlePinCommitFile(commit: CommitNode, file: ChangedFile) {
    await openCommitFile(commit, file, true);
  }

  async function handleSelectWorktreeFile(file: ChangedFile) {
    await openWorktreeFile(file, false);
  }

  async function handlePinWorktreeFile(file: ChangedFile) {
    await openWorktreeFile(file, true);
  }

  async function openWorktreeFile(file: ChangedFile, pinned: boolean) {
    if (!selectedProject) {
      return;
    }

    const tabId = worktreeTabId(file);
    const existingTab = worktreeTabs.find((tab) => tab.id === tabId);
    if (existingTab && pinned) {
      setWorktreeTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, pinned: true } : tab)));
      setActiveWorktreeTabId(tabId);
      return;
    }

    const pendingTab: WorktreeEditorTab = { id: tabId, file, diffLines: [], pinned, sourceType: "worktree" };
    setWorktreeTabs((current) => upsertWorktreeTab(current, pendingTab, pinned));
    setActiveWorktreeTabId(tabId);

    try {
      const diffLines = await apiClient.getWorktreeDiff(selectedProject, file.path, file.staged);
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines, pinned: tab.pinned || pinned } : tab))
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "加载工作区文件失败");
    }
  }

  async function openCommitFile(commit: CommitNode, file: ChangedFile, pinned: boolean) {
    if (!selectedProject) {
      return;
    }

    const tabId = commitFileTabId(commit.hash, file.path);
    const existingTab = worktreeTabs.find((tab) => tab.id === tabId);
    if (existingTab && pinned) {
      setWorktreeTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, pinned: true } : tab)));
      setActiveWorktreeTabId(tabId);
      return;
    }

    const pendingTab: WorktreeEditorTab = {
      id: tabId,
      file,
      diffLines: [],
      pinned,
      sourceType: "commit",
      commitHash: commit.hash,
      sourceLabel: `提交 ${commit.shortHash}`,
      subtitle: commit.subject
    };
    setWorktreeTabs((current) => upsertWorktreeTab(current, pendingTab, pinned));
    setActiveWorktreeTabId(tabId);

    try {
      const diffLines = await apiClient.getCommitDiff(selectedProject, commit.hash, file.path);
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines, pinned: tab.pinned || pinned } : tab))
      );
      setStatusMessage(`正在查看提交 ${commit.shortHash} 的 ${file.path}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "加载提交文件失败");
    }
  }

  function handleSelectWorktreeTab(tabId: string) {
    setActiveWorktreeTabId(tabId);
  }

  function handlePinWorktreeTab(tabId: string) {
    setWorktreeTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, pinned: true } : tab)));
  }

  function handleCloseWorktreeTab(tabId: string) {
    setWorktreeTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === tabId);
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      setActiveWorktreeTabId((currentActiveId) => {
        if (currentActiveId !== tabId) {
          return currentActiveId;
        }

        return nextTabs[Math.min(Math.max(closingIndex, 0), nextTabs.length - 1)]?.id ?? null;
      });
      return nextTabs;
    });
  }

  function clearWorktreeEditorTabs() {
    setWorktreeTabs([]);
    setActiveWorktreeTabId(null);
  }

  async function handleAddProject() {
    try {
      const project = await apiClient.chooseAndAddProject();
      if (!project) {
        return;
      }

      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setSelectedProjectId(project.id);
      setStatusMessage(`已添加项目：${project.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "添加项目失败");
    }
  }

  async function handleScanProjects() {
    try {
      const scannedProjects = await apiClient.chooseAndScanProjects();
      if (scannedProjects.length === 0) {
        setStatusMessage("未发现新的 Git 项目");
        return;
      }

      setProjects((current) => mergeProjects(scannedProjects, current));
      setSelectedProjectId(scannedProjects[0].id);
      setStatusMessage(`已扫描到 ${scannedProjects.length} 个 Git 项目`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "扫描目录失败");
    }
  }

  async function handleRemoveProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const confirmed = window.confirm(`从列表移除“${project.name}”？不会删除本地文件。`);
    if (!confirmed) {
      return;
    }

    await apiClient.removeProject(projectId);
    setProjects((current) => current.filter((item) => item.id !== projectId));
    setSelectedProjectId((current) => (current === projectId ? projects.find((item) => item.id !== projectId)?.id ?? null : current));
    setStatusMessage(`已移除项目记录：${project.name}`);
  }

  async function handleOperation(action: string) {
    if (!selectedProject) {
      setStatusMessage("请先选择一个 Git 项目。");
      return;
    }

    if (action === "fetch" || action === "pull" || action === "push") {
      await runRemoteOperation(action, selectedProject);
      return;
    }

    if (action === "新建分支") {
      await createBranchFromToolbar(selectedProject);
      return;
    }

    if (action === "切换分支") {
      await switchBranchFromToolbar(selectedProject);
      return;
    }

    if (action === "删除分支") {
      await deleteBranchFromToolbar(selectedProject);
      return;
    }

    if (action === "提交") {
      setCommitFocusRequest((value) => value + 1);
      setStatusMessage("请在工作区输入提交信息后提交。");
      return;
    }

    setStatusMessage(`暂不支持操作：${action}`);
  }

  async function runRemoteOperation(action: "fetch" | "pull" | "push", project: GitProject) {
    const label = { fetch: "抓取", pull: "拉取", push: "推送" }[action];
    setStatusMessage(`正在${label}...`);

    const result = await apiClient[action](project);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? `${label}失败，请查看原始 Git 输出。`);
      return;
    }

    setStatusMessage(`${label}完成。`);
    await loadProjectData(project);
  }

  async function createBranchFromToolbar(project: GitProject) {
    setBranchDialog({ mode: "create", project, branchName: "", checkout: true });
  }

  async function submitCreateBranch() {
    if (!branchDialog || branchDialog.mode !== "create") {
      return;
    }

    const branchName = branchDialog.branchName.trim();
    if (!branchName) {
      setStatusMessage("分支名不能为空。");
      return;
    }

    setBranchDialogBusy(true);
    setStatusMessage(`正在创建分支 ${branchName}...`);
    try {
      const result = await apiClient.createBranch(branchDialog.project, branchName, branchDialog.checkout);
      if (!result.ok) {
        setStatusMessage(result.messageZh ?? "创建分支失败，请查看原始 Git 输出。");
        return;
      }

      setBranchDialog(null);
      setStatusMessage(branchDialog.checkout ? `已创建并切换到分支：${branchName}` : `已创建分支：${branchName}`);
      await loadProjectData(branchDialog.project);
    } finally {
      setBranchDialogBusy(false);
    }
  }

  async function switchBranchFromToolbar(project: GitProject) {
    setStatusMessage("正在读取分支列表...");
    const branches = await apiClient.getBranches(project);
    if (branches.length === 0) {
      setStatusMessage("没有可切换的分支。");
      return;
    }

    setBranchDialog({ mode: "switch", project, branches, query: "" });
    setStatusMessage(`已加载 ${branches.length} 个分支。`);
  }

  async function submitSwitchBranch(target: BranchInfo) {
    if (!branchDialog || branchDialog.mode !== "switch") {
      return;
    }

    if (target.current) {
      setStatusMessage(`当前已经在分支：${target.name}`);
      setBranchDialog(null);
      return;
    }

    const project = branchDialog.project;
    if (hasWorktreeChanges(project) && !window.confirm("当前工作区存在未提交改动，切换分支可能失败或影响这些改动。是否继续？")) {
      return;
    }

    setBranchDialogBusy(true);
    setStatusMessage(`正在切换到分支 ${target.name}...`);
    try {
      const result = await apiClient.switchBranch(project, target);
      if (!result.ok) {
        setStatusMessage(result.messageZh ?? "切换分支失败，请查看原始 Git 输出。");
        return;
      }

      setBranchDialog(null);
      setStatusMessage(`已切换到分支：${target.name}`);
      await loadProjectData(project);
    } finally {
      setBranchDialogBusy(false);
    }
  }

  async function deleteBranchFromToolbar(project: GitProject) {
    const branches = (await apiClient.getBranches(project)).filter((branch) => branch.type === "local" && !branch.current);
    const target = chooseBranch(branches, "输入要删除的本地分支序号或名称：");
    if (!target) {
      return;
    }

    if (!window.confirm(`删除本地分支“${target.name}”？不会删除远程分支。`)) {
      return;
    }

    setStatusMessage(`正在删除分支 ${target.name}...`);
    const result = await apiClient.deleteBranch(project, target.name);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? "删除分支失败，请查看原始 Git 输出。");
      return;
    }

    setStatusMessage(`已删除本地分支：${target.name}`);
    await loadProjectData(project);
  }

  async function handleStageFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    const result = await apiClient.stageFile(selectedProject, file.path);
    setStatusMessage(result.ok ? `已暂存：${file.path}` : result.messageZh ?? "暂存失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleStageAll() {
    if (!selectedProject || worktree.unstagedFiles.length === 0) {
      return;
    }

    const result = await apiClient.stageAll(selectedProject);
    setStatusMessage(result.ok ? "已暂存所有更改。" : result.messageZh ?? "暂存所有更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleUnstageFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    const result = await apiClient.unstageFile(selectedProject, file.path);
    setStatusMessage(result.ok ? `已取消暂存：${file.path}` : result.messageZh ?? "取消暂存失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleUnstageAll() {
    if (!selectedProject || worktree.stagedFiles.length === 0) {
      return;
    }

    const result = await apiClient.unstageAll(selectedProject);
    setStatusMessage(result.ok ? "已取消暂存所有更改。" : result.messageZh ?? "取消暂存所有更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleDiscardFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    const confirmed = window.confirm(`放弃“${file.path}”的更改？该操作无法从 Git 恢复未提交内容。`);
    if (!confirmed) {
      return;
    }

    const result = await apiClient.discardFile(selectedProject, file);
    setStatusMessage(result.ok ? `已放弃更改：${file.path}` : result.messageZh ?? "放弃更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleCommit(input: CommitInput): Promise<boolean> {
    if (!selectedProject) {
      setStatusMessage("请先选择一个 Git 项目。");
      return false;
    }

    if (!input.subject.trim() && !input.amend) {
      setStatusMessage("提交标题不能为空。");
      return false;
    }

    if (input.amend && !window.confirm("amend 会修改上一次提交，是否继续？")) {
      return false;
    }

    const shouldAutoStage = worktree.stagedFiles.length === 0 && worktree.unstagedFiles.length > 0;
    const autoStageCount = worktree.unstagedFiles.length;
    if (shouldAutoStage) {
      setStatusMessage(`正在自动暂存 ${autoStageCount} 个未暂存文件并提交。`);
      const stageResult = await apiClient.stageAll(selectedProject);
      if (!stageResult.ok) {
        setStatusMessage(stageResult.messageZh ?? "自动暂存失败，提交已取消。");
        await loadProjectData(selectedProject);
        return false;
      }
    }

    const result = await apiClient.commit(selectedProject, input);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? "提交失败，请展开原始输出查看原因。");
      if (shouldAutoStage) {
        await loadProjectData(selectedProject);
      }
      return false;
    }

    setStatusMessage(
      shouldAutoStage
        ? input.pushAfterCommit
          ? `已自动暂存 ${autoStageCount} 个文件，提交并推送完成。`
          : input.amend
            ? `已自动暂存 ${autoStageCount} 个文件，并修改上次提交。`
            : `已自动暂存 ${autoStageCount} 个文件并提交。`
        : input.pushAfterCommit
          ? "提交并推送完成。"
          : input.amend
            ? "已修改上次提交。"
            : "提交完成。"
    );
    await loadProjectData(selectedProject);
    return true;
  }

  function handleThemeModeChange(mode: ThemeMode) {
    window.localStorage.setItem("git-ui-pro-theme", mode);
    setThemeModeState(mode);
    setResolvedTheme(resolveTheme(mode));
  }

  function beginResize(target: ResizeTarget, event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startDetailWidth = detailWidth;
    const startSourcePaneHeight = sourcePaneHeight;

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      if (target === "sidebar") {
        setSidebarWidth(clamp(startSidebarWidth + moveEvent.clientX - startX, 180, 340));
      }

      if (target === "detail") {
        setDetailWidth(clamp(startDetailWidth + moveEvent.clientX - startX, 300, 520));
      }

      if (target === "sourceSplit") {
        setSourcePaneHeight(clamp(startSourcePaneHeight + moveEvent.clientY - startY, 220, 620));
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const layoutStyle = {
    "--sidebar-width": leftCollapsed ? "52px" : `${sidebarWidth}px`,
    "--detail-width": rightCollapsed ? "0px" : `${detailWidth}px`,
    "--scm-pane-height": `${sourcePaneHeight}px`
  } as CSSProperties;

  return (
    <div
      className={`app-shell theme-${resolvedTheme} ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""} ${
        consoleOpen ? "console-open" : ""
      }`}
      style={layoutStyle}
    >
      {leftCollapsed ? (
        <aside className="collapsed-sidebar">
          <button type="button" className="icon-button" title="展开项目栏" onClick={() => setLeftCollapsed(false)}>
            <PanelLeftOpen size={17} />
          </button>
          <FolderGit2 size={18} />
        </aside>
      ) : (
        <ProjectRail
          projects={projects}
          selectedProjectId={selectedProject?.id ?? null}
          onSelectProject={setSelectedProjectId}
          onAddProject={handleAddProject}
          onScanProjects={handleScanProjects}
          onRemoveProject={handleRemoveProject}
        />
      )}

      {!leftCollapsed ? <div className="resize-handle sidebar-resize" onMouseDown={(event) => beginResize("sidebar", event)} /> : null}

      <main className="workspace-shell">
        <TopBar
          project={selectedProject}
          gitVersion={gitVersion}
          statusMessage={statusMessage}
          themeMode={themeMode}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          consoleOpen={consoleOpen}
          onThemeModeChange={handleThemeModeChange}
          onToggleLeft={() => setLeftCollapsed((value) => !value)}
          onToggleRight={() => setRightCollapsed((value) => !value)}
          onToggleConsole={() => setConsoleOpen((value) => !value)}
        />

        <section className="main-grid">
          <div
            className={`source-control-pane ${changesPanelOpen ? "" : "changes-collapsed"} ${graphPanelOpen ? "" : "graph-collapsed"} ${
              sourcePaneHeight !== DEFAULT_SOURCE_PANE_HEIGHT ? "source-pane-customized" : ""
            }`}
          >
            <WorkspaceView
              project={selectedProject}
              worktree={worktree}
              onRefresh={() => selectedProject && void loadProjectData(selectedProject)}
              onStageFile={handleStageFile}
              onStageAll={handleStageAll}
              onUnstageFile={handleUnstageFile}
              onUnstageAll={handleUnstageAll}
              onDiscardFile={handleDiscardFile}
              onSelectFile={handleSelectWorktreeFile}
              onPinFile={handlePinWorktreeFile}
              selectedFilePath={activeWorktreeTab?.file.path}
              selectedFileStaged={activeWorktreeTab?.file.staged}
              onCommit={handleCommit}
              focusRequest={commitFocusRequest}
              panelOpen={changesPanelOpen}
              onTogglePanel={() => setChangesPanelOpen((value) => !value)}
            />
            <div className="source-graph-divider" onMouseDown={(event) => beginResize("sourceSplit", event)} />
            <GraphSidebar
              project={selectedProject}
              commits={commits}
              selectedHash={selectedCommitHash}
              onSelectCommit={handleSelectCommit}
              onSelectCommitFile={handleSelectCommitFile}
              onPinCommitFile={handlePinCommitFile}
              selectedCommitFileHash={activeWorktreeTab?.sourceType === "commit" ? activeWorktreeTab.commitHash : undefined}
              selectedCommitFilePath={activeWorktreeTab?.sourceType === "commit" ? activeWorktreeTab.file.path : undefined}
              onOperation={handleOperation}
              panelOpen={graphPanelOpen}
              onTogglePanel={() => setGraphPanelOpen((value) => !value)}
            />
          </div>
          {!rightCollapsed ? <div className="resize-handle detail-resize" onMouseDown={(event) => beginResize("detail", event)} /> : null}
          {!rightCollapsed ? (
            <WorktreeDetailPanel
              tabs={worktreeTabs}
              activeTabId={activeWorktreeTabId}
              repositoryPath={selectedProject?.path}
              onSelectTab={handleSelectWorktreeTab}
              onCloseTab={handleCloseWorktreeTab}
              onPinTab={handlePinWorktreeTab}
            />
          ) : null}
        </section>

        {!consoleOpen ? (
          <button type="button" className="console-launcher" onClick={() => setConsoleOpen(true)}>
            <Terminal size={16} />
            控制台
          </button>
        ) : null}
        {consoleOpen ? <ConsolePanel project={selectedProject} onClose={() => setConsoleOpen(false)} /> : null}
        {branchDialog ? (
          <BranchDialog
            state={branchDialog}
            busy={branchDialogBusy}
            onClose={() => setBranchDialog(null)}
            onCreateNameChange={(branchName) =>
              setBranchDialog((current) => (current?.mode === "create" ? { ...current, branchName } : current))
            }
            onCheckoutChange={(checkout) => setBranchDialog((current) => (current?.mode === "create" ? { ...current, checkout } : current))}
            onSwitchQueryChange={(query) => setBranchDialog((current) => (current?.mode === "switch" ? { ...current, query } : current))}
            onCreate={submitCreateBranch}
            onSwitch={submitSwitchBranch}
          />
        ) : null}
      </main>
    </div>
  );
}

function BranchDialog({
  state,
  busy,
  onClose,
  onCreateNameChange,
  onCheckoutChange,
  onSwitchQueryChange,
  onCreate,
  onSwitch
}: {
  state: BranchDialogState;
  busy: boolean;
  onClose: () => void;
  onCreateNameChange: (value: string) => void;
  onCheckoutChange: (value: boolean) => void;
  onSwitchQueryChange: (value: string) => void;
  onCreate: () => void;
  onSwitch: (branch: BranchInfo) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const filteredBranches =
    state.mode === "switch"
      ? state.branches.filter((branch) => `${branch.name} ${branch.fullName}`.toLowerCase().includes(state.query.trim().toLowerCase()))
      : [];

  return (
    <div className="branch-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="branch-dialog" role="dialog" aria-modal="true" aria-label={state.mode === "create" ? "新建分支" : "切换分支"} onMouseDown={(event) => event.stopPropagation()}>
        <header className="branch-dialog-header">
          <span className="branch-dialog-title">
            {state.mode === "create" ? <Plus size={15} /> : <GitBranch size={15} />}
            {state.mode === "create" ? "新建分支" : "切换分支"}
          </span>
          <button type="button" className="icon-button compact-icon" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        {state.mode === "create" ? (
          <form
            className="branch-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <label>
              <span>分支名</span>
              <input value={state.branchName} autoFocus onChange={(event) => onCreateNameChange(event.target.value)} placeholder="feature/new-branch" disabled={busy} />
            </label>
            <label className="branch-checkbox-row">
              <input type="checkbox" checked={state.checkout} onChange={(event) => onCheckoutChange(event.target.checked)} disabled={busy} />
              创建后切换到该分支
            </label>
            <div className="branch-dialog-actions">
              <button type="button" className="text-button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button type="submit" className="primary-action branch-primary-action" disabled={busy || !state.branchName.trim()}>
                <Check size={14} />
                创建
              </button>
            </div>
          </form>
        ) : (
          <div className="branch-switch-panel">
            <label className="branch-search">
              <GitBranch size={14} />
              <input value={state.query} autoFocus onChange={(event) => onSwitchQueryChange(event.target.value)} placeholder="搜索分支" disabled={busy} />
            </label>
            <div className="branch-list" role="list">
              {filteredBranches.map((branch) => (
                <button type="button" className={`branch-list-item ${branch.current ? "current" : ""}`} key={`${branch.type}-${branch.fullName}`} onClick={() => onSwitch(branch)} disabled={busy}>
                  <span>
                    <GitBranch size={13} />
                    {branch.name}
                  </span>
                  <small>{branch.current ? "当前" : branch.type === "remote" ? "远程" : branch.upstream ? `跟踪 ${branch.upstream}` : "本地"}</small>
                </button>
              ))}
              {filteredBranches.length === 0 ? <div className="empty-inline branch-empty">没有匹配分支。</div> : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatGitVersion(result: GitOperationResult): string {
  if (!result.ok) {
    return "Git 未就绪";
  }

  return result.stdout.trim() || "Git 已就绪";
}

function mergeProjects(incoming: GitProject[], current: GitProject[]): GitProject[] {
  const map = new Map<string, GitProject>();

  for (const project of [...incoming, ...current]) {
    map.set(project.path.toLowerCase(), project);
  }

  return Array.from(map.values());
}

function chooseBranch(branches: BranchInfo[], promptTitle: string): BranchInfo | undefined {
  if (branches.length === 0) {
    window.alert("没有可选择的分支。");
    return undefined;
  }

  const options = branches
    .map((branch, index) => `${index + 1}. ${branch.name} ${branch.current ? "(当前)" : ""} ${branch.type === "remote" ? "[远程]" : "[本地]"}`)
    .join("\n");
  const input = window.prompt(`${promptTitle}\n\n${options}`);
  if (!input?.trim()) {
    return undefined;
  }

  const trimmed = input.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= branches.length) {
    return branches[index - 1];
  }

  const matchedBranch = branches.find((branch) => branch.name === trimmed || branch.fullName === trimmed);
  if (!matchedBranch) {
    window.alert("没有找到这个分支，请检查输入的序号或名称。");
  }

  return matchedBranch;
}

function hasWorktreeChanges(project: GitProject): boolean {
  const status = project.status;
  if (!status) {
    return false;
  }

  return status.stagedCount + status.unstagedCount + status.untrackedCount > 0 || status.hasConflicts;
}

function worktreeTabId(file: ChangedFile): string {
  return `${file.staged ? "staged" : "unstaged"}:${file.path}`;
}

function commitFileTabId(hash: string, filePath: string): string {
  return `commit:${hash}:${filePath}`;
}

function worktreeSignature(state: WorktreeState): string {
  return [state.stagedFiles, state.unstagedFiles]
    .map((files) =>
      files
        .map((file) => `${file.staged ? "1" : "0"}:${file.status}:${file.path}:${file.oldPath ?? ""}`)
        .sort()
        .join("|")
    )
    .join("::");
}

function statusSignature(status: GitProject["status"]): string {
  if (!status) {
    return "";
  }

  return [
    status.currentBranch ?? "",
    status.upstream ?? "",
    status.ahead,
    status.behind,
    status.stagedCount,
    status.unstagedCount,
    status.untrackedCount,
    status.hasConflicts ? "1" : "0",
    status.operationState ?? ""
  ].join(":");
}

function upsertWorktreeTab(tabs: WorktreeEditorTab[], incomingTab: WorktreeEditorTab, forcePinned: boolean): WorktreeEditorTab[] {
  const existingIndex = tabs.findIndex((tab) => tab.id === incomingTab.id);
  const nextTab = existingIndex >= 0 ? { ...incomingTab, pinned: tabs[existingIndex].pinned || forcePinned } : incomingTab;

  if (existingIndex >= 0) {
    return tabs.map((tab, index) => (index === existingIndex ? nextTab : tab));
  }

  if (!forcePinned) {
    const previewIndex = tabs.findIndex((tab) => !tab.pinned);
    if (previewIndex >= 0) {
      return tabs.map((tab, index) => (index === previewIndex ? nextTab : tab));
    }
  }

  return [...tabs, nextTab];
}

function readThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem("git-ui-pro-theme");
  return saved === "dark" ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") {
    return mode;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
