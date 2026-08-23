import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { syncGiteeRelease } from "./sync-gitee-release.mjs";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  GitBranch,
  GitFork,
  History,
  LoaderCircle,
  LockKeyhole,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  SquareTerminal,
  Tag,
  X
} from "lucide-react";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const consoleDir = path.join(scriptDir, "release-console");
const packagePath = path.join(rootDir, "package.json");
const packageLockPath = path.join(rootDir, "package-lock.json");
const releaseDir = path.join(rootDir, "release");
const gitCommand = "git";
const maxLogEntries = 2_000;
const remoteCheckRetryDelays = [800, 1_800];
const gitIndexLockRetryDelays = [300, 800, 1_600, 3_200, 5_000];
const remoteProbeTimeoutMs = 30_000;
const remoteFetchTimeoutMs = 120_000;
const githubReleaseReadyTimeoutMs = 15 * 60_000;
const githubReleasePollIntervalMs = 20_000;
const githubReleaseRequestTimeoutMs = 30_000;

const iconComponents = {
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  GitBranch,
  GitFork,
  History,
  LoaderCircle,
  LockKeyhole,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  SquareTerminal,
  Tag,
  X
};

const jobs = new Map();
let activeJobId = null;
let latestGiteeMirrorJob = null;
let activeGiteeMirrorController = null;

export function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version).trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: match[0]
  };
}

export function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) {
    throw new Error("只能比较 x.y.z 格式的稳定版本号");
  }

  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function recommendVersions(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return null;
  }

  return {
    patch: `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`,
    minor: `${parsed.major}.${parsed.minor + 1}.0`,
    major: `${parsed.major + 1}.0.0`
  };
}

export function parseStatusPorcelain(output) {
  const parts = output.split("\0");
  const files = [];

  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) {
      continue;
    }

    const code = entry.slice(0, 2);
    const file = {
      code,
      path: entry.slice(3),
      staged: code[0] !== " " && code[0] !== "?",
      untracked: code === "??"
    };

    if (code.includes("R") || code.includes("C")) {
      file.previousPath = parts[index + 1] || "";
      index += 1;
    }

    files.push(file);
  }

  return files;
}

export function buildCommitMessage({ title, notes, files }) {
  const cleanNotes = notes.map(cleanMessageLine).filter(Boolean);
  const cleanFiles = files.map(cleanMessageLine).filter(Boolean);
  return [
    cleanMessageLine(title),
    "",
    ...cleanNotes.map((note, index) => `${index + 1}. ${note}`),
    "",
    "涉及文件:",
    ...cleanFiles.map((file, index) => `${index + 1}. ${file}`),
    ""
  ].join("\n");
}

export function mergeReleaseNotes(requiredNotes, submittedNotes) {
  const required = requiredNotes.map(cleanMessageLine).filter(Boolean);
  const submitted = submittedNotes.map(cleanMessageLine).filter(Boolean);
  return [...required, ...submitted.filter((note) => !required.includes(note))];
}

export function detectProvider(remoteUrl) {
  const normalized = String(remoteUrl).toLowerCase();
  if (normalized.includes("github.com")) {
    return "github";
  }
  if (normalized.includes("gitee.com")) {
    return "gitee";
  }
  return "other";
}

export function parseGitHubRepository(remoteUrl) {
  const value = stripGitPrefix(String(remoteUrl || "").trim());
  const scpMatch = /^(?:[^@/:\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i.exec(value);
  let owner;
  let repository;

  if (scpMatch) {
    owner = scpMatch[1];
    repository = scpMatch[2];
  } else {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== "github.com") {
        return null;
      }
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) {
        return null;
      }
      [owner, repository] = segments;
    } catch {
      return null;
    }
  }

  repository = repository.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    return null;
  }

  return { owner, repository };
}

export function parseGiteeRepository(remoteUrl) {
  const value = stripGitPrefix(String(remoteUrl || "").trim());
  const scpMatch = /^(?:[^@/:\s]+@)?gitee\.com:([^/\s]+)\/([^/\s]+?)\/?$/i.exec(value);
  let owner;
  let repository;

  if (scpMatch) {
    owner = scpMatch[1];
    repository = scpMatch[2];
  } else {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== "gitee.com") {
        return null;
      }
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) {
        return null;
      }
      [owner, repository] = segments;
    } catch {
      return null;
    }
  }

  repository = repository.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    return null;
  }
  return { owner, repository };
}

export function resolveNpmInvocation(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }

  const execPath = options.execPath ?? process.execPath;
  const npmExecPath = options.npmExecPath ?? process.env.npm_execpath;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [
    npmExecPath,
    path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter((candidate) => candidate && /\.(?:c?js|mjs)$/i.test(candidate));
  const npmCliPath = candidates.find((candidate) => fileExists(candidate));
  if (npmCliPath) {
    return { command: execPath, prefixArgs: [npmCliPath] };
  }

  return {
    command: options.comSpec ?? process.env.ComSpec ?? "cmd.exe",
    prefixArgs: ["/d", "/s", "/c", "npm"]
  };
}

function cleanMessageLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function stripGitPrefix(remoteUrl) {
  return String(remoteUrl || "").replace(/^git\+/, "");
}

function sanitizeRemoteUrl(remoteUrl) {
  const value = String(remoteUrl || "");
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    return value.replace(/:\/\/[^/@]+@/, "://***@");
  }
}

function parseCliOptions(argv) {
  const portArgument = argv.find((argument) => argument.startsWith("--port="));
  const port = portArgument ? Number(portArgument.slice("--port=".length)) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port 必须是 0 到 65535 之间的整数");
  }

  return {
    openBrowser: !argv.includes("--no-open"),
    port
  };
}

function renderIcons(template) {
  return template.replace(/\{\{icon:([A-Za-z0-9]+)\}\}/g, (_, name) => {
    const Icon = iconComponents[name];
    if (!Icon) {
      return "";
    }
    return renderToStaticMarkup(createElement(Icon, { "aria-hidden": true, size: 18, strokeWidth: 1.8 }));
  });
}

function createLineWriter(onLine) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          onLine(stripAnsi(line));
        }
      }
    },
    flush() {
      if (pending.trim()) {
        onLine(stripAnsi(pending));
      }
      pending = "";
    }
  };
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

function quoteArgument(argument) {
  const value = String(argument);
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
}

function commandLabel(command, args) {
  return [path.basename(command).replace(/\.cmd$/i, ""), ...args].map(quoteArgument).join(" ");
}

function tailProcessOutput(value, maxLines) {
  const lines = stripAnsi(value).trim().split(/\r?\n/);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  return `[前 ${lines.length - maxLines} 行已省略]\n${lines.slice(-maxLines).join("\n")}`;
}

