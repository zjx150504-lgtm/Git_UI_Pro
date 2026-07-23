import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type WebContents } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { ConfigStore, type RemoteProjectInput } from "./configStore";
import { buildSshArgs, GitService, normalizeRepositoryTarget, shellQuote, sshDestination, type RepositoryLocation } from "./gitService";

let mainWindow: BrowserWindow | null = null;
let configStore: ConfigStore;
const gitService = new GitService();
const terminalSessions = new Map<string, TerminalSession>();
let terminalSessionSeed = 0;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
type AppThemeSource = "system" | "light" | "dark";
type WindowState = {
  isMaximized: boolean;
  isFullScreen: boolean;
};
type TerminalSession = {
  process: pty.IPty;
  webContents: WebContents;
};

// Avoid packaged Windows installs exiting when Chromium's GPU sandbox cannot start.
app.commandLine.appendSwitch("disable-gpu-sandbox");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 860,
    minHeight: 640,
    frame: false,
    backgroundColor: "#101317",
    title: "Git UI Pro",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Some Windows custom install paths fail to start Electron's renderer sandbox.
      sandbox: false
    }
  });
  registerWindowStateEvents(mainWindow);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("app:command", (_event, command: string) => {
    runAppCommand(command);
    return true;
  });

  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return false;
    }

    await shell.openExternal(target.toString());
    return true;
  });

  ipcMain.handle("theme:setNative", (_event, themeSource: AppThemeSource) => {
    applyNativeTheme(themeSource);
    return true;
  });

  ipcMain.handle("window:getState", () => getWindowState());
  ipcMain.handle("terminal:start", (event, repositoryPath: RepositoryLocation) => startTerminalSession(event.sender, repositoryPath));
  ipcMain.handle("terminal:write", (_event, sessionId: string, data: string) => writeTerminalSession(sessionId, data));
  ipcMain.handle("terminal:resize", (_event, sessionId: string, cols: number, rows: number) => resizeTerminalSession(sessionId, cols, rows));
  ipcMain.handle("terminal:dispose", (_event, sessionId: string) => disposeTerminalSession(sessionId));

  ipcMain.handle("git:getVersion", () => gitService.getVersion());

  ipcMain.handle("dialog:chooseDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "选择 Git 项目目录"
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:chooseIdentityFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      title: "选择 SSH 私钥"
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("projects:list", () => configStore.listProjects());

  ipcMain.handle("projects:add", async (_event, directoryPath: string) => {
    const repositoryRoot = await gitService.getRepositoryRoot(directoryPath);
    return configStore.addProject(repositoryRoot);
  });

  ipcMain.handle("projects:testRemote", (_event, input: RemoteProjectInput) => gitService.testRemoteRepository(input));

  ipcMain.handle("projects:addRemote", async (_event, input: RemoteProjectInput) => {
    const result = await gitService.testRemoteRepository(input);
    if (!result.ok || !result.repositoryRoot) {
      throw new Error([result.messageZh ?? "无法连接远程 Git 仓库。", result.stderr.trim()].filter(Boolean).join("\n"));
    }
    return configStore.addRemoteProject(input, result.repositoryRoot);
  });

  ipcMain.handle("projects:scan", async (_event, rootPath: string) => {
    const repositories = await gitService.scanRepositories(rootPath);
    const projects = [];

    for (const repositoryPath of repositories) {
      projects.push(await configStore.addProject(repositoryPath));
    }

    return projects;
  });

  ipcMain.handle("projects:reorder", async (_event, projectIds: string[]) => {
    await configStore.reorderProjects(projectIds);
    return true;
  });

  ipcMain.handle("projects:setFavorite", (_event, projectId: string, favorite: boolean) => configStore.setProjectFavorite(projectId, favorite));

  ipcMain.handle("projects:remove", async (_event, projectId: string) => {
    await configStore.removeProject(projectId);
    return true;
  });

  ipcMain.handle("git:getStatus", (_event, repositoryPath: RepositoryLocation) => gitService.getStatus(repositoryPath));
  ipcMain.handle("git:getHistory", (_event, repositoryPath: RepositoryLocation, filter) => gitService.getHistory(repositoryPath, filter));
  ipcMain.handle("git:getHistoryRefs", (_event, repositoryPath: RepositoryLocation) => gitService.getHistoryRefs(repositoryPath));
  ipcMain.handle("git:getCommitDetails", (_event, repositoryPath: RepositoryLocation, hash: string) => gitService.getCommitDetails(repositoryPath, hash));
  ipcMain.handle("git:getCommitDiff", (_event, repositoryPath: RepositoryLocation, hash: string, filePath?: string) => gitService.getCommitDiff(repositoryPath, hash, filePath));
  ipcMain.handle("git:getCommitFilePreview", (_event, repositoryPath: RepositoryLocation, hash: string, file) => gitService.getCommitFilePreview(repositoryPath, hash, file));
  ipcMain.handle("git:getWorktree", (_event, repositoryPath: RepositoryLocation) => gitService.getWorktree(repositoryPath));
  ipcMain.handle("git:getWorktreeDiff", (_event, repositoryPath: RepositoryLocation, filePath: string, staged: boolean) =>
    gitService.getWorktreeDiff(repositoryPath, filePath, staged)
  );
  ipcMain.handle("git:getWorktreeFilePreview", (_event, repositoryPath: RepositoryLocation, file) => gitService.getWorktreeFilePreview(repositoryPath, file));
  ipcMain.handle("git:getConflictFileDetails", (_event, repositoryPath: RepositoryLocation, filePath: string) =>
    gitService.getConflictFileDetails(repositoryPath, filePath)
  );
  ipcMain.handle("git:resolveConflictFile", (_event, repositoryPath: RepositoryLocation, filePath: string, input) =>
    gitService.resolveConflictFile(repositoryPath, filePath, input)
  );
  ipcMain.handle("git:stageFile", (_event, repositoryPath: RepositoryLocation, filePath: string) => gitService.stageFile(repositoryPath, filePath));
  ipcMain.handle("git:stageAll", (_event, repositoryPath: RepositoryLocation) => gitService.stageAll(repositoryPath));
  ipcMain.handle("git:unstageFile", (_event, repositoryPath: RepositoryLocation, filePath: string) => gitService.unstageFile(repositoryPath, filePath));
  ipcMain.handle("git:unstageAll", (_event, repositoryPath: RepositoryLocation) => gitService.unstageAll(repositoryPath));
  ipcMain.handle("git:discardFile", (_event, repositoryPath: RepositoryLocation, file) => gitService.discardFile(repositoryPath, file));
  ipcMain.handle("git:commit", (_event, repositoryPath: RepositoryLocation, input: { subject: string; body?: string; amend?: boolean; pushAfterCommit?: boolean }) =>
    gitService.commit(repositoryPath, input)
  );
  ipcMain.handle("git:fetch", (_event, repositoryPath: RepositoryLocation) => gitService.fetch(repositoryPath));
  ipcMain.handle("git:pull", (_event, repositoryPath: RepositoryLocation) => gitService.pull(repositoryPath));
  ipcMain.handle("git:mergeRemote", (_event, repositoryPath: RepositoryLocation) => gitService.mergeRemote(repositoryPath));
  ipcMain.handle("git:push", (_event, repositoryPath: RepositoryLocation) => gitService.push(repositoryPath));
  ipcMain.handle("git:getBranches", (_event, repositoryPath: RepositoryLocation) => gitService.getBranches(repositoryPath));
  ipcMain.handle("git:createBranch", (_event, repositoryPath: RepositoryLocation, branchName: string, checkout: boolean, startPoint?: string) =>
    gitService.createBranch(repositoryPath, branchName, checkout, startPoint)
  );
  ipcMain.handle("git:switchBranch", (_event, repositoryPath: RepositoryLocation, branch) => gitService.switchBranch(repositoryPath, branch));
  ipcMain.handle("git:getMergePreview", (_event, repositoryPath: RepositoryLocation, targetBranch: string) =>
    gitService.getMergePreview(repositoryPath, targetBranch)
  );
  ipcMain.handle("git:mergeCurrentBranch", (_event, repositoryPath: RepositoryLocation, targetBranch: string, strategy: "ff" | "no-ff") =>
    gitService.mergeCurrentBranch(repositoryPath, targetBranch, strategy)
  );
  ipcMain.handle("git:continueMerge", (_event, repositoryPath: RepositoryLocation) => gitService.continueMerge(repositoryPath));
  ipcMain.handle("git:abortMerge", (_event, repositoryPath: RepositoryLocation) => gitService.abortMerge(repositoryPath));
  ipcMain.handle("git:deleteBranch", (_event, repositoryPath: RepositoryLocation, branchName: string) => gitService.deleteBranch(repositoryPath, branchName));
  ipcMain.handle("git:amendLastCommitMessage", (_event, repositoryPath: RepositoryLocation, input: { subject: string; body?: string }) =>
    gitService.amendLastCommitMessage(repositoryPath, input)
  );
  ipcMain.handle("git:resetLastCommit", (_event, repositoryPath: RepositoryLocation, mode: "soft" | "mixed") => gitService.resetLastCommit(repositoryPath, mode));
  ipcMain.handle("git:resetToCommit", (_event, repositoryPath: RepositoryLocation, hash: string, mode: "soft" | "mixed" | "hard") =>
    gitService.resetToCommit(repositoryPath, hash, mode)
  );
  ipcMain.handle("git:revertCommit", (_event, repositoryPath: RepositoryLocation, hash: string) => gitService.revertCommit(repositoryPath, hash));
  ipcMain.handle("git:cherryPickCommit", (_event, repositoryPath: RepositoryLocation, hash: string) => gitService.cherryPickCommit(repositoryPath, hash));
}

