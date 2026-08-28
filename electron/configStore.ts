import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface GitProject {
  id: string;
  name: string;
  path: string;
  remote?: SshConnection;
  groupId?: string;
  favorite: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SshConnection {
  type: "ssh";
  host: string;
  username?: string;
  port?: number;
  identityFile?: string;
  connectionEnabled?: boolean;
}

export interface RemoteProjectInput {
  host: string;
  username?: string;
  port?: number;
  repositoryPath: string;
  identityFile?: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  sortOrder: number;
}

export type DiffViewMode = "split" | "inline";
export type GitPullStrategy = "ff-only" | "rebase" | "rebase-autostash";
export type UpdateSource = "github" | "gitee";

export interface UiPreferences {
  theme: "system" | "light" | "dark";
  language: "zh-CN";
  bottomConsoleVisible: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  consoleHeight: number;
  fontSize: number;
  fontFamily: string;
  diffViewMode: DiffViewMode;
  diffWrap: boolean;
  pullStrategy: GitPullStrategy;
  density: "compact" | "comfortable";
  sidebarPosition: "left" | "right";
  confirmDestructiveActions: boolean;
  shortcuts: Record<string, string>;
}

export interface ProjectLibraryState {
  groups: ProjectGroup[];
  recentProjectIds: string[];
}

export interface TerminalHistoryEntry {
  id: string;
  command: string;
  executedAt: string;
}

export interface AppConfig {
  version: number;
  updateSource: UpdateSource;
  projects: GitProject[];
  groups: ProjectGroup[];
  recentProjectIds: string[];
  terminalHistories: Record<string, TerminalHistoryEntry[]>;
  ui: UiPreferences;
}

const defaultConfig: AppConfig = {
  version: 1,
  updateSource: "github",
  projects: [],
  groups: [
    { id: "work", name: "工作项目", sortOrder: 10 },
    { id: "personal", name: "个人项目", sortOrder: 20 },
    { id: "client", name: "客户项目", sortOrder: 30 }
  ],
  recentProjectIds: [],
  terminalHistories: {},
  ui: {
    theme: "system",
    language: "zh-CN",
    bottomConsoleVisible: true,
    sidebarWidth: 240,
    rightPanelWidth: 420,
    consoleHeight: 240,
    fontSize: 14,
    fontFamily: "system-ui",
    diffViewMode: "split",
    diffWrap: false,
    pullStrategy: "ff-only",
    density: "comfortable",
    sidebarPosition: "left",
    confirmDestructiveActions: true,
    shortcuts: {
      "project.search": "Ctrl+K",
      "repository.center": "Ctrl+Shift+R",
      "git.fetch": "Ctrl+Shift+F",
      "git.pull": "Ctrl+Shift+L",
      "git.push": "Ctrl+Shift+P",
      "terminal.toggle": "Ctrl+`"
    }
  }
};

export class ConfigStore {
  private readonly configPath: string;
  private readonly backupPath: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, "config.json");
    this.backupPath = path.join(userDataPath, "config.json.bak");
  }

  async read(): Promise<AppConfig> {
    return this.enqueue(() => this.readUnlocked());
  }

  async write(config: AppConfig): Promise<void> {
    await this.enqueue(() => this.writeUnlocked(config));
  }

  async listProjects(): Promise<GitProject[]> {
    const config = await this.read();
    return config.projects;
  }

  async getProjectLibrary(): Promise<ProjectLibraryState> {
    const config = await this.read();
    return {
      groups: [...config.groups].sort((left, right) => left.sortOrder - right.sortOrder),
      recentProjectIds: [...config.recentProjectIds]
    };
  }

  async getUiPreferences(): Promise<UiPreferences> {
    const config = await this.read();
    return cloneUiPreferences(config.ui);
  }

  async getUpdateSource(): Promise<UpdateSource> {
    const config = await this.read();
    return config.updateSource;
  }

  async setUpdateSource(source: UpdateSource): Promise<UpdateSource> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      config.updateSource = requireUpdateSource(source);
      await this.writeUnlocked(config);
      return config.updateSource;
    });
  }

  async updateUiPreferences(input: Partial<UiPreferences>): Promise<UiPreferences> {
    return this.enqueue(async () => {
      if (input.shortcuts) {
        validateShortcutMap(input.shortcuts);
      }
      const config = await this.readUnlocked();
      config.ui = normalizeUiPreferences({ ...config.ui, ...input });
      await this.writeUnlocked(config);
      return cloneUiPreferences(config.ui);
    });
  }

  async getTerminalHistory(projectId: string): Promise<TerminalHistoryEntry[]> {
    const key = requireTerminalHistoryKey(projectId);
    const config = await this.read();
    return cloneTerminalHistory(config.terminalHistories[key] ?? []);
  }

  async appendTerminalHistory(projectId: string, command: string): Promise<TerminalHistoryEntry[]> {
    return this.enqueue(async () => {
      const key = requireTerminalHistoryKey(projectId);
      const normalizedCommand = requireTerminalHistoryCommand(command);
      const config = await this.readUnlocked();
      const entry: TerminalHistoryEntry = {
        id: randomUUID(),
        command: normalizedCommand,
        executedAt: new Date().toISOString()
      };
      config.terminalHistories[key] = [entry, ...(config.terminalHistories[key] ?? [])].slice(0, 200);
      await this.writeUnlocked(config);
      return cloneTerminalHistory(config.terminalHistories[key]);
    });
  }

  async clearTerminalHistory(projectId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const key = requireTerminalHistoryKey(projectId);
      const config = await this.readUnlocked();
      if (!(key in config.terminalHistories)) {
        return false;
      }
      delete config.terminalHistories[key];
      await this.writeUnlocked(config);
      return true;
    });
  }

  async createProjectGroup(name: string): Promise<ProjectGroup> {
    return this.enqueue(async () => {
      const normalizedName = requireGroupName(name);
      const config = await this.readUnlocked();
      if (config.groups.some((group) => group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
        throw new Error(`项目分组“${normalizedName}”已存在`);
      }

      const group: ProjectGroup = {
        id: randomUUID(),
        name: normalizedName,
        sortOrder: Math.max(0, ...config.groups.map((item) => item.sortOrder)) + 10
      };
      config.groups.push(group);
      await this.writeUnlocked(config);
      return group;
    });
  }

  async renameProjectGroup(groupId: string, name: string): Promise<ProjectGroup> {
    return this.enqueue(async () => {
      const normalizedName = requireGroupName(name);
      const config = await this.readUnlocked();
      const group = config.groups.find((item) => item.id === groupId);
      if (!group) {
        throw new Error("项目分组不存在");
      }
      if (config.groups.some((item) => item.id !== groupId && item.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
        throw new Error(`项目分组“${normalizedName}”已存在`);
      }

      group.name = normalizedName;
      await this.writeUnlocked(config);
      return { ...group };
    });
  }

  async deleteProjectGroup(groupId: string): Promise<void> {
    await this.enqueue(async () => {
      const config = await this.readUnlocked();
      if (!config.groups.some((group) => group.id === groupId)) {
        throw new Error("项目分组不存在");
      }
      config.groups = config.groups.filter((group) => group.id !== groupId);
      config.projects = config.projects.map((project) => (project.groupId === groupId ? { ...project, groupId: undefined } : project));
      await this.writeUnlocked(config);
    });
  }

  async setProjectGroup(projectId: string, groupId?: string): Promise<GitProject> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      if (groupId && !config.groups.some((group) => group.id === groupId)) {
        throw new Error("项目分组不存在");
      }
      const projectIndex = config.projects.findIndex((project) => project.id === projectId);
      if (projectIndex < 0) {
        throw new Error("项目不存在");
      }

      const project: GitProject = {
        ...config.projects[projectIndex],
        groupId,
        updatedAt: new Date().toISOString()
      };
      config.projects[projectIndex] = project;
      await this.writeUnlocked(config);
      return project;
    });
  }

  async renameProject(projectId: string, name: string): Promise<GitProject> {
    return this.enqueue(async () => {
      const normalizedName = requireProjectName(name);
      const config = await this.readUnlocked();
      const projectIndex = config.projects.findIndex((project) => project.id === projectId);
      if (projectIndex < 0) {
        throw new Error("项目不存在");
      }

      const project: GitProject = {
        ...config.projects[projectIndex],
        name: normalizedName,
        updatedAt: new Date().toISOString()
      };
      config.projects[projectIndex] = project;
      await this.writeUnlocked(config);
      return project;
    });
  }

  async setRemoteProjectConnectionEnabled(projectId: string, enabled: boolean): Promise<GitProject> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      const projectIndex = config.projects.findIndex((project) => project.id === projectId);
      if (projectIndex < 0) {
        throw new Error("项目不存在");
      }

      const currentProject = config.projects[projectIndex];
      if (!currentProject.remote) {
        throw new Error("该项目不是远程项目");
      }

      const project: GitProject = {
        ...currentProject,
        remote: {
          ...currentProject.remote,
          connectionEnabled: enabled
        },
        updatedAt: new Date().toISOString()
      };
      config.projects[projectIndex] = project;
      await this.writeUnlocked(config);
      return project;
    });
  }

  async markProjectOpened(projectId: string): Promise<GitProject> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      const projectIndex = config.projects.findIndex((project) => project.id === projectId);
      if (projectIndex < 0) {
        throw new Error("项目不存在");
      }

      const now = new Date().toISOString();
      const project = { ...config.projects[projectIndex], lastOpenedAt: now, updatedAt: now };
      config.projects[projectIndex] = project;
      config.recentProjectIds = [projectId, ...config.recentProjectIds.filter((id) => id !== projectId)].slice(0, 20);
      await this.writeUnlocked(config);
      return project;
    });
  }

  async removeRecentProject(projectId: string): Promise<void> {
    await this.enqueue(async () => {
      const config = await this.readUnlocked();
      config.recentProjectIds = config.recentProjectIds.filter((id) => id !== projectId);
      await this.writeUnlocked(config);
    });
  }

  async addProject(repositoryPath: string): Promise<GitProject> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      const normalizedPath = path.resolve(repositoryPath);
      const existing = config.projects.find((project) => !project.remote && path.resolve(project.path) === normalizedPath);

      if (existing) {
        return existing;
      }

      const now = new Date().toISOString();
      const project: GitProject = {
        id: randomUUID(),
        name: path.basename(normalizedPath),
        path: normalizedPath,
        favorite: false,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now
      };

      config.projects = placeProjectAfterPinned(config.projects, project);
      config.recentProjectIds = [project.id, ...config.recentProjectIds.filter((id) => id !== project.id)].slice(0, 20);
      await this.writeUnlocked(config);
      return project;
    });
  }

  async addRemoteProject(input: RemoteProjectInput, repositoryRoot: string): Promise<GitProject> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      const remote: SshConnection = {
        type: "ssh",
        host: input.host.trim(),
        username: input.username?.trim() || undefined,
        port: input.port,
        identityFile: input.identityFile?.trim() || undefined,
        connectionEnabled: true
      };
      const normalizedPath = normalizeRemotePath(repositoryRoot);
      const existing = config.projects.find(
        (project) => project.remote && remoteProjectKey(project.remote, project.path) === remoteProjectKey(remote, normalizedPath)
      );

      if (existing) {
        const updatedProject: GitProject = {
          ...existing,
          remote: {
            ...remote,
            connectionEnabled: existing.remote?.connectionEnabled !== false
          },
          updatedAt: new Date().toISOString()
        };
        config.projects = config.projects.map((project) => (project.id === existing.id ? updatedProject : project));
        await this.writeUnlocked(config);
        return updatedProject;
      }

      const now = new Date().toISOString();
      const project: GitProject = {
        id: randomUUID(),
        name: path.posix.basename(normalizedPath) || remote.host,
        path: normalizedPath,
        remote,
        favorite: false,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now
      };

      config.projects = placeProjectAfterPinned(config.projects, project);
      config.recentProjectIds = [project.id, ...config.recentProjectIds.filter((id) => id !== project.id)].slice(0, 20);
      await this.writeUnlocked(config);
      return project;
    });
  }

  async reorderProjects(projectIds: string[]): Promise<void> {
    await this.enqueue(async () => {
      const config = await this.readUnlocked();
      const projectById = new Map(config.projects.map((project) => [project.id, project]));
      const orderedProjects = projectIds
        .map((projectId) => projectById.get(projectId))
        .filter((project): project is GitProject => Boolean(project));
      const orderedIds = new Set(orderedProjects.map((project) => project.id));
      const remainingProjects = config.projects.filter((project) => !orderedIds.has(project.id));

      config.projects = orderProjectsWithPinnedFirst([...orderedProjects, ...remainingProjects]);
      await this.writeUnlocked(config);
    });
  }

  async setProjectFavorite(projectId: string, favorite: boolean): Promise<GitProject | undefined> {
    return this.enqueue(async () => {
      const config = await this.readUnlocked();
      const projectIndex = config.projects.findIndex((project) => project.id === projectId);
      if (projectIndex < 0) {
        return undefined;
      }

      const updatedProject: GitProject = {
        ...config.projects[projectIndex],
        favorite,
        updatedAt: new Date().toISOString()
      };
      const remainingProjects = config.projects.filter((project) => project.id !== projectId);
      config.projects = favorite ? [updatedProject, ...remainingProjects] : placeProjectAfterPinned(remainingProjects, updatedProject);

      await this.writeUnlocked(config);
      return updatedProject;
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.enqueue(async () => {
      const config = await this.readUnlocked();
      config.projects = config.projects.filter((project) => project.id !== projectId);
      config.recentProjectIds = config.recentProjectIds.filter((id) => id !== projectId);
      await this.writeUnlocked(config);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readUnlocked(): Promise<AppConfig> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`无法读取项目配置，原文件已保留：${error instanceof Error ? error.message : String(error)}`);
      }

      const backup = await this.readBackup();
      if (backup) {
        await this.replaceConfigFile(backup, false);
        return backup;
      }

      const config = cloneDefaultConfig();
      await this.writeUnlocked(config);
      return config;
    }

    try {
      return parseConfig(raw);
    } catch (error) {
      const backup = await this.readBackup();
      if (!backup) {
        throw new Error(`无法读取项目配置，原文件已保留：${error instanceof Error ? error.message : String(error)}`);
      }

      const corruptPath = path.join(
        path.dirname(this.configPath),
        `config.corrupt.${new Date().toISOString().replace(/[:.]/g, "-")}.${randomUUID()}.json`
      );
      await copyFile(this.configPath, corruptPath);
      await this.replaceConfigFile(backup, false);
      return backup;
    }
  }

  private async readBackup(): Promise<AppConfig | null> {
    try {
      return parseConfig(await readFile(this.backupPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new Error(`无法恢复项目配置备份，现有文件均未覆盖：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeUnlocked(config: AppConfig): Promise<void> {
    await this.replaceConfigFile(config, true);
  }

  private async replaceConfigFile(config: AppConfig, backupCurrent: boolean): Promise<void> {
    const directory = path.dirname(this.configPath);
    const temporaryPath = path.join(directory, `config.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(config, null, 2), "utf8");
    try {
      if (backupCurrent) {
        try {
          await copyFile(this.configPath, this.backupPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
      await rename(temporaryPath, this.configPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

}

function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) {
    throw new Error("config.json 缺少有效的 projects 列表");
  }

  const projects = orderProjectsWithPinnedFirst(parsed.projects.map((project) => ({
    ...project,
    remote: project.remote ? { ...project.remote, connectionEnabled: project.remote.connectionEnabled !== false } : undefined,
    favorite: Boolean(project.favorite)
  })));
  return {
    ...defaultConfig,
    ...parsed,
    updateSource: parsed.updateSource === "gitee" ? "gitee" : "github",
    projects,
    groups: Array.isArray(parsed.groups) ? parsed.groups : defaultConfig.groups.map((group) => ({ ...group })),
    recentProjectIds: Array.isArray(parsed.recentProjectIds) ? parsed.recentProjectIds : [],
    terminalHistories: normalizeTerminalHistories(parsed.terminalHistories),
    ui: normalizeUiPreferences(parsed.ui ?? {})
  };
}

function cloneDefaultConfig(): AppConfig {
  return {
    ...defaultConfig,
    projects: [],
    groups: defaultConfig.groups.map((group) => ({ ...group })),
    recentProjectIds: [],
    terminalHistories: {},
    ui: cloneUiPreferences(defaultConfig.ui)
  };
}

function cloneTerminalHistory(entries: TerminalHistoryEntry[]): TerminalHistoryEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function requireUpdateSource(source: unknown): UpdateSource {
  if (source === "github" || source === "gitee") {
    return source;
  }
  throw new Error("更新源必须是 GitHub 或 Gitee。");
}

function normalizeTerminalHistories(value: unknown): Record<string, TerminalHistoryEntry[]> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config.json 的 terminalHistories 必须是对象");
  }

  return Object.fromEntries(
    Object.entries(value).map(([projectId, entries]) => {
      const key = requireTerminalHistoryKey(projectId);
      if (!Array.isArray(entries)) {
        throw new Error(`终端历史 ${key} 必须是列表`);
      }
      const normalized = entries.slice(0, 200).map((entry, index) => {
        if (!entry || typeof entry !== "object") {
          throw new Error(`终端历史 ${key} 的第 ${index + 1} 项无效`);
        }
        const candidate = entry as Partial<TerminalHistoryEntry>;
        if (typeof candidate.id !== "string" || !candidate.id.trim()) {
          throw new Error(`终端历史 ${key} 的第 ${index + 1} 项缺少 id`);
        }
        if (typeof candidate.executedAt !== "string" || !Number.isFinite(Date.parse(candidate.executedAt))) {
          throw new Error(`终端历史 ${key} 的第 ${index + 1} 项时间无效`);
        }
        return {
          id: candidate.id,
          command: requireTerminalHistoryCommand(candidate.command),
          executedAt: candidate.executedAt
        };
      });
      return [key, normalized];
    })
  );
}

function requireTerminalHistoryKey(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\r\n\u0000]/u.test(value)) {
    throw new Error("终端历史项目标识无效");
  }
  return value.trim();
}

function requireTerminalHistoryCommand(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("终端历史命令必须是字符串");
  }
  const command = value.trim();
  if (!command || command.length > 2000 || /[\r\n\u0000]/u.test(command)) {
    throw new Error("终端历史命令必须是 1 至 2000 个字符的单行文本");
  }
  return command;
}

function cloneUiPreferences(preferences: UiPreferences): UiPreferences {
  return {
    ...preferences,
    shortcuts: { ...preferences.shortcuts }
  };
}

function validateShortcutMap(shortcuts: Record<string, string>): void {
  const assigned = new Map<string, string>();
  for (const [command, value] of Object.entries(shortcuts)) {
    const normalized = normalizeShortcut(value, command);
    if (!normalized) {
      continue;
    }
    const identity = normalized.toLocaleLowerCase();
    const existingCommand = assigned.get(identity);
    if (existingCommand) {
      throw new Error(`快捷键 ${value} 同时分配给了 ${existingCommand} 和 ${command}。`);
    }
    assigned.set(identity, command);
  }
}

const shortcutModifierAliases: Record<string, "ctrl" | "alt" | "shift" | "meta"> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta"
};
const shortcutModifierOrder = ["ctrl", "alt", "shift", "meta"] as const;

function normalizeShortcut(value: unknown, command: string): string {
  if (typeof value !== "string") {
    throw new Error(`快捷键 ${command} 必须是字符串。`);
  }
  const tokens = value.split("+").map((token) => token.trim().toLocaleLowerCase()).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  const modifiers = new Set<"ctrl" | "alt" | "shift" | "meta">();
  const mainKeys: string[] = [];
  for (const token of tokens) {
    const modifier = shortcutModifierAliases[token];
    if (modifier) {
      if (modifiers.has(modifier)) {
        throw new Error(`快捷键 ${command} 重复声明了 ${modifier} 修饰键。`);
      }
      modifiers.add(modifier);
    } else {
      mainKeys.push(token);
    }
  }
  if (mainKeys.length !== 1) {
    throw new Error(mainKeys.length === 0 ? `快捷键 ${command} 缺少主按键。` : `快捷键 ${command} 只能包含一个主按键。`);
  }
  const modifierLabels: Record<"ctrl" | "alt" | "shift" | "meta", string> = {
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    meta: "Meta"
  };
  const key = /^[a-z0-9]$/i.test(mainKeys[0]) || /^f\d+$/i.test(mainKeys[0])
    ? mainKeys[0].toLocaleUpperCase()
    : mainKeys[0].replace(/^./, (character) => character.toLocaleUpperCase());
  return [...shortcutModifierOrder.filter((modifier) => modifiers.has(modifier)).map((modifier) => modifierLabels[modifier]), key].join("+");
}

function normalizeShortcutMap(shortcuts: Record<string, unknown>): Record<string, string> {
  const normalized = Object.fromEntries(Object.entries(shortcuts).map(([command, value]) => [command, normalizeShortcut(value, command)]));
  validateShortcutMap(normalized);
  return normalized;
}

function normalizeUiPreferences(preferences: Partial<UiPreferences>): UiPreferences {
  const merged = { ...defaultConfig.ui, ...preferences };
  const fontSize = Number(merged.fontSize);
  const sidebarWidth = Number(merged.sidebarWidth);
  const rightPanelWidth = Number(merged.rightPanelWidth);
  const consoleHeight = Number(merged.consoleHeight);
  return {
    theme: merged.theme === "light" || merged.theme === "dark" ? merged.theme : "system",
    language: "zh-CN",
    bottomConsoleVisible: Boolean(merged.bottomConsoleVisible),
    sidebarWidth: Number.isFinite(sidebarWidth) ? Math.min(420, Math.max(180, sidebarWidth)) : defaultConfig.ui.sidebarWidth,
    rightPanelWidth: Number.isFinite(rightPanelWidth) ? Math.min(720, Math.max(400, rightPanelWidth)) : defaultConfig.ui.rightPanelWidth,
    consoleHeight: Number.isFinite(consoleHeight) ? Math.min(720, Math.max(80, consoleHeight)) : defaultConfig.ui.consoleHeight,
    fontSize: Number.isFinite(fontSize) ? Math.min(20, Math.max(11, fontSize)) : defaultConfig.ui.fontSize,
    fontFamily: typeof merged.fontFamily === "string" && merged.fontFamily.trim() ? merged.fontFamily.trim() : defaultConfig.ui.fontFamily,
    diffViewMode: merged.diffViewMode === "inline" ? "inline" : "split",
    diffWrap: Boolean(merged.diffWrap),
    pullStrategy: merged.pullStrategy === "rebase" || merged.pullStrategy === "rebase-autostash" ? merged.pullStrategy : "ff-only",
    density: merged.density === "compact" ? "compact" : "comfortable",
    sidebarPosition: merged.sidebarPosition === "right" ? "right" : "left",
    confirmDestructiveActions: merged.confirmDestructiveActions !== false,
    shortcuts: normalizeShortcutMap({
      ...defaultConfig.ui.shortcuts,
      ...(merged.shortcuts && typeof merged.shortcuts === "object" ? merged.shortcuts : {})
    })
  };
}

function requireGroupName(name: string): string {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("项目分组名称不能为空");
  }
  if (normalizedName.length > 40) {
    throw new Error("项目分组名称不能超过 40 个字符");
  }
  return normalizedName;
}

