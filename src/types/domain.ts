export interface GitProject {
  id: string;
  name: string;
  path: string;
  groupId?: string;
  favorite: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  status?: GitStatusSummary;
}

export interface GitStatusSummary {
  currentBranch: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  hasConflicts: boolean;
  operationState?: "merge" | "rebase" | "cherry-pick" | "revert";
}

export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  body?: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  refs: CommitRef[];
  lane: number;
  color: string;
  files: ChangedFile[];
}

export interface CommitRef {
  type: "head" | "localBranch" | "remoteBranch" | "tag";
  name: string;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";
  staged: boolean;
}

export interface DiffLine {
  type: "context" | "add" | "delete";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface WorktreeState {
  stagedFiles: ChangedFile[];
  unstagedFiles: ChangedFile[];
}

export interface CommitInput {
  subject: string;
  body?: string;
  amend?: boolean;
}

export interface GitOperationResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  messageZh?: string;
}

export type MainView = "history" | "workspace";
