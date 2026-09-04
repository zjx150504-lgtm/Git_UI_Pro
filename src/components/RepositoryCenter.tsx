import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  Blocks,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Cloud,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileDiff,
  FolderClock,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCompareArrows,
  GitMerge,
  GitPullRequest,
  HardDrive,
  History,
  KeyRound,
  Layers3,
  Link2,
  ListRestart,
  LoaderCircle,
  Lock,
  Mail,
  MessageSquare,
  MonitorCog,
  MoveRight,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Unlock,
  UploadCloud,
  UserRound,
  Wrench,
  X
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { GIT_HOSTING_PROVIDER_CAPABILITIES } from "../types/domain";
import type {
  GitHostingAccountSummary,
  GitHostingChangeRequest,
  GitHostingCreateChangeInput,
  GitHostingMergeMethod,
  GitHostingProvider,
  GitHostingReviewEvent,
  GitIdentityConfig,
  GitIdentityUpdate,
  GitLfsFileStatus,
  GitLfsLock,
  GitLfsMigrateOptions,
  GitStashDetails
} from "../types/domain";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu";
import "../styles/repository-center.css";

export type RepositoryCenterTab = "recovery" | "refs" | "remotes" | "tools" | "projects" | "preferences";

export type RepositoryCenterSection =
  | "stashes"
  | "operation"
  | "rebaseTargets"
  | "remotes"
  | "branches"
  | "tags"
  | "reflog"
  | "worktrees"
  | "submodules"
  | "lfs"
  | "lfsLocks"
  | "gitignore"
  | "signing"
  | "identity"
  | "hosting"
  | "hostingAccounts"
  | "hostingChanges"
  | "projects"
  | "groups"
  | "recent"
  | "preferences";

export type RepositoryResourceStatus = "loading" | "ready" | "error";

export interface RepositoryResource<T> {
  status: RepositoryResourceStatus;
  data: T;
  error?: string;
}

export interface RepositoryCenterContext {
  id: string;
  name: string;
  path: string;
  branch: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  hasConflicts: boolean;
}

export interface RepositoryStash {
  id: string;
  targetHash: string;
  index: number;
  subject: string;
  branch: string;
  createdAt: string;
  author?: string;
  fileCount?: number;
}

export type RepositoryOperationKind = "merge" | "rebase" | "cherry-pick" | "revert" | "bisect";

export interface RepositoryActiveOperation {
  kind: RepositoryOperationKind;
  currentStep?: number;
  totalSteps?: number;
  source?: string;
  target?: string;
  conflictedFiles: number;
  canContinue: boolean;
  canSkip: boolean;
  canAbort: boolean;
}

export interface RepositoryRebaseTarget {
  ref: string;
  label: string;
  kind: "local" | "remote" | "tag";
  isCurrent?: boolean;
}

export type RepositoryRebaseAction = "pick" | "edit" | "squash" | "fixup" | "drop";

export interface RepositoryRebasePlanItem {
  hash: string;
  shortHash: string;
  subject: string;
  action: RepositoryRebaseAction;
}

export interface RepositoryRemote {
  id: string;
  name: string;
  fetchUrl: string;
  pushUrl: string;
  explicitPushUrl?: string;
  defaultBranch?: string;
  hostingProvider?: GitHostingProvider;
  isDefaultFetch?: boolean;
  isDefaultPush?: boolean;
}

export interface RepositoryBranch {
  id: string;
  name: string;
  kind: "local" | "remote";
  current: boolean;
  upstream?: string;
  headHash: string;
  ahead?: number;
  behind?: number;
  merged?: boolean;
}

export interface RepositoryTag {
  id: string;
  name: string;
  targetHash: string;
  subject?: string;
  annotated: boolean;
  pushedRemotes: string[];
}

export interface RepositoryReflogEntry {
  id: string;
  targetHash: string;
  selector: string;
  shortHash: string;
  action: string;
  subject: string;
  createdAt: string;
}

export interface RepositoryWorktree {
  id: string;
  path: string;
  branch?: string;
  headHash: string;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  prunableReason?: string;
  isMain: boolean;
}

export interface RepositorySubmodule {
  id: string;
  name: string;
  path: string;
  url: string;
  branch?: string;
  status: "ready" | "uninitialized" | "modified" | "conflict";
  headHash?: string;
}

export interface RepositoryLfsStatus {
  installed: boolean;
  initialized: boolean;
  version: string;
  changedFileCount: number;
  stagedFileCount: number;
  files: GitLfsFileStatus[];
}

export interface RepositoryHostingChange extends GitHostingChangeRequest {
  provider: GitHostingProvider;
  remoteId: string;
}

export interface RepositoryGitignore {
  path: string;
  content: string;
  revision: string;
  modified: boolean;
}

export type RepositorySigningFormat = "openpgp" | "ssh" | "x509";

export interface RepositorySigningSettings {
  enabled: boolean;
  format: RepositorySigningFormat;
  key: string;
  signTags: boolean;
}

export interface RepositoryHostingLink {
  id: string;
  label: string;
  provider: "github" | "gitlab" | "gitee" | "other";
  kind: "repository" | "commits" | "branches" | "pullRequests" | "issues";
  url: string;
}

export interface RepositoryProjectSummary {
  id: string;
  name: string;
  path: string;
  branch: string | null;
  groupId?: string;
  changedFiles: number;
  ahead: number;
  behind: number;
  statusError?: string;
  lastOpenedAt?: string;
}

export interface RepositoryProjectGroup {
  id: string;
  name: string;
  projectIds: string[];
}

export interface RepositoryShortcut {
  id: string;
  label: string;
  keys: string;
}

export interface RepositoryPreferences {
  theme: "system" | "light" | "dark";
  fontFamily: "system" | "mono";
  fontSize: number;
  diffMode: "split" | "inline";
  diffWrap: boolean;
  pullStrategy: "ff-only" | "rebase" | "rebase-autostash";
  density: "compact" | "comfortable";
  sidebarPosition: "left" | "right";
  sidebarWidth: number;
  rightPanelWidth: number;
  consoleHeight: number;
  bottomConsoleVisible: boolean;
  confirmDestructiveActions: boolean;
  shortcuts: RepositoryShortcut[];
}

export interface RepositoryCenterData {
  stashes: RepositoryResource<RepositoryStash[]>;
  operation: RepositoryResource<RepositoryActiveOperation | null>;
  rebaseTargets: RepositoryResource<RepositoryRebaseTarget[]>;
  remotes: RepositoryResource<RepositoryRemote[]>;
  branches: RepositoryResource<RepositoryBranch[]>;
  tags: RepositoryResource<RepositoryTag[]>;
  reflog: RepositoryResource<RepositoryReflogEntry[]>;
  worktrees: RepositoryResource<RepositoryWorktree[]>;
  submodules: RepositoryResource<RepositorySubmodule[]>;
  lfs: RepositoryResource<RepositoryLfsStatus>;
  lfsLocks: RepositoryResource<GitLfsLock[]>;
  gitignore: RepositoryResource<RepositoryGitignore>;
  signing: RepositoryResource<RepositorySigningSettings>;
  identity: RepositoryResource<GitIdentityConfig>;
  hosting: RepositoryResource<RepositoryHostingLink[]>;
  hostingAccounts: RepositoryResource<GitHostingAccountSummary[]>;
  hostingChanges: RepositoryResource<RepositoryHostingChange[]>;
  projects: RepositoryResource<RepositoryProjectSummary[]>;
  groups: RepositoryResource<RepositoryProjectGroup[]>;
  recent: RepositoryResource<RepositoryProjectSummary[]>;
  preferences: RepositoryResource<RepositoryPreferences>;
}

export interface RepositoryRemoteInput {
  id?: string;
  name: string;
  fetchUrl: string;
  pushUrl?: string | null;
}

export interface RepositoryCloneInput {
  url: string;
  destination: string;
  branch?: string;
  depth?: number;
  recurseSubmodules: boolean;
}

export interface RepositoryInitInput {
  path: string;
  initialBranch: string;
  createGitignore: boolean;
}

export type RepositoryBatchAction = "refresh" | "fetch" | "pull" | "prune";
export type RepositoryActionFeedback = void | string | Promise<void | string>;

export interface RepositoryCenterActions {
  onClose: () => void;
  onReload: (section: RepositoryCenterSection) => void | Promise<void>;
  onCreateStash: (input: { message: string; includeUntracked: boolean; keepIndex: boolean }) => void | Promise<void>;
  onLoadStashDetails: (stashId: string) => Promise<GitStashDetails>;
  onApplyStash: (stashId: string, restoreIndex: boolean) => void | Promise<void>;
  onPopStash: (stashId: string, restoreIndex: boolean) => void | Promise<void>;
  onDeleteStash: (stashId: string) => void | Promise<void>;
  onContinueOperation: (kind: RepositoryOperationKind) => void | Promise<void>;
  onSkipOperation: (kind: RepositoryOperationKind) => void | Promise<void>;
  onAbortOperation: (kind: RepositoryOperationKind) => void | Promise<void>;
  onMarkBisect: (result: "good" | "bad") => RepositoryActionFeedback;
  onStartBisect: (input: { badRef: string; goodRef: string }) => void | Promise<void>;
  onLoadRebasePlan: (target: string) => Promise<RepositoryRebasePlanItem[]>;
  onStartRebase: (input: { target: string; interactive: boolean; onto?: string; plan?: RepositoryRebasePlanItem[] }) => void | Promise<void>;
  onForcePushWithLease: (input: { forceWithLease: true }) => void | Promise<void>;
  onPublishCurrentBranch: (input: { remoteId?: string; remoteUrl?: string }) => RepositoryActionFeedback;
  onSaveRemote: (input: RepositoryRemoteInput) => void | Promise<void>;
  onDeleteRemote: (remoteId: string) => void | Promise<void>;
  onFetchRemote: (remoteId: string) => void | Promise<void>;
  onPruneRemote: (remoteId: string) => void | Promise<void>;
  onSetDefaultRemote: (input: { remoteId: string; role: "fetch" | "push" }) => void | Promise<void>;
  onRenameBranch: (input: { branchId: string; nextName: string }) => void | Promise<void>;
  onDeleteBranch: (branchId: string, force: boolean) => void | Promise<void>;
  onDeleteRemoteBranch: (branchId: string) => void | Promise<void>;
  onSetBranchUpstream: (input: { branchId: string; upstream: string | null }) => void | Promise<void>;
  onCreateTag: (input: { name: string; target: string; message?: string; annotated: boolean }) => void | Promise<void>;
  onDeleteTag: (tagId: string) => void | Promise<void>;
  onDeleteRemoteTag: (input: { tagId: string; remoteId: string }) => void | Promise<void>;
  onPushTag: (input: { tagId: string; remoteId: string }) => void | Promise<void>;
  onRestoreReflog: (input: { entryId: string; mode: "branch" | "reset-mixed" | "reset-hard"; branchName?: string }) => void | Promise<void>;
  onAddWorktree: (input: { path: string; branch: string; createBranch: boolean }) => void | Promise<void>;
  onRemoveWorktree: (worktreeId: string, force: boolean) => void | Promise<void>;
  onPruneWorktrees: () => void | Promise<void>;
  onLockWorktree: (input: { worktreeId: string; reason?: string }) => void | Promise<void>;
  onUnlockWorktree: (worktreeId: string) => void | Promise<void>;
  onMoveWorktree: (input: { worktreeId: string; destinationPath: string }) => void | Promise<void>;
  onRepairWorktrees: (worktreeIds?: string[]) => void | Promise<void>;
  onInitSubmodules: () => void | Promise<void>;
  onUpdateSubmodules: (recursive: boolean) => void | Promise<void>;
  onSyncSubmodules: () => void | Promise<void>;
  onAddSubmodule: (input: { url: string; path: string; branch?: string; name?: string }) => void | Promise<void>;
  onSetSubmoduleBranch: (input: { moduleId: string; branch?: string }) => void | Promise<void>;
  onDeinitSubmodule: (moduleId: string, force: boolean) => void | Promise<void>;
  onRemoveSubmodule: (moduleId: string, force: boolean) => void | Promise<void>;
  onInstallLfs: () => void | Promise<void>;
  onPullLfs: () => void | Promise<void>;
  onPruneLfs: () => void | Promise<void>;
  onTrackLfsPatterns: (patterns: string[]) => void | Promise<void>;
  onUntrackLfsPatterns: (patterns: string[]) => void | Promise<void>;
  onLockLfsFile: (filePath: string) => void | Promise<void>;
  onUnlockLfsFile: (lockId: string, force: boolean) => void | Promise<void>;
  onMigrateLfs: (input: GitLfsMigrateOptions) => void | Promise<void>;
  onSaveGitignore: (content: string, expectedRevision: string) => void | Promise<void>;
  onSaveSigning: (settings: RepositorySigningSettings) => void | Promise<void>;
  onTestSigning: (settings: RepositorySigningSettings) => RepositoryActionFeedback;
  onSaveIdentity: (input: GitIdentityUpdate) => void | Promise<void>;
  onOpenHostingLink: (linkId: string) => void | Promise<void>;
  onCopyHostingLink: (linkId: string) => void | Promise<void>;
  onSaveHostingAccount: (input: { provider: GitHostingProvider; remoteId: string; token: string }) => void | Promise<void>;
  onDeleteHostingAccount: (input: { provider: GitHostingProvider; host: string }) => void | Promise<void>;
  onReloadHostingChanges: (input: { provider: GitHostingProvider; remoteId: string }) => void | Promise<void>;
  onRefreshHostingChange: (input: { provider: GitHostingProvider; remoteId: string; number: number }) => RepositoryActionFeedback;
  onCreateHostingChange: (input: { provider: GitHostingProvider; remoteId: string; change: GitHostingCreateChangeInput }) => void | Promise<void>;
  onCommentHostingChange: (input: { provider: GitHostingProvider; remoteId: string; number: number; body: string }) => RepositoryActionFeedback;
  onReviewHostingChange: (input: { provider: GitHostingProvider; remoteId: string; number: number; headSha: string; event: GitHostingReviewEvent; body?: string }) => RepositoryActionFeedback;
  onMergeHostingChange: (input: { provider: GitHostingProvider; remoteId: string; number: number; headSha: string; method: GitHostingMergeMethod }) => RepositoryActionFeedback;
  onOpenHostingChange: (input: { provider: GitHostingProvider; remoteId: string; number: number }) => void | Promise<void>;
  onCloneRepository: (input: RepositoryCloneInput) => void | Promise<void>;
  onInitRepository: (input: RepositoryInitInput) => void | Promise<void>;
  onCreateGroup: (name: string) => void | Promise<void>;
  onRenameGroup: (input: { groupId: string; name: string }) => void | Promise<void>;
  onDeleteGroup: (groupId: string) => void | Promise<void>;
  onAssignProjectGroup: (input: { projectId: string; groupId: string | null }) => void | Promise<void>;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onRemoveRecentProject: (projectId: string) => void | Promise<void>;
  onRunBatchAction: (input: { projectIds: string[]; action: RepositoryBatchAction }) => void | Promise<void>;
  onSavePreferences: (preferences: RepositoryPreferences) => void | Promise<void>;
}

export interface RepositoryCenterProps {
  open: boolean;
  repository: RepositoryCenterContext;
  data: RepositoryCenterData;
  actions: RepositoryCenterActions;
  initialTab?: RepositoryCenterTab;
  activeTab?: RepositoryCenterTab;
  onTabChange?: (tab: RepositoryCenterTab) => void;
}

interface TabDefinition {
  id: RepositoryCenterTab;
  label: string;
  description: string;
  icon: typeof Archive;
}

