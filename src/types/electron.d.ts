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
  GitHistoryRef,
  GitMergePreview,
  GitMergeStrategy,
  GitOperationResult,
  GitProject,
  GitResetMode,
  GitStatusSummary,
  RemoteProjectInput,
  RemoteProjectTestResult,
  RepositoryTarget,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
  WorktreeState
} from "./domain";

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface GitUIBridge {
  runAppCommand: (command: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  setNativeTheme: (themeSource: "system" | "light" | "dark") => Promise<boolean>;
  getWindowState: () => Promise<WindowState>;
  onWindowStateChange: (callback: (state: WindowState) => void) => () => void;
  getGitVersion: () => Promise<GitOperationResult>;
  startTerminal: (repository: RepositoryTarget) => Promise<TerminalSessionInfo>;
  writeTerminal: (sessionId: string, data: string) => Promise<boolean>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  disposeTerminal: (sessionId: string) => Promise<boolean>;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  chooseDirectory: () => Promise<string | null>;
  chooseIdentityFile: () => Promise<string | null>;
  getProjects: () => Promise<GitProject[]>;
  addProject: (directoryPath: string) => Promise<GitProject>;
  testRemoteProject: (input: RemoteProjectInput) => Promise<RemoteProjectTestResult>;
  addRemoteProject: (input: RemoteProjectInput) => Promise<GitProject>;
  scanProjects: (rootPath: string) => Promise<GitProject[]>;
  reorderProjects: (projectIds: string[]) => Promise<boolean>;
  setProjectFavorite: (projectId: string, favorite: boolean) => Promise<GitProject | undefined>;
  removeProject: (projectId: string) => Promise<boolean>;
  getProjectStatus: (repository: RepositoryTarget) => Promise<GitStatusSummary>;
  getHistory: (repository: RepositoryTarget, filter?: GitHistoryFilter) => Promise<CommitNode[]>;
  getHistoryRefs: (repository: RepositoryTarget) => Promise<GitHistoryRef[]>;
  getCommitDetails: (repository: RepositoryTarget, hash: string) => Promise<CommitNode>;
  getCommitDiff: (repository: RepositoryTarget, hash: string, filePath?: string) => Promise<DiffLine[]>;
  getCommitFilePreview: (repository: RepositoryTarget, hash: string, file: ChangedFile) => Promise<FilePreview | null>;
  getWorktree: (repository: RepositoryTarget) => Promise<WorktreeState>;
  getWorktreeDiff: (repository: RepositoryTarget, filePath: string, staged: boolean) => Promise<DiffLine[]>;
  getWorktreeFilePreview: (repository: RepositoryTarget, file: ChangedFile) => Promise<FilePreview | null>;
  getConflictFileDetails: (repository: RepositoryTarget, filePath: string) => Promise<ConflictFileDetails>;
  resolveConflictFile: (repository: RepositoryTarget, filePath: string, input: ConflictResolutionInput) => Promise<GitOperationResult>;
  stageFile: (repository: RepositoryTarget, filePath: string) => Promise<GitOperationResult>;
  stageAll: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  unstageFile: (repository: RepositoryTarget, filePath: string) => Promise<GitOperationResult>;
  unstageAll: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  discardFile: (repository: RepositoryTarget, file: ChangedFile) => Promise<GitOperationResult>;
  commit: (repository: RepositoryTarget, input: CommitInput) => Promise<GitOperationResult>;
  fetch: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  pull: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  mergeRemote: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  push: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  getBranches: (repository: RepositoryTarget) => Promise<BranchInfo[]>;
  createBranch: (repository: RepositoryTarget, branchName: string, checkout: boolean, startPoint?: string) => Promise<GitOperationResult>;
  switchBranch: (repository: RepositoryTarget, branch: BranchInfo) => Promise<GitOperationResult>;
  getMergePreview: (repository: RepositoryTarget, targetBranch: string) => Promise<GitMergePreview>;
  mergeCurrentBranch: (repository: RepositoryTarget, targetBranch: string, strategy: GitMergeStrategy) => Promise<GitOperationResult>;
  continueMerge: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  abortMerge: (repository: RepositoryTarget) => Promise<GitOperationResult>;
  deleteBranch: (repository: RepositoryTarget, branchName: string) => Promise<GitOperationResult>;
  amendLastCommitMessage: (repository: RepositoryTarget, input: CommitMessageInput) => Promise<GitOperationResult>;
  resetLastCommit: (repository: RepositoryTarget, mode: Exclude<GitResetMode, "hard">) => Promise<GitOperationResult>;
  resetToCommit: (repository: RepositoryTarget, hash: string, mode: GitResetMode) => Promise<GitOperationResult>;
  revertCommit: (repository: RepositoryTarget, hash: string) => Promise<GitOperationResult>;
  cherryPickCommit: (repository: RepositoryTarget, hash: string) => Promise<GitOperationResult>;
}

declare global {
  interface Window {
    gitUI?: GitUIBridge;
  }
}
