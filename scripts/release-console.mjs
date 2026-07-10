import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

async function runProcess(command, args, options = {}) {
  const { job, displayCommand = command, displayArgs = args, allowFailure = false, env = {} } = options;
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
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
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
    child.on("error", reject);
    child.on("close", (code) => {
      stdoutWriter.flush();
      stderrWriter.flush();
      const result = {
        code: code ?? 1,
        stdout: stdout.replace(/\r?\n$/, ""),
        stderr: stderr.replace(/\r?\n$/, "")
      };
      if (result.code === 0 || allowFailure) {
        resolve(result);
        return;
      }

      const detail = result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`;
      reject(new Error(`${commandLabel(displayCommand, displayArgs)} 执行失败：${detail}`));
    });
  });
}

async function runGit(args, options = {}) {
  return runProcess(gitCommand, args, options);
}

async function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation();
  return runProcess(invocation.command, [...invocation.prefixArgs, ...args], {
    ...options,
    displayCommand: "npm",
    displayArgs: options.displayArgs ?? args
  });
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
    ["github", "推送 GitHub"]
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
    canRetryPush: job.canRetryPush
  };
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
  const result = await runGit(["ls-remote", "--heads", "--tags", remote.name], { job });
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
    await runGit(["fetch", "--no-tags", remote.name, `refs/heads/${branch}`], { job });
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

async function collectArtifacts(version) {
  if (!existsSync(releaseDir)) {
    return [];
  }
  const entries = await readdir(releaseDir);
  const artifacts = [];
  for (const name of entries) {
    if (!name.includes(version) || (!name.endsWith(".exe") && !name.endsWith(".blockmap"))) {
      continue;
    }
    const filePath = path.join(releaseDir, name);
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      artifacts.push({ name, size: fileStat.size });
    }
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
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

async function executeRelease(job) {
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
    if (!job.artifacts.some((artifact) => artifact.name.endsWith(".exe"))) {
      throw new Error(`打包完成，但 release/ 中没有找到 ${job.version} 的 Windows 安装包`);
    }
    for (const artifact of job.artifacts) {
      addLog(job, "success", `产物：${artifact.name}`);
    }
    setStage(job, "build", "completed");

    setStage(job, "commit", "running");
    await runGit(["add", "-A", "--", "."], { job });
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
      await runGit(["commit", "-F", messagePath], {
        job,
        displayArgs: ["commit", "-F", "<release-message>"]
      });
    } finally {
      await unlink(messagePath).catch(() => {});
    }
    commitCreated = true;
    await runGit(["tag", "-a", job.tag, "-m", title], { job });
    tagCreated = true;
    job.canRetryPush = true;
    setStage(job, "commit", "completed");

    setStage(job, "gitee", "running");
    await pushRelease(job.releaseContext.gitee, job.releaseContext, job);
    setStage(job, "gitee", "completed");

    setStage(job, "github", "running");
    await pushRelease(job.releaseContext.github, job.releaseContext, job);
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
      addLog(job, "warning", `本地提交和 ${job.tag} 已保留，可以重试双远端推送`);
    } else if (commitCreated) {
      job.canRetryPush = false;
      addLog(job, "warning", "版本提交已保留，但标签创建失败，请检查本地仓库后手动处理");
    }
  } finally {
    activeJobId = null;
  }
}

async function retryPush(job) {
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
  addLog(job, "info", "重新开始双远端推送");
  try {
    const tagHead = await runGit(["rev-list", "-n", "1", job.tag], { allowFailure: true });
    const currentHead = await gitOutput(["rev-parse", "HEAD"]);
    if (tagHead.code !== 0 || tagHead.stdout.trim() !== currentHead) {
      throw new Error(`${job.tag} 不再指向当前 HEAD，已停止重试`);
    }

    for (const key of ["gitee", "github"]) {
      setStage(job, key, "running");
      await pushRelease(job.releaseContext[key], job.releaseContext, job);
      setStage(job, key, "completed");
    }
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
        const job = createJob(await readJsonBody(request));
        void executeRelease(job);
        sendJson(response, 202, publicJob(job));
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
