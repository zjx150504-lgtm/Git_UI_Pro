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
  startTerminal: (repositoryPath: string) => Promise<TerminalSessionInfo>;
  writeTerminal: (sessionId: string, data: string) => Promise<boolean>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  disposeTerminal: (sessionId: string) => Promise<boolean>;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  chooseDirectory: () => Promise<string | null>;
  getProjects: () => Promise<GitProject[]>;
  addProject: (directoryPath: string) => Promise<GitProject>;
  scanProjects: (rootPath: string) => Promise<GitProject[]>;
  reorderProjects: (projectIds: string[]) => Promise<boolean>;
  setProjectFavorite: (projectId: string, favorite: boolean) => Promise<GitProject | undefined>;
  removeProject: (projectId: string) => Promise<boolean>;
  getProjectStatus: (repositoryPath: string) => Promise<GitStatusSummary>;
  getHistory: (repositoryPath: string, filter?: GitHistoryFilter) => Promise<CommitNode[]>;
  getHistoryRefs: (repositoryPath: string) => Promise<GitHistoryRef[]>;
  getCommitDetails: (repositoryPath: string, hash: string) => Promise<CommitNode>;
  getCommitDiff: (repositoryPath: string, hash: string, filePath?: string) => Promise<DiffLine[]>;
  getCommitFilePreview: (repositoryPath: string, hash: string, file: ChangedFile) => Promise<FilePreview | null>;
  getWorktree: (repositoryPath: string) => Promise<WorktreeState>;
  getWorktreeDiff: (repositoryPath: string, filePath: string, staged: boolean) => Promise<DiffLine[]>;
  getWorktreeFilePreview: (repositoryPath: string, file: ChangedFile) => Promise<FilePreview | null>;
  getConflictFileDetails: (repositoryPath: string, filePath: string) => Promise<ConflictFileDetails>;
  resolveConflictFile: (repositoryPath: string, filePath: string, input: ConflictResolutionInput) => Promise<GitOperationResult>;
  stageFile: (repositoryPath: string, filePath: string) => Promise<GitOperationResult>;
  stageAll: (repositoryPath: string) => Promise<GitOperationResult>;
  unstageFile: (repositoryPath: string, filePath: string) => Promise<GitOperationResult>;
  unstageAll: (repositoryPath: string) => Promise<GitOperationResult>;
  discardFile: (repositoryPath: string, file: ChangedFile) => Promise<GitOperationResult>;
  commit: (repositoryPath: string, input: CommitInput) => Promise<GitOperationResult>;
  fetch: (repositoryPath: string) => Promise<GitOperationResult>;
  pull: (repositoryPath: string) => Promise<GitOperationResult>;
  mergeRemote: (repositoryPath: string) => Promise<GitOperationResult>;
  push: (repositoryPath: string) => Promise<GitOperationResult>;
  getBranches: (repositoryPath: string) => Promise<BranchInfo[]>;
  createBranch: (repositoryPath: string, branchName: string, checkout: boolean, startPoint?: string) => Promise<GitOperationResult>;
  switchBranch: (repositoryPath: string, branch: BranchInfo) => Promise<GitOperationResult>;
  getMergePreview: (repositoryPath: string, targetBranch: string) => Promise<GitMergePreview>;
  mergeCurrentBranch: (repositoryPath: string, targetBranch: string, strategy: GitMergeStrategy) => Promise<GitOperationResult>;
  continueMerge: (repositoryPath: string) => Promise<GitOperationResult>;
  abortMerge: (repositoryPath: string) => Promise<GitOperationResult>;
  deleteBranch: (repositoryPath: string, branchName: string) => Promise<GitOperationResult>;
  amendLastCommitMessage: (repositoryPath: string, input: CommitMessageInput) => Promise<GitOperationResult>;
  resetLastCommit: (repositoryPath: string, mode: Exclude<GitResetMode, "hard">) => Promise<GitOperationResult>;
  resetToCommit: (repositoryPath: string, hash: string, mode: GitResetMode) => Promise<GitOperationResult>;
  revertCommit: (repositoryPath: string, hash: string) => Promise<GitOperationResult>;
  cherryPickCommit: (repositoryPath: string, hash: string) => Promise<GitOperationResult>;
}

declare global {
  interface Window {
    gitUI?: GitUIBridge;
  }
}
