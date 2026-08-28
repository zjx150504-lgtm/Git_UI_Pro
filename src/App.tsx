import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitBranch,
  GitMerge,
  MessageSquareText,
  Plus,
  Power,
  RefreshCw,
  ServerOff,
  Terminal,
  Trash2,
  X
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { apiClient } from "./api/client";
import { AppChrome } from "./components/AppChrome";
import { ConsolePanel } from "./components/ConsolePanel";
import { FeedbackConfirmDialog, type FeedbackConfirmOptions } from "./components/FeedbackConfirmDialog";
import { GraphSidebar } from "./components/GraphSidebar";
import { GitOperationCenter } from "./components/GitOperationCenter";
import { ProjectRail } from "./components/ProjectRail";
import { RepositoryCenterContainer } from "./components/RepositoryCenterContainer";
import type { RepositoryCenterTab } from "./components/RepositoryCenter";
import { RemoteProjectDialog } from "./components/RemoteProjectDialog";
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
  GitHistoryQuery,
  GitHistoryRef,
  GitMergePreview,
  GitMergeStrategy,
  GitOperationResult,
  GitProject,
  GitResetMode,
  GitStatusSummary,
  ProjectLibraryState,
  RemoteProjectInput,
  RemoteProjectTestResult,
  UiPreferences,
  WorktreeState
} from "./types/domain";
import { cancelGitOperation, dismissGitOperation, getGitOperationsSnapshot, subscribeGitOperations } from "./api/operationTracker";
import { absoluteFilePath } from "./utils/filePath";

type ThemeMode = "system" | "light" | "dark";

const emptyWorktree: WorktreeState = {
  stagedFiles: [],
  unstagedFiles: []
};

const defaultGraphHistoryFilter = (): GitHistoryFilter => ({ mode: "auto" });
const cloneGraphHistoryFilter = (filter: GitHistoryFilter): GitHistoryFilter =>
  filter.mode === "custom" ? { mode: "custom", refIds: [...(filter.refIds ?? [])] } : { mode: filter.mode };

const DEFAULT_SOURCE_PANE_HEIGHT = 320;
const DEFAULT_CONSOLE_HEIGHT = 240;
const MIN_SOURCE_CONTROL_WIDTH = 400;
const MAX_SOURCE_CONTROL_WIDTH = 720;
const MIN_CONSOLE_HEIGHT = 80;
const CONSOLE_TOP_SNAP_DISTANCE = 36;
const SELECTED_PROJECT_REFRESH_INTERVAL_MS = 8000;
const REMOTE_PROJECT_REFRESH_INTERVAL_MS = 15_000;
const PROJECT_LIST_STATUS_REFRESH_INTERVAL_MS = 60_000;
const PROJECT_LIST_STATUS_BATCH_SIZE = 3;
const REMOTE_PROJECT_LIST_INITIAL_DELAY_MS = 15_000;
const REMOTE_PROJECT_LIST_REFRESH_INTERVAL_MS = 120_000;
const PROJECT_SELECTION_LOAD_DELAY_MS = 180;
const PROJECT_DATA_CACHE_TTL_MS = 20_000;
const GRAPH_HISTORY_CACHE_TTL_MS = 20_000;
const PROJECT_DATA_CACHE_MAX_ENTRIES = 12;
const GRAPH_HISTORY_CACHE_MAX_ENTRIES = 24;
const COMMIT_FILE_CACHE_MAX_ENTRIES = 32;
const RESET_OPERATION_TIMEOUT_MS = 45_000;
const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";
const HISTORY_PAGE_SIZE = 150;

const defaultUiPreferences = (): UiPreferences => ({
  theme: "system",
  language: "zh-CN",
  bottomConsoleVisible: true,
  sidebarWidth: 240,
  rightPanelWidth: 420,
  consoleHeight: 240,
  fontSize: 14,
  fontFamily: "system-ui",
  diffViewMode: "split",
  diffWrap: false,
  pullStrategy: "ff-only",
  density: "comfortable",
  sidebarPosition: "left",
  confirmDestructiveActions: true,
  shortcuts: {}
});

type ResizeTarget = "sidebar" | "detail" | "sourceSplit" | "console";
type ToastId = string | number;
type ProjectStatusRefresh = { projectId: string; status: GitStatusSummary };
type ProjectDataSnapshot = {
  status: GitStatusSummary;
  history: CommitNode[];
  historyRefs: GitHistoryRef[];
  worktree: WorktreeState;
  historyHasMore: boolean;
  historyNextSkip: number;
  loadedAt: number;
};
type GraphHistorySnapshot = {
  history: CommitNode[];
  historyRefs: GitHistoryRef[];
  historyHasMore: boolean;
  historyNextSkip: number;
  loadedAt: number;
};
type CommitFileCacheEntry = Pick<WorktreeEditorTab, "file" | "diffLines" | "preview">;
type AdvancedHistoryQuery = Pick<GitHistoryQuery, "search" | "author" | "after" | "before" | "path">;
type GitDependencyState =
  | { status: "checking" }
  | { status: "ready"; version: string }
  | { status: "missing"; message: string; details?: string };
type BranchDialogState =
  | { mode: "create"; project: GitProject; branchName: string; checkout: boolean; startPoint?: string; startLabel?: string }
  | { mode: "switch"; project: GitProject; branches: BranchInfo[]; query: string }
  | { mode: "delete"; project: GitProject; branches: BranchInfo[]; query: string }
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
  projectId: string;
  value: string;
};

