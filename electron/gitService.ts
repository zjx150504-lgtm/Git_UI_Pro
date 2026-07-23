import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { RemoteProjectInput, SshConnection } from "./configStore";

export interface RepositoryTarget {
  path: string;
  remote?: SshConnection;
}

export type RepositoryLocation = string | RepositoryTarget;

export interface GitOperationResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  messageZh?: string;
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

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";
  staged: boolean;
}

export interface CommitRef {
  type: "head" | "localBranch" | "remoteBranch" | "tag";
  name: string;
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

interface ManagedMergeState {
  sourceBranch: string;
  targetBranch: string;
  startedAt: string;
}

interface ConflictSnapshot {
  path: string;
  base: Buffer | null;
  current: Buffer | null;
  incoming: Buffer | null;
  result: Buffer | null;
  token: string;
}

const fieldSeparator = "\x1f";
const recordSeparator = "\x1e";
const resetCommandTimeoutMs = 30_000;
const mergeCommandTimeoutMs = 120_000;
const managedMergeStateFile = "git-ui-pro-merge-state.json";
const maxEditableConflictBytes = 2 * 1024 * 1024;
const maxPreviewImageBytes = 25 * 1024 * 1024;
const maxPreviewVideoBytes = 80 * 1024 * 1024;

const graphColors = ["#51c2a9", "#7aa7ff", "#d69cff", "#f0c36b", "#ef6b73", "#8bd38b"];
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const fallbackPathDecoder = new TextDecoder("gb18030");
const gitOperationMarkers: Array<{ path: string; state: GitOperationState }> = [
  { path: "rebase-merge", state: "rebase" },
  { path: "rebase-apply", state: "rebase" },
  { path: "MERGE_HEAD", state: "merge" },
  { path: "CHERRY_PICK_HEAD", state: "cherry-pick" },
  { path: "REVERT_HEAD", state: "revert" },
  { path: "BISECT_LOG", state: "bisect" }
];

const skippedDirectoryNames = new Set([
  ".git",
  "node_modules",
  ".cache",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo"
]);

function createGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    LC_ALL: "C.UTF-8",
    LANG: "C.UTF-8",
    LESSCHARSET: "utf-8",
    OUTPUT_CHARSET: "UTF-8"
  };

  return appendGitConfig(env, [
    ["core.quotepath", "false"],
    ["i18n.commitEncoding", "utf-8"],
    ["i18n.logOutputEncoding", "utf-8"]
  ]);
}

