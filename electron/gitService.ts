import { spawn } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

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
  operationState?: "merge" | "rebase" | "cherry-pick" | "revert";
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

export interface WorktreeState {
  stagedFiles: ChangedFile[];
  unstagedFiles: ChangedFile[];
}

export interface CommitInput {
  subject: string;
  body?: string;
  amend?: boolean;
}

const fieldSeparator = "\x1f";
const recordSeparator = "\x1e";

const graphColors = ["#51c2a9", "#7aa7ff", "#d69cff", "#f0c36b", "#ef6b73", "#8bd38b"];

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

export class GitService {
  async run(cwd: string, args: string[]): Promise<GitOperationResult> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd,
        shell: false,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        resolve({
          ok: false,
          command: `git ${args.join(" ")}`,
          stdout,
          stderr: error.message,
          exitCode: -1,
          messageZh: "无法执行 Git 命令，请确认本机已安装 Git 并加入 PATH。"
        });
      });

      child.on("close", (code) => {
        const exitCode = code ?? -1;
        resolve({
          ok: exitCode === 0,
          command: `git ${args.join(" ")}`,
          stdout,
          stderr,
          exitCode,
          messageZh: exitCode === 0 ? undefined : toChineseGitError(stdout, stderr)
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
    return parseStatus(result.stdout);
  }

  async getHistory(repositoryPath: string, maxCount = 300): Promise<CommitNode[]> {
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
      "--all",
      "--topo-order",
      "--date=iso-strict",
      `--max-count=${maxCount}`,
      `--pretty=format:${format}%x${recordSeparator.charCodeAt(0).toString(16)}`
    ]);

    if (!result.ok) {
      if (isEmptyRepositoryError(result.stderr)) {
        return [];
      }
      throw new Error(result.messageZh ?? "无法读取提交历史。");
    }

    return parseCommitLog(result.stdout);
  }

  async getCommitDetails(repositoryPath: string, hash: string): Promise<CommitNode> {
    const commits = await this.getSingleCommit(repositoryPath, hash);
    const commit = commits[0];
    if (!commit) {
      throw new Error("找不到指定提交。");
    }

    const filesResult = await this.run(repositoryPath, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", hash]);
    if (!filesResult.ok) {
      throw new Error(filesResult.messageZh ?? "无法读取提交变更文件。");
    }

    return {
      ...commit,
      files: parseNameStatus(filesResult.stdout)
    };
  }

  async getCommitDiff(repositoryPath: string, hash: string, filePath?: string): Promise<DiffLine[]> {
    const args = ["show", "--format=", "--patch", "--find-renames", "--no-ext-diff", hash];
    if (filePath) {
      args.push("--", filePath);
    }

    const result = await this.run(repositoryPath, args);
    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取提交 diff。");
    }

    return parseUnifiedDiff(result.stdout);
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
    if (!subject) {
      throw new Error("提交标题不能为空。");
    }

    const args = ["commit", "-m", subject];
    if (input.body?.trim()) {
      args.push("-m", input.body.trim());
    }
    if (input.amend) {
      args.push("--amend");
    }

    return this.run(repositoryPath, args);
  }

  async fetch(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["fetch", "--prune"]);
  }

  async pull(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["pull", "--ff-only"]);
  }

  async push(repositoryPath: string): Promise<GitOperationResult> {
    return this.run(repositoryPath, ["push"]);
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
      "--date=iso-strict",
      `--pretty=format:${format}%x${recordSeparator.charCodeAt(0).toString(16)}`,
      hash
    ]);

    if (!result.ok) {
      throw new Error(result.messageZh ?? "无法读取提交详情。");
    }

    return parseCommitLog(result.stdout);
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
