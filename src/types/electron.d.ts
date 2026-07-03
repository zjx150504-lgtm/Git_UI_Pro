import type { BranchInfo, ChangedFile, CommitInput, CommitNode, DiffLine, GitOperationResult, GitProject, GitStatusSummary, WorktreeState } from "./domain";

export interface GitUIBridge {
  runAppCommand: (command: string) => Promise<boolean>;
  setNativeTheme: (themeSource: "system" | "light" | "dark") => Promise<boolean>;
  getGitVersion: () => Promise<GitOperationResult>;
  chooseDirectory: () => Promise<string | null>;
  getProjects: () => Promise<GitProject[]>;
  addProject: (directoryPath: string) => Promise<GitProject>;
  scanProjects: (rootPath: string) => Promise<GitProject[]>;
  removeProject: (projectId: string) => Promise<boolean>;
  getProjectStatus: (repositoryPath: string) => Promise<GitStatusSummary>;
  getHistory: (repositoryPath: string) => Promise<CommitNode[]>;
  getCommitDetails: (repositoryPath: string, hash: string) => Promise<CommitNode>;
  getCommitDiff: (repositoryPath: string, hash: string, filePath?: string) => Promise<DiffLine[]>;
  getWorktree: (repositoryPath: string) => Promise<WorktreeState>;
  getWorktreeDiff: (repositoryPath: string, filePath: string, staged: boolean) => Promise<DiffLine[]>;
  stageFile: (repositoryPath: string, filePath: string) => Promise<GitOperationResult>;
  stageAll: (repositoryPath: string) => Promise<GitOperationResult>;
  unstageFile: (repositoryPath: string, filePath: string) => Promise<GitOperationResult>;
  unstageAll: (repositoryPath: string) => Promise<GitOperationResult>;
  discardFile: (repositoryPath: string, file: ChangedFile) => Promise<GitOperationResult>;
  commit: (repositoryPath: string, input: CommitInput) => Promise<GitOperationResult>;
  fetch: (repositoryPath: string) => Promise<GitOperationResult>;
  pull: (repositoryPath: string) => Promise<GitOperationResult>;
  push: (repositoryPath: string) => Promise<GitOperationResult>;
  getBranches: (repositoryPath: string) => Promise<BranchInfo[]>;
  createBranch: (repositoryPath: string, branchName: string, checkout: boolean) => Promise<GitOperationResult>;
  switchBranch: (repositoryPath: string, branch: BranchInfo) => Promise<GitOperationResult>;
  deleteBranch: (repositoryPath: string, branchName: string) => Promise<GitOperationResult>;
}

declare global {
  interface Window {
    gitUI?: GitUIBridge;
  }
}