function appendGitConfig(env: NodeJS.ProcessEnv, entries: Array<[string, string]>): NodeJS.ProcessEnv {
  const existingCount = Number(env.GIT_CONFIG_COUNT);
  const baseIndex = Number.isInteger(existingCount) && existingCount >= 0 ? existingCount : 0;

  entries.forEach(([key, value], index) => {
    const slot = baseIndex + index;
    env[`GIT_CONFIG_KEY_${slot}`] = key;
    env[`GIT_CONFIG_VALUE_${slot}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(baseIndex + entries.length);

  return env;
}

function decodeGitOutput(buffer: Buffer): string {
  if (buffer.byteLength === 0) {
    return "";
  }

  try {
    return utf8Decoder.decode(buffer);
  } catch {
    return process.platform === "win32" ? fallbackPathDecoder.decode(buffer) : buffer.toString("utf8");
  }
}

export class GitService {
  private readonly activeMergeRepositories = new Set<string>();

  async run(cwd: RepositoryLocation, args: string[], options: { timeoutMs?: number } = {}): Promise<GitOperationResult> {
    const result = await this.runProcess(cwd, args, options);
    return {
      ...result,
      stdout: decodeGitOutput(result.stdout)
    };
  }

  private async runBinary(
    cwd: RepositoryLocation,
    args: string[],
    options: { timeoutMs?: number } = {}
  ): Promise<Omit<GitOperationResult, "stdout"> & { stdout: Buffer }> {
    return this.runProcess(cwd, args, options);
  }

  private async runProcess(
    cwd: RepositoryLocation,
    args: string[],
    options: { timeoutMs?: number } = {}
  ): Promise<Omit<GitOperationResult, "stdout"> & { stdout: Buffer }> {
    return new Promise((resolve) => {
      const target = normalizeRepositoryTarget(cwd);
      const remoteCommand = target.remote ? buildRemoteGitCommand(target.path, args) : undefined;
      const executable = target.remote ? "ssh" : "git";
      const executableArgs = target.remote ? [...buildSshArgs(target.remote, true), remoteCommand!] : args;
      const command = target.remote ? `ssh ${sshDestination(target.remote)} -- git ${args.join(" ")}` : `git ${args.join(" ")}`;
      let settled = false;
      const child = spawn(executable, executableArgs, {
        cwd: target.remote ? process.cwd() : target.path,
        env: createGitEnv(),
        shell: false,
        windowsHide: true
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const finish = (result: Omit<GitOperationResult, "stdout"> & { stdout: Buffer }) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(result);
      };
      const timeoutId = options.timeoutMs
        ? setTimeout(() => {
            const timeoutText = `Git command timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s.`;
            const stderrText = decodeGitOutput(Buffer.concat(stderrChunks));
            const stderr = stderrText ? `${stderrText}\n${timeoutText}` : timeoutText;
            child.kill();
            finish({
              ok: false,
              command,
              stdout: Buffer.concat(stdoutChunks),
              stderr,
              exitCode: -1,
              messageZh: target.remote ? "远程 Git 命令执行超时，请检查 SSH 连接后重试" : "Git 命令执行超时，请确认仓库未被其它进程锁定后重试"
            });
          }, options.timeoutMs)
        : undefined;

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (error) => {
        finish({
          ok: false,
          command,
          stdout: Buffer.concat(stdoutChunks),
          stderr: error.message,
          exitCode: -1,
          messageZh: target.remote ? "无法执行 SSH，请确认本机已安装 OpenSSH 并加入 PATH。" : "无法执行 Git 命令，请确认本机已安装 Git 并加入 PATH。"
        });
      });

      child.on("close", (code) => {
        const exitCode = code ?? -1;
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = decodeGitOutput(Buffer.concat(stderrChunks));
        finish({
          ok: exitCode === 0,
          command,
          stdout,
          stderr,
          exitCode,
          messageZh: exitCode === 0 ? undefined : target.remote ? toChineseSshError(stderr) : toChineseGitError(decodeGitOutput(stdout), stderr)
        });
      });
      child.stdin.end();
    });
  }

  async getVersion(): Promise<GitOperationResult> {
    return this.run(process.cwd(), ["--version"]);
  }

  async getRepositoryRoot(candidatePath: string): Promise<string> {
    const result = await this.run(candidatePath, ["rev-parse", "--show-toplevel"]);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "所选目录不是 Git 仓库。");
    }
    return result.stdout.trim();
  }

  async testRemoteRepository(input: RemoteProjectInput): Promise<GitOperationResult & { repositoryRoot?: string; projectName?: string }> {
    const validationError = validateRemoteProjectInput(input);
    if (validationError) {
      return gitFailure("ssh", validationError);
    }

    const target: RepositoryTarget = {
      path: input.repositoryPath.trim(),
      remote: {
        type: "ssh",
        host: input.host.trim(),
        username: input.username?.trim() || undefined,
        port: input.port,
        identityFile: input.identityFile?.trim() || undefined
      }
    };
    const result = await this.run(target, ["rev-parse", "--show-toplevel"], { timeoutMs: 20_000 });
    if (!result.ok) {
      return result;
    }

    const repositoryRoot = result.stdout.trim();
    return {
      ...result,
      repositoryRoot,
      projectName: path.posix.basename(repositoryRoot) || target.remote!.host
    };
  }

  async getStatus(repositoryPath: RepositoryLocation): Promise<GitStatusSummary> {
    const result = await this.run(repositoryPath, ["status", "--porcelain=v2", "--branch", "--ignored=matching"]);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取仓库状态。");
    }

    const summary = parseStatus(result.stdout);
    summary.operationState = await this.getOperationState(repositoryPath);
    if (summary.operationState === "merge") {
      const managedState = await this.readManagedMergeState(repositoryPath);
      summary.mergeSourceBranch = managedState?.sourceBranch;
      summary.mergeTargetBranch = managedState?.targetBranch;
    } else {
      await this.clearManagedMergeState(repositoryPath);
    }
    return summary;
  }

  private async getOperationState(repositoryPath: RepositoryLocation): Promise<GitOperationState | undefined> {
    const result = await this.run(repositoryPath, ["rev-parse", ...gitOperationMarkers.flatMap((marker) => ["--git-path", marker.path])]);
    if (!result.ok) {
      return undefined;
    }

    const markerPaths = result.stdout.split(/\r?\n/).filter(Boolean);
    const target = normalizeRepositoryTarget(repositoryPath);
    if (target.remote) {
      const checks = markerPaths
        .map((markerPath, index) => `test -e ${shellQuote(resolveGitReportedPath(repositoryPath, markerPath))} && printf '${index}\\n'`)
        .join("; ") + "; true";
      const checkResult = await runSshShell(target.remote, checks, { timeoutMs: 10_000 });
      const markerIndex = checkResult.ok ? Number(checkResult.stdout.toString("utf8").split(/\r?\n/).find(Boolean)) : Number.NaN;
      return Number.isInteger(markerIndex) ? gitOperationMarkers[markerIndex]?.state : undefined;
    }

    for (const [index, marker] of gitOperationMarkers.entries()) {
      const markerPath = markerPaths[index];
      if (!markerPath) {
        continue;
      }

      const markerTargetPath = resolveGitReportedPath(repositoryPath, markerPath);
      if (await pathExists(markerTargetPath)) {
        return marker.state;
      }
    }

    return undefined;
  }

  async getHistory(repositoryPath: RepositoryLocation, filter: GitHistoryFilter = { mode: "auto" }, maxCount = 300): Promise<CommitNode[]> {
    const status = await this.getStatus(repositoryPath).catch(() => undefined);
    const revisions = await this.getHistoryRevisions(repositoryPath, status, filter);
    const format = [
      "%H",
      "%P",
      "%an",
      "%ae",
      "%aI",
      "%cn",
      "%ce",
      "%cI",
      "%D",
      "%s",
      "%b"
    ].join(`%x${fieldSeparator.charCodeAt(0).toString(16)}`);

    const result = await this.run(repositoryPath, [
      "log",
      "--topo-order",
      "--decorate=full",
      "--date=iso-strict",
      `--max-count=${maxCount}`,
      `--pretty=format:${format}%x${recordSeparator.charCodeAt(0).toString(16)}`,
      ...revisions
    ]);

    if (!result.ok) {
      if (isEmptyRepositoryError(result.stderr)) {
        return [];
      }
      throw new Error(result.messageZh ?? "无法读取提交历史。");
    }

    return parseCommitLog(result.stdout);
  }

  async getHistoryRefs(repositoryPath: RepositoryLocation): Promise<GitHistoryRef[]> {
    const [status, refsResult] = await Promise.all([
      this.getStatus(repositoryPath).catch(() => undefined),
      this.run(repositoryPath, [
        "for-each-ref",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
        `--format=%(refname)${fieldSeparator}%(refname:short)${fieldSeparator}%(objectname)`
      ])
    ]);

    if (!refsResult.ok) {
      throw new Error(refsResult.messageZh ?? "无法读取图表引用列表。");
    }

    return refsResult.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): GitHistoryRef | null => {
        const [fullName, shortName, revision] = line.split(fieldSeparator);
        if (!fullName || !shortName || fullName === "refs/remotes/origin/HEAD" || shortName.endsWith("/HEAD")) {
          return null;
        }

        if (fullName.startsWith("refs/remotes/")) {
          return {
            id: fullName,
            name: shortName,
            type: "remoteBranch",
            revision: revision ?? "",
            category: "remote branches",
            upstream: shortName === status?.upstream
          };
        }

        if (fullName.startsWith("refs/tags/")) {
          return {
            id: fullName,
            name: shortName,
            type: "tag",
            revision: revision ?? "",
            category: "tags"
          };
        }

        return {
          id: fullName,
          name: shortName,
          type: "branch",
          revision: revision ?? "",
          category: "branches",
          current: shortName === status?.currentBranch
        };
      })
      .filter((ref): ref is GitHistoryRef => Boolean(ref))
      .sort(compareHistoryRefs);
  }

  async getCommitDetails(repositoryPath: RepositoryLocation, hash: string): Promise<CommitNode> {
    const commits = await this.getSingleCommit(repositoryPath, hash);
    const commit = commits[0];
    if (!commit) {
      throw new Error("找不到指定提交。");
    }

    const filesArgs =
      commit.parents.length > 1
        ? ["diff", "--name-status", "-r", "-M", `${hash}^1`, hash]
        : ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", hash];
    const filesResult = await this.run(repositoryPath, filesArgs);
    if (!filesResult.ok) {
      throw new Error(filesResult.messageZh ?? "无法读取提交变更文件。");
    }

    return {
      ...commit,
      files: parseNameStatus(filesResult.stdout)
    };
  }

  async getCommitDiff(repositoryPath: RepositoryLocation, hash: string, filePath?: string): Promise<DiffLine[]> {
    const commits = await this.getSingleCommit(repositoryPath, hash);
    const commit = commits[0];
    if (!commit) {
      throw new Error("找不到指定提交。");
    }

    const args =
      commit.parents.length > 1
        ? ["diff", "--patch", "--find-renames", "--no-ext-diff", `${hash}^1`, hash]
        : ["show", "--format=", "--patch", "--find-renames", "--no-ext-diff", hash];
    if (filePath) {
      args.push("--", filePath);
    }

    const result = await this.run(repositoryPath, args);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取提交 diff。");
    }

    return parseUnifiedDiff(result.stdout);
  }

  async getCommitFilePreview(repositoryPath: RepositoryLocation, hash: string, file: ChangedFile): Promise<FilePreview | null> {
    const targetPath = file.status === "deleted" ? file.oldPath ?? file.path : file.path;
    const media = previewMediaFromPath(targetPath);
    if (!media) {
      return null;
    }

    const revision = file.status === "deleted" ? `${hash}^` : hash;
    const result = await this.readGitBlob(repositoryPath, revision, targetPath);
    if (!result) {
      return null;
    }

    return createFilePreview(result, media, file.status === "deleted" ? "删除前版本" : "提交版本");
  }

  async getWorktree(repositoryPath: RepositoryLocation): Promise<WorktreeState> {
    const [statusResult, untrackedResult] = await Promise.all([
      this.run(repositoryPath, ["status", "--porcelain=v2"]),
      this.run(repositoryPath, ["ls-files", "--others", "--exclude-standard"])
    ]);

    if (!statusResult.ok) {
      throw new Error(statusResult.messageZh ?? "无法读取工作区状态。");
    }

    const worktree = parseWorktree(statusResult.stdout);
    if (untrackedResult.ok) {
      const existingPaths = new Set([...worktree.stagedFiles, ...worktree.unstagedFiles].map((file) => file.path));
      for (const filePath of untrackedResult.stdout.split(/\r?\n/).filter(Boolean)) {
        if (!existingPaths.has(filePath)) {
          worktree.unstagedFiles.push({ path: filePath, status: "untracked", staged: false });
        }
      }
    }

    return sortWorktree(worktree);
  }

  async getWorktreeDiff(repositoryPath: RepositoryLocation, filePath: string, staged: boolean): Promise<DiffLine[]> {
    const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    const result = await this.run(repositoryPath, args);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取文件 diff。");
    }
    const diffLines = parseUnifiedDiff(result.stdout);
    if (diffLines.length > 0 || staged) {
      return diffLines;
    }

    if (await this.isUntrackedFile(repositoryPath, filePath)) {
      return this.readFileAsAddedDiff(repositoryPath, filePath);
    }

    return diffLines;
  }

  async getConflictFileDetails(repositoryPath: RepositoryLocation, filePath: string): Promise<ConflictFileDetails> {
    const snapshot = await this.loadConflictSnapshot(repositoryPath, filePath);
    const [status, managedState, incomingLabel] = await Promise.all([
      this.getStatus(repositoryPath),
      this.readManagedMergeState(repositoryPath),
      this.getMergeHeadLabel(repositoryPath)
    ]);
    const buffers = [snapshot.base, snapshot.current, snapshot.incoming, snapshot.result].filter((value): value is Buffer => Boolean(value));
    const isBinary = buffers.some(isBinaryBuffer);
    const editable = !isBinary && buffers.every((buffer) => buffer.byteLength <= maxEditableConflictBytes);

    return {
      path: snapshot.path,
      baseContent: editable && snapshot.base ? decodeGitOutput(snapshot.base) : undefined,
      currentContent: editable && snapshot.current ? decodeGitOutput(snapshot.current) : undefined,
      incomingContent: editable && snapshot.incoming ? decodeGitOutput(snapshot.incoming) : undefined,
      resultContent: editable && snapshot.result ? decodeGitOutput(snapshot.result) : undefined,
      baseExists: Boolean(snapshot.base),
      currentExists: Boolean(snapshot.current),
      incomingExists: Boolean(snapshot.incoming),
      resultExists: Boolean(snapshot.result),
      currentLabel: managedState?.targetBranch ?? status.currentBranch ?? "当前分支",
      incomingLabel: managedState?.sourceBranch ?? incomingLabel ?? "传入分支",
      editable,
      isBinary,
      token: snapshot.token
    };
  }

  async resolveConflictFile(repositoryPath: RepositoryLocation, filePath: string, input: ConflictResolutionInput): Promise<GitOperationResult> {
    try {
      const snapshot = await this.loadConflictSnapshot(repositoryPath, filePath);
      if (snapshot.token !== input.expectedToken) {
        return gitFailure("git add", "冲突文件已被外部修改，请重新打开后再解决。", "Conflict snapshot changed.");
      }

      let resolvedContent: Buffer | null;
      if (input.choice === "current") {
        resolvedContent = snapshot.current;
      } else if (input.choice === "incoming") {
        resolvedContent = snapshot.incoming;
      } else {
        if (typeof input.content !== "string") {
          return gitFailure("git add", "缺少合并结果内容。", "Resolved content is missing.");
        }
        if (!isEditableConflictSnapshot(snapshot)) {
          return gitFailure("git add", "该冲突文件无法作为文本编辑，请采用当前版本或传入版本。", "Conflict is binary or too large.");
        }
        if (containsConflictMarkers(input.content)) {
          return gitFailure("git add", "合并结果仍包含冲突标记，请处理全部冲突块后再保存。", "Conflict markers remain.");
        }
        resolvedContent = Buffer.from(input.content, "utf8");
      }

      if (!resolvedContent) {
        return this.run(repositoryPath, ["rm", "-f", "--", snapshot.path]);
      }

      await this.writeRepositoryFile(repositoryPath, snapshot.path, resolvedContent);
      return this.run(repositoryPath, ["add", "--", snapshot.path]);
    } catch (error) {
      return gitFailure("git add", errorMessage(error, "解决冲突文件失败。"));
    }
  }

  async getWorktreeFilePreview(repositoryPath: RepositoryLocation, file: ChangedFile): Promise<FilePreview | null> {
    const previewPath = file.status === "deleted" ? file.oldPath ?? file.path : file.path;
    const media = previewMediaFromPath(previewPath);
    if (!media) {
      return null;
    }

    if (file.staged) {
      const indexBlob = file.status === "deleted" ? null : await this.readGitBlob(repositoryPath, "", file.path, true);
      if (indexBlob) {
        return createFilePreview(indexBlob, media, "暂存版本");
      }
    }

    if (file.status !== "deleted") {
      const worktreeBlob = await this.readRepositoryFile(repositoryPath, file.path);
      if (worktreeBlob) {
        return createFilePreview(worktreeBlob, media, file.staged ? "工作区版本" : "当前工作区版本");
      }
    }

    const previousBlob = await this.readGitBlob(repositoryPath, "HEAD", file.oldPath ?? file.path);
    if (previousBlob) {
      return createFilePreview(previousBlob, media, "删除前版本");
    }

    return null;
  }

  async stageFile(repositoryPath: RepositoryLocation, filePath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["add", "--", filePath]);
  }

  async stageAll(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["add", "-A"]);
  }

  async unstageFile(repositoryPath: RepositoryLocation, filePath: string): Promise<GitOperationResult> {
    return this.runWithFallbacks(repositoryPath, [
      ["restore", "--staged", "--", filePath],
      ["reset", "--", filePath],
      ["rm", "--cached", "-r", "--", filePath]
    ]);
  }

  async unstageAll(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    return this.runWithFallbacks(repositoryPath, [
      ["restore", "--staged", "--", "."],
      ["reset"],
      ["rm", "--cached", "-r", "--", "."]
    ]);
  }

  async discardFile(repositoryPath: RepositoryLocation, file: ChangedFile): Promise<GitOperationResult> {
    if (file.staged) {
      const unstageResult = await this.unstageFile(repositoryPath, file.path);
      if (!unstageResult.ok) {
        return unstageResult;
      }
    }

    if (file.status === "untracked" || file.status === "added") {
      return this.run(repositoryPath, ["clean", "-fd", "--", file.path]);
    }

    return this.run(repositoryPath, ["restore", "--", file.path]);
  }

  async commit(repositoryPath: RepositoryLocation, input: CommitInput): Promise<GitOperationResult> {
    const subject = input.subject.trim();
    if (!subject && !input.amend) {
      throw new Error("提交标题不能为空。");
    }

    const args = ["commit"];
    if (input.amend) {
      args.push("--amend");
    }
    if (subject) {
      args.push("-m", subject);
    } else if (input.amend) {
      args.push("--no-edit");
    }
    if (input.body?.trim() && subject) {
      args.push("-m", input.body.trim());
    }

    const commitResult = await this.run(repositoryPath, args);
    if (!commitResult.ok || !input.pushAfterCommit) {
      return commitResult;
    }

    const pushResult = await this.push(repositoryPath);
    return {
      ...pushResult,
      command: `${commitResult.command} && ${pushResult.command}`,
      stdout: [commitResult.stdout, pushResult.stdout].filter(Boolean).join("\n"),
      stderr: [commitResult.stderr, pushResult.stderr].filter(Boolean).join("\n")
    };
  }

  async fetch(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["fetch", "--prune"]);
  }

  async pull(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["pull", "--ff-only"]);
  }

  async mergeRemote(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    const repositoryKey = this.mergeRepositoryKey(repositoryPath);
    if (this.activeMergeRepositories.has(repositoryKey)) {
      return gitFailure("git merge", "当前仓库正在执行合并操作，请稍候。", "Another merge operation is already running.");
    }

    this.activeMergeRepositories.add(repositoryKey);
    try {
      let status = await this.getStatus(repositoryPath);
      const validationFailure = validateRemoteMergeStatus(status);
      if (validationFailure) {
        return validationFailure;
      }

      const fetchResult = await this.fetch(repositoryPath);
      if (!fetchResult.ok) {
        return fetchResult;
      }

      status = await this.getStatus(repositoryPath);
      const refreshedValidationFailure = validateRemoteMergeStatus(status, true);
      if (refreshedValidationFailure) {
        return combineGitResults([fetchResult, refreshedValidationFailure], false);
      }

      if (status.behind === 0) {
        return {
          ...fetchResult,
          messageZh: "远程分支没有需要合并的新提交。"
        };
      }

      const mergeResult = await this.run(repositoryPath, ["merge", "--no-edit", status.upstream!], {
        timeoutMs: mergeCommandTimeoutMs
      });
      return combineGitResults([fetchResult, mergeResult], mergeResult.ok);
    } catch (error) {
      return gitFailure("git fetch --prune ; git merge", errorMessage(error, "合并远程更改失败。"));
    } finally {
      this.activeMergeRepositories.delete(repositoryKey);
    }
  }

  async push(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    const status = await this.getStatus(repositoryPath).catch(() => undefined);
    if (status?.upstream || !status?.currentBranch) {
      return this.run(repositoryPath, ["push"]);
    }

    const remote = await this.getPushRemote(repositoryPath, status.currentBranch);
    if (!remote) {
      return {
        ok: false,
        command: "git push",
        stdout: "",
        stderr: "Current branch has no upstream branch and no default push remote could be determined.",
        exitCode: -1,
        messageZh: "当前分支还没有关联远程分支，且无法确定默认远程仓库。请先配置 remote.pushDefault 或手动设置 upstream。"
      };
    }

    return this.run(repositoryPath, ["push", "--set-upstream", remote, status.currentBranch]);
  }

  async getBranches(repositoryPath: RepositoryLocation): Promise<BranchInfo[]> {
    const [status, refsResult] = await Promise.all([
      this.getStatus(repositoryPath).catch(() => undefined),
      this.run(repositoryPath, [
        "for-each-ref",
        "refs/heads",
        "refs/remotes",
        `--format=%(refname)${fieldSeparator}%(refname:short)${fieldSeparator}%(objectname)${fieldSeparator}%(upstream:short)`
      ])
    ]);

    if (!refsResult.ok) {
      throw new Error(refsResult.messageZh ?? "无法读取分支列表。");
    }

    return refsResult.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): BranchInfo | null => {
        const [fullName, shortName, headHash, upstream] = line.split(fieldSeparator);
        if (!fullName || !shortName || fullName === "refs/remotes/origin/HEAD" || shortName.endsWith("/HEAD")) {
          return null;
        }

        const type: BranchInfo["type"] = fullName.startsWith("refs/remotes/") ? "remote" : "local";
        return {
          name: shortName,
          fullName,
          type,
          current: type === "local" && shortName === status?.currentBranch,
          upstream: upstream || undefined,
          headHash: headHash ?? ""
        };
      })
      .filter((branch): branch is BranchInfo => Boolean(branch))
      .sort(compareBranches);
  }

  async createBranch(repositoryPath: RepositoryLocation, branchName: string, checkout: boolean, startPoint?: string): Promise<GitOperationResult> {
    const name = branchName.trim();
    if (!name) {
      throw new Error("分支名不能为空。");
    }

    const validationResult = await this.run(repositoryPath, ["check-ref-format", "--branch", name]);
    if (!validationResult.ok) {
      return {
        ...validationResult,
        messageZh: "分支名不合法，请检查是否包含空格、连续点号或 Git 不允许的字符。"
      };
    }

    const normalizedStartPoint = startPoint?.trim();
    if (!checkout) {
      return this.run(repositoryPath, ["branch", name, ...(normalizedStartPoint ? [normalizedStartPoint] : [])]);
    }

    return this.runWithFallbacks(repositoryPath, [
      ["switch", "-c", name, ...(normalizedStartPoint ? [normalizedStartPoint] : [])],
      ["checkout", "-b", name, ...(normalizedStartPoint ? [normalizedStartPoint] : [])]
    ]);
  }

  async amendLastCommitMessage(repositoryPath: RepositoryLocation, input: CommitMessageInput): Promise<GitOperationResult> {
    const subject = input.subject.trim();
    if (!subject) {
      throw new Error("提交标题不能为空。");
    }

    const args = ["commit", "--amend", "-m", subject];
    if (input.body?.trim()) {
      args.push("-m", input.body.trim());
    }

    return this.run(repositoryPath, args);
  }

  async resetLastCommit(repositoryPath: RepositoryLocation, mode: Exclude<GitResetMode, "hard">): Promise<GitOperationResult> {
    return this.resetToCommit(repositoryPath, "HEAD~1", mode);
  }

  async resetToCommit(repositoryPath: RepositoryLocation, hash: string, mode: GitResetMode): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["reset", `--${mode}`, target], { timeoutMs: resetCommandTimeoutMs });
  }

  async revertCommit(repositoryPath: RepositoryLocation, hash: string): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["revert", "--no-edit", target]);
  }

  async cherryPickCommit(repositoryPath: RepositoryLocation, hash: string): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["cherry-pick", target]);
  }

  async switchBranch(repositoryPath: RepositoryLocation, branch: BranchInfo): Promise<GitOperationResult> {
    if (branch.type === "remote") {
      return this.runWithFallbacks(repositoryPath, [
        ["switch", "--track", branch.name],
        ["checkout", "-t", branch.name],
        ["switch", branch.name],
        ["checkout", branch.name]
      ]);
    }

    return this.runWithFallbacks(repositoryPath, [
      ["switch", branch.name],
      ["checkout", branch.name]
    ]);
  }

  async getMergePreview(repositoryPath: RepositoryLocation, targetBranch: string): Promise<GitMergePreview> {
    if (this.activeMergeRepositories.has(this.mergeRepositoryKey(repositoryPath))) {
      throw new Error("当前仓库正在执行合并操作，请稍候。");
    }

    return this.buildMergePreview(repositoryPath, targetBranch);
  }

  async mergeCurrentBranch(repositoryPath: RepositoryLocation, targetBranch: string, strategy: GitMergeStrategy): Promise<GitOperationResult> {
    const repositoryKey = this.mergeRepositoryKey(repositoryPath);
    if (this.activeMergeRepositories.has(repositoryKey)) {
      return gitFailure("git merge", "当前仓库正在执行合并操作，请稍候。", "Another merge operation is already running.");
    }

    this.activeMergeRepositories.add(repositoryKey);
    try {
      const plan = await this.buildMergePreview(repositoryPath, targetBranch);
      if (plan.mode === "up-to-date") {
        return {
          ok: true,
          command: `git merge-base --is-ancestor ${plan.sourceBranch} ${plan.targetBranch}`,
          stdout: `${plan.targetBranch} already contains ${plan.sourceBranch}.`,
          stderr: "",
          exitCode: 0
        };
      }

      const switchResult = await this.switchToLocalBranch(repositoryPath, plan.targetBranch);
      if (!switchResult.ok) {
        return {
          ...switchResult,
          messageZh: `无法切换到目标分支 ${plan.targetBranch}。工作区未发生合并，请查看原始 Git 输出。`
        };
      }

      const strategyArg = strategy === "no-ff" ? "--no-ff" : "--ff";
      const mergeResult = await this.run(repositoryPath, ["merge", strategyArg, "--no-edit", plan.sourceBranch], {
        timeoutMs: mergeCommandTimeoutMs
      });
      if (mergeResult.ok) {
        await this.clearManagedMergeState(repositoryPath);
        return combineGitResults([switchResult, mergeResult], true);
      }

      const operationState = await this.getOperationState(repositoryPath);
      if (operationState === "merge") {
        try {
          await this.writeManagedMergeState(repositoryPath, {
            sourceBranch: plan.sourceBranch,
            targetBranch: plan.targetBranch,
            startedAt: new Date().toISOString()
          });
        } catch (error) {
          return {
            ...combineGitResults([switchResult, mergeResult], false),
            messageZh: `${mergeResult.messageZh ?? "合并产生冲突。"} 软件无法记录原分支，终止后可能需要手动切回 ${plan.sourceBranch}。`,
            stderr: [mergeResult.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n")
          };
        }

        return combineGitResults([switchResult, mergeResult], false);
      }

      const restoreResult = await this.switchToLocalBranch(repositoryPath, plan.sourceBranch);
      const combined = combineGitResults([switchResult, mergeResult, restoreResult], false);
      return {
        ...combined,
        exitCode: mergeResult.exitCode,
        messageZh: restoreResult.ok
          ? `${mergeResult.messageZh ?? "合并失败。"} 已自动切回原分支 ${plan.sourceBranch}。`
          : `${mergeResult.messageZh ?? "合并失败。"} 同时无法自动切回原分支 ${plan.sourceBranch}，当前仍在 ${plan.targetBranch}。`
      };
    } catch (error) {
      return gitFailure("git merge", errorMessage(error, "合并预检失败。"));
    } finally {
      this.activeMergeRepositories.delete(repositoryKey);
    }
  }

  async continueMerge(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    const repositoryKey = this.mergeRepositoryKey(repositoryPath);
    if (this.activeMergeRepositories.has(repositoryKey)) {
      return gitFailure("git merge --continue", "当前仓库正在执行合并操作，请稍候。", "Another merge operation is already running.");
    }

    this.activeMergeRepositories.add(repositoryKey);
    try {
      const status = await this.getStatus(repositoryPath);
      if (status.operationState !== "merge") {
        return gitFailure("git merge --continue", "当前没有正在进行的合并操作。", "No merge operation is in progress.");
      }
      if (status.hasConflicts) {
        return gitFailure("git merge --continue", "仍有冲突文件未解决，请解决并暂存所有冲突后再继续。", "Unmerged files remain.");
      }

      const result = await this.run(repositoryPath, ["-c", "core.editor=true", "merge", "--continue"], {
        timeoutMs: mergeCommandTimeoutMs
      });
      if (result.ok) {
        await this.clearManagedMergeState(repositoryPath);
      }
      return result;
    } catch (error) {
      return gitFailure("git merge --continue", errorMessage(error, "继续合并失败。"));
    } finally {
      this.activeMergeRepositories.delete(repositoryKey);
    }
  }

  async abortMerge(repositoryPath: RepositoryLocation): Promise<GitOperationResult> {
    const repositoryKey = this.mergeRepositoryKey(repositoryPath);
    if (this.activeMergeRepositories.has(repositoryKey)) {
      return gitFailure("git merge --abort", "当前仓库正在执行合并操作，请稍候。", "Another merge operation is already running.");
    }

    this.activeMergeRepositories.add(repositoryKey);
    try {
      const status = await this.getStatus(repositoryPath);
      if (status.operationState !== "merge") {
        return gitFailure("git merge --abort", "当前没有正在进行的合并操作。", "No merge operation is in progress.");
      }

      const managedState = await this.readManagedMergeState(repositoryPath);
      const abortResult = await this.run(repositoryPath, ["merge", "--abort"], { timeoutMs: mergeCommandTimeoutMs });
      if (!abortResult.ok) {
        return abortResult;
      }

      await this.clearManagedMergeState(repositoryPath);
      if (!managedState) {
        return abortResult;
      }

      const restoreResult = await this.switchToLocalBranch(repositoryPath, managedState.sourceBranch);
      if (!restoreResult.ok) {
        return {
          ...combineGitResults([abortResult, restoreResult], false),
          messageZh: `合并已经终止，但无法切回原分支 ${managedState.sourceBranch}。当前分支内容已恢复，请手动切换分支。`
        };
      }

      return combineGitResults([abortResult, restoreResult], true);
    } catch (error) {
      return gitFailure("git merge --abort", errorMessage(error, "终止合并失败。"));
    } finally {
      this.activeMergeRepositories.delete(repositoryKey);
    }
  }

  async deleteBranch(repositoryPath: RepositoryLocation, branchName: string): Promise<GitOperationResult> {
    const name = branchName.trim();
    if (!name) {
      throw new Error("分支名不能为空。");
    }

    return this.run(repositoryPath, ["branch", "-d", name]);
  }

  async scanRepositories(rootPath: string, maxDepth = 4): Promise<string[]> {
    const found: string[] = [];
    await walk(rootPath, 0, maxDepth, found);
    return found;
  }

  private async runWithFallbacks(repositoryPath: RepositoryLocation, commands: string[][]): Promise<GitOperationResult> {
    let lastResult: GitOperationResult | undefined;

    for (const args of commands) {
      const result = await this.run(repositoryPath, args);
      if (result.ok) {
        return result;
      }
      lastResult = result;
    }

    return lastResult!;
  }

  private async loadConflictSnapshot(repositoryPath: RepositoryLocation, filePath: string): Promise<ConflictSnapshot> {
    const normalizedPath = toGitPath(filePath.trim());
    if (!normalizedPath) {
      throw new Error("冲突文件路径不能为空。");
    }
    resolveRepositoryFilePath(repositoryPath, normalizedPath);

    const unmergedResult = await this.run(repositoryPath, ["ls-files", "--unmerged", "--", normalizedPath]);
    if (!unmergedResult.ok || !unmergedResult.stdout.trim()) {
      throw new Error("该文件已不在冲突状态，请刷新工作区。");
    }

    const [base, current, incoming, result] = await Promise.all([
      this.readConflictStage(repositoryPath, normalizedPath, 1),
      this.readConflictStage(repositoryPath, normalizedPath, 2),
      this.readConflictStage(repositoryPath, normalizedPath, 3),
      this.readRepositoryFile(repositoryPath, normalizedPath)
    ]);
    const token = createHash("sha256")
      .update(unmergedResult.stdout)
      .update(conflictBufferToken(base))
      .update(conflictBufferToken(current))
      .update(conflictBufferToken(incoming))
      .update(conflictBufferToken(result))
      .digest("hex");

    return {
      path: normalizedPath,
      base,
      current,
      incoming,
      result,
      token
    };
  }

  private async readConflictStage(repositoryPath: RepositoryLocation, filePath: string, stage: 1 | 2 | 3): Promise<Buffer | null> {
    const result = await this.runBinary(repositoryPath, ["show", `:${stage}:${filePath}`], { timeoutMs: 10_000 });
    return result.ok ? result.stdout : null;
  }

  private async getMergeHeadLabel(repositoryPath: RepositoryLocation): Promise<string | undefined> {
    const result = await this.run(repositoryPath, ["for-each-ref", "--points-at", "MERGE_HEAD", "--format=%(refname:short)"]);
    if (!result.ok) {
      return undefined;
    }

    const refs = result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    return refs.find((ref) => !ref.includes("/")) ?? refs[0];
  }

  private async buildMergePreview(repositoryPath: RepositoryLocation, targetBranch: string): Promise<GitMergePreview> {
    const status = await this.getStatus(repositoryPath);
    if (status.operationState || status.hasConflicts) {
      throw new Error("当前已有 Git 操作或冲突未完成，请先继续或终止当前操作。");
    }

    if (status.stagedCount + status.unstagedCount + status.untrackedCount > 0) {
      throw new Error("合并前必须保持工作区干净，请先提交、暂存到 stash 或丢弃当前改动。");
    }

    const sourceBranch = status.currentBranch;
    if (!sourceBranch) {
      throw new Error("当前是分离 HEAD 状态，无法执行分支合并。");
    }

    const target = targetBranch.trim();
    if (!target) {
      throw new Error("请选择目标分支。");
    }
    if (target === sourceBranch) {
      throw new Error("来源分支和目标分支不能相同。");
    }

    const validationResult = await this.run(repositoryPath, ["check-ref-format", "--branch", target]);
    if (!validationResult.ok) {
      throw new Error("目标分支名不合法。");
    }

    const localBranchResult = await this.run(repositoryPath, ["show-ref", "--verify", "--quiet", `refs/heads/${target}`]);
    if (!localBranchResult.ok) {
      throw new Error(`目标分支 ${target} 不是本地分支，请先创建或检出本地分支。`);
    }

    const mergeBaseResult = await this.run(repositoryPath, ["merge-base", sourceBranch, target]);
    if (!mergeBaseResult.ok || !mergeBaseResult.stdout.trim()) {
      throw new Error(`分支 ${sourceBranch} 与 ${target} 没有共同历史，已取消合并。`);
    }

    const sourceIsAncestor = await this.run(repositoryPath, ["merge-base", "--is-ancestor", sourceBranch, target]);
    let mode: GitMergeMode;
    if (sourceIsAncestor.ok) {
      mode = "up-to-date";
    } else {
      const targetIsAncestor = await this.run(repositoryPath, ["merge-base", "--is-ancestor", target, sourceBranch]);
      mode = targetIsAncestor.ok ? "fast-forward" : "merge-commit";
    }

    const upstreamResult = await this.run(repositoryPath, ["for-each-ref", `refs/heads/${target}`, "--format=%(upstream:short)"]);
    const targetUpstream = upstreamResult.ok ? upstreamResult.stdout.trim() || undefined : undefined;
    let targetAhead = 0;
    let targetBehind = 0;
    if (targetUpstream) {
      const divergenceResult = await this.run(repositoryPath, ["rev-list", "--left-right", "--count", `${target}...${targetUpstream}`]);
      if (divergenceResult.ok) {
        const [aheadText, behindText] = divergenceResult.stdout.trim().split(/\s+/);
        targetAhead = Number(aheadText) || 0;
        targetBehind = Number(behindText) || 0;
      }
    }

    return {
      sourceBranch,
      targetBranch: target,
      targetUpstream,
      targetAhead,
      targetBehind,
      mode
    };
  }

  private mergeRepositoryKey(repositoryPath: RepositoryLocation): string {
    const target = normalizeRepositoryTarget(repositoryPath);
    if (target.remote) {
      return [sshDestination(target.remote), target.remote.port ?? 22, path.posix.normalize(target.path)].join("|");
    }
    const resolvedPath = path.resolve(target.path);
    return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  }

  private async switchToLocalBranch(repositoryPath: RepositoryLocation, branchName: string): Promise<GitOperationResult> {
    return this.runWithFallbacks(repositoryPath, [
      ["switch", branchName],
      ["checkout", branchName]
    ]);
  }

  private async managedMergeStatePath(repositoryPath: RepositoryLocation): Promise<string | undefined> {
    const result = await this.run(repositoryPath, ["rev-parse", "--git-path", managedMergeStateFile]);
    if (!result.ok) {
      return undefined;
    }

    const statePath = result.stdout.trim();
    if (!statePath) {
      return undefined;
    }
    return resolveGitReportedPath(repositoryPath, statePath);
  }

  private async readManagedMergeState(repositoryPath: RepositoryLocation): Promise<ManagedMergeState | undefined> {
    const statePath = await this.managedMergeStatePath(repositoryPath);
    if (!statePath) {
      return undefined;
    }

    try {
      const content = await this.readTargetFile(repositoryPath, statePath);
      if (!content) {
        return undefined;
      }
      const parsed = JSON.parse(decodeGitOutput(content)) as Partial<ManagedMergeState>;
      if (typeof parsed.sourceBranch !== "string" || typeof parsed.targetBranch !== "string" || typeof parsed.startedAt !== "string") {
        return undefined;
      }
      return {
        sourceBranch: parsed.sourceBranch,
        targetBranch: parsed.targetBranch,
        startedAt: parsed.startedAt
      };
    } catch {
      return undefined;
    }
  }

  private async writeManagedMergeState(repositoryPath: RepositoryLocation, state: ManagedMergeState): Promise<void> {
    const statePath = await this.managedMergeStatePath(repositoryPath);
    if (!statePath) {
      throw new Error("无法定位 Git 合并状态目录。");
    }
    await this.writeTargetFile(repositoryPath, statePath, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  }

  private async clearManagedMergeState(repositoryPath: RepositoryLocation): Promise<void> {
    const statePath = await this.managedMergeStatePath(repositoryPath);
    if (!statePath) {
      return;
    }

    try {
      await this.removeTargetFile(repositoryPath, statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return;
      }
    }
  }

  private async readTargetFile(repositoryPath: RepositoryLocation, targetPath: string): Promise<Buffer | null> {
    const target = normalizeRepositoryTarget(repositoryPath);
    if (!target.remote) {
      try {
        const info = await stat(targetPath);
        return info.isFile() ? readFile(targetPath) : null;
      } catch {
        return null;
      }
    }

    const result = await runSshShell(target.remote, `test -f ${shellQuote(targetPath)} && cat -- ${shellQuote(targetPath)}`, { timeoutMs: 20_000 });
    return result.ok ? result.stdout : null;
  }

  private async writeTargetFile(repositoryPath: RepositoryLocation, targetPath: string, content: Buffer): Promise<void> {
    const target = normalizeRepositoryTarget(repositoryPath);
    if (!target.remote) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
      return;
    }

    const targetDirectory = path.posix.dirname(targetPath);
    const result = await runSshShell(
      target.remote,
      `mkdir -p -- ${shellQuote(targetDirectory)} && cat > ${shellQuote(targetPath)}`,
      { timeoutMs: 20_000, stdin: content }
    );
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法写入远程文件。");
    }
  }

  private async removeTargetFile(repositoryPath: RepositoryLocation, targetPath: string): Promise<void> {
    const target = normalizeRepositoryTarget(repositoryPath);
    if (!target.remote) {
      try {
        await unlink(targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    const result = await runSshShell(target.remote, `rm -f -- ${shellQuote(targetPath)}`, { timeoutMs: 10_000 });
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法删除远程状态文件。");
    }
  }

  private async readRepositoryFile(repositoryPath: RepositoryLocation, filePath: string): Promise<Buffer | null> {
    return this.readTargetFile(repositoryPath, resolveRepositoryFilePath(repositoryPath, filePath));
  }

  private async writeRepositoryFile(repositoryPath: RepositoryLocation, filePath: string, content: Buffer): Promise<void> {
    await this.writeTargetFile(repositoryPath, resolveRepositoryFilePath(repositoryPath, filePath), content);
  }

  private async isUntrackedFile(repositoryPath: RepositoryLocation, filePath: string): Promise<boolean> {
    const result = await this.run(repositoryPath, ["ls-files", "--others", "--exclude-standard", "--", filePath]);
    return result.ok && result.stdout.split(/\r?\n/).filter(Boolean).includes(filePath);
  }

  private async readFileAsAddedDiff(repositoryPath: RepositoryLocation, filePath: string): Promise<DiffLine[]> {
    const content = await this.readRepositoryFile(repositoryPath, filePath);
    if (!content || isBinaryBuffer(content)) {
      return [];
    }

    return decodeGitOutput(content).split(/\r?\n/).map((line, index) => ({
      type: "add",
      newLineNumber: index + 1,
      content: line
    }));
  }

  private async getPushRemote(repositoryPath: RepositoryLocation, branchName: string): Promise<string | undefined> {
    const configuredRemote = await this.getConfiguredPushRemote(repositoryPath, branchName);
    if (configuredRemote) {
      return configuredRemote;
    }

    const remotesResult = await this.run(repositoryPath, ["remote"]);
    if (!remotesResult.ok) {
      return undefined;
    }

    const remotes = Array.from(new Set(remotesResult.stdout.split(/\r?\n/).map((remote) => remote.trim()).filter(Boolean)));
    if (remotes.includes("origin")) {
      return "origin";
    }

    return remotes.length === 1 ? remotes[0] : undefined;
  }

  private async getConfiguredPushRemote(repositoryPath: RepositoryLocation, branchName: string): Promise<string | undefined> {
    const configuredKeys = [`branch.${branchName}.pushRemote`, "remote.pushDefault", `branch.${branchName}.remote`];
    for (const key of configuredKeys) {
      const remote = await this.getGitConfigValue(repositoryPath, key);
      if (remote && remote !== ".") {
        return remote;
      }
    }

    return undefined;
  }

  private async getGitConfigValue(repositoryPath: RepositoryLocation, key: string): Promise<string | undefined> {
    const result = await this.run(repositoryPath, ["config", "--get", key]);
    if (!result.ok) {
      return undefined;
    }

    return result.stdout.trim() || undefined;
  }

  private async getHistoryRevisions(repositoryPath: RepositoryLocation, status?: GitStatusSummary, filter: GitHistoryFilter = { mode: "auto" }): Promise<string[]> {
    if (filter.mode === "all") {
      const refs = await this.getHistoryRefs(repositoryPath).catch(() => []);
      return refs.length > 0 ? refs.map((ref) => ref.id) : ["HEAD"];
    }

    if (filter.mode === "custom") {
      const refIds = Array.from(new Set((filter.refIds ?? []).map((ref) => ref.trim()).filter(Boolean)));
      return refIds.length > 0 ? refIds : ["HEAD"];
    }

    const revisions = new Set<string>();
    revisions.add(status?.currentBranch ? `refs/heads/${status.currentBranch}` : "HEAD");

    if (status?.upstream) {
      revisions.add(`refs/remotes/${status.upstream}`);
    }

    return Array.from(revisions);
  }

  private async getSingleCommit(repositoryPath: RepositoryLocation, hash: string): Promise<CommitNode[]> {
    const format = [
      "%H",
      "%P",
      "%an",
      "%ae",
      "%aI",
      "%cn",
      "%ce",
      "%cI",
      "%D",
      "%s",
      "%b"
    ].join(`%x${fieldSeparator.charCodeAt(0).toString(16)}`);

    const result = await this.run(repositoryPath, [
      "log",
      "-1",
      "--decorate=full",
      "--date=iso-strict",
      `--pretty=format:${format}%x${recordSeparator.charCodeAt(0).toString(16)}`,
      hash
    ]);

    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取提交详情。");
    }

    return parseCommitLog(result.stdout);
  }

  private async readGitBlob(repositoryPath: RepositoryLocation, revision: string, filePath: string, staged = false): Promise<Buffer | null> {
    const gitPath = toGitPath(filePath);
    const objectName = staged ? `:${gitPath}` : `${revision}:${gitPath}`;
    const result = await this.runBinary(repositoryPath, ["show", objectName], { timeoutMs: 10_000 });
    if (!result.ok) {
      return null;
    }

    return result.stdout;
  }
}

function gitFailure(command: string, messageZh: string, stderr = ""): GitOperationResult {
  return {
    ok: false,
    command,
    stdout: "",
    stderr,
    exitCode: -1,
    messageZh
  };
}

export function normalizeRepositoryTarget(location: RepositoryLocation): RepositoryTarget {
  if (typeof location === "string") {
    return { path: location };
  }
  if (!location || typeof location.path !== "string" || !location.path.trim()) {
    throw new Error("仓库路径不能为空。");
  }
  if (!location.remote) {
    return { path: location.path };
  }
  if (
    location.remote.type !== "ssh" ||
    typeof location.remote.host !== "string" ||
    (location.remote.username !== undefined && typeof location.remote.username !== "string") ||
    (location.remote.port !== undefined && typeof location.remote.port !== "number") ||
    (location.remote.identityFile !== undefined && typeof location.remote.identityFile !== "string")
  ) {
    throw new Error("SSH 连接信息格式不正确。");
  }

  const input: RemoteProjectInput = {
    host: location.remote.host,
    username: location.remote.username,
    port: location.remote.port,
    repositoryPath: location.path,
    identityFile: location.remote.identityFile
  };
  const validationError = validateRemoteProjectInput(input);
  if (validationError) {
    throw new Error(validationError);
  }

  return {
    path: input.repositoryPath.trim().replace(/\\/g, "/"),
    remote: {
      type: "ssh",
      host: input.host.trim(),
      username: input.username?.trim() || undefined,
      port: input.port,
      identityFile: input.identityFile?.trim() || undefined
    }
  };
}

export function sshDestination(connection: SshConnection): string {
  return connection.username ? `${connection.username}@${connection.host}` : connection.host;
}

export function buildSshArgs(connection: SshConnection, batchMode = false): string[] {
  const args = ["-o", "ConnectTimeout=12", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
  if (batchMode) {
    args.push("-T", "-o", "BatchMode=yes", "-o", "NumberOfPasswordPrompts=0");
  }
  if (connection.port) {
    args.push("-p", String(connection.port));
  }
  if (connection.identityFile) {
    args.push("-i", connection.identityFile);
  }
  args.push(sshDestination(connection));
  return args;
}

function buildRemoteGitCommand(repositoryPath: string, args: string[]): string {
  return [
    "env",
    "GIT_TERMINAL_PROMPT=0",
    "GIT_PAGER=cat",
    "LC_ALL=C.UTF-8",
    "LANG=C.UTF-8",
    "git",
    "-c",
    "core.quotepath=false",
    "-c",
    "i18n.commitEncoding=utf-8",
    "-c",
    "i18n.logOutputEncoding=utf-8",
    "-C",
    repositoryPath,
    ...args
  ]
    .map(shellQuote)
    .join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function validateRemoteProjectInput(input: RemoteProjectInput): string | undefined {
  const host = input.host.trim();
  const username = input.username?.trim();
  const repositoryPath = input.repositoryPath.trim().replace(/\\/g, "/");
  if (!host) {
    return "请输入 SSH 主机或 SSH 配置别名。";
  }
  if (!/^[a-z0-9._:-]+$/i.test(host) || host.startsWith("-")) {
    return "SSH 主机格式不正确。";
  }
  if (username && !/^[a-z0-9._-]+$/i.test(username)) {
    return "SSH 用户名格式不正确。";
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    return "SSH 端口必须是 1 到 65535 之间的整数。";
  }
  if (!repositoryPath.startsWith("/")) {
    return "远程仓库路径必须是服务器上的绝对路径。";
  }
  if (repositoryPath.includes("\0")) {
    return "远程仓库路径包含无效字符。";
  }
  return undefined;
}

function runSshShell(
  connection: SshConnection,
  remoteCommand: string,
  options: { timeoutMs?: number; stdin?: Buffer } = {}
): Promise<Omit<GitOperationResult, "stdout"> & { stdout: Buffer }> {
  return new Promise((resolve) => {
    const command = `ssh ${sshDestination(connection)} -- ${remoteCommand}`;
    const child = spawn("ssh", [...buildSshArgs(connection, true), remoteCommand], {
      cwd: process.cwd(),
      env: createGitEnv(),
      shell: false,
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const finish = (result: Omit<GitOperationResult, "stdout"> & { stdout: Buffer }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(result);
    };
    const timeoutId = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          const timeoutText = `SSH command timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s.`;
          const stderrText = decodeGitOutput(Buffer.concat(stderrChunks));
          finish({
            ok: false,
            command,
            stdout: Buffer.concat(stdoutChunks),
            stderr: stderrText ? `${stderrText}\n${timeoutText}` : timeoutText,
            exitCode: -1,
            messageZh: "远程文件操作超时，请检查 SSH 连接后重试。"
          });
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      finish({
        ok: false,
        command,
        stdout: Buffer.concat(stdoutChunks),
        stderr: error.message,
        exitCode: -1,
        messageZh: "无法执行 SSH，请确认本机已安装 OpenSSH 并加入 PATH。"
      });
    });
    child.on("close", (code) => {
      const exitCode = code ?? -1;
      const stderr = decodeGitOutput(Buffer.concat(stderrChunks));
      finish({
        ok: exitCode === 0,
        command,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        exitCode,
        messageZh: exitCode === 0 ? undefined : toChineseSshError(stderr)
      });
    });
    child.stdin.end(options.stdin);
  });
}

function validateRemoteMergeStatus(status: GitStatusSummary, requireDivergence = false): GitOperationResult | undefined {
  if (status.operationState || status.hasConflicts) {
    return gitFailure("git merge", "当前已有 Git 操作或冲突未完成，请先继续或终止当前操作。");
  }
  if (status.stagedCount + status.unstagedCount + status.untrackedCount > 0) {
    return gitFailure("git merge", "合并远程更改前必须保持工作区干净，请先提交、暂存到 stash 或丢弃当前改动。");
  }
  if (!status.currentBranch) {
    return gitFailure("git merge", "当前是分离 HEAD 状态，无法合并远程更改。");
  }
  if (!status.upstream) {
    return gitFailure("git merge", "当前分支没有关联远程分支，无法合并远程更改。");
  }
  if (requireDivergence && status.behind > 0 && status.ahead === 0) {
    return gitFailure("git merge", "当前分支只落后远程，请使用拉取操作完成快进更新。");
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function combineGitResults(results: GitOperationResult[], ok: boolean): GitOperationResult {
  const failedResult = results.find((result) => !result.ok);
  return {
    ok,
    command: results.map((result) => result.command).filter(Boolean).join(" ; "),
    stdout: results.map((result) => result.stdout).filter(Boolean).join("\n"),
    stderr: results.map((result) => result.stderr).filter(Boolean).join("\n"),
    exitCode: ok ? 0 : failedResult?.exitCode ?? -1,
    messageZh: ok ? undefined : failedResult?.messageZh
  };
}

function conflictBufferToken(buffer: Buffer | null): Buffer {
  if (!buffer) {
    return Buffer.from("missing\0");
  }
  return Buffer.concat([Buffer.from(`${buffer.byteLength}\0`), buffer]);
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function isEditableConflictSnapshot(snapshot: ConflictSnapshot): boolean {
  const buffers = [snapshot.base, snapshot.current, snapshot.incoming, snapshot.result].filter((value): value is Buffer => Boolean(value));
  return !buffers.some(isBinaryBuffer) && buffers.every((buffer) => buffer.byteLength <= maxEditableConflictBytes);
}

function containsConflictMarkers(content: string): boolean {
  return /^<<<<<<<[^\r\n]*\r?$[\s\S]*?^======\=\r?$[\s\S]*?^>>>>>>>[^\r\n]*\r?$/m.test(content);
}

function resolveRepositoryFilePath(repositoryPath: RepositoryLocation, filePath: string): string {
  const target = normalizeRepositoryTarget(repositoryPath);
  const pathApi = target.remote ? path.posix : path;
  if (pathApi.isAbsolute(filePath)) {
    throw new Error("文件路径必须位于当前仓库内。");
  }

  const root = pathApi.resolve(target.path);
  const resolved = pathApi.resolve(root, filePath);
  const relative = pathApi.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error("文件路径超出当前仓库范围。");
  }
  return resolved;
}

function resolveGitReportedPath(repositoryPath: RepositoryLocation, reportedPath: string): string {
  const target = normalizeRepositoryTarget(repositoryPath);
  const pathApi = target.remote ? path.posix : path;
  return pathApi.isAbsolute(reportedPath) ? pathApi.normalize(reportedPath) : pathApi.resolve(target.path, reportedPath);
}

function parseStatus(output: string): GitStatusSummary {
  const summary: GitStatusSummary = {
    currentBranch: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    hasConflicts: false
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    if (line.startsWith("# branch.head ")) {
      const branch = line.replace("# branch.head ", "").trim();
      summary.currentBranch = branch === "(detached)" ? null : branch;
      continue;
    }

    if (line.startsWith("# branch.upstream ")) {
      summary.upstream = line.replace("# branch.upstream ", "").trim();
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        summary.ahead = Number(match[1]);
        summary.behind = Number(match[2]);
      }
      continue;
    }

    if (line.startsWith("? ")) {
      summary.untrackedCount += 1;
      continue;
    }

    if (line.startsWith("u ")) {
      summary.hasConflicts = true;
      continue;
    }

    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4);
      if (xy[0] !== "." && xy[0] !== " ") {
        summary.stagedCount += 1;
      }
      if (xy[1] !== "." && xy[1] !== " ") {
        summary.unstagedCount += 1;
      }
    }
  }

  return summary;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCommitLog(output: string): CommitNode[] {
  const laneByKey = new Map<string, number>();

  return output
    .split(recordSeparator)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const fields = record.split(fieldSeparator);
      const refs = parseRefs(fields[8] ?? "");
      const laneKey = refs.find((ref) => ref.type === "localBranch" || ref.type === "remoteBranch")?.name ?? fields[1]?.split(" ")[0] ?? fields[0];
      const lane = getLane(laneByKey, laneKey);

      return {
        hash: fields[0],
        shortHash: fields[0]?.slice(0, 7) ?? "",
        parents: fields[1] ? fields[1].split(" ").filter(Boolean) : [],
        authorName: fields[2] ?? "",
        authorEmail: fields[3] ?? "",
        authorDate: formatIsoDate(fields[4]),
        committerName: fields[5] ?? "",
        committerEmail: fields[6] ?? "",
        committerDate: formatIsoDate(fields[7]),
        refs,
        subject: fields[9] ?? "(无提交信息)",
        body: fields.slice(10).join(fieldSeparator).trim(),
        lane,
        color: graphColors[lane % graphColors.length],
        files: []
      };
    });
}

function parseRefs(refText: string): CommitRef[] {
  if (!refText.trim()) {
    return [];
  }

  return refText
    .split(",")
    .map((part) => part.trim())
    .map((part): CommitRef | null => {
      if (part === "HEAD") {
        return { type: "head", name: "HEAD" };
      }

      const normalized = part.replace(/^HEAD -> /, "");

      if (normalized === "HEAD" || normalized === "origin/HEAD" || normalized.endsWith("/HEAD")) {
        return null;
      }

      if (normalized.startsWith("tag: refs/tags/")) {
        return { type: "tag", name: normalized.replace("tag: refs/tags/", "") };
      }

      if (normalized.startsWith("tag: ")) {
        return { type: "tag", name: normalized.replace("tag: ", "") };
      }

      if (normalized.startsWith("refs/heads/")) {
        return { type: "localBranch", name: normalized.replace("refs/heads/", "") };
      }

      if (normalized.startsWith("refs/remotes/")) {
        return { type: "remoteBranch", name: normalized.replace("refs/remotes/", "") };
      }

      if (normalized.startsWith("origin/") || normalized.includes("/")) {
        return { type: "remoteBranch", name: normalized };
      }

      return { type: "localBranch", name: normalized };
    })
    .filter((ref): ref is CommitRef => Boolean(ref));
}

function getLane(laneByKey: Map<string, number>, laneKey: string): number {
  if (!laneByKey.has(laneKey)) {
    laneByKey.set(laneKey, laneByKey.size % 4);
  }

  return laneByKey.get(laneKey) ?? 0;
}

function parseNameStatus(output: string): ChangedFile[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [statusCode, firstPath, secondPath] = line.split(/\t/);
      const status = statusFromCode(statusCode[0]);
      return {
        path: secondPath ?? firstPath,
        oldPath: secondPath ? firstPath : undefined,
        status,
        staged: false
      };
    });
}

function parseWorktree(output: string): WorktreeState {
  const stagedFiles: ChangedFile[] = [];
  const unstagedFiles: ChangedFile[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("# ")) {
      continue;
    }

    if (line.startsWith("? ")) {
      continue;
    }

    if (line.startsWith("! ")) {
      unstagedFiles.push({ path: line.slice(2), status: "ignored", staged: false });
      continue;
    }

    if (line.startsWith("u ")) {
      const path = extractUnmergedPorcelainPath(line);
      unstagedFiles.push({ path, status: "conflicted", staged: false });
      continue;
    }

    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4);
      const paths = extractPorcelainPaths(line, line.startsWith("2 "));

      if (xy[0] !== "." && xy[0] !== " ") {
        stagedFiles.push({
          path: paths.path,
          oldPath: paths.oldPath,
          status: statusFromCode(xy[0]),
          staged: true
        });
      }

      if (xy[1] !== "." && xy[1] !== " ") {
        unstagedFiles.push({
          path: paths.path,
          oldPath: paths.oldPath,
          status: statusFromCode(xy[1]),
          staged: false
        });
      }
    }
  }

  return { stagedFiles, unstagedFiles };
}

function sortWorktree(worktree: WorktreeState): WorktreeState {
  return {
    stagedFiles: worktree.stagedFiles.sort(compareFiles),
    unstagedFiles: worktree.unstagedFiles.sort(compareFiles)
  };
}

function compareFiles(left: ChangedFile, right: ChangedFile): number {
  return left.path.localeCompare(right.path, "zh-CN", { sensitivity: "base" });
}

function compareBranches(left: BranchInfo, right: BranchInfo): number {
  if (left.current !== right.current) {
    return left.current ? -1 : 1;
  }

  if (left.type !== right.type) {
    return left.type === "local" ? -1 : 1;
  }

  return left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" });
}

function compareHistoryRefs(left: GitHistoryRef, right: GitHistoryRef): number {
  if (left.current !== right.current) {
    return left.current ? -1 : 1;
  }

  if (left.upstream !== right.upstream) {
    return left.upstream ? -1 : 1;
  }

  const typeOrder: Record<GitHistoryRef["type"], number> = {
    branch: 0,
    remoteBranch: 1,
    tag: 2
  };
  if (typeOrder[left.type] !== typeOrder[right.type]) {
    return typeOrder[left.type] - typeOrder[right.type];
  }

  return left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" });
}

function createFilePreview(content: Buffer, media: { type: FilePreview["type"]; mimeType: string }, sourceDescription: string): FilePreview {
  const maxBytes = media.type === "video" ? maxPreviewVideoBytes : maxPreviewImageBytes;
  if (content.byteLength > maxBytes) {
    const label = media.type === "video" ? "视频" : "图片";
    throw new Error(`${label}文件过大，暂不在查看区预览。`);
  }

  return {
    type: media.type,
    mimeType: media.mimeType,
    dataUrl: `data:${media.mimeType};base64,${content.toString("base64")}`,
    sizeBytes: content.byteLength,
    sourceDescription
  };
}

function previewMediaFromPath(filePath: string): { type: FilePreview["type"]; mimeType: string } | undefined {
  const extension = filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png":
      return { type: "image", mimeType: "image/png" };
    case "apng":
      return { type: "image", mimeType: "image/apng" };
    case "jpg":
    case "jpeg":
    case "jfif":
      return { type: "image", mimeType: "image/jpeg" };
    case "gif":
      return { type: "image", mimeType: "image/gif" };
    case "webp":
      return { type: "image", mimeType: "image/webp" };
    case "svg":
      return { type: "image", mimeType: "image/svg+xml" };
    case "bmp":
      return { type: "image", mimeType: "image/bmp" };
    case "ico":
      return { type: "image", mimeType: "image/x-icon" };
    case "avif":
      return { type: "image", mimeType: "image/avif" };
    case "mp4":
    case "m4v":
      return { type: "video", mimeType: "video/mp4" };
    case "mov":
      return { type: "video", mimeType: "video/quicktime" };
    case "webm":
      return { type: "video", mimeType: "video/webm" };
    case "ogv":
    case "ogg":
      return { type: "video", mimeType: "video/ogg" };
    case "mpeg":
    case "mpg":
      return { type: "video", mimeType: "video/mpeg" };
    case "mkv":
      return { type: "video", mimeType: "video/x-matroska" };
    case "avi":
      return { type: "video", mimeType: "video/x-msvideo" };
    default:
      return undefined;
  }
}

function toGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function extractPorcelainPaths(line: string, hasOriginalPath: boolean): { path: string; oldPath?: string } {
  const pathStartIndex = findNthSpace(line, hasOriginalPath ? 9 : 8);
  const rawPath = pathStartIndex >= 0 ? line.slice(pathStartIndex + 1) : "";

  if (hasOriginalPath) {
    const [pathValue, oldPath] = rawPath.split("\t");
    return { path: pathValue, oldPath };
  }

  return { path: rawPath };
}

function extractUnmergedPorcelainPath(line: string): string {
  const pathStartIndex = findNthSpace(line, 10);
  return pathStartIndex >= 0 ? line.slice(pathStartIndex + 1) : "";
}

function findNthSpace(value: string, count: number): number {
  let position = -1;
  for (let index = 0; index < count; index += 1) {
    position = value.indexOf(" ", position + 1);
    if (position === -1) {
      break;
    }
  }
  return position;
}

function parseUnifiedDiff(output: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of output.split(/\r?\n/)) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLineNumber = Number(hunk[1]);
      newLineNumber = Number(hunk[2]);
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("\\ No newline")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      lines.push({ type: "add", newLineNumber, content: line.slice(1) });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith("-")) {
      lines.push({ type: "delete", oldLineNumber, content: line.slice(1) });
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      lines.push({ type: "context", oldLineNumber, newLineNumber, content: line.slice(1) });
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  }

  return lines;
}

function statusFromCode(code: string): ChangedFile["status"] {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    case "U":
      return "conflicted";
    case "M":
    default:
      return "modified";
  }
}

async function walk(currentPath: string, depth: number, maxDepth: number, found: string[]): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  if (await hasGitDirectory(currentPath)) {
    found.push(currentPath);
    return;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !skippedDirectoryNames.has(entry.name))
      .map((entry) => walk(path.join(currentPath, entry.name), depth + 1, maxDepth, found))
  );
}

async function hasGitDirectory(candidatePath: string): Promise<boolean> {
  try {
    await access(path.join(candidatePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function formatIsoDate(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isEmptyRepositoryError(stderr: string): boolean {
  return stderr.includes("does not have any commits yet") || stderr.includes("bad default revision");
}

function toChineseSshError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes("host key verification failed")) {
    return "SSH 主机指纹尚未确认或已发生变化，请先在系统终端连接该主机并核对指纹。";
  }
  if (text.includes("permission denied")) {
    return "SSH 认证失败，请检查用户名、SSH Agent、私钥和服务器授权。";
  }
  if (text.includes("could not resolve hostname") || text.includes("name or service not known")) {
    return "无法解析 SSH 主机，请检查主机名或 SSH 配置别名。";
  }
  if (text.includes("connection refused")) {
    return "SSH 连接被服务器拒绝，请检查主机、端口和 SSH 服务状态。";
  }
  if (text.includes("connection timed out") || text.includes("operation timed out")) {
    return "SSH 连接超时，请检查服务器地址、端口和网络。";
  }
  if (text.includes("not a git repository")) {
    return "远程路径不是 Git 仓库。";
  }
  if (text.includes("git: command not found") || text.includes("git: not found")) {
    return "远程服务器未安装 Git，或 Git 不在远程 PATH 中。";
  }
  return toChineseGitError("", stderr);
}

function toChineseGitError(stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`.toLowerCase();

  if (text.includes("authentication failed") || text.includes("permission denied")) {
    return "认证失败，请检查账号权限、SSH key 或 Git Credential 配置。";
  }

  if (text.includes("not a git repository")) {
    return "当前目录不是 Git 仓库。";
  }

  if (text.includes("non-fast-forward")) {
    return "远程分支包含本地没有的提交，请先 pull 或 fetch 后处理差异。";
  }

  if (text.includes("not possible because you have unmerged files") || text.includes("unmerged files")) {
    return "仍有冲突文件未解决或未暂存，请处理所有冲突并暂存后再继续。";
  }

  if (text.includes("has no upstream branch")) {
    return "当前分支还没有关联远程分支，请先执行首次推送并设置 upstream。";
  }

  if (text.includes("merge conflict") || text.includes("conflict")) {
    return "操作产生冲突，请先解决冲突文件，然后继续或终止操作。";
  }

  if (text.includes("pathspec")) {
    return "找不到指定分支、提交或文件，请确认名称是否正确。";
  }

  if (isEmptyRepositoryError(stderr)) {
    return "当前仓库还没有提交。";
  }

  return "Git 命令执行失败，请展开原始输出查看详细原因。";
}
