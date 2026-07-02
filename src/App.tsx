import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { FolderGit2, PanelLeftOpen, Terminal } from "lucide-react";
import { apiClient } from "./api/client";
import { ConsolePanel } from "./components/ConsolePanel";
import { DetailPanel } from "./components/DetailPanel";
import { GraphView } from "./components/GraphView";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { TopBar, type ThemeMode } from "./components/TopBar";
import { WorktreeDetailPanel } from "./components/WorktreeDetailPanel";
import { WorkspaceView } from "./components/WorkspaceView";
import type {
  BranchInfo,
  ChangedFile,
  CommitInput,
  CommitNode,
  DiffLine,
  GitOperationResult,
  GitProject,
  MainView,
  WorktreeState
} from "./types/domain";

const emptyWorktree: WorktreeState = {
  stagedFiles: [],
  unstagedFiles: []
};

type ResizeTarget = "sidebar" | "detail";

export function App() {
  const [projects, setProjects] = useState<GitProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState("");
  const [commitDetails, setCommitDetails] = useState<CommitNode | undefined>();
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [worktree, setWorktree] = useState<WorktreeState>(emptyWorktree);
  const [selectedWorktreeFile, setSelectedWorktreeFile] = useState<ChangedFile | undefined>();
  const [worktreeDiffLines, setWorktreeDiffLines] = useState<DiffLine[]>([]);
  const [mainView, setMainView] = useState<MainView>("history");
  const [query, setQuery] = useState("");
  const [gitVersion, setGitVersion] = useState("检测中");
  const [statusMessage, setStatusMessage] = useState("准备就绪");
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(readThemeMode()));
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(420);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [commitFocusRequest, setCommitFocusRequest] = useState(0);

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

  const selectedCommit = useMemo(
    () => commitDetails ?? commits.find((commit) => commit.hash === selectedCommitHash),
    [commitDetails, commits, selectedCommitHash]
  );

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setCommits([]);
    setSelectedCommitHash("");
    setCommitDetails(undefined);
    setSelectedFilePath(undefined);
    setDiffLines([]);
    void loadProjectData(selectedProject);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject || !selectedCommitHash) {
      setCommitDetails(undefined);
      setSelectedFilePath(undefined);
      setDiffLines([]);
      return;
    }

    if (!commits.some((commit) => commit.hash === selectedCommitHash)) {
      setCommitDetails(undefined);
      setSelectedFilePath(undefined);
      setDiffLines([]);
      return;
    }

    void loadCommitDetails(selectedProject, selectedCommitHash);
  }, [selectedProject?.id, selectedCommitHash, commits]);

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
      setCommitDetails(undefined);
      setSelectedFilePath(undefined);
      setDiffLines([]);
      setSelectedWorktreeFile(undefined);
      setWorktreeDiffLines([]);
      setSelectedCommitHash(history[0]?.hash ?? "");
      setStatusMessage(history.length > 0 ? `已加载 ${history.length} 条提交。` : "当前仓库还没有提交历史。");
    } catch (error) {
      setCommits([]);
      setWorktree(emptyWorktree);
      setStatusMessage(error instanceof Error ? error.message : "加载项目失败");
    }
  }

  async function loadCommitDetails(project: GitProject, hash: string) {
    try {
      const details = await apiClient.getCommitDetails(project, hash);
      const firstFilePath = details.files[0]?.path;
      const diff = firstFilePath ? await apiClient.getCommitDiff(project, hash, firstFilePath) : [];
      setCommitDetails(details);
      setSelectedFilePath(firstFilePath);
      setDiffLines(diff);
    } catch (error) {
      setCommitDetails(commits.find((commit) => commit.hash === hash));
      setSelectedFilePath(undefined);
      setDiffLines([]);
      setStatusMessage(error instanceof Error ? error.message : "加载提交详情失败");
    }
  }

  async function handleSelectCommit(hash: string) {
    setCommitDetails(undefined);
    setSelectedCommitHash(hash);
  }

  async function handleSelectFile(file: ChangedFile) {
    if (!selectedProject || !selectedCommitHash) {
      return;
    }

    try {
      setSelectedFilePath(file.path);
      setDiffLines(await apiClient.getCommitDiff(selectedProject, selectedCommitHash, file.path));
    } catch (error) {
      setDiffLines([]);
      setStatusMessage(error instanceof Error ? error.message : "加载文件 diff 失败");
    }
  }

  async function handleSelectWorktreeFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    try {
      setSelectedWorktreeFile(file);
      setWorktreeDiffLines(await apiClient.getWorktreeDiff(selectedProject, file.path, file.staged));
    } catch (error) {
      setWorktreeDiffLines([]);
      setStatusMessage(error instanceof Error ? error.message : "加载工作区文件失败");
    }
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
      setMainView("workspace");
      setCommitFocusRequest((value) => value + 1);
      setStatusMessage("已打开工作区，请输入提交信息后提交。");
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
    const branchName = window.prompt("输入新分支名：");
    if (!branchName?.trim()) {
      return;
    }

    const checkout = window.confirm("创建后立即切换到这个分支吗？");
    setStatusMessage(`正在创建分支 ${branchName.trim()}...`);

    const result = await apiClient.createBranch(project, branchName.trim(), checkout);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? "创建分支失败，请查看原始 Git 输出。");
      return;
    }

    setStatusMessage(checkout ? `已创建并切换到分支：${branchName.trim()}` : `已创建分支：${branchName.trim()}`);
    await loadProjectData(project);
  }

  async function switchBranchFromToolbar(project: GitProject) {
    const branches = await apiClient.getBranches(project);
    const target = chooseBranch(branches, "输入要切换的分支序号或名称：");
    if (!target) {
      return;
    }

    if (target.current) {
      setStatusMessage(`当前已经在分支：${target.name}`);
      return;
    }

    if (hasWorktreeChanges(project) && !window.confirm("当前工作区存在未提交改动，切换分支可能失败或影响这些改动。是否继续？")) {
      return;
    }

    setStatusMessage(`正在切换到分支 ${target.name}...`);
    const result = await apiClient.switchBranch(project, target);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? "切换分支失败，请查看原始 Git 输出。");
      return;
    }

    setStatusMessage(`已切换到分支：${target.name}`);
    await loadProjectData(project);
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
    setSelectedWorktreeFile(undefined);
    setWorktreeDiffLines([]);
    await loadProjectData(selectedProject);
  }

  async function handleStageAll() {
    if (!selectedProject || worktree.unstagedFiles.length === 0) {
      return;
    }

    const result = await apiClient.stageAll(selectedProject);
    setStatusMessage(result.ok ? "已暂存所有更改。" : result.messageZh ?? "暂存所有更改失败");
    setSelectedWorktreeFile(undefined);
    setWorktreeDiffLines([]);
    await loadProjectData(selectedProject);
  }

  async function handleUnstageFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    const result = await apiClient.unstageFile(selectedProject, file.path);
    setStatusMessage(result.ok ? `已取消暂存：${file.path}` : result.messageZh ?? "取消暂存失败");
    setSelectedWorktreeFile(undefined);
    setWorktreeDiffLines([]);
    await loadProjectData(selectedProject);
  }

  async function handleUnstageAll() {
    if (!selectedProject || worktree.stagedFiles.length === 0) {
      return;
    }

    const result = await apiClient.unstageAll(selectedProject);
    setStatusMessage(result.ok ? "已取消暂存所有更改。" : result.messageZh ?? "取消暂存所有更改失败");
    setSelectedWorktreeFile(undefined);
    setWorktreeDiffLines([]);
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
    setSelectedWorktreeFile(undefined);
    setWorktreeDiffLines([]);
    await loadProjectData(selectedProject);
  }

  async function handleCommit(input: CommitInput) {
    if (!selectedProject) {
      setStatusMessage("请先选择一个 Git 项目。");
      return;
    }

    if (!input.subject.trim() && !input.amend) {
      setStatusMessage("提交标题不能为空。");
      return;
    }

    if (input.amend && !window.confirm("amend 会修改上一次提交，是否继续？")) {
      return;
    }

    const result = await apiClient.commit(selectedProject, input);
    if (!result.ok) {
      setStatusMessage(result.messageZh ?? "提交失败，请展开原始输出查看原因。");
      return;
    }

    setStatusMessage(input.pushAfterCommit ? "提交并推送完成。" : input.amend ? "已修改上次提交。" : "提交完成。");
    await loadProjectData(selectedProject);
  }

  function handleThemeModeChange(mode: ThemeMode) {
    window.localStorage.setItem("git-ui-pro-theme", mode);
    setThemeModeState(mode);
    setResolvedTheme(resolveTheme(mode));
  }

  function beginResize(target: ResizeTarget, event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startDetailWidth = detailWidth;

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      if (target === "sidebar") {
        setSidebarWidth(clamp(startSidebarWidth + moveEvent.clientX - startX, 220, 440));
      }

      if (target === "detail") {
        setDetailWidth(clamp(startDetailWidth + startX - moveEvent.clientX, 300, 680));
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
    "--detail-width": rightCollapsed ? "0px" : `${detailWidth}px`
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
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProject?.id ?? null}
          query={query}
          onQueryChange={setQuery}
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
          view={mainView}
          gitVersion={gitVersion}
          statusMessage={statusMessage}
          themeMode={themeMode}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          consoleOpen={consoleOpen}
          onChangeView={setMainView}
          onThemeModeChange={handleThemeModeChange}
          onToggleLeft={() => setLeftCollapsed((value) => !value)}
          onToggleRight={() => setRightCollapsed((value) => !value)}
          onToggleConsole={() => setConsoleOpen((value) => !value)}
          onOperation={handleOperation}
        />

        <section className="main-grid">
          <div className="center-pane">
            {mainView === "history" ? (
              <GraphView commits={commits} selectedHash={selectedCommitHash} onSelectCommit={handleSelectCommit} />
            ) : (
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
                selectedFilePath={selectedWorktreeFile?.path}
                selectedFileStaged={selectedWorktreeFile?.staged}
                onCommit={handleCommit}
                focusRequest={commitFocusRequest}
              />
            )}
          </div>
          {!rightCollapsed ? <div className="resize-handle detail-resize" onMouseDown={(event) => beginResize("detail", event)} /> : null}
          {!rightCollapsed && mainView === "workspace" ? (
            <WorktreeDetailPanel file={selectedWorktreeFile} diffLines={worktreeDiffLines} />
          ) : null}
          {!rightCollapsed && mainView === "history" ? (
            <DetailPanel commit={selectedCommit} diffLines={diffLines} selectedFilePath={selectedFilePath} onSelectFile={handleSelectFile} />
          ) : null}
        </section>

        {!consoleOpen ? (
          <button type="button" className="console-launcher" onClick={() => setConsoleOpen(true)}>
            <Terminal size={16} />
            控制台
          </button>
        ) : null}
        {consoleOpen ? <ConsolePanel project={selectedProject} onClose={() => setConsoleOpen(false)} /> : null}
      </main>
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