const TABS: TabDefinition[] = [
  { id: "recovery", label: "安全与恢复", description: "暂存、进行中操作与找回", icon: ShieldCheck },
  { id: "refs", label: "分支与发布", description: "变基、分支和标签", icon: GitBranch },
  { id: "remotes", label: "远程与托管", description: "远程仓库与平台入口", icon: Cloud },
  { id: "tools", label: "仓库工具", description: "工作树、子模块与 LFS", icon: Blocks },
  { id: "projects", label: "项目管理", description: "创建、分组和批处理", icon: FolderGit2 },
  { id: "preferences", label: "偏好设置", description: "显示、差异和快捷键", icon: Settings2 }
];

const OPERATION_LABELS: Record<RepositoryOperationKind, string> = {
  merge: "合并",
  rebase: "变基",
  "cherry-pick": "摘取提交",
  revert: "还原提交",
  bisect: "二分查找"
};

const HOSTING_PROVIDER_OPTIONS: ReadonlyArray<{ value: GitHostingProvider; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" }
];

const RESTORE_MODE_OPTIONS: ReadonlyArray<SelectMenuOption<"branch" | "reset-mixed" | "reset-hard">> = [
  { value: "branch", label: "创建恢复分支" },
  { value: "reset-mixed", label: "重置 HEAD，保留文件修改" },
  { value: "reset-hard", label: "强制恢复到该记录" }
];

const REBASE_ACTION_OPTIONS: ReadonlyArray<SelectMenuOption<RepositoryRebaseAction>> = [
  { value: "pick", label: "pick", hint: "保留" },
  { value: "edit", label: "edit", hint: "暂停修改" },
  { value: "squash", label: "squash", hint: "合并并保留说明" },
  { value: "fixup", label: "fixup", hint: "合并并丢弃说明" },
  { value: "drop", label: "drop", hint: "删除" }
];

const SIGNING_FORMAT_OPTIONS: ReadonlyArray<SelectMenuOption<RepositorySigningFormat>> = [
  { value: "openpgp", label: "OpenPGP" },
  { value: "ssh", label: "SSH" },
  { value: "x509", label: "X.509" }
];

const FONT_FAMILY_OPTIONS: ReadonlyArray<SelectMenuOption<RepositoryPreferences["fontFamily"]>> = [
  { value: "system", label: "系统界面字体" },
  { value: "mono", label: "等宽字体" }
];

const DENSITY_OPTIONS: ReadonlyArray<SelectMenuOption<RepositoryPreferences["density"]>> = [
  { value: "compact", label: "紧凑" },
  { value: "comfortable", label: "舒适" }
];

const SIDEBAR_POSITION_OPTIONS: ReadonlyArray<SelectMenuOption<RepositoryPreferences["sidebarPosition"]>> = [
  { value: "left", label: "左侧" },
  { value: "right", label: "右侧" }
];

const SECTION_LABELS: Record<RepositoryCenterSection, string> = {
  stashes: "暂存记录",
  operation: "进行中操作",
  rebaseTargets: "变基目标",
  remotes: "远程仓库",
  branches: "分支",
  tags: "标签",
  reflog: "引用日志",
  worktrees: "Git 工作树",
  submodules: "子模块",
  lfs: "Git LFS",
  lfsLocks: "Git LFS 锁",
  gitignore: ".gitignore",
  signing: "提交签名",
  identity: "Git 身份",
  hosting: "托管平台",
  hostingAccounts: "托管账号",
  hostingChanges: "合并请求",
  projects: "项目",
  groups: "项目分组",
  recent: "最近项目",
  preferences: "偏好设置"
};

const DestructiveConfirmationContext = createContext(true);

export function RepositoryCenter({
  open,
  repository,
  data,
  actions,
  initialTab = "recovery",
  activeTab: controlledActiveTab,
  onTabChange
}: RepositoryCenterProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<RepositoryCenterTab>(initialTab);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeActionRef = useRef(actions.onClose);
  const pendingActionRef = useRef<string | null>(null);
  const activeTab = controlledActiveTab ?? internalActiveTab;

  useEffect(() => {
    closeActionRef.current = actions.onClose;
  }, [actions.onClose]);

  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  useEffect(() => {
    if (open) {
      setActionError("");
      setActionNotice("");
      if (controlledActiveTab === undefined) {
        setInternalActiveTab(initialTab);
      }
    }
  }, [controlledActiveTab, initialTab, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pendingActionRef.current === null) {
          closeActionRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const focusable = dialogFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  async function runAction(key: string, task: () => RepositoryActionFeedback) {
    if (pendingAction !== null) {
      return;
    }
    pendingActionRef.current = key;
    setPendingAction(key);
    setActionError("");
    setActionNotice("");
    try {
      const feedback = await task();
      if (typeof feedback === "string" && feedback.trim()) {
        setActionNotice(feedback.trim());
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }

  function reload(section: RepositoryCenterSection) {
    void runAction(`reload:${section}`, () => actions.onReload(section));
  }

  function selectTab(tab: RepositoryCenterTab) {
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(tab);
    }
    onTabChange?.(tab);
  }

  const activeDefinition = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <DestructiveConfirmationContext.Provider value={data.preferences.data.confirmDestructiveActions !== false}>
    <div className="repository-center-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="repository-center" role="dialog" aria-modal="true" aria-labelledby="repository-center-title" aria-busy={pendingAction !== null}>
        <header className="repository-center-header">
          <div className="repository-center-heading">
            <span className="repository-center-heading-icon"><FolderGit2 size={19} /></span>
            <span>
              <small>仓库中心</small>
              <strong id="repository-center-title">{repository.name}</strong>
            </span>
          </div>
          <div className="repository-center-repository-lens" data-conflicts={repository.hasConflicts}>
            <span><GitBranch size={14} />{repository.branch ?? "游离 HEAD"}</span>
            {repository.upstream ? <code>{repository.upstream}</code> : <em>未设置上游</em>}
            <span className="repository-center-sync-counts">
              <span aria-label={`领先 ${repository.ahead} 个提交`}>↑ {repository.ahead}</span>
              <span aria-label={`落后 ${repository.behind} 个提交`}>↓ {repository.behind}</span>
              <span>{repository.changedFiles} 项变更</span>
            </span>
          </div>
          <button className="repository-center-icon-button" type="button" aria-label={pendingAction ? "操作进行中，暂时无法关闭仓库中心" : "关闭仓库中心"} disabled={pendingAction !== null} onClick={actions.onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="repository-center-feedback">
          {actionError ? (
            <div className="repository-center-action-error" role="alert">
              <CircleAlert size={16} />
              <span>{actionError}</span>
              <button type="button" aria-label="关闭错误提示" onClick={() => setActionError("")}><X size={15} /></button>
            </div>
          ) : null}
          {actionNotice ? (
            <div className="repository-center-action-notice" role="status">
              <Check size={16} />
              <span>{actionNotice}</span>
              <button type="button" aria-label="关闭操作结果" onClick={() => setActionNotice("")}><X size={15} /></button>
            </div>
          ) : null}
        </div>

        <div className="repository-center-layout">
          <nav className="repository-center-nav" aria-label="仓库管理功能">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? "active" : ""}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  onClick={() => selectTab(tab.id)}
                >
                  <Icon size={17} />
                  <span><strong>{tab.label}</strong><small>{tab.description}</small></span>
                  <ChevronRight size={15} />
                </button>
              );
            })}
            <div className="repository-center-path" aria-label={`仓库路径：${repository.path}`}>
              <HardDrive size={14} />
              <code>{repository.path}</code>
            </div>
          </nav>

          <main className="repository-center-content">
            <div className="repository-center-content-heading">
              <span>
                <small>{activeDefinition.description}</small>
                <strong>{activeDefinition.label}</strong>
              </span>
            </div>
            {activeTab === "recovery" ? <RecoveryWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
            {activeTab === "refs" ? <RefsWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
            {activeTab === "remotes" ? <RemotesWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
            {activeTab === "tools" ? <ToolsWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
            {activeTab === "projects" ? <ProjectsWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
            {activeTab === "preferences" ? <PreferencesWorkspace data={data} actions={actions} pendingAction={pendingAction} runAction={runAction} reload={reload} /> : null}
          </main>
        </div>
      </section>
    </div>
    </DestructiveConfirmationContext.Provider>
  );
}

type RunAction = (key: string, task: () => RepositoryActionFeedback) => Promise<void>;

interface WorkspaceProps {
  data: RepositoryCenterData;
  actions: RepositoryCenterActions;
  pendingAction: string | null;
  runAction: RunAction;
  reload: (section: RepositoryCenterSection) => void;
}

function ResourceBoundary<T>({ section, resource, reload, children }: {
  section: RepositoryCenterSection;
  resource: RepositoryResource<T>;
  reload: (section: RepositoryCenterSection) => void;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return <div className="repository-center-state"><LoaderCircle className="spin" size={18} /><span>正在读取{SECTION_LABELS[section]}…</span></div>;
  }
  if (resource.status === "error") {
    const hasPartialData = Array.isArray(resource.data) && resource.data.length > 0;
    return (
      <>
        <div className="repository-center-state error" role="alert">
          <CircleAlert size={18} />
          <span><strong>{SECTION_LABELS[section]}{hasPartialData ? "部分读取失败" : "读取失败"}</strong><small>{resource.error}</small></span>
          <button type="button" className="repository-center-button secondary" onClick={() => reload(section)}><RefreshCw size={15} />重试</button>
        </div>
        {hasPartialData ? children(resource.data) : null}
      </>
    );
  }
  return <>{children(resource.data)}</>;
}

function SectionHeader({ icon, title, description, actions, level = 2 }: { icon: ReactNode; title: string; description: string; actions?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <header className="repository-center-section-header">
      <span className="repository-center-section-icon">{icon}</span>
      <span><Heading>{title}</Heading><small>{description}</small></span>
      {actions ? <div className="repository-center-section-actions">{actions}</div> : null}
    </header>
  );
}

function DisclosureSection({ icon, title, description, children, defaultOpen = false }: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="repository-center-disclosure" open={defaultOpen || undefined}>
      <summary>
        <span className="repository-center-section-icon">{icon}</span>
        <span className="repository-center-disclosure-copy"><strong role="heading" aria-level={2}>{title}</strong><small>{description}</small></span>
        <span className="repository-center-disclosure-state" aria-hidden="true">
          <span>展开</span>
          <ChevronDown size={16} />
        </span>
      </summary>
      <div className="repository-center-disclosure-body">{children}</div>
    </details>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  function moveSelection(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const horizontalStep = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : horizontalStep === 0
          ? -1
          : (index + horizontalStep + options.length) % options.length;
    if (nextIndex < 0) {
      return;
    }
    event.preventDefault();
    onChange(options[nextIndex].value);
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    radios?.[nextIndex]?.focus();
  }

  return (
    <div className="repository-center-segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            type="button"
            role="radio"
            key={option.value}
            className={selected ? "active" : ""}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="repository-center-empty">{icon}<span><strong>{title}</strong><small>{description}</small></span></div>;
}

function ActionButton({ label, actionKey, pendingAction, onClick, icon, tone = "secondary", disabled = false, type = "button", requiresConfirmation = false, alwaysConfirm = false, confirmLabel }: {
  label: string;
  actionKey: string;
  pendingAction: string | null;
  onClick?: () => void;
  icon: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "warning";
  disabled?: boolean;
  type?: "button" | "submit";
  requiresConfirmation?: boolean;
  alwaysConfirm?: boolean;
  confirmLabel?: string;
}) {
  const loading = pendingAction === actionKey;
  const [confirming, setConfirming] = useState(false);
  const confirmationEnabled = useContext(DestructiveConfirmationContext);
  const confirmationText = confirmLabel ?? `确认${label}`;

  useEffect(() => {
    if (loading) {
      setConfirming(false);
    }
  }, [loading]);

  function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (requiresConfirmation && (alwaysConfirm || confirmationEnabled) && !confirming) {
      event.preventDefault();
      setConfirming(true);
      return;
    }
    onClick?.();
  }

  return (
    <button
      className={`repository-center-button ${tone} ${confirming ? "confirming" : ""}`}
      type={type}
      disabled={disabled || pendingAction !== null}
      onClick={handleClick}
      onBlur={() => setConfirming(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setConfirming(false);
        }
      }}
    >
      {loading ? <LoaderCircle className="spin" size={15} /> : confirming ? <CircleAlert size={15} /> : icon}
      {confirming ? confirmationText : label}
    </button>
  );
}

function RecoveryWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [stashMessage, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  const [restoreMode, setRestoreMode] = useState<"branch" | "reset-mixed" | "reset-hard">("branch");
  const [restoreBranch, setRestoreBranch] = useState("recovery");
  const [bisectBadRef, setBisectBadRef] = useState("HEAD");
  const [bisectGoodRef, setBisectGoodRef] = useState("");

  return (
    <div className="repository-center-workspace repository-center-recovery-workspace">
      <section className="repository-center-section">
        <SectionHeader icon={<Archive size={17} />} title="暂存工作区" description="保存当前修改并在需要时恢复" />
        <form className="repository-center-composer" onSubmit={(event) => {
          event.preventDefault();
          void runAction("stash:create", async () => {
            await actions.onCreateStash({ message: stashMessage.trim(), includeUntracked, keepIndex });
            setStashMessage("");
          });
        }}>
          <label className="repository-center-field grow"><span>说明</span><input value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} placeholder="例如：切换分支前保存登录页修改" /></label>
          <label className="repository-center-check"><input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} /><span>包含未跟踪文件</span></label>
          <label className="repository-center-check"><input type="checkbox" checked={keepIndex} onChange={(event) => setKeepIndex(event.target.checked)} /><span>保留暂存区</span></label>
          <ActionButton label="创建暂存" actionKey="stash:create" pendingAction={pendingAction} type="submit" icon={<Plus size={15} />} tone="primary" />
        </form>
        <ResourceBoundary section="stashes" resource={data.stashes} reload={reload}>{(stashes) => stashes.length === 0 ? (
          <EmptyState icon={<Archive size={20} />} title="没有暂存记录" description="创建后可在这里应用、弹出或删除。" />
        ) : (
          <div className="repository-center-record-list">
            {stashes.map((stash) => (
              <StashRow
                key={stash.id}
                stash={stash}
                actions={actions}
                pendingAction={pendingAction}
                runAction={runAction}
              />
            ))}
          </div>
        )}</ResourceBoundary>
      </section>

      <section className="repository-center-section">
        <SectionHeader icon={<GitMerge size={17} />} title="进行中的 Git 操作" description="继续、跳过或终止未完成流程" />
        <ResourceBoundary section="operation" resource={data.operation} reload={reload}>{(operation) => operation === null ? (
          <EmptyState icon={<Check size={20} />} title="仓库没有未完成操作" description="合并、变基、摘取和还原状态均已清理。" />
        ) : (
          <div className="repository-center-operation" data-conflicts={operation.conflictedFiles > 0}>
            <span className="repository-center-operation-marker"><CircleDot size={20} /></span>
            <span className="repository-center-record-main">
              <strong>{OPERATION_LABELS[operation.kind]}进行中{operation.currentStep && operation.totalSteps ? ` · ${operation.currentStep}/${operation.totalSteps}` : ""}</strong>
              <small>{operation.source && operation.target ? `${operation.source} → ${operation.target}` : "等待完成当前步骤"} · {operation.conflictedFiles} 个冲突文件</small>
            </span>
            <div className="repository-center-row-actions">
              {operation.kind === "bisect" ? (
                <>
                  <ActionButton label="标记正常" actionKey="operation:bisect-good" pendingAction={pendingAction} onClick={() => void runAction("operation:bisect-good", () => actions.onMarkBisect("good"))} icon={<Check size={14} />} tone="primary" />
                  <ActionButton label="标记异常" actionKey="operation:bisect-bad" pendingAction={pendingAction} onClick={() => void runAction("operation:bisect-bad", () => actions.onMarkBisect("bad"))} icon={<CircleAlert size={14} />} tone="warning" />
                </>
              ) : <ActionButton label="继续" actionKey="operation:continue" pendingAction={pendingAction} disabled={!operation.canContinue || operation.conflictedFiles > 0} onClick={() => void runAction("operation:continue", () => actions.onContinueOperation(operation.kind))} icon={<Play size={14} />} tone="primary" />}
              {operation.canSkip ? <ActionButton label="跳过" actionKey="operation:skip" pendingAction={pendingAction} onClick={() => void runAction("operation:skip", () => actions.onSkipOperation(operation.kind))} icon={<ChevronRight size={14} />} /> : null}
              <ActionButton label="终止" actionKey="operation:abort" pendingAction={pendingAction} disabled={!operation.canAbort} onClick={() => void runAction("operation:abort", () => actions.onAbortOperation(operation.kind))} icon={<X size={14} />} tone="danger" requiresConfirmation confirmLabel="确认终止操作" />
            </div>
          </div>
        )}</ResourceBoundary>
      </section>

      {data.operation.status === "ready" && data.operation.data === null ? (
        <DisclosureSection icon={<GitCompareArrows size={17} />} title="二分定位" description="通过已知正常和异常提交定位问题引入点">
          <form className="repository-center-composer compact" onSubmit={(event) => {
            event.preventDefault();
            void runAction("bisect:start", () => actions.onStartBisect({ badRef: bisectBadRef.trim(), goodRef: bisectGoodRef.trim() }));
          }}>
            <label className="repository-center-field"><span>已知异常提交</span><input value={bisectBadRef} onChange={(event) => setBisectBadRef(event.target.value)} /></label>
            <label className="repository-center-field grow"><span>已知正常提交</span><input value={bisectGoodRef} onChange={(event) => setBisectGoodRef(event.target.value)} placeholder="例如：v1.0.0" /></label>
            <ActionButton label="开始二分定位" actionKey="bisect:start" pendingAction={pendingAction} disabled={!bisectBadRef.trim() || !bisectGoodRef.trim()} type="submit" icon={<GitCompareArrows size={14} />} />
          </form>
        </DisclosureSection>
      ) : null}

      <DisclosureSection icon={<History size={17} />} title="引用日志恢复" description="从 HEAD 移动记录中找回提交或工作区状态">
        <div className="repository-center-inline-settings">
          <div className="repository-center-field"><span>恢复方式</span><SelectMenu ariaLabel="恢复方式" value={restoreMode} options={RESTORE_MODE_OPTIONS} onChange={setRestoreMode} /></div>
          {restoreMode === "branch" ? <label className="repository-center-field"><span>分支名</span><input value={restoreBranch} onChange={(event) => setRestoreBranch(event.target.value)} /></label> : null}
        </div>
        <ResourceBoundary section="reflog" resource={data.reflog} reload={reload}>{(entries) => entries.length === 0 ? (
          <EmptyState icon={<History size={20} />} title="没有引用日志" description="当前仓库未返回可恢复的 HEAD 移动记录。" />
        ) : <div className="repository-center-record-list technical">
          {entries.map((entry) => <div className="repository-center-record" key={entry.id}>
            <span className="repository-center-hash">{entry.shortHash}</span>
            <span className="repository-center-record-main"><strong>{entry.subject}</strong><small><code>{entry.selector}</code> · {entry.action} · {entry.createdAt}</small></span>
            <ActionButton label="恢复" actionKey={`reflog:${entry.id}`} pendingAction={pendingAction} disabled={restoreMode === "branch" && restoreBranch.trim().length === 0} onClick={() => void runAction(`reflog:${entry.id}`, () => actions.onRestoreReflog({ entryId: entry.targetHash, mode: restoreMode, branchName: restoreMode === "branch" ? restoreBranch.trim() : undefined }))} icon={<RotateCcw size={14} />} tone={restoreMode === "reset-hard" ? "danger" : "secondary"} requiresConfirmation={restoreMode === "reset-hard"} confirmLabel="确认强制恢复" />
          </div>)}
        </div>}</ResourceBoundary>
      </DisclosureSection>
    </div>
  );
}

