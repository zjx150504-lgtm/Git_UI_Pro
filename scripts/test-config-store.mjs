import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import configStoreModule from "../dist-electron/configStore.js";

const { ConfigStore } = configStoreModule;

async function withTemporaryStore(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-config-"));
  try {
    await run(new ConfigStore(directory), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("配置读改写串行执行且保留并发项目操作", async () => {
  await withTemporaryStore(async (store, directory) => {
    const [localA, localB, remoteUpper, remoteLower] = await Promise.all([
      store.addProject(path.join(directory, "repo-a")),
      store.addProject(path.join(directory, "repo-b")),
      store.addRemoteProject({ host: "example.com", username: "Deploy", repositoryPath: "/srv/repo" }, "/srv/repo"),
      store.addRemoteProject({ host: "example.com", username: "deploy", repositoryPath: "/srv/repo" }, "/srv/repo")
    ]);

    await Promise.all([
      store.setProjectFavorite(localA.id, true),
      store.removeProject(localB.id),
      store.reorderProjects([remoteLower.id, remoteUpper.id, localA.id])
    ]);

    const projects = await store.listProjects();
    assert.deepEqual(new Set(projects.map((project) => project.id)), new Set([localA.id, remoteUpper.id, remoteLower.id]));
    assert.equal(projects.find((project) => project.id === localA.id)?.favorite, true);
    assert.deepEqual(
      projects.filter((project) => project.remote).map((project) => project.remote.username).sort(),
      ["Deploy", "deploy"]
    );
  });
});

test("主配置损坏时保留原文件并从有效备份恢复", async () => {
  await withTemporaryStore(async (store, directory) => {
    const first = await store.addProject(path.join(directory, "repo-a"));
    await store.addProject(path.join(directory, "repo-b"));
    await writeFile(path.join(directory, "config.json"), "{ broken json", "utf8");

    const restored = await new ConfigStore(directory).read();
    assert.deepEqual(restored.projects.map((project) => project.id), [first.id]);
    const restoredRaw = await readFile(path.join(directory, "config.json"), "utf8");
    assert.doesNotThrow(() => JSON.parse(restoredRaw));

    const corruptFiles = (await readdir(directory)).filter((name) => name.startsWith("config.corrupt.") && name.endsWith(".json"));
    assert.equal(corruptFiles.length, 1);
    assert.equal(await readFile(path.join(directory, corruptFiles[0]), "utf8"), "{ broken json");
  });
});

test("项目分组、最近项目和界面偏好保持一致", async () => {
  await withTemporaryStore(async (store, directory) => {
    const first = await store.addProject(path.join(directory, "repo-a"));
    const second = await store.addProject(path.join(directory, "repo-b"));
    const group = await store.createProjectGroup("产品仓库");
    await store.setProjectGroup(first.id, group.id);
    await store.renameProject(first.id, "核心产品仓库");
    await store.renameProjectGroup(group.id, "核心项目");
    await store.markProjectOpened(first.id);
    await store.markProjectOpened(second.id);

    const library = await store.getProjectLibrary();
    assert.equal(library.groups.some((item) => item.id === group.id && item.name === "核心项目"), true);
    assert.equal((await store.listProjects()).find((item) => item.id === first.id)?.name, "核心产品仓库");
    assert.deepEqual(library.recentProjectIds.slice(0, 2), [second.id, first.id]);

    const preferences = await store.updateUiPreferences({
      theme: "dark",
      fontSize: 16,
      sidebarPosition: "right",
      diffViewMode: "inline",
      pullStrategy: "rebase-autostash",
      shortcuts: { "repository.center": "Ctrl+Alt+R" }
    });
    assert.equal(preferences.theme, "dark");
    assert.equal(preferences.fontSize, 16);
    assert.equal(preferences.sidebarPosition, "right");
    assert.equal(preferences.diffViewMode, "inline");
    assert.equal(preferences.pullStrategy, "rebase-autostash");
    assert.equal(preferences.shortcuts["repository.center"], "Ctrl+Alt+R");
    const normalizedShortcuts = await store.updateUiPreferences({ shortcuts: { "repository.center": "R + shift + Control" } });
    assert.equal(normalizedShortcuts.shortcuts["repository.center"], "Ctrl+Shift+R");
    await assert.rejects(
      store.updateUiPreferences({ shortcuts: { "git.fetch": "Control+G", "git.pull": "G+Ctrl" } }),
      /同时分配/
    );
    await assert.rejects(store.updateUiPreferences({ shortcuts: { "git.fetch": "Ctrl+K+L" } }), /只能包含一个主按键/);

    await store.deleteProjectGroup(group.id);
    assert.equal((await store.listProjects()).find((item) => item.id === first.id)?.groupId, undefined);
    await store.removeRecentProject(second.id);
    assert.equal((await store.getProjectLibrary()).recentProjectIds.includes(second.id), false);
  });
});

test("项目与分组重命名会校验空白和长度", async () => {
  await withTemporaryStore(async (store, directory) => {
    const project = await store.addProject(path.join(directory, "repo-name"));
    const group = await store.createProjectGroup("可重命名分组");

    await assert.rejects(store.renameProject(project.id, "   "), /项目名称不能为空/);
    await assert.rejects(store.renameProject(project.id, "x".repeat(81)), /不能超过 80/);
    await assert.rejects(store.renameProjectGroup(group.id, "   "), /分组名称不能为空/);
  });
});

test("更新源默认使用 GitHub 并可持久切换到 Gitee", async () => {
  await withTemporaryStore(async (store, directory) => {
    assert.equal(await store.getUpdateSource(), "github");
    assert.equal(await store.setUpdateSource("gitee"), "gitee");
    assert.equal(await new ConfigStore(directory).getUpdateSource(), "gitee");
    await assert.rejects(store.setUpdateSource("mirror"), /GitHub 或 Gitee/);
  });
});

test("远程连接开关默认开启、持久化并在重复添加时保留", async () => {
  await withTemporaryStore(async (store, directory) => {
    const remoteInput = { host: "offline.example.com", username: "deploy", repositoryPath: "/srv/repo" };
    const remote = await store.addRemoteProject(remoteInput, "/srv/repo");
    assert.equal(remote.remote?.connectionEnabled, true);

    const paused = await store.setRemoteProjectConnectionEnabled(remote.id, false);
    assert.equal(paused.remote?.connectionEnabled, false);
    assert.equal((await new ConfigStore(directory).listProjects()).find((project) => project.id === remote.id)?.remote?.connectionEnabled, false);

    const readded = await store.addRemoteProject(remoteInput, "/srv/repo");
    assert.equal(readded.id, remote.id);
    assert.equal(readded.remote?.connectionEnabled, false);

    const local = await store.addProject(path.join(directory, "local-repo"));
    await assert.rejects(store.setRemoteProjectConnectionEnabled(local.id, false), /不是远程项目/);
  });
});

test("读取配置时拒绝非字符串快捷键", async () => {
  await withTemporaryStore(async (store, directory) => {
    await writeFile(path.join(directory, "config.json"), JSON.stringify({
      version: 1,
      projects: [],
      ui: { shortcuts: { "git.fetch": 42 } }
    }), "utf8");
    await assert.rejects(store.read(), /必须是字符串/);
  });
});

test("终端命令历史按项目持久化、限制输入并支持清空", async () => {
  await withTemporaryStore(async (store, directory) => {
    const project = await store.addProject(path.join(directory, "repo-history"));
    const first = await store.appendTerminalHistory(project.id, "git status");
    assert.equal(first.length, 1);
    assert.equal(first[0].command, "git status");

    await store.appendTerminalHistory(project.id, "npm test");
    const restored = await new ConfigStore(directory).getTerminalHistory(project.id);
    assert.deepEqual(restored.map((entry) => entry.command), ["npm test", "git status"]);

    await assert.rejects(store.appendTerminalHistory(project.id, "echo first\necho second"), /单行文本/);
    assert.equal(await store.clearTerminalHistory(project.id), true);
    assert.deepEqual(await new ConfigStore(directory).getTerminalHistory(project.id), []);
  });
});
