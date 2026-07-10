import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { GitService } = require("../dist-electron/gitService.js");
const service = new GitService();
const testRoot = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-merge-"));

function git(repositoryPath, ...args) {
  return execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function createRepository(name) {
  const repositoryPath = path.join(testRoot, name);
  await mkdir(repositoryPath);
  git(repositoryPath, "init", "--initial-branch=main");
  git(repositoryPath, "config", "user.name", "Merge Test");
  git(repositoryPath, "config", "user.email", "merge-test@example.com");
  git(repositoryPath, "config", "core.autocrlf", "false");
  await writeFile(path.join(repositoryPath, "shared.txt"), "base\n", "utf8");
  git(repositoryPath, "add", "shared.txt");
  git(repositoryPath, "commit", "-m", "base");
  return repositoryPath;
}

async function commitFile(repositoryPath, fileName, content, message) {
  await writeFile(path.join(repositoryPath, fileName), content, "utf8");
  git(repositoryPath, "add", fileName);
  git(repositoryPath, "commit", "-m", message);
}

async function createConflictRepository(name) {
  const repositoryPath = await createRepository(name);
  git(repositoryPath, "switch", "-c", "feature/conflict");
  await commitFile(repositoryPath, "shared.txt", "feature\n", "feature change");
  git(repositoryPath, "switch", "main");
  await commitFile(repositoryPath, "shared.txt", "main\n", "main change");
  git(repositoryPath, "switch", "feature/conflict");
  return repositoryPath;
}

async function testDirtyWorktreeIsRejected() {
  const repositoryPath = await createRepository("dirty");
  git(repositoryPath, "switch", "-c", "feature/dirty");
  await writeFile(path.join(repositoryPath, "shared.txt"), "dirty\n", "utf8");
  await assert.rejects(service.getMergePreview(repositoryPath, "main"), /工作区干净/);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "feature/dirty");
}

async function testFastForwardMerge() {
  const repositoryPath = await createRepository("fast-forward");
  git(repositoryPath, "switch", "-c", "feature/fast-forward");
  await commitFile(repositoryPath, "feature.txt", "feature\n", "feature commit");
  const preview = await service.getMergePreview(repositoryPath, "main");
  assert.equal(preview.mode, "fast-forward");
  const result = await service.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(result.ok, true, result.messageZh ?? result.stderr);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "main");
  assert.equal(git(repositoryPath, "rev-parse", "main"), git(repositoryPath, "rev-parse", "feature/fast-forward"));
}

async function testNoFastForwardMerge() {
  const repositoryPath = await createRepository("no-fast-forward");
  git(repositoryPath, "switch", "-c", "feature/no-ff");
  await commitFile(repositoryPath, "feature.txt", "feature\n", "feature commit");
  const result = await service.mergeCurrentBranch(repositoryPath, "main", "no-ff");
  assert.equal(result.ok, true, result.messageZh ?? result.stderr);
  assert.equal(git(repositoryPath, "rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/).length, 3);
}

async function testMergeFailureRestoresSource() {
  const repositoryPath = await createRepository("restore-after-failure");
  git(repositoryPath, "switch", "-c", "feature/failure");
  await commitFile(repositoryPath, "feature.txt", "feature\n", "feature commit");
  const failureService = new GitService();
  const originalRun = failureService.run.bind(failureService);
  failureService.run = async (cwd, args, options) => {
    if (args[0] === "merge" && args.includes("--no-edit")) {
      return {
        ok: false,
        command: `git ${args.join(" ")}`,
        stdout: "",
        stderr: "Injected merge failure.",
        exitCode: 1,
        messageZh: "注入的合并失败。"
      };
    }
    return originalRun(cwd, args, options);
  };
  const result = await failureService.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(result.ok, false);
  assert.match(result.messageZh ?? "", /已自动切回原分支/);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "feature/failure");
}

async function testConflictAbortRestoresSource() {
  const repositoryPath = await createConflictRepository("abort");
  const mergeResult = await service.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(mergeResult.ok, false);
  const restartedService = new GitService();
  const conflictStatus = await restartedService.getStatus(repositoryPath);
  assert.equal(conflictStatus.operationState, "merge");
  assert.equal(conflictStatus.mergeSourceBranch, "feature/conflict");
  assert.equal(conflictStatus.mergeTargetBranch, "main");
  const abortResult = await restartedService.abortMerge(repositoryPath);
  assert.equal(abortResult.ok, true, abortResult.messageZh ?? abortResult.stderr);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "feature/conflict");
  assert.equal(git(repositoryPath, "status", "--porcelain"), "");
}

