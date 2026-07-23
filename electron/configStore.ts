import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface AppConfig {
  version: number;
  projects: GitProject[];
  groups: ProjectGroup[];
  recentProjectIds: string[];
  ui: {
    theme: "system" | "light" | "dark";
    language: "zh-CN";
    bottomConsoleVisible: boolean;
    rightPanelWidth: number;
  };
}

const defaultConfig: AppConfig = {
  version: 1,
  projects: [],
  groups: [
    { id: "work", name: "工作项目", sortOrder: 10 },
    { id: "personal", name: "个人项目", sortOrder: 20 },
    { id: "client", name: "客户项目", sortOrder: 30 }
  ],
  recentProjectIds: [],
  ui: {
    theme: "system",
    language: "zh-CN",
    bottomConsoleVisible: true,
    rightPanelWidth: 420
  }
};

export class ConfigStore {
  private readonly configPath: string;

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, "config.json");
  }

  async read(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const config = { ...defaultConfig, ...JSON.parse(raw) } as AppConfig;
      const projects = orderProjectsWithPinnedFirst(config.projects.map((project) => ({ ...project, favorite: Boolean(project.favorite) })));
      return {
        ...config,
        projects,
        groups: config.groups ?? defaultConfig.groups,
        recentProjectIds: config.recentProjectIds ?? defaultConfig.recentProjectIds,
        ui: { ...defaultConfig.ui, ...config.ui }
      };
    } catch {
      await this.write(defaultConfig);
      return defaultConfig;
    }
  }

  async write(config: AppConfig): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  async listProjects(): Promise<GitProject[]> {
    const config = await this.read();
    return config.projects;
  }

  async addProject(repositoryPath: string): Promise<GitProject> {
    const config = await this.read();
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
    await this.write(config);

    return project;
  }

  async addRemoteProject(input: RemoteProjectInput, repositoryRoot: string): Promise<GitProject> {
    const config = await this.read();
    const remote: SshConnection = {
      type: "ssh",
      host: input.host.trim(),
      username: input.username?.trim() || undefined,
      port: input.port,
      identityFile: input.identityFile?.trim() || undefined
    };
    const normalizedPath = normalizeRemotePath(repositoryRoot);
    const existing = config.projects.find(
      (project) => project.remote && remoteProjectKey(project.remote, project.path) === remoteProjectKey(remote, normalizedPath)
    );

    if (existing) {
      const updatedProject: GitProject = {
        ...existing,
        remote,
        updatedAt: new Date().toISOString()
      };
      config.projects = config.projects.map((project) => (project.id === existing.id ? updatedProject : project));
      await this.write(config);
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
    await this.write(config);

    return project;
  }

  async reorderProjects(projectIds: string[]): Promise<void> {
    const config = await this.read();
    const projectById = new Map(config.projects.map((project) => [project.id, project]));
    const orderedProjects = projectIds
      .map((projectId) => projectById.get(projectId))
      .filter((project): project is GitProject => Boolean(project));
    const orderedIds = new Set(orderedProjects.map((project) => project.id));
    const remainingProjects = config.projects.filter((project) => !orderedIds.has(project.id));

    config.projects = orderProjectsWithPinnedFirst([...orderedProjects, ...remainingProjects]);
    await this.write(config);
  }

  async setProjectFavorite(projectId: string, favorite: boolean): Promise<GitProject | undefined> {
    const config = await this.read();
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

    await this.write(config);
    return updatedProject;
  }

  async removeProject(projectId: string): Promise<void> {
    const config = await this.read();
    config.projects = config.projects.filter((project) => project.id !== projectId);
    config.recentProjectIds = config.recentProjectIds.filter((id) => id !== projectId);
    await this.write(config);
  }
}

function normalizeRemotePath(repositoryPath: string): string {
  const normalized = path.posix.normalize(repositoryPath.trim().replace(/\\/g, "/"));
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function remoteProjectKey(remote: SshConnection, repositoryPath: string): string {
  return [
    remote.host.trim().toLowerCase(),
    remote.username?.trim().toLowerCase() ?? "",
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
