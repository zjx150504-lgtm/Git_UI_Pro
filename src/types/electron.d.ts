import type {
  BranchInfo,
  ChangedFile,
  ConflictFileDetails,
  ConflictResolutionInput,
  CommitMessageInput,
  CommitInput,
  CommitNode,
  DiffLine,
  FilePreview,
  GitHistoryFilter,
  GitHistoryPage,
  GitHistoryQuery,
  GitHistoryRef,
  GitBlameLine,
  GitHostingLinks,
  GitHostingAccountSummary,
  GitHostingChangeRequest,
  GitHostingCreateChangeInput,
  GitHostingMergeInput,
  GitHostingProvider,
  GitHostingReviewInput,
  GitIdentityConfig,
  GitIdentityUpdate,
  GitIgnoreDocument,
  GitLfsStatus,
  GitLfsLock,
  GitLfsMigrateOptions,
  GitLinkedWorktree,
  GitMergePreview,
  GitMergeStrategy,
  GitOperationResult,
  GitPullStrategy,
  GitPushOptions,
  GitReflogEntry,
  GitRebasePlanItem,
  GitRemoteInfo,
  GitRemoteUpdateInput,
  GitSigningConfig,
  GitSigningConfigUpdate,
  GitStashCreateOptions,
  GitStashEntry,
  GitStashDetails,
  GitSubmoduleAddOptions,
  GitSubmoduleInfo,
  GitSubmoduleUpdateOptions,
  GitTagInfo,
  GitWorktreeAddOptions,
  GitWorktreeMoveOptions,
  GitCloneOptions,
  GitProject,
  GitResetMode,
  GitStatusSummary,
  RemoteProjectInput,
  RemoteProjectTestResult,
  SshHostInspection,
  ProjectGroup,
  ProjectLibraryState,
  RepositoryCreationResult,
  RepositoryTarget,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalHistoryEntry,
  TerminalSessionInfo,
  UiPreferences,
  WorktreeState
} from "./domain";
import type { GitLongOperationOptions, GitLongOperationProgress } from "./operations";

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type UpdateOperation = "upgrade" | "rollback";
export type UpdateSource = "github" | "gitee";

export interface UpdateCapabilities {
  sources: UpdateSource[];
  rollback: boolean;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  sourceId?: "gitee" | "github";
  sourceLabel?: string;
  sourceReleaseUrl?: string;
  resumed?: boolean;
}

export interface UpdateState {
  revision: number;
  source: UpdateSource;
  capabilities: UpdateCapabilities;
  phase: UpdatePhase;
  operation: UpdateOperation;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  releaseUrl?: string;
  progress?: UpdateProgress;
  error?: string;
}

export interface ReleaseHistoryItem {
  version: string;
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
  installerSize: number;
}

export interface UpdateComparisonCommit {
  sha: string;
  title: string;
  url?: string;
}

export interface UpdateReleaseDetails {
  source: UpdateSource;
  baseVersion: string;
  targetVersion: string;
  publishedAt?: string;
  releaseUrl: string;
  compareUrl: string;
  commits: UpdateComparisonCommit[];
  totalCommits: number;
  fallbackNotes: string[];
  contentSource: "compare" | "release";
}