export function App() {
  const gitOperations = useSyncExternalStore(subscribeGitOperations, getGitOperationsSnapshot, getGitOperationsSnapshot);
  const [projects, setProjects] = useState<GitProject[]>([]);
  const [projectLibrary, setProjectLibrary] = useState<ProjectLibraryState>({ groups: [], recentProjectIds: [] });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphHistoryFilter, setGraphHistoryFilter] = useState<GitHistoryFilter>(() => defaultGraphHistoryFilter());
  const [graphHistoryRefs, setGraphHistoryRefs] = useState<GitHistoryRef[]>([]);
  const [graphHistoryQuery, setGraphHistoryQuery] = useState<AdvancedHistoryQuery>({});
  const [graphHistoryHasMore, setGraphHistoryHasMore] = useState(false);
  const [graphHistoryNextSkip, setGraphHistoryNextSkip] = useState(0);
  const [graphHistoryLoadingMore, setGraphHistoryLoadingMore] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState("");
  const [worktree, setWorktree] = useState<WorktreeState>(emptyWorktree);
  const [worktreeTabs, setWorktreeTabs] = useState<WorktreeEditorTab[]>([]);
  const [activeWorktreeTabId, setActiveWorktreeTabId] = useState<string | null>(null);
  const [gitDependency, setGitDependency] = useState<GitDependencyState>({ status: "checking" });
  const [statusMessage, setStatusMessage] = useState("准备就绪");
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(readThemeMode()));
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [detailWidth, setDetailWidth] = useState(defaultUiPreferences().rightPanelWidth);
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
  const [repositoryCenterOpen, setRepositoryCenterOpen] = useState(false);
  const [repositoryCenterInitialTab, setRepositoryCenterInitialTab] = useState<RepositoryCenterTab>("recovery");
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => defaultUiPreferences());
  const projectsRef = useRef<GitProject[]>([]);
  const selectedProjectIdRef = useRef<string | null>(null);
  const autoRefreshBusyRef = useRef(false);
  const projectListRefreshBusyRef = useRef(false);
  const remoteProjectListRefreshBusyRef = useRef(false);
  const graphLoadingRef = useRef(false);
  const graphHistoryFilterRef = useRef<GitHistoryFilter>(graphHistoryFilter);
  const graphHistoryFiltersByProjectRef = useRef(new Map<string, GitHistoryFilter>());
  const graphHistoryQueryRef = useRef<AdvancedHistoryQuery>(graphHistoryQuery);
  const graphHistoryRefsRef = useRef<GitHistoryRef[]>(graphHistoryRefs);
  const selectedProjectLoadTimerRef = useRef<number | undefined>();
  const projectLoadRequestRef = useRef(0);
  const projectDataCacheRef = useRef(new Map<string, ProjectDataSnapshot>());
  const graphHistoryCacheRef = useRef(new Map<string, GraphHistorySnapshot>());
  const commitFileCacheRef = useRef(new Map<string, CommitFileCacheEntry>());
  const pendingCommitFileLoadsRef = useRef(new Map<string, Promise<CommitFileCacheEntry>>());
  const activeCommitFileReadRef = useRef<{ cacheKey: string; requestId: string; cancelled: boolean }>();
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

  function selectProject(projectId: string | null, openedProject?: GitProject) {
    if (selectedProjectIdRef.current !== projectId) {
      setConsoleOpen(false);
      setConsoleMaximized(false);
    }
    setSelectedProjectId((current) => (current === projectId ? current : projectId));
    if (openedProject) {
      setProjects((current) => current.map((project) => (project.id === openedProject.id ? { ...project, ...openedProject } : project)));
      return;
    }

    if (projectId && window.gitUI) {
      void apiClient.markProjectOpened(projectId).then((updatedProject) => {
        setProjects((current) => current.map((project) => (project.id === updatedProject.id ? { ...project, ...updatedProject } : project)));
      }).catch((error) => notifyError(error instanceof Error ? error.message : "无法记录最近项目"));
    }
  }

  function requestDestructiveConfirm(options: FeedbackConfirmOptions): Promise<boolean> {
    return uiPreferences.confirmDestructiveActions ? requestConfirm(options) : Promise.resolve(true);
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

  function applyProjectStatus(projectId: string, status: GitStatusSummary) {
    setProjects((current) => {
      let changed = false;
      const nextProjects = current.map((item) => {
        if (item.id !== projectId) {
          return item;
        }

        if (statusSignature(item.status) === statusSignature(status) && !item.statusError) {
          return item;
        }

        changed = true;
        return { ...item, status, statusError: undefined };
      });

      return changed ? nextProjects : current;
    });
  }

  function markProjectStatusUnavailable(projectId: string, error: unknown) {
    const statusError = errorText(error, "无法读取仓库状态");
    invalidateProjectCaches(projectId);
    setProjects((current) => current.map((item) => {
      if (item.id !== projectId || (!item.status && item.statusError === statusError)) {
        return item;
      }
      return { ...item, status: undefined, statusError };
    }));
  }

  function applyProjectDataSnapshot(project: GitProject, snapshot: ProjectDataSnapshot, options: { clearTabs?: boolean; cached?: boolean } = {}) {
    applyProjectStatus(project.id, snapshot.status);
    setCommits(snapshot.history);
    setGraphHistoryRefs(snapshot.historyRefs);
    setGraphHistoryHasMore(snapshot.historyHasMore);
    setGraphHistoryNextSkip(snapshot.historyNextSkip);
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
    const key = projectCacheKey(projectId, filter);
    const snapshot = projectDataCacheRef.current.get(key);
    if (!snapshot || Date.now() - snapshot.loadedAt > PROJECT_DATA_CACHE_TTL_MS) {
      projectDataCacheRef.current.delete(key);
      return undefined;
    }

    return snapshot;
  }

  function writeProjectDataCache(project: GitProject, filter: GitHistoryFilter, snapshot: Omit<ProjectDataSnapshot, "loadedAt">) {
    setBoundedCache(projectDataCacheRef.current, projectCacheKey(project.id, filter), {
      ...snapshot,
      loadedAt: Date.now()
    }, PROJECT_DATA_CACHE_MAX_ENTRIES);
  }

  function readFreshGraphHistoryCache(projectId: string, filter: GitHistoryFilter) {
    const key = projectCacheKey(projectId, filter);
    const snapshot = graphHistoryCacheRef.current.get(key);
    if (!snapshot || Date.now() - snapshot.loadedAt > GRAPH_HISTORY_CACHE_TTL_MS) {
      graphHistoryCacheRef.current.delete(key);
      return undefined;
    }

    return snapshot;
  }

  function writeGraphHistoryCache(project: GitProject, filter: GitHistoryFilter, snapshot: Omit<GraphHistorySnapshot, "loadedAt">) {
    setBoundedCache(graphHistoryCacheRef.current, projectCacheKey(project.id, filter), {
      ...snapshot,
      loadedAt: Date.now()
    }, GRAPH_HISTORY_CACHE_MAX_ENTRIES);
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

  useEffect(() => {
    graphLoadingRef.current = graphLoading;
  }, [graphLoading]);

  useEffect(() => {
    graphHistoryFilterRef.current = graphHistoryFilter;
  }, [graphHistoryFilter]);

  useEffect(() => {
    graphHistoryQueryRef.current = graphHistoryQuery;
  }, [graphHistoryQuery]);

  useEffect(() => {
    graphHistoryRefsRef.current = graphHistoryRefs;
  }, [graphHistoryRefs]);

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
  const selectedRemoteConnectionPaused = Boolean(selectedProject?.remote && selectedProject.remote.connectionEnabled === false);
  const selectedProjectGitReady = gitDependency.status === "ready" || Boolean(selectedProject?.remote);
  const selectedProjectConnectionReady = selectedProjectGitReady && !selectedRemoteConnectionPaused;
  const hasEnabledRemoteProjects = useMemo(
    () => projects.some((project) => Boolean(project.remote) && project.remote?.connectionEnabled !== false),
    [projects]
  );
  const disabledRemoteProjectIds = useMemo(
    () => projects.filter((project) => project.remote?.connectionEnabled === false).map((project) => project.id),
    [projects]
  );
  const activeWorktreeTab = useMemo(
    () => worktreeTabs.find((tab) => tab.id === activeWorktreeTabId) ?? worktreeTabs[0],
    [activeWorktreeTabId, worktreeTabs]
  );

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isEditableShortcutTarget(event.target)) {
        return;
      }

      const command = Object.entries(uiPreferences.shortcuts).find(([, shortcut]) => matchesShortcut(event, shortcut))?.[0];
      if (!command) {
        return;
      }

      event.preventDefault();
      if (command === "project.search") {
        if (leftCollapsed) {
          setLeftCollapsed(false);
          window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".project-rail-search input")?.focus());
        } else {
          document.querySelector<HTMLInputElement>(".project-rail-search input")?.focus();
        }
        return;
      }
      if (command === "repository.center") {
        setRepositoryCenterInitialTab(selectedProject ? "recovery" : "projects");
        setRepositoryCenterOpen(true);
        return;
      }
      if (command === "terminal.toggle") {
        setConsoleVisibility(!consoleOpen);
        return;
      }
      if (!selectedProject || !selectedProjectConnectionReady) {
        notifyInfo("请先选择可用的 Git 仓库");
        return;
      }
      if (command === "git.fetch" || command === "git.pull" || command === "git.push") {
        void runRemoteOperation(command.slice(4) as "fetch" | "pull" | "push", selectedProject);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [consoleOpen, leftCollapsed, selectedProject?.id, selectedProjectConnectionReady, uiPreferences.pullStrategy, uiPreferences.shortcuts]);

  useEffect(() => {
    window.clearTimeout(selectedProjectLoadTimerRef.current);
    const requestId = nextProjectLoadRequestId();

    if (!selectedProject) {
      setGraphLoading(false);
      setGraphHistoryHasMore(false);
      setGraphHistoryNextSkip(0);
      return;
    }

    const nextHistoryFilter = cloneGraphHistoryFilter(
      graphHistoryFiltersByProjectRef.current.get(selectedProject.id) ?? defaultGraphHistoryFilter()
    );

    if (!selectedProjectConnectionReady) {
      setGraphLoading(false);
      setCommits([]);
      setGraphHistoryRefs([]);
      setGraphHistoryHasMore(false);
      setGraphHistoryNextSkip(0);
      setSelectedCommitHash("");
      setWorktree(emptyWorktree);
      clearWorktreeEditorTabs();
      return;
    }

    graphHistoryFilterRef.current = nextHistoryFilter;
    setGraphHistoryFilter(nextHistoryFilter);
    setGraphHistoryQuery({});
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
      void loadProjectData(selectedProject, requestId, nextHistoryFilter, { preferCache: true, clearTabs: true, historyQuery: {} });
    }, PROJECT_SELECTION_LOAD_DELAY_MS);

    return () => window.clearTimeout(selectedProjectLoadTimerRef.current);
  }, [selectedProject?.id, selectedProjectConnectionReady]);

  useEffect(() => {
    if (!selectedProject || !selectedProjectConnectionReady) {
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

    const refreshInterval = selectedProject.remote ? REMOTE_PROJECT_REFRESH_INTERVAL_MS : SELECTED_PROJECT_REFRESH_INTERVAL_MS;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, refreshInterval);
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
  }, [selectedProject?.id, selectedProject?.path, selectedProjectConnectionReady]);

  useEffect(() => {
    if (gitDependency.status !== "ready") {
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
  }, [gitDependency.status]);

  useEffect(() => {
    if (!hasEnabledRemoteProjects) {
      return;
    }

    let disposed = false;
    const refresh = () => {
      if (!document.hidden) {
        void refreshProjectListStatuses(undefined, () => disposed, "remote");
      }
    };
    const initialTimerId = window.setTimeout(refresh, REMOTE_PROJECT_LIST_INITIAL_DELAY_MS);
    const intervalId = window.setInterval(refresh, REMOTE_PROJECT_LIST_REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(initialTimerId);
      window.clearInterval(intervalId);
    };
  }, [hasEnabledRemoteProjects]);

  async function loadInitialData() {
    try {
      const [projectList, versionResult, preferences, library] = await Promise.all([
        apiClient.getProjects(),
        apiClient.getGitVersion(),
        window.gitUI ? apiClient.getUiPreferences() : Promise.resolve(defaultUiPreferences()),
        apiClient.getProjectLibrary()
      ]);
      const orderedProjects = orderProjectsWithPinnedFirst(projectList);
      setProjects(orderedProjects);
      selectProject(orderedProjects[0]?.id ?? null);
      applyUiPreferences(preferences);
      setProjectLibrary(library);
      applyGitVersionResult(versionResult);
      const refreshableProjects = versionResult.ok ? orderedProjects.filter((project) => !project.remote) : [];
      if (refreshableProjects.length > 0) {
        void refreshProjectListStatuses(refreshableProjects);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "初始化失败");
    }
  }

  function applyGitVersionResult(result: GitOperationResult) {
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
      notifyError(message);
      return;
    }

    notifySuccess("Git 检测通过", result.stdout.trim());
    if (selectedProject && selectedProject.remote?.connectionEnabled !== false) {
      await loadProjectData(selectedProject);
    }
    void refreshProjectListStatuses();
  }

  async function openGitDownloadPage() {
    await apiClient.openExternal(GIT_DOWNLOAD_URL);
  }

  function requireGitReady(actionLabel = "该操作", project: GitProject | null | undefined = selectedProject) {
    if (project?.remote?.connectionEnabled === false) {
      notifyInfo(`${actionLabel}需要先开启远程连接`);
      return false;
    }
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
    options: { preferCache?: boolean; clearTabs?: boolean; historyQuery?: AdvancedHistoryQuery } = {}
  ) {
    let statusReadSucceeded = false;
    try {
      const advancedQuery = options.historyQuery ?? graphHistoryQuery;
      const cacheAllowed = !hasAdvancedHistoryQuery(advancedQuery);
      if (!options.preferCache) {
        invalidateProjectCaches(project.id);
      }

      if (isCurrentProjectLoad(requestId)) {
        if (options.preferCache && cacheAllowed) {
          const cachedSnapshot = readFreshProjectDataCache(project.id, historyFilter);
          if (cachedSnapshot) {
            applyProjectDataSnapshot(project, cachedSnapshot, { clearTabs: options.clearTabs, cached: true });
          }
        }

        rememberStatus(`正在加载 ${project.name} 的 Git 状态...`);
      }

      const [statusResult, historyPageResult, historyRefsResult, worktreeResult] = await Promise.allSettled([
        apiClient.getProjectStatus(project),
        apiClient.getHistoryPage(project, { filter: historyFilter, ...advancedQuery, skip: 0, limit: HISTORY_PAGE_SIZE }),
        apiClient.getHistoryRefs(project),
        apiClient.getWorktree(project)
      ]);

      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      if (statusResult.status === "rejected") {
        throw statusResult.reason;
      }
      statusReadSucceeded = true;
      applyProjectStatus(project.id, statusResult.value);
      if (historyPageResult.status === "rejected") {
        throw historyPageResult.reason;
      }
      if (historyRefsResult.status === "rejected") {
        throw historyRefsResult.reason;
      }
      if (worktreeResult.status === "rejected") {
        throw worktreeResult.reason;
      }

      const status = statusResult.value;
      const historyPage = historyPageResult.value;
      const historyRefs = historyRefsResult.value;
      const worktreeState = worktreeResult.value;
      const history = historyPage.commits;
      if (cacheAllowed) {
        writeProjectDataCache(project, historyFilter, {
          status,
          history,
          historyRefs,
          worktree: worktreeState,
          historyHasMore: historyPage.hasMore,
          historyNextSkip: historyPage.nextSkip
        });
        writeGraphHistoryCache(project, historyFilter, {
          history,
          historyRefs,
          historyHasMore: historyPage.hasMore,
          historyNextSkip: historyPage.nextSkip
        });
      }

      setCommits(history);
      setGraphHistoryRefs(historyRefs);
      setGraphHistoryHasMore(historyPage.hasMore);
      setGraphHistoryNextSkip(historyPage.nextSkip);
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

      if (!statusReadSucceeded) {
        markProjectStatusUnavailable(project.id, error);
      }
      setCommits([]);
      setGraphHistoryRefs([]);
      setGraphHistoryHasMore(false);
      setGraphHistoryNextSkip(0);
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

    const nextFilter = cloneGraphHistoryFilter(filter);
    const requestId = nextProjectLoadRequestId();
    graphHistoryFiltersByProjectRef.current.set(selectedProject.id, nextFilter);
    graphHistoryFilterRef.current = nextFilter;
    setGraphHistoryFilter(nextFilter);
    setSelectedCommitHash("");
    setGraphLoading(true);
    setGraphHistoryLoadingMore(false);
    const cacheAllowed = !hasAdvancedHistoryQuery(graphHistoryQuery);
    const cachedHistory = cacheAllowed ? readFreshGraphHistoryCache(selectedProject.id, nextFilter) : undefined;
    if (cachedHistory) {
      setCommits(cachedHistory.history);
      setGraphHistoryRefs(cachedHistory.historyRefs);
      setGraphHistoryHasMore(cachedHistory.historyHasMore);
      setGraphHistoryNextSkip(cachedHistory.historyNextSkip);
      rememberStatus("已恢复最近一次图表结果，正在后台刷新...");
    } else {
      setCommits([]);
      setGraphHistoryRefs([]);
      setGraphHistoryHasMore(false);
      setGraphHistoryNextSkip(0);
      rememberStatus("正在按新的图表引用加载提交...");
    }

    try {
      const [historyPage, historyRefs] = await Promise.all([
        apiClient.getHistoryPage(selectedProject, { filter: nextFilter, ...graphHistoryQuery, skip: 0, limit: HISTORY_PAGE_SIZE }),
        apiClient.getHistoryRefs(selectedProject)
      ]);
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      const history = historyPage.commits;
      setCommits(history);
      setGraphHistoryRefs(historyRefs);
      setGraphHistoryHasMore(historyPage.hasMore);
      setGraphHistoryNextSkip(historyPage.nextSkip);
      if (cacheAllowed) {
        writeGraphHistoryCache(selectedProject, nextFilter, {
          history,
          historyRefs,
          historyHasMore: historyPage.hasMore,
          historyNextSkip: historyPage.nextSkip
        });
      }
      rememberStatus(history.length > 0 ? `已加载 ${history.length} 条提交。` : "当前引用范围没有可显示的提交。");
    } catch (error) {
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }

      if (!cachedHistory) {
        setCommits([]);
        setGraphHistoryRefs([]);
        setGraphHistoryHasMore(false);
        setGraphHistoryNextSkip(0);
      }
      notifyError(error instanceof Error ? error.message : "无法加载图表引用。");
    } finally {
      if (isCurrentProjectLoad(requestId)) {
        setGraphLoading(false);
      }
    }
  }

  async function refreshProjectChanges(project: GitProject) {
    const previousStatus = projectsRef.current.find((item) => item.id === project.id)?.status;
    const previousHistoryRefs = graphHistoryRefsRef.current;
    const [statusResult, worktreeResult, historyRefsResult] = await Promise.allSettled([
      apiClient.getProjectStatus(project),
      apiClient.getWorktree(project),
      apiClient.getHistoryRefs(project)
    ]);
    if (selectedProjectIdRef.current !== project.id) {
      return;
    }

    const refreshErrors: string[] = [];
    if (statusResult.status === "fulfilled") {
      applyProjectStatus(project.id, statusResult.value);
    } else {
      markProjectStatusUnavailable(project.id, statusResult.reason);
      refreshErrors.push(`仓库状态：${errorText(statusResult.reason, "读取失败")}`);
    }

    if (worktreeResult.status === "fulfilled") {
      setWorktree((current) => (worktreeSignature(current) === worktreeSignature(worktreeResult.value) ? current : worktreeResult.value));
    } else {
      setWorktree(emptyWorktree);
      refreshErrors.push(`工作区：${errorText(worktreeResult.reason, "读取失败")}`);
    }

    if (historyRefsResult.status === "rejected") {
      refreshErrors.push(`提交引用：${errorText(historyRefsResult.reason, "读取失败")}`);
    } else if (
      !graphLoadingRef.current &&
      (
        historyStatusSignature(previousStatus) !== historyStatusSignature(statusResult.status === "fulfilled" ? statusResult.value : undefined) ||
        historyRefsSignature(previousHistoryRefs) !== historyRefsSignature(historyRefsResult.value)
      )
    ) {
      try {
        await refreshProjectGraphHistory(project, historyRefsResult.value);
      } catch (error) {
        refreshErrors.push(`提交图：${errorText(error, "刷新失败")}`);
      }
    }

    const refreshToastId = `project-refresh:${project.id}`;
    if (refreshErrors.length > 0) {
      notifyError("项目后台刷新失败", refreshErrors.join("\n"), refreshToastId);
    } else {
      toast.dismiss(refreshToastId);
    }
  }

  async function refreshProjectGraphHistory(project: GitProject, historyRefs: GitHistoryRef[]) {
    const historyFilter = graphHistoryFilterRef.current;
    const historyQuery = graphHistoryQueryRef.current;
    const filterKey = historyFilterCacheKey(historyFilter);
    const queryKey = advancedHistoryQueryCacheKey(historyQuery);
    const historyPage = await apiClient.getHistoryPage(project, {
      filter: historyFilter,
      ...historyQuery,
      skip: 0,
      limit: HISTORY_PAGE_SIZE
    });

    if (
      selectedProjectIdRef.current !== project.id ||
      historyFilterCacheKey(graphHistoryFilterRef.current) !== filterKey ||
      advancedHistoryQueryCacheKey(graphHistoryQueryRef.current) !== queryKey
    ) {
      return;
    }

    const history = historyPage.commits;
    invalidateProjectCaches(project.id);
    if (!hasAdvancedHistoryQuery(historyQuery)) {
      writeGraphHistoryCache(project, historyFilter, {
        history,
        historyRefs,
        historyHasMore: historyPage.hasMore,
        historyNextSkip: historyPage.nextSkip
      });
    }
    graphHistoryRefsRef.current = historyRefs;
    setCommits(history);
    setGraphHistoryRefs(historyRefs);
    setGraphHistoryHasMore(historyPage.hasMore);
    setGraphHistoryNextSkip(historyPage.nextSkip);
    setSelectedCommitHash((currentHash) => currentHash && history.some((commit) => commit.hash === currentHash) ? currentHash : "");
    rememberStatus(history.length > 0 ? `检测到仓库更新，已刷新 ${history.length} 条提交。` : "检测到仓库更新，当前没有可显示的提交。");
  }

  async function reloadProjectWorktree(project: GitProject): Promise<WorktreeState> {
    const [statusResult, worktreeResult] = await Promise.allSettled([
      apiClient.getProjectStatus(project),
      apiClient.getWorktree(project)
    ]);
    if (selectedProjectIdRef.current !== project.id) {
      throw new Error("当前项目已切换，已取消刷新。");
    }

    invalidateProjectCaches(project.id);
    if (statusResult.status === "rejected") {
      markProjectStatusUnavailable(project.id, statusResult.reason);
      setWorktree(emptyWorktree);
      throw statusResult.reason;
    }
    applyProjectStatus(project.id, statusResult.value);
    if (worktreeResult.status === "rejected") {
      setWorktree(emptyWorktree);
      throw worktreeResult.reason;
    }
    setWorktree(worktreeResult.value);
    return worktreeResult.value;
  }

  async function refreshProjectListStatuses(
    projectSnapshot = projectsRef.current,
    isDisposed: () => boolean = () => false,
    mode: "local" | "remote" = "local"
  ) {
    const remoteMode = mode === "remote";
    projectSnapshot = projectSnapshot.filter((project) => remoteMode
      ? Boolean(project.remote) && project.remote?.connectionEnabled !== false && project.id !== selectedProjectIdRef.current
      : !project.remote && project.id !== selectedProjectIdRef.current && gitDependency.status === "ready");
    const busyRef = remoteMode ? remoteProjectListRefreshBusyRef : projectListRefreshBusyRef;
    if (isDisposed() || busyRef.current || projectSnapshot.length === 0) {
      return;
    }

    busyRef.current = true;
    const statusUpdates = new Map<string, GitStatusSummary>();
    const statusErrors = new Map<string, string>();
    const batchSize = remoteMode ? 1 : PROJECT_LIST_STATUS_BATCH_SIZE;
    try {
      for (let index = 0; index < projectSnapshot.length && !isDisposed(); index += batchSize) {
        const batch = projectSnapshot.slice(index, index + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (project): Promise<ProjectStatusRefresh> => ({
            projectId: project.id,
            status: await apiClient.getProjectStatus(project)
          }))
        );

        for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
          const result = results[resultIndex];
          const project = batch[resultIndex];
          if (result.status === "fulfilled") {
            statusUpdates.set(result.value.projectId, result.value.status);
          } else {
            statusErrors.set(project.id, errorText(result.reason, "无法读取仓库状态"));
          }
        }
      }

      if (isDisposed() || (statusUpdates.size === 0 && statusErrors.size === 0)) {
        return;
      }

      setProjects((current) => {
        let changed = false;
        const nextProjects = current.map((project) => {
          if (project.remote?.connectionEnabled === false) {
            return project;
          }
          const nextStatus = statusUpdates.get(project.id);
          const statusError = statusErrors.get(project.id);
          if (statusError) {
            if (!project.status && project.statusError === statusError) {
              return project;
            }

            changed = true;
            return { ...project, status: undefined, statusError };
          }

          if (!nextStatus || (statusSignature(project.status) === statusSignature(nextStatus) && !project.statusError)) {
            return project;
          }

          changed = true;
          return { ...project, status: nextStatus, statusError: undefined };
        });

        return changed ? nextProjects : current;
      });
    } finally {
      busyRef.current = false;
    }
  }

  async function handleAdvancedHistoryQueryChange(query: AdvancedHistoryQuery) {
    setGraphHistoryQuery(query);
    setSelectedCommitHash("");
    setCommits([]);
    setGraphHistoryHasMore(false);
    setGraphHistoryNextSkip(0);
    setGraphHistoryLoadingMore(false);
    if (!selectedProject) {
      return;
    }

    const requestId = nextProjectLoadRequestId();
    setGraphLoading(true);
    rememberStatus("正在按高级条件查询提交历史...");
    try {
      const historyPage = await apiClient.getHistoryPage(selectedProject, {
        filter: graphHistoryFilter,
        ...query,
        skip: 0,
        limit: HISTORY_PAGE_SIZE
      });
      if (!isCurrentProjectLoad(requestId)) {
        return;
      }
      setCommits(historyPage.commits);
      setGraphHistoryHasMore(historyPage.hasMore);
      setGraphHistoryNextSkip(historyPage.nextSkip);
      rememberStatus(historyPage.commits.length > 0 ? `已找到 ${historyPage.commits.length} 条提交。` : "没有符合条件的提交。");
    } catch (error) {
      if (isCurrentProjectLoad(requestId)) {
        notifyError(error instanceof Error ? error.message : "高级历史查询失败");
      }
    } finally {
      if (isCurrentProjectLoad(requestId)) {
        setGraphLoading(false);
      }
    }
  }

  async function handleLoadMoreHistory() {
    if (!selectedProject || !graphHistoryHasMore || graphHistoryLoadingMore) {
      return;
    }
    const requestId = projectLoadRequestRef.current;
    const projectId = selectedProject.id;
    const expectedSkip = graphHistoryNextSkip;
    setGraphHistoryLoadingMore(true);
    try {
      const historyPage = await apiClient.getHistoryPage(selectedProject, {
        filter: graphHistoryFilter,
        ...graphHistoryQuery,
        skip: expectedSkip,
        limit: HISTORY_PAGE_SIZE
      });
      if (!isCurrentProjectLoad(requestId) || selectedProjectIdRef.current !== projectId) {
        return;
      }
      setCommits((current) => {
        const knownHashes = new Set(current.map((commit) => commit.hash));
        return [...current, ...historyPage.commits.filter((commit) => !knownHashes.has(commit.hash))];
      });
      setGraphHistoryHasMore(historyPage.hasMore);
      setGraphHistoryNextSkip(historyPage.nextSkip);
      rememberStatus(`已继续加载 ${historyPage.commits.length} 条提交。`);
    } catch (error) {
      if (isCurrentProjectLoad(requestId) && selectedProjectIdRef.current === projectId) {
        notifyError(error instanceof Error ? error.message : "无法继续加载提交历史");
      }
    } finally {
      if (isCurrentProjectLoad(requestId) && selectedProjectIdRef.current === projectId) {
        setGraphHistoryLoadingMore(false);
      }
    }
  }

  function applyUiPreferences(preferences: UiPreferences) {
    const rightPanelWidth = clamp(preferences.rightPanelWidth, MIN_SOURCE_CONTROL_WIDTH, MAX_SOURCE_CONTROL_WIDTH);
    const normalizedPreferences = rightPanelWidth === preferences.rightPanelWidth
      ? preferences
      : { ...preferences, rightPanelWidth };
    setUiPreferences(normalizedPreferences);
    applyThemeMode(preferences.theme);
    setSidebarWidth(preferences.sidebarWidth);
    setDetailWidth(rightPanelWidth);
    setConsoleHeight(preferences.consoleHeight);
    setConsoleOpen(preferences.bottomConsoleVisible);
    restoreConsoleHeightRef.current = preferences.consoleHeight;
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

    if (tab.sourceType === "commit" && tab.commitHash) {
      const commit = commits.find((item) => item.hash === tab.commitHash);
      if (!commit) {
        const message = "当前提交已不在已加载的历史记录中，请刷新图表后重试。";
        setWorktreeTabs((current) =>
          current.map((item) => (item.id === tab.id ? { ...item, loadError: message, loading: false } : item))
        );
        notifyError(message);
        return;
      }

      await openCommitFile(commit, tab.file, tab.pinned, true);
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

      try {
        const status = await apiClient.getProjectStatus(selectedProject);
        if (status?.operationState === "merge" && !status.hasConflicts) {
          notifyInfo("所有冲突文件已解决", "检查暂存结果后可以继续合并。");
        }
      } catch (error) {
        notifyError(errorText(error, "冲突已解决，但无法读取最新合并状态。"));
      }
      return true;
    } catch (error) {
      notifyError(errorText(error, "解决冲突失败"), undefined, toastId);
      return false;
    }
  }

  async function openCommitFile(commit: CommitNode, file: ChangedFile, pinned: boolean, forceReload = false) {
    if (!selectedProject) {
      return;
    }

    const project = selectedProject;
    const tabId = commitFileTabId(commit.hash, file.path);
    const cacheKey = commitFileCacheKey(project.id, commit.hash, file.path);
    cancelActiveCommitFileRead(cacheKey);

    const existingTab = worktreeTabs.find((tab) => tab.id === tabId);
    if (existingTab && !existingTab.loadError && !forceReload) {
      if (pinned && !existingTab.pinned) {
        setWorktreeTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, pinned: true } : tab)));
      }
      if (pinned && activeCommitFileReadRef.current?.cacheKey === cacheKey) {
        activeCommitFileReadRef.current = undefined;
      }
      setActiveWorktreeTabId(tabId);
      return;
    }

    if (!forceReload) {
      const cached = commitFileCacheRef.current.get(cacheKey);
      if (cached) {
        setBoundedCache(commitFileCacheRef.current, cacheKey, cached, COMMIT_FILE_CACHE_MAX_ENTRIES);
        const cachedTab: WorktreeEditorTab = {
          id: tabId,
          file: cached.file,
          diffLines: cached.diffLines,
          preview: cached.preview,
          pinned,
          sourceType: "commit",
          commitHash: commit.hash,
          sourceLabel: `提交 ${commit.shortHash}`,
          subtitle: commit.subject,
          loadError: undefined,
          loading: false
        };
        setWorktreeTabs((current) => upsertWorktreeTab(current, cachedTab, pinned));
        setActiveWorktreeTabId(tabId);
        rememberStatus(`已恢复提交 ${commit.shortHash} 的 ${file.path}`);
        return;
      }
    }

    const pendingTab: WorktreeEditorTab = {
      id: tabId,
      file,
      diffLines: [],
      pinned,
      sourceType: "commit",
      commitHash: commit.hash,
      sourceLabel: `提交 ${commit.shortHash}`,
      subtitle: commit.subject,
      loadError: undefined,
      loading: true
    };
    setWorktreeTabs((current) => upsertWorktreeTab(current, pendingTab, pinned));
    setActiveWorktreeTabId(tabId);

    let loadPromise = !forceReload ? pendingCommitFileLoadsRef.current.get(cacheKey) : undefined;
    if (!loadPromise) {
      const readRequest = { cacheKey, requestId: `filediff-${crypto.randomUUID()}`, cancelled: false };
      loadPromise = (async (): Promise<CommitFileCacheEntry> => {
        const preview = await apiClient.getCommitFilePreview(project, commit.hash, file);
        if (readRequest.cancelled) {
          throw new Error("文件对比加载已取消。");
        }
        if (preview) {
          return { file, diffLines: [], preview };
        }

        const diffLines = await apiClient.getCommitDiff(project, commit.hash, file.path, commit.parents[0] ?? null, readRequest.requestId);
        return { file, diffLines, preview: null };
      })();
      if (!forceReload) {
        pendingCommitFileLoadsRef.current.set(cacheKey, loadPromise);
      }
      if (!pinned) {
        activeCommitFileReadRef.current = readRequest;
      }
    }

    try {
      const loaded = await loadPromise;
      setBoundedCache(commitFileCacheRef.current, cacheKey, loaded, COMMIT_FILE_CACHE_MAX_ENTRIES);
      if (selectedProjectIdRef.current !== project.id) {
        return;
      }
      setWorktreeTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? { ...tab, file: loaded.file, diffLines: loaded.diffLines, preview: loaded.preview, loadError: undefined, loading: false, pinned: tab.pinned || pinned }
            : tab
        )
      );
      rememberStatus(loaded.preview
        ? `正在查看提交 ${commit.shortHash} 的媒体 ${file.path}`
        : `正在查看提交 ${commit.shortHash} 的 ${file.path}`);
    } catch (error) {
      if (selectedProjectIdRef.current !== project.id) {
        return;
      }
      const message = errorText(error, "加载提交文件失败。");
      if (message.includes("文件对比加载已取消")) {
        return;
      }
      setWorktreeTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, loadError: message, loading: false } : tab))
      );
      notifyError(message);
    } finally {
      if (pendingCommitFileLoadsRef.current.get(cacheKey) === loadPromise) {
        pendingCommitFileLoadsRef.current.delete(cacheKey);
      }
      if (activeCommitFileReadRef.current?.cacheKey === cacheKey) {
        activeCommitFileReadRef.current = undefined;
      }
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
    cancelActiveCommitFileRead();
    setWorktreeTabs([]);
    setActiveWorktreeTabId(null);
  }

  function cancelActiveCommitFileRead(exceptCacheKey?: string) {
    const activeRead = activeCommitFileReadRef.current;
    if (!activeRead || activeRead.cacheKey === exceptCacheKey) {
      return;
    }

    activeRead.cancelled = true;
    activeCommitFileReadRef.current = undefined;
    pendingCommitFileLoadsRef.current.delete(activeRead.cacheKey);
    void apiClient.cancelGitReadRequest(activeRead.requestId);
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

  async function handleSetProjectGroup(projectId: string, groupId?: string) {
    const currentProjects = projectsRef.current;
    const project = currentProjects.find((item) => item.id === projectId);
    if (!project || project.groupId === groupId) {
      return;
    }

    const previousGroupId = project.groupId;
    const nextProjects = currentProjects.map((item) => item.id === projectId ? { ...item, groupId } : item);
    projectsRef.current = nextProjects;
    setProjects(nextProjects);

    try {
      const savedProject = await apiClient.setProjectGroup(projectId, groupId);
      const latestProjects = projectsRef.current;
      const latestProject = latestProjects.find((item) => item.id === projectId) ?? project;
      if (latestProject.groupId !== groupId) {
        return;
      }

      const mergedProject: GitProject = {
        ...latestProject,
        ...savedProject,
        groupId,
        status: latestProject.status,
        statusError: latestProject.statusError
      };
      const savedProjects = latestProjects.map((item) => item.id === projectId ? mergedProject : item);
      projectsRef.current = savedProjects;
      setProjects(savedProjects);
      const groupName = groupId ? projectLibrary.groups.find((group) => group.id === groupId)?.name ?? "指定分组" : "未分组";
      notifySuccess("已更新项目分组", `${project.name} → ${groupName}`);
    } catch (error) {
      const latestProjects = projectsRef.current;
      const latestProject = latestProjects.find((item) => item.id === projectId);
      if (latestProject?.groupId !== groupId) {
        return;
      }

      const rolledBackProjects = latestProjects.map((item) => item.id === projectId ? { ...item, groupId: previousGroupId } : item);
      projectsRef.current = rolledBackProjects;
      setProjects(rolledBackProjects);
      notifyError(error instanceof Error ? error.message : "保存项目分组失败");
    }
  }

  async function handleRenameProject(projectId: string, name: string) {
    const currentProject = projectsRef.current.find((project) => project.id === projectId);
    if (!currentProject || currentProject.name === name) {
      return;
    }

    try {
      const savedProject = await apiClient.renameProject(projectId, name);
      const nextProjects = projectsRef.current.map((project) => project.id === projectId ? {
        ...project,
        ...savedProject,
        status: project.status,
        statusError: project.statusError
      } : project);
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      notifySuccess("已重命名项目", `${currentProject.name} → ${savedProject.name}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "重命名项目失败");
      throw error;
    }
  }

  async function handleRenameProjectGroup(groupId: string, name: string) {
    const currentGroup = projectLibrary.groups.find((group) => group.id === groupId);
    if (!currentGroup || currentGroup.name === name) {
      return;
    }

    try {
      const savedGroup = await apiClient.renameProjectGroup(groupId, name);
      setProjectLibrary((current) => ({
        ...current,
        groups: current.groups.map((group) => group.id === groupId ? savedGroup : group)
      }));
      notifySuccess("已重命名项目分组", `${currentGroup.name} → ${savedGroup.name}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "重命名项目分组失败");
      throw error;
    }
  }

  async function handleSetRemoteProjectConnectionEnabled(projectId: string, enabled: boolean) {
    const currentProject = projectsRef.current.find((project) => project.id === projectId);
    if (!currentProject?.remote) {
      return;
    }

    try {
      const savedProject = await apiClient.setRemoteProjectConnectionEnabled(projectId, enabled);
      const latestProject = projectsRef.current.find((project) => project.id === projectId) ?? currentProject;
      const nextProject: GitProject = {
        ...latestProject,
        ...savedProject,
        remote: {
          ...latestProject.remote!,
          ...savedProject.remote!,
          connectionEnabled: enabled
        },
        status: enabled ? latestProject.status : undefined,
        statusError: undefined
      };
      const nextProjects = projectsRef.current.map((project) => project.id === projectId ? nextProject : project);
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      invalidateProjectCaches(projectId);

      if (!enabled) {
        nextProjectLoadRequestId();
        rememberStatus(`${nextProject.name} 的远程连接已暂停`);
        notifySuccess("已暂停远程连接", "后台状态刷新和 SSH 终端已停止。");
        return;
      }

      rememberStatus(`${nextProject.name} 的远程连接已开启`);
      notifySuccess("已开启远程连接", "将重新读取远程仓库状态。");
      if (selectedProjectIdRef.current !== projectId) {
        void refreshProjectListStatuses([nextProject], undefined, "remote");
      }
    } catch (error) {
      notifyError(error instanceof Error ? cleanElectronError(error.message) : "保存远程连接状态失败");
    }
  }

  async function handleRemoveProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "移除项目记录",
      description: project.remote
        ? "只会移除连接记录，不会删除服务器上的仓库或文件。"
        : "只会从项目列表移除，不会删除本地文件。",
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

    const label = action === "pull" ? `拉取（${pullStrategyLabel(uiPreferences.pullStrategy)}）` : { fetch: "抓取", push: "推送" }[action];
    const toastId = notifyLoading(`正在${label}...`);

    const result = action === "pull" ? await apiClient.pull(project, uiPreferences.pullStrategy) : await apiClient[action](project);
    const needsFirstPublish = action === "push"
      && !result.ok
      && !project.status?.upstream
      && (
        result.stderr.includes("no default push remote")
        || result.messageZh?.includes("无法确定默认远程仓库")
      );
    if (needsFirstPublish) {
      notifyInfo("首次推送只需填写远程仓库地址", "软件会自动配置 origin，并关联当前分支。", toastId);
      setRepositoryCenterInitialTab("remotes");
      setRepositoryCenterOpen(true);
      return;
    }
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

    const pullResult = await apiClient.pull(project, uiPreferences.pullStrategy);
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

    const confirmed = await requestDestructiveConfirm({
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
    try {
      const branches = await apiClient.getBranches(project);
      if (branches.length === 0) {
        notifyInfo("没有可切换的分支");
        return;
      }

      setBranchDialog({ mode: "switch", project, branches, query: "" });
      rememberStatus(`已加载 ${branches.length} 个分支。`);
    } catch (error) {
      notifyError(errorText(error, "读取分支列表失败"));
    }
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
    if (branches.length === 0) {
      notifyInfo("没有可删除的本地分支");
      return;
    }

    setBranchDialog({ mode: "delete", project, branches, query: "" });
  }

  async function handleOpenWorktreeFile(tab: WorktreeEditorTab) {
    if (!selectedProject || selectedProject.remote || !window.gitUI) {
      return;
    }
    try {
      await apiClient.openPath(absoluteFilePath(selectedProject.path, tab.file.path));
    } catch (error) {
      notifyError(errorText(error, "无法使用系统默认应用打开文件。"));
    }
  }

  async function handleRevealWorktreeFile(tab: WorktreeEditorTab) {
    if (!selectedProject || selectedProject.remote || !window.gitUI) {
      return;
    }
    try {
      await apiClient.revealPath(absoluteFilePath(selectedProject.path, tab.file.path));
    } catch (error) {
      notifyError(errorText(error, "无法在文件资源管理器中定位文件。"));
    }
  }

  async function submitDeleteBranch(target: BranchInfo) {
    if (!branchDialog || branchDialog.mode !== "delete") {
      return;
    }

    if (
      !(await requestDestructiveConfirm({
        title: "删除本地分支",
        description: "只会删除本地分支，不会删除远程分支。",
        detail: target.name,
        confirmLabel: "删除",
        tone: "danger"
      }))
    ) {
      return;
    }

    setBranchDialogBusy(true);
    const toastId = notifyLoading(`正在删除分支 ${target.name}...`);
    try {
      const result = await apiClient.deleteBranch(branchDialog.project, target.name, false);
      if (!notifyGitResult(result, `已删除本地分支：${target.name}`, "删除分支失败，请查看原始 Git 输出。", toastId)) {
        return;
      }

      const project = branchDialog.project;
      setBranchDialog(null);
      await loadProjectData(project);
    } finally {
      setBranchDialogBusy(false);
    }
  }

  function openAmendLastCommitDialog() {
    if (!requireGitReady("修改提交信息")) {
      return;
    }

    if (!selectedProject) {
      notifyInfo("请先选择一个 Git 项目");
      return;
    }

    const commit = findCurrentHeadCommit(commits);
    if (!commit) {
      notifyInfo("当前图表未能精确认定 HEAD，请切换到包含当前提交的引用范围后重试");
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
    const currentHeadCommit = findCurrentHeadCommit(commits);
    if (selectedProject?.id !== project.id || currentHeadCommit?.hash !== commitMessageDialog.commit.hash) {
      notifyInfo("当前 HEAD 已变化或不在图表范围内，请刷新后重试");
      return;
    }

    if (isCommitHistoryPublished(project)) {
      const confirmed = await requestDestructiveConfirm({
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

    const commitToRestore = findCurrentHeadCommit(commits);
    if (!commitToRestore) {
      notifyInfo("当前图表未能精确认定 HEAD，请切换到包含当前提交的引用范围后重试");
      return;
    }
    const modeText = mode === "soft" ? "保留更改并保持暂存" : "保留更改但取消暂存";
    const publishedWarning = isCommitHistoryPublished(selectedProject) ? "\n\n注意：上次提交可能已经同步到远程，撤销会改写历史。" : "";
    if (
      !(await requestDestructiveConfirm({
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
    if (!project.status || !isCurrentHeadCommit(commit)) {
      return false;
    }

    if (!project.status?.upstream) {
      return true;
    }

    return (project.status.ahead ?? 0) > 0;
  }

  function isCurrentHeadCommit(commit: CommitNode): boolean {
    return commit.refs.some((ref) => ref.type === "head");
  }

  function restoreCommitMessageDraft(commit: CommitNode) {
    if (!selectedProject) {
      return;
    }

    const draft = commitMessageDraft(commit);
    const value = [draft.subject, draft.body].filter(Boolean).join("\n\n");
    if (!value.trim()) {
      return;
    }

    setChangesPanelOpen(true);
    setCommitMessageDraftRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      projectId: selectedProject.id,
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
      const currentHeadCommit = findCurrentHeadCommit(commits);
      if (currentHeadCommit?.hash !== commit.hash) {
        notifyInfo("当前仅支持修改由 HEAD 精确认定的提交信息");
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
    const currentHeadCommit = findCurrentHeadCommit(commits);
    if (!currentHeadCommit || !commits.some((item) => item.hash === commit.hash)) {
      notifyInfo("当前图表未能精确认定 HEAD，无法执行 reset");
      return;
    }

    const undoHead = currentHeadCommit.hash === commit.hash;
    const undoRootCommit = undoHead && commit.parents.length === 0;
    const resetTarget = undoHead ? commit.parents[0] : commit.hash;

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
      !(await requestDestructiveConfirm({
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
      const confirmed = await requestDestructiveConfirm({
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
      result = await withTimeout(
        undoRootCommit
          ? apiClient.resetLastCommit(project, mode)
          : apiClient.resetToCommit(project, resetTarget!, mode),
        RESET_OPERATION_TIMEOUT_MS,
        "重置分支超时，请确认仓库未被其它 Git 进程锁定后重试"
      );
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

    const result = await apiClient.stageFile(selectedProject, file);
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

    const result = await apiClient.unstageFile(selectedProject, file);
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

    const confirmed = await requestDestructiveConfirm({
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
    const confirmed = await requestDestructiveConfirm({
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

  async function handleIgnoreFile(file: ChangedFile) {
    if (!selectedProject) {
      return;
    }

    if (file.status !== "untracked") {
      notifyInfo("只有未跟踪文件可以直接忽略", "已被 Git 跟踪的文件需要先停止跟踪，.gitignore 才会生效。");
      return;
    }

    if (!requireGitReady("添加忽略规则")) {
      return;
    }

    const project = selectedProject;
    const rule = gitIgnoreRuleForPath(file.path);
    if (!rule || rule === "/.gitignore") {
      notifyInfo("不能把 .gitignore 自身加入忽略规则");
      return;
    }

    const toastId = notifyLoading(`正在添加忽略规则：${file.path}...`);
    try {
      const document = await apiClient.readGitIgnore(project);
      const nextContent = appendGitIgnoreRule(document.content, rule);
      await apiClient.writeGitIgnore(project, nextContent, document.revision);
      notifySuccess("已添加到 .gitignore", rule, toastId);
    } catch (error) {
      notifyError(errorText(error, "添加忽略规则失败。"), undefined, toastId);
      return;
    }

    if (selectedProjectIdRef.current !== project.id) {
      return;
    }

    clearWorktreeEditorTabs();
    try {
      await reloadProjectWorktree(project);
    } catch (error) {
      notifyError("忽略规则已保存，但工作区刷新失败", errorText(error, "请手动刷新工作区。"));
    }
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
      if (!findCurrentHeadCommit(commits)) {
        notifyInfo("当前图表未能精确认定 HEAD，无法执行 amend");
        return false;
      }

      const confirmed = await requestDestructiveConfirm({
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

  function applyThemeMode(mode: ThemeMode) {
    window.localStorage.setItem("git-ui-pro-theme", mode);
    setThemeModeState(mode);
    setResolvedTheme(resolveTheme(mode));
  }

  function selectThemeMode(nextTheme: "light" | "dark") {
    const previousTheme = uiPreferences.theme;
    applyThemeMode(nextTheme);
    persistUiPreferences({ theme: nextTheme }, () => applyThemeMode(previousTheme));
  }

  function setConsoleVisibility(visible: boolean) {
    const previousVisible = consoleOpen;
    setConsoleOpen(visible);
    persistUiPreferences({ bottomConsoleVisible: visible }, () => setConsoleOpen(previousVisible));
  }

  function persistUiPreferences(update: Partial<UiPreferences>, rollback: () => void) {
    const previousValues = Object.fromEntries(
      Object.keys(update).map((key) => [key, uiPreferences[key as keyof UiPreferences]])
    ) as Partial<UiPreferences>;
    setUiPreferences((current) => ({ ...current, ...update }));
    if (!window.gitUI) {
      return;
    }
    void apiClient.updateUiPreferences(update).then(setUiPreferences).catch((error) => {
      setUiPreferences((current) => ({ ...current, ...previousValues }));
      rollback();
      notifyError(error instanceof Error ? error.message : "无法保存界面偏好");
    });
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
      setConsoleVisibility(true);
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

  function beginResize(target: ResizeTarget, event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startDetailWidth = detailWidth;
    const startSourcePaneHeight = sourcePaneHeight;
    const startConsoleHeight = consoleHeight;
    let finalSidebarWidth = startSidebarWidth;
    let finalDetailWidth = startDetailWidth;
    let finalConsoleHeight = startConsoleHeight;

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      if (target === "sidebar") {
        const delta = uiPreferences.sidebarPosition === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        finalSidebarWidth = clamp(startSidebarWidth + delta, 180, 420);
        setSidebarWidth(finalSidebarWidth);
      }

      if (target === "detail") {
        finalDetailWidth = clamp(startDetailWidth + moveEvent.clientX - startX, MIN_SOURCE_CONTROL_WIDTH, MAX_SOURCE_CONTROL_WIDTH);
        setDetailWidth(finalDetailWidth);
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
          finalConsoleHeight = nextConsoleHeight;
        }
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!window.gitUI || target === "sourceSplit") {
        return;
      }
      const update = target === "sidebar"
        ? { sidebarWidth: finalSidebarWidth }
        : target === "detail"
          ? { rightPanelWidth: finalDetailWidth }
          : { consoleHeight: finalConsoleHeight };
      void apiClient.updateUiPreferences(update).then(setUiPreferences).catch((error) => {
        notifyError(error instanceof Error ? error.message : "无法保存面板尺寸");
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const layoutStyle = {
    "--sidebar-width": leftCollapsed ? "0px" : `${sidebarWidth}px`,
    "--detail-width": rightCollapsed ? "0px" : `${detailWidth}px`,
    "--scm-pane-height": `${sourcePaneHeight}px`,
    "--console-height": `${consoleHeight}px`,
    "--ui-font-size": `${uiPreferences.fontSize}px`,
    "--app-font": uiPreferences.fontFamily === "monospace" ? "var(--mono-font)" : uiPreferences.fontFamily
  } as CSSProperties;
  const detailStackStyle = {
    gridTemplateRows: consoleOpen
      ? `minmax(0, max(0px, calc(100% - ${consoleHeight}px - 10px))) 10px minmax(0, ${consoleHeight}px)`
      : "minmax(0, 1fr)"
  } as CSSProperties;

  return (
    <div
      className={`app-shell theme-${resolvedTheme} density-${uiPreferences.density} sidebar-${uiPreferences.sidebarPosition} ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""} ${
        consoleOpen ? "console-open" : ""
      }`}
      style={layoutStyle}
    >
      <AppChrome
        onCommand={runAppCommand}
        sidebarCollapsed={leftCollapsed}
        currentProjectName={selectedProject?.name}
        theme={resolvedTheme}
        onToggleSidebar={() => setLeftCollapsed((collapsed) => !collapsed)}
        onThemeChange={selectThemeMode}
        onOpenRepositoryCenter={() => {
          setRepositoryCenterInitialTab(selectedProject ? "recovery" : "projects");
          setRepositoryCenterOpen(true);
        }}
      />
      {!leftCollapsed ? (
        <ProjectRail
          projects={projects}
          groups={projectLibrary.groups}
          selectedProjectId={selectedProject?.id ?? null}
          onSelectProject={selectProject}
          onAddProject={handleAddProject}
          onAddRemoteProject={() => setRemoteProjectDialogOpen(true)}
          onScanProjects={handleScanProjects}
          onRemoveProject={handleRemoveProject}
          onReorderProjects={(projectIds) => void handleReorderProjects(projectIds)}
          onToggleProjectPinned={(projectId) => void handleToggleProjectPinned(projectId)}
          onSetProjectGroup={handleSetProjectGroup}
          onRenameProject={handleRenameProject}
          onRenameGroup={handleRenameProjectGroup}
          onSetRemoteConnectionEnabled={handleSetRemoteProjectConnectionEnabled}
          onSwitchBranch={(project) => void switchBranchFromToolbar(project)}
        />
      ) : null}

      {!leftCollapsed ? <div className="resize-handle sidebar-resize" onMouseDown={(event) => beginResize("sidebar", event)} /> : null}

      <main className="workspace-shell">
        {!selectedProjectGitReady ? (
          <section className="main-grid git-dependency-grid">
            <GitDependencyNotice
              state={gitDependency}
              onDownload={openGitDownloadPage}
              onRecheck={() => void handleRecheckGit()}
            />
          </section>
        ) : (
          <section className={`main-grid ${selectedRemoteConnectionPaused ? "remote-connection-paused-grid" : ""}`}>
            {selectedRemoteConnectionPaused && selectedProject ? (
              <RemoteConnectionPausedNotice
                project={selectedProject}
                onEnable={() => handleSetRemoteProjectConnectionEnabled(selectedProject.id, true)}
              />
            ) : null}
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
                onIgnoreFile={handleIgnoreFile}
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
                hasCommits={Boolean(findCurrentHeadCommit(commits))}
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
                advancedQuery={graphHistoryQuery}
                onAdvancedQueryChange={(query) => void handleAdvancedHistoryQueryChange(query)}
                hasMore={graphHistoryHasMore}
                loadingMore={graphHistoryLoadingMore}
                onLoadMore={() => void handleLoadMoreHistory()}
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
                  desktopFileActionsEnabled={Boolean(window.gitUI && selectedProject && !selectedProject.remote)}
                  onSelectTab={handleSelectWorktreeTab}
                  onCloseTab={handleCloseWorktreeTab}
                  onPinTab={handlePinWorktreeTab}
                  onOpenFile={(tab) => void handleOpenWorktreeFile(tab)}
                  onRevealFile={(tab) => void handleRevealWorktreeFile(tab)}
                  onResolveConflict={handleResolveConflict}
                  onRetryLoad={handleRetryWorktreeLoad}
                  diffViewMode={uiPreferences.diffViewMode}
                  diffWrap={uiPreferences.diffWrap}
                />
                <div className="console-resize" hidden={!consoleOpen} onMouseDown={(event) => beginResize("console", event)} />
                <ConsolePanel
                  project={selectedProject}
                  disabledProjectIds={disabledRemoteProjectIds}
                  theme={resolvedTheme}
                  visible={consoleOpen && !selectedRemoteConnectionPaused}
                  maximized={consoleMaximized}
                  onToggleMaximized={toggleConsoleMaximized}
                  onHide={() => setConsoleVisibility(false)}
                  onConfirmCloseTabs={(count) =>
                    requestConfirm({
                      title: "关闭全部终端",
                      description: "正在运行的终端进程会被结束。",
                      detail: `${count} 个终端标签`,
                      confirmLabel: "关闭终端",
                      tone: "warning"
                    })
                  }
                  onConfirmClearHistory={(count) =>
                    requestConfirm({
                      title: "清空命令历史",
                      description: "已保存的终端命令历史会从本机删除，此操作无法撤销。",
                      detail: `${count} 条命令`,
                      confirmLabel: "清空历史",
                      tone: "danger"
                    })
                  }
                />
                {!consoleOpen ? (
                  <button type="button" className="console-dock-toggle" aria-label="打开控制台" onClick={() => setConsoleVisibility(true)}>
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
        <RepositoryCenterContainer
          open={repositoryCenterOpen}
          project={selectedProject}
          projects={projects}
          initialTab={repositoryCenterInitialTab}
          onClose={() => setRepositoryCenterOpen(false)}
          onOpenProject={(projectId, openedProject) => {
            selectProject(projectId, openedProject);
            setRepositoryCenterOpen(false);
          }}
          onProjectsChange={(nextProjects) => setProjects(orderProjectsWithPinnedFirst(nextProjects))}
          onLibraryChange={setProjectLibrary}
          onRepositoryChange={() => (selectedProject && selectedProject.remote?.connectionEnabled !== false ? loadProjectData(selectedProject) : Promise.resolve())}
          onPreferencesChange={applyUiPreferences}
        />
        <GitOperationCenter
          operations={gitOperations}
          onCancel={(operationId) => void cancelGitOperation(operationId)}
          onDismiss={dismissGitOperation}
        />
        <Toaster
          position="top-center"
          theme={resolvedTheme}
          offset={{ top: 44 }}
          mobileOffset={{ top: 44 }}
          expand
          visibleToasts={5}
          toastOptions={{ duration: 2000 }}
        />
        {remoteProjectDialogOpen ? (
          <RemoteProjectDialog
            onClose={() => setRemoteProjectDialogOpen(false)}
            onChooseIdentityFile={() => apiClient.chooseIdentityFile()}
            onInspectHost={(host, port) => apiClient.inspectSshHost(host, port)}
            onTrustHost={(token, replaceExisting) => apiClient.trustSshHost(token, replaceExisting)}
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
              setBranchDialog((current) => (current?.mode === "switch" || current?.mode === "delete" || current?.mode === "merge" ? { ...current, query } : current))
            }
            onMergeStrategyChange={(strategy) =>
              setBranchDialog((current) => (current?.mode === "merge" ? { ...current, strategy } : current))
            }
            onCreate={submitCreateBranch}
            onSwitch={submitSwitchBranch}
            onDelete={submitDeleteBranch}
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

function RemoteConnectionPausedNotice({ project, onEnable }: { project: GitProject; onEnable: () => Promise<void> }) {
  const [enabling, setEnabling] = useState(false);

  async function enableConnection() {
    if (enabling) {
      return;
    }
    setEnabling(true);
    try {
      await onEnable();
    } finally {
      setEnabling(false);
    }
  }

  return (
    <section className="git-dependency-notice remote-connection-notice" aria-label="远程连接已暂停">
      <div className="git-dependency-card remote-connection-card">
        <div className="git-dependency-icon remote-connection-icon" aria-hidden="true">
          <ServerOff size={24} />
        </div>
        <div className="git-dependency-content">
          <span className="git-dependency-kicker">远程资源控制</span>
          <h2>远程连接已暂停</h2>
          <p>软件不会连接 {project.name}，也不会在后台轮询服务器。连接设置和项目记录仍保留在本机。</p>

          <div className="git-dependency-steps" aria-label="已暂停的后台任务">
            <div>
              <span>1</span>
              <strong>停止状态刷新</strong>
              <p>不再周期性探测提交、分支和工作区状态。</p>
            </div>
            <div>
              <span>2</span>
              <strong>结束 SSH 终端</strong>
              <p>该项目已有会话会关闭，也不会自动创建新会话。</p>
            </div>
          </div>

          <div className="remote-connection-address">{remoteProjectAddress(project)}</div>
          <div className="git-dependency-actions">
            <button type="button" className="git-dependency-primary" onClick={() => void enableConnection()} disabled={enabling}>
              {enabling ? <RefreshCw size={15} className="spin" /> : <Power size={15} />}
              {enabling ? "正在开启" : "开启远程连接"}
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
  onDelete,
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
  onDelete: (branch: BranchInfo) => void;
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
    state.mode === "switch" || state.mode === "delete" || state.mode === "merge"
      ? state.branches.filter((branch) => `${branch.name} ${branch.fullName}`.toLowerCase().includes(state.query.trim().toLowerCase()))
      : [];
  const dialogTitle = state.mode === "create" ? "新建分支" : state.mode === "switch" ? "切换分支" : state.mode === "delete" ? "删除分支" : "合并分支";

  return (
    <div className="branch-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`branch-dialog ${state.mode === "merge" ? "merge-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={dialogTitle} onMouseDown={(event) => event.stopPropagation()}>
        <header className="branch-dialog-header">
          <span className="branch-dialog-title">
            {state.mode === "create" ? <Plus size={15} /> : state.mode === "merge" ? <GitMerge size={15} /> : state.mode === "delete" ? <Trash2 size={15} /> : <GitBranch size={15} />}
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
              <input value={state.query} autoFocus onChange={(event) => onBranchQueryChange(event.target.value)} placeholder={state.mode === "merge" ? "搜索目标分支" : state.mode === "delete" ? "搜索要删除的本地分支" : "搜索分支"} disabled={busy} />
            </label>
            <div className="branch-list" role="list">
              {filteredBranches.map((branch) => (
                <button
                  type="button"
                  className={`branch-list-item ${branch.current ? "current" : ""} ${state.mode === "merge" && state.preview?.targetBranch === branch.name ? "selected" : ""}`}
                  key={`${branch.type}-${branch.fullName}`}
                  onClick={() => (state.mode === "merge" ? onMergeTarget(branch) : state.mode === "delete" ? onDelete(branch) : onSwitch(branch))}
                  disabled={busy}
                >
                  <span>
                    <GitBranch size={13} />
                    {branch.name}
                  </span>
                  <small>{state.mode === "delete" ? "删除" : branch.upstreamMissing ? `${branch.current ? "当前 · " : ""}上游已失效` : state.mode === "merge" && state.preview?.targetBranch === branch.name ? "目标" : branch.current ? "当前" : branch.type === "remote" ? "远程" : branch.upstream ? `跟踪 ${branch.upstream}` : "本地"}</small>
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
    project.remote.username ?? "",
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

function findCurrentHeadCommit(commits: CommitNode[]): CommitNode | undefined {
  const headCommits = commits.filter((commit) => commit.refs.some((ref) => ref.type === "head"));
  return headCommits.length === 1 ? headCommits[0] : undefined;
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

function gitIgnoreRuleForPath(filePath: string): string {
  const normalizedPath = filePath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalizedPath) {
    return "";
  }

  const escapedPath = Array.from(normalizedPath, (character) =>
    "\\*?[] ".includes(character) ? `\\${character}` : character
  ).join("");
  return `/${escapedPath}`;
}

function appendGitIgnoreRule(content: string, rule: string): string {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.length > 0 && !content.endsWith("\n") && !content.endsWith("\r") ? lineEnding : "";
  return `${content}${separator}${rule}${lineEnding}`;
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
    status.headHash ?? "",
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

function historyStatusSignature(status: GitProject["status"]): string {
  if (!status) {
    return "";
  }

  return [
    status.headHash ?? "",
    status.currentBranch ?? "",
    status.upstream ?? "",
    status.ahead,
    status.behind,
    status.unborn ? "1" : "0"
  ].join(":");
}

function historyRefsSignature(refs: GitHistoryRef[]): string {
  return refs
    .map((ref) => `${ref.id}:${ref.revision}:${ref.current ? "1" : "0"}:${ref.upstream ? "1" : "0"}`)
    .sort()
    .join("|");
}

function advancedHistoryQueryCacheKey(query: AdvancedHistoryQuery): string {
  return [query.search, query.author, query.after, query.before, query.path]
    .map((value) => value?.trim() ?? "")
    .join("\0");
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

function hasAdvancedHistoryQuery(query: AdvancedHistoryQuery): boolean {
  return Boolean(query.search?.trim() || query.author?.trim() || query.after?.trim() || query.before?.trim() || query.path?.trim());
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function matchesShortcut(event: globalThis.KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }
  if (
    event.ctrlKey !== parsed.ctrl ||
    event.altKey !== parsed.alt ||
    event.shiftKey !== parsed.shift ||
    event.metaKey !== parsed.meta
  ) {
    return false;
  }
  const normalizedKey = event.key.toLowerCase() === " " ? "space" : event.key.toLowerCase();
  return normalizedKey === parsed.key || event.code.toLowerCase() === parsed.key;
}

function parseShortcut(shortcut: string): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string } | null {
  const aliases: Record<string, "ctrl" | "alt" | "shift" | "meta"> = {
    ctrl: "ctrl", control: "ctrl", alt: "alt", option: "alt", shift: "shift", meta: "meta", cmd: "meta", command: "meta"
  };
  const modifiers = new Set<"ctrl" | "alt" | "shift" | "meta">();
  const mainKeys: string[] = [];
  for (const token of shortcut.split("+").map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    const modifier = aliases[token];
    if (modifier) modifiers.add(modifier);
    else mainKeys.push(token);
  }
  if (mainKeys.length !== 1) {
    return null;
  }
  return {
    ctrl: modifiers.has("ctrl"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
    meta: modifiers.has("meta"),
    key: mainKeys[0]
  };
}

function remoteProjectAddress(project: GitProject): string | undefined {
  if (!project.remote) {
    return undefined;
  }
  const destination = project.remote.username ? `${project.remote.username}@${project.remote.host}` : project.remote.host;
  const port = project.remote.port ? `:${project.remote.port}` : "";
  return `${destination}${port}:${project.path}`;
}

function pullStrategyLabel(strategy: UiPreferences["pullStrategy"]): string {
  return strategy === "ff-only" ? "仅快进" : strategy === "rebase" ? "变基" : "变基并自动暂存";
}

function commitFileCacheKey(projectId: string, commitHash: string, filePath: string): string {
  return `${projectId}\u0000${commitHash}\u0000${filePath.replace(/\\/g, "/")}`;
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

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}
