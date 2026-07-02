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
      return { ...defaultConfig, ...JSON.parse(raw) } as AppConfig;
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

  async removeProject(projectId: string): Promise<void> {
    const config = await this.read();
    config.projects = config.projects.filter((project) => project.id !== projectId);
    config.recentProjectIds = config.recentProjectIds.filter((id) => id !== projectId);
    await this.write(config);
  }
}