async function testConflictContinueCompletesMerge() {
  const repositoryPath = await createConflictRepository("continue");
  const mergeResult = await service.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(mergeResult.ok, false);
  const restartedService = new GitService();
  const details = await restartedService.getConflictFileDetails(repositoryPath, "shared.txt");
  assert.equal(details.currentLabel, "main");
  assert.equal(details.incomingLabel, "feature/conflict");
  assert.match(details.currentContent ?? "", /main/);
  assert.match(details.incomingContent ?? "", /feature/);
  assert.match(details.resultContent ?? "", /<<<<<<< HEAD/);
  const resolveResult = await restartedService.resolveConflictFile(repositoryPath, "shared.txt", {
    choice: "content",
    content: "resolved\n",
    expectedToken: details.token
  });
  assert.equal(resolveResult.ok, true, resolveResult.messageZh ?? resolveResult.stderr);
  assert.equal(git(repositoryPath, "ls-files", "--unmerged", "--", "shared.txt"), "");
  const continueResult = await restartedService.continueMerge(repositoryPath);
  assert.equal(continueResult.ok, true, continueResult.messageZh ?? continueResult.stderr);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "main");
  assert.equal(git(repositoryPath, "rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/).length, 3);
  assert.equal((await service.getStatus(repositoryPath)).operationState, undefined);
}

async function testConflictResolutionRejectsStaleSnapshot() {
  const repositoryPath = await createConflictRepository("stale-conflict");
  const mergeResult = await service.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(mergeResult.ok, false);
  const details = await service.getConflictFileDetails(repositoryPath, "shared.txt");
  const markerResult = await service.resolveConflictFile(repositoryPath, "shared.txt", {
    choice: "content",
    content: details.resultContent,
    expectedToken: details.token
  });
  assert.equal(markerResult.ok, false);
  assert.match(markerResult.messageZh ?? "", /冲突标记/);
  await writeFile(path.join(repositoryPath, "shared.txt"), "external edit\n", "utf8");
  const resolveResult = await service.resolveConflictFile(repositoryPath, "shared.txt", {
    choice: "current",
    expectedToken: details.token
  });
  assert.equal(resolveResult.ok, false);
  assert.match(resolveResult.messageZh ?? "", /外部修改/);
  assert.equal(await readFile(path.join(repositoryPath, "shared.txt"), "utf8"), "external edit\n");
}

async function testConflictCanAdoptIncomingVersion() {
  const repositoryPath = await createConflictRepository("adopt-incoming");
  const mergeResult = await service.mergeCurrentBranch(repositoryPath, "main", "ff");
  assert.equal(mergeResult.ok, false);
  const details = await service.getConflictFileDetails(repositoryPath, "shared.txt");
  const resolveResult = await service.resolveConflictFile(repositoryPath, "shared.txt", {
    choice: "incoming",
    expectedToken: details.token
  });
  assert.equal(resolveResult.ok, true, resolveResult.messageZh ?? resolveResult.stderr);
  assert.equal(await readFile(path.join(repositoryPath, "shared.txt"), "utf8"), "feature\n");
  assert.equal(git(repositoryPath, "ls-files", "--unmerged", "--", "shared.txt"), "");
}

async function testUnrelatedHistoryIsRejectedBeforeSwitch() {
  const repositoryPath = await createRepository("unrelated");
  git(repositoryPath, "switch", "--orphan", "feature/unrelated");
  await rm(path.join(repositoryPath, "shared.txt"), { force: true });
  await commitFile(repositoryPath, "unrelated.txt", "unrelated\n", "unrelated root");
  await assert.rejects(service.getMergePreview(repositoryPath, "main"), /没有共同历史/);
  assert.equal(git(repositoryPath, "branch", "--show-current"), "feature/unrelated");
}

try {
  await testDirtyWorktreeIsRejected();
  await testFastForwardMerge();
  await testNoFastForwardMerge();
  await testMergeFailureRestoresSource();
  await testConflictAbortRestoresSource();
  await testConflictContinueCompletesMerge();
  await testConflictResolutionRejectsStaleSnapshot();
  await testConflictCanAdoptIncomingVersion();
  await testUnrelatedHistoryIsRejectedBeforeSwitch();
  console.log("Merge integration scenarios passed.");
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
