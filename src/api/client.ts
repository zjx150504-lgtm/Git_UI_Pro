import { mockCommits, mockDiffLines, mockProjects } from "../data/mockData";
import type {
  BranchInfo,
  ChangedFile,
  CommitMessageInput,
  CommitInput,
  CommitNode,
  DiffLine,
  FilePreview,
  GitHistoryFilter,
  GitHistoryRef,
  GitOperationResult,
  GitProject,
  GitResetMode,
  GitStatusSummary,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
  WorktreeState
} from "../types/domain";

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

  async openExternal(url: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.openExternal(url);
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  },

  async startTerminal(project: GitProject): Promise<TerminalSessionInfo> {
    if (window.gitUI) {
      return window.gitUI.startTerminal(project.path);
    }

    await wait(mockDelay);
    return { sessionId: `mock-terminal-${Date.now()}`, shell: "Mock Shell", cwd: project.path };
  },

  async writeTerminal(sessionId: string, data: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.writeTerminal(sessionId, data);
    }

    void sessionId;
    void data;
    await wait(40);
    return true;
  },

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.resizeTerminal(sessionId, cols, rows);
    }

    void sessionId;
    void cols;
    void rows;
    return true;
  },

  async disposeTerminal(sessionId: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.disposeTerminal(sessionId);
    }

    void sessionId;
    return true;
  },

  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void {
    if (window.gitUI) {
      return window.gitUI.onTerminalData(callback);
    }

    void callback;
    return () => undefined;
  },

  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void {
    if (window.gitUI) {
      return window.gitUI.onTerminalExit(callback);
    }

    void callback;
    return () => undefined;
  },

  async getProjects(): Promise<GitProject[]> {
    if (window.gitUI) {
      return window.gitUI.getProjects();
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

  async reorderProjects(projectIds: string[]): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.reorderProjects(projectIds);
    }

    await wait(mockDelay);
    return projectIds.length >= 0;
  },

  async setProjectFavorite(projectId: string, favorite: boolean): Promise<GitProject | undefined> {
    if (window.gitUI) {
      return window.gitUI.setProjectFavorite(projectId, favorite);
    }

    await wait(mockDelay);
    return mockProjects.find((project) => project.id === projectId) ? { ...mockProjects.find((project) => project.id === projectId)!, favorite } : undefined;
  },

  async getProjectStatus(project: GitProject): Promise<GitStatusSummary | undefined> {
    if (window.gitUI) {
      return window.gitUI.getProjectStatus(project.path);
    }

    await wait(mockDelay);
    return project.status;
  },

  async getHistory(project: GitProject, filter: GitHistoryFilter = { mode: "auto" }): Promise<CommitNode[]> {
    if (window.gitUI) {
      return window.gitUI.getHistory(project.path, filter);
    }

    await wait(mockDelay);
    return mockCommits;
  },

  async getHistoryRefs(project: GitProject): Promise<GitHistoryRef[]> {
    if (window.gitUI) {
      return window.gitUI.getHistoryRefs(project.path);
    }

    await wait(mockDelay);
    return [
      { id: "refs/heads/master", name: "master", type: "branch", revision: mockCommits[0]?.hash ?? "", category: "branches", current: true },
      { id: "refs/remotes/origin/master", name: "origin/master", type: "remoteBranch", revision: mockCommits[0]?.hash ?? "", category: "remote branches", upstream: true },
      { id: "refs/tags/v0.1-prd", name: "v0.1-prd", type: "tag", revision: mockCommits[1]?.hash ?? "", category: "tags" }
    ];
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

  async getCommitFilePreview(project: GitProject, hash: string, file: ChangedFile): Promise<FilePreview | null> {
    if (window.gitUI) {
      return window.gitUI.getCommitFilePreview(project.path, hash, file);
    }

    void project;
    void hash;
    void file;
    await wait(40);
    return null;
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

  async getWorktreeFilePreview(project: GitProject, file: ChangedFile): Promise<FilePreview | null> {
    if (window.gitUI) {
      return window.gitUI.getWorktreeFilePreview(project.path, file);
    }

    void project;
    void file;
    await wait(40);
    return null;
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
    return okResult(input.pushAfterCommit ? `git commit -m ${input.subject} && git push` : `git commit -m ${input.subject}`);
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
  },

  async getBranches(project: GitProject): Promise<BranchInfo[]> {
    if (window.gitUI) {
      return window.gitUI.getBranches(project.path);
    }

    await wait(mockDelay);
    return [
      {
        name: project.status?.currentBranch ?? "main",
        fullName: `refs/heads/${project.status?.currentBranch ?? "main"}`,
        type: "local",
        current: true,
        upstream: project.status?.upstream,
        headHash: mockCommits[0]?.hash ?? ""
      },
      {
        name: "feature/project-scan",
        fullName: "refs/heads/feature/project-scan",
        type: "local",
        current: false,
        headHash: mockCommits[2]?.hash ?? ""
      },
      {
        name: "origin/master",
        fullName: "refs/remotes/origin/master",
        type: "remote",
        current: false,
        headHash: mockCommits[0]?.hash ?? ""
      }
    ];
  },

  async createBranch(project: GitProject, branchName: string, checkout: boolean, startPoint?: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.createBranch(project.path, branchName, checkout, startPoint);
    }

    await wait(mockDelay);
    const startArg = startPoint ? ` ${startPoint}` : "";
    return okResult(checkout ? `git switch -c ${branchName}${startArg}` : `git branch ${branchName}${startArg}`);
  },

  async switchBranch(project: GitProject, branch: BranchInfo): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.switchBranch(project.path, branch);
    }

    await wait(mockDelay);
    return okResult(branch.type === "remote" ? `git switch --track ${branch.name}` : `git switch ${branch.name}`);
  },

  async mergeCurrentBranchToMain(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.mergeCurrentBranchToMain(project.path);
    }

    await wait(mockDelay);
    const currentBranch = project.status?.currentBranch ?? "feature/current";
    return okResult(`git switch master && git merge --no-edit ${currentBranch}`);
  },

  async continueMerge(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.continueMerge(project.path);
    }

    await wait(mockDelay);
    return okResult("git commit --no-edit");
  },

  async abortMerge(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.abortMerge(project.path);
    }

    await wait(mockDelay);
    return okResult("git merge --abort");
  },

  async deleteBranch(project: GitProject, branchName: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.deleteBranch(project.path, branchName);
    }

    await wait(mockDelay);
    return okResult(`git branch -d ${branchName}`);
  },

  async amendLastCommitMessage(project: GitProject, input: CommitMessageInput): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.amendLastCommitMessage(project.path, input);
    }

    await wait(mockDelay);
    return okResult(`git commit --amend -m ${input.subject}`);
  },

  async resetLastCommit(project: GitProject, mode: Exclude<GitResetMode, "hard">): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.resetLastCommit(project.path, mode);
    }

    await wait(mockDelay);
    return okResult(`git reset --${mode} HEAD~1`);
  },

  async resetToCommit(project: GitProject, hash: string, mode: GitResetMode): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.resetToCommit(project.path, hash, mode);
    }

    await wait(mockDelay);
    return okResult(`git reset --${mode} ${hash}`);
  },

  async revertCommit(project: GitProject, hash: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.revertCommit(project.path, hash);
    }

    await wait(mockDelay);
    return okResult(`git revert --no-edit ${hash}`);
  },

  async cherryPickCommit(project: GitProject, hash: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.cherryPickCommit(project.path, hash);
    }

    await wait(mockDelay);
    return okResult(`git cherry-pick ${hash}`);
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