export function formatProcessFailureDetail(result, options = {}) {
  const { timeoutMs = 0, maxLinesPerStream = 40 } = options;
  if (result.timedOut) {
    return `命令执行超过 ${Math.round(timeoutMs / 1_000)} 秒`;
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const sections = [];
  if (stdout) {
    sections.push(`标准输出（末尾）：\n${tailProcessOutput(stdout, maxLinesPerStream)}`);
  }
  if (stderr) {
    sections.push(`标准错误（末尾）：\n${tailProcessOutput(stderr, maxLinesPerStream)}`);
  }
  sections.push(`退出码 ${result.code}`);
  return sections.join("\n\n");
}

export function isTransientGitNetworkFailure(output) {
  const detail = String(output);
  if (/(?:authentication failed|repository not found|permission denied|could not read username|couldn't find remote ref|http (?:401|403)|ssl certificate problem|certificate (?:verify|validation) failed|certificate has expired|sec_e_untrusted_root)/i.test(detail)) {
    return false;
  }

  return /(?:schannel:.*(?:failed to receive handshake|ssl\/tls connection failed|recv failure|send failure)|gnutls(?:_handshake| recv error).*?(?:pull function|non-properly terminated)|ssl_error_syscall|failed to connect|could not resolve host|connection (?:was )?(?:refused|reset|timed out)|no route to host|operation timed out|empty reply from server|recv failure|send failure|remote end hung up unexpectedly|unexpected disconnect|unexpected eof|early eof)/i.test(detail);
}

export function isTransientGitIndexLockFailure(output) {
  const detail = String(output);
  if (!/index\.lock/i.test(detail)) {
    return false;
  }

  return /(?:file exists|already exists|another git process|文件已存在|另一个 git 进程)/i.test(detail);
}

function waitForRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function terminateProcessTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => child.kill());
    killer.on("close", (code) => {
      if (code !== 0 && child.exitCode === null) {
        child.kill();
      }
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

export async function runProcess(command, args, options = {}) {
  const { job, displayCommand = command, displayArgs = args, allowFailure = false, env = {}, timeoutMs = 0 } = options;
  if (job) {
    addLog(job, "command", `$ ${commandLabel(displayCommand, displayArgs)}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        GIT_TERMINAL_PROMPT: "0",
        ...env
      },
      shell: false,
      windowsHide: true,
      detached: timeoutMs > 0 && process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle = null;
    const stdoutWriter = createLineWriter((line) => {
      if (job) {
        addLog(job, "output", line);
      }
    });
    const stderrWriter = createLineWriter((line) => {
      if (job) {
        addLog(job, "output", line);
      }
    });

    child.stdout.on("data", (chunk) => {
      if (stdout.length < 5_000_000) {
        stdout += chunk.toString("utf8");
      }
      stdoutWriter.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 5_000_000) {
        stderr += chunk.toString("utf8");
      }
      stderrWriter.push(chunk);
    });
    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      stdoutWriter.flush();
      stderrWriter.flush();
      const result = {
        code: code ?? 1,
        stdout: stdout.replace(/\r?\n$/, ""),
        stderr: stderr.replace(/\r?\n$/, ""),
        timedOut
      };
      if ((result.code === 0 && !result.timedOut) || allowFailure) {
        resolve(result);
        return;
      }

      const detail = formatProcessFailureDetail(result, { timeoutMs });
      reject(new Error(`${commandLabel(displayCommand, displayArgs)} 执行失败：${detail}`));
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, timeoutMs);
    }
  });
}

async function runGit(args, options = {}) {
  return runProcess(gitCommand, args, options);
}

export async function runGitWithNetworkRetry(args, options = {}) {
  const {
    job,
    retryLabel = "远端",
    displayArgs = args,
    timeoutMs = remoteProbeTimeoutMs,
    retryDelays = remoteCheckRetryDelays,
    runCommand = runGit,
    wait = waitForRetry,
    ...runOptions
  } = options;
  const attempts = retryDelays.length + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await runCommand(args, { ...runOptions, job, timeoutMs, allowFailure: true });
    if (result.code === 0 && !result.timedOut) {
      return result;
    }

    const detail = result.timedOut
      ? `命令执行超过 ${Math.round(timeoutMs / 1_000)} 秒`
      : result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`;
    const transient = result.timedOut || isTransientGitNetworkFailure(`${result.stderr}\n${result.stdout}`);
    if (!transient || attempt === attempts - 1) {
      const retrySummary = transient ? `（已自动尝试 ${attempts} 次，请检查网络或代理后重新发布）` : "";
      throw new Error(`${commandLabel(gitCommand, displayArgs)} 执行失败：${detail}${retrySummary}`);
    }

    const delayMs = retryDelays[attempt];
    if (job) {
      addLog(job, "warning", `${retryLabel}连接暂时中断，${delayMs / 1_000} 秒后自动重试（${attempt + 2}/${attempts}）`);
    }
    await wait(delayMs);
  }

  throw new Error(`${commandLabel(gitCommand, displayArgs)} 执行失败`);
}

export async function runGitWithIndexLockRetry(args, options = {}) {
  const {
    job,
    displayArgs = args,
    retryDelays = gitIndexLockRetryDelays,
    runCommand = runGit,
    wait = waitForRetry,
    ...runOptions
  } = options;
  const attempts = retryDelays.length + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await runCommand(args, {
      ...runOptions,
      job,
      displayArgs,
      allowFailure: true
    });
    if (result.code === 0 && !result.timedOut) {
      return result;
    }

    const detail = result.timedOut
      ? "命令执行超时"
      : result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`;
    const transient = !result.timedOut && isTransientGitIndexLockFailure(`${result.stderr}\n${result.stdout}`);
    if (!transient || attempt === attempts - 1) {
      const retrySummary = transient ? `（已自动尝试 ${attempts} 次，请结束其他 Git 操作后重新发布）` : "";
      throw new Error(`${commandLabel(gitCommand, displayArgs)} 执行失败：${detail}${retrySummary}`);
    }

    const delayMs = retryDelays[attempt];
    if (job) {
      addLog(job, "warning", `Git 索引暂时被占用，${delayMs / 1_000} 秒后自动重试（${attempt + 2}/${attempts}）`);
    }
    await wait(delayMs);
  }

  throw new Error(`${commandLabel(gitCommand, displayArgs)} 执行失败`);
}

async function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation();
  return runProcess(invocation.command, [...invocation.prefixArgs, ...args], {
    ...options,
    displayCommand: "npm",
    displayArgs: options.displayArgs ?? args
  });
}

export async function ensureReleaseDependencies(options = {}) {
  const runCommand = options.runCommand ?? runNpm;
  const job = options.job;
  let installed = false;
  const dependencyCheck = await runCommand(["ls", "--depth=0"], {
    job,
    allowFailure: true,
    timeoutMs: 2 * 60_000
  });
  if (dependencyCheck.code === 0 && !dependencyCheck.timedOut) {
    if (job) {
      addLog(job, "success", "Node.js 依赖与 package-lock.json 一致");
    }
  } else {
    if (job) {
      addLog(job, "warning", "检测到 node_modules 缺失或版本不一致，正在依据 package-lock.json 自动重建依赖");
    }
    await runCommand(["ci", "--no-audit", "--no-fund"], {
      job,
      timeoutMs: 15 * 60_000
    });
    installed = true;
    if (job) {
      addLog(job, "success", "Node.js 依赖已自动重建");
    }
  }

  if (job) {
    addLog(job, "info", "正在校验 Electron runtime");
  }
  await runCommand(["run", "ensure:electron"], {
    job,
    timeoutMs: 10 * 60_000
  });
  if (job) {
    addLog(job, "success", "Electron runtime 完整，继续执行 Windows 打包");
  }
  return { installed };
}

async function gitOutput(args, options = {}) {
  const result = await runGit(args);
  return options.raw ? result.stdout : result.stdout.trim();
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getOperationInProgress() {
  const markers = [
    ["MERGE_HEAD", "合并"],
    ["CHERRY_PICK_HEAD", "拣选"],
    ["REVERT_HEAD", "回滚"],
    ["rebase-merge", "变基"],
    ["rebase-apply", "变基"]
  ];

  for (const [marker, label] of markers) {
    const markerPath = await gitOutput(["rev-parse", "--git-path", marker]);
    if (await pathExists(path.resolve(rootDir, markerPath))) {
      return label;
    }
  }
  return null;
}

async function getRemotes(packageJson) {
  const namesOutput = await gitOutput(["remote"]);
  const names = namesOutput.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const remotes = [];

  for (const name of names) {
    const fetchUrl = await gitOutput(["remote", "get-url", name]);
    const pushResult = await runGit(["remote", "get-url", "--push", name], { allowFailure: true });
    const pushUrl = pushResult.code === 0 ? pushResult.stdout.trim() : fetchUrl;
    remotes.push({
      name,
      fetchUrl,
      pushUrl,
      displayUrl: sanitizeRemoteUrl(pushUrl),
      provider: detectProvider(pushUrl),
      exists: true
    });
  }

  const gitee = remotes.find((remote) => remote.provider === "gitee") || null;
  let github = remotes.find((remote) => remote.provider === "github") || null;
  if (!github) {
    const repositoryUrl = stripGitPrefix(
      typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url
    );
    if (detectProvider(repositoryUrl) === "github") {
      let name = "github";
      if (names.includes(name)) {
        name = "github-release";
      }
      github = {
        name,
        fetchUrl: repositoryUrl,
        pushUrl: repositoryUrl,
        displayUrl: sanitizeRemoteUrl(repositoryUrl),
        provider: "github",
        exists: false
      };
    }
  }

  return { all: remotes, gitee, github };
}

function parseTagHistory(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((record) => {
      const [tag, hash, date, subject] = record.split("\0");
      return {
        tag,
        version: tag?.startsWith("v") ? tag.slice(1) : tag,
        hash,
        date,
        subject
      };
    });
}

function highestStableVersion(packageVersion, history) {
  let highest = parseVersion(packageVersion)?.text || null;
  for (const entry of history) {
    const version = parseVersion(entry.version);
    if (version && (!highest || compareVersions(version, highest) > 0)) {
      highest = version.text;
    }
  }
  return highest;
}

async function getSuggestedNotes(history) {
  const latestTag = history.find((entry) => parseVersion(entry.version))?.tag;
  const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const result = await runGit(["log", range, "--format=%s", "-8"], { allowFailure: true });
  const notes = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return notes.length ? notes : ["同步应用版本、Windows 安装包和双远端版本标签"];
}

async function collectStatus() {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const [branch, head, statusOutput, tagOutput, userName, userEmail, operation] = await Promise.all([
    gitOutput(["branch", "--show-current"]),
    gitOutput(["rev-parse", "--short", "HEAD"]),
    gitOutput(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { raw: true }),
    gitOutput([
      "for-each-ref",
      "--sort=-version:refname",
      "--format=%(refname:short)%00%(if)%(*objectname)%(then)%(*objectname:short)%(else)%(objectname:short)%(end)%00%(creatordate:iso8601-strict)%00%(subject)",
      "refs/tags/v*"
    ]),
    runGit(["config", "--get", "user.name"], { allowFailure: true }),
    runGit(["config", "--get", "user.email"], { allowFailure: true }),
    getOperationInProgress()
  ]);
  const history = parseTagHistory(tagOutput);
  const baselineVersion = highestStableVersion(packageJson.version, history) || packageJson.version;
  const remotes = await getRemotes(packageJson);
  const files = parseStatusPorcelain(statusOutput);
  const blockers = [];

  if (!parseVersion(packageJson.version)) {
    blockers.push("package.json 的 version 必须是 x.y.z 格式");
  }
  if (!branch) {
    blockers.push("当前处于 detached HEAD，请先切换到发布分支");
  }
  if (!userName.stdout.trim() || !userEmail.stdout.trim()) {
    blockers.push("Git 提交身份未配置，请先设置 user.name 和 user.email");
  }
  if (operation) {
    blockers.push(`仓库正在进行${operation}，请先完成或中止该操作`);
  }
  if (!remotes.gitee) {
    blockers.push("未找到指向 gitee.com 的 Git 远端");
  }
  if (!remotes.github) {
    blockers.push("未找到 GitHub 远端，package.json 中也没有可用的 GitHub 仓库地址");
  }

  return {
    repository: packageJson.name,
    packageVersion: packageJson.version,
    baselineVersion,
    recommendations: recommendVersions(baselineVersion),
    branch,
    head,
    files,
    history,
    latestTag: history[0]?.tag || null,
    suggestedNotes: await getSuggestedNotes(history),
    remotes: {
      gitee: remotes.gitee && publicRemote(remotes.gitee),
      github: remotes.github && publicRemote(remotes.github)
    },
    gitIdentity: {
      name: userName.stdout.trim(),
      email: userEmail.stdout.trim()
    },
    giteeMirror: {
      tokenConfigured: Boolean(String(process.env.GITEE_TOKEN || "").trim()),
      defaultTag: history[0]?.tag || `v${packageJson.version}`
    },
    blockers,
    ready: blockers.length === 0
  };
}

function publicRemote(remote) {
  return {
    name: remote.name,
    url: remote.displayUrl,
    provider: remote.provider,
    exists: remote.exists
  };
}

function createJob(payload) {
  const id = randomUUID();
  const stageNames = [
    ["preflight", "远端预检"],
    ["version", "更新版本"],
    ["build", "Windows 打包"],
    ["commit", "提交与标签"],
    ["gitee", "推送 Gitee"],
    ["github", "GitHub 正式版"]
  ];
  const job = {
    id,
    state: "queued",
    currentStage: null,
    stages: stageNames.map(([key, label]) => ({ key, label, status: "pending" })),
    logs: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
    version: payload.version,
    tag: `v${payload.version}`,
    artifacts: [],
    error: null,
    canRetryPush: false,
    pushedRemotes: {
      gitee: false,
      github: false
    },
    payload,
    releaseContext: null
  };
  jobs.set(id, job);
  while (jobs.size > 10) {
    const oldestId = jobs.keys().next().value;
    if (oldestId === activeJobId) {
      break;
    }
    jobs.delete(oldestId);
  }
  return job;
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    currentStage: job.currentStage,
    stages: job.stages,
    logs: job.logs,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    version: job.version,
    tag: job.tag,
    artifacts: job.artifacts,
    error: job.error,
    canRetryPush: job.canRetryPush,
    retryMode: getReleaseRetryMode(job)
  };
}

export function getReleaseRetryMode(job) {
  return job.pushedRemotes.gitee && job.pushedRemotes.github ? "confirm" : "push";
}

function getLatestJob() {
  if (activeJobId && jobs.has(activeJobId)) {
    return jobs.get(activeJobId);
  }
  const jobList = Array.from(jobs.values());
  return jobList[jobList.length - 1] || null;
}

function addLog(job, level, message) {
  job.logs.push({
    id: job.logs.length ? job.logs[job.logs.length - 1].id + 1 : 1,
    time: new Date().toISOString(),
    level,
    message: stripAnsi(message)
  });
  if (job.logs.length > maxLogEntries) {
    job.logs.splice(0, job.logs.length - maxLogEntries);
  }
}

function setStage(job, key, status) {
  const stage = job.stages.find((item) => item.key === key);
  if (stage) {
    stage.status = status;
  }
  if (status === "running") {
    job.currentStage = key;
  }
}

function failCurrentStage(job) {
  if (job.currentStage) {
    setStage(job, job.currentStage, "failed");
  }
}

function validateReleasePayload(payload, status) {
  const version = parseVersion(payload.version);
  if (!version) {
    throw new Error("新版本号必须使用 x.y.z 格式，例如 0.1.6");
  }
  if (compareVersions(version, status.baselineVersion) <= 0) {
    throw new Error(`新版本必须高于当前版本基线 ${status.baselineVersion}`);
  }
  if (payload.expectedCurrentVersion !== status.packageVersion) {
    throw new Error("页面中的当前版本已经过期，请刷新后重试");
  }
  if (!Array.isArray(payload.notes)) {
    throw new Error("版本说明格式不正确");
  }
  const notes = mergeReleaseNotes(status.suggestedNotes, payload.notes);
  if (notes.length < 1 || notes.length > 12) {
    throw new Error("请填写 1 到 12 条版本说明");
  }
  if (notes.some((note) => note.length > 200)) {
    throw new Error("每条版本说明不能超过 200 个字符");
  }
  if (!status.ready) {
    throw new Error(status.blockers.join("；"));
  }
  if (!['unsigned', 'signed'].includes(payload.buildMode)) {
    throw new Error("未知的 Windows 打包模式");
  }

  return {
    ...payload,
    version: version.text,
    notes,
    buildMode: payload.buildMode
  };
}

async function ensureRemote(remote, job) {
  if (!remote) {
    throw new Error("发布远端配置在预检期间发生变化，请刷新页面后重试");
  }
  if (remote.exists) {
    return remote;
  }
  addLog(job, "info", `添加 ${remote.provider === "github" ? "GitHub" : "Gitee"} 远端 ${remote.name}`);
  await runGit(["remote", "add", remote.name, remote.pushUrl], {
    job,
    displayArgs: ["remote", "add", remote.name, sanitizeRemoteUrl(remote.pushUrl)]
  });
  return { ...remote, exists: true };
}

function parseLsRemote(output) {
  const refs = new Map();
  for (const line of output.split(/\r?\n/)) {
    const [hash, ref] = line.trim().split(/\s+/);
    if (hash && ref) {
      refs.set(ref, hash);
    }
  }
  return refs;
}

async function checkRemote(remote, branch, tag, localHead, job) {
  addLog(job, "info", `检查 ${remote.name} 的分支和标签`);
  const result = await runGitWithNetworkRetry(["ls-remote", "--heads", "--tags", remote.name], {
    job,
    retryLabel: `${remote.name} `,
    timeoutMs: remoteProbeTimeoutMs
  });
  const refs = parseLsRemote(result.stdout);
  if (refs.has(`refs/tags/${tag}`) || refs.has(`refs/tags/${tag}^{}`)) {
    throw new Error(`${remote.name} 已存在标签 ${tag}，请改用更高版本号`);
  }

  let highestRemoteVersion = null;
  for (const ref of refs.keys()) {
    const match = /^refs\/tags\/v(\d+\.\d+\.\d+)(?:\^\{\})?$/.exec(ref);
    if (!match || !parseVersion(match[1])) {
      continue;
    }
    if (!highestRemoteVersion || compareVersions(match[1], highestRemoteVersion) > 0) {
      highestRemoteVersion = match[1];
    }
  }
  if (highestRemoteVersion && compareVersions(tag.slice(1), highestRemoteVersion) <= 0) {
    throw new Error(`${remote.name} 已有更高版本 v${highestRemoteVersion}，请刷新 tag 后重新选择版本`);
  }

  const remoteHead = refs.get(`refs/heads/${branch}`);
  if (!remoteHead || remoteHead === localHead) {
    return;
  }

  let ancestorResult = await runGit(["merge-base", "--is-ancestor", remoteHead, localHead], { allowFailure: true });
  if (ancestorResult.code > 1) {
    await runGitWithNetworkRetry(["fetch", "--no-tags", remote.name, `refs/heads/${branch}`], {
      job,
      retryLabel: `${remote.name} `,
      timeoutMs: remoteFetchTimeoutMs
    });
    ancestorResult = await runGit(["merge-base", "--is-ancestor", "FETCH_HEAD", localHead], { allowFailure: true });
  }
  if (ancestorResult.code !== 0) {
    throw new Error(`${remote.name}/${branch} 包含本地没有的提交，请先拉取并处理分支差异`);
  }
}

async function getReleaseContext(status, job) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const remotes = await getRemotes(packageJson);
  const gitee = await ensureRemote(remotes.gitee, job);
  const github = await ensureRemote(remotes.github, job);
  const localTag = await runGit(["show-ref", "--verify", "--quiet", `refs/tags/${job.tag}`], { allowFailure: true });
  if (localTag.code === 0) {
    throw new Error(`本地已存在标签 ${job.tag}，请改用更高版本号`);
  }

  const localHead = await gitOutput(["rev-parse", "HEAD"]);
  await checkRemote(gitee, status.branch, job.tag, localHead, job);
  await checkRemote(github, status.branch, job.tag, localHead, job);
  return { branch: status.branch, gitee, github };
}

export function expectedWindowsUpdateArtifacts(version) {
  const baseName = `Git-UI-Pro-Setup-${version}-x64.exe`;
  return {
    installer: baseName,
    blockmap: `${baseName}.blockmap`,
    portable: `Git-UI-Pro-Portable-${version}-x64.exe`,
    metadata: "latest.yml"
  };
}

export function validateWindowsUpdateArtifacts(version, artifacts) {
  const expected = expectedWindowsUpdateArtifacts(version);
  const names = new Set(artifacts.map((artifact) => artifact.name));
  const missing = Object.values(expected).filter((name) => !names.has(name));
  return {
    valid: missing.length === 0,
    missing,
    expected
  };
}

function githubRequestHeaders(accept) {
  return {
    Accept: accept,
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
    "User-Agent": "Git-UI-Pro-Release-Console"
  };
}

export async function resolveGitHubProxy(requestUrl, options = {}) {
  const runCommand = options.runCommand ?? runGit;
  const result = await runCommand(
    ["config", "--get-urlmatch", "http.proxy", requestUrl],
    { allowFailure: true }
  );
  const configuredProxy = result.stdout.trim();
  if (result.code === 1 && !configuredProxy && !result.timedOut) {
    return null;
  }
  if (result.code !== 0 || result.timedOut) {
    const detail = result.timedOut
      ? "命令执行超时"
      : result.stderr.trim() || `退出码 ${result.code}`;
    throw new Error(`读取 GitHub 的 Git 代理配置失败：${detail}`);
  }
  if (!configuredProxy) {
    throw new Error("GitHub 的 Git 代理配置为空，请检查 http.proxy");
  }

  let parsedProxy;
  try {
    parsedProxy = new URL(configuredProxy);
  } catch {
    throw new Error("GitHub 的 Git 代理配置不是有效 URL，请检查 http.proxy");
  }
  if (!["http:", "https:", "socks:", "socks5:"].includes(parsedProxy.protocol)) {
    throw new Error(`GitHub 的 Git 代理协议 ${parsedProxy.protocol} 不受发布控制台支持`);
  }
  return parsedProxy.toString();
}

export function createGitHubProxyTransport(proxyUrl, options = {}) {
  const createDispatcher = options.createDispatcher ?? ((url) => new ProxyAgent(url));
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  const dispatcher = createDispatcher(proxyUrl);
  return {
    fetchImpl: (url, requestOptions = {}) => fetchImpl(url, { ...requestOptions, dispatcher }),
    close: async () => {
      if (typeof dispatcher.close === "function") {
        await dispatcher.close();
      }
    }
  };
}

function addCacheBuster(url, value) {
  const result = new URL(url);
  result.searchParams.set("release-console", String(value));
  return result.toString();
}

function githubRequestError(label, status) {
  const error = new Error(`${label}返回 HTTP ${status}`);
  error.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return error;
}

function githubProtocolError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

function githubCertificateErrorCode(error) {
  const code = String(error?.cause?.code || error?.code || "");
  return /(?:CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER)/i.test(code) ? code : null;
}

function isRetryableGitHubRequestError(error) {
  if (typeof error?.retryable === "boolean") {
    return error.retryable;
  }
  if (githubCertificateErrorCode(error)) {
    return false;
  }
  return error instanceof TypeError || error?.name === "AbortError" || error?.name === "TimeoutError";
}

function remainingGitHubRequestTimeout(requestOptions) {
  const remainingMs = requestOptions.deadline - requestOptions.now();
  if (remainingMs <= 0) {
    const error = new Error("已达到 GitHub 正式版等待时限");
    error.retryable = true;
    throw error;
  }
  return Math.max(1, Math.min(requestOptions.requestTimeoutMs, remainingMs));
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, handleResponse) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await handleResponse(response);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readGitHubReleaseMetadata(url, requestOptions) {
  return fetchWithTimeout(
    requestOptions.fetchImpl,
    addCacheBuster(url, requestOptions.cacheBuster),
    {
      redirect: "follow",
      headers: githubRequestHeaders("text/yaml, text/plain, */*")
    },
    remainingGitHubRequestTimeout(requestOptions),
    async (response) => {
      if (response.status === 404) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw githubRequestError("latest.yml ", response.status);
      }
      if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        await response.body?.cancel().catch(() => {});
        throw githubProtocolError("latest.yml 返回了网页内容，可能被登录页或网络代理拦截");
      }
      return response.text();
    }
  );
}

function isTrustedGitHubAssetRedirect(location, baseUrl) {
  if (!location) {
    return false;
  }
  try {
    const redirectUrl = new URL(location, baseUrl);
    const hostname = redirectUrl.hostname.toLowerCase();
    if (hostname === "github.com") {
      const sourceUrl = new URL(baseUrl);
      return redirectUrl.pathname.toLowerCase() === sourceUrl.pathname.toLowerCase();
    }
    return hostname === "objects.githubusercontent.com" ||
      hostname.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

async function isGitHubReleaseAssetReady(url, requestOptions) {
  const requestUrl = addCacheBuster(url, requestOptions.cacheBuster);
  return fetchWithTimeout(
    requestOptions.fetchImpl,
    requestUrl,
    {
      redirect: "manual",
      headers: githubRequestHeaders("application/octet-stream, */*")
    },
    remainingGitHubRequestTimeout(requestOptions),
    async (response) => {
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      const redirectReady = response.status >= 300 && response.status < 400 &&
        isTrustedGitHubAssetRedirect(response.headers.get("location"), requestUrl);
      const directReady = response.ok && !contentType.includes("text/html");
      await response.body?.cancel().catch(() => {});
      if (directReady || redirectReady) {
        return true;
      }
      if (response.status === 404) {
        return false;
      }
      if (response.status >= 300 && response.status < 400) {
        throw githubProtocolError("更新产物被重定向到非 GitHub 发布资产地址；若仓库已改名或转移，请先更新 GitHub 远端地址");
      }
      if (response.ok) {
        throw githubProtocolError("更新产物返回了网页内容，可能被登录页或网络代理拦截");
      }
      throw githubRequestError("更新产物 ", response.status);
    }
  );
}

function releaseTagFromLocation(location, baseUrl, repositoryInfo) {
  if (!location) {
    return null;
  }
  try {
    const locationUrl = new URL(location, baseUrl);
    if (locationUrl.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const segments = locationUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (
      segments.length !== 5 ||
      segments[0].toLowerCase() !== repositoryInfo.owner.toLowerCase() ||
      segments[1].toLowerCase() !== repositoryInfo.repository.toLowerCase() ||
      segments[2].toLowerCase() !== "releases" ||
      segments[3].toLowerCase() !== "tag"
    ) {
      return null;
    }
    return segments[4];
  } catch {
    return null;
  }
}

async function readGitHubLatestTag(url, requestOptions) {
  const requestUrl = addCacheBuster(url, requestOptions.cacheBuster);
  return fetchWithTimeout(
    requestOptions.fetchImpl,
    requestUrl,
    {
      redirect: "manual",
      headers: githubRequestHeaders("application/json")
    },
    remainingGitHubRequestTimeout(requestOptions),
    async (response) => {
      const locationTag = releaseTagFromLocation(
        response.headers.get("location"),
        requestUrl,
        requestOptions.repositoryInfo
      );
      if (locationTag) {
        await response.body?.cancel().catch(() => {});
        return locationTag;
      }
      if (response.status === 404) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw githubProtocolError("GitHub 最新版地址发生了非目标仓库重定向；若仓库已改名或转移，请先更新 GitHub 远端地址");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw githubRequestError("GitHub 最新版地址 ", response.status);
      }

      const body = await response.text();
      try {
        const release = JSON.parse(body);
        return typeof release.tag_name === "string" ? release.tag_name : null;
      } catch {
        return releaseTagFromLocation(
          body.match(/href=["']([^"']*\/releases\/tag\/[^"']+)["']/i)?.[1],
          requestUrl,
          requestOptions.repositoryInfo
        );
      }
    }
  );
}

function releaseMetadataHasVersion(metadata, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^version:\\s*["']?${escapedVersion}["']?\\s*$`, "m").test(metadata);
}

export async function waitForGitHubReleaseReady(repositoryInfo, tag, version, options = {}) {
  const owner = String(repositoryInfo?.owner || "");
  const repository = String(repositoryInfo?.repository || "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("无法识别 GitHub 仓库地址，不能确认正式版状态");
  }
  if (!parseVersion(version) || tag !== `v${version}`) {
    throw new Error("GitHub 正式版检查收到无效版本号");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 环境不支持检查 GitHub 正式版状态");
  }
  const wait = options.wait ?? waitForRetry;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? githubReleaseReadyTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? githubReleasePollIntervalMs;
  const requestTimeoutMs = options.requestTimeoutMs ?? githubReleaseRequestTimeoutMs;
  const onProgress = options.onProgress ?? (() => {});
  if (timeoutMs <= 0 || pollIntervalMs <= 0 || requestTimeoutMs <= 0) {
    throw new Error("GitHub 正式版检查的超时参数无效");
  }

  const encodedOwner = encodeURIComponent(owner);
  const encodedRepository = encodeURIComponent(repository);
  const encodedTag = encodeURIComponent(tag);
  const downloadBaseUrl = `https://github.com/${encodedOwner}/${encodedRepository}/releases/download/${encodedTag}`;
  const latestReleaseUrl = `https://github.com/${encodedOwner}/${encodedRepository}/releases/latest`;
  const actionsUrl = `https://github.com/${encodedOwner}/${encodedRepository}/actions`;
  const expected = expectedWindowsUpdateArtifacts(version);
  const deadline = now() + timeoutMs;
  let currentProgress = null;
  let lastFailure = null;

  const report = (key, level, message) => {
    if (currentProgress === key) {
      return;
    }
    currentProgress = key;
    onProgress({ key, level, message });
  };

  report("waiting-release", "info", `${tag} 标签已推送，等待 GitHub Actions 生成多平台正式版`);
  while (now() < deadline) {
    const cacheBuster = now();
    const requestOptions = {
      fetchImpl,
      requestTimeoutMs,
      cacheBuster,
      deadline,
      now,
      repositoryInfo: { owner, repository }
    };
    try {
      const metadata = await readGitHubReleaseMetadata(`${downloadBaseUrl}/${expected.metadata}`, requestOptions);
      if (metadata === null) {
        report("waiting-release", "info", `${tag} 标签已推送，等待 GitHub Actions 生成多平台正式版`);
      } else if (!releaseMetadataHasVersion(metadata, version) || !metadata.includes(expected.installer)) {
        report("waiting-metadata", "warning", "GitHub 已生成 latest.yml，但版本或安装包信息尚未同步完成");
      } else {
        const [installerReady, blockmapReady, portableReady] = await Promise.all([
          isGitHubReleaseAssetReady(`${downloadBaseUrl}/${encodeURIComponent(expected.installer)}`, requestOptions),
          isGitHubReleaseAssetReady(`${downloadBaseUrl}/${encodeURIComponent(expected.blockmap)}`, requestOptions),
          isGitHubReleaseAssetReady(`${downloadBaseUrl}/${encodeURIComponent(expected.portable)}`, requestOptions)
        ]);
        if (!installerReady || !blockmapReady || !portableReady) {
          report("waiting-assets", "info", `${tag} 的版本元数据已生成，等待 Windows 安装版和 Portable 上传完成`);
        } else {
          const latestTag = await readGitHubLatestTag(latestReleaseUrl, requestOptions);
          if (latestTag === tag) {
            report("ready", "success", `${tag} 的 Windows 正式版与 GitHub 最新版指针均已就绪`);
            return {
              tag,
              version,
              latestTag,
              assets: Object.values(expected)
            };
          }
          const currentLatest = latestTag ? `（当前仍为 ${latestTag}）` : "";
          report("waiting-latest", "info", `Windows 正式版产物已就绪，等待 GitHub 最新版指针切换到 ${tag}${currentLatest}`);
        }
      }
      lastFailure = null;
    } catch (error) {
      if (!isRetryableGitHubRequestError(error)) {
        const certificateCode = githubCertificateErrorCode(error);
        if (certificateCode) {
          throw githubProtocolError(`GitHub TLS 证书校验失败（${certificateCode}），请检查系统时间、证书或网络代理`);
        }
        throw error;
      }
      lastFailure = error instanceof Error ? error.message : String(error);
      report("network-error", "warning", `GitHub 状态检查暂时失败，将自动重试：${lastFailure}`);
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      break;
    }
    await wait(Math.min(pollIntervalMs, remainingMs));
  }

  const failureDetail = lastFailure ? `最近一次检查失败：${lastFailure}。` : "";
  throw new Error(
    `标签 ${tag} 已推送，但 GitHub Windows 正式版在 ${Math.ceil(timeoutMs / 60_000)} 分钟内仍未就绪。` +
    `${failureDetail}请检查 ${actionsUrl}，工作流完成后重试发布流程。`
  );
}

export async function collectArtifacts(version, directory = releaseDir) {
  if (!existsSync(directory)) {
    return [];
  }
  const expectedNames = new Set(Object.values(expectedWindowsUpdateArtifacts(version)));
  const entries = await readdir(directory);
  const artifacts = [];
  for (const name of entries) {
    if (!expectedNames.has(name)) {
      continue;
    }
    const filePath = path.join(directory, name);
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      artifacts.push({ name, size: fileStat.size });
    }
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
}

function stableVersionFromReleaseTag(tag) {
  const match = /^v(.+)$/.exec(String(tag || "").trim());
  const version = match ? parseVersion(match[1]) : null;
  if (!version) {
    throw new Error("Gitee 镜像标签必须使用 v加x.y.z 格式，例如 v0.1.32");
  }
  return version.text;
}

function createGiteeMirrorJob(tag) {
  const version = stableVersionFromReleaseTag(tag);
  return {
    id: randomUUID(),
    tag: `v${version}`,
    version,
    state: "queued",
    createdAt: new Date().toISOString(),
    completedAt: null,
    progress: {
      phase: "queued",
      percent: 0,
      message: "等待开始同步",
      assetName: null,
      uploadedBytes: 0,
      totalBytes: 0
    },
    files: [],
    logs: [],
    error: null,
    releaseUrl: null
  };
}

function publicGiteeMirrorJob(job) {
  return job ? {
    id: job.id,
    tag: job.tag,
    version: job.version,
    state: job.state,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    progress: job.progress,
    files: job.files,
    logs: job.logs,
    error: job.error,
    releaseUrl: job.releaseUrl
  } : null;
}

function updateGiteeMirrorProgress(job, event) {
  const eventTotalBytes = Number(event.overallTotalBytes) || 0;
  const overallTotalBytes = eventTotalBytes || job.progress.totalBytes || 0;
  const overallUploadedBytes = Number(event.overallUploadedBytes) || 0;
  const percent = eventTotalBytes > 0
    ? Math.max(30, Math.min(100, 30 + Math.round((overallUploadedBytes / eventTotalBytes) * 70)))
    : job.progress.percent;
  job.progress = {
    phase: event.phase || job.progress.phase,
    percent,
    message: event.message || job.progress.message,
    assetName: event.assetName || null,
    uploadedBytes: overallUploadedBytes,
    totalBytes: overallTotalBytes
  };

  if (event.assetName) {
    let file = job.files.find((entry) => entry.name === event.assetName);
    if (!file) {
      file = { name: event.assetName, size: Number(event.assetSize) || 0, status: "pending", percent: 0 };
      job.files.push(file);
    }
    file.status = event.status || file.status;
    file.size = Number(event.assetSize) || file.size;
    file.percent = file.size > 0
      ? Math.max(0, Math.min(100, Math.round(((Number(event.uploadedBytes) || 0) / file.size) * 100)))
      : file.percent;
    if (["uploaded", "skipped"].includes(file.status)) {
      file.percent = 100;
    }
  }
  if (event.message) {
    addLog(job, event.status === "skipped" ? "info" : "output", event.message);
  }
}

function githubReleaseHeaders(accept = "application/vnd.github+json") {
  const headers = {
    Accept: accept,
    "Cache-Control": "no-cache",
    "User-Agent": "Git-UI-Pro-Release-Console",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (String(process.env.GITHUB_TOKEN || "").trim()) {
    headers.Authorization = `Bearer ${String(process.env.GITHUB_TOKEN).trim()}`;
  }
  return headers;
}

function mirrorAbortError() {
  const error = new Error("Gitee 国内镜像同步已取消。");
  error.name = "AbortError";
  return error;
}

function throwIfMirrorAborted(signal) {
  if (signal?.aborted) {
    throw mirrorAbortError();
  }
}

async function readGitHubReleaseForMirror(repositoryInfo, tag, fetchImpl, signal) {
  throwIfMirrorAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, githubReleaseRequestTimeoutMs);
  const handleAbort = () => controller.abort();
  signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repositoryInfo.owner}/${repositoryInfo.repository}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: githubReleaseHeaders(), signal: controller.signal }
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`读取 GitHub ${tag} 正式版附件失败（HTTP ${response.status}）`);
    }
    const release = await response.json();
    if (release?.tag_name !== tag || release.draft === true || release.prerelease === true) {
      throw new Error(`GitHub ${tag} 不是可同步的正式发行版`);
    }
    return release;
  } catch (error) {
    if (signal?.aborted) {
      throw mirrorAbortError();
    }
    if (timedOut) {
      throw new Error(`读取 GitHub ${tag} 正式版附件超过 ${githubReleaseRequestTimeoutMs / 1_000} 秒`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleAbort);
  }
}