export interface GitUIBridge {
  runAppCommand: (command: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  openPath: (filePath: string) => Promise<boolean>;
  revealPath: (filePath: string) => Promise<boolean>;
  setNativeTheme: (themeSource: "system" | "light" | "dark") => Promise<boolean>;
  getWindowState: () => Promise<WindowState>;
  onWindowStateChange: (callback: (state: WindowState) => void) => () => void;
  getUpdateState: () => Promise<UpdateState>;
  setUpdateSource: (source: UpdateSource) => Promise<UpdateState>;
  listUpdateReleases: (force?: boolean) => Promise<ReleaseHistoryItem[]>;
  getUpdateReleaseDetails: (force?: boolean) => Promise<UpdateReleaseDetails>;
  checkForUpdates: () => Promise<UpdateState>;
  cancelUpdateCheck: () => Promise<UpdateState>;
  prepareRollback: (version: string) => Promise<UpdateState>;
  cancelRollback: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  cancelUpdateDownload: () => Promise<UpdateState>;
  installUpdate: () => Promise<boolean>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  getGitVersion: () => Promise<GitOperationResult>;
  startTerminal: (repository: RepositoryTarget) => Promise<TerminalSessionInfo>;
  writeTerminal: (sessionId: string, data: string) => Promise<boolean>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  disposeTerminal: (sessionId: string) => Promise<boolean>;
  getTerminalHistory: (projectId: string) => Promise<TerminalHistoryEntry[]>;
  appendTerminalHistory: (projectId: string, command: string) => Promise<TerminalHistoryEntry[]>;
  clearTerminalHistory: (projectId: string) => Promise<boolean>;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  cancelGitOperation: (operationId: string) => Promise<boolean>;
  cancelGitReadRequest: (requestId: string) => Promise<boolean>;
  onGitOperationProgress: (callback: (event: GitLongOperationProgress) => void) => () => void;
  chooseDirectory: () => Promise<string | null>;
  chooseIdentityFile: () => Promise<string | null>;
  inspectSshHost: (host: string, port?: number) => Promise<SshHostInspection>;
  trustSshHost: (token: string, replaceExisting: boolean) => Promise<boolean>;
  getProjects: () => Promise<GitProject[]>;
  getProjectLibrary: () => Promise<ProjectLibraryState>;
  createProjectGroup: (name: string) => Promise<ProjectGroup>;
  renameProjectGroup: (groupId: string, name: string) => Promise<ProjectGroup>;
  deleteProjectGroup: (groupId: string) => Promise<boolean>;
  setProjectGroup: (projectId: string, groupId?: string) => Promise<GitProject>;
  renameProject: (projectId: string, name: string) => Promise<GitProject>;
  setRemoteProjectConnectionEnabled: (projectId: string, enabled: boolean) => Promise<GitProject>;
  markProjectOpened: (projectId: string) => Promise<GitProject>;
  removeRecentProject: (projectId: string) => Promise<boolean>;
  getUiPreferences: () => Promise<UiPreferences>;
  updateUiPreferences: (input: Partial<UiPreferences>) => Promise<UiPreferences>;
  addProject: (directoryPath: string) => Promise<GitProject>;
  initializeRepository: (directoryPath: string, initialBranch: string, createGitignore: boolean) => Promise<RepositoryCreationResult>;
  cloneRepository: (sourceUrl: string, destinationPath: string, options: GitCloneOptions, operation?: GitLongOperationOptions) => Promise<RepositoryCreationResult>;
  testRemoteProject: (input: RemoteProjectInput) => Promise<RemoteProjectTestResult>;
  addRemoteProject: (input: RemoteProjectInput) => Promise<GitProject>;
  scanProjects: (rootPath: string) => Promise<GitProject[]>;
  reorderProjects: (projectIds: string[]) => Promise<boolean>;
  setProjectFavorite: (projectId: string, favorite: boolean) => Promise<GitProject | undefined>;
  removeProject: (projectId: string) => Promise<boolean>;
  getProjectStatus: (repository: RepositoryTarget) => Promise<GitStatusSummary>;
  getHistory: (repository: RepositoryTarget, filter?: GitHistoryFilter) => Promise<CommitNode[]>;
  getHistoryPage: (repository: RepositoryTarget, query: GitHistoryQuery) => Promise<GitHistoryPage>;
  getBlame: (repository: RepositoryTarget, filePath: string, revision?: string) => Promise<GitBlameLine[]>;
  getHistoryRefs: (repository: RepositoryTarget) => Promise<GitHistoryRef[]>;
  getCommitDetails: (repository: RepositoryTarget, hash: string) => Promise<CommitNode>;
  getCommitDiff: (repository: RepositoryTarget, hash: string, filePath?: string, knownFirstParent?: string | null, readRequestId?: string) => Promise<DiffLine[]>;
  getCommitFilePreview: (repository: RepositoryTarget, hash: string, file: ChangedFile) => Promise<FilePreview | null>;
  getWorktree: (repository: RepositoryTarget) => Promise<WorktreeState>;
  getWorktreeDiff: (repository: RepositoryTarget, filePath: string, staged: boolean) => Promise<DiffLine[]>;
  getWorktreeFilePreview: (repository: RepositoryTarget, file: ChangedFile) => Promise<FilePreview | null>;
  getConflictFileDetails: (repository: RepositoryTarget, filePath: string) => Promise<ConflictFileDetails>;
  resolveConflictFile: (repository: RepositoryTarget, filePath: string, input: ConflictResolutionInput) => Promise<GitOperationResult>;
  stageFile: (repository: RepositoryTarget, file: ChangedFile) => Promise<GitOperationResult>;
  stageAll: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  unstageFile: (repository: RepositoryTarget, file: ChangedFile) => Promise<GitOperationResult>;
  unstageAll: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  discardFile: (repository: RepositoryTarget, file: ChangedFile) => Promise<GitOperationResult>;
  getStashes: (repository: RepositoryTarget) => Promise<GitStashEntry[]>;
  getStashDetails: (repository: RepositoryTarget, selector: string) => Promise<GitStashDetails>;
  createStash: (repository: RepositoryTarget, options: GitStashCreateOptions) => Promise<GitOperationResult>;
  applyStash: (repository: RepositoryTarget, selector: string, restoreIndex?: boolean) => Promise<GitOperationResult>;
  popStash: (repository: RepositoryTarget, selector: string, restoreIndex?: boolean) => Promise<GitOperationResult>;
  dropStash: (repository: RepositoryTarget, selector: string) => Promise<GitOperationResult>;
  commit: (repository: RepositoryTarget, input: CommitInput) => Promise<GitOperationResult>;
  fetch: (repository: RepositoryTarget, operation?: GitLongOperationOptions) => Promise<GitOperationResult>;
  fetchRemote: (repository: RepositoryTarget, remoteName: string, prune?: boolean, operation?: GitLongOperationOptions) => Promise<GitOperationResult>;
  pull: (repository: RepositoryTarget, strategy: GitPullStrategy, operation?: GitLongOperationOptions) => Promise<GitOperationResult>;
  mergeRemote: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  push: (repository: RepositoryTarget, options?: GitPushOptions & Partial<GitLongOperationOptions>) => Promise<GitOperationResult>;
  getRemotes: (repository: RepositoryTarget) => Promise<GitRemoteInfo[]>;
  addRemote: (repository: RepositoryTarget, name: string, fetchUrl: string, pushUrl?: string) => Promise<GitOperationResult>;
  updateRemote: (repository: RepositoryTarget, currentName: string, input: GitRemoteUpdateInput) => Promise<GitOperationResult>;
  removeRemote: (repository: RepositoryTarget, name: string) => Promise<GitOperationResult>;
  setBranchUpstream: (repository: RepositoryTarget, branchName: string, upstream: string) => Promise<GitOperationResult>;
  unsetBranchUpstream: (repository: RepositoryTarget, branchName: string) => Promise<GitOperationResult>;
  setDefaultRemote: (repository: RepositoryTarget, remoteName: string, role: "fetch" | "push", branchName?: string) => Promise<GitOperationResult>;
  getBranches: (repository: RepositoryTarget) => Promise<BranchInfo[]>;
  createBranch: (repository: RepositoryTarget, branchName: string, checkout: boolean, startPoint?: string) => Promise<GitOperationResult>;
  switchBranch: (repository: RepositoryTarget, branch: BranchInfo) => Promise<GitOperationResult>;
  getMergePreview: (repository: RepositoryTarget, targetBranch: string) => Promise<GitMergePreview>;
  mergeCurrentBranch: (repository: RepositoryTarget, targetBranch: string, strategy: GitMergeStrategy) => Promise<GitOperationResult>;
  continueMerge: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  abortMerge: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  startRebase: (repository: RepositoryTarget, upstream: string, onto?: string) => Promise<GitOperationResult>;
  getRebasePlan: (repository: RepositoryTarget, upstream: string) => Promise<GitRebasePlanItem[]>;
  startInteractiveRebase: (repository: RepositoryTarget, upstream: string, plan: GitRebasePlanItem[], onto?: string) => Promise<GitOperationResult>;
  continueRebase: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  skipRebase: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  abortRebase: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  continueCherryPick: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  skipCherryPick: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  abortCherryPick: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  continueRevert: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  skipRevert: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  abortRevert: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  startBisect: (repository: RepositoryTarget, badRef?: string, goodRef?: string) => Promise<GitOperationResult>;
  markBisectGood: (repository: RepositoryTarget, ref?: string) => Promise<GitOperationResult>;
  markBisectBad: (repository: RepositoryTarget, ref?: string) => Promise<GitOperationResult>;
  skipBisect: (repository: RepositoryTarget, refs?: string[]) => Promise<GitOperationResult>;
  resetBisect: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  showCommitSignature: (repository: RepositoryTarget, revision: string) => Promise<GitOperationResult>;
  verifyCommitSignature: (repository: RepositoryTarget, revision: string) => Promise<GitOperationResult>;
  renameBranch: (repository: RepositoryTarget, branchName: string, nextName: string, force?: boolean) => Promise<GitOperationResult>;
  deleteBranch: (repository: RepositoryTarget, branchName: string, force?: boolean) => Promise<GitOperationResult>;
  deleteRemoteBranch: (repository: RepositoryTarget, remoteName: string, branchName: string) => Promise<GitOperationResult>;
  getTags: (repository: RepositoryTarget) => Promise<GitTagInfo[]>;
  createTag: (repository: RepositoryTarget, name: string, target: string, message?: string) => Promise<GitOperationResult>;
  deleteTag: (repository: RepositoryTarget, name: string) => Promise<GitOperationResult>;
  pushTag: (repository: RepositoryTarget, remoteName: string, name: string) => Promise<GitOperationResult>;
  deleteRemoteTag: (repository: RepositoryTarget, remoteName: string, name: string) => Promise<GitOperationResult>;
  getReflog: (repository: RepositoryTarget, maxCount?: number) => Promise<GitReflogEntry[]>;
  resetToReflogEntry: (repository: RepositoryTarget, selector: string, mode: "mixed" | "hard") => Promise<GitOperationResult>;
  getLinkedWorktrees: (repository: RepositoryTarget) => Promise<GitLinkedWorktree[]>;
  addLinkedWorktree: (repository: RepositoryTarget, options: GitWorktreeAddOptions) => Promise<GitOperationResult>;
  removeLinkedWorktree: (repository: RepositoryTarget, worktreePath: string, force?: boolean) => Promise<GitOperationResult>;
  pruneLinkedWorktrees: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  lockLinkedWorktree: (repository: RepositoryTarget, worktreePath: string, reason?: string) => Promise<GitOperationResult>;
  unlockLinkedWorktree: (repository: RepositoryTarget, worktreePath: string) => Promise<GitOperationResult>;
  moveLinkedWorktree: (repository: RepositoryTarget, options: GitWorktreeMoveOptions) => Promise<GitOperationResult>;
  repairLinkedWorktrees: (repository: RepositoryTarget, worktreePaths?: string[]) => Promise<GitOperationResult>;
  getSubmodules: (repository: RepositoryTarget) => Promise<GitSubmoduleInfo[]>;
  initializeSubmodules: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  updateSubmodules: (repository: RepositoryTarget, options: GitSubmoduleUpdateOptions) => Promise<GitOperationResult>;
  syncSubmodules: (repository: RepositoryTarget, recursive?: boolean) => Promise<GitOperationResult>;
  addSubmodule: (repository: RepositoryTarget, options: GitSubmoduleAddOptions) => Promise<GitOperationResult>;
  setSubmoduleBranch: (repository: RepositoryTarget, modulePath: string, branch?: string) => Promise<GitOperationResult>;
  deinitializeSubmodule: (repository: RepositoryTarget, modulePath: string, force?: boolean) => Promise<GitOperationResult>;
  removeSubmodule: (repository: RepositoryTarget, modulePath: string, force?: boolean) => Promise<GitOperationResult>;
  getLfsStatus: (repository: RepositoryTarget) => Promise<GitLfsStatus>;
  installLfs: (repository: RepositoryTarget, scope?: "local" | "global") => Promise<GitOperationResult>;
  pullLfs: (repository: RepositoryTarget, remoteName?: string, refs?: string[], operation?: GitLongOperationOptions) => Promise<GitOperationResult>;
  pruneLfs: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  trackLfsPatterns: (repository: RepositoryTarget, patterns: string[]) => Promise<GitOperationResult>;
  untrackLfsPatterns: (repository: RepositoryTarget, patterns: string[]) => Promise<GitOperationResult>;
  getLfsLocks: (repository: RepositoryTarget) => Promise<GitLfsLock[]>;
  lockLfsFile: (repository: RepositoryTarget, filePath: string) => Promise<GitOperationResult>;
  unlockLfsFile: (repository: RepositoryTarget, lockId: string, force?: boolean) => Promise<GitOperationResult>;
  migrateLfs: (repository: RepositoryTarget, options: GitLfsMigrateOptions, operation?: GitLongOperationOptions) => Promise<GitOperationResult>;
  readGitIgnore: (repository: RepositoryTarget) => Promise<GitIgnoreDocument>;
  writeGitIgnore: (repository: RepositoryTarget, content: string, expectedRevision: string) => Promise<boolean>;
  getSigningConfig: (repository: RepositoryTarget) => Promise<GitSigningConfig>;
  setSigningConfig: (repository: RepositoryTarget, input: GitSigningConfigUpdate) => Promise<GitOperationResult>;
  getGitIdentity: (repository: RepositoryTarget) => Promise<GitIdentityConfig>;
  setGitIdentity: (repository: RepositoryTarget, input: GitIdentityUpdate) => Promise<GitOperationResult>;
  getHostingLinks: (repository: RepositoryTarget, remoteName: string, commitHash?: string, branchName?: string) => Promise<GitHostingLinks>;
  listHostingAccounts: () => Promise<GitHostingAccountSummary[]>;
  saveHostingAccount: (provider: GitHostingProvider, remoteUrl: string, token: string) => Promise<GitHostingAccountSummary>;
  removeHostingAccount: (provider: GitHostingProvider, host: string) => Promise<boolean>;
  listHostingChangeRequests: (provider: GitHostingProvider, remoteUrl: string) => Promise<GitHostingChangeRequest[]>;
  getHostingChangeRequest: (provider: GitHostingProvider, remoteUrl: string, number: number) => Promise<GitHostingChangeRequest>;
  createHostingChangeRequest: (provider: GitHostingProvider, remoteUrl: string, input: GitHostingCreateChangeInput) => Promise<GitHostingChangeRequest>;
  commentHostingChangeRequest: (provider: GitHostingProvider, remoteUrl: string, number: number, body: string) => Promise<boolean>;
  reviewHostingChangeRequest: (provider: GitHostingProvider, remoteUrl: string, input: GitHostingReviewInput) => Promise<boolean>;
  mergeHostingChangeRequest: (provider: GitHostingProvider, remoteUrl: string, input: GitHostingMergeInput) => Promise<boolean>;
  amendLastCommitMessage: (repository: RepositoryTarget, input: CommitMessageInput) => Promise<GitOperationResult>;
  resetLastCommit: (repository: RepositoryTarget, mode: GitResetMode) => Promise<GitOperationResult>;
  resetToCommit: (repository: RepositoryTarget, hash: string, mode: GitResetMode) => Promise<GitOperationResult>;
  revertCommit: (repository: RepositoryTarget, hash: string) => Promise<GitOperationResult>;
  cherryPickCommit: (repository: RepositoryTarget, hash: string) => Promise<GitOperationResult>;
}

declare global {
  interface Window {
    gitUI?: GitUIBridge;
  }
}
