import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type WindowState = {
  isMaximized: boolean;
  isFullScreen: boolean;
};

contextBridge.exposeInMainWorld("gitUI", {
  runAppCommand: (command: string) => ipcRenderer.invoke("app:command", command),
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
  getHistory: (repositoryPath: string) => ipcRenderer.invoke("git:getHistory", repositoryPath),
  getCommitDetails: (repositoryPath: string, hash: string) => ipcRenderer.invoke("git:getCommitDetails", repositoryPath, hash),
  getCommitDiff: (repositoryPath: string, hash: string, filePath?: string) => ipcRenderer.invoke("git:getCommitDiff", repositoryPath, hash, filePath),
  getWorktree: (repositoryPath: string) => ipcRenderer.invoke("git:getWorktree", repositoryPath),
  getWorktreeDiff: (repositoryPath: string, filePath: string, staged: boolean) => ipcRenderer.invoke("git:getWorktreeDiff", repositoryPath, filePath, staged),
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
  createBranch: (repositoryPath: string, branchName: string, checkout: boolean) => ipcRenderer.invoke("git:createBranch", repositoryPath, branchName, checkout),
  switchBranch: (repositoryPath: string, branch: { name: string; fullName: string; type: string; current: boolean; upstream?: string; headHash: string }) =>
    ipcRenderer.invoke("git:switchBranch", repositoryPath, branch),
  deleteBranch: (repositoryPath: string, branchName: string) => ipcRenderer.invoke("git:deleteBranch", repositoryPath, branchName)
});
