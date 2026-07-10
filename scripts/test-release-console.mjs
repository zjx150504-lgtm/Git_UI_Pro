import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildCommitMessage,
  compareVersions,
  detectProvider,
  mergeReleaseNotes,
  parseStatusPorcelain,
  parseVersion,
  recommendVersions,
  resolveNpmInvocation,
  startReleaseConsole
} from "./release-console.mjs";

test("解析并推荐稳定版本号", () => {
  assert.deepEqual(parseVersion("0.1.5"), { major: 0, minor: 1, patch: 5, text: "0.1.5" });
  assert.equal(parseVersion("v0.1.5"), null);
  assert.equal(parseVersion("01.1.5"), null);
  assert.deepEqual(recommendVersions("0.1.5"), {
    patch: "0.1.6",
    minor: "0.2.0",
    major: "1.0.0"
  });
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
});

test("解析包含暂存、未暂存、未跟踪和重命名的工作区状态", () => {
  const files = parseStatusPorcelain("M  src/a.ts\0 M src/b.ts\0?? docs/new.md\0R  src/new.ts\0src/old.ts\0");
  assert.deepEqual(files, [
    { code: "M ", path: "src/a.ts", staged: true, untracked: false },
    { code: " M", path: "src/b.ts", staged: false, untracked: false },
    { code: "??", path: "docs/new.md", staged: false, untracked: true },
    { code: "R ", path: "src/new.ts", previousPath: "src/old.ts", staged: true, untracked: false }
  ]);
});

test("生成符合仓库规则的中文分段提交信息", () => {
  assert.equal(
    buildCommitMessage({
      title: "chore(release): 发布 v0.1.6",
      notes: ["更新版本号", "生成 Windows 安装包"],
      files: ["package.json", "package-lock.json"]
    }),
    "chore(release): 发布 v0.1.6\n\n1. 更新版本号\n2. 生成 Windows 安装包\n\n涉及文件:\n1. package.json\n2. package-lock.json\n"
  );
});

test("自动版本说明不能被提交请求删除", () => {
  assert.deepEqual(
    mergeReleaseNotes(["自动记录一", "自动记录二"], ["自动记录二", "补充说明"]),
    ["自动记录一", "自动记录二", "补充说明"]
  );
  assert.deepEqual(mergeReleaseNotes(["自动记录一"], []), ["自动记录一"]);
});

test("识别 GitHub 与 Gitee 远端", () => {
  assert.equal(detectProvider("https://github.com/example/repo.git"), "github");
  assert.equal(detectProvider("git@gitee.com:example/repo.git"), "gitee");
  assert.equal(detectProvider("https://git.example.com/repo.git"), "other");
});

test("Windows 通过 Node 执行 npm CLI，避免直接 spawn npm.cmd", () => {
  const invocation = resolveNpmInvocation({
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    npmExecPath: "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
    fileExists: (candidate) => candidate.endsWith("npm-cli.js")
  });
  assert.deepEqual(invocation, {
    command: "C:\\node\\node.exe",
    prefixArgs: ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js"]
  });
});

test("当前环境解析出的 npm 调用可以正常启动", () => {
  const invocation = resolveNpmInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, "--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("发布控制台仅凭令牌返回仓库状态", async () => {
  const { server, url, token } = await startReleaseConsole({ port: 0, openBrowser: false });
  try {
    const forbidden = await fetch(`${url}/api/status`);
    assert.equal(forbidden.status, 403);

    const forbiddenMutation = await fetch(`${url}/api/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-release-token": token
      },
      body: "{}"
    });
    assert.equal(forbiddenMutation.status, 403);

    const response = await fetch(`${url}/api/status`, {
      headers: { "x-release-token": token }
    });
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.repository, "git-ui-pro");
    assert.ok(parseVersion(status.packageVersion));
    assert.ok(compareVersions(status.recommendations.patch, status.baselineVersion) > 0);
    assert.equal(status.remotes.gitee.provider, "gitee");
    assert.ok(Array.isArray(status.history));
    assert.ok(Array.isArray(status.files));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
