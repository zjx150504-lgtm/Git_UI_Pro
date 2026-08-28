import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { GitLongOperationProgress, GitPullStrategy, RepositoryTarget } from "./gitService";
import type { ReleaseHistoryItem } from "./releaseHistory";
import type { UpdateSource, UpdateState } from "./updateService";
import type { UpdateReleaseDetails } from "./updateDetails";
import type { TerminalHistoryEntry } from "./configStore";

type WindowState = {
  isMaximized: boolean;
  isFullScreen: boolean;
};

contextBridge.exposeInMainWorld("gitUI", {
  runAppCommand: (command: string) => ipcRenderer.invoke("app:command", command),
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  openPath: (filePath: string) => ipcRenderer.invoke("app:openPath", filePath),
  revealPath: (filePath: string) => ipcRenderer.invoke("app:revealPath", filePath),
  setNativeTheme: (themeSource: "system" | "light" | "dark") => ipcRenderer.invoke("theme:setNative", themeSource),
  getWindowState: () => ipcRenderer.invoke("window:getState"),
  onWindowStateChange: (callback: (state: WindowState) => void) => {
    const listener = (_event: IpcRendererEvent, state: WindowState) => callback(state);
    ipcRenderer.on("window:state", listener);
    return () => ipcRenderer.removeListener("window:state", listener);
  },
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke("update:getState"),
  setUpdateSource: (source: UpdateSource): Promise<UpdateState> => ipcRenderer.invoke("update:setSource", source),
  listUpdateReleases: (force = false): Promise<ReleaseHistoryItem[]> => ipcRenderer.invoke("update:listReleases", force),
  getUpdateReleaseDetails: (force = false): Promise<UpdateReleaseDetails> => ipcRenderer.invoke("update:getReleaseDetails", force),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke("update:check"),
  cancelUpdateCheck: (): Promise<UpdateState> => ipcRenderer.invoke("update:cancelCheck"),
  prepareRollback: (version: string): Promise<UpdateState> => ipcRenderer.invoke("update:prepareRollback", version),
  cancelRollback: (): Promise<UpdateState> => ipcRenderer.invoke("update:cancelRollback"),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("update:download"),
  cancelUpdateDownload: (): Promise<UpdateState> => ipcRenderer.invoke("update:cancelDownload"),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback: (state: UpdateState) => void) => {
    const listener = (_event: IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  getGitVersion: () => ipcRenderer.invoke("git:getVersion"),
  startTerminal: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("terminal:start", repositoryPath),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke("terminal:write", sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  disposeTerminal: (sessionId: string) => ipcRenderer.invoke("terminal:dispose", sessionId),
  getTerminalHistory: (projectId: string): Promise<TerminalHistoryEntry[]> => ipcRenderer.invoke("terminal:getHistory", projectId),
  appendTerminalHistory: (projectId: string, command: string): Promise<TerminalHistoryEntry[]> => ipcRenderer.invoke("terminal:appendHistory", projectId, command),
  clearTerminalHistory: (projectId: string): Promise<boolean> => ipcRenderer.invoke("terminal:clearHistory", projectId),
  onTerminalData: (callback: (event: { sessionId: string; stream: "stdout" | "stderr"; data: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { sessionId: string; stream: "stdout" | "stderr"; data: string }) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback: (event: { sessionId: string; exitCode: number | null; signal: string | null }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { sessionId: string; exitCode: number | null; signal: string | null }) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
  cancelGitOperation: (operationId: string) => ipcRenderer.invoke("git:cancelOperation", operationId),
  cancelGitReadRequest: (requestId: string) => ipcRenderer.invoke("git:cancelReadRequest", requestId),
  onGitOperationProgress: (callback: (event: GitLongOperationProgress) => void) => {
    const listener = (_event: IpcRendererEvent, payload: GitLongOperationProgress) => callback(payload);
    ipcRenderer.on("git:operationProgress", listener);
    return () => ipcRenderer.removeListener("git:operationProgress", listener);
  },
  chooseDirectory: () => ipcRenderer.invoke("dialog:chooseDirectory"),
  chooseIdentityFile: () => ipcRenderer.invoke("dialog:chooseIdentityFile"),
  inspectSshHost: (host: string, port?: number) => ipcRenderer.invoke("ssh:inspectHost", host, port),
  trustSshHost: (token: string, replaceExisting: boolean) => ipcRenderer.invoke("ssh:trustHost", token, replaceExisting),
  getProjects: () => ipcRenderer.invoke("projects:list"),
  getProjectLibrary: () => ipcRenderer.invoke("projects:getLibrary"),
  createProjectGroup: (name: string) => ipcRenderer.invoke("projects:createGroup", name),
  renameProjectGroup: (groupId: string, name: string) => ipcRenderer.invoke("projects:renameGroup", groupId, name),
  deleteProjectGroup: (groupId: string) => ipcRenderer.invoke("projects:deleteGroup", groupId),
  setProjectGroup: (projectId: string, groupId?: string) => ipcRenderer.invoke("projects:setGroup", projectId, groupId),
  renameProject: (projectId: string, name: string) => ipcRenderer.invoke("projects:rename", projectId, name),
  setRemoteProjectConnectionEnabled: (projectId: string, enabled: boolean) =>
    ipcRenderer.invoke("projects:setRemoteConnectionEnabled", projectId, enabled),
  markProjectOpened: (projectId: string) => ipcRenderer.invoke("projects:markOpened", projectId),
  removeRecentProject: (projectId: string) => ipcRenderer.invoke("projects:removeRecent", projectId),
  getUiPreferences: () => ipcRenderer.invoke("preferences:get"),
  updateUiPreferences: (input: Record<string, unknown>) => ipcRenderer.invoke("preferences:update", input),
  addProject: (directoryPath: string) => ipcRenderer.invoke("projects:add", directoryPath),
  initializeRepository: (directoryPath: string, initialBranch: string, createGitignore: boolean) =>
    ipcRenderer.invoke("projects:initializeRepository", directoryPath, initialBranch, createGitignore),
  cloneRepository: (sourceUrl: string, destinationPath: string, options: { branch?: string; depth?: number; recurseSubmodules?: boolean }, operation?: { operationId: string }) =>
    ipcRenderer.invoke("projects:cloneRepository", sourceUrl, destinationPath, options, operation),
  testRemoteProject: (input: { host: string; username?: string; port?: number; repositoryPath: string; identityFile?: string }) =>
    ipcRenderer.invoke("projects:testRemote", input),
  addRemoteProject: (input: { host: string; username?: string; port?: number; repositoryPath: string; identityFile?: string }) =>
    ipcRenderer.invoke("projects:addRemote", input),
  scanProjects: (rootPath: string) => ipcRenderer.invoke("projects:scan", rootPath),
  reorderProjects: (projectIds: string[]) => ipcRenderer.invoke("projects:reorder", projectIds),
  setProjectFavorite: (projectId: string, favorite: boolean) => ipcRenderer.invoke("projects:setFavorite", projectId, favorite),
  removeProject: (projectId: string) => ipcRenderer.invoke("projects:remove", projectId),
  getProjectStatus: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getStatus", repositoryPath),
  getHistory: (repositoryPath: RepositoryTarget, filter?: { mode: "auto" | "all" | "custom"; refIds?: string[] }) => ipcRenderer.invoke("git:getHistory", repositoryPath, filter),
  getHistoryPage: (repositoryPath: RepositoryTarget, query: Record<string, unknown>) => ipcRenderer.invoke("git:getHistoryPage", repositoryPath, query),
  getBlame: (repositoryPath: RepositoryTarget, filePath: string, revision?: string) => ipcRenderer.invoke("git:getBlame", repositoryPath, filePath, revision),
  getHistoryRefs: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getHistoryRefs", repositoryPath),
  getCommitDetails: (repositoryPath: RepositoryTarget, hash: string) => ipcRenderer.invoke("git:getCommitDetails", repositoryPath, hash),
  getCommitDiff: (repositoryPath: RepositoryTarget, hash: string, filePath?: string, knownFirstParent?: string | null, readRequestId?: string) =>
    ipcRenderer.invoke("git:getCommitDiff", repositoryPath, hash, filePath, knownFirstParent, readRequestId),
  getCommitFilePreview: (repositoryPath: RepositoryTarget, hash: string, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:getCommitFilePreview", repositoryPath, hash, file),
  getWorktree: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getWorktree", repositoryPath),
  getWorktreeDiff: (repositoryPath: RepositoryTarget, filePath: string, staged: boolean) => ipcRenderer.invoke("git:getWorktreeDiff", repositoryPath, filePath, staged),
  getWorktreeFilePreview: (repositoryPath: RepositoryTarget, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:getWorktreeFilePreview", repositoryPath, file),
  getConflictFileDetails: (repositoryPath: RepositoryTarget, filePath: string) => ipcRenderer.invoke("git:getConflictFileDetails", repositoryPath, filePath),
  resolveConflictFile: (
    repositoryPath: RepositoryTarget,
    filePath: string,
    input: { choice: "content" | "current" | "incoming"; content?: string; expectedToken: string }
  ) => ipcRenderer.invoke("git:resolveConflictFile", repositoryPath, filePath, input),
  stageFile: (repositoryPath: RepositoryTarget, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:stageFile", repositoryPath, file),
  stageAll: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:stageAll", repositoryPath),
  unstageFile: (repositoryPath: RepositoryTarget, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:unstageFile", repositoryPath, file),
  unstageAll: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:unstageAll", repositoryPath),
  discardFile: (repositoryPath: RepositoryTarget, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:discardFile", repositoryPath, file),
  getStashes: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getStashes", repositoryPath),
  getStashDetails: (repositoryPath: RepositoryTarget, selector: string) => ipcRenderer.invoke("git:getStashDetails", repositoryPath, selector),
  createStash: (repositoryPath: RepositoryTarget, options: { message?: string; includeUntracked?: boolean; keepIndex?: boolean }) =>
    ipcRenderer.invoke("git:createStash", repositoryPath, options),
  applyStash: (repositoryPath: RepositoryTarget, selector: string, restoreIndex = false) =>
    ipcRenderer.invoke("git:applyStash", repositoryPath, selector, restoreIndex),
  popStash: (repositoryPath: RepositoryTarget, selector: string, restoreIndex = false) =>
    ipcRenderer.invoke("git:popStash", repositoryPath, selector, restoreIndex),
  dropStash: (repositoryPath: RepositoryTarget, selector: string) => ipcRenderer.invoke("git:dropStash", repositoryPath, selector),
  commit: (repositoryPath: RepositoryTarget, input: { subject: string; body?: string; amend?: boolean; pushAfterCommit?: boolean }) =>
    ipcRenderer.invoke("git:commit", repositoryPath, input),
  fetch: (repositoryPath: RepositoryTarget, operation?: { operationId: string }) => ipcRenderer.invoke("git:fetch", repositoryPath, operation),
  fetchRemote: (repositoryPath: RepositoryTarget, remoteName: string, prune = false, operation?: { operationId: string }) => ipcRenderer.invoke("git:fetchRemote", repositoryPath, remoteName, prune, operation),
  pull: (repositoryPath: RepositoryTarget, strategy: GitPullStrategy, operation?: { operationId: string }) => ipcRenderer.invoke("git:pull", repositoryPath, strategy, operation),
  mergeRemote: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:mergeRemote", repositoryPath),
  push: (repositoryPath: RepositoryTarget, options?: { forceWithLease?: boolean; operationId?: string }) => ipcRenderer.invoke("git:push", repositoryPath, options),
  getRemotes: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getRemotes", repositoryPath),
  addRemote: (repositoryPath: RepositoryTarget, name: string, fetchUrl: string, pushUrl?: string) =>
    ipcRenderer.invoke("git:addRemote", repositoryPath, name, fetchUrl, pushUrl),
  updateRemote: (repositoryPath: RepositoryTarget, currentName: string, input: { name?: string; fetchUrl?: string; pushUrl?: string | null }) =>
    ipcRenderer.invoke("git:updateRemote", repositoryPath, currentName, input),
  removeRemote: (repositoryPath: RepositoryTarget, name: string) => ipcRenderer.invoke("git:removeRemote", repositoryPath, name),
  setBranchUpstream: (repositoryPath: RepositoryTarget, branchName: string, upstream: string) =>
    ipcRenderer.invoke("git:setBranchUpstream", repositoryPath, branchName, upstream),
  unsetBranchUpstream: (repositoryPath: RepositoryTarget, branchName: string) => ipcRenderer.invoke("git:unsetBranchUpstream", repositoryPath, branchName),
  setDefaultRemote: (repositoryPath: RepositoryTarget, remoteName: string, role: "fetch" | "push", branchName?: string) =>
    ipcRenderer.invoke("git:setDefaultRemote", repositoryPath, remoteName, role, branchName),
  getBranches: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getBranches", repositoryPath),
  createBranch: (repositoryPath: RepositoryTarget, branchName: string, checkout: boolean, startPoint?: string) =>
    ipcRenderer.invoke("git:createBranch", repositoryPath, branchName, checkout, startPoint),
  switchBranch: (repositoryPath: RepositoryTarget, branch: { name: string; fullName: string; type: string; current: boolean; upstream?: string; headHash: string }) =>
    ipcRenderer.invoke("git:switchBranch", repositoryPath, branch),
  getMergePreview: (repositoryPath: RepositoryTarget, targetBranch: string) => ipcRenderer.invoke("git:getMergePreview", repositoryPath, targetBranch),
  mergeCurrentBranch: (repositoryPath: RepositoryTarget, targetBranch: string, strategy: "ff" | "no-ff") =>
    ipcRenderer.invoke("git:mergeCurrentBranch", repositoryPath, targetBranch, strategy),
  continueMerge: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:continueMerge", repositoryPath),
  abortMerge: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:abortMerge", repositoryPath),
  startRebase: (repositoryPath: RepositoryTarget, upstream: string, onto?: string) => ipcRenderer.invoke("git:startRebase", repositoryPath, upstream, onto),
  getRebasePlan: (repositoryPath: RepositoryTarget, upstream: string) => ipcRenderer.invoke("git:getRebasePlan", repositoryPath, upstream),
  startInteractiveRebase: (repositoryPath: RepositoryTarget, upstream: string, plan: Array<Record<string, unknown>>, onto?: string) =>
    ipcRenderer.invoke("git:startInteractiveRebase", repositoryPath, upstream, plan, onto),
  continueRebase: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:continueRebase", repositoryPath),
  skipRebase: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:skipRebase", repositoryPath),
  abortRebase: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:abortRebase", repositoryPath),
  continueCherryPick: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:continueCherryPick", repositoryPath),
  skipCherryPick: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:skipCherryPick", repositoryPath),
  abortCherryPick: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:abortCherryPick", repositoryPath),
  continueRevert: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:continueRevert", repositoryPath),
  skipRevert: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:skipRevert", repositoryPath),
  abortRevert: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:abortRevert", repositoryPath),
  startBisect: (repositoryPath: RepositoryTarget, badRef?: string, goodRef?: string) => ipcRenderer.invoke("git:startBisect", repositoryPath, badRef, goodRef),
  markBisectGood: (repositoryPath: RepositoryTarget, ref?: string) => ipcRenderer.invoke("git:markBisectGood", repositoryPath, ref),
  markBisectBad: (repositoryPath: RepositoryTarget, ref?: string) => ipcRenderer.invoke("git:markBisectBad", repositoryPath, ref),
  skipBisect: (repositoryPath: RepositoryTarget, refs?: string[]) => ipcRenderer.invoke("git:skipBisect", repositoryPath, refs),
  resetBisect: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:resetBisect", repositoryPath),
  showCommitSignature: (repositoryPath: RepositoryTarget, revision: string) => ipcRenderer.invoke("git:showCommitSignature", repositoryPath, revision),
  verifyCommitSignature: (repositoryPath: RepositoryTarget, revision: string) => ipcRenderer.invoke("git:verifyCommitSignature", repositoryPath, revision),
  renameBranch: (repositoryPath: RepositoryTarget, branchName: string, nextName: string, force = false) =>
    ipcRenderer.invoke("git:renameBranch", repositoryPath, branchName, nextName, force),
  deleteBranch: (repositoryPath: RepositoryTarget, branchName: string, force = false) => ipcRenderer.invoke("git:deleteBranch", repositoryPath, branchName, force),
  deleteRemoteBranch: (repositoryPath: RepositoryTarget, remoteName: string, branchName: string) =>
    ipcRenderer.invoke("git:deleteRemoteBranch", repositoryPath, remoteName, branchName),
  getTags: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getTags", repositoryPath),
  createTag: (repositoryPath: RepositoryTarget, name: string, target: string, message?: string) =>
    ipcRenderer.invoke("git:createTag", repositoryPath, name, target, message),
  deleteTag: (repositoryPath: RepositoryTarget, name: string) => ipcRenderer.invoke("git:deleteTag", repositoryPath, name),
  pushTag: (repositoryPath: RepositoryTarget, remoteName: string, name: string) => ipcRenderer.invoke("git:pushTag", repositoryPath, remoteName, name),
  deleteRemoteTag: (repositoryPath: RepositoryTarget, remoteName: string, name: string) =>
    ipcRenderer.invoke("git:deleteRemoteTag", repositoryPath, remoteName, name),
  getReflog: (repositoryPath: RepositoryTarget, maxCount?: number) => ipcRenderer.invoke("git:getReflog", repositoryPath, maxCount),
  resetToReflogEntry: (repositoryPath: RepositoryTarget, selector: string, mode: "mixed" | "hard") =>
    ipcRenderer.invoke("git:resetToReflogEntry", repositoryPath, selector, mode),
  getLinkedWorktrees: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getLinkedWorktrees", repositoryPath),
  addLinkedWorktree: (repositoryPath: RepositoryTarget, options: Record<string, unknown>) => ipcRenderer.invoke("git:addLinkedWorktree", repositoryPath, options),
  removeLinkedWorktree: (repositoryPath: RepositoryTarget, worktreePath: string, force = false) =>
    ipcRenderer.invoke("git:removeLinkedWorktree", repositoryPath, worktreePath, force),
  pruneLinkedWorktrees: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:pruneLinkedWorktrees", repositoryPath),
  lockLinkedWorktree: (repositoryPath: RepositoryTarget, worktreePath: string, reason?: string) => ipcRenderer.invoke("git:lockLinkedWorktree", repositoryPath, worktreePath, reason),
  unlockLinkedWorktree: (repositoryPath: RepositoryTarget, worktreePath: string) => ipcRenderer.invoke("git:unlockLinkedWorktree", repositoryPath, worktreePath),
  moveLinkedWorktree: (repositoryPath: RepositoryTarget, options: { worktreePath: string; destinationPath: string }) => ipcRenderer.invoke("git:moveLinkedWorktree", repositoryPath, options),
  repairLinkedWorktrees: (repositoryPath: RepositoryTarget, worktreePaths: string[] = []) => ipcRenderer.invoke("git:repairLinkedWorktrees", repositoryPath, worktreePaths),
  getSubmodules: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getSubmodules", repositoryPath),
  initializeSubmodules: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:initializeSubmodules", repositoryPath),
  updateSubmodules: (repositoryPath: RepositoryTarget, options: Record<string, unknown>) => ipcRenderer.invoke("git:updateSubmodules", repositoryPath, options),
  syncSubmodules: (repositoryPath: RepositoryTarget, recursive = true) => ipcRenderer.invoke("git:syncSubmodules", repositoryPath, recursive),
  addSubmodule: (repositoryPath: RepositoryTarget, options: { url: string; path: string; branch?: string; name?: string; force?: boolean }) => ipcRenderer.invoke("git:addSubmodule", repositoryPath, options),
  setSubmoduleBranch: (repositoryPath: RepositoryTarget, modulePath: string, branch?: string) => ipcRenderer.invoke("git:setSubmoduleBranch", repositoryPath, modulePath, branch),
  deinitializeSubmodule: (repositoryPath: RepositoryTarget, modulePath: string, force = false) => ipcRenderer.invoke("git:deinitializeSubmodule", repositoryPath, modulePath, force),
  removeSubmodule: (repositoryPath: RepositoryTarget, modulePath: string, force = false) => ipcRenderer.invoke("git:removeSubmodule", repositoryPath, modulePath, force),
  getLfsStatus: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getLfsStatus", repositoryPath),
  installLfs: (repositoryPath: RepositoryTarget, scope: "local" | "global" = "local") => ipcRenderer.invoke("git:installLfs", repositoryPath, scope),
  pullLfs: (repositoryPath: RepositoryTarget, remoteName?: string, refs?: string[], operation?: { operationId: string }) => ipcRenderer.invoke("git:pullLfs", repositoryPath, remoteName, refs, operation),
  pruneLfs: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:pruneLfs", repositoryPath),
  trackLfsPatterns: (repositoryPath: RepositoryTarget, patterns: string[]) => ipcRenderer.invoke("git:trackLfsPatterns", repositoryPath, patterns),
  untrackLfsPatterns: (repositoryPath: RepositoryTarget, patterns: string[]) => ipcRenderer.invoke("git:untrackLfsPatterns", repositoryPath, patterns),
  getLfsLocks: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getLfsLocks", repositoryPath),
  lockLfsFile: (repositoryPath: RepositoryTarget, filePath: string) => ipcRenderer.invoke("git:lockLfsFile", repositoryPath, filePath),
  unlockLfsFile: (repositoryPath: RepositoryTarget, lockId: string, force = false) => ipcRenderer.invoke("git:unlockLfsFile", repositoryPath, lockId, force),
  migrateLfs: (repositoryPath: RepositoryTarget, options: { include: string[]; exclude?: string[]; everything?: boolean; rewriteHistory: true }, operation?: { operationId: string }) => ipcRenderer.invoke("git:migrateLfs", repositoryPath, options, operation),
  readGitIgnore: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:readGitIgnore", repositoryPath),
  writeGitIgnore: (repositoryPath: RepositoryTarget, content: string, expectedRevision: string) =>
    ipcRenderer.invoke("git:writeGitIgnore", repositoryPath, content, expectedRevision),
  getSigningConfig: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getSigningConfig", repositoryPath),
  setSigningConfig: (repositoryPath: RepositoryTarget, input: Record<string, unknown>) => ipcRenderer.invoke("git:setSigningConfig", repositoryPath, input),
  getGitIdentity: (repositoryPath: RepositoryTarget) => ipcRenderer.invoke("git:getIdentity", repositoryPath),
  setGitIdentity: (repositoryPath: RepositoryTarget, input: { name: string; email: string }) => ipcRenderer.invoke("git:setIdentity", repositoryPath, input),
  getHostingLinks: (repositoryPath: RepositoryTarget, remoteName: string, commitHash?: string, branchName?: string) =>
    ipcRenderer.invoke("git:getHostingLinks", repositoryPath, remoteName, commitHash, branchName),
  listHostingAccounts: () => ipcRenderer.invoke("hosting:listAccounts"),
  saveHostingAccount: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, token: string) => ipcRenderer.invoke("hosting:saveAccount", provider, remoteUrl, token),
  removeHostingAccount: (provider: "github" | "gitlab" | "gitee", host: string) => ipcRenderer.invoke("hosting:removeAccount", provider, host),
  listHostingChangeRequests: (provider: "github" | "gitlab" | "gitee", remoteUrl: string) => ipcRenderer.invoke("hosting:listChangeRequests", provider, remoteUrl),
  getHostingChangeRequest: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, number: number) => ipcRenderer.invoke("hosting:getChangeRequest", provider, remoteUrl, number),
  createHostingChangeRequest: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, input: Record<string, unknown>) => ipcRenderer.invoke("hosting:createChangeRequest", provider, remoteUrl, input),
  commentHostingChangeRequest: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, number: number, body: string) => ipcRenderer.invoke("hosting:comment", provider, remoteUrl, number, body),
  reviewHostingChangeRequest: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, input: Record<string, unknown>) => ipcRenderer.invoke("hosting:review", provider, remoteUrl, input),
  mergeHostingChangeRequest: (provider: "github" | "gitlab" | "gitee", remoteUrl: string, input: Record<string, unknown>) => ipcRenderer.invoke("hosting:merge", provider, remoteUrl, input),
  amendLastCommitMessage: (repositoryPath: RepositoryTarget, input: { subject: string; body?: string }) =>
    ipcRenderer.invoke("git:amendLastCommitMessage", repositoryPath, input),
  resetLastCommit: (repositoryPath: RepositoryTarget, mode: "soft" | "mixed" | "hard") => ipcRenderer.invoke("git:resetLastCommit", repositoryPath, mode),
  resetToCommit: (repositoryPath: RepositoryTarget, hash: string, mode: "soft" | "mixed" | "hard") =>
    ipcRenderer.invoke("git:resetToCommit", repositoryPath, hash, mode),
  revertCommit: (repositoryPath: RepositoryTarget, hash: string) => ipcRenderer.invoke("git:revertCommit", repositoryPath, hash),
  cherryPickCommit: (repositoryPath: RepositoryTarget, hash: string) => ipcRenderer.invoke("git:cherryPickCommit", repositoryPath, hash)
});
