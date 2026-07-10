import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommitMessage,
  compareVersions,
  detectProvider,
  parseStatusPorcelain,
  parseVersion,
  recommendVersions,
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

test("识别 GitHub 与 Gitee 远端", () => {
  assert.equal(detectProvider("https://github.com/example/repo.git"), "github");
  assert.equal(detectProvider("git@gitee.com:example/repo.git"), "gitee");
  assert.equal(detectProvider("https://git.example.com/repo.git"), "other");
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