async function sha256LocalFile(filename, signal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) {
    throwIfMirrorAborted(signal);
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function localFileMatchesGitHubAsset(filename, asset, signal) {
  try {
    const fileStat = await stat(filename);
    if (!fileStat.isFile() || fileStat.size !== Number(asset.size)) {
      return false;
    }
    const digestMatch = /^sha256:([a-f\d]{64})$/i.exec(String(asset.digest || ""));
    if (!digestMatch) {
      return true;
    }
    return (await sha256LocalFile(filename, signal)) === digestMatch[1].toLowerCase();
  } catch (error) {
    throwIfMirrorAborted(signal);
    return false;
  }
}

async function downloadGitHubReleaseAsset(asset, destination, fetchImpl, signal, onProgress) {
  const downloadUrl = new URL(String(asset.browser_download_url || ""));
  if (downloadUrl.protocol !== "https:" || downloadUrl.hostname.toLowerCase() !== "github.com") {
    throw new Error(`GitHub 附件 ${asset.name} 的下载地址无效`);
  }
  const partialPath = `${destination}.part`;
  await unlink(partialPath).catch(() => {});
  const controller = new AbortController();
  let timedOut = false;
  let idleTimeoutId = null;
  const totalTimeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25 * 60_000);
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => controller.abort(), 2 * 60_000);
  };
  const handleAbort = () => controller.abort();
  signal?.addEventListener("abort", handleAbort, { once: true });
  let output;
  try {
    resetIdleTimeout();
    const response = await fetchImpl(downloadUrl, {
      redirect: "follow",
      headers: githubReleaseHeaders("application/octet-stream"),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`下载 GitHub 附件 ${asset.name} 失败（HTTP ${response.status}）`);
    }
    output = createWriteStream(partialPath, { flags: "wx" });
    let downloadedBytes = 0;
    for await (const chunk of Readable.fromWeb(response.body)) {
      throwIfMirrorAborted(signal);
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
      downloadedBytes += chunk.length;
      resetIdleTimeout();
      onProgress(downloadedBytes, Number(asset.size) || 0);
    }
    output.end();
    await once(output, "finish");
    output = null;
    if (!await localFileMatchesGitHubAsset(partialPath, asset, signal)) {
      throw new Error(`GitHub 附件 ${asset.name} 下载后大小或 SHA-256 校验失败`);
    }
    await unlink(destination).catch(() => {});
    await rename(partialPath, destination);
  } catch (error) {
    output?.destroy();
    await unlink(partialPath).catch(() => {});
    if (signal?.aborted) {
      throw mirrorAbortError();
    }
    if (timedOut) {
      throw new Error(`下载 GitHub 附件 ${asset.name} 超过 25 分钟`);
    }
    if (controller.signal.aborted) {
      throw new Error(`下载 GitHub 附件 ${asset.name} 连续 2 分钟无网络进度`);
    }
    throw error;
  } finally {
    clearTimeout(totalTimeoutId);
    clearTimeout(idleTimeoutId);
    signal?.removeEventListener("abort", handleAbort);
  }
}

