import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitMerge,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Sun,
  Terminal,
  X
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { apiClient } from "./api/client";
import { AppChrome } from "./components/AppChrome";
import { ConsolePanel } from "./components/ConsolePanel";
import { FeedbackConfirmDialog, type FeedbackConfirmOptions } from "./components/FeedbackConfirmDialog";
import { GraphSidebar } from "./components/GraphSidebar";
import { PathTooltip } from "./components/PathTooltip";
import { ProjectRail } from "./components/ProjectRail";
import { RemoteProjectDialog } from "./components/RemoteProjectDialog";
import { TopBar, type ThemeMode } from "./components/TopBar";
import { WorktreeDetailPanel, type WorktreeEditorTab } from "./components/WorktreeDetailPanel";
import { WorkspaceView } from "./components/WorkspaceView";
import type {
  BranchInfo,
  ChangedFile,
  CommitGraphAction,
  CommitInput,
  CommitMessageInput,
  CommitNode,
  ConflictResolutionInput,
  GitHistoryFilter,
  GitHistoryRef,
  GitMergePreview,
  GitMergeStrategy,
  GitOperationResult,
  GitProject,
  GitResetMode,
  RemoteProjectInput,
  RemoteProjectTestResult,
  WorktreeState
} from "./types/domain";

const emptyWorktree: WorktreeState = {
  stagedFiles: [],
  unstagedFiles: []
};

const defaultGraphHistoryFilter = (): GitHistoryFilter => ({ mode: "auto" });

const DEFAULT_SOURCE_PANE_HEIGHT = 320;
const DEFAULT_CONSOLE_HEIGHT = 240;
const MIN_CONSOLE_HEIGHT = 80;
const CONSOLE_TOP_SNAP_DISTANCE = 36;
const SELECTED_PROJECT_REFRESH_INTERVAL_MS = 4000;
const PROJECT_LIST_STATUS_REFRESH_INTERVAL_MS = 20000;
const PROJECT_LIST_STATUS_BATCH_SIZE = 3;
const PROJECT_SELECTION_LOAD_DELAY_MS = 180;
const PROJECT_DATA_CACHE_TTL_MS = 20_000;
const GRAPH_HISTORY_CACHE_TTL_MS = 20_000;
const RESET_OPERATION_TIMEOUT_MS = 45_000;
const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

type ResizeTarget = "sidebar" | "detail" | "sourceSplit" | "console";
type ToastId = string | number;
type ProjectStatusRefresh = { projectId: string; status: GitProject["status"] };
type ProjectDataSnapshot = {
  status: GitProject["status"];
  history: CommitNode[];
  historyRefs: GitHistoryRef[];
  worktree: WorktreeState;
  loadedAt: number;
};
type GraphHistorySnapshot = {
  history: CommitNode[];
  historyRefs: GitHistoryRef[];
  loadedAt: number;
};
type GitDependencyState =
  | { status: "checking" }
  | { status: "ready"; version: string }
  | { status: "missing"; message: string; details?: string };
type BranchDialogState =
  | { mode: "create"; project: GitProject; branchName: string; checkout: boolean; startPoint?: string; startLabel?: string }
  | { mode: "switch"; project: GitProject; branches: BranchInfo[]; query: string }
  | {
      mode: "merge";
      project: GitProject;
      branches: BranchInfo[];
      query: string;
      strategy: GitMergeStrategy;
      preview?: GitMergePreview;
    };
type CommitMessageDialogState = {
  project: GitProject;
  commit: CommitNode;
  subject: string;
  body: string;
};
type CommitMessageDraftRequest = {
  id: number;
  value: string;
};