function requireProjectName(name: string): string {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("项目名称不能为空");
  }
  if (normalizedName.length > 80) {
    throw new Error("项目名称不能超过 80 个字符");
  }
  if (/[\r\n\u0000]/u.test(normalizedName)) {
    throw new Error("项目名称只能使用单行文本");
  }
  return normalizedName;
}

function normalizeRemotePath(repositoryPath: string): string {
  const normalized = path.posix.normalize(repositoryPath.trim().replace(/\\/g, "/"));
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function remoteProjectKey(remote: SshConnection, repositoryPath: string): string {
  return [
    remote.host.trim().toLowerCase(),
    remote.username?.trim() ?? "",
    remote.port ?? 22,
    normalizeRemotePath(repositoryPath)
  ].join("\u0000");
}

function placeProjectAfterPinned(projects: GitProject[], project: GitProject): GitProject[] {
  const firstUnpinnedIndex = projects.findIndex((item) => !item.favorite);
  if (firstUnpinnedIndex < 0) {
    return [...projects, project];
  }

  return [...projects.slice(0, firstUnpinnedIndex), project, ...projects.slice(firstUnpinnedIndex)];
}

function orderProjectsWithPinnedFirst(projects: GitProject[]): GitProject[] {
  const pinnedProjects = projects.filter((project) => project.favorite);
  const regularProjects = projects.filter((project) => !project.favorite);
  return [...pinnedProjects, ...regularProjects];
}
