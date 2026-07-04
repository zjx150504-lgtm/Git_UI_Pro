import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface GitProject {
  id: string;
  name: string;
  path: string;
  groupId?: string;
  favorite: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
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
    const existing = config.projects.find((project) => path.resolve(project.path) === normalizedPath);

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

    config.projects.push(project);
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
