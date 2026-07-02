import { mockCommits, mockDiffLines, mockProjects } from "../data/mockData";
import type { ChangedFile, CommitInput, CommitNode, DiffLine, GitOperationResult, GitProject, GitStatusSummary, WorktreeState } from "../types/domain";

const mockDelay = 180;

export const apiClient = {
  async getGitVersion(): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.getGitVersion();
    }

    return {
      ok: true,
      command: "git --version",
      stdout: "git version 2.x.x",
      stderr: "",
      exitCode: 0
    };
  },

  async getProjects(): Promise<GitProject[]> {
    if (window.gitUI) {
      const projects = await window.gitUI.getProjects();
      return projects.length > 0 ? projects : mockProjects.slice(0, 1);
    }

    await wait(mockDelay);
    return mockProjects;
  },

  async chooseAndAddProject(): Promise<GitProject | null> {
    if (window.gitUI) {
      const directoryPath = await window.gitUI.chooseDirectory();
      return directoryPath ? window.gitUI.addProject(directoryPath) : null;
    }

    const directoryPath = window.prompt("输入本地 Git 仓库路径");
    if (!directoryPath) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      name: directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "新项目",
      path: directoryPath,
      favorite: false,
      lastOpenedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: {
        currentBranch: "main",
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        hasConflicts: false
      }
    };
  },

  async chooseAndScanProjects(): Promise<GitProject[]> {
    if (window.gitUI) {
      const rootPath = await window.gitUI.chooseDirectory();
      return rootPath ? window.gitUI.scanProjects(rootPath) : [];
    }

    await wait(mockDelay);
    return mockProjects;
  },

  async removeProject(projectId: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.removeProject(projectId);
    }

    await wait(mockDelay);
    return Boolean(projectId);
  },

  async getProjectStatus(project: GitProject): Promise<GitStatusSummary | undefined> {
    if (window.gitUI) {
      return window.gitUI.getProjectStatus(project.path);
    }

    await wait(mockDelay);
    return project.status;
  },

  async getHistory(project: GitProject): Promise<CommitNode[]> {
    if (window.gitUI) {
      return window.gitUI.getHistory(project.path);
    }

    await wait(mockDelay);
    return mockCommits;
  },

  async getCommitDetails(project: GitProject, hash: string): Promise<CommitNode> {
    if (window.gitUI) {
      return window.gitUI.getCommitDetails(project.path, hash);
    }

    await wait(mockDelay);
    return mockCommits.find((commit) => commit.hash === hash) ?? mockCommits[0];
  },

  async getCommitDiff(project: GitProject, hash: string, filePath?: string): Promise<DiffLine[]> {
    if (window.gitUI) {
      return window.gitUI.getCommitDiff(project.path, hash, filePath);
    }

    await wait(mockDelay);
    return mockDiffLines;
  },

  async getWorktree(project: GitProject): Promise<WorktreeState> {
    if (window.gitUI) {
      return window.gitUI.getWorktree(project.path);
    }

    await wait(mockDelay);
    return {
      stagedFiles: [{ path: "docs/PRD.md", status: "added", staged: true }],
      unstagedFiles: [
        { path: "src/App.tsx", status: "modified", staged: false },
        { path: "src/styles/app.css", status: "added", staged: false },
        { path: "electron/gitService.ts", status: "modified", staged: false }
      ]
    };
  },

  async getWorktreeDiff(project: GitProject, filePath: string, staged: boolean): Promise<DiffLine[]> {
    if (window.gitUI) {
      return window.gitUI.getWorktreeDiff(project.path, filePath, staged);
    }

    await wait(mockDelay);
    return mockDiffLines;
  },

  async stageFile(project: GitProject, filePath: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.stageFile(project.path, filePath);
    }

    await wait(mockDelay);
    return okResult(`git add -- ${filePath}`);
  },

  async stageAll(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.stageAll(project.path);
    }

    await wait(mockDelay);
    return okResult("git add -A");
  },

  async unstageFile(project: GitProject, filePath: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.unstageFile(project.path, filePath);
    }

    await wait(mockDelay);
    return okResult(`git restore --staged -- ${filePath}`);
  },

  async unstageAll(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.unstageAll(project.path);
    }

    await wait(mockDelay);
    return okResult("git restore --staged -- .");
  },

  async discardFile(project: GitProject, file: ChangedFile): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.discardFile(project.path, file);
    }

    await wait(mockDelay);
    return okResult(`git restore -- ${file.path}`);
  },

  async commit(project: GitProject, input: CommitInput): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.commit(project.path, input);
    }

    await wait(mockDelay);
    return okResult(`git commit -m ${input.subject}`);
  },

  async fetch(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.fetch(project.path);
    }

    await wait(mockDelay);
    return okResult("git fetch --prune");
  },

  async pull(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.pull(project.path);
    }

    await wait(mockDelay);
    return okResult("git pull --ff-only");
  },

  async push(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.push(project.path);
    }

    await wait(mockDelay);
    return okResult("git push");
  }
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function okResult(command: string): GitOperationResult {
  return {
    ok: true,
    command,
    stdout: "",
    stderr: "",
    exitCode: 0
  };
}