function StashRow({ stash, actions, pendingAction, runAction }: {
  stash: RepositoryStash;
  actions: RepositoryCenterActions;
  pendingAction: string | null;
  runAction: RunAction;
}) {
  const [stashDetails, setStashDetails] = useState<GitStashDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [restoreIndex, setRestoreIndex] = useState(false);

  async function loadDetails() {
    if (stashDetails || detailsLoading) return;
    setDetailsLoading(true);
    setDetailsError("");
    try {
      setStashDetails(await actions.onLoadStashDetails(stash.targetHash));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailsLoading(false);
    }
  }

  return (
    <details
      className="repository-center-record-disclosure repository-center-stash-record"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadDetails();
      }}
    >
      <summary className="repository-center-record">
        <span className="repository-center-record-leading"><Archive size={16} /></span>
        <span className="repository-center-record-main">
          <strong>{stash.subject}</strong>
          <small><code>stash@&#123;{stash.index}&#125;</code> · {stash.branch} · {stash.createdAt}{stash.fileCount !== undefined ? ` · ${stash.fileCount} 个文件` : ""}</small>
        </span>
        <span className="repository-center-record-toggle" aria-hidden="true"><span>查看详情</span><ChevronDown size={15} /></span>
      </summary>
      <div className="repository-center-record-disclosure-body">
        {detailsLoading ? <div className="repository-center-state"><LoaderCircle className="spin" size={17} /><span>正在读取暂存详情…</span></div> : null}
        {detailsError ? (
          <div className="repository-center-state error" role="alert">
            <CircleAlert size={17} />
            <span><strong>暂存详情读取失败</strong><small>{detailsError}</small></span>
            <button className="repository-center-button secondary" type="button" onClick={() => void loadDetails()}><RefreshCw size={14} />重试</button>
          </div>
        ) : null}
        {stashDetails ? (
          <div className="repository-center-stash-details">
            <div className="repository-center-stash-files" aria-label="暂存涉及文件">
              <strong>涉及文件 <em>{stashDetails.files.length}</em></strong>
              {stashDetails.files.length === 0 ? <small>此暂存没有文件变更。</small> : stashDetails.files.map((file) => (
                <span key={`${file.path}:${file.oldPath ?? ""}:${file.staged}`}>
                  <em data-status={file.status}>{changedFileStatusLabel(file.status)}</em>
                  <code>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</code>
                  {file.staged ? <small>暂存区</small> : <small>工作区</small>}
                </span>
              ))}
            </div>
            <div className="repository-center-stash-diff" aria-label="暂存差异预览">
              <strong><FileDiff size={15} />差异预览</strong>
              {stashDetails.diff.length === 0 ? <small>没有可显示的文本差异。</small> : (
                <div className="repository-center-diff-lines">
                  {stashDetails.diff.map((line, index) => (
                    <span key={`${index}:${line.oldLineNumber ?? ""}:${line.newLineNumber ?? ""}`} data-type={line.type}>
                      <code>{line.oldLineNumber ?? ""}</code>
                      <code>{line.newLineNumber ?? ""}</code>
                      <code>{line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}{line.content}</code>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="repository-center-record-management">
              <label className="repository-center-check">
                <input type="checkbox" checked={restoreIndex} onChange={(event) => setRestoreIndex(event.target.checked)} />
                <span>同时恢复原暂存区状态（--index）</span>
              </label>
              <div className="repository-center-row-actions">
                <ActionButton label="应用" actionKey={`stash:apply:${stash.id}`} pendingAction={pendingAction} onClick={() => void runAction(`stash:apply:${stash.id}`, () => actions.onApplyStash(stash.targetHash, restoreIndex))} icon={<Play size={14} />} tone="primary" />
                <ActionButton label="弹出并删除" actionKey={`stash:pop:${stash.id}`} pendingAction={pendingAction} onClick={() => void runAction(`stash:pop:${stash.id}`, () => actions.onPopStash(stash.targetHash, restoreIndex))} icon={<ArrowDownToLine size={14} />} requiresConfirmation confirmLabel="确认应用并删除暂存" />
                <ActionButton label="仅删除" actionKey={`stash:delete:${stash.id}`} pendingAction={pendingAction} onClick={() => void runAction(`stash:delete:${stash.id}`, () => actions.onDeleteStash(stash.targetHash))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除暂存" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RefsWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [rebaseTarget, setRebaseTarget] = useState("");
  const [rebaseOnto, setRebaseOnto] = useState("");
  const [interactive, setInteractive] = useState(false);
  const [rebasePlan, setRebasePlan] = useState<RepositoryRebasePlanItem[]>([]);
  const [rebasePlanLoading, setRebasePlanLoading] = useState(false);
  const [rebasePlanError, setRebasePlanError] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagTarget, setTagTarget] = useState("HEAD");
  const [tagMessage, setTagMessage] = useState("");
  const [annotatedTag, setAnnotatedTag] = useState(true);
  const [tagRemote, setTagRemote] = useState("");
  const loadRebasePlanRef = useRef(actions.onLoadRebasePlan);

  useEffect(() => {
    loadRebasePlanRef.current = actions.onLoadRebasePlan;
  }, [actions.onLoadRebasePlan]);

  useEffect(() => {
    if (data.rebaseTargets.status === "ready" && !data.rebaseTargets.data.some((target) => target.ref === rebaseTarget)) {
      setRebaseTarget("");
    }
  }, [data.rebaseTargets, rebaseTarget]);

  useEffect(() => {
    if (data.remotes.status === "ready" && !data.remotes.data.some((remote) => remote.id === tagRemote)) {
      setTagRemote(data.remotes.data.find((remote) => remote.isDefaultPush)?.id ?? data.remotes.data[0]?.id ?? "");
    }
  }, [data.remotes, tagRemote]);

  useEffect(() => {
    if (!interactive || !rebaseTarget) {
      setRebasePlan([]);
      setRebasePlanError("");
      return;
    }
    let cancelled = false;
    setRebasePlanLoading(true);
    setRebasePlanError("");
    void loadRebasePlanRef.current(rebaseTarget).then((plan) => {
      if (!cancelled) setRebasePlan(plan);
    }).catch((error) => {
      if (!cancelled) {
        setRebasePlan([]);
        setRebasePlanError(error instanceof Error ? error.message : String(error));
      }
    }).finally(() => {
      if (!cancelled) setRebasePlanLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [interactive, rebaseTarget]);

  function moveRebaseItem(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= rebasePlan.length) return;
    setRebasePlan((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  return <div className="repository-center-workspace">
    <DisclosureSection icon={<GitCompareArrows size={17} />} title="变基" description="选择明确目标并控制交互式流程">
      <ResourceBoundary section="rebaseTargets" resource={data.rebaseTargets} reload={reload}>{(targets) => targets.length === 0 ? (
        <EmptyState icon={<GitCompareArrows size={20} />} title="没有可用目标" description="仓库中没有其他本地、远程分支或标签。" />
      ) : <form className="repository-center-composer" onSubmit={(event) => {
        event.preventDefault();
        void runAction("rebase:start", () => actions.onStartRebase({
          target: rebaseTarget,
          interactive,
          onto: rebaseOnto.trim() || undefined,
          plan: interactive ? rebasePlan : undefined
        }));
      }}>
        <div className="repository-center-field grow"><span>目标引用</span><SelectMenu ariaLabel="目标引用" value={rebaseTarget} placeholder="请选择目标引用" options={targets.map((target) => ({ value: target.ref, label: `${target.label} · ${target.kind}${target.isCurrent ? "（当前）" : ""}`, disabled: target.isCurrent }))} onChange={setRebaseTarget} /></div>
        <label className="repository-center-field"><span>onto（可选）</span><input value={rebaseOnto} onChange={(event) => setRebaseOnto(event.target.value)} placeholder="新的基底" /></label>
        <label className="repository-center-check"><input type="checkbox" checked={interactive} onChange={(event) => setInteractive(event.target.checked)} /><span>交互式变基</span></label>
        <ActionButton label="开始变基" actionKey="rebase:start" pendingAction={pendingAction} disabled={!rebaseTarget || rebasePlanLoading || (interactive && (rebasePlan.length === 0 || rebasePlan[0]?.action === "squash" || rebasePlan[0]?.action === "fixup"))} type="submit" icon={<Play size={15} />} tone="primary" requiresConfirmation confirmLabel={interactive && rebasePlan.some((item) => item.action === "drop") ? "确认变基并删除计划中的提交" : "确认开始变基"} />
      </form>}</ResourceBoundary>
      {interactive ? (
        <div className="repository-rebase-plan">
          {rebasePlanLoading ? <div className="repository-center-state"><LoaderCircle className="spin" size={18} /><span>正在生成提交计划…</span></div> : null}
          {rebasePlanError ? <div className="repository-center-state error"><CircleAlert size={18} /><span><strong>无法生成计划</strong><small>{rebasePlanError}</small></span></div> : null}
          {!rebasePlanLoading && !rebasePlanError && rebasePlan.length === 0 ? <EmptyState icon={<GitCompareArrows size={20} />} title="没有需要变基的提交" description="目标引用与当前 HEAD 之间没有可重放提交。" /> : null}
          {rebasePlan.length > 0 ? rebasePlan.map((item, index) => (
            <div className={`repository-rebase-plan-row action-${item.action}`} key={item.hash}>
              <span className="repository-rebase-order">{index + 1}</span>
              <SelectMenu
                ariaLabel={`${item.shortHash} 的变基动作`}
                value={item.action}
                options={REBASE_ACTION_OPTIONS}
                onChange={(action) => setRebasePlan((current) => current.map((entry) => entry.hash === item.hash ? { ...entry, action } : entry))}
              />
              <code>{item.shortHash}</code>
              <strong>{item.subject}</strong>
              <span className="repository-rebase-move">
                <button type="button" aria-label="上移提交" disabled={index === 0} onClick={() => moveRebaseItem(index, -1)}><ArrowUp size={14} /></button>
                <button type="button" aria-label="下移提交" disabled={index === rebasePlan.length - 1} onClick={() => moveRebaseItem(index, 1)}><ArrowDown size={14} /></button>
              </span>
            </div>
          )) : null}
        </div>
      ) : null}
    </DisclosureSection>

    <section className="repository-center-section">
      <SectionHeader icon={<GitBranch size={17} />} title="分支管理" description="重命名、删除和设置上游分支" />
      <ResourceBoundary section="branches" resource={data.branches} reload={reload}>{(branches) => branches.length === 0 ? <EmptyState icon={<GitBranch size={20} />} title="没有分支" description="当前仓库未返回任何本地或远程分支。" /> : <div className="repository-center-record-list">{branches.map((branch) => <BranchRow key={branch.id} branch={branch} branches={branches} actions={actions} runAction={runAction} pendingAction={pendingAction} />)}</div>}</ResourceBoundary>
    </section>

    <DisclosureSection icon={<ShieldCheck size={17} />} title="安全强推" description="仅使用 --force-with-lease，远程分支变化时拒绝覆盖">
      <ResourceBoundary section="branches" resource={data.branches} reload={reload}>{(branches) => {
        const currentBranch = branches.find((branch) => branch.kind === "local" && branch.current);
        return (
          <div className="repository-center-risk-action" data-ready={Boolean(currentBranch?.upstream)}>
            <span className="repository-center-risk-copy">
              <strong>{currentBranch ? currentBranch.name : "当前没有本地分支"}</strong>
              <small>{currentBranch?.upstream ? `将与 ${currentBranch.upstream} 的已知状态核对后推送。` : "必须先为当前分支设置上游，才能执行安全强推。"}</small>
            </span>
            <ActionButton
              label="使用安全强推"
              actionKey="branch:force-with-lease"
              pendingAction={pendingAction}
              disabled={!currentBranch?.upstream}
              onClick={() => void runAction("branch:force-with-lease", () => actions.onForcePushWithLease({ forceWithLease: true }))}
              icon={<UploadCloud size={14} />}
              tone="danger"
              requiresConfirmation
              alwaysConfirm
              confirmLabel="确认使用 --force-with-lease 强推"
            />
          </div>
        );
      }}</ResourceBoundary>
    </DisclosureSection>

    <DisclosureSection icon={<Tags size={17} />} title="标签" description="创建附注标签，并按远程推送或删除">
      <form className="repository-center-composer multi-row" onSubmit={(event) => {
        event.preventDefault();
        void runAction("tag:create", async () => {
          await actions.onCreateTag({ name: tagName.trim(), target: tagTarget.trim(), message: annotatedTag ? tagMessage.trim() : undefined, annotated: annotatedTag });
          setTagName("");
          setTagMessage("");
        });
      }}>
        <label className="repository-center-field"><span>标签名</span><input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="v1.2.0" /></label>
        <label className="repository-center-field"><span>目标</span><input value={tagTarget} onChange={(event) => setTagTarget(event.target.value)} /></label>
        <label className="repository-center-field grow"><span>附注</span><input value={tagMessage} disabled={!annotatedTag} onChange={(event) => setTagMessage(event.target.value)} placeholder="版本说明" /></label>
        <label className="repository-center-check"><input type="checkbox" checked={annotatedTag} onChange={(event) => setAnnotatedTag(event.target.checked)} /><span>附注标签</span></label>
        <ActionButton label="创建标签" actionKey="tag:create" pendingAction={pendingAction} disabled={!tagName.trim() || !tagTarget.trim() || (annotatedTag && !tagMessage.trim())} type="submit" icon={<Plus size={15} />} tone="primary" />
      </form>
      <ResourceBoundary section="tags" resource={data.tags} reload={reload}>{(tags) => tags.length === 0 ? <EmptyState icon={<Tags size={20} />} title="没有标签" description="为稳定节点创建标签后会显示在这里。" /> : <div className="repository-center-record-list">{tags.map((tag) => <div className="repository-center-record" key={tag.id}>
        <span className="repository-center-record-leading"><Tags size={16} /></span>
        <span className="repository-center-record-main"><strong>{tag.name}<em>{tag.annotated ? "附注" : "轻量"}</em></strong><small><code>{tag.targetHash}</code>{tag.subject ? ` · ${tag.subject}` : ""}</small></span>
        <div className="repository-center-row-actions">
          <SelectMenu className="repository-center-compact-select" ariaLabel={`选择 ${tag.name} 的推送远程`} value={tagRemote} placeholder="选择远程" options={data.remotes.data.map((remote) => ({ value: remote.id, label: remote.name }))} onChange={setTagRemote} />
          <ActionButton label="推送" actionKey={`tag:push:${tag.id}`} pendingAction={pendingAction} disabled={!tagRemote} onClick={() => void runAction(`tag:push:${tag.id}`, () => actions.onPushTag({ tagId: tag.id, remoteId: tagRemote }))} icon={<UploadCloud size={14} />} />
          <ActionButton label="删除远程" actionKey={`tag:delete-remote:${tag.id}`} pendingAction={pendingAction} disabled={!tagRemote} onClick={() => void runAction(`tag:delete-remote:${tag.id}`, () => actions.onDeleteRemoteTag({ tagId: tag.id, remoteId: tagRemote }))} icon={<CloudOff size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除远程标签" />
          <ActionButton label="删除" actionKey={`tag:delete:${tag.id}`} pendingAction={pendingAction} onClick={() => void runAction(`tag:delete:${tag.id}`, () => actions.onDeleteTag(tag.id))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除标签" />
        </div>
      </div>)}</div>}</ResourceBoundary>
    </DisclosureSection>
  </div>;
}

function BranchRow({ branch, branches, actions, pendingAction, runAction }: { branch: RepositoryBranch; branches: RepositoryBranch[]; actions: RepositoryCenterActions; pendingAction: string | null; runAction: RunAction }) {
  const [name, setName] = useState(branch.name);
  const [upstream, setUpstream] = useState(branch.upstream ?? "");
  useEffect(() => setName(branch.name), [branch.name]);
  useEffect(() => setUpstream(branch.upstream ?? ""), [branch.upstream]);
  return <div className="repository-center-record branch-record">
    <span className="repository-center-record-leading"><GitBranch size={16} /></span>
    <span className="repository-center-record-main"><strong>{branch.name}{branch.current ? <em>当前</em> : null}{branch.kind === "remote" ? <em>远程</em> : null}</strong><small><code>{branch.headHash}</code> · ↑ {branch.ahead ?? "?"} ↓ {branch.behind ?? "?"}{branch.merged === undefined ? "" : ` · ${branch.merged ? "已合并" : "未合并"}`}</small></span>
    {branch.kind === "local" ? <div className="repository-center-row-editor">
      <label><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <ActionButton label="重命名" actionKey={`branch:rename:${branch.id}`} pendingAction={pendingAction} disabled={!name.trim() || name.trim() === branch.name} onClick={() => void runAction(`branch:rename:${branch.id}`, () => actions.onRenameBranch({ branchId: branch.id, nextName: name.trim() }))} icon={<Pencil size={14} />} />
      <div className="repository-center-row-field"><span>上游</span><SelectMenu ariaLabel={`${branch.name} 的上游分支`} value={upstream} options={[{ value: "", label: "不跟踪" }, ...branches.filter((candidate) => candidate.kind === "remote").map((candidate) => ({ value: candidate.name, label: candidate.name }))]} onChange={setUpstream} /></div>
      <ActionButton label="保存上游" actionKey={`branch:upstream:${branch.id}`} pendingAction={pendingAction} disabled={upstream === (branch.upstream ?? "")} onClick={() => void runAction(`branch:upstream:${branch.id}`, () => actions.onSetBranchUpstream({ branchId: branch.id, upstream: upstream || null }))} icon={<Save size={14} />} />
      <ActionButton label="删除" actionKey={`branch:delete:${branch.id}`} pendingAction={pendingAction} disabled={branch.current} onClick={() => void runAction(`branch:delete:${branch.id}`, () => actions.onDeleteBranch(branch.id, false))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除分支" />
      <ActionButton label="强制删除" actionKey={`branch:force-delete:${branch.id}`} pendingAction={pendingAction} disabled={branch.current} onClick={() => void runAction(`branch:force-delete:${branch.id}`, () => actions.onDeleteBranch(branch.id, true))} icon={<CircleAlert size={14} />} tone="danger" requiresConfirmation confirmLabel="确认强制删除" />
    </div> : <div className="repository-center-row-actions">
      <ActionButton label="删除远程分支" actionKey={`branch:delete-remote:${branch.id}`} pendingAction={pendingAction} onClick={() => void runAction(`branch:delete-remote:${branch.id}`, () => actions.onDeleteRemoteBranch(branch.id))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除远程分支" />
    </div>}
  </div>;
}

function RemotesWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [editing, setEditing] = useState<RepositoryRemoteInput>({ name: "", fetchUrl: "", pushUrl: "" });
  const [publishUrl, setPublishUrl] = useState("");
  const [publishRemoteId, setPublishRemoteId] = useState("");
  const [hostingProvider, setHostingProvider] = useState<GitHostingProvider>("github");
  const [hostingRemoteId, setHostingRemoteId] = useState("");
  const [hostingToken, setHostingToken] = useState("");
  const [changeDraft, setChangeDraft] = useState(false);
  const [changeTitle, setChangeTitle] = useState("");
  const [changeBody, setChangeBody] = useState("");
  const [changeSource, setChangeSource] = useState("");
  const [changeTarget, setChangeTarget] = useState("");
  const targetRemoteRef = useRef<string | null>(null);
  const currentBranch = data.branches.status === "ready"
    ? data.branches.data.find((branch) => branch.kind === "local" && branch.current)
    : undefined;

  useEffect(() => {
    if (data.remotes.status !== "ready") return;
    if (!data.remotes.data.some((remote) => remote.id === publishRemoteId)) {
      setPublishRemoteId(data.remotes.data.find((remote) => remote.isDefaultPush)?.id ?? data.remotes.data[0]?.id ?? "");
    }
  }, [data.remotes, publishRemoteId]);

  useEffect(() => {
    if (data.remotes.status !== "ready") return;
    if (!data.remotes.data.some((remote) => remote.id === hostingRemoteId)) {
      const preferred = data.remotes.data.find((remote) => remote.isDefaultFetch) ?? data.remotes.data[0];
      setHostingRemoteId(preferred?.id ?? "");
      if (preferred?.hostingProvider) {
        setHostingProvider(preferred.hostingProvider);
      }
    }
  }, [data.remotes, hostingRemoteId]);

  useEffect(() => {
    if (hostingRemoteId === targetRemoteRef.current) return;
    targetRemoteRef.current = hostingRemoteId;
    const remote = data.remotes.data.find((item) => item.id === hostingRemoteId);
    setChangeTarget(remote?.defaultBranch ?? "");
  }, [data.remotes.data, hostingRemoteId]);

  useEffect(() => {
    if (data.branches.status !== "ready") return;
    const currentBranch = data.branches.data.find((branch) => branch.kind === "local" && branch.current)?.name ?? "";
    setChangeSource((value) => value || currentBranch);
  }, [data.branches]);

  function editRemote(remote?: RepositoryRemote) {
    setEditing(remote ? { id: remote.id, name: remote.name, fetchUrl: remote.fetchUrl, pushUrl: remote.explicitPushUrl ?? "" } : { name: "", fetchUrl: "", pushUrl: "" });
  }

  function selectHostingProvider(provider: GitHostingProvider) {
    setHostingProvider(provider);
    const selected = data.remotes.data.find((remote) => remote.id === hostingRemoteId);
    if (selected?.hostingProvider && selected.hostingProvider !== provider) {
      const compatible = data.remotes.data.find((remote) => remote.hostingProvider === provider && remote.isDefaultFetch)
        ?? data.remotes.data.find((remote) => remote.hostingProvider === provider);
      setHostingRemoteId(compatible?.id ?? "");
    }
  }

  function selectHostingRemote(remoteId: string) {
    setHostingRemoteId(remoteId);
    const remote = data.remotes.data.find((item) => item.id === remoteId);
    if (remote?.hostingProvider) {
      setHostingProvider(remote.hostingProvider);
    }
  }
  return <div className="repository-center-workspace">
    <section className="repository-center-section">
      <SectionHeader icon={<UploadCloud size={17} />} title="发布到远程" description="本地已有提交时，只需填写远程仓库地址" />
      <ResourceBoundary section="remotes" resource={data.remotes} reload={reload}>{(remotes) => <>
        {data.branches.status === "ready" && !currentBranch ? (
          <div className="repository-center-first-publish unavailable">
            <span className="repository-center-first-publish-icon"><GitBranch size={19} /></span>
            <span><strong>还不能发布</strong><small>请先在当前仓库完成一次提交，软件才能识别要发布的分支。</small></span>
          </div>
        ) : currentBranch && !currentBranch.upstream ? (
          <form className="repository-center-first-publish" onSubmit={(event) => {
            event.preventDefault();
            const remoteUrl = remotes.length === 0 ? publishUrl.trim() : undefined;
            const remoteId = remotes.length > 0 ? publishRemoteId : undefined;
            void runAction("remote:first-publish", async () => {
              const feedback = await actions.onPublishCurrentBranch({ remoteId, remoteUrl });
              setPublishUrl("");
              return feedback;
            });
          }}>
            <div className="repository-center-first-publish-heading">
              <span className="repository-center-first-publish-icon"><UploadCloud size={19} /></span>
              <span><strong>首次发布</strong><small>自动配置默认远程并关联当前分支，无需执行命令。</small></span>
            </div>
            <div className="repository-center-publish-route" aria-label={`发布当前分支 ${currentBranch.name}`}>
              <span><GitBranch size={14} />{currentBranch.name}</span>
              <MoveRight size={16} />
              <span><Cloud size={14} />{remotes.length === 0 ? "origin" : publishRemoteId || "选择远程"}</span>
            </div>
            {remotes.length === 0 ? (
              <label className="repository-center-field grow"><span>远程仓库地址</span><input value={publishUrl} onChange={(event) => setPublishUrl(event.target.value)} placeholder="粘贴 GitHub、Gitee 或 GitLab 仓库地址" autoComplete="off" /><small>支持 HTTPS 和 SSH 地址；远程名称自动使用 origin。</small></label>
            ) : (
              <div className="repository-center-field grow"><span>发布到</span><SelectMenu ariaLabel="发布到的远程" value={publishRemoteId} options={remotes.map((remote) => ({ value: remote.id, label: `${remote.name} · ${remote.pushUrl}` }))} onChange={setPublishRemoteId} /><small>将自动设为默认推送远程并关联 {currentBranch.name}。</small></div>
            )}
            <ActionButton label="发布当前分支" actionKey="remote:first-publish" pendingAction={pendingAction} disabled={remotes.length === 0 ? !publishUrl.trim() : !publishRemoteId} type="submit" icon={<UploadCloud size={15} />} tone="primary" />
          </form>
        ) : currentBranch?.upstream ? (
          <div className="repository-center-first-publish connected">
            <span className="repository-center-first-publish-icon"><Check size={18} /></span>
            <span><strong>当前分支已连接</strong><small>{currentBranch.name} 正在跟踪 {currentBranch.upstream}。</small></span>
          </div>
        ) : null}

        <DisclosureSection icon={<Settings2 size={17} />} title="远程地址管理" description="自定义名称、Fetch URL 或独立 Push URL" defaultOpen={remotes.length > 0}>
          <form className="repository-center-composer multi-row" onSubmit={(event) => {
            event.preventDefault();
            void runAction("remote:save", async () => {
              const pushUrl = editing.pushUrl?.trim();
              await actions.onSaveRemote({ ...editing, name: editing.name.trim(), fetchUrl: editing.fetchUrl.trim(), pushUrl: pushUrl || (editing.id ? null : undefined) });
              editRemote();
            });
          }}>
            <label className="repository-center-field"><span>名称</span><input value={editing.name} onChange={(event) => setEditing((value) => ({ ...value, name: event.target.value }))} placeholder="origin" /></label>
            <label className="repository-center-field grow"><span>Fetch URL</span><input value={editing.fetchUrl} onChange={(event) => setEditing((value) => ({ ...value, fetchUrl: event.target.value }))} placeholder="git@github.com:owner/repository.git" /></label>
            <label className="repository-center-field grow"><span>Push URL（可选）</span><input value={editing.pushUrl ?? ""} onChange={(event) => setEditing((value) => ({ ...value, pushUrl: event.target.value }))} placeholder="留空则使用 Fetch URL" /><small>编辑时留空会清除独立 Push URL。</small></label>
            <ActionButton label={editing.id ? "保存远程" : "添加远程"} actionKey="remote:save" pendingAction={pendingAction} disabled={!editing.name.trim() || !editing.fetchUrl.trim()} type="submit" icon={editing.id ? <Save size={15} /> : <Plus size={15} />} tone="primary" />
            {editing.id ? <button className="repository-center-button secondary" type="button" onClick={() => editRemote()}><X size={15} />取消编辑</button> : null}
          </form>
          {remotes.length === 0 ? <EmptyState icon={<Cloud size={20} />} title="没有远程仓库" description="使用上面的首次发布即可自动创建 origin。" /> : <div className="repository-center-record-list">{remotes.map((remote) => <div className="repository-center-record" key={remote.id}>
            <span className="repository-center-record-leading"><Cloud size={16} /></span>
            <span className="repository-center-record-main"><strong>{remote.name}{remote.isDefaultFetch ? <em>默认拉取</em> : null}{remote.isDefaultPush ? <em>默认推送</em> : null}</strong><small>取：{remote.fetchUrl}</small><small>推：{remote.pushUrl}{remote.explicitPushUrl === undefined ? "（继承 Fetch URL）" : ""}</small></span>
            <div className="repository-center-row-actions wrap">
              <ActionButton label="编辑" actionKey={`remote:edit:${remote.id}`} pendingAction={pendingAction} onClick={() => editRemote(remote)} icon={<Pencil size={14} />} />
              <ActionButton label="获取" actionKey={`remote:fetch:${remote.id}`} pendingAction={pendingAction} onClick={() => void runAction(`remote:fetch:${remote.id}`, () => actions.onFetchRemote(remote.id))} icon={<Download size={14} />} />
              <ActionButton label="清理" actionKey={`remote:prune:${remote.id}`} pendingAction={pendingAction} onClick={() => void runAction(`remote:prune:${remote.id}`, () => actions.onPruneRemote(remote.id))} icon={<ListRestart size={14} />} />
              {!remote.isDefaultFetch ? <ActionButton label="默认拉取" actionKey={`remote:default-fetch:${remote.id}`} pendingAction={pendingAction} onClick={() => void runAction(`remote:default-fetch:${remote.id}`, () => actions.onSetDefaultRemote({ remoteId: remote.id, role: "fetch" }))} icon={<ArrowDownToLine size={14} />} /> : null}
              {!remote.isDefaultPush ? <ActionButton label="默认推送" actionKey={`remote:default-push:${remote.id}`} pendingAction={pendingAction} onClick={() => void runAction(`remote:default-push:${remote.id}`, () => actions.onSetDefaultRemote({ remoteId: remote.id, role: "push" }))} icon={<UploadCloud size={14} />} /> : null}
              <ActionButton label="删除" actionKey={`remote:delete:${remote.id}`} pendingAction={pendingAction} onClick={() => void runAction(`remote:delete:${remote.id}`, () => actions.onDeleteRemote(remote.id))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除远程" />
            </div>
          </div>)}</div>}
        </DisclosureSection>
      </>}</ResourceBoundary>
    </section>

    <DisclosureSection icon={<Link2 size={17} />} title="托管平台入口" description="在浏览器中打开仓库、提交、分支、PR 或 Issue">
      <ResourceBoundary section="hosting" resource={data.hosting} reload={reload}>{(links) => links.length === 0 ? <EmptyState icon={<Link2 size={20} />} title="没有可用入口" description="配置标准远程地址后可生成托管平台链接。" /> : <div className="repository-center-link-grid">{links.map((link) => <div className="repository-center-link" key={link.id}>
        <span><ExternalLink size={17} /><strong>{link.label}</strong><small>{link.provider} · {hostingKindLabel(link.kind)}</small></span>
        <code aria-label={`链接地址：${link.url}`}>{link.url}</code>
        <div className="repository-center-row-actions">
          <ActionButton label="复制" actionKey={`hosting:copy:${link.id}`} pendingAction={pendingAction} onClick={() => void runAction(`hosting:copy:${link.id}`, () => actions.onCopyHostingLink(link.id))} icon={<Copy size={14} />} />
          <ActionButton label="打开" actionKey={`hosting:open:${link.id}`} pendingAction={pendingAction} onClick={() => void runAction(`hosting:open:${link.id}`, () => actions.onOpenHostingLink(link.id))} icon={<ArrowUpRight size={14} />} tone="primary" />
        </div>
      </div>)}</div>}</ResourceBoundary>
    </DisclosureSection>

    <DisclosureSection icon={<GitPullRequest size={17} />} title="托管协作" description="管理平台账号，并创建、评审和合并 PR 或 MR">
      <div className="repository-center-advanced-grid repository-center-hosting-workspace">
        <section className="repository-center-tool-panel">
          <SectionHeader icon={<UserRound size={16} />} title="平台账号" description="令牌仅在保存时提交，不会在界面中回显" level={3} />
          <form className="repository-center-form-grid repository-center-hosting-account-form" onSubmit={(event) => {
            event.preventDefault();
            void runAction("hosting:account:save", async () => {
              await actions.onSaveHostingAccount({ provider: hostingProvider, remoteId: hostingRemoteId, token: hostingToken.trim() });
              setHostingToken("");
            });
          }}>
            <div className="repository-center-field"><span>平台</span><SelectMenu ariaLabel="托管平台" value={hostingProvider} options={HOSTING_PROVIDER_OPTIONS} onChange={selectHostingProvider} /></div>
            <div className="repository-center-field"><span>远程</span><SelectMenu ariaLabel="托管远程" value={hostingRemoteId} placeholder="选择远程" options={data.remotes.data.map((remote) => ({ value: remote.id, label: `${remote.name}${remote.hostingProvider ? ` · ${hostingProviderLabel(remote.hostingProvider)}` : ""}` }))} onChange={selectHostingRemote} /></div>
            <label className="repository-center-field grow"><span>访问令牌</span><input type="password" autoComplete="off" value={hostingToken} onChange={(event) => setHostingToken(event.target.value)} placeholder="输入新的访问令牌" /></label>
            <ActionButton label="保存账号" actionKey="hosting:account:save" pendingAction={pendingAction} disabled={!hostingRemoteId || !hostingToken.trim()} type="submit" icon={<Save size={14} />} tone="primary" />
          </form>
          <ResourceBoundary section="hostingAccounts" resource={data.hostingAccounts} reload={reload}>{(accounts) => accounts.length === 0 ? (
            <EmptyState icon={<UserRound size={19} />} title="没有托管账号" description="选择平台和远程后保存访问令牌。" />
          ) : (
            <div className="repository-center-account-list">
              {accounts.map((account) => (
                <div className="repository-center-account-record" key={`${account.provider}:${account.host}`}>
                  <span className="repository-center-record-leading"><ShieldCheck size={15} /></span>
                  <span className="repository-center-record-main"><strong>{hostingProviderLabel(account.provider)} · {account.login}</strong><small>{account.host} · 更新于 {account.updatedAt}</small></span>
                  <ActionButton label="移除账号" actionKey={`hosting:account:delete:${account.provider}:${account.host}`} pendingAction={pendingAction} onClick={() => void runAction(`hosting:account:delete:${account.provider}:${account.host}`, () => actions.onDeleteHostingAccount({ provider: account.provider, host: account.host }))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认移除平台账号" />
                </div>
              ))}
            </div>
          )}</ResourceBoundary>
        </section>

        <section className="repository-center-tool-panel repository-center-hosting-change-panel">
          <SectionHeader
            icon={<GitPullRequest size={16} />}
            title="PR / MR"
            description="当前选择决定列表刷新和新建目标"
            level={3}
            actions={<ActionButton label="刷新列表" actionKey="hosting:changes:reload" pendingAction={pendingAction} disabled={!hostingRemoteId} onClick={() => void runAction("hosting:changes:reload", () => actions.onReloadHostingChanges({ provider: hostingProvider, remoteId: hostingRemoteId }))} icon={<RefreshCw size={14} />} />}
          />
          <div className="repository-center-hosting-context" role="status">
            <span>{hostingProviderLabel(hostingProvider)}</span>
            <strong>{data.remotes.data.find((remote) => remote.id === hostingRemoteId)?.name ?? "未选择远程"}</strong>
          </div>
          <form className="repository-center-form-grid repository-center-hosting-create-form" onSubmit={(event) => {
            event.preventDefault();
            void runAction("hosting:change:create", async () => {
              await actions.onCreateHostingChange({
                provider: hostingProvider,
                remoteId: hostingRemoteId,
                change: {
                  title: changeTitle.trim(),
                  body: changeBody.trim() || undefined,
                  sourceBranch: changeSource.trim(),
                  targetBranch: changeTarget.trim(),
                  draft: changeDraft
                }
              });
              setChangeTitle("");
              setChangeBody("");
              setChangeDraft(false);
            });
          }}>
            <label className="repository-center-field grow"><span>标题</span><input value={changeTitle} onChange={(event) => setChangeTitle(event.target.value)} placeholder="说明这次变更解决的问题" /></label>
            <div className="repository-center-inline-settings full">
              <label className="repository-center-field"><span>源分支</span><input value={changeSource} onChange={(event) => setChangeSource(event.target.value)} /></label>
              <span className="repository-center-branch-direction" aria-hidden="true"><MoveRight size={16} /></span>
              <label className="repository-center-field"><span>目标分支</span><input value={changeTarget} onChange={(event) => setChangeTarget(event.target.value)} placeholder={hostingRemoteId ? "远端未声明默认分支，请明确填写" : "先选择远程"} /></label>
            </div>
            <label className="repository-center-field full"><span>说明（可选）</span><textarea rows={3} value={changeBody} onChange={(event) => setChangeBody(event.target.value)} /></label>
            {GIT_HOSTING_PROVIDER_CAPABILITIES[hostingProvider].draft ? <label className="repository-center-check"><input type="checkbox" checked={changeDraft} onChange={(event) => setChangeDraft(event.target.checked)} /><span>创建为草稿</span></label> : null}
            <ActionButton label={changeDraft ? "创建草稿" : "创建合并请求"} actionKey="hosting:change:create" pendingAction={pendingAction} disabled={!hostingRemoteId || !changeTitle.trim() || !changeSource.trim() || !changeTarget.trim()} type="submit" icon={<Plus size={14} />} tone="primary" />
          </form>
          <ResourceBoundary section="hostingChanges" resource={data.hostingChanges} reload={reload}>{(changes) => {
            const visibleChanges = changes.filter((change) => change.provider === hostingProvider && change.remoteId === hostingRemoteId);
            return visibleChanges.length === 0 ? (
              <EmptyState icon={<GitPullRequest size={19} />} title="当前没有合并请求" description="刷新所选平台与远程，或创建新的 PR / MR。" />
            ) : (
              <div className="repository-center-hosting-change-list">
                {visibleChanges.map((change) => <HostingChangeRow key={`${change.provider}:${change.remoteId}:${change.number}`} change={change} actions={actions} pendingAction={pendingAction} runAction={runAction} />)}
              </div>
            );
          }}</ResourceBoundary>
        </section>
      </div>
    </DisclosureSection>
  </div>;
}

function HostingChangeRow({ change, actions, pendingAction, runAction }: {
  change: RepositoryHostingChange;
  actions: RepositoryCenterActions;
  pendingAction: string | null;
  runAction: RunAction;
}) {
  const [reviewBody, setReviewBody] = useState("");
  const [mergeMethod, setMergeMethod] = useState<GitHostingMergeMethod>("squash");
  const actionScope = `${change.provider}:${change.remoteId}:${change.number}`;
  const capabilities = GIT_HOSTING_PROVIDER_CAPABILITIES[change.provider];
  const canComment = true;
  const canReview = change.state === "open" && Boolean(change.headSha);
  const canMerge = canReview && !change.draft && change.mergeReadiness === "allowed";

  function review(event: GitHostingReviewEvent) {
    return actions.onReviewHostingChange({
      provider: change.provider,
      remoteId: change.remoteId,
      number: change.number,
      headSha: change.headSha,
      event,
      body: reviewBody.trim() || undefined
    });
  }

  return (
    <details className="repository-center-record-disclosure repository-center-hosting-change">
      <summary className="repository-center-record">
        <span className="repository-center-record-leading"><GitPullRequest size={16} /></span>
        <span className="repository-center-record-main">
          <strong>#{change.number} {change.title}{change.draft ? <em>草稿</em> : null}<em>{hostingChangeStateLabel(change.state)}</em></strong>
          <small>{change.author} · {change.sourceBranch} → {change.targetBranch}{change.headSha ? ` · ${change.headSha.slice(0, 8)}` : " · 未获取头提交"}{change.reviewStatus ? ` · ${change.reviewStatus}` : ""}</small>
        </span>
        <span className="repository-center-record-toggle" aria-hidden="true"><span>评审与合并</span><ChevronDown size={15} /></span>
      </summary>
      <div className="repository-center-record-disclosure-body repository-center-hosting-review">
        <label className="repository-center-field full"><span>评审说明</span><textarea rows={3} value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} placeholder="评论或请求修改时填写具体内容" /></label>
        <div className="repository-center-row-actions wrap">
          <ActionButton label="打开页面" actionKey={`hosting:change:open:${actionScope}`} pendingAction={pendingAction} onClick={() => void runAction(`hosting:change:open:${actionScope}`, () => actions.onOpenHostingChange({ provider: change.provider, remoteId: change.remoteId, number: change.number }))} icon={<ArrowUpRight size={14} />} />
          <ActionButton label="检查状态" actionKey={`hosting:change:refresh:${actionScope}`} pendingAction={pendingAction} onClick={() => void runAction(`hosting:change:refresh:${actionScope}`, () => actions.onRefreshHostingChange({ provider: change.provider, remoteId: change.remoteId, number: change.number }))} icon={<RefreshCw size={14} />} />
          <ActionButton label="评论" actionKey={`hosting:change:comment:${actionScope}`} pendingAction={pendingAction} disabled={!canComment || !reviewBody.trim()} onClick={() => void runAction(`hosting:change:comment:${actionScope}`, () => actions.onCommentHostingChange({ provider: change.provider, remoteId: change.remoteId, number: change.number, body: reviewBody.trim() }))} icon={<MessageSquare size={14} />} />
          {capabilities.reviewEvents.includes("approve") ? <ActionButton label="批准" actionKey={`hosting:change:approve:${actionScope}`} pendingAction={pendingAction} disabled={!canReview} onClick={() => void runAction(`hosting:change:approve:${actionScope}`, () => review("approve"))} icon={<ThumbsUp size={14} />} tone="primary" /> : null}
          {capabilities.reviewEvents.includes("request-changes") ? <ActionButton label="请求修改" actionKey={`hosting:change:request:${actionScope}`} pendingAction={pendingAction} disabled={!canReview || !reviewBody.trim()} onClick={() => void runAction(`hosting:change:request:${actionScope}`, () => review("request-changes"))} icon={<ThumbsDown size={14} />} tone="warning" requiresConfirmation confirmLabel="确认提交请求修改" /> : null}
        </div>
        <div className="repository-center-hosting-merge-bar">
          <div className="repository-center-field"><span>合并方式</span><SelectMenu ariaLabel="合并方式" value={mergeMethod} options={capabilities.mergeMethods.map((method) => ({ value: method, label: hostingMergeMethodLabel(method) }))} onChange={setMergeMethod} /></div>
          <span><small>{hostingMergeReadinessLabel(change)}</small></span>
          <ActionButton label="合并" actionKey={`hosting:change:merge:${actionScope}`} pendingAction={pendingAction} disabled={!canMerge} onClick={() => void runAction(`hosting:change:merge:${actionScope}`, () => actions.onMergeHostingChange({ provider: change.provider, remoteId: change.remoteId, number: change.number, headSha: change.headSha, method: mergeMethod }))} icon={<GitMerge size={14} />} tone="primary" requiresConfirmation alwaysConfirm confirmLabel={`确认以${hostingMergeMethodLabel(mergeMethod)}合并`} />
        </div>
      </div>
    </details>
  );
}

function ToolsWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [submoduleInput, setSubmoduleInput] = useState({ url: "", path: "", branch: "", name: "" });
  const [lfsPatterns, setLfsPatterns] = useState("");
  const [lfsLockPath, setLfsLockPath] = useState("");
  const [lfsMigrateInclude, setLfsMigrateInclude] = useState("");
  const [lfsMigrateExclude, setLfsMigrateExclude] = useState("");
  const [lfsMigrateEverything, setLfsMigrateEverything] = useState(false);
  const [lfsRewriteConfirmed, setLfsRewriteConfirmed] = useState(false);
  const [gitignore, setGitignore] = useState(data.gitignore.data.content);
  const [signing, setSigning] = useState(data.signing.data);
  const [identity, setIdentity] = useState<GitIdentityUpdate>({ name: data.identity.data.localName ?? data.identity.data.name ?? "", email: data.identity.data.localEmail ?? data.identity.data.email ?? "" });

  useEffect(() => setGitignore(data.gitignore.data.content), [data.gitignore.data.content]);
  useEffect(() => setSigning(data.signing.data), [data.signing.data]);
  useEffect(() => setIdentity({ name: data.identity.data.localName ?? data.identity.data.name ?? "", email: data.identity.data.localEmail ?? data.identity.data.email ?? "" }), [data.identity.data]);

  return <div className="repository-center-workspace">
    <section className="repository-center-section">
      <SectionHeader icon={<Layers3 size={17} />} title="Git 工作树" description="同一仓库并行维护多个分支目录" actions={<div className="repository-center-row-actions"><ActionButton label="修复全部" actionKey="worktree:repair:all" pendingAction={pendingAction} onClick={() => void runAction("worktree:repair:all", () => actions.onRepairWorktrees())} icon={<Wrench size={14} />} /><ActionButton label="清理失效项" actionKey="worktree:prune" pendingAction={pendingAction} onClick={() => void runAction("worktree:prune", actions.onPruneWorktrees)} icon={<ListRestart size={14} />} requiresConfirmation confirmLabel="确认清理失效项" /></div>} />
      <form className="repository-center-composer" onSubmit={(event) => {
        event.preventDefault();
        void runAction("worktree:add", async () => {
          await actions.onAddWorktree({ path: worktreePath.trim(), branch: worktreeBranch.trim(), createBranch });
          setWorktreePath("");
          setWorktreeBranch("");
        });
      }}>
        <label className="repository-center-field grow"><span>目录</span><input value={worktreePath} onChange={(event) => setWorktreePath(event.target.value)} placeholder="E:\\projects\\feature-worktree" /></label>
        <label className="repository-center-field"><span>分支</span><input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder="feature/name" /></label>
        <label className="repository-center-check"><input type="checkbox" checked={createBranch} onChange={(event) => setCreateBranch(event.target.checked)} /><span>创建新分支</span></label>
        <ActionButton label="添加工作树" actionKey="worktree:add" pendingAction={pendingAction} disabled={!worktreePath.trim() || !worktreeBranch.trim()} type="submit" icon={<Plus size={15} />} tone="primary" />
      </form>
      <ResourceBoundary section="worktrees" resource={data.worktrees} reload={reload}>{(worktrees) => worktrees.length === 0 ? <EmptyState icon={<Layers3 size={20} />} title="没有工作树" description="主工作区之外尚未创建 Git worktree。" /> : <div className="repository-center-record-list">{worktrees.map((worktree) => <WorktreeRow key={worktree.id} worktree={worktree} actions={actions} pendingAction={pendingAction} runAction={runAction} />)}</div>}</ResourceBoundary>
    </section>

    <section className="repository-center-section split-section">
      <div className="repository-center-section-column">
        <SectionHeader icon={<Blocks size={17} />} title="子模块" description="初始化、同步地址并递归更新" actions={<div className="repository-center-row-actions"><ActionButton label="初始化" actionKey="submodule:init" pendingAction={pendingAction} onClick={() => void runAction("submodule:init", actions.onInitSubmodules)} icon={<Play size={14} />} /><ActionButton label="同步" actionKey="submodule:sync" pendingAction={pendingAction} onClick={() => void runAction("submodule:sync", actions.onSyncSubmodules)} icon={<RefreshCw size={14} />} /><ActionButton label="递归更新" actionKey="submodule:update" pendingAction={pendingAction} onClick={() => void runAction("submodule:update", () => actions.onUpdateSubmodules(true))} icon={<Download size={14} />} tone="primary" /></div>} />
        <form className="repository-center-form-grid repository-center-submodule-add" onSubmit={(event) => {
          event.preventDefault();
          void runAction("submodule:add", async () => {
            await actions.onAddSubmodule({
              url: submoduleInput.url.trim(),
              path: submoduleInput.path.trim(),
              branch: submoduleInput.branch.trim() || undefined,
              name: submoduleInput.name.trim() || undefined
            });
            setSubmoduleInput({ url: "", path: "", branch: "", name: "" });
          });
        }}>
          <label className="repository-center-field grow"><span>仓库地址</span><input value={submoduleInput.url} onChange={(event) => setSubmoduleInput((value) => ({ ...value, url: event.target.value }))} placeholder="git@host:team/module.git" /></label>
          <label className="repository-center-field grow"><span>目录</span><input value={submoduleInput.path} onChange={(event) => setSubmoduleInput((value) => ({ ...value, path: event.target.value }))} placeholder="packages/module" /></label>
          <label className="repository-center-field"><span>跟踪分支（可选）</span><input value={submoduleInput.branch} onChange={(event) => setSubmoduleInput((value) => ({ ...value, branch: event.target.value }))} /></label>
          <label className="repository-center-field"><span>名称（可选）</span><input value={submoduleInput.name} onChange={(event) => setSubmoduleInput((value) => ({ ...value, name: event.target.value }))} /></label>
          <ActionButton label="添加子模块" actionKey="submodule:add" pendingAction={pendingAction} disabled={!submoduleInput.url.trim() || !submoduleInput.path.trim()} type="submit" icon={<Plus size={14} />} tone="primary" />
        </form>
        <ResourceBoundary section="submodules" resource={data.submodules} reload={reload}>{(modules) => modules.length === 0 ? <EmptyState icon={<Blocks size={20} />} title="没有子模块" description="填写地址和目录以添加子模块。" /> : <div className="repository-center-record-list compact">{modules.map((module) => <SubmoduleRow key={module.id} module={module} actions={actions} pendingAction={pendingAction} runAction={runAction} />)}</div>}</ResourceBoundary>
      </div>
      <div className="repository-center-section-column">
        <SectionHeader icon={<Package size={17} />} title="Git LFS" description="大文件扩展状态和本地对象维护" />
        <ResourceBoundary section="lfs" resource={data.lfs} reload={reload}>{(lfs) => <>
          <div className="repository-center-metrics repository-center-lfs-metrics">
            <span><small>安装状态</small><strong>{lfs.installed ? "已安装" : "未安装"}</strong></span>
            <span className="repository-center-lfs-version" aria-label={`Git LFS 版本：${lfs.version || "未知"}`}>
              <small>版本</small>
              <strong>{lfsVersionLabel(lfs.version)}</strong>
              {lfsVersionDetail(lfs.version) ? <small className="repository-center-lfs-build">{lfsVersionDetail(lfs.version)}</small> : null}
            </span>
            <span><small>工作区变更</small><strong>{lfs.changedFileCount}</strong></span>
            <span><small>已暂存变更</small><strong>{lfs.stagedFileCount}</strong></span>
            <div className="repository-center-row-actions full"><ActionButton label="安装 LFS" actionKey="lfs:install" pendingAction={pendingAction} disabled={lfs.installed && lfs.initialized} onClick={() => void runAction("lfs:install", actions.onInstallLfs)} icon={<Package size={14} />} /><ActionButton label="拉取对象" actionKey="lfs:pull" pendingAction={pendingAction} disabled={!lfs.installed} onClick={() => void runAction("lfs:pull", actions.onPullLfs)} icon={<Download size={14} />} tone="primary" /><ActionButton label="清理本地对象" actionKey="lfs:prune" pendingAction={pendingAction} disabled={!lfs.installed} onClick={() => void runAction("lfs:prune", actions.onPruneLfs)} icon={<ListRestart size={14} />} requiresConfirmation confirmLabel="确认清理 LFS 对象" /></div>
          </div>

          <details className="repository-center-tool-disclosure">
            <summary><FileCode2 size={15} /><span><strong>跟踪规则与文件</strong><small>维护 .gitattributes 规则并查看当前 LFS 文件</small></span><ChevronDown size={15} /></summary>
            <div className="repository-center-tool-disclosure-body">
              <div className="repository-center-pattern-editor">
                <label className="repository-center-field grow"><span>文件模式</span><input value={lfsPatterns} onChange={(event) => setLfsPatterns(event.target.value)} placeholder="*.psd, assets/*.zip" /><small>使用逗号或换行分隔多个模式。</small></label>
                <div className="repository-center-row-actions">
                  <ActionButton label="开始跟踪" actionKey="lfs:track" pendingAction={pendingAction} disabled={!lfs.installed || parseList(lfsPatterns).length === 0} onClick={() => void runAction("lfs:track", async () => { await actions.onTrackLfsPatterns(parseList(lfsPatterns)); setLfsPatterns(""); })} icon={<Plus size={14} />} tone="primary" />
                  <ActionButton label="取消跟踪" actionKey="lfs:untrack" pendingAction={pendingAction} disabled={!lfs.installed || parseList(lfsPatterns).length === 0} onClick={() => void runAction("lfs:untrack", async () => { await actions.onUntrackLfsPatterns(parseList(lfsPatterns)); setLfsPatterns(""); })} icon={<X size={14} />} requiresConfirmation confirmLabel="确认取消这些 LFS 规则" />
                </div>
              </div>
              {lfs.files.length === 0 ? <EmptyState icon={<FileCode2 size={18} />} title="没有 LFS 文件" description="添加跟踪规则并提交匹配文件后会显示在这里。" /> : (
                <div className="repository-center-lfs-file-list">
                  {lfs.files.map((file) => {
                    const fileLock = data.lfsLocks.status === "ready" ? data.lfsLocks.data.find((lock) => lock.path === file.path) : undefined;
                    return (
                      <div className="repository-center-lfs-file" key={file.path}>
                        <span className="repository-center-record-main"><strong>{file.path}{file.staged ? <em>已暂存</em> : null}</strong><small>{file.status || "LFS 对象"}{fileLock ? ` · ${fileLock.owner} 已锁定` : ""}</small></span>
                        <ActionButton label={fileLock ? "已锁定" : "锁定"} actionKey={`lfs:lock:${file.path}`} pendingAction={pendingAction} disabled={!lfs.installed || data.lfsLocks.status !== "ready" || Boolean(fileLock)} onClick={() => void runAction(`lfs:lock:${file.path}`, () => actions.onLockLfsFile(file.path))} icon={<Lock size={14} />} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

          <details className="repository-center-tool-disclosure">
            <summary><Lock size={15} /><span><strong>文件锁</strong><small>协调不可合并的二进制文件编辑权</small></span><ChevronDown size={15} /></summary>
            <div className="repository-center-tool-disclosure-body">
              <form className="repository-center-composer compact" onSubmit={(event) => { event.preventDefault(); void runAction("lfs:lock:custom", async () => { await actions.onLockLfsFile(lfsLockPath.trim()); setLfsLockPath(""); }); }}>
                <label className="repository-center-field grow"><span>仓库内文件路径</span><input value={lfsLockPath} onChange={(event) => setLfsLockPath(event.target.value)} placeholder="design/source.psd" /></label>
                <ActionButton label="锁定文件" actionKey="lfs:lock:custom" pendingAction={pendingAction} disabled={!lfs.installed || !lfsLockPath.trim()} type="submit" icon={<Lock size={14} />} tone="primary" />
              </form>
              <ResourceBoundary section="lfsLocks" resource={data.lfsLocks} reload={reload}>{(locks) => locks.length === 0 ? <EmptyState icon={<Unlock size={18} />} title="没有 LFS 锁" description="当前仓库没有被锁定的 LFS 文件。" /> : <div className="repository-center-lock-list">{locks.map((lock) => <div className="repository-center-lock-record" key={lock.id}><span className="repository-center-record-leading"><Lock size={15} /></span><span className="repository-center-record-main"><strong>{lock.path}</strong><small>{lock.owner}{lock.lockedAt ? ` · ${lock.lockedAt}` : ""}</small></span><div className="repository-center-row-actions"><ActionButton label="解锁" actionKey={`lfs:unlock:${lock.id}`} pendingAction={pendingAction} onClick={() => void runAction(`lfs:unlock:${lock.id}`, () => actions.onUnlockLfsFile(lock.id, false))} icon={<Unlock size={14} />} /><ActionButton label="强制解锁" actionKey={`lfs:force-unlock:${lock.id}`} pendingAction={pendingAction} onClick={() => void runAction(`lfs:force-unlock:${lock.id}`, () => actions.onUnlockLfsFile(lock.id, true))} icon={<CircleAlert size={14} />} tone="danger" requiresConfirmation alwaysConfirm confirmLabel="确认强制解除他人的 LFS 锁" /></div></div>)}</div>}</ResourceBoundary>
            </div>
          </details>

          <details className="repository-center-tool-disclosure repository-center-danger-disclosure">
            <summary><History size={15} /><span><strong>迁移历史对象</strong><small>重写 Git 历史，把已有文件迁移到 LFS</small></span><ChevronDown size={15} /></summary>
            <form className="repository-center-tool-disclosure-body repository-center-lfs-migrate" onSubmit={(event) => {
              event.preventDefault();
              void runAction("lfs:migrate", () => actions.onMigrateLfs({
                include: parseList(lfsMigrateInclude),
                exclude: parseList(lfsMigrateExclude).length > 0 ? parseList(lfsMigrateExclude) : undefined,
                everything: lfsMigrateEverything || undefined,
                rewriteHistory: true
              }));
            }}>
              <div className="repository-center-risk-banner"><CircleAlert size={17} /><span><strong>此操作会重写提交历史</strong><small>协作者需要重新获取或重新克隆仓库，执行后通常需要安全强推。</small></span></div>
              <label className="repository-center-field"><span>包含模式</span><input value={lfsMigrateInclude} onChange={(event) => setLfsMigrateInclude(event.target.value)} placeholder="*.psd, *.zip" disabled={lfsMigrateEverything} /></label>
              <label className="repository-center-field"><span>排除模式（可选）</span><input value={lfsMigrateExclude} onChange={(event) => setLfsMigrateExclude(event.target.value)} /></label>
              <label className="repository-center-check"><input type="checkbox" checked={lfsMigrateEverything} onChange={(event) => setLfsMigrateEverything(event.target.checked)} /><span>扫描所有本地引用，而不只当前分支</span></label>
              <label className="repository-center-check repository-center-explicit-confirm"><input type="checkbox" checked={lfsRewriteConfirmed} onChange={(event) => setLfsRewriteConfirmed(event.target.checked)} /><span>我已确认这会重写 Git 历史</span></label>
              <ActionButton label="开始迁移" actionKey="lfs:migrate" pendingAction={pendingAction} disabled={!lfs.installed || !lfsRewriteConfirmed || (!lfsMigrateEverything && parseList(lfsMigrateInclude).length === 0)} type="submit" icon={<History size={14} />} tone="danger" requiresConfirmation alwaysConfirm confirmLabel="再次确认重写历史并迁移" />
            </form>
          </details>
        </>}</ResourceBoundary>
      </div>
    </section>

    <DisclosureSection icon={<UserRound size={17} />} title="Git 身份" description="检查并设置当前仓库提交使用的姓名与邮箱" defaultOpen={!data.identity.data.valid}>
      <ResourceBoundary section="identity" resource={data.identity} reload={reload}>{(identityConfig) => (
        <div className="repository-center-identity-workspace">
          <div className="repository-center-identity-summary" data-valid={identityConfig.valid}>
            <span className="repository-center-record-leading">{identityConfig.valid ? <Check size={16} /> : <CircleAlert size={16} />}</span>
            <span className="repository-center-record-main">
              <strong>{identityConfig.valid ? "提交身份有效" : "提交身份需要处理"}</strong>
              <small>当前生效：{identityConfig.name || "未设置姓名"} · {identityConfig.email || "未设置邮箱"}</small>
              <small>仓库级：{identityConfig.localName || "继承全局姓名"} · {identityConfig.localEmail || "继承全局邮箱"}</small>
            </span>
          </div>
          {identityConfig.issues.length > 0 ? (
            <div className="repository-center-validation-list" role="alert">
              {identityConfig.issues.map((issue) => <span key={`${issue.field}:${issue.messageZh}`}><CircleAlert size={14} /><strong>{issue.field === "name" ? "姓名" : "邮箱"}</strong><small>{issue.messageZh}</small></span>)}
            </div>
          ) : null}
          <form className="repository-center-composer" onSubmit={(event) => {
            event.preventDefault();
            void runAction("identity:save", () => actions.onSaveIdentity({ name: identity.name.trim(), email: identity.email.trim() }));
          }}>
            <label className="repository-center-field grow"><span>提交姓名</span><span className="repository-center-input-with-icon"><UserRound size={15} /><input value={identity.name} onChange={(event) => setIdentity((value) => ({ ...value, name: event.target.value }))} autoComplete="name" /></span></label>
            <label className="repository-center-field grow"><span>提交邮箱</span><span className="repository-center-input-with-icon"><Mail size={15} /><input type="email" value={identity.email} onChange={(event) => setIdentity((value) => ({ ...value, email: event.target.value }))} autoComplete="email" /></span></label>
            <ActionButton label="保存仓库身份" actionKey="identity:save" pendingAction={pendingAction} disabled={!identity.name.trim() || !identity.email.trim() || (identity.name.trim() === (identityConfig.localName ?? identityConfig.name ?? "") && identity.email.trim() === (identityConfig.localEmail ?? identityConfig.email ?? ""))} type="submit" icon={<Save size={14} />} tone="primary" />
          </form>
        </div>
      )}</ResourceBoundary>
    </DisclosureSection>

    <DisclosureSection icon={<FileCode2 size={17} />} title=".gitignore" description={data.gitignore.data.path || "管理仓库忽略规则"}>
      <div className="repository-center-disclosure-toolbar">
        <ActionButton label="保存规则" actionKey="gitignore:save" pendingAction={pendingAction} disabled={data.gitignore.status !== "ready" || gitignore === data.gitignore.data.content} onClick={() => void runAction("gitignore:save", () => actions.onSaveGitignore(gitignore, data.gitignore.data.revision))} icon={<Save size={14} />} tone="primary" />
      </div>
      <ResourceBoundary section="gitignore" resource={data.gitignore} reload={reload}>{() => <textarea className="repository-center-code-editor" spellCheck={false} value={gitignore} onChange={(event) => setGitignore(event.target.value)} aria-label="编辑 gitignore 规则" />}</ResourceBoundary>
    </DisclosureSection>

    <DisclosureSection icon={<KeyRound size={17} />} title="提交签名" description="配置 OpenPGP 或 SSH 签名密钥">
      <ResourceBoundary section="signing" resource={data.signing} reload={reload}>{() => <div className="repository-center-form-grid">
        <label className="repository-center-switch"><input type="checkbox" checked={signing.enabled} onChange={(event) => setSigning((value) => ({ ...value, enabled: event.target.checked }))} /><span>签署 Git 提交</span></label>
        <label className="repository-center-switch"><input type="checkbox" checked={signing.signTags} onChange={(event) => setSigning((value) => ({ ...value, signTags: event.target.checked }))} /><span>同时签署标签</span></label>
        <div className="repository-center-field"><span>签名格式</span><SelectMenu ariaLabel="签名格式" value={signing.format} options={SIGNING_FORMAT_OPTIONS} onChange={(format) => setSigning((value) => ({ ...value, format }))} /></div>
        <label className="repository-center-field grow"><span>密钥 ID 或公钥路径</span><input value={signing.key} onChange={(event) => setSigning((value) => ({ ...value, key: event.target.value }))} /></label>
        <div className="repository-center-row-actions full"><ActionButton label="验证 HEAD 签名" actionKey="signing:test" pendingAction={pendingAction} onClick={() => void runAction("signing:test", () => actions.onTestSigning(signing))} icon={<ShieldCheck size={14} />} /><ActionButton label="保存设置" actionKey="signing:save" pendingAction={pendingAction} disabled={signing.enabled && !signing.key.trim()} onClick={() => void runAction("signing:save", () => actions.onSaveSigning(signing))} icon={<Save size={14} />} tone="primary" /></div>
      </div>}</ResourceBoundary>
    </DisclosureSection>
  </div>;
}

function WorktreeRow({ worktree, actions, pendingAction, runAction }: {
  worktree: RepositoryWorktree;
  actions: RepositoryCenterActions;
  pendingAction: string | null;
  runAction: RunAction;
}) {
  const [lockReason, setLockReason] = useState("");
  const [destinationPath, setDestinationPath] = useState("");

  return (
    <details className="repository-center-record-disclosure repository-center-worktree-record">
      <summary className="repository-center-record">
        <span className="repository-center-record-leading"><FolderGit2 size={16} /></span>
        <span className="repository-center-record-main">
          <strong>{worktree.branch ?? "游离 HEAD"}{worktree.isMain ? <em>主工作树</em> : null}{worktree.locked ? <em>已锁定</em> : null}{worktree.prunable ? <em>可清理</em> : null}</strong>
          <small>{worktree.path} · <code>{worktree.headHash}</code></small>
          {worktree.lockReason ? <small>锁定原因：{worktree.lockReason}</small> : null}
          {worktree.prunableReason ? <small>可清理原因：{worktree.prunableReason}</small> : null}
        </span>
        <span className="repository-center-record-toggle" aria-hidden="true"><span>管理</span><ChevronDown size={15} /></span>
      </summary>
      <div className="repository-center-record-disclosure-body repository-center-record-management-grid">
        {!worktree.isMain ? (
          <>
            <div className="repository-center-tool-row">
              <label className="repository-center-field grow"><span>锁定原因（可选）</span><input value={lockReason} disabled={worktree.locked} onChange={(event) => setLockReason(event.target.value)} placeholder="例如：正在进行本地发布验证" /></label>
              {worktree.locked ? (
                <ActionButton label="解锁" actionKey={`worktree:unlock:${worktree.id}`} pendingAction={pendingAction} onClick={() => void runAction(`worktree:unlock:${worktree.id}`, () => actions.onUnlockWorktree(worktree.id))} icon={<Unlock size={14} />} />
              ) : (
                <ActionButton label="锁定" actionKey={`worktree:lock:${worktree.id}`} pendingAction={pendingAction} onClick={() => void runAction(`worktree:lock:${worktree.id}`, () => actions.onLockWorktree({ worktreeId: worktree.id, reason: lockReason.trim() || undefined }))} icon={<Lock size={14} />} />
              )}
            </div>
            <form className="repository-center-tool-row" onSubmit={(event) => {
              event.preventDefault();
              void runAction(`worktree:move:${worktree.id}`, async () => {
                await actions.onMoveWorktree({ worktreeId: worktree.id, destinationPath: destinationPath.trim() });
                setDestinationPath("");
              });
            }}>
              <label className="repository-center-field grow"><span>移动到新目录</span><input value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} placeholder="E:\\projects\\new-worktree-path" /></label>
              <ActionButton label="移动" actionKey={`worktree:move:${worktree.id}`} pendingAction={pendingAction} disabled={!destinationPath.trim() || destinationPath.trim() === worktree.path} type="submit" icon={<MoveRight size={14} />} tone="primary" requiresConfirmation confirmLabel="确认移动工作树目录" />
            </form>
          </>
        ) : <div className="repository-center-info-band"><ShieldCheck size={15} /><span><strong>主工作树由当前仓库维护</strong><small>主工作树不能在此移动、锁定或移除。</small></span></div>}
        <div className="repository-center-row-actions wrap full">
          <ActionButton label="修复记录" actionKey={`worktree:repair:${worktree.id}`} pendingAction={pendingAction} onClick={() => void runAction(`worktree:repair:${worktree.id}`, () => actions.onRepairWorktrees([worktree.id]))} icon={<Wrench size={14} />} />
          {!worktree.isMain ? <ActionButton label="移除" actionKey={`worktree:remove:${worktree.id}`} pendingAction={pendingAction} disabled={worktree.locked} onClick={() => void runAction(`worktree:remove:${worktree.id}`, () => actions.onRemoveWorktree(worktree.id, false))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认移除工作树" /> : null}
          {!worktree.isMain ? <ActionButton label="强制移除" actionKey={`worktree:force-remove:${worktree.id}`} pendingAction={pendingAction} onClick={() => void runAction(`worktree:force-remove:${worktree.id}`, () => actions.onRemoveWorktree(worktree.id, true))} icon={<CircleAlert size={14} />} tone="danger" requiresConfirmation alwaysConfirm confirmLabel={worktree.locked ? "确认强制移除锁定工作树" : "确认强制移除含未提交修改的工作树"} /> : null}
        </div>
      </div>
    </details>
  );
}

function SubmoduleRow({ module, actions, pendingAction, runAction }: {
  module: RepositorySubmodule;
  actions: RepositoryCenterActions;
  pendingAction: string | null;
  runAction: RunAction;
}) {
  const [branch, setBranch] = useState(module.branch ?? "");
  useEffect(() => setBranch(module.branch ?? ""), [module.branch]);

  return (
    <details className="repository-center-record-disclosure repository-center-submodule-record">
      <summary className="repository-center-record">
        <span className={`repository-center-status-dot ${module.status}`} />
        <span className="repository-center-record-main"><strong>{module.name}{module.branch ? <em>{module.branch}</em> : null}</strong><small>{module.path} · {module.url} · {submoduleStatusLabel(module.status)}{module.headHash ? ` · ${module.headHash}` : ""}</small></span>
        <span className="repository-center-record-toggle" aria-hidden="true"><span>管理</span><ChevronDown size={15} /></span>
      </summary>
      <div className="repository-center-record-disclosure-body repository-center-record-management-grid">
        <div className="repository-center-tool-row">
          <label className="repository-center-field grow"><span>跟踪分支</span><input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="留空取消 branch 配置" /></label>
          <ActionButton label="保存分支" actionKey={`submodule:branch:${module.id}`} pendingAction={pendingAction} disabled={branch.trim() === (module.branch ?? "")} onClick={() => void runAction(`submodule:branch:${module.id}`, () => actions.onSetSubmoduleBranch({ moduleId: module.id, branch: branch.trim() || undefined }))} icon={<Save size={14} />} />
        </div>
        <div className="repository-center-row-actions wrap full">
          <ActionButton label="反初始化" actionKey={`submodule:deinit:${module.id}`} pendingAction={pendingAction} disabled={module.status === "uninitialized"} onClick={() => void runAction(`submodule:deinit:${module.id}`, () => actions.onDeinitSubmodule(module.id, false))} icon={<RotateCcw size={14} />} tone="warning" requiresConfirmation confirmLabel="确认反初始化子模块" />
          <ActionButton label="强制反初始化" actionKey={`submodule:force-deinit:${module.id}`} pendingAction={pendingAction} onClick={() => void runAction(`submodule:force-deinit:${module.id}`, () => actions.onDeinitSubmodule(module.id, true))} icon={<CircleAlert size={14} />} tone="danger" requiresConfirmation alwaysConfirm confirmLabel="确认强制反初始化子模块" />
          <ActionButton label="移除配置" actionKey={`submodule:remove:${module.id}`} pendingAction={pendingAction} onClick={() => void runAction(`submodule:remove:${module.id}`, () => actions.onRemoveSubmodule(module.id, false))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认移除子模块" />
          <ActionButton label="强制移除" actionKey={`submodule:force-remove:${module.id}`} pendingAction={pendingAction} onClick={() => void runAction(`submodule:force-remove:${module.id}`, () => actions.onRemoveSubmodule(module.id, true))} icon={<CircleAlert size={14} />} tone="danger" requiresConfirmation alwaysConfirm confirmLabel="确认强制移除子模块及其工作目录" />
        </div>
      </div>
    </details>
  );
}

function ProjectsWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [clone, setClone] = useState<RepositoryCloneInput>({ url: "", destination: "", branch: "", recurseSubmodules: true });
  const [init, setInit] = useState<RepositoryInitInput>({ path: "", initialBranch: "main", createGitignore: true });
  const [groupName, setGroupName] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<RepositoryBatchAction>("refresh");

  function toggleProject(projectId: string) {
    setSelectedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]);
  }

  return <div className="repository-center-workspace">
    <DisclosureSection icon={<FolderPlus size={17} />} title="创建仓库" description="克隆远程仓库或在本地目录初始化">
      <div className="repository-center-disclosure-grid">
      <div className="repository-center-section-column">
        <SectionHeader icon={<Download size={17} />} title="克隆仓库" description="从 HTTPS 或 SSH 地址创建本地副本" level={3} />
        <form className="repository-center-form-grid" onSubmit={(event) => { event.preventDefault(); void runAction("project:clone", () => actions.onCloneRepository({ ...clone, url: clone.url.trim(), destination: clone.destination.trim(), branch: clone.branch?.trim() || undefined })); }}>
          <label className="repository-center-field grow"><span>仓库地址</span><input value={clone.url} onChange={(event) => setClone((value) => ({ ...value, url: event.target.value }))} placeholder="https://github.com/owner/repository.git" /></label>
          <label className="repository-center-field grow"><span>本地目录</span><input value={clone.destination} onChange={(event) => setClone((value) => ({ ...value, destination: event.target.value }))} /></label>
          <label className="repository-center-field"><span>分支（可选）</span><input value={clone.branch} onChange={(event) => setClone((value) => ({ ...value, branch: event.target.value }))} /></label>
          <label className="repository-center-field"><span>浅克隆深度</span><input type="number" min={1} value={clone.depth ?? ""} onChange={(event) => setClone((value) => ({ ...value, depth: event.target.value ? Number(event.target.value) : undefined }))} /></label>
          <label className="repository-center-check"><input type="checkbox" checked={clone.recurseSubmodules} onChange={(event) => setClone((value) => ({ ...value, recurseSubmodules: event.target.checked }))} /><span>递归克隆子模块</span></label>
          <ActionButton label="开始克隆" actionKey="project:clone" pendingAction={pendingAction} disabled={!clone.url.trim() || !clone.destination.trim()} type="submit" icon={<Download size={15} />} tone="primary" />
        </form>
      </div>
      <div className="repository-center-section-column">
        <SectionHeader icon={<FolderPlus size={17} />} title="初始化仓库" description="在指定目录创建新的 Git 仓库" level={3} />
        <form className="repository-center-form-grid" onSubmit={(event) => { event.preventDefault(); void runAction("project:init", () => actions.onInitRepository({ ...init, path: init.path.trim(), initialBranch: init.initialBranch.trim() })); }}>
          <label className="repository-center-field grow"><span>目标目录</span><input value={init.path} onChange={(event) => setInit((value) => ({ ...value, path: event.target.value }))} /></label>
          <label className="repository-center-field"><span>初始分支</span><input value={init.initialBranch} onChange={(event) => setInit((value) => ({ ...value, initialBranch: event.target.value }))} /></label>
          <label className="repository-center-check"><input type="checkbox" checked={init.createGitignore} onChange={(event) => setInit((value) => ({ ...value, createGitignore: event.target.checked }))} /><span>同时创建 .gitignore</span></label>
          <ActionButton label="初始化" actionKey="project:init" pendingAction={pendingAction} disabled={!init.path.trim() || !init.initialBranch.trim()} type="submit" icon={<FolderPlus size={15} />} tone="primary" />
        </form>
      </div>
      </div>
    </DisclosureSection>

    <section className="repository-center-section split-section">
      <div className="repository-center-section-column">
        <SectionHeader icon={<Box size={17} />} title="项目分组" description="组织项目并调整所属分组" />
        <form className="repository-center-composer compact" onSubmit={(event) => { event.preventDefault(); void runAction("group:create", async () => { await actions.onCreateGroup(groupName.trim()); setGroupName(""); }); }}><label className="repository-center-field grow"><span>新分组名称</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label><ActionButton label="创建分组" actionKey="group:create" pendingAction={pendingAction} disabled={!groupName.trim()} type="submit" icon={<Plus size={14} />} tone="primary" /></form>
        <ResourceBoundary section="groups" resource={data.groups} reload={reload}>{(groups) => groups.length === 0 ? <EmptyState icon={<Box size={20} />} title="没有项目分组" description="创建分组后可把项目归类管理。" /> : <div className="repository-center-record-list compact">{groups.map((group) => <GroupRow key={group.id} group={group} actions={actions} pendingAction={pendingAction} runAction={runAction} />)}</div>}</ResourceBoundary>
      </div>
      <div className="repository-center-section-column">
        <SectionHeader icon={<FolderClock size={17} />} title="最近项目" description="快速打开或移出最近使用列表" />
        <ResourceBoundary section="recent" resource={data.recent} reload={reload}>{(recent) => recent.length === 0 ? <EmptyState icon={<FolderClock size={20} />} title="没有最近项目" description="打开仓库后会记录在这里。" /> : (
          <div className="repository-center-record-list compact repository-center-recent-list">
            {recent.map((project) => (
              <div className="repository-center-record repository-center-recent-record" key={project.id}>
                <span className="repository-center-record-leading"><FolderGit2 size={16} /></span>
                <span className="repository-center-record-main">
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                  {project.lastOpenedAt ? <small className="repository-center-record-time">最近打开 {formatRecentProjectTime(project.lastOpenedAt)}</small> : null}
                </span>
                <div className="repository-center-row-actions">
                  <ActionButton label="打开" actionKey={`recent:open:${project.id}`} pendingAction={pendingAction} onClick={() => void runAction(`recent:open:${project.id}`, () => actions.onOpenProject(project.id))} icon={<ArrowUpRight size={14} />} tone="primary" />
                  <ActionButton label="移出列表" actionKey={`recent:remove:${project.id}`} pendingAction={pendingAction} onClick={() => void runAction(`recent:remove:${project.id}`, () => actions.onRemoveRecentProject(project.id))} icon={<Trash2 size={14} />} tone="danger" />
                </div>
              </div>
            ))}
          </div>
        )}</ResourceBoundary>
      </div>
    </section>

    <section className="repository-center-section">
      <SectionHeader icon={<SlidersHorizontal size={17} />} title="多项目批量操作" description="对选中的仓库统一刷新、获取、拉取或清理远程引用" actions={<div className="repository-center-row-actions"><SelectMenu className="repository-center-compact-select" ariaLabel="批量操作" value={batchAction} options={[{ value: "refresh", label: "刷新状态" }, { value: "fetch", label: "获取远程" }, { value: "pull", label: `拉取更新（${pullStrategyLabel(data.preferences.data.pullStrategy)}）` }, { value: "prune", label: "清理远程引用" }]} onChange={setBatchAction} /><ActionButton label={`执行（${selectedProjects.length}）`} actionKey="batch:run" pendingAction={pendingAction} disabled={selectedProjects.length === 0} onClick={() => void runAction("batch:run", () => actions.onRunBatchAction({ projectIds: selectedProjects, action: batchAction }))} icon={<Play size={14} />} tone="primary" /></div>} />
      <ResourceBoundary section="projects" resource={data.projects} reload={reload}>{(projects) => projects.length === 0 ? <EmptyState icon={<FolderGit2 size={20} />} title="没有项目" description="添加、克隆或初始化仓库后可执行批量操作。" /> : <div className="repository-center-project-table">{projects.map((project) => <div className="repository-center-project-row" key={project.id}><input type="checkbox" aria-label={`选择 ${project.name}`} checked={selectedProjects.includes(project.id)} onChange={() => toggleProject(project.id)} /><span className="repository-center-record-main"><strong>{project.name}<em>{project.statusError ? "状态不可用" : project.branch ?? "游离 HEAD"}</em></strong><small aria-label={project.statusError ? `${project.path}，状态错误：${project.statusError}` : project.path}>{project.path}</small></span>{project.statusError ? <span className="repository-center-project-status-error" aria-label={`状态读取失败：${project.statusError}`}>状态读取失败</span> : <span className="repository-center-project-stats"><span>{project.changedFiles} 变更</span><span>↑ {project.ahead}</span><span>↓ {project.behind}</span></span>}<SelectMenu ariaLabel={`设置 ${project.name} 的分组`} value={project.groupId ?? ""} options={[{ value: "", label: "未分组" }, ...data.groups.data.map((group) => ({ value: group.id, label: group.name }))]} onChange={(groupId) => void runAction(`project:group:${project.id}`, () => actions.onAssignProjectGroup({ projectId: project.id, groupId: groupId || null }))} /></div>)}</div>}</ResourceBoundary>
    </section>
  </div>;
}

function GroupRow({ group, actions, pendingAction, runAction }: { group: RepositoryProjectGroup; actions: RepositoryCenterActions; pendingAction: string | null; runAction: RunAction }) {
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);
  return <div className="repository-center-record repository-center-group-record"><span className="repository-center-record-leading"><Box size={16} /></span><span className="repository-center-record-main"><strong>{group.name}</strong><small>{group.projectIds.length} 个项目</small></span><div className="repository-center-row-editor"><label><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><ActionButton label="重命名" actionKey={`group:rename:${group.id}`} pendingAction={pendingAction} disabled={!name.trim() || name.trim() === group.name} onClick={() => void runAction(`group:rename:${group.id}`, () => actions.onRenameGroup({ groupId: group.id, name: name.trim() }))} icon={<Pencil size={14} />} /><ActionButton label="删除" actionKey={`group:delete:${group.id}`} pendingAction={pendingAction} onClick={() => void runAction(`group:delete:${group.id}`, () => actions.onDeleteGroup(group.id))} icon={<Trash2 size={14} />} tone="danger" requiresConfirmation confirmLabel="确认删除分组" /></div></div>;
}

function PreferencesWorkspace({ data, actions, pendingAction, runAction, reload }: WorkspaceProps) {
  const [preferences, setPreferences] = useState(data.preferences.data);
  useEffect(() => setPreferences(data.preferences.data), [data.preferences.data]);
  const hasChanges = JSON.stringify(preferences) !== JSON.stringify(data.preferences.data);
  const saving = pendingAction === "preferences:save";

  function updateShortcut(id: string, keys: string) {
    setPreferences((current) => ({ ...current, shortcuts: current.shortcuts.map((shortcut) => shortcut.id === id ? { ...shortcut, keys } : shortcut) }));
  }

  return <div className="repository-center-workspace">
    <section className="repository-center-section">
      <SectionHeader icon={<MonitorCog size={17} />} title="显示与布局" description="主题、字体、差异视图和操作密度" />
      <ResourceBoundary section="preferences" resource={data.preferences} reload={reload}>{() => <>
        <div className="repository-center-preferences-savebar" data-dirty={hasChanges} data-saving={saving}>
          <span className="repository-center-preferences-status" role="status" aria-live="polite">
            <span className="repository-center-preferences-status-icon" aria-hidden="true">
              {saving ? <LoaderCircle className="spin" size={15} /> : hasChanges ? <CircleDot size={15} /> : <Check size={15} />}
            </span>
            <span>
              <strong>{saving ? "正在保存偏好设置" : hasChanges ? "有未保存的更改" : "所有设置已保存"}</strong>
              <small>{saving ? "完成后会立即应用到主界面。" : hasChanges ? "保存或放弃当前修改。" : "修改任意选项后，这里会显示保存操作。"}</small>
            </span>
          </span>
          <div className="repository-center-preferences-actions">
            {hasChanges && !saving ? (
              <button className="repository-center-button secondary" type="button" onClick={() => setPreferences(data.preferences.data)}>
                <RotateCcw size={14} />放弃更改
              </button>
            ) : null}
            <ActionButton
              label={saving ? "保存中" : hasChanges ? "保存设置" : "已保存"}
              actionKey="preferences:save"
              pendingAction={pendingAction}
              disabled={!hasChanges}
              onClick={() => void runAction("preferences:save", async () => {
                await actions.onSavePreferences(preferences);
                return "偏好设置已保存";
              })}
              icon={hasChanges ? <Save size={14} /> : <Check size={14} />}
              tone={hasChanges ? "primary" : "secondary"}
            />
          </div>
        </div>
        <div className="repository-center-preferences-grid">
          <fieldset>
            <legend>外观主题</legend>
            <SegmentedControl
              label="外观主题"
              value={preferences.theme}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" }
              ]}
              onChange={(theme) => setPreferences((value) => ({ ...value, theme }))}
            />
          </fieldset>
          <fieldset>
            <legend>字体</legend>
            <div className="repository-center-inline-settings">
              <div className="repository-center-field"><span>字体族</span><SelectMenu ariaLabel="字体族" value={preferences.fontFamily} options={FONT_FAMILY_OPTIONS} onChange={(fontFamily) => setPreferences((value) => ({ ...value, fontFamily }))} /></div>
              <label className="repository-center-field"><span>字号</span><input type="number" min={11} max={20} value={preferences.fontSize} onChange={(event) => setPreferences((value) => ({ ...value, fontSize: Number(event.target.value) }))} /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>差异视图</legend>
            <SegmentedControl
              label="差异视图"
              value={preferences.diffMode}
              options={[{ value: "split", label: "左右对比" }, { value: "inline", label: "行内对比" }]}
              onChange={(diffMode) => setPreferences((value) => ({ ...value, diffMode }))}
            />
            <label className="repository-center-switch"><input type="checkbox" checked={preferences.diffWrap} onChange={(event) => setPreferences((value) => ({ ...value, diffWrap: event.target.checked }))} /><span>自动换行</span></label>
          </fieldset>
          <fieldset>
            <legend>拉取策略</legend>
            <SegmentedControl
              label="拉取策略"
              value={preferences.pullStrategy}
              options={[
                { value: "ff-only", label: "仅快进" },
                { value: "rebase", label: "变基" },
                { value: "rebase-autostash", label: "变基并暂存" }
              ]}
              onChange={(pullStrategy) => setPreferences((value) => ({ ...value, pullStrategy }))}
            />
          </fieldset>
          <fieldset>
            <legend>工作区布局</legend>
            <div className="repository-center-inline-settings">
              <div className="repository-center-field"><span>密度</span><SelectMenu ariaLabel="界面密度" value={preferences.density} options={DENSITY_OPTIONS} onChange={(density) => setPreferences((value) => ({ ...value, density }))} /></div>
              <div className="repository-center-field"><span>项目栏位置</span><SelectMenu ariaLabel="项目栏位置" value={preferences.sidebarPosition} options={SIDEBAR_POSITION_OPTIONS} onChange={(sidebarPosition) => setPreferences((value) => ({ ...value, sidebarPosition }))} /></div>
            </div>
            <label className="repository-center-switch"><input type="checkbox" checked={preferences.bottomConsoleVisible} onChange={(event) => setPreferences((value) => ({ ...value, bottomConsoleVisible: event.target.checked }))} /><span>显示底部控制台</span></label>
          </fieldset>
          <fieldset className="wide">
            <legend>面板尺寸</legend>
            <div className="repository-center-inline-settings">
              <label className="repository-center-field"><span>项目栏宽度</span><input type="number" min={180} max={340} value={preferences.sidebarWidth} onChange={(event) => setPreferences((value) => ({ ...value, sidebarWidth: Number(event.target.value) }))} /></label>
              <label className="repository-center-field"><span>变更区宽度</span><input type="number" min={400} max={720} value={preferences.rightPanelWidth} onChange={(event) => setPreferences((value) => ({ ...value, rightPanelWidth: Number(event.target.value) }))} /></label>
              <label className="repository-center-field"><span>控制台高度</span><input type="number" min={80} max={720} value={preferences.consoleHeight} onChange={(event) => setPreferences((value) => ({ ...value, consoleHeight: Number(event.target.value) }))} /></label>
            </div>
          </fieldset>
          <fieldset className="wide">
            <legend>危险操作</legend>
            <label className="repository-center-switch"><input type="checkbox" checked={preferences.confirmDestructiveActions} onChange={(event) => setPreferences((value) => ({ ...value, confirmDestructiveActions: event.target.checked }))} /><span>执行强制重置、删除分支和清理工作树前要求确认</span></label>
          </fieldset>
        </div>
      </>}</ResourceBoundary>
    </section>

    <DisclosureSection icon={<Terminal size={17} />} title="快捷键" description="为常用命令设置独立组合键">
      {data.preferences.status === "ready" ? <div className="repository-center-shortcuts">{preferences.shortcuts.length === 0 ? <EmptyState icon={<Terminal size={20} />} title="没有快捷键项目" description="宿主应用未提供可配置的命令。" /> : preferences.shortcuts.map((shortcut) => <label key={shortcut.id}><span><strong>{shortcut.label}</strong><small>{shortcut.id}</small></span><input value={shortcut.keys} onChange={(event) => updateShortcut(shortcut.id, event.target.value)} aria-label={`${shortcut.label}快捷键`} /></label>)}</div> : null}
    </DisclosureSection>
  </div>;
}

function lfsVersionLabel(value: string) {
  const firstToken = value.trim().split(/\s+/)[0] || "";
  return firstToken.replace(/^git-lfs\//i, "") || "-";
}

function parseList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

function changedFileStatusLabel(status: GitStashDetails["files"][number]["status"]): string {
  const labels: Record<GitStashDetails["files"][number]["status"], string> = {
    added: "新增",
    modified: "修改",
    deleted: "删除",
    renamed: "重命名",
    copied: "复制",
    untracked: "未跟踪",
    ignored: "已忽略",
    conflicted: "冲突"
  };
  return labels[status];
}

function hostingProviderLabel(provider: GitHostingProvider): string {
  return HOSTING_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

function hostingChangeStateLabel(state: GitHostingChangeRequest["state"]): string {
  return state === "open" ? "进行中" : state === "merged" ? "已合并" : "已关闭";
}

function hostingMergeMethodLabel(method: GitHostingMergeMethod): string {
  return method === "squash" ? "压缩合并" : method === "rebase" ? "变基合并" : "合并提交";
}

function hostingMergeReadinessLabel(change: GitHostingChangeRequest): string {
  if (change.state !== "open") return "当前合并请求不是进行中状态";
  if (change.draft) return "草稿转为就绪后才能合并";
  if (!change.headSha) return "平台未返回头提交，请检查状态";
  if (change.mergeReadiness === "allowed") return "平台已确认当前提交可以合并";
  if (change.mergeReadiness === "blocked") return change.mergeStatus ? `平台阻止合并：${change.mergeStatus}` : "平台报告当前不可合并";
  return change.mergeStatus ? `合并状态待确认：${change.mergeStatus}` : "合并状态未知，请先检查状态";
}

function lfsVersionDetail(value: string) {
  const normalized = value.trim();
  const firstToken = normalized.split(/\s+/)[0] || "";
  return normalized
    .slice(firstToken.length)
    .trim()
    .replace(/^\(|\)$/g, "")
    .replace(/;\s*/g, " · ");
}

function formatRecentProjectTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function hostingKindLabel(kind: RepositoryHostingLink["kind"]) {
  const labels: Record<RepositoryHostingLink["kind"], string> = {
    repository: "仓库主页",
    commits: "提交记录",
    branches: "分支",
    pullRequests: "合并请求",
    issues: "问题"
  };
  return labels[kind];
}

function dialogFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"))
    .filter((element) => element.getClientRects().length > 0);
}

function submoduleStatusLabel(status: RepositorySubmodule["status"]): string {
  return status === "ready" ? "已同步" : status === "uninitialized" ? "未初始化" : status === "modified" ? "提交已变化" : "存在冲突";
}

function pullStrategyLabel(strategy: RepositoryPreferences["pullStrategy"]): string {
  return strategy === "ff-only" ? "仅快进" : strategy === "rebase" ? "变基" : "变基并暂存";
}