function applyNativeTheme(themeSource: AppThemeSource): void {
  nativeTheme.themeSource = themeSource;
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#101317" : "#f5f7fa");
}

function getWindowState(): WindowState {
  return {
    isMaximized: mainWindow?.isMaximized() ?? false,
    isFullScreen: mainWindow?.isFullScreen() ?? false
  };
}

function emitWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:state", getWindowState());
}

function registerWindowStateEvents(window: BrowserWindow): void {
  const emit = () => emitWindowState();
  window.on("maximize", emit);
  window.on("unmaximize", emit);
  window.on("enter-full-screen", emit);
  window.on("leave-full-screen", emit);
  window.on("restore", emit);
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function runAppCommand(command: string): void {
  if (command === "app:quit") {
    app.quit();
    return;
  }

  if (!mainWindow) {
    return;
  }

  const webContents = mainWindow.webContents;
  switch (command) {
    case "edit:undo":
      webContents.undo();
      break;
    case "edit:redo":
      webContents.redo();
      break;
    case "edit:cut":
      webContents.cut();
      break;
    case "edit:copy":
      webContents.copy();
      break;
    case "edit:paste":
      webContents.paste();
      break;
    case "edit:selectAll":
      webContents.selectAll();
      break;
    case "view:reload":
      webContents.reload();
      break;
    case "view:forceReload":
      webContents.reloadIgnoringCache();
      break;
    case "view:toggleDevTools":
      webContents.toggleDevTools();
      break;
    case "view:resetZoom":
      webContents.setZoomLevel(0);
      break;
    case "view:zoomIn":
      webContents.setZoomLevel(webContents.getZoomLevel() + 1);
      break;
    case "view:zoomOut":
      webContents.setZoomLevel(webContents.getZoomLevel() - 1);
      break;
    case "view:toggleFullscreen":
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      break;
    case "window:minimize":
      mainWindow.minimize();
      break;
    case "window:toggleMaximize":
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      emitWindowState();
      break;
    case "window:close":
      mainWindow.close();
      break;
    case "help:about":
      showAboutDialog();
      break;
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    configStore = new ConfigStore(app.getPath("userData"));
    configureApplicationMenu();
    registerIpc();
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    disposeAllTerminalSessions();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

function startTerminalSession(webContents: WebContents, repositoryPath: RepositoryLocation): { sessionId: string; shell: string; cwd: string } {
  const target = normalizeRepositoryTarget(repositoryPath);
  const localShell = terminalShell();
  const cwd = target.remote ? process.cwd() : path.resolve(target.path);
  const sshArgs = target.remote ? buildSshArgs(target.remote) : [];
  const sshHost = target.remote ? sshArgs.pop()! : "";
  const command = target.remote ? "ssh" : localShell.command;
  const args = target.remote
    ? [...sshArgs, "-t", sshHost, `cd ${shellQuote(target.path)} && exec \"\${SHELL:-/bin/sh}\" -l`]
    : localShell.args;
  const shellLabel = target.remote ? `SSH ${sshDestination(target.remote)}` : localShell.label;
  const sessionId = `terminal-${Date.now()}-${++terminalSessionSeed}`;
  const terminal = pty.spawn(command, args, {
    cols: 80,
    rows: 24,
    cwd,
    env: process.env,
    name: process.platform === "win32" ? "xterm-256color" : "xterm-color"
  });

  terminalSessions.set(sessionId, { process: terminal, webContents });
  terminal.onData((data) => sendTerminalData(sessionId, data));
  terminal.onExit(({ exitCode, signal }) => {
    terminalSessions.delete(sessionId);
    if (!webContents.isDestroyed()) {
      webContents.send("terminal:exit", { sessionId, exitCode, signal });
    }
  });

  return { sessionId, shell: shellLabel, cwd: target.remote ? `${sshDestination(target.remote)}:${target.path}` : cwd };
}

function writeTerminalSession(sessionId: string, data: string): boolean {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.process.write(data);
  return true;
}

function resizeTerminalSession(sessionId: string, cols: number, rows: number): boolean {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.process.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  return true;
}

function disposeTerminalSession(sessionId: string): boolean {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return false;
  }

  terminalSessions.delete(sessionId);
  session.process.kill();
  return true;
}

function disposeAllTerminalSessions(): void {
  for (const sessionId of terminalSessions.keys()) {
    disposeTerminalSession(sessionId);
  }
}

function sendTerminalData(sessionId: string, data: string): void {
  const session = terminalSessions.get(sessionId);
  if (!session || session.webContents.isDestroyed()) {
    return;
  }

  session.webContents.send("terminal:data", { sessionId, stream: "stdout", data });
}

function terminalShell(): { command: string; args: string[]; label: string } {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const windowsPowerShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(windowsPowerShell)) {
      return {
        command: windowsPowerShell,
        args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit"],
        label: "PowerShell"
      };
    }

    return {
      command: process.env.ComSpec || path.join(systemRoot, "System32", "cmd.exe"),
      args: ["/K"],
      label: "Command Prompt"
    };
  }

  const shell = process.env.SHELL || "/bin/sh";
  return {
    command: shell,
    args: [],
    label: path.basename(shell)
  };
}

function configureApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}

function showAboutDialog(): void {
  const options = {
    type: "info",
    title: "关于 Git UI Pro",
    message: "Git UI Pro",
    detail: "中文桌面 Git Graph + 多项目管理器"
  } as const;

  if (mainWindow) {
    void dialog.showMessageBox(mainWindow, options);
    return;
  }

  void dialog.showMessageBox(options);
}