export function App() {
  const [projects, setProjects] = useState<GitProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphHistoryFilter, setGraphHistoryFilter] = useState<GitHistoryFilter>(() => defaultGraphHistoryFilter());
  const [graphHistoryRefs, setGraphHistoryRefs] = useState<GitHistoryRef[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState("");
  const [worktree, setWorktree] = useState<WorktreeState>(emptyWorktree);
  const [worktreeTabs, setWorktreeTabs] = useState<WorktreeEditorTab[]>([]);
  const [activeWorktreeTabId, setActiveWorktreeTabId] = useState<string | null>(null);
  const [gitVersion, setGitVersion] = useState("检测中");
  const [gitDependency, setGitDependency] = useState<GitDependencyState>({ status: "checking" });
  const [statusMessage, setStatusMessage] = useState("准备就绪");
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(readThemeMode()));
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [detailWidth, setDetailWidth] = useState(360);
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth <= 700);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  const [consoleMaximized, setConsoleMaximized] = useState(false);
  const [commitFocusRequest, setCommitFocusRequest] = useState(0);
  const [commitMessageDraftRequest, setCommitMessageDraftRequest] = useState<CommitMessageDraftRequest | undefined>();
  const [sourcePaneHeight, setSourcePaneHeight] = useState(DEFAULT_SOURCE_PANE_HEIGHT);
  const [changesPanelOpen, setChangesPanelOpen] = useState(true);
  const [graphPanelOpen, setGraphPanelOpen] = useState(true);
  const [branchDialog, setBranchDialog] = useState<BranchDialogState | null>(null);
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  const [branchDialogBusy, setBranchDialogBusy] = useState(false);
  const [mergeOperationBusy, setMergeOperationBusy] = useState(false);
  const [commitMessageDialog, setCommitMessageDialog] = useState<CommitMessageDialogState | null>(null);
  const [commitMessageDialogBusy, setCommitMessageDialogBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<FeedbackConfirmOptions | null>(null);
  const projectsRef = useRef<GitProject[]>([]);
  const selectedProjectIdRef = useRef<string | null>(null);
  const autoRefreshBusyRef = useRef(false);
  const projectListRefreshBusyRef = useRef(false);
  const selectedProjectLoadTimerRef = useRef<number | undefined>();
  const projectLoadRequestRef = useRef(0);
  const projectDataCacheRef = useRef(new Map<string, ProjectDataSnapshot>());
  const graphHistoryCacheRef = useRef(new Map<string, GraphHistorySnapshot>());
  const pendingConfirmResolveRef = useRef<((confirmed: boolean) => void) | undefined>();
  const detailStackRef = useRef<HTMLElement | null>(null);
  const restoreConsoleHeightRef = useRef(DEFAULT_CONSOLE_HEIGHT);

  function rememberStatus(message: string) {
    setStatusMessage(message);
  }

  function toastTitle(message: string) {
    return message.trim().replace(/[。．.…]+$/u, "");
  }

  function notifyInfo(message: string, description?: string, id?: ToastId) {
    const title = toastTitle(message);
    rememberStatus(title);
    toast.info(title, { description, id });
  }

  function notifySuccess(message: string, description?: string, id?: ToastId) {
    const title = toastTitle(message);
    rememberStatus(title);
    toast.success(title, { description, id });
  }

  function notifyError(message: string, description?: string, id?: ToastId) {
    const title = toastTitle(cleanElectronError(message));
    const cleanDescription = description ? cleanElectronError(description) : undefined;
    rememberStatus(title);
    toast.error(title, { description: cleanDescription, id: id ?? `error:${title}` });
  }

  function notifyLoading(message: string): ToastId {
    const title = toastTitle(message);
    rememberStatus(title);
    return toast.loading(title);
  }

  function notifyGitResult(result: GitOperationResult, successMessage: string, fallbackError: string, id?: ToastId): boolean {
    if (result.ok) {
      if (successMessage) {
        notifySuccess(successMessage, undefined, id);
      } else {
        rememberStatus("操作完成");
      }
      return true;
    }

    notifyError(result.messageZh ?? fallbackError, gitOutputPreview(result), id);
    return false;
  }

  function requestConfirm(options: FeedbackConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      pendingConfirmResolveRef.current?.(false);
      pendingConfirmResolveRef.current = resolve;
      setPendingConfirm(options);
    });
  }

  function resolvePendingConfirm(confirmed: boolean) {
    const resolve = pendingConfirmResolveRef.current;
    pendingConfirmResolveRef.current = undefined;
    resolve?.(confirmed);
    setPendingConfirm(null);
  }

  function selectProject(projectId: string | null) {
    setSelectedProjectId((current) => (current === projectId ? current : projectId));
  }

  function projectCacheKey(projectId: string, filter: GitHistoryFilter) {
    return `${projectId}:${historyFilterCacheKey(filter)}`;
  }

  function historyFilterCacheKey(filter: GitHistoryFilter) {
    if (filter.mode !== "custom") {
      return filter.mode;
    }

    return `custom:${[...(filter.refIds ?? [])].sort().join("|")}`;
  }

  function applyProjectStatus(projectId: string, status: GitProject["status"]) {
    if (!status) {
      return;
    }

    setProjects((current) => {
      let changed = false;
      const nextProjects = current.map((item) => {
        if (item.id !== projectId || statusSignature(item.status) === statusSignature(status)) {
          return item;
        }

        changed = true;
        return { ...item, status };
      });

      return changed ? nextProjects : current;
    });
  }

  function applyProjectDataSnapshot(project: GitProject, snapshot: ProjectDataSnapshot, options: { clearTabs?: boolean; cached?: boolean } = {}) {
    applyProjectStatus(project.id, snapshot.status);
    setCommits(snapshot.history);
    setGraphHistoryRefs(snapshot.historyRefs);
    setWorktree(snapshot.worktree);
    setSelectedCommitHash("");
    if (options.clearTabs) {
      clearWorktreeEditorTabs();
    }
    if (options.cached) {
      rememberStatus(`已恢复 ${project.name} 的最近状态，正在后台刷新...`);
    }
  }

  function readFreshProjectDataCache(projectId: string, filter: GitHistoryFilter) {
    const snapshot = projectDataCacheRef.current.get(projectCacheKey(projectId, filter));
    if (!snapshot || Date.now() - snapshot.loadedAt > PROJECT_DATA_CACHE_TTL_MS) {
      return undefined;
    }

    return snapshot;
  }

  function writeProjectDataCache(project: GitProject, filter: GitHistoryFilter, snapshot: Omit<ProjectDataSnapshot, "loadedAt">) {
    projectDataCacheRef.current.set(projectCacheKey(project.id, filter), {
      ...snapshot,
      loadedAt: Date.now()
    });
  }

  function readFreshGraphHistoryCache(projectId: string, filter: GitHistoryFilter) {
    const snapshot = graphHistoryCacheRef.current.get(projectCacheKey(projectId, filter));
    if (!snapshot || Date.now() - snapshot.loadedAt > GRAPH_HISTORY_CACHE_TTL_MS) {
      return undefined;
    }

    return snapshot;
  }

  function writeGraphHistoryCache(project: GitProject, filter: GitHistoryFilter, snapshot: Omit<GraphHistorySnapshot, "loadedAt">) {
    graphHistoryCacheRef.current.set(projectCacheKey(project.id, filter), {
      ...snapshot,
      loadedAt: Date.now()
    });
  }

  function invalidateProjectCaches(projectId: string) {
    for (const key of projectDataCacheRef.current.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        projectDataCacheRef.current.delete(key);
      }
    }
    for (const key of graphHistoryCacheRef.current.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        graphHistoryCacheRef.current.delete(key);
      }
    }
  }

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

  useEffect(() => {
    void window.gitUI?.setNativeTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(
    () => () => {
      window.clearTimeout(selectedProjectLoadTimerRef.current);
      projectLoadRequestRef.current += 1;
      pendingConfirmResolveRef.current?.(false);
      pendingConfirmResolveRef.current = undefined;
    },
    []
  );

  useEffect(() => {
    if (!consoleOpen) {
      return;
    }

    const syncConsoleHeight = () => {
      const maxConsoleHeight = getMaxConsoleHeight();
      setConsoleHeight((currentHeight) => {
        const nextHeight = consoleMaximized ? maxConsoleHeight : clamp(currentHeight, MIN_CONSOLE_HEIGHT, maxConsoleHeight);
        if (nextHeight < maxConsoleHeight - 1) {
          restoreConsoleHeightRef.current = nextHeight;
        }
        return nextHeight;
      });
    };

    syncConsoleHeight();
    const resizeObserver = new ResizeObserver(syncConsoleHeight);
    if (detailStackRef.current) {
      resizeObserver.observe(detailStackRef.current);
    }
    window.addEventListener("resize", syncConsoleHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncConsoleHeight);
    };
  }, [consoleOpen, consoleMaximized]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );
  const selectedProjectGitReady = gitDependency.status === "ready" || Boolean(selectedProject?.remote);
  const activeWorktreeTab = useMemo(
    () => worktreeTabs.find((tab) => tab.id === activeWorktreeTabId) ?? worktreeTabs[0],
    [activeWorktreeTabId, worktreeTabs]
  );

  useEffect(() => {
    window.clearTimeout(selectedProjectLoadTimerRef.current);
    const requestId = nextProjectLoadRequestId();
    const nextHistoryFilter = defaultGraphHistoryFilter();

    if (!selectedProject) {
      setGraphLoading(false);
      return;
    }

    if (!selectedProjectGitReady) {
      setGraphLoading(false);
      setCommits([]);
      setGraphHistoryRefs([]);
      setSelectedCommitHash("");
      setWorktree(emptyWorktree);
      clearWorktreeEditorTabs();
      return;
    }

    setGraphHistoryFilter(nextHistoryFilter);
    setGraphHistoryRefs([]);

    selectedProjectLoadTimerRef.current = window.setTimeout(() => {
      if (projectLoadRequestRef.current !== requestId) {
        return;
      }

      const cachedSnapshot = readFreshProjectDataCache(selectedProject.id, nextHistoryFilter);
      if (!cachedSnapshot) {
        setGraphLoading(true);
        setCommits([]);
      }
      setSelectedCommitHash("");
      void loadProjectData(selectedProject, requestId, nextHistoryFilter, { preferCache: true, clearTabs: true });
    }, PROJECT_SELECTION_LOAD_DELAY_MS);

    return () => window.clearTimeout(selectedProjectLoadTimerRef.current);
  }, [selectedProject?.id, selectedProjectGitReady]);

  useEffect(() => {
    if (!selectedProject || !selectedProjectGitReady) {
      return;
    }

    let disposed = false;
    const refresh = async () => {
      if (disposed || document.hidden || autoRefreshBusyRef.current) {
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
    }, SELECTED_PROJECT_REFRESH_INTERVAL_MS);
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
  }, [selectedProject?.id, selectedProject?.path, selectedProjectGitReady]);

  useEffect(() => {
    if (gitDependency.status !== "ready" && !projectsRef.current.some((project) => project.remote)) {
      return;
    }

    let disposed = false;
    const refresh = () => {
      if (document.hidden) {
        return;
      }

      void refreshProjectListStatuses(undefined, () => disposed);
    };

    const intervalId = window.setInterval(refresh, PROJECT_LIST_STATUS_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [gitDependency.status, projects.some((project) => Boolean(project.remote))]);

  async function loadInitialData() {
    try {
      const [projectList, versionResult] = await Promise.all([apiClient.getProjects(), apiClient.getGitVersion()]);
      const orderedProjects = orderProjectsWithPinnedFirst(projectList);
      setProjects(orderedProjects);
      selectProject(orderedProjects[0]?.id ?? null);
      applyGitVersionResult(versionResult);
      const refreshableProjects = versionResult.ok ? orderedProjects : orderedProjects.filter((project) => project.remote);
      if (refreshableProjects.length > 0) {
        void refreshProjectListStatuses(refreshableProjects);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "初始化失败");
    }
  }

  function applyGitVersionResult(result: GitOperationResult) {
    setGitVersion(formatGitVersion(result));
    if (result.ok) {
      setGitDependency({ status: "ready", version: result.stdout.trim() || "Git 已就绪" });
      rememberStatus("Git 已就绪");
      return true;
    }

    setGitDependency({
      status: "missing",
      message: result.messageZh ?? "未检测到 Git，请安装 Git 并确认已加入 PATH。",
      details: gitOutputPreview(result)
    });
    rememberStatus("未检测到 Git");
    return false;
  }

  async function handleRecheckGit() {
    setGitDependency({ status: "checking" });
    setGitVersion("检测中");
    rememberStatus("正在检测 Git...");

    let result: GitOperationResult;
    try {
      result = await apiClient.getGitVersion();
      const ready = applyGitVersionResult(result);
      if (!ready) {
        notifyError(result.messageZh ?? "仍未检测到 Git", gitOutputPreview(result));
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Git 检测失败";
      setGitDependency({ status: "missing", message });
      setGitVersion("Git 未就绪");
      notifyError(message);
      return;
    }

    notifySuccess("Git 检测通过", result.stdout.trim());
    if (selectedProject) {
      await loadProjectData(selectedProject);
    }
    void refreshProjectListStatuses();
  }

  async function openGitDownloadPage() {
    await apiClient.openExternal(GIT_DOWNLOAD_URL);
  }

  function requireGitReady(actionLabel = "该操作", project: GitProject | null | undefined = selectedProject) {
    if (gitDependency.status === "ready" || Boolean(project?.remote)) {
      return true;
    }

    notifyInfo(`${actionLabel}需要先安装 Git`);
    return false;
  }

  function nextProjectLoadRequestId(): number {
    projectLoadRequestRef.current += 1;
    return projectLoadRequestRef.current;
  }

  function isCurrentProjectLoad(requestId: number): boolean {
    return projectLoadRequestRef.current === requestId;
  }

  async function loadProjectData(
    project: GitProject,
    requestId = nextProjectLoadRequestId(),
    historyFilter = graphHistoryFilter,
    options: { preferCache?: boolean; clearTabs?: boolean } = {}
  ) {
    try {
      if (!options.preferCache) {
        invalidateProjectCaches(project.id);
      }

      if (isCurrentProjectLoad(requestId)) {
        if (options.preferCache) {
          const cachedSnapshot = readFreshProjectDataCache(project.id, historyFilter);
          if (cachedSnapshot) {
            applyProjectDataSnapshot(project, cachedSnapshot, { clearTabs: options.clearTabs, cached: true });
          }
        }

        rememberStatus(`正在加载 ${project.name} 的 Git 状态...`);
      }

      const [status, history, historyRefs, worktreeState] = await Promise.all([
        apiClient.getProjectStatus(project),
        apiClient.getHistory(project, historyFilter),
        apiClient.getHistoryRefs(project),
        apiClient.getWorktree(project)
      ]);

      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      applyProjectStatus(project.id, status);
      writeProjectDataCache(project, historyFilter, { status, history, historyRefs, worktree: worktreeState });
      writeGraphHistoryCache(project, historyFilter, { history, historyRefs });

      setCommits(history);
      setGraphHistoryRefs(historyRefs);
      setWorktree(worktreeState);
      if (options.clearTabs ?? true) {
        clearWorktreeEditorTabs();
      }
      setSelectedCommitHash("");
      rememberStatus(history.length > 0 ? `已加载 ${history.length} 条提交。` : "当前仓库还没有提交历史。");
    } catch (error) {
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      setCommits([]);
      setGraphHistoryRefs([]);
      setWorktree(emptyWorktree);
      clearWorktreeEditorTabs();
      notifyError(error instanceof Error ? error.message : "加载项目失败");
    } finally {
      if (isCurrentProjectLoad(requestId)) {
        setGraphLoading(false);
      }
    }
  }

  async function handleSelectCommit(hash: string) {
    if (!hash) {
      setSelectedCommitHash("");
      rememberStatus("已收起提交。");
      return;
    }

    setSelectedCommitHash(hash);
    const commit = commits.find((item) => item.hash === hash);
    rememberStatus(commit ? `已选中提交 ${commit.shortHash}` : "已选中提交。");
  }

  async function handleGraphHistoryFilterChange(filter: GitHistoryFilter) {
    if (!selectedProject) {
      setGraphHistoryFilter(filter);
      return;
    }

    const requestId = nextProjectLoadRequestId();
    setGraphHistoryFilter(filter);
    setSelectedCommitHash("");
    setGraphLoading(true);
    const cachedHistory = readFreshGraphHistoryCache(selectedProject.id, filter);
    if (cachedHistory) {
      setCommits(cachedHistory.history);
      setGraphHistoryRefs(cachedHistory.historyRefs);
      rememberStatus("已恢复最近一次图表结果，正在后台刷新...");
    } else {
      rememberStatus("正在按新的图表引用加载提交...");
    }

    try {
      const [history, historyRefs] = await Promise.all([apiClient.getHistory(selectedProject, filter), apiClient.getHistoryRefs(selectedProject)]);
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      setCommits(history);
      setGraphHistoryRefs(historyRefs);
      writeGraphHistoryCache(selectedProject, filter, { history, historyRefs });
      rememberStatus(history.length > 0 ? `已加载 ${history.length} 条提交。` : "当前引用范围没有可显示的提交。");
    } catch (error) {
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      notifyError(error instanceof Error ? error.message : "无法加载图表引用。");
    } finally {
      if (isCurrentProjectLoad(requestId)) {
        setGraphLoading(false);
      }
    }
  }

  async function refreshProjectChanges(project: GitProject) {
    try {
      const [status, worktreeState] = await Promise.all([apiClient.getProjectStatus(project), apiClient.getWorktree(project)]);

      if (selectedProjectIdRef.current !== project.id) {
        return;
      }

      if (status) {
        setProjects((current) => {
          let changed = false;
          const nextProjects = current.map((item) => {
            if (item.id !== project.id) {
              return item;
            }

            if (statusSignature(item.status) === statusSignature(status)) {
              return item;
            }

            changed = true;
            return { ...item, status };
          });

          return changed ? nextProjects : current;
        });
      }

      setWorktree((current) => (worktreeSignature(current) === worktreeSignature(worktreeState) ? current : worktreeState));
    } catch {
      // Background refresh should not replace the user's current status message.
    }
  }

  async function reloadProjectWorktree(project: GitProject): Promise<WorktreeState> {
    const [status, worktreeState] = await Promise.all([apiClient.getProjectStatus(project), apiClient.getWorktree(project)]);
    if (selectedProjectIdRef.current !== project.id) {
      throw new Error("当前项目已切换，已取消刷新。");
    }

    invalidateProjectCaches(project.id);
    applyProjectStatus(project.id, status);
    setWorktree(worktreeState);
    return worktreeState;
  }

  async function refreshProjectListStatuses(projectSnapshot = projectsRef.current, isDisposed: () => boolean = () => false) {
    projectSnapshot = projectSnapshot.filter((project) => gitDependency.status === "ready" || project.remote);
    if (isDisposed() || projectListRefreshBusyRef.current || projectSnapshot.length === 0) {
      return;
    }

    projectListRefreshBusyRef.current = true;
    const statusUpdates = new Map<string, GitProject["status"]>();
    try {
      for (let index = 0; index < projectSnapshot.length && !isDisposed(); index += PROJECT_LIST_STATUS_BATCH_SIZE) {
        const batch = projectSnapshot.slice(index, index + PROJECT_LIST_STATUS_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (project): Promise<ProjectStatusRefresh> => ({
            projectId: project.id,
            status: await apiClient.getProjectStatus(project)
          }))
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value.status) {
            statusUpdates.set(result.value.projectId, result.value.status);
          }
        }
      }

      if (isDisposed() || statusUpdates.size === 0) {
        return;
      }

      setProjects((current) => {
        let changed = false;
        const nextProjects = current.map((project) => {
          const nextStatus = statusUpdates.get(project.id);
          if (!nextStatus || statusSignature(project.status) === statusSignature(nextStatus)) {
            return project;
          }

          changed = true;
          return { ...project, status: nextStatus };
        });

        return changed ? nextProjects : current;
      });
    } finally {
      projectListRefreshBusyRef.current = false;
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

  async function openWorktreeFile(file: ChangedFile, pinned: boolean, forceReload = false): Promise<boolean> {
    if (!selectedProject) {
      return false;
    }

    const tabId = worktreeTabId(file);
    const existingTab = worktreeTabs.find((tab) => tab.id === tabId);
    if (existingTab && pinned && !forceReload) {
      setWorktreeTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, pinned: true } : tab)));
      setActiveWorktreeTabId(tabId);
      return true;
    }

    const pendingTab: WorktreeEditorTab = {
      id: tabId,
      file,
      diffLines: [],
      pinned,
      sourceType: "worktree",
      conflict: undefined,
      loadError: undefined,
      loading: true
    };
    setWorktreeTabs((current) => upsertWorktreeTab(current, pendingTab, pinned));
    setActiveWorktreeTabId(tabId);

    try {
      if (file.status === "conflicted") {
        const conflict = await apiClient.getConflictFileDetails(selectedProject, file.path);
        setWorktreeTabs((current) =>
          current.map((tab) =>
            tab.id === tabId ? { ...tab, file, diffLines: [], preview: null, conflict, loading: false, pinned: tab.pinned || pinned } : tab
          )
          );
          rememberStatus(`正在解决冲突：${file.path}`);
          return true;
        }

      const preview = await apiClient.getWorktreeFilePreview(selectedProject, file);
      if (preview) {
        setWorktreeTabs((current) =>
          current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines: [], preview, loading: false, pinned: tab.pinned || pinned } : tab))
          );
          rememberStatus(`正在查看媒体：${file.path}`);
          return true;
        }

      const diffLines = await apiClient.getWorktreeDiff(selectedProject, file.path, file.staged);
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines, preview: null, loading: false, pinned: tab.pinned || pinned } : tab))
      );
      return true;
    } catch (error) {
      const message = errorText(error, file.status === "conflicted" ? "无法读取冲突详情。" : "加载工作区文件失败。");
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, conflict: undefined, loadError: message, loading: false } : tab))
      );
      if (file.status === "conflicted") {
        notifyError("无法读取冲突详情", message);
      } else {
        notifyError(message);
      }
      return false;
    }
  }

  async function handleRetryWorktreeLoad(tab: WorktreeEditorTab): Promise<void> {
    if (!selectedProject) {
      return;
    }

    if (tab.file.status !== "conflicted") {
      await openWorktreeFile(tab.file, tab.pinned, true);
      return;
    }

    setWorktreeTabs((current) =>
      current.map((item) => (item.id === tab.id ? { ...item, loadError: undefined, loading: true } : item))
    );
    rememberStatus("正在刷新冲突状态...");

    try {
      const refreshedWorktree = await reloadProjectWorktree(selectedProject);
      const refreshedFile = [...refreshedWorktree.unstagedFiles, ...refreshedWorktree.stagedFiles].find((file) =>
        matchesWorktreePath(tab.file.path, file.path)
      );

      if (!refreshedFile) {
        handleCloseWorktreeTab(tab.id);
        notifyInfo("工作区已刷新", "该文件已不在更改列表中。");
        return;
      }

      if (tab.id !== worktreeTabId(refreshedFile)) {
        setWorktreeTabs((current) => current.filter((item) => item.id !== tab.id));
      }
      const loaded = await openWorktreeFile(refreshedFile, tab.pinned, true);
      if (loaded && refreshedFile.status !== "conflicted") {
        notifyInfo("工作区已刷新", "该文件已不再冲突，已切换到普通变更视图。");
      }
    } catch (error) {
      const message = errorText(error, "刷新工作区失败。");
      setWorktreeTabs((current) =>
        current.map((item) => (item.id === tab.id ? { ...item, loadError: message, loading: false } : item))
      );
      notifyError("刷新工作区失败", message);
    }
  }

  async function handleRefreshWorktree(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const toastId = notifyLoading("正在刷新工作区...");
    try {
      const refreshedWorktree = await reloadProjectWorktree(selectedProject);
      clearWorktreeEditorTabs();
      const conflictCount = refreshedWorktree.unstagedFiles.filter((file) => file.status === "conflicted").length;
      notifySuccess(conflictCount > 0 ? `已刷新，剩余 ${conflictCount} 个冲突文件` : "工作区已刷新，没有待解决冲突", undefined, toastId);
    } catch (error) {
      notifyError(errorText(error, "刷新工作区失败。"), undefined, toastId);
    }
  }

  async function handleResolveConflict(tab: WorktreeEditorTab, input: ConflictResolutionInput): Promise<boolean> {
    if (!selectedProject || tab.file.status !== "conflicted") {
      return false;
    }

    const nextConflictFile = worktree.unstagedFiles.find((file) => file.status === "conflicted" && file.path !== tab.file.path);
    const toastId = notifyLoading(`正在保存冲突结果：${tab.file.path}...`);
    try {
      const result = await apiClient.resolveConflictFile(selectedProject, tab.file.path, input);
      if (!notifyGitResult(result, `已解决并暂存：${tab.file.path}`, "解决冲突失败，请查看原始 Git 输出。", toastId)) {
        return false;
      }

      handleCloseWorktreeTab(tab.id);
      await loadProjectData(selectedProject);
      if (nextConflictFile) {
        await openWorktreeFile(nextConflictFile, false);
        return true;
      }

      const status = await apiClient.getProjectStatus(selectedProject).catch(() => undefined);
      if (status?.operationState === "merge" && !status.hasConflicts) {
        notifyInfo("所有冲突文件已解决", "检查暂存结果后可以继续合并。");
      }
      return true;
    } catch (error) {
      notifyError(errorText(error, "解决冲突失败"), undefined, toastId);
      return false;
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
      const preview = await apiClient.getCommitFilePreview(selectedProject, commit.hash, file);
      if (preview) {
        setWorktreeTabs((current) =>
          current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines: [], preview, pinned: tab.pinned || pinned } : tab))
        );
        rememberStatus(`正在查看提交 ${commit.shortHash} 的媒体 ${file.path}`);
        return;
      }

      const diffLines = await apiClient.getCommitDiff(selectedProject, commit.hash, file.path);
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, file, diffLines, preview: null, pinned: tab.pinned || pinned } : tab))
      );
      rememberStatus(`正在查看提交 ${commit.shortHash} 的 ${file.path}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "加载提交文件失败");
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
    if (!requireGitReady("添加项目", null)) {
      return;
    }

    try {
      const project = await apiClient.chooseAndAddProject();
      if (!project) {
        return;
      }

      setProjects((current) => addProjectWithPinnedOrder(current, project));
      selectProject(project.id);
      notifySuccess("已添加项目", project.name);
      void refreshProjectListStatuses([project]);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "添加项目失败");
    }
  }

  async function handleScanProjects() {
    if (!requireGitReady("扫描项目", null)) {
      return;
    }

    try {
      const scannedProjects = await apiClient.chooseAndScanProjects();
      if (scannedProjects.length === 0) {
        notifyInfo("未发现新的 Git 项目");
        return;
      }

      setProjects((current) => mergeProjects(scannedProjects, current));
      selectProject(scannedProjects[0].id);
      notifySuccess(`已扫描到 ${scannedProjects.length} 个 Git 项目`);
      void refreshProjectListStatuses(scannedProjects);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "扫描目录失败");
    }
  }

  async function handleReorderProjects(projectIds: string[]) {
    const previousProjects = projects;
    const reorderedProjects = reorderProjectsByIds(projects, projectIds);
    if (projects.map((project) => project.id).join("|") === reorderedProjects.map((project) => project.id).join("|")) {
      return;
    }

    setProjects(reorderedProjects);
    try {
      await apiClient.reorderProjects(reorderedProjects.map((project) => project.id));
    } catch (error) {
      setProjects(previousProjects);
      notifyError(error instanceof Error ? error.message : "保存项目排序失败");
    }
  }

  async function handleToggleProjectPinned(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const previousProjects = projects;
    const nextFavorite = !project.favorite;
    const updatedProject = { ...project, favorite: nextFavorite };
    const remainingProjects = projects.filter((item) => item.id !== projectId);
    const nextProjects = nextFavorite
      ? [updatedProject, ...remainingProjects]
      : placeProjectAfterPinned(remainingProjects, updatedProject);

    setProjects(nextProjects);
    try {
      await apiClient.setProjectFavorite(projectId, nextFavorite);
      notifySuccess(nextFavorite ? "已置顶项目" : "已取消置顶", project.name);
    } catch (error) {
      setProjects(previousProjects);
      notifyError(error instanceof Error ? error.message : "保存项目置顶状态失败");
    }
  }

  async function handleRemoveProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "移除项目记录",
      description: "只会从项目列表移除，不会删除本地文件。",
      detail: project.name,
      confirmLabel: "移除",
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }

    await apiClient.removeProject(projectId);
    setProjects((current) => current.filter((item) => item.id !== projectId));
    setSelectedProjectId((current) => (current === projectId ? projects.find((item) => item.id !== projectId)?.id ?? null : current));
    notifySuccess("已移除项目记录", project.name);
  }

  async function handleOperation(action: string) {
    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return;
    }

    if (!requireGitReady(action)) {
      return;
    }

    if (action === "fetch" || action === "pull" || action === "push") {
      await runRemoteOperation(action, selectedProject);
      return;
    }

    if (action === "合并分支") {
      await openMergeDialog(selectedProject);
      return;
    }

    if (action === "合并远程更改") {
      await runMergeRemoteOperation(selectedProject);
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
      notifyInfo("请在工作区输入提交信息后提交");
      return;
    }

    notifyInfo(`暂不支持操作：${action}`);
  }

  async function runRemoteOperation(action: "fetch" | "pull" | "push", project: GitProject) {
    if (!requireGitReady({ fetch: "抓取", pull: "拉取", push: "推送" }[action])) {
      return;
    }

    const label = { fetch: "抓取", pull: "拉取", push: "推送" }[action];
    const toastId = notifyLoading(`正在${label}...`);

    const result = await apiClient[action](project);
    if (!notifyGitResult(result, `${label}完成`, `${label}失败，请查看原始 Git 输出。`, toastId)) {
      return;
    }

    await loadProjectData(project);
  }

  async function runSyncOperation(project: GitProject) {
    if (!requireGitReady("同步")) {
      return;
    }

    const toastId = notifyLoading("正在同步...");

    const pullResult = await apiClient.pull(project);
    if (!pullResult.ok) {
      notifyGitResult(pullResult, "", "同步失败：拉取远程更改失败。", toastId);
      await loadProjectData(project);
      return;
    }

    const pushResult = await apiClient.push(project);
    if (!pushResult.ok) {
      notifyGitResult(pushResult, "", "同步失败：推送本地提交失败。", toastId);
      await loadProjectData(project);
      return;
    }

    notifySuccess("同步完成", undefined, toastId);
    await loadProjectData(project);
  }

  async function handleTestRemoteProject(input: RemoteProjectInput): Promise<RemoteProjectTestResult> {
    rememberStatus(`正在连接 ${input.host}...`);
    const result = await apiClient.testRemoteProject(input);
    rememberStatus(result.ok ? "远程连接测试通过" : result.messageZh ?? "远程连接失败");
    return result;
  }

  async function handleAddRemoteProject(input: RemoteProjectInput): Promise<GitProject> {
    rememberStatus(`正在连接 ${input.host}...`);
    try {
      const project = await apiClient.addRemoteProject(input);
      setProjects((current) => addProjectWithPinnedOrder(current, project));
      selectProject(project.id);
      setRemoteProjectDialogOpen(false);
      notifySuccess(`已连接远程项目：${project.name}`, remoteProjectAddress(project));
      return project;
    } catch (error) {
      rememberStatus(error instanceof Error ? cleanElectronError(error.message) : "连接远程项目失败");
      throw error;
    }
  }

  async function runMergeRemoteOperation(project: GitProject) {
    if (!requireGitReady("合并远程更改")) {
      return;
    }

    const status = project.status;
    if (status?.operationState || status?.hasConflicts) {
      notifyInfo("请先继续或终止当前 Git 操作");
      return;
    }
    if ((status?.stagedCount ?? 0) + (status?.unstagedCount ?? 0) + (status?.untrackedCount ?? 0) > 0) {
      notifyInfo("合并远程更改前必须保持工作区干净", "请先提交、暂存到 stash 或丢弃当前改动。");
      return;
    }

    const confirmed = await requestConfirm({
      title: "合并远程更改",
      description: `将先抓取远程，然后把 ${status?.upstream ?? "远程分支"} 的 ${status?.behind ?? 0} 个新提交合并到 ${status?.currentBranch ?? "当前分支"}。`,
      detail: `本地领先的 ${status?.ahead ?? 0} 个提交不会被改写；若产生冲突，可以在软件中解决或终止合并。`,
      confirmLabel: "抓取并合并"
    });
    if (!confirmed) {
      return;
    }

    setMergeOperationBusy(true);
    const toastId = notifyLoading("正在抓取并合并远程更改...");
    try {
      const result = await apiClient.mergeRemote(project);
      notifyGitResult(result, "远程更改已合并，请检查后推送", "合并远程更改失败，请查看原始 Git 输出。", toastId);
      await loadProjectData(project);
    } catch (error) {
      notifyError(errorText(error, "合并远程更改失败"), undefined, toastId);
      await loadProjectData(project);
    } finally {
      setMergeOperationBusy(false);
    }
  }

  async function openMergeDialog(project: GitProject) {
    if (!requireGitReady("合并分支")) {
      return;
    }

    if (project.status?.operationState || project.status?.hasConflicts) {
      notifyInfo("请先继续或终止当前 Git 操作");
      return;
    }

    const currentBranch = project.status?.currentBranch;
    if (!currentBranch) {
      notifyInfo("当前是分离 HEAD 状态，无法执行分支合并");
      return;
    }

    if (hasWorktreeChanges(project)) {
      notifyInfo("合并前必须保持工作区干净", "请先提交、暂存到 stash 或丢弃当前改动。");
      return;
    }

    setMergeOperationBusy(true);
    rememberStatus("正在读取可合并分支...");
    try {
      const branches = (await apiClient.getBranches(project)).filter((branch) => branch.type === "local" && !branch.current);
      if (branches.length === 0) {
        notifyInfo("没有可作为合并目标的本地分支");
        return;
      }

      setBranchDialog({ mode: "merge", project, branches, query: "", strategy: "ff" });
      rememberStatus(`当前来源分支：${currentBranch}`);
    } catch (error) {
      notifyError(errorText(error, "读取分支列表失败"));
    } finally {
      setMergeOperationBusy(false);
    }
  }

  async function previewMergeTarget(target: BranchInfo) {
    if (!branchDialog || branchDialog.mode !== "merge") {
      return;
    }

    const { project } = branchDialog;
    setBranchDialogBusy(true);
    rememberStatus(`正在预检 ${target.name}...`);
    try {
      const preview = await apiClient.getMergePreview(project, target.name);
      setBranchDialog((current) => (current?.mode === "merge" ? { ...current, preview } : current));
      rememberStatus(`合并预检完成：${preview.sourceBranch} → ${preview.targetBranch}`);
    } catch (error) {
      notifyError(errorText(error, "合并预检失败"));
      setBranchDialog((current) => (current?.mode === "merge" ? { ...current, preview: undefined } : current));
    } finally {
      setBranchDialogBusy(false);
    }
  }

  async function submitMerge() {
    if (!branchDialog || branchDialog.mode !== "merge" || !branchDialog.preview) {
      return;
    }

    const { project, preview, strategy } = branchDialog;
    if (preview.mode === "up-to-date") {
      notifyInfo(`${preview.targetBranch} 已包含 ${preview.sourceBranch} 的全部提交`);
      setBranchDialog(null);
      return;
    }

    setBranchDialogBusy(true);
    setMergeOperationBusy(true);
    const toastId = notifyLoading(`正在合并 ${preview.sourceBranch} → ${preview.targetBranch}...`);
    try {
      const result = await apiClient.mergeCurrentBranch(project, preview.targetBranch, strategy);
      setBranchDialog(null);
      clearWorktreeEditorTabs();
      notifyGitResult(result, `合并完成：${preview.sourceBranch} → ${preview.targetBranch}`, "合并失败，请查看原始 Git 输出。", toastId);
    } catch (error) {
      setBranchDialog(null);
      notifyError(errorText(error, "合并失败"), undefined, toastId);
    } finally {
      await loadProjectData(project, nextProjectLoadRequestId(), graphHistoryFilter, { clearTabs: true });
      setBranchDialogBusy(false);
      setMergeOperationBusy(false);
    }
  }

  async function continueMerge(project: GitProject) {
    if (!requireGitReady("继续合并")) {
      return;
    }

    if (project.status?.operationState !== "merge") {
      notifyInfo("当前没有正在进行的合并操作");
      return;
    }

    if (mergeOperationBusy) {
      return;
    }

    setMergeOperationBusy(true);
    const toastId = notifyLoading("正在继续合并...");
    try {
      const result = await apiClient.continueMerge(project);
      if (notifyGitResult(result, "合并完成", "继续合并失败，请确认所有冲突已解决并暂存。", toastId)) {
        clearWorktreeEditorTabs();
      }
    } catch (error) {
      notifyError(errorText(error, "继续合并失败"), undefined, toastId);
    } finally {
      await loadProjectData(project);
      setMergeOperationBusy(false);
    }
  }

  async function abortMerge(project: GitProject) {
    if (!requireGitReady("终止合并")) {
      return;
    }

    if (project.status?.operationState !== "merge") {
      notifyInfo("当前没有正在进行的合并操作");
      return;
    }

    if (mergeOperationBusy) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "终止合并",
      description: project.status.mergeSourceBranch
        ? `将取消当前 merge，恢复目标分支后切回 ${project.status.mergeSourceBranch}。`
        : "将取消当前 merge，并恢复合并开始前的分支内容。",
      confirmLabel: "终止合并",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setMergeOperationBusy(true);
    const toastId = notifyLoading("正在终止合并...");
    try {
      const result = await apiClient.abortMerge(project);
      const successMessage = project.status.mergeSourceBranch
        ? `已终止合并并返回 ${project.status.mergeSourceBranch}`
        : "已终止合并";
      if (notifyGitResult(result, successMessage, "终止合并失败，请查看原始 Git 输出。", toastId)) {
        clearWorktreeEditorTabs();
      }
    } catch (error) {
      notifyError(errorText(error, "终止合并失败"), undefined, toastId);
    } finally {
      await loadProjectData(project);
      setMergeOperationBusy(false);
    }
  }

  async function createBranchFromToolbar(project: GitProject) {
    if (!requireGitReady("新建分支")) {
      return;
    }

    setBranchDialog({ mode: "create", project, branchName: "", checkout: true });
  }

  async function submitCreateBranch() {
    if (!requireGitReady("创建分支")) {
      return;
    }

    if (!branchDialog || branchDialog.mode !== "create") {
      return;
    }

    const branchName = branchDialog.branchName.trim();
    if (!branchName) {
      notifyInfo("分支名不能为空");
      return;
    }

    setBranchDialogBusy(true);
    const toastId = notifyLoading(`正在创建分支 ${branchName}...`);
    try {
      const result = await apiClient.createBranch(branchDialog.project, branchName, branchDialog.checkout, branchDialog.startPoint);
      if (!notifyGitResult(
        result,
        branchDialog.checkout ? `已创建并切换到分支：${branchName}` : `已创建分支：${branchName}`,
        "创建分支失败，请查看原始 Git 输出。",
        toastId
      )) {
        return;
      }

      setBranchDialog(null);
      await loadProjectData(branchDialog.project);
    } finally {
      setBranchDialogBusy(false);
    }
  }

  async function switchBranchFromToolbar(project: GitProject) {
    if (!requireGitReady("切换分支")) {
      return;
    }

    rememberStatus("正在读取分支列表...");
    const branches = await apiClient.getBranches(project);
    if (branches.length === 0) {
      notifyInfo("没有可切换的分支");
      return;
    }

    setBranchDialog({ mode: "switch", project, branches, query: "" });
    rememberStatus(`已加载 ${branches.length} 个分支。`);
  }

  async function submitSwitchBranch(target: BranchInfo) {
    if (!requireGitReady("切换分支")) {
      return;
    }

    if (!branchDialog || branchDialog.mode !== "switch") {
      return;
    }

    if (target.current) {
      notifyInfo(`当前已经在分支：${target.name}`);
      setBranchDialog(null);
      return;
    }

    const project = branchDialog.project;
    if (hasWorktreeChanges(project)) {
      const confirmed = await requestConfirm({
        title: "切换分支",
        description: "当前工作区存在未提交改动，切换分支可能失败或影响这些改动。",
        detail: target.name,
        confirmLabel: "继续切换",
        tone: "warning"
      });
      if (!confirmed) {
        return;
      }
    }

    setBranchDialogBusy(true);
    const toastId = notifyLoading(`正在切换到分支 ${target.name}...`);
    try {
      const result = await apiClient.switchBranch(project, target);
      if (!notifyGitResult(result, `已切换到分支：${target.name}`, "切换分支失败，请查看原始 Git 输出。", toastId)) {
        return;
      }

      setBranchDialog(null);
      await loadProjectData(project);
    } finally {
      setBranchDialogBusy(false);
    }
  }

  async function deleteBranchFromToolbar(project: GitProject) {
    if (!requireGitReady("删除分支")) {
      return;
    }

    const branches = (await apiClient.getBranches(project)).filter((branch) => branch.type === "local" && !branch.current);
    const target = chooseBranch(branches, "输入要删除的本地分支序号或名称：");
    if (!target) {
      return;
    }

    if (
      !(await requestConfirm({
        title: "删除本地分支",
        description: "只会删除本地分支，不会删除远程分支。",
        detail: target.name,
        confirmLabel: "删除",
        tone: "danger"
      }))
    ) {
      return;
    }

    const toastId = notifyLoading(`正在删除分支 ${target.name}...`);
    const result = await apiClient.deleteBranch(project, target.name);
    if (!notifyGitResult(result, `已删除本地分支：${target.name}`, "删除分支失败，请查看原始 Git 输出。", toastId)) {
      return;
    }

    await loadProjectData(project);
  }

  function openAmendLastCommitDialog() {
    if (!requireGitReady("修改提交信息")) {
      return;
    }

    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return;
    }

    const commit = commits[0];
    if (!commit) {
      notifyInfo("当前仓库还没有可修改的提交");
      return;
    }

    setCommitMessageDialog({
      project: selectedProject,
      commit,
      ...commitMessageDraft(commit)
    });
  }

  async function submitAmendCommitMessage() {
    if (!requireGitReady("修改提交信息")) {
      return;
    }

    if (!commitMessageDialog) {
      return;
    }

    const input: CommitMessageInput = {
      subject: commitMessageDialog.subject.trim(),
      body: commitMessageDialog.body.trim() || undefined
    };
    if (!input.subject) {
      notifyInfo("提交标题不能为空");
      return;
    }

    const project = commitMessageDialog.project;
    if (isCommitHistoryPublished(project)) {
      const confirmed = await requestConfirm({
        title: "修改已发布提交",
        description: "上次提交可能已经同步到远程，修改提交信息会改写历史。",
        confirmLabel: "继续修改",
        tone: "warning"
      });
      if (!confirmed) {
        return;
      }
    }

    setCommitMessageDialogBusy(true);
    const toastId = notifyLoading("正在修改提交信息...");
    try {
      const result = await apiClient.amendLastCommitMessage(project, input);
      if (!notifyGitResult(result, "已修改提交信息", "修改提交信息失败，请查看原始 Git 输出。", toastId)) {
        return;
      }

      setCommitMessageDialog(null);
      clearWorktreeEditorTabs();
      await loadProjectData(project);
    } finally {
      setCommitMessageDialogBusy(false);
    }
  }

  async function handleUndoLastCommit(mode: Exclude<GitResetMode, "hard">) {
    if (!requireGitReady("撤销提交")) {
      return;
    }

    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return;
    }

    if (commits.length === 0) {
      notifyInfo("当前仓库还没有可撤销的提交");
      return;
    }

    const commitToRestore = commits[0];
    const modeText = mode === "soft" ? "保留更改并保持暂存" : "保留更改但取消暂存";
    const publishedWarning = isCommitHistoryPublished(selectedProject) ? "\n\n注意：上次提交可能已经同步到远程，撤销会改写历史。" : "";
    if (
      !(await requestConfirm({
        title: "撤销上次提交",
        description: `将撤销上次提交，并${modeText}。`,
        detail: publishedWarning.trim() || commitToRestore.subject,
        confirmLabel: "撤销提交",
        tone: isCommitHistoryPublished(selectedProject) ? "warning" : "default"
      }))
    ) {
      return;
    }

    const toastId = notifyLoading("正在撤销上次提交...");
    let result: GitOperationResult;
    try {
      result = await withTimeout(apiClient.resetLastCommit(selectedProject, mode), RESET_OPERATION_TIMEOUT_MS, "撤销上次提交超时，请确认仓库未被其它 Git 进程锁定后重试");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "撤销上次提交失败", undefined, toastId);
      await loadProjectData(selectedProject);
      return;
    }

    if (!notifyGitResult(result, mode === "soft" ? "已撤销上次提交，更改保留为暂存" : "已撤销上次提交，更改保留为未暂存", "撤销上次提交失败，请查看原始 Git 输出。", toastId)) {
      await loadProjectData(selectedProject);
      return;
    }

    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
    restoreCommitMessageDraft(commitToRestore);
  }

  function isCommitLocalOnly(project: GitProject, commit: CommitNode): boolean {
    const commitIndex = commits.findIndex((item) => item.hash === commit.hash);
    if (commitIndex < 0) {
      return false;
    }

    if (!project.status?.upstream) {
      return true;
    }

    return commitIndex < (project.status.ahead ?? 0);
  }

  function isCurrentHeadCommit(project: GitProject, commit: CommitNode): boolean {
    const currentBranch = project.status?.currentBranch;
    if (currentBranch) {
      return commit.refs.some((ref) => ref.type === "localBranch" && ref.name === currentBranch);
    }

    return commit.hash === commits[0]?.hash;
  }

  function restoreCommitMessageDraft(commit: CommitNode) {
    const draft = commitMessageDraft(commit);
    const value = [draft.subject, draft.body].filter(Boolean).join("\n\n");
    if (!value.trim()) {
      return;
    }

    setChangesPanelOpen(true);
    setCommitMessageDraftRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      value
    }));
  }

  async function handleCommitGraphAction(action: CommitGraphAction, commit: CommitNode) {
    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return;
    }

    if (action === "copyHash") {
      await navigator.clipboard.writeText(commit.hash);
      notifySuccess("已复制提交 hash");
      return;
    }

    if (action === "copyMessage") {
      await navigator.clipboard.writeText([commit.subject, commit.body].filter(Boolean).join("\n\n"));
      notifySuccess("已复制提交信息");
      return;
    }

    if (!requireGitReady("提交历史操作")) {
      return;
    }

    if (action === "amendMessage") {
      if (commit.hash !== commits[0]?.hash) {
        notifyInfo("当前仅支持直接修改最新提交的信息");
        return;
      }

      if (!isCommitLocalOnly(selectedProject, commit)) {
        notifyInfo("该提交已同步到远程，建议使用还原提交或先确认团队协作风险");
        return;
      }

      setCommitMessageDialog({
        project: selectedProject,
        commit,
        ...commitMessageDraft(commit)
      });
      return;
    }

    if (action === "createBranch") {
      setBranchDialog({
        mode: "create",
        project: selectedProject,
        branchName: `branch/${commit.shortHash}`,
        checkout: true,
        startPoint: commit.hash,
        startLabel: commit.shortHash
      });
      return;
    }

    if (action === "revert") {
      await runCommitMutation(selectedProject, commit, "revert", "还原此提交会新建一个反向提交，不会改写历史。是否继续？");
      return;
    }

    if (action === "cherryPick") {
      const dirtyWarning = hasWorktreeChanges(selectedProject) ? "\n\n当前工作区存在未提交改动，Cherry-pick 可能失败或产生冲突。" : "";
      await runCommitMutation(selectedProject, commit, "cherryPick", `把此提交应用到当前分支？${dirtyWarning}`);
      return;
    }

    const resetMode = action === "resetSoft" ? "soft" : action === "resetMixed" ? "mixed" : "hard";
    await runResetToCommit(selectedProject, commit, resetMode);
  }

  async function runCommitMutation(project: GitProject, commit: CommitNode, action: "revert" | "cherryPick", confirmText: string) {
    if (
      !(await requestConfirm({
        title: confirmText,
        description: "确认后会对当前分支执行 Git 操作。",
        detail: `${commit.shortHash} ${commit.subject}`,
        confirmLabel: action === "revert" ? "还原提交" : "Cherry-pick",
        tone: "warning"
      }))
    ) {
      return;
    }

    const label = action === "revert" ? "还原提交" : "Cherry-pick";
    const toastId = notifyLoading(`正在${label}...`);
    const result = action === "revert" ? await apiClient.revertCommit(project, commit.hash) : await apiClient.cherryPickCommit(project, commit.hash);
    if (!notifyGitResult(result, `${label}完成`, `${label}失败，请查看原始 Git 输出。`, toastId)) {
      await loadProjectData(project);
      return;
    }

    clearWorktreeEditorTabs();
    await loadProjectData(project);
  }

  async function runResetToCommit(project: GitProject, commit: CommitNode, mode: GitResetMode) {
    const undoHead = isCurrentHeadCommit(project, commit);
    const resetTarget = undoHead ? commit.parents[0] : commit.hash;
    if (!resetTarget) {
      notifyInfo("根提交没有父提交，暂不支持从这里撤销");
      return;
    }

    const modeText =
      mode === "soft"
        ? "保留更改并保持暂存"
        : mode === "mixed"
          ? "保留更改但取消暂存"
          : undoHead
            ? "丢弃此提交引入的更改"
            : "丢弃目标提交之后的更改";
    const publishedWarning = isCommitHistoryPublished(project) ? "\n\n注意：当前分支可能已经同步到远程，reset 会改写历史。" : "";
    const confirmTitle = undoHead ? `撤销提交 ${commit.shortHash}，并${modeText}？` : `将当前分支重置到 ${commit.shortHash}，并${modeText}？`;
    if (
      !(await requestConfirm({
        title: confirmTitle,
        description: "reset 会移动当前分支指针，请确认目标提交正确。",
        detail: `${publishedWarning.trim() ? `${publishedWarning.trim()}\n\n` : ""}${commit.subject}`,
        confirmLabel: "继续 reset",
        tone: mode === "hard" || isCommitHistoryPublished(project) ? "danger" : "warning"
      }))
    ) {
      return;
    }

    if (mode === "hard") {
      const confirmed = await requestConfirm({
        title: "确认 reset --hard",
        description: "该操作会丢弃目标提交之后的改动和当前工作区未提交内容，无法从工作区恢复。",
        confirmLabel: "确认丢弃",
        tone: "danger"
      });
      if (!confirmed) {
        return;
      }
    }

    const toastId = notifyLoading("正在重置分支...");
    let result: GitOperationResult;
    try {
      result = await withTimeout(apiClient.resetToCommit(project, resetTarget, mode), RESET_OPERATION_TIMEOUT_MS, "重置分支超时，请确认仓库未被其它 Git 进程锁定后重试");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "重置分支失败", undefined, toastId);
      await loadProjectData(project);
      return;
    }

    const successMessage = undoHead
      ? mode === "soft"
        ? "已撤销此提交，更改保留为暂存"
        : mode === "mixed"
          ? "已撤销此提交，更改保留为未暂存"
          : "已撤销此提交并丢弃更改"
      : "分支重置完成";
    if (!notifyGitResult(result, successMessage, "重置分支失败，请查看原始 Git 输出。", toastId)) {
      await loadProjectData(project);
      return;
    }

    clearWorktreeEditorTabs();
    await loadProjectData(project);
    if (undoHead && mode !== "hard") {
      restoreCommitMessageDraft(commit);
    }
  }

  async function handleStageFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    if (!requireGitReady("暂存")) {
      return;
    }

    const result = await apiClient.stageFile(selectedProject, file.path);
    notifyGitResult(result, `已暂存：${file.path}`, "暂存失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleStageAll() {
    if (!selectedProject || worktree.unstagedFiles.length === 0) {
      return;
    }

    if (!requireGitReady("暂存所有更改")) {
      return;
    }

    const result = await apiClient.stageAll(selectedProject);
    notifyGitResult(result, "已暂存所有更改", "暂存所有更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleUnstageFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    if (!requireGitReady("取消暂存")) {
      return;
    }

    const result = await apiClient.unstageFile(selectedProject, file.path);
    notifyGitResult(result, `已取消暂存：${file.path}`, "取消暂存失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleUnstageAll() {
    if (!selectedProject || worktree.stagedFiles.length === 0) {
      return;
    }

    if (!requireGitReady("取消暂存所有更改")) {
      return;
    }

    const result = await apiClient.unstageAll(selectedProject);
    notifyGitResult(result, "已取消暂存所有更改", "取消暂存所有更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleDiscardFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    if (!requireGitReady("放弃更改")) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "放弃文件更改",
      description: "该操作无法从 Git 恢复未提交内容。",
      detail: file.path,
      confirmLabel: "放弃更改",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    const result = await apiClient.discardFile(selectedProject, file);
    notifyGitResult(result, `已放弃更改：${file.path}`, "放弃更改失败");
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleDiscardAll() {
    if (!selectedProject || worktree.unstagedFiles.length === 0) {
      return;
    }

    if (!requireGitReady("放弃所有更改")) {
      return;
    }

    const count = worktree.unstagedFiles.length;
    const confirmed = await requestConfirm({
      title: "放弃所有未暂存更改",
      description: "该操作无法从 Git 恢复未提交内容。",
      detail: `${count} 个文件`,
      confirmLabel: "全部放弃",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    const toastId = notifyLoading(`正在放弃 ${count} 个更改...`);
    for (const file of worktree.unstagedFiles) {
      const result = await apiClient.discardFile(selectedProject, file);
      if (!result.ok) {
        notifyGitResult(result, "", `放弃更改失败：${file.path}`, toastId);
        clearWorktreeEditorTabs();
        await loadProjectData(selectedProject);
        return;
      }
    }

    notifySuccess(`已放弃 ${count} 个更改`, undefined, toastId);
    clearWorktreeEditorTabs();
    await loadProjectData(selectedProject);
  }

  async function handleCommit(input: CommitInput): Promise<boolean> {
    if (!requireGitReady("提交")) {
      return false;
    }

    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return false;
    }

    if (!input.subject.trim() && !input.amend) {
      notifyInfo("提交标题不能为空");
      return false;
    }

    if (input.amend) {
      const confirmed = await requestConfirm({
        title: "修改上一次提交",
        description: "amend 会改写上一次提交。",
        confirmLabel: "继续提交",
        tone: "warning"
      });
      if (!confirmed) {
        return false;
      }
    }

    const shouldAutoStage = worktree.stagedFiles.length === 0 && worktree.unstagedFiles.length > 0;
    const autoStageCount = worktree.unstagedFiles.length;
    let toastId: ToastId | undefined;
    if (shouldAutoStage) {
      toastId = notifyLoading(`正在自动暂存 ${autoStageCount} 个未暂存文件并提交...`);
      const stageResult = await apiClient.stageAll(selectedProject);
      if (!stageResult.ok) {
        notifyGitResult(stageResult, "", "自动暂存失败，提交已取消。", toastId);
        await loadProjectData(selectedProject);
        return false;
      }
    } else {
      toastId = notifyLoading(input.pushAfterCommit ? "正在提交并推送..." : input.amend ? "正在修改上次提交..." : "正在提交...");
    }

    const result = await apiClient.commit(selectedProject, input);
    if (!result.ok) {
      notifyGitResult(result, "", "提交失败，请展开原始输出查看原因。", toastId);
      if (shouldAutoStage) {
        await loadProjectData(selectedProject);
      }
      return false;
    }

    notifySuccess(
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
            : "提交完成。",
      undefined,
      toastId
    );
    await loadProjectData(selectedProject);
    return true;
  }

  function handleThemeModeChange(mode: ThemeMode) {
    window.localStorage.setItem("git-ui-pro-theme", mode);
    setThemeModeState(mode);
    setResolvedTheme(resolveTheme(mode));
  }

  function toggleThemeMode() {
    handleThemeModeChange(resolvedTheme === "dark" ? "light" : "dark");
  }

  function runAppCommand(command: string) {
    void window.gitUI?.runAppCommand(command);
  }

  function getMaxConsoleHeight(): number {
    const stackHeight = detailStackRef.current?.clientHeight ?? window.innerHeight;
    return Math.max(MIN_CONSOLE_HEIGHT, stackHeight - 10);
  }

  function toggleConsoleMaximized() {
    if (!consoleOpen) {
      setConsoleOpen(true);
    }

    if (consoleMaximized) {
      const restoredHeight = clamp(restoreConsoleHeightRef.current, MIN_CONSOLE_HEIGHT, Math.max(MIN_CONSOLE_HEIGHT, getMaxConsoleHeight() - 1));
      setConsoleHeight(restoredHeight);
      setConsoleMaximized(false);
      return;
    }

    restoreConsoleHeightRef.current = clamp(consoleHeight, MIN_CONSOLE_HEIGHT, Math.max(MIN_CONSOLE_HEIGHT, getMaxConsoleHeight() - 1));
    setConsoleHeight(getMaxConsoleHeight());
    setConsoleMaximized(true);
  }

  function renderSidebarControls(collapsed: boolean) {
    const sidebarToggleLabel = collapsed ? "展开项目栏" : "收起项目栏";
    const themeToggleLabel = resolvedTheme === "dark" ? "切换浅色主题" : "切换深色主题";
    return (
      <div className={`sidebar-bottom-controls ${collapsed ? "collapsed" : ""}`} aria-label="左侧栏控制">
        <PathTooltip content={sidebarToggleLabel} className="sidebar-control-tooltip">
          <button type="button" className="icon-button compact-icon" aria-label={sidebarToggleLabel} onClick={() => setLeftCollapsed(!collapsed)}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </PathTooltip>
        <PathTooltip content={themeToggleLabel} className="sidebar-control-tooltip">
          <button type="button" className="icon-button compact-icon" aria-label={themeToggleLabel} onClick={toggleThemeMode}>
            {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </PathTooltip>
      </div>
    );
  }

  function beginResize(target: ResizeTarget, event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startDetailWidth = detailWidth;
    const startSourcePaneHeight = sourcePaneHeight;
    const startConsoleHeight = consoleHeight;

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

      if (target === "console") {
        const maxConsoleHeight = getMaxConsoleHeight();
        let nextConsoleHeight = clamp(startConsoleHeight + startY - moveEvent.clientY, MIN_CONSOLE_HEIGHT, maxConsoleHeight);
        if (maxConsoleHeight - nextConsoleHeight <= CONSOLE_TOP_SNAP_DISTANCE) {
          nextConsoleHeight = maxConsoleHeight;
        }

        setConsoleHeight(nextConsoleHeight);
        setConsoleMaximized(nextConsoleHeight >= maxConsoleHeight - 1);
        if (nextConsoleHeight < maxConsoleHeight - 1) {
          restoreConsoleHeightRef.current = nextConsoleHeight;
        }
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
    "--sidebar-width": leftCollapsed ? "64px" : `${sidebarWidth}px`,
    "--detail-width": rightCollapsed ? "0px" : `${detailWidth}px`,
    "--scm-pane-height": `${sourcePaneHeight}px`,
    "--console-height": `${consoleHeight}px`
  } as CSSProperties;
  const detailStackStyle = {
    gridTemplateRows: consoleOpen
      ? `minmax(0, max(0px, calc(100% - ${consoleHeight}px - 10px))) 10px minmax(0, ${consoleHeight}px)`
      : "minmax(0, 1fr)"
  } as CSSProperties;

  return (
    <div
      className={`app-shell theme-${resolvedTheme} ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""} ${
        consoleOpen ? "console-open" : ""
      }`}
      style={layoutStyle}
    >
      <AppChrome onCommand={runAppCommand} />
      {leftCollapsed ? (
        <aside className="collapsed-sidebar">
          <div className="collapsed-project-list" aria-label="项目列表">
            {projects.map((project) => (
              <PathTooltip content={project.name} className="collapsed-project-tooltip" key={project.id}>
                <button
                  type="button"
                  className={`collapsed-project-item ${project.id === selectedProject?.id ? "active" : ""}`}
                  aria-label={project.name}
                  onClick={() => selectProject(project.id)}
                >
                  {projectInitial(project)}
                </button>
              </PathTooltip>
            ))}
            {projects.length === 0 ? (
              <PathTooltip content="暂无项目" className="collapsed-project-tooltip">
                <span className="collapsed-project-empty" aria-label="暂无项目">
                  <FolderGit2 size={18} />
                </span>
              </PathTooltip>
            ) : null}
          </div>
          {renderSidebarControls(true)}
        </aside>
      ) : (
        <ProjectRail
          projects={projects}
          selectedProjectId={selectedProject?.id ?? null}
          onSelectProject={selectProject}
          onAddProject={handleAddProject}
          onAddRemoteProject={() => setRemoteProjectDialogOpen(true)}
          onScanProjects={handleScanProjects}
          onRemoveProject={handleRemoveProject}
          onReorderProjects={(projectIds) => void handleReorderProjects(projectIds)}
          onToggleProjectPinned={(projectId) => void handleToggleProjectPinned(projectId)}
          onSwitchBranch={(project) => void switchBranchFromToolbar(project)}
          footer={renderSidebarControls(false)}
        />
      )}

      <div
        className={`resize-handle sidebar-resize ${leftCollapsed ? "collapsed" : ""}`}
        onMouseDown={(event) => {
          if (!leftCollapsed) {
            beginResize("sidebar", event);
          }
        }}
      />

      <main className="workspace-shell">
        <TopBar
          project={selectedProject}
          gitVersion={gitVersion}
          gitReady={selectedProjectGitReady}
        />

        {!selectedProjectGitReady ? (
          <section className="main-grid git-dependency-grid">
            <GitDependencyNotice
              state={gitDependency}
              onDownload={openGitDownloadPage}
              onRecheck={() => void handleRecheckGit()}
            />
          </section>
        ) : (
          <section className="main-grid">
            <div
              className={`source-control-pane ${changesPanelOpen ? "" : "changes-collapsed"} ${graphPanelOpen ? "" : "graph-collapsed"} ${
                sourcePaneHeight !== DEFAULT_SOURCE_PANE_HEIGHT ? "source-pane-customized" : ""
              }`}
            >
              <WorkspaceView
                project={selectedProject}
                worktree={worktree}
                onStageFile={handleStageFile}
                onStageAll={handleStageAll}
                onUnstageFile={handleUnstageFile}
                onUnstageAll={handleUnstageAll}
                onDiscardFile={handleDiscardFile}
                onDiscardAll={handleDiscardAll}
                onRefreshWorktree={() => void handleRefreshWorktree()}
                onSelectFile={handleSelectWorktreeFile}
                onPinFile={handlePinWorktreeFile}
                selectedFilePath={activeWorktreeTab?.file.path}
                selectedFileStaged={activeWorktreeTab?.file.staged}
                onCommit={handleCommit}
                onAmendLastMessage={openAmendLastCommitDialog}
                onUndoLastCommit={(mode) => void handleUndoLastCommit(mode)}
                onSyncChanges={() => (selectedProject ? runSyncOperation(selectedProject) : Promise.resolve())}
                onMergeRemote={() => (selectedProject ? runMergeRemoteOperation(selectedProject) : Promise.resolve())}
                hasCommits={commits.length > 0}
                focusRequest={commitFocusRequest}
                messageDraftRequest={commitMessageDraftRequest}
                panelOpen={changesPanelOpen}
                onTogglePanel={() => setChangesPanelOpen((value) => !value)}
              />
              <div className="source-graph-divider" onMouseDown={(event) => beginResize("sourceSplit", event)} />
              <GraphSidebar
                project={selectedProject}
                commits={commits}
                historyRefs={graphHistoryRefs}
                historyFilter={graphHistoryFilter}
                loading={graphLoading}
                onHistoryFilterChange={(filter) => void handleGraphHistoryFilterChange(filter)}
                selectedHash={selectedCommitHash}
                onSelectCommit={handleSelectCommit}
                onSelectCommitFile={handleSelectCommitFile}
                onPinCommitFile={handlePinCommitFile}
                selectedCommitFileHash={activeWorktreeTab?.sourceType === "commit" ? activeWorktreeTab.commitHash : undefined}
                selectedCommitFilePath={activeWorktreeTab?.sourceType === "commit" ? activeWorktreeTab.file.path : undefined}
                onOperation={handleOperation}
                onCommitAction={(action, commit) => void handleCommitGraphAction(action, commit)}
                onContinueMerge={() => (selectedProject ? void continueMerge(selectedProject) : undefined)}
                onAbortMerge={() => (selectedProject ? void abortMerge(selectedProject) : undefined)}
                operationBusy={mergeOperationBusy}
                panelOpen={graphPanelOpen}
                onTogglePanel={() => setGraphPanelOpen((value) => !value)}
              />
            </div>
            {!rightCollapsed ? <div className="resize-handle detail-resize" onMouseDown={(event) => beginResize("detail", event)} /> : null}
            {!rightCollapsed ? (
              <section
                className={`detail-stack ${consoleOpen ? "console-open" : ""} ${!consoleOpen && activeWorktreeTab?.conflict ? "conflict-console-toggle" : ""}`}
                aria-label="文件查看和控制台"
                ref={detailStackRef}
                style={detailStackStyle}
              >
                <WorktreeDetailPanel
                  tabs={worktreeTabs}
                  activeTabId={activeWorktreeTabId}
                  repositoryPath={selectedProject?.path}
                  onSelectTab={handleSelectWorktreeTab}
                  onCloseTab={handleCloseWorktreeTab}
                  onPinTab={handlePinWorktreeTab}
                  onResolveConflict={handleResolveConflict}
                  onRetryLoad={handleRetryWorktreeLoad}
                />
                <div className="console-resize" hidden={!consoleOpen} onMouseDown={(event) => beginResize("console", event)} />
                <ConsolePanel
                  project={selectedProject}
                  theme={resolvedTheme}
                  visible={consoleOpen}
                  maximized={consoleMaximized}
                  onToggleMaximized={toggleConsoleMaximized}
                  onHide={() => setConsoleOpen(false)}
                  onConfirmCloseTabs={(count) =>
                    requestConfirm({
                      title: "关闭当前项目终端",
                      description: "正在运行的终端进程会被结束。",
                      detail: `${count} 个终端标签`,
                      confirmLabel: "关闭终端",
                      tone: "warning"
                    })
                  }
                />
                {!consoleOpen ? (
                  <button type="button" className="console-dock-toggle" aria-label="打开控制台" onClick={() => setConsoleOpen(true)}>
                    <Terminal size={15} />
                    控制台
                  </button>
                ) : null}
              </section>
            ) : null}
          </section>
        )}

        <div className="sr-only" aria-live="polite">
          {statusMessage}
        </div>
        <Toaster
          position="top-center"
          theme={resolvedTheme}
          expand
          visibleToasts={5}
          toastOptions={{ duration: 2000 }}
        />
        {remoteProjectDialogOpen ? (
          <RemoteProjectDialog
            onClose={() => setRemoteProjectDialogOpen(false)}
            onChooseIdentityFile={() => apiClient.chooseIdentityFile()}
            onTest={handleTestRemoteProject}
            onAdd={handleAddRemoteProject}
          />
        ) : null}
        {branchDialog ? (
          <BranchDialog
            state={branchDialog}
            busy={branchDialogBusy}
            onClose={() => setBranchDialog(null)}
            onCreateNameChange={(branchName) =>
              setBranchDialog((current) => (current?.mode === "create" ? { ...current, branchName } : current))
            }
            onCheckoutChange={(checkout) => setBranchDialog((current) => (current?.mode === "create" ? { ...current, checkout } : current))}
            onBranchQueryChange={(query) =>
              setBranchDialog((current) => (current?.mode === "switch" || current?.mode === "merge" ? { ...current, query } : current))
            }
            onMergeStrategyChange={(strategy) =>
              setBranchDialog((current) => (current?.mode === "merge" ? { ...current, strategy } : current))
            }
            onCreate={submitCreateBranch}
            onSwitch={submitSwitchBranch}
            onMergeTarget={previewMergeTarget}
            onMerge={submitMerge}
          />
        ) : null}
        {commitMessageDialog ? (
          <CommitMessageDialog
            state={commitMessageDialog}
            busy={commitMessageDialogBusy}
            onClose={() => setCommitMessageDialog(null)}
            onSubjectChange={(subject) => setCommitMessageDialog((current) => (current ? { ...current, subject } : current))}
            onBodyChange={(body) => setCommitMessageDialog((current) => (current ? { ...current, body } : current))}
            onSubmit={submitAmendCommitMessage}
          />
        ) : null}
        {pendingConfirm ? (
          <FeedbackConfirmDialog
            state={pendingConfirm}
            onCancel={() => resolvePendingConfirm(false)}
            onConfirm={() => resolvePendingConfirm(true)}
          />
        ) : null}
      </main>
    </div>
  );
}

function GitDependencyNotice({
  state,
  onDownload,
  onRecheck
}: {
  state: GitDependencyState;
  onDownload: () => void;
  onRecheck: () => void;
}) {
  const checking = state.status === "checking";
  const message = state.status === "missing" ? state.message : "正在确认本机 Git 命令是否可用";
  const details = state.status === "missing" ? state.details : undefined;

  return (
    <section className="git-dependency-notice" aria-label="Git 安装检测">
      <div className="git-dependency-card">
        <div className="git-dependency-icon" aria-hidden="true">
          {checking ? <RefreshCw size={24} /> : <AlertTriangle size={24} />}
        </div>
        <div className="git-dependency-content">
          <span className="git-dependency-kicker">本机依赖检测</span>
          <h2>{checking ? "正在检测 Git" : "未检测到 Git"}</h2>
          <p>{message}</p>

          <div className="git-dependency-steps" aria-label="处理步骤">
            <div>
              <span>1</span>
              <strong>安装 Git for Windows</strong>
              <p>安装时保留“从命令行使用 Git”的 PATH 选项。</p>
            </div>
            <div>
              <span>2</span>
              <strong>回到软件重新检测</strong>
              <p>检测通过后会自动恢复项目状态、提交记录和工作区操作。</p>
            </div>
          </div>

          {details ? <pre className="git-dependency-details">{details}</pre> : null}

          <div className="git-dependency-actions">
            <button type="button" className="git-dependency-primary" onClick={onDownload}>
              <ExternalLink size={15} />
              下载 Git
            </button>
            <button type="button" className="git-dependency-secondary" onClick={onRecheck} disabled={checking}>
              <RefreshCw size={15} />
              重新检测
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function BranchDialog({
  state,
  busy,
  onClose,
  onCreateNameChange,
  onCheckoutChange,
  onBranchQueryChange,
  onMergeStrategyChange,
  onCreate,
  onSwitch,
  onMergeTarget,
  onMerge
}: {
  state: BranchDialogState;
  busy: boolean;
  onClose: () => void;
  onCreateNameChange: (value: string) => void;
  onCheckoutChange: (value: boolean) => void;
  onBranchQueryChange: (value: string) => void;
  onMergeStrategyChange: (value: GitMergeStrategy) => void;
  onCreate: () => void;
  onSwitch: (branch: BranchInfo) => void;
  onMergeTarget: (branch: BranchInfo) => void;
  onMerge: () => void;
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
    state.mode === "switch" || state.mode === "merge"
      ? state.branches.filter((branch) => `${branch.name} ${branch.fullName}`.toLowerCase().includes(state.query.trim().toLowerCase()))
      : [];
  const dialogTitle = state.mode === "create" ? "新建分支" : state.mode === "switch" ? "切换分支" : "合并分支";

  return (
    <div className="branch-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`branch-dialog ${state.mode === "merge" ? "merge-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={dialogTitle} onMouseDown={(event) => event.stopPropagation()}>
        <header className="branch-dialog-header">
          <span className="branch-dialog-title">
            {state.mode === "create" ? <Plus size={15} /> : state.mode === "merge" ? <GitMerge size={15} /> : <GitBranch size={15} />}
            {dialogTitle}
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
            {state.startLabel ? (
              <div className="branch-start-point">
                基于提交 <code>{state.startLabel}</code>
              </div>
            ) : null}
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
          <div className={`branch-switch-panel ${state.mode === "merge" ? "merge-branch-panel" : ""}`}>
            <label className="branch-search">
              <GitBranch size={14} />
              <input value={state.query} autoFocus onChange={(event) => onBranchQueryChange(event.target.value)} placeholder={state.mode === "merge" ? "搜索目标分支" : "搜索分支"} disabled={busy} />
            </label>
            <div className="branch-list" role="list">
              {filteredBranches.map((branch) => (
                <button
                  type="button"
                  className={`branch-list-item ${branch.current ? "current" : ""} ${state.mode === "merge" && state.preview?.targetBranch === branch.name ? "selected" : ""}`}
                  key={`${branch.type}-${branch.fullName}`}
                  onClick={() => (state.mode === "merge" ? onMergeTarget(branch) : onSwitch(branch))}
                  disabled={busy}
                >
                  <span>
                    <GitBranch size={13} />
                    {branch.name}
                  </span>
                  <small>{state.mode === "merge" && state.preview?.targetBranch === branch.name ? "目标" : branch.current ? "当前" : branch.type === "remote" ? "远程" : branch.upstream ? `跟踪 ${branch.upstream}` : "本地"}</small>
                </button>
              ))}
              {filteredBranches.length === 0 ? <div className="empty-inline branch-empty">没有匹配分支。</div> : null}
            </div>
            {state.mode === "merge" && state.preview ? (
              <div className="merge-plan">
                <div className="merge-plan-route">
                  <code>{state.preview.sourceBranch}</code>
                  <span aria-hidden="true">→</span>
                  <code>{state.preview.targetBranch}</code>
                </div>
                <div className="merge-plan-facts">
                  <span>
                    <strong>结果</strong>
                    {mergeResultLabel(state.preview, state.strategy)}
                  </span>
                  <span>
                    <strong>远端</strong>
                    {mergeRemoteLabel(state.preview)}
                  </span>
                </div>
                {state.preview.mode !== "up-to-date" ? (
                  <div className="merge-strategy" role="radiogroup" aria-label="合并策略">
                    <button type="button" role="radio" aria-checked={state.strategy === "ff"} className={state.strategy === "ff" ? "active" : ""} onClick={() => onMergeStrategyChange("ff")} disabled={busy}>
                      允许快进
                    </button>
                    <button type="button" role="radio" aria-checked={state.strategy === "no-ff"} className={state.strategy === "no-ff" ? "active" : ""} onClick={() => onMergeStrategyChange("no-ff")} disabled={busy}>
                      创建合并提交
                    </button>
                  </div>
                ) : null}
                {state.preview.targetBehind > 0 ? <div className="merge-plan-warning">目标分支落后 {state.preview.targetUpstream} {state.preview.targetBehind} 个提交</div> : null}
                <div className="branch-dialog-actions">
                  <button type="button" className="text-button" onClick={onClose} disabled={busy}>
                    取消
                  </button>
                  <button type="button" className="primary-action branch-primary-action" onClick={onMerge} disabled={busy || state.preview.mode === "up-to-date"}>
                    <GitMerge size={14} />
                    {state.preview.mode === "up-to-date" ? "无需合并" : busy ? "处理中" : "开始合并"}
                  </button>
                </div>
              </div>
            ) : state.mode === "merge" ? (
              <div className="branch-dialog-actions merge-dialog-footer">
                <button type="button" className="text-button" onClick={onClose} disabled={busy}>
                  取消
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function CommitMessageDialog({
  state,
  busy,
  onClose,
  onSubjectChange,
  onBodyChange,
  onSubmit
}: {
  state: CommitMessageDialogState;
  busy: boolean;
  onClose: () => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSubmit: () => void;
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

  return (
    <div className="branch-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="branch-dialog commit-message-dialog" role="dialog" aria-modal="true" aria-label="修改提交信息" onMouseDown={(event) => event.stopPropagation()}>
        <header className="branch-dialog-header">
          <span className="branch-dialog-title">
            <MessageSquareText size={15} />
            修改提交信息
          </span>
          <button type="button" className="icon-button compact-icon" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <form
          className="branch-create-form commit-message-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="branch-start-point">
            目标提交 <code>{state.commit.shortHash}</code>
          </div>
          <label>
            <span>标题</span>
            <input value={state.subject} autoFocus onChange={(event) => onSubjectChange(event.target.value)} placeholder="type(scope): 中文摘要" disabled={busy} />
          </label>
          <label>
            <span>正文</span>
            <textarea value={state.body} onChange={(event) => onBodyChange(event.target.value)} placeholder="可选，留空则只修改标题" disabled={busy} />
          </label>
          <div className="branch-dialog-actions">
            <button type="button" className="text-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="primary-action branch-primary-action" disabled={busy || !state.subject.trim()}>
              <Check size={14} />
              保存
            </button>
          </div>
        </form>
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

function gitOutputPreview(result: GitOperationResult): string | undefined {
  const output = [result.stderr, result.stdout]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  if (!output) {
    return undefined;
  }

  return output.length > 180 ? `${output.slice(0, 180)}...` : output;
}

function errorText(error: unknown, fallback: string): string {
  return cleanElectronError(error instanceof Error && error.message.trim() ? error.message : fallback);
}

function cleanElectronError(message: string): string {
  return message
    .trim()
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i, "")
    .trim();
}

function matchesWorktreePath(previousPath: string, currentPath: string): boolean {
  return previousPath === currentPath || previousPath.endsWith(` ${currentPath}`);
}

function mergeResultLabel(preview: GitMergePreview, strategy: GitMergeStrategy): string {
  if (preview.mode === "up-to-date") {
    return "目标已包含来源";
  }
  if (strategy === "no-ff") {
    return "创建合并提交";
  }
  return preview.mode === "fast-forward" ? "快进" : "创建合并提交";
}

function mergeRemoteLabel(preview: GitMergePreview): string {
  if (!preview.targetUpstream) {
    return "未配置上游";
  }
  if (preview.targetAhead === 0 && preview.targetBehind === 0) {
    return `与 ${preview.targetUpstream} 一致`;
  }
  if (preview.targetAhead > 0 && preview.targetBehind > 0) {
    return `领先 ${preview.targetAhead} / 落后 ${preview.targetBehind}`;
  }
  return preview.targetAhead > 0 ? `领先 ${preview.targetAhead}` : `落后 ${preview.targetBehind}`;
}

function mergeProjects(incoming: GitProject[], current: GitProject[]): GitProject[] {
  const map = new Map<string, GitProject>();

  for (const project of [...incoming, ...current]) {
    map.set(projectIdentityKey(project), project);
  }

  return orderProjectsWithPinnedFirst(Array.from(map.values()));
}

function projectIdentityKey(project: GitProject): string {
  if (!project.remote) {
    return `local:${project.path.toLowerCase()}`;
  }
  return [
    "ssh",
    project.remote.host.toLowerCase(),
    project.remote.username?.toLowerCase() ?? "",
    project.remote.port ?? 22,
    project.path
  ].join(":");
}

function reorderProjectsByIds(projects: GitProject[], projectIds: string[]): GitProject[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const reorderedProjects = projectIds
    .map((projectId) => projectById.get(projectId))
    .filter((project): project is GitProject => Boolean(project));
  const reorderedIds = new Set(reorderedProjects.map((project) => project.id));
  return orderProjectsWithPinnedFirst([...reorderedProjects, ...projects.filter((project) => !reorderedIds.has(project.id))]);
}

function orderProjectsWithPinnedFirst(projects: GitProject[]): GitProject[] {
  const pinnedProjects = projects.filter((project) => project.favorite);
  const regularProjects = projects.filter((project) => !project.favorite);
  return [...pinnedProjects, ...regularProjects];
}

function placeProjectAfterPinned(projects: GitProject[], project: GitProject): GitProject[] {
  const firstUnpinnedIndex = projects.findIndex((item) => !item.favorite);
  if (firstUnpinnedIndex < 0) {
    return [...projects, project];
  }

  return [...projects.slice(0, firstUnpinnedIndex), project, ...projects.slice(firstUnpinnedIndex)];
}

function addProjectWithPinnedOrder(projects: GitProject[], project: GitProject): GitProject[] {
  const remainingProjects = projects.filter((item) => item.id !== project.id);
  return project.favorite ? [project, ...remainingProjects] : placeProjectAfterPinned(remainingProjects, project);
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

function commitMessageDraft(commit: CommitNode): Pick<CommitMessageDialogState, "subject" | "body"> {
  return {
    subject: commit.subject === "(无提交信息)" ? "" : commit.subject,
    body: commit.body ?? ""
  };
}

function isCommitHistoryPublished(project: GitProject): boolean {
  return Boolean(project.status?.upstream) && (project.status?.ahead ?? 0) === 0;
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function projectInitial(project: GitProject): string {
  const fallbackName = project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const source = (project.name.trim() || fallbackName.trim() || "?").trim();
  const alphaNumeric = source.match(/[a-z0-9]/i)?.[0];
  return (alphaNumeric ?? source[0] ?? "?").toUpperCase();
}

function remoteProjectAddress(project: GitProject): string | undefined {
  if (!project.remote) {
    return undefined;
  }
  const destination = project.remote.username ? `${project.remote.username}@${project.remote.host}` : project.remote.host;
  const port = project.remote.port ? `:${project.remote.port}` : "";
  return `${destination}${port}:${project.path}`;
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
