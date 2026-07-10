import { spawn } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

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

const fieldSeparator = "\x1f";
const recordSeparator = "\x1e";
const resetCommandTimeoutMs = 30_000;
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
  async run(cwd: string, args: string[], options: { timeoutMs?: number } = {}): Promise<GitOperationResult> {
    return new Promise((resolve) => {
      const command = `git ${args.join(" ")}`;
      let settled = false;
      const child = spawn("git", args, {
        cwd,
        env: createGitEnv(),
        shell: false,
        windowsHide: true
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const finish = (result: GitOperationResult) => {
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
            const stdout = decodeGitOutput(Buffer.concat(stdoutChunks));
            const stderrText = decodeGitOutput(Buffer.concat(stderrChunks));
            const stderr = stderrText ? `${stderrText}\n${timeoutText}` : timeoutText;
            child.kill();
            finish({
              ok: false,
              command,
              stdout,
              stderr,
              exitCode: -1,
              messageZh: "Git 命令执行超时，请确认仓库未被其它进程锁定后重试"
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
          stdout: decodeGitOutput(Buffer.concat(stdoutChunks)),
          stderr: error.message,
          exitCode: -1,
          messageZh: "无法执行 Git 命令，请确认本机已安装 Git 并加入 PATH。"
        });
      });

      child.on("close", (code) => {
        const exitCode = code ?? -1;
        const stdout = decodeGitOutput(Buffer.concat(stdoutChunks));
        const stderr = decodeGitOutput(Buffer.concat(stderrChunks));
        finish({
          ok: exitCode === 0,
          command,
          stdout,
          stderr,
          exitCode,
          messageZh: exitCode === 0 ? undefined : toChineseGitError(stdout, stderr)
        });
      });
    });
  }

  private async runBinary(cwd: string, args: string[], options: { timeoutMs?: number } = {}): Promise<Omit<GitOperationResult, "stdout"> & { stdout: Buffer }> {
    return new Promise((resolve) => {
      const command = `git ${args.join(" ")}`;
      let settled = false;
      const child = spawn("git", args, {
        cwd,
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
              messageZh: "Git 命令执行超时，请确认仓库未被其它进程锁定后重试"
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
          messageZh: "无法执行 Git 命令，请确认本机已安装 Git 并加入 PATH。"
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
          messageZh: exitCode === 0 ? undefined : toChineseGitError("", stderr)
        });
      });
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

  async getStatus(repositoryPath: string): Promise<GitStatusSummary> {
    const result = await this.run(repositoryPath, ["status", "--porcelain=v2", "--branch", "--ignored=matching"]);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取仓库状态。");
    }

    const summary = parseStatus(result.stdout);
    summary.operationState = await this.getOperationState(repositoryPath);
    return summary;
  }

  private async getOperationState(repositoryPath: string): Promise<GitOperationState | undefined> {
    const result = await this.run(repositoryPath, ["rev-parse", ...gitOperationMarkers.flatMap((marker) => ["--git-path", marker.path])]);
    if (!result.ok) {
      return undefined;
    }

    const markerPaths = result.stdout.split(/\r?\n/).filter(Boolean);
    for (const [index, marker] of gitOperationMarkers.entries()) {
      const markerPath = markerPaths[index];
      if (!markerPath) {
        continue;
      }

      const absoluteMarkerPath = path.isAbsolute(markerPath) ? markerPath : path.resolve(repositoryPath, markerPath);
      if (await pathExists(absoluteMarkerPath)) {
        return marker.state;
      }
    }

    return undefined;
  }

  async getHistory(repositoryPath: string, filter: GitHistoryFilter = { mode: "auto" }, maxCount = 300): Promise<CommitNode[]> {
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

  async getHistoryRefs(repositoryPath: string): Promise<GitHistoryRef[]> {
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

  async getCommitDetails(repositoryPath: string, hash: string): Promise<CommitNode> {
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

  async getCommitDiff(repositoryPath: string, hash: string, filePath?: string): Promise<DiffLine[]> {
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

  async getCommitFilePreview(repositoryPath: string, hash: string, file: ChangedFile): Promise<FilePreview | null> {
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

  async getWorktree(repositoryPath: string): Promise<WorktreeState> {
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

  async getWorktreeDiff(repositoryPath: string, filePath: string, staged: boolean): Promise<DiffLine[]> {
    const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    const result = await this.run(repositoryPath, args);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取文件 diff。");
    }
    const diffLines = parseUnifiedDiff(result.stdout);
    if (diffLines.length > 0 || staged) {
      return diffLines;
    }

    if (await isUntrackedFile(repositoryPath, filePath)) {
      return readFileAsAddedDiff(repositoryPath, filePath);
    }

    return diffLines;
  }

  async getWorktreeFilePreview(repositoryPath: string, file: ChangedFile): Promise<FilePreview | null> {
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
      const worktreeBlob = await readWorktreeFile(repositoryPath, file.path);
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

  async stageFile(repositoryPath: string, filePath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["add", "--", filePath]);
  }

  async stageAll(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["add", "-A"]);
  }

  async unstageFile(repositoryPath: string, filePath: string): Promise<GitOperationResult> {
    return this.runWithFallbacks(repositoryPath, [
      ["restore", "--staged", "--", filePath],
      ["reset", "--", filePath],
      ["rm", "--cached", "-r", "--", filePath]
    ]);
  }

  async unstageAll(repositoryPath: string): Promise<GitOperationResult> {
    return this.runWithFallbacks(repositoryPath, [
      ["restore", "--staged", "--", "."],
      ["reset"],
      ["rm", "--cached", "-r", "--", "."]
    ]);
  }

  async discardFile(repositoryPath: string, file: ChangedFile): Promise<GitOperationResult> {
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

  async commit(repositoryPath: string, input: CommitInput): Promise<GitOperationResult> {
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

  async fetch(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["fetch", "--prune"]);
  }

  async pull(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["pull", "--ff-only"]);
  }

  async push(repositoryPath: string): Promise<GitOperationResult> {
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

  async getBranches(repositoryPath: string): Promise<BranchInfo[]> {
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

  async createBranch(repositoryPath: string, branchName: string, checkout: boolean, startPoint?: string): Promise<GitOperationResult> {
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

  async amendLastCommitMessage(repositoryPath: string, input: CommitMessageInput): Promise<GitOperationResult> {
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

  async resetLastCommit(repositoryPath: string, mode: Exclude<GitResetMode, "hard">): Promise<GitOperationResult> {
    return this.resetToCommit(repositoryPath, "HEAD~1", mode);
  }

  async resetToCommit(repositoryPath: string, hash: string, mode: GitResetMode): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["reset", `--${mode}`, target], { timeoutMs: resetCommandTimeoutMs });
  }

  async revertCommit(repositoryPath: string, hash: string): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["revert", "--no-edit", target]);
  }

  async cherryPickCommit(repositoryPath: string, hash: string): Promise<GitOperationResult> {
    const target = hash.trim();
    if (!target) {
      throw new Error("提交 hash 不能为空。");
    }

    return this.run(repositoryPath, ["cherry-pick", target]);
  }

  async switchBranch(repositoryPath: string, branch: BranchInfo): Promise<GitOperationResult> {
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

  async deleteBranch(repositoryPath: string, branchName: string): Promise<GitOperationResult> {
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

  private async runWithFallbacks(repositoryPath: string, commands: string[][]): Promise<GitOperationResult> {
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

  private async getPushRemote(repositoryPath: string, branchName: string): Promise<string | undefined> {
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

  private async getConfiguredPushRemote(repositoryPath: string, branchName: string): Promise<string | undefined> {
    const configuredKeys = [`branch.${branchName}.pushRemote`, "remote.pushDefault", `branch.${branchName}.remote`];
    for (const key of configuredKeys) {
      const remote = await this.getGitConfigValue(repositoryPath, key);
      if (remote && remote !== ".") {
        return remote;
      }
    }

    return undefined;
  }

  private async getGitConfigValue(repositoryPath: string, key: string): Promise<string | undefined> {
    const result = await this.run(repositoryPath, ["config", "--get", key]);
    if (!result.ok) {
      return undefined;
    }

    return result.stdout.trim() || undefined;
  }

  private async getHistoryRevisions(repositoryPath: string, status?: GitStatusSummary, filter: GitHistoryFilter = { mode: "auto" }): Promise<string[]> {
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

  private async getSingleCommit(repositoryPath: string, hash: string): Promise<CommitNode[]> {
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

  private async readGitBlob(repositoryPath: string, revision: string, filePath: string, staged = false): Promise<Buffer | null> {
    const gitPath = toGitPath(filePath);
    const objectName = staged ? `:${gitPath}` : `${revision}:${gitPath}`;
    const result = await this.runBinary(repositoryPath, ["show", objectName], { timeoutMs: 10_000 });
    if (!result.ok) {
      return null;
    }

    return result.stdout;
  }
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
      const paths = extractPorcelainPaths(line, true);
      unstagedFiles.push({ path: paths.path, oldPath: paths.oldPath, status: "conflicted", staged: false });
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

async function isUntrackedFile(repositoryPath: string, filePath: string): Promise<boolean> {
  const result = await new GitService().run(repositoryPath, ["ls-files", "--others", "--exclude-standard", "--", filePath]);
  if (!result.ok) {
    return false;
  }

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .includes(filePath);
}

async function readFileAsAddedDiff(repositoryPath: string, filePath: string): Promise<DiffLine[]> {
  const absolutePath = path.join(repositoryPath, filePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) {
    return [];
  }

  const content = await readFile(absolutePath, "utf8");
  return content.split(/\r?\n/).map((line, index) => ({
    type: "add",
    newLineNumber: index + 1,
    content: line
  }));
}

async function readWorktreeFile(repositoryPath: string, filePath: string): Promise<Buffer | null> {
  try {
    const absolutePath = path.join(repositoryPath, filePath);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      return null;
    }

    return readFile(absolutePath);
  } catch {
    return null;
  }
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
