import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from "electron";
import path from "node:path";
import { ConfigStore } from "./configStore";
import { GitService } from "./gitService";

let mainWindow: BrowserWindow | null = null;
let configStore: ConfigStore;
const gitService = new GitService();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
type AppThemeSource = "system" | "light" | "dark";

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
      nodeIntegration: false
    }
  });

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

  ipcMain.handle("theme:setNative", (_event, themeSource: AppThemeSource) => {
    applyNativeTheme(themeSource);
    return true;
  });

  ipcMain.handle("git:getVersion", () => gitService.getVersion());

  ipcMain.handle("dialog:chooseDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "选择 Git 项目目录"
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("projects:list", () => configStore.listProjects());

  ipcMain.handle("projects:add", async (_event, directoryPath: string) => {
    const repositoryRoot = await gitService.getRepositoryRoot(directoryPath);
    return configStore.addProject(repositoryRoot);
  });

  ipcMain.handle("projects:scan", async (_event, rootPath: string) => {
    const repositories = await gitService.scanRepositories(rootPath);
    const projects = [];

    for (const repositoryPath of repositories) {
      projects.push(await configStore.addProject(repositoryPath));
    }

    return projects;
  });

  ipcMain.handle("projects:remove", async (_event, projectId: string) => {
    await configStore.removeProject(projectId);
    return true;
  });

  ipcMain.handle("git:getStatus", (_event, repositoryPath: string) => gitService.getStatus(repositoryPath));
  ipcMain.handle("git:getHistory", (_event, repositoryPath: string) => gitService.getHistory(repositoryPath));
  ipcMain.handle("git:getCommitDetails", (_event, repositoryPath: string, hash: string) => gitService.getCommitDetails(repositoryPath, hash));
  ipcMain.handle("git:getCommitDiff", (_event, repositoryPath: string, hash: string, filePath?: string) => gitService.getCommitDiff(repositoryPath, hash, filePath));
  ipcMain.handle("git:getWorktree", (_event, repositoryPath: string) => gitService.getWorktree(repositoryPath));
  ipcMain.handle("git:getWorktreeDiff", (_event, repositoryPath: string, filePath: string, staged: boolean) =>
    gitService.getWorktreeDiff(repositoryPath, filePath, staged)
  );
  ipcMain.handle("git:stageFile", (_event, repositoryPath: string, filePath: string) => gitService.stageFile(repositoryPath, filePath));
  ipcMain.handle("git:stageAll", (_event, repositoryPath: string) => gitService.stageAll(repositoryPath));
  ipcMain.handle("git:unstageFile", (_event, repositoryPath: string, filePath: string) => gitService.unstageFile(repositoryPath, filePath));
  ipcMain.handle("git:unstageAll", (_event, repositoryPath: string) => gitService.unstageAll(repositoryPath));
  ipcMain.handle("git:discardFile", (_event, repositoryPath: string, file) => gitService.discardFile(repositoryPath, file));
  ipcMain.handle("git:commit", (_event, repositoryPath: string, input: { subject: string; body?: string; amend?: boolean; pushAfterCommit?: boolean }) =>
    gitService.commit(repositoryPath, input)
  );
  ipcMain.handle("git:fetch", (_event, repositoryPath: string) => gitService.fetch(repositoryPath));
  ipcMain.handle("git:pull", (_event, repositoryPath: string) => gitService.pull(repositoryPath));
  ipcMain.handle("git:push", (_event, repositoryPath: string) => gitService.push(repositoryPath));
  ipcMain.handle("git:getBranches", (_event, repositoryPath: string) => gitService.getBranches(repositoryPath));
  ipcMain.handle("git:createBranch", (_event, repositoryPath: string, branchName: string, checkout: boolean) =>
    gitService.createBranch(repositoryPath, branchName, checkout)
  );
  ipcMain.handle("git:switchBranch", (_event, repositoryPath: string, branch) => gitService.switchBranch(repositoryPath, branch));
  ipcMain.handle("git:deleteBranch", (_event, repositoryPath: string, branchName: string) => gitService.deleteBranch(repositoryPath, branchName));
}

function applyNativeTheme(themeSource: AppThemeSource): void {
  nativeTheme.themeSource = themeSource;
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#101317" : "#f5f7fa");
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
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case "window:close":
      mainWindow.close();
      break;
    case "help:about":
      showAboutDialog();
      break;
  }
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"));
  configureApplicationMenu();
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

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