async function prepareGitHubMirrorArtifacts(job, repositoryInfo, fetchImpl, signal) {
  addLog(job, "info", `核对 GitHub ${job.tag} 的正式发布附件`);
  const release = await readGitHubReleaseForMirror(repositoryInfo, job.tag, fetchImpl, signal);
  const expected = expectedWindowsUpdateArtifacts(job.version);
  const assetsByName = new Map(
    Array.isArray(release.assets) ? release.assets.map((asset) => [asset?.name, asset]) : []
  );
  const assets = Object.values(expected).map((name) => {
    const asset = assetsByName.get(name);
    if (!asset || !Number.isSafeInteger(Number(asset.size)) || Number(asset.size) <= 0) {
      throw new Error(`GitHub ${job.tag} 缺少正式附件：${name}`);
    }
    return asset;
  });
  const cacheDirectory = path.join(
    tmpdir(),
    "git-ui-pro-release-cache",
    `${repositoryInfo.owner}-${repositoryInfo.repository}`,
    job.tag
  );
  await mkdir(cacheDirectory, { recursive: true });
  const totalBytes = assets.reduce((total, asset) => total + Number(asset.size), 0);
  let preparedBytes = 0;
  job.files = assets.map((asset) => ({ name: asset.name, size: Number(asset.size), status: "pending", percent: 0 }));

  for (const asset of assets) {
    throwIfMirrorAborted(signal);
    const targetPath = path.join(cacheDirectory, asset.name);
    const localPath = path.join(releaseDir, asset.name);
    const file = job.files.find((entry) => entry.name === asset.name);
    if (await localFileMatchesGitHubAsset(targetPath, asset, signal)) {
      file.status = "prepared";
      file.percent = 100;
      preparedBytes += Number(asset.size);
      addLog(job, "info", `复用已校验的 GitHub 缓存：${asset.name}`);
      continue;
    }
    if (await localFileMatchesGitHubAsset(localPath, asset, signal)) {
      await copyFile(localPath, targetPath);
      file.status = "prepared";
      file.percent = 100;
      preparedBytes += Number(asset.size);
      addLog(job, "info", `本地正式产物与 GitHub 一致：${asset.name}`);
      continue;
    }

    file.status = "downloading";
    addLog(job, "info", `从 GitHub 下载正式附件到本机缓存：${asset.name}`);
    await downloadGitHubReleaseAsset(asset, targetPath, fetchImpl, signal, (downloadedBytes, assetSize) => {
      file.percent = assetSize > 0 ? Math.round((downloadedBytes / assetSize) * 100) : 0;
      job.progress = {
        phase: "downloading",
        percent: totalBytes > 0 ? Math.round(((preparedBytes + downloadedBytes) / totalBytes) * 30) : 0,
        message: `下载 GitHub 正式附件：${asset.name}`,
        assetName: asset.name,
        uploadedBytes: preparedBytes + downloadedBytes,
        totalBytes
      };
    });
    file.status = "prepared";
    file.percent = 100;
    preparedBytes += Number(asset.size);
  }
  job.progress = {
    phase: "prepared",
    percent: 30,
    message: "GitHub 正式附件已完成本地准备，开始校验 Gitee 现有附件",
    assetName: null,
    uploadedBytes: preparedBytes,
    totalBytes
  };
  addLog(job, "success", "GitHub 正式附件已在本机完成大小与 SHA-256 校验");
  return { directory: cacheDirectory, release };
}

