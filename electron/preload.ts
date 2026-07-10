import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type WindowState = {
  isMaximized: boolean;
  isFullScreen: boolean;
};

contextBridge.exposeInMainWorld("gitUI", {
  runAppCommand: (command: string) => ipcRenderer.invoke("app:command", command),
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  setNativeTheme: (themeSource: "system" | "light" | "dark") => ipcRenderer.invoke("theme:setNative", themeSource),
  getWindowState: () => ipcRenderer.invoke("window:getState"),
  onWindowStateChange: (callback: (state: WindowState) => void) => {
    const listener = (_event: IpcRendererEvent, state: WindowState) => callback(state);
    ipcRenderer.on("window:state", listener);
    return () => ipcRenderer.removeListener("window:state", listener);
  },
  getGitVersion: () => ipcRenderer.invoke("git:getVersion"),
  startTerminal: (repositoryPath: string) => ipcRenderer.invoke("terminal:start", repositoryPath),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke("terminal:write", sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  disposeTerminal: (sessionId: string) => ipcRenderer.invoke("terminal:dispose", sessionId),
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
  chooseDirectory: () => ipcRenderer.invoke("dialog:chooseDirectory"),
  getProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: (directoryPath: string) => ipcRenderer.invoke("projects:add", directoryPath),
  scanProjects: (rootPath: string) => ipcRenderer.invoke("projects:scan", rootPath),
  reorderProjects: (projectIds: string[]) => ipcRenderer.invoke("projects:reorder", projectIds),
  setProjectFavorite: (projectId: string, favorite: boolean) => ipcRenderer.invoke("projects:setFavorite", projectId, favorite),
  removeProject: (projectId: string) => ipcRenderer.invoke("projects:remove", projectId),
  getProjectStatus: (repositoryPath: string) => ipcRenderer.invoke("git:getStatus", repositoryPath),
  getHistory: (repositoryPath: string, filter?: { mode: "auto" | "all" | "custom"; refIds?: string[] }) => ipcRenderer.invoke("git:getHistory", repositoryPath, filter),
  getHistoryRefs: (repositoryPath: string) => ipcRenderer.invoke("git:getHistoryRefs", repositoryPath),
  getCommitDetails: (repositoryPath: string, hash: string) => ipcRenderer.invoke("git:getCommitDetails", repositoryPath, hash),
  getCommitDiff: (repositoryPath: string, hash: string, filePath?: string) => ipcRenderer.invoke("git:getCommitDiff", repositoryPath, hash, filePath),
  getCommitFilePreview: (repositoryPath: string, hash: string, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:getCommitFilePreview", repositoryPath, hash, file),
  getWorktree: (repositoryPath: string) => ipcRenderer.invoke("git:getWorktree", repositoryPath),
  getWorktreeDiff: (repositoryPath: string, filePath: string, staged: boolean) => ipcRenderer.invoke("git:getWorktreeDiff", repositoryPath, filePath, staged),
  getWorktreeFilePreview: (repositoryPath: string, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:getWorktreeFilePreview", repositoryPath, file),
  stageFile: (repositoryPath: string, filePath: string) => ipcRenderer.invoke("git:stageFile", repositoryPath, filePath),
  stageAll: (repositoryPath: string) => ipcRenderer.invoke("git:stageAll", repositoryPath),
  unstageFile: (repositoryPath: string, filePath: string) => ipcRenderer.invoke("git:unstageFile", repositoryPath, filePath),
  unstageAll: (repositoryPath: string) => ipcRenderer.invoke("git:unstageAll", repositoryPath),
  discardFile: (repositoryPath: string, file: { path: string; oldPath?: string; status: string; staged: boolean }) =>
    ipcRenderer.invoke("git:discardFile", repositoryPath, file),
  commit: (repositoryPath: string, input: { subject: string; body?: string; amend?: boolean; pushAfterCommit?: boolean }) =>
    ipcRenderer.invoke("git:commit", repositoryPath, input),
  fetch: (repositoryPath: string) => ipcRenderer.invoke("git:fetch", repositoryPath),
  pull: (repositoryPath: string) => ipcRenderer.invoke("git:pull", repositoryPath),
  push: (repositoryPath: string) => ipcRenderer.invoke("git:push", repositoryPath),
  getBranches: (repositoryPath: string) => ipcRenderer.invoke("git:getBranches", repositoryPath),
  createBranch: (repositoryPath: string, branchName: string, checkout: boolean, startPoint?: string) =>
    ipcRenderer.invoke("git:createBranch", repositoryPath, branchName, checkout, startPoint),
  switchBranch: (repositoryPath: string, branch: { name: string; fullName: string; type: string; current: boolean; upstream?: string; headHash: string }) =>
    ipcRenderer.invoke("git:switchBranch", repositoryPath, branch),
  getMergePreview: (repositoryPath: string, targetBranch: string) => ipcRenderer.invoke("git:getMergePreview", repositoryPath, targetBranch),
  mergeCurrentBranch: (repositoryPath: string, targetBranch: string, strategy: "ff" | "no-ff") =>
    ipcRenderer.invoke("git:mergeCurrentBranch", repositoryPath, targetBranch, strategy),
  continueMerge: (repositoryPath: string) => ipcRenderer.invoke("git:continueMerge", repositoryPath),
  abortMerge: (repositoryPath: string) => ipcRenderer.invoke("git:abortMerge", repositoryPath),
  deleteBranch: (repositoryPath: string, branchName: string) => ipcRenderer.invoke("git:deleteBranch", repositoryPath, branchName),
  amendLastCommitMessage: (repositoryPath: string, input: { subject: string; body?: string }) =>
    ipcRenderer.invoke("git:amendLastCommitMessage", repositoryPath, input),
  resetLastCommit: (repositoryPath: string, mode: "soft" | "mixed") => ipcRenderer.invoke("git:resetLastCommit", repositoryPath, mode),
  resetToCommit: (repositoryPath: string, hash: string, mode: "soft" | "mixed" | "hard") =>
    ipcRenderer.invoke("git:resetToCommit", repositoryPath, hash, mode),
  revertCommit: (repositoryPath: string, hash: string) => ipcRenderer.invoke("git:revertCommit", repositoryPath, hash),
  cherryPickCommit: (repositoryPath: string, hash: string) => ipcRenderer.invoke("git:cherryPickCommit", repositoryPath, hash)
});
