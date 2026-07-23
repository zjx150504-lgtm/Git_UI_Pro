export interface GitProject {
  id: string;
  name: string;
  path: string;
  remote?: SshConnection;
  groupId?: string;
  favorite: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  status?: GitStatusSummary;
}

export interface SshConnection {
  type: "ssh";
  host: string;
  username?: string;
  port?: number;
  identityFile?: string;
}

export interface RepositoryTarget {
  path: string;
  remote?: SshConnection;
}

export interface RemoteProjectInput {
  host: string;
  username?: string;
  port?: number;
  repositoryPath: string;
  identityFile?: string;
}

export interface RemoteProjectTestResult extends GitOperationResult {
  repositoryRoot?: string;
  projectName?: string;
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
  operationState?: GitOperationState;
  mergeSourceBranch?: string;
  mergeTargetBranch?: string;
}

export type GitOperationState = "merge" | "rebase" | "cherry-pick" | "revert" | "bisect";
export type GitMergeStrategy = "ff" | "no-ff";
export type GitMergeMode = "up-to-date" | "fast-forward" | "merge-commit";

export interface GitMergePreview {
  sourceBranch: string;
  targetBranch: string;
  targetUpstream?: string;
  targetAhead: number;
  targetBehind: number;
  mode: GitMergeMode;
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

export interface ConflictFileDetails {
  path: string;
  baseContent?: string;
  currentContent?: string;
  incomingContent?: string;
  resultContent?: string;
  baseExists: boolean;
  currentExists: boolean;
  incomingExists: boolean;
  resultExists: boolean;
  currentLabel: string;
  incomingLabel: string;
  editable: boolean;
  isBinary: boolean;
  token: string;
}

export interface ConflictResolutionInput {
  choice: "content" | "current" | "incoming";
  content?: string;
  expectedToken: string;
}

export interface FilePreview {
  type: "image" | "video";
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  sourceDescription: string;
}

export interface WorktreeState {
  stagedFiles: ChangedFile[];
  unstagedFiles: ChangedFile[];
}

export interface BranchInfo {
  name: string;
  fullName: string;
  type: "local" | "remote";
  current: boolean;
  upstream?: string;
  headHash: string;
}

export type GitHistoryFilterMode = "auto" | "all" | "custom";

export interface GitHistoryFilter {
  mode: GitHistoryFilterMode;
  refIds?: string[];
}

export interface GitHistoryRef {
  id: string;
  name: string;
  type: "branch" | "remoteBranch" | "tag";
  revision: string;
  category: "branches" | "remote branches" | "tags";
  current?: boolean;
  upstream?: boolean;
}

export interface CommitInput {
  subject: string;
  body?: string;
  amend?: boolean;
  pushAfterCommit?: boolean;
}

export interface CommitMessageInput {
  subject: string;
  body?: string;
}

export type GitResetMode = "soft" | "mixed" | "hard";
export type CommitGraphAction =
  | "copyHash"
  | "copyMessage"
  | "amendMessage"
  | "revert"
  | "cherryPick"
  | "createBranch"
  | "resetSoft"
  | "resetMixed"
  | "resetHard";

export interface GitOperationResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  messageZh?: string;
}

export interface TerminalSessionInfo {
  sessionId: string;
  shell: string;
  cwd: string;
}

export interface TerminalDataEvent {
  sessionId: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number | null;
  signal: string | null;
}

export type MainView = "history" | "workspace";