async function executeGiteeMirror(job, giteeToken, options = {}) {
  const controller = options.controller ?? new AbortController();
  activeGiteeMirrorController = controller;
  job.state = "running";
  job.error = null;
  job.completedAt = null;
  addLog(job, "info", `从本机开始同步 ${job.tag} 到 Gitee 国内镜像`);
  let githubTransport = null;
  try {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const remotes = await getRemotes(packageJson);
    const githubRepository = parseGitHubRepository(remotes.github?.pushUrl);
    const giteeRepository = parseGiteeRepository(remotes.gitee?.pushUrl);
    if (!githubRepository) {
      throw new Error("无法从 GitHub 远端识别公开仓库地址，不能读取正式版说明");
    }
    if (!giteeRepository) {
      throw new Error("无法从 Gitee 远端识别仓库地址，不能同步国内镜像");
    }

    const githubReleaseUrl = `https://github.com/${githubRepository.owner}/${githubRepository.repository}/releases/tag/${job.tag}`;
    const proxyUrl = await resolveGitHubProxy(githubReleaseUrl);
    if (proxyUrl) {
      githubTransport = createGitHubProxyTransport(proxyUrl);
      addLog(job, "info", "GitHub 发行说明读取使用 Git 配置中的代理；Gitee 大文件保持国内直连");
    } else {
      addLog(job, "info", "GitHub 与 Gitee 均使用本机直连网络");
    }

    const prepared = await prepareGitHubMirrorArtifacts(
      job,
      githubRepository,
      githubTransport?.fetchImpl ?? globalThis.fetch,
      controller.signal
    );

    const result = await syncGiteeRelease({
      giteeToken,
      githubToken: process.env.GITHUB_TOKEN,
      githubRepository: `${githubRepository.owner}/${githubRepository.repository}`,
      tagName: job.tag,
      artifactsDirectory: prepared.directory,
      giteeOwner: giteeRepository.owner,
      giteeRepository: giteeRepository.repository,
      githubRelease: prepared.release,
      githubFetchImpl: githubTransport?.fetchImpl,
      signal: controller.signal,
      onProgress: (event) => updateGiteeMirrorProgress(job, event)
    });
    job.releaseUrl = result.releaseUrl;
    job.state = "completed";
    job.progress = { ...job.progress, phase: "completed", percent: 100, message: `${job.tag} 国内镜像已完整就绪` };
    job.completedAt = new Date().toISOString();
    addLog(
      job,
      "success",
      `Gitee 镜像同步完成：上传 ${result.uploadedAssets.length} 项，复用 ${result.skippedAssets.length} 项`
    );
  } catch (error) {
    const cancelled = controller.signal.aborted || error?.name === "AbortError";
    job.state = cancelled ? "cancelled" : "failed";
    job.error = cancelled ? "同步已由用户取消，可稍后继续；已完整上传的文件会自动跳过。" : (error instanceof Error ? error.message : String(error));
    job.progress = { ...job.progress, phase: job.state, message: job.error };
    job.completedAt = new Date().toISOString();
    addLog(job, cancelled ? "warning" : "error", job.error);
  } finally {
    await githubTransport?.close();
    if (activeGiteeMirrorController === controller) {
      activeGiteeMirrorController = null;
    }
  }
}

function startGiteeMirror(payload = {}) {
  if (activeGiteeMirrorController) {
    throw new Error("已有 Gitee 国内镜像同步正在执行");
  }
  if (activeJobId) {
    throw new Error("正式版发布任务正在执行，请等待发布完成后再手动同步镜像");
  }
  const giteeToken = String(payload.giteeToken || process.env.GITEE_TOKEN || "").trim();
  if (!giteeToken) {
    throw new Error("请输入 Gitee 私人令牌，或在启动发布控制台前设置 GITEE_TOKEN");
  }
  const job = createGiteeMirrorJob(payload.tag);
  latestGiteeMirrorJob = job;
  void executeGiteeMirror(job, giteeToken);
  return job;
}

function cancelGiteeMirror() {
  if (!activeGiteeMirrorController || latestGiteeMirrorJob?.state !== "running") {
    throw new Error("当前没有正在执行的 Gitee 国内镜像同步");
  }
  addLog(latestGiteeMirrorJob, "warning", "正在安全取消上传，请稍候");
  activeGiteeMirrorController.abort();
  return latestGiteeMirrorJob;
}

async function pushRelease(remote, context, job) {
  const atomicResult = await runGit([
    "push",
    "--atomic",
    remote.name,
    `HEAD:refs/heads/${context.branch}`,
    `refs/tags/${job.tag}:refs/tags/${job.tag}`
  ], { job, allowFailure: true });
  if (atomicResult.code === 0) {
    return;
  }

  const output = `${atomicResult.stderr}\n${atomicResult.stdout}`;
  if (!/atomic.*(?:not supported|不支持)|does not support.*atomic/i.test(output)) {
    throw new Error(`推送到 ${remote.name} 失败：${atomicResult.stderr.trim() || atomicResult.stdout.trim()}`);
  }

  addLog(job, "warning", `${remote.name} 不支持原子推送，将依次推送分支和标签`);
  await runGit(["push", remote.name, `HEAD:refs/heads/${context.branch}`], { job });
  await runGit(["push", remote.name, `refs/tags/${job.tag}:refs/tags/${job.tag}`], { job });
}

async function confirmGitHubReleaseReady(job) {
  const currentRemote = await runGit(
    ["remote", "get-url", "--push", job.releaseContext.github.name],
    { allowFailure: true }
  );
  const remoteUrl = currentRemote.code === 0
    ? currentRemote.stdout.trim()
    : job.releaseContext.github.pushUrl;
  const repository = parseGitHubRepository(remoteUrl);
  if (!repository) {
    throw new Error("GitHub 标签已推送，但无法从远端地址识别仓库，不能确认正式安装包状态");
  }
  const releaseUrl = `https://github.com/${repository.owner}/${repository.repository}/releases/download/${job.tag}/latest.yml`;
  const proxyUrl = await resolveGitHubProxy(releaseUrl);
  const transport = proxyUrl ? createGitHubProxyTransport(proxyUrl) : null;
  if (proxyUrl) {
    addLog(job, "info", "GitHub 状态检查使用 Git 配置中的网络代理");
  }
  try {
    await waitForGitHubReleaseReady(repository, job.tag, job.version, {
      fetchImpl: transport?.fetchImpl,
      onProgress: ({ level, message }) => addLog(job, level, message)
    });
  } finally {
    await transport?.close();
  }
}

async function executeRelease(job, options = {}) {
  activeJobId = job.id;
  job.state = "running";
  let originalPackage = null;
  let originalPackageLock = null;
  let versionChanged = false;
  let changesStaged = false;
  let commitCreated = false;
  let tagCreated = false;

  try {
    setStage(job, "preflight", "running");
    addLog(job, "info", `开始准备 ${job.tag}`);
    const status = await collectStatus();
    job.payload = validateReleasePayload(job.payload, status);
    job.releaseContext = await getReleaseContext(status, job);
    await ensureReleaseDependencies({ job });
    setStage(job, "preflight", "completed");

    setStage(job, "version", "running");
    originalPackage = await readFile(packagePath);
    originalPackageLock = await readFile(packageLockPath);
    versionChanged = true;
    await runNpm(["version", job.version, "--no-git-tag-version"], { job });
    const updatedPackage = JSON.parse(await readFile(packagePath, "utf8"));
    if (updatedPackage.version !== job.version) {
      throw new Error(`版本更新后仍为 ${updatedPackage.version}，预期为 ${job.version}`);
    }
    setStage(job, "version", "completed");

    setStage(job, "build", "running");
    const buildScript = job.payload.buildMode === "signed" ? "dist:win:signed" : "dist:win";
    await runNpm(["run", buildScript, "--", "--publish", "never"], { job });
    job.artifacts = await collectArtifacts(job.version);
    const artifactValidation = validateWindowsUpdateArtifacts(job.version, job.artifacts);
    if (!artifactValidation.valid) {
      throw new Error(`打包完成，但 release/ 缺少 Windows 安装版或 Portable 正式产物：${artifactValidation.missing.join("、")}`);
    }
    for (const artifact of job.artifacts) {
      addLog(job, "success", `产物：${artifact.name}`);
    }
    setStage(job, "build", "completed");

    setStage(job, "commit", "running");
    await runGitWithIndexLockRetry(["add", "-A", "--", "."], { job });
    changesStaged = true;
    const filesResult = await runGit(["diff", "--cached", "--name-only", "-z"], { job });
    const files = filesResult.stdout.split("\0").map((file) => file.trim()).filter(Boolean);
    if (!files.length) {
      throw new Error("没有可提交的版本变更");
    }
    const title = `chore(release): 发布 ${job.tag}`;
    const message = buildCommitMessage({ title, notes: job.payload.notes, files });
    const gitDir = await gitOutput(["rev-parse", "--git-dir"]);
    const messagePath = path.resolve(rootDir, gitDir, `release-message-${job.id}.txt`);
    await writeFile(messagePath, message, "utf8");
    try {
      await runGitWithIndexLockRetry(["commit", "-F", messagePath], {
        job,
        displayArgs: ["commit", "-F", "<release-message>"]
      });
    } finally {
      await unlink(messagePath).catch(() => {});
    }
    commitCreated = true;
    await runGitWithIndexLockRetry(["tag", "-a", job.tag, "-m", title], { job });
    tagCreated = true;
    job.canRetryPush = true;
    setStage(job, "commit", "completed");

    setStage(job, "gitee", "running");
    await pushRelease(job.releaseContext.gitee, job.releaseContext, job);
    job.pushedRemotes.gitee = true;
    setStage(job, "gitee", "completed");

    setStage(job, "github", "running");
    await pushRelease(job.releaseContext.github, job.releaseContext, job);
    job.pushedRemotes.github = true;
    await confirmGitHubReleaseReady(job);
    setStage(job, "github", "completed");

    job.state = "completed";
    job.canRetryPush = false;
    job.currentStage = null;
    job.completedAt = new Date().toISOString();
    addLog(job, "success", `${job.tag} 已发布到 Gitee 和 GitHub`);
  } catch (error) {
    failCurrentStage(job);
    job.state = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.completedAt = new Date().toISOString();
    addLog(job, "error", job.error);

    if (versionChanged && !changesStaged && !commitCreated && originalPackage && originalPackageLock) {
      await Promise.all([
        writeFile(packagePath, originalPackage),
        writeFile(packageLockPath, originalPackageLock)
      ]);
      addLog(job, "info", "构建未进入提交阶段，已恢复 package.json 和 package-lock.json 的原始版本");
    } else if (changesStaged && !commitCreated) {
      addLog(job, "warning", "提交未完成，版本变更和暂存区已保留，请检查后手动处理");
    } else if (commitCreated && tagCreated) {
      job.canRetryPush = true;
      const retryHint = job.pushedRemotes.gitee && job.pushedRemotes.github
        ? "远端推送已完成，可以重试 GitHub 正式版确认"
        : "可以重试双远端发布流程";
      addLog(job, "warning", `本地提交和 ${job.tag} 已保留，${retryHint}`);
    } else if (commitCreated) {
      job.canRetryPush = false;
      addLog(job, "warning", "版本提交已保留，但标签创建失败，请检查本地仓库后手动处理");
    }
  } finally {
    activeJobId = null;
    if (job.state === "completed" && job.payload.syncGiteeMirror === true) {
      try {
        startGiteeMirror({ tag: job.tag, giteeToken: options.giteeToken });
        addLog(job, "info", "GitHub 正式版已完成，Gitee 国内镜像已转入独立的本地同步任务");
      } catch (error) {
        addLog(
          job,
          "warning",
          `GitHub 正式版不受影响；Gitee 国内镜像未自动启动：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

async function verifyRetryTagAtCurrentHead(job) {
  const tagHead = await runGit(["rev-list", "-n", "1", job.tag], { allowFailure: true });
  const currentHead = await gitOutput(["rev-parse", "HEAD"]);
  if (tagHead.code !== 0 || tagHead.stdout.trim() !== currentHead) {
    throw new Error(`${job.tag} 不再指向当前 HEAD，已停止重试`);
  }
}

export async function resumeReleasePublication(job, options = {}) {
  const retryMode = getReleaseRetryMode(job);
  const verifyTag = options.verifyTag ?? verifyRetryTagAtCurrentHead;
  const pushRemote = options.pushRemote ?? ((key) => (
    pushRelease(job.releaseContext[key], job.releaseContext, job)
  ));
  const confirmRelease = options.confirmRelease ?? (() => confirmGitHubReleaseReady(job));

  if (retryMode === "push") {
    await verifyTag(job);
    for (const key of ["gitee", "github"]) {
      if (job.pushedRemotes[key]) {
        setStage(job, key, "completed");
        continue;
      }
      setStage(job, key, "running");
      await pushRemote(key, job);
      job.pushedRemotes[key] = true;
      setStage(job, key, "completed");
    }
  }

  setStage(job, "github", "running");
  await confirmRelease(job);
  setStage(job, "github", "completed");
  return retryMode;
}

export async function retryPush(job, options = {}) {
  if (activeJobId) {
    throw new Error("已有发布任务正在执行");
  }
  if (!job.canRetryPush || !job.releaseContext) {
    throw new Error("当前任务不能重试推送");
  }

  activeJobId = job.id;
  job.state = "running";
  job.error = null;
  job.completedAt = null;
  const retryMode = getReleaseRetryMode(job);
  addLog(job, "info", retryMode === "confirm" ? "远端推送已完成，重新检查 GitHub 正式版" : "重新检查双远端发布流程");
  try {
    await resumeReleasePublication(job, options);
    job.state = "completed";
    job.currentStage = null;
    job.canRetryPush = false;
    job.completedAt = new Date().toISOString();
    addLog(job, "success", `${job.tag} 已发布到 Gitee 和 GitHub`);
  } catch (error) {
    failCurrentStage(job);
    job.state = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.completedAt = new Date().toISOString();
    job.canRetryPush = true;
    addLog(job, "error", job.error);
    throw error;
  } finally {
    activeJobId = null;
  }
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString("utf8");
    if (body.length > 65_536) {
      throw new Error("请求内容过大");
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("请求 JSON 格式无效");
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendText(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(body);
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

export async function startReleaseConsole(options = {}) {
  const token = randomBytes(24).toString("base64url");
  const [htmlTemplate, css, javascript, brandIcon] = await Promise.all([
    readFile(path.join(consoleDir, "index.html"), "utf8"),
    readFile(path.join(consoleDir, "styles.css"), "utf8"),
    readFile(path.join(consoleDir, "app.js"), "utf8"),
    readFile(path.join(rootDir, "build", "icon.png"))
  ]);
  const html = renderIcons(htmlTemplate)
    .replace("{{RELEASE_TOKEN}}", token)
    .replace("{{BRAND_ICON}}", `data:image/png;base64,${brandIcon.toString("base64")}`);
  let expectedOrigin = null;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", expectedOrigin || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        sendText(response, 200, "text/html; charset=utf-8", html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        sendText(response, 200, "text/css; charset=utf-8", css);
        return;
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        sendText(response, 200, "text/javascript; charset=utf-8", javascript);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (!url.pathname.startsWith("/api/") || request.headers["x-release-token"] !== token) {
        sendJson(response, 403, { error: "发布控制台令牌无效，请重新打开页面" });
        return;
      }
      if (request.method === "POST" && request.headers.origin !== expectedOrigin) {
        sendJson(response, 403, { error: "发布请求来源无效" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, await collectStatus());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/jobs/latest") {
        const job = getLatestJob();
        sendJson(response, 200, job ? publicJob(job) : null);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/gitee-mirror") {
        sendJson(response, 200, publicGiteeMirrorJob(latestGiteeMirrorJob));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
        const jobId = url.pathname.split("/")[3];
        const job = jobs.get(jobId);
        if (!job) {
          sendJson(response, 404, { error: "发布任务不存在" });
          return;
        }
        sendJson(response, 200, publicJob(job));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/releases") {
        if (activeJobId) {
          sendJson(response, 409, { error: "已有发布任务正在执行" });
          return;
        }
        if (activeGiteeMirrorController) {
          sendJson(response, 409, { error: "Gitee 国内镜像正在同步，请完成或取消后再发布新版本" });
          return;
        }
        const payload = await readJsonBody(request);
        const giteeToken = String(payload.giteeToken || "").trim();
        delete payload.giteeToken;
        const job = createJob(payload);
        void executeRelease(job, { giteeToken });
        sendJson(response, 202, publicJob(job));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/gitee-mirror") {
        const job = startGiteeMirror(await readJsonBody(request));
        sendJson(response, 202, publicGiteeMirrorJob(job));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/gitee-mirror/cancel") {
        const job = cancelGiteeMirror();
        sendJson(response, 202, publicGiteeMirrorJob(job));
        return;
      }
      const retryMatch = /^\/api\/jobs\/([^/]+)\/retry$/.exec(url.pathname);
      if (request.method === "POST" && retryMatch) {
        const job = jobs.get(retryMatch[1]);
        if (!job) {
          sendJson(response, 404, { error: "发布任务不存在" });
          return;
        }
        void retryPush(job).catch(() => {});
        sendJson(response, 202, publicJob(job));
        return;
      }

      sendJson(response, 404, { error: "请求地址不存在" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}`;
  expectedOrigin = url;

  if (options.openBrowser !== false) {
    openBrowser(url);
  }

  return { server, url, token };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const { server, url } = await startReleaseConsole(options);
  console.log(`\nGit UI Pro 发布控制台已启动：${url}`);
  console.log("关闭此终端或按 Ctrl+C 可停止服务。\n");

  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`发布控制台启动失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
