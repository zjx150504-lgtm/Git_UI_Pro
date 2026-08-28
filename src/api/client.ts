import { mockCommits, mockDiffLines, mockProjects } from "../data/mockData";
import type {
  BranchInfo,
  ChangedFile,
  ConflictFileDetails,
  ConflictResolutionInput,
  CommitMessageInput,
  CommitInput,
  CommitNode,
  DiffLine,
  FilePreview,
  GitHistoryFilter,
  GitHistoryPage,
  GitHistoryQuery,
  GitHistoryRef,
  GitBlameLine,
  GitHostingLinks,
  GitHostingAccountSummary,
  GitHostingChangeRequest,
  GitHostingCreateChangeInput,
  GitHostingMergeInput,
  GitHostingProvider,
  GitHostingReviewInput,
  GitIdentityConfig,
  GitIdentityUpdate,
  GitIgnoreDocument,
  GitLfsStatus,
  GitLfsLock,
  GitLfsMigrateOptions,
  GitLinkedWorktree,
  GitMergePreview,
  GitMergeStrategy,
  GitOperationResult,
  GitPullStrategy,
  GitPushOptions,
  GitProject,
  GitReflogEntry,
  GitRebasePlanItem,
  GitRemoteInfo,
  GitRemoteUpdateInput,
  GitResetMode,
  GitSigningConfig,
  GitSigningConfigUpdate,
  GitStashCreateOptions,
  GitStashEntry,
  GitStashDetails,
  GitSubmoduleAddOptions,
  GitStatusSummary,
  GitSubmoduleInfo,
  GitSubmoduleUpdateOptions,
  GitTagInfo,
  GitWorktreeAddOptions,
  GitWorktreeMoveOptions,
  GitCloneOptions,
  ProjectGroup,
  ProjectLibraryState,
  RemoteProjectInput,
  RemoteProjectTestResult,
  SshHostInspection,
  RepositoryTarget,
  RepositoryCreationResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalHistoryEntry,
  TerminalSessionInfo,
  UiPreferences,
  WorktreeState
} from "../types/domain";
import type { GitLongOperationKind } from "../types/operations";
import { beginGitOperation, finishGitOperation } from "./operationTracker";

const mockDelay = 180;
let browserProjectLibrary: ProjectLibraryState = {
  groups: [
    { id: "personal", name: "个人项目", sortOrder: 0 },
    { id: "work", name: "工作项目", sortOrder: 1 },
    { id: "client", name: "客户项目", sortOrder: 2 }
  ],
  recentProjectIds: mockProjects.map((project) => project.id)
};
let browserUiPreferences: UiPreferences = {
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
  shortcuts: {}
};
const browserTerminalHistories: Record<string, TerminalHistoryEntry[]> = {};

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

  async openPath(filePath: string): Promise<boolean> {
    return desktopBridge().openPath(filePath);
  },

  async revealPath(filePath: string): Promise<boolean> {
    return desktopBridge().revealPath(filePath);
  },

  async inspectSshHost(host: string, port?: number): Promise<SshHostInspection> {
    if (window.gitUI) {
      return window.gitUI.inspectSshHost(host, port);
    }
    await wait(mockDelay);
    return {
      token: `mock-host-${Date.now()}`,
      host,
      port: port ?? 22,
      status: "trusted",
      currentFingerprints: [],
      scannedFingerprints: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  },

  async trustSshHost(token: string, replaceExisting: boolean): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.trustSshHost(token, replaceExisting);
    }
    void token;
    void replaceExisting;
    return true;
  },

  async startTerminal(project: GitProject): Promise<TerminalSessionInfo> {
    if (window.gitUI) {
      return window.gitUI.startTerminal(repositoryTarget(project));
    }

    await wait(mockDelay);
    return { sessionId: `mock-terminal-${Date.now()}`, shell: "Mock Shell", cwd: project.path, trustedPromptMarkers: false };
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

  async getTerminalHistory(projectId: string): Promise<TerminalHistoryEntry[]> {
    if (window.gitUI) {
      return window.gitUI.getTerminalHistory(projectId);
    }
    return (browserTerminalHistories[projectId] ?? []).map((entry) => ({ ...entry }));
  },

  async appendTerminalHistory(projectId: string, command: string): Promise<TerminalHistoryEntry[]> {
    if (window.gitUI) {
      return window.gitUI.appendTerminalHistory(projectId, command);
    }
    const entry = { id: crypto.randomUUID(), command, executedAt: new Date().toISOString() };
    browserTerminalHistories[projectId] = [entry, ...(browserTerminalHistories[projectId] ?? [])].slice(0, 200);
    return browserTerminalHistories[projectId].map((item) => ({ ...item }));
  },

  async clearTerminalHistory(projectId: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.clearTerminalHistory(projectId);
    }
    const existed = projectId in browserTerminalHistories;
    delete browserTerminalHistories[projectId];
    return existed;
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
        hasConflicts: false,
        conflictedCount: 0
      }
    };
  },

  async chooseIdentityFile(): Promise<string | null> {
    return window.gitUI?.chooseIdentityFile() ?? null;
  },

  async testRemoteProject(input: RemoteProjectInput): Promise<RemoteProjectTestResult> {
    if (window.gitUI) {
      return window.gitUI.testRemoteProject(input);
    }

    await wait(mockDelay);
    const repositoryRoot = input.repositoryPath.trim() || "/srv/git/example";
    return {
      ok: true,
      command: "ssh mock -- git rev-parse --show-toplevel",
      stdout: `${repositoryRoot}\n`,
      stderr: "",
      exitCode: 0,
      repositoryRoot,
      projectName: repositoryRoot.split("/").filter(Boolean).at(-1) ?? "远程项目"
    };
  },

  async addRemoteProject(input: RemoteProjectInput): Promise<GitProject> {
    if (window.gitUI) {
      return window.gitUI.addRemoteProject(input);
    }

    const result = await this.testRemoteProject(input);
    const now = new Date().toISOString();
    const project: GitProject = {
      id: crypto.randomUUID(),
      name: result.projectName ?? "远程项目",
      path: result.repositoryRoot ?? input.repositoryPath,
      remote: {
        type: "ssh",
        host: input.host,
        username: input.username,
        port: input.port,
        identityFile: input.identityFile,
        connectionEnabled: true
      },
      favorite: false,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now
    };
    mockProjects.push(project);
    return project;
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

  async renameProject(projectId: string, name: string): Promise<GitProject> {
    if (window.gitUI) {
      return window.gitUI.renameProject(projectId, name);
    }

    await wait(mockDelay);
    const project = mockProjects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在。");
    }
    project.name = name.trim();
    project.updatedAt = new Date().toISOString();
    return { ...project };
  },

  async setRemoteProjectConnectionEnabled(projectId: string, enabled: boolean): Promise<GitProject> {
    if (window.gitUI) {
      return window.gitUI.setRemoteProjectConnectionEnabled(projectId, enabled);
    }

    await wait(mockDelay);
    const project = mockProjects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在。");
    }
    if (!project.remote) {
      throw new Error("该项目不是远程项目。");
    }
    project.remote = { ...project.remote, connectionEnabled: enabled };
    project.updatedAt = new Date().toISOString();
    return { ...project, remote: { ...project.remote } };
  },

  async getProjectStatus(project: GitProject): Promise<GitStatusSummary> {
    if (window.gitUI) {
      return window.gitUI.getProjectStatus(repositoryTarget(project));
    }

    await wait(mockDelay);
    if (!project.status) {
      throw new Error(`无法读取项目 ${project.name} 的仓库状态。`);
    }

    return project.status;
  },

  async getHistory(project: GitProject, filter: GitHistoryFilter = { mode: "auto" }): Promise<CommitNode[]> {
    if (window.gitUI) {
      return window.gitUI.getHistory(repositoryTarget(project), filter);
    }

    await wait(mockDelay);
    return mockCommits;
  },

  async getHistoryRefs(project: GitProject): Promise<GitHistoryRef[]> {
    if (window.gitUI) {
      return window.gitUI.getHistoryRefs(repositoryTarget(project));
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
      return window.gitUI.getCommitDetails(repositoryTarget(project), hash);
    }

    await wait(mockDelay);
    return mockCommits.find((commit) => commit.hash === hash) ?? mockCommits[0];
  },

  async getCommitDiff(
    project: GitProject,
    hash: string,
    filePath?: string,
    knownFirstParent?: string | null,
    readRequestId?: string
  ): Promise<DiffLine[]> {
    if (window.gitUI) {
      return window.gitUI.getCommitDiff(repositoryTarget(project), hash, filePath, knownFirstParent, readRequestId);
    }

    await wait(mockDelay);
    return mockDiffLines;
  },

  async cancelGitReadRequest(requestId: string): Promise<boolean> {
    if (window.gitUI?.cancelGitReadRequest) {
      return window.gitUI.cancelGitReadRequest(requestId);
    }
    return false;
  },

  async getCommitFilePreview(project: GitProject, hash: string, file: ChangedFile): Promise<FilePreview | null> {
    if (window.gitUI) {
      return window.gitUI.getCommitFilePreview(repositoryTarget(project), hash, file);
    }

    void project;
    void hash;
    void file;
    await wait(40);
    return null;
  },

  async getWorktree(project: GitProject): Promise<WorktreeState> {
    if (window.gitUI) {
      return window.gitUI.getWorktree(repositoryTarget(project));
    }

    await wait(mockDelay);
    if (project.status?.hasConflicts) {
      return {
        stagedFiles: [],
        unstagedFiles: [{ path: "src/config.ts", status: "conflicted", staged: false }]
      };
    }
    return {
      stagedFiles: [{ path: "docs/PRD.md", status: "added", staged: true }],
      unstagedFiles: [
        { path: "src/App.tsx", status: "modified", staged: false },
        { path: "src/styles/app.css", status: "untracked", staged: false },
        { path: "electron/gitService.ts", status: "modified", staged: false }
      ]
    };
  },

  async getWorktreeDiff(project: GitProject, filePath: string, staged: boolean): Promise<DiffLine[]> {
    if (window.gitUI) {
      return window.gitUI.getWorktreeDiff(repositoryTarget(project), filePath, staged);
    }

    await wait(mockDelay);
    return mockDiffLines;
  },

  async getWorktreeFilePreview(project: GitProject, file: ChangedFile): Promise<FilePreview | null> {
    if (window.gitUI) {
      return window.gitUI.getWorktreeFilePreview(repositoryTarget(project), file);
    }

    void project;
    void file;
    await wait(40);
    return null;
  },

  async getConflictFileDetails(project: GitProject, filePath: string): Promise<ConflictFileDetails> {
    if (window.gitUI) {
      return window.gitUI.getConflictFileDetails(repositoryTarget(project), filePath);
    }

    await wait(mockDelay);
    return {
      path: filePath,
      baseContent: "export const mode = \"base\";\nexport const retries = 2;\n",
      currentContent: "export const mode = \"release\";\nexport const retries = 2;\n",
      incomingContent: "export const mode = \"feature\";\nexport const retries = 3;\n",
      resultContent:
        "<<<<<<< HEAD\nexport const mode = \"release\";\nexport const retries = 2;\n=======\nexport const mode = \"feature\";\nexport const retries = 3;\n>>>>>>> feature/invoice-flow\n",
      baseExists: true,
      currentExists: true,
      incomingExists: true,
      resultExists: true,
      currentLabel: "release/2.4",
      incomingLabel: "feature/invoice-flow",
      editable: true,
      isBinary: false,
      token: "mock-conflict-token"
    };
  },

  async resolveConflictFile(project: GitProject, filePath: string, input: ConflictResolutionInput): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.resolveConflictFile(repositoryTarget(project), filePath, input);
    }

    await wait(mockDelay);
    return okResult(`git add -- ${filePath}`);
  },

  async stageFile(project: GitProject, file: ChangedFile): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.stageFile(repositoryTarget(project), file);
    }

    await wait(mockDelay);
    return okResult(`git add -- ${[file.oldPath, file.path].filter(Boolean).join(" ")}`);
  },

  async stageAll(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.stageAll(repositoryTarget(project));
    }

    await wait(mockDelay);
    return okResult("git add -A");
  },

  async unstageFile(project: GitProject, file: ChangedFile): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.unstageFile(repositoryTarget(project), file);
    }

    await wait(mockDelay);
    return okResult(`git restore --staged -- ${[file.oldPath, file.path].filter(Boolean).join(" ")}`);
  },

  async unstageAll(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.unstageAll(repositoryTarget(project));
    }

    await wait(mockDelay);
    return okResult("git restore --staged -- .");
  },

  async discardFile(project: GitProject, file: ChangedFile): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.discardFile(repositoryTarget(project), file);
    }

    await wait(mockDelay);
    return okResult(`git restore -- ${file.path}`);
  },

  async commit(project: GitProject, input: CommitInput): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.commit(repositoryTarget(project), input);
    }

    await wait(mockDelay);
    return okResult(input.pushAfterCommit ? `git commit -m ${input.subject} && git push` : `git commit -m ${input.subject}`);
  },

  async fetch(project: GitProject): Promise<GitOperationResult> {
    return runTrackedGitOperation("fetch", "获取远程更新", project.path, async (operationId) => {
      if (window.gitUI) {
        return window.gitUI.fetch(repositoryTarget(project), { operationId });
      }
      await wait(mockDelay);
      return okResult("git fetch --progress --prune");
    });
  },

  async pull(project: GitProject, strategy: GitPullStrategy): Promise<GitOperationResult> {
    return runTrackedGitOperation("pull", "拉取当前分支", project.path, async (operationId) => {
      if (window.gitUI) {
        return window.gitUI.pull(repositoryTarget(project), strategy, { operationId });
      }
      await wait(mockDelay);
      if (strategy === "ff-only") return okResult("git pull --progress --ff-only");
      if (strategy === "rebase") return okResult("git pull --progress --rebase");
      if (strategy === "rebase-autostash") return okResult("git pull --progress --rebase --autostash");
      throw new Error(`不支持的拉取策略：${String(strategy)}`);
    });
  },

  async mergeRemote(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.mergeRemote(repositoryTarget(project));
    }

    await wait(mockDelay);
    return okResult(`git fetch --prune ; git merge --no-edit ${project.status?.upstream ?? "@{upstream}"}`);
  },

  async push(project: GitProject, options: GitPushOptions = {}): Promise<GitOperationResult> {
    return runTrackedGitOperation("push", options.forceWithLease ? "安全强制推送" : "推送当前分支", project.path, async (operationId) => {
      if (window.gitUI) {
        return window.gitUI.push(repositoryTarget(project), { ...options, operationId });
      }
      await wait(mockDelay);
      return okResult(`git push --progress${options.forceWithLease ? " --force-with-lease" : ""}`);
    });
  },

  async getBranches(project: GitProject): Promise<BranchInfo[]> {
    if (window.gitUI) {
      return window.gitUI.getBranches(repositoryTarget(project));
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
      return window.gitUI.createBranch(repositoryTarget(project), branchName, checkout, startPoint);
    }

    await wait(mockDelay);
    const startArg = startPoint ? ` ${startPoint}` : "";
    return okResult(checkout ? `git switch -c ${branchName}${startArg}` : `git branch ${branchName}${startArg}`);
  },

  async switchBranch(project: GitProject, branch: BranchInfo): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.switchBranch(repositoryTarget(project), branch);
    }

    await wait(mockDelay);
    return okResult(branch.type === "remote" ? `git switch --track ${branch.name}` : `git switch ${branch.name}`);
  },

  async getMergePreview(project: GitProject, targetBranch: string): Promise<GitMergePreview> {
    if (window.gitUI) {
      return window.gitUI.getMergePreview(repositoryTarget(project), targetBranch);
    }

    await wait(mockDelay);
    return {
      sourceBranch: project.status?.currentBranch ?? "feature/current",
      targetBranch,
      targetUpstream: `origin/${targetBranch}`,
      targetAhead: 0,
      targetBehind: 0,
      mode: "fast-forward"
    };
  },

  async mergeCurrentBranch(project: GitProject, targetBranch: string, strategy: GitMergeStrategy): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.mergeCurrentBranch(repositoryTarget(project), targetBranch, strategy);
    }

    await wait(mockDelay);
    const currentBranch = project.status?.currentBranch ?? "feature/current";
    return okResult(`git switch ${targetBranch} && git merge --${strategy} --no-edit ${currentBranch}`);
  },

  async continueMerge(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.continueMerge(repositoryTarget(project));
    }

    await wait(mockDelay);
    return okResult("git commit --no-edit");
  },

  async abortMerge(project: GitProject): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.abortMerge(repositoryTarget(project));
    }

    await wait(mockDelay);
    return okResult("git merge --abort");
  },

  async deleteBranch(project: GitProject, branchName: string, force = false): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.deleteBranch(repositoryTarget(project), branchName, force);
    }

    await wait(mockDelay);
    return okResult(`git branch ${force ? "-D" : "-d"} ${branchName}`);
  },

  async amendLastCommitMessage(project: GitProject, input: CommitMessageInput): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.amendLastCommitMessage(repositoryTarget(project), input);
    }

    await wait(mockDelay);
    return okResult(`git commit --amend -m ${input.subject}`);
  },

  async resetLastCommit(project: GitProject, mode: GitResetMode): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.resetLastCommit(repositoryTarget(project), mode);
    }

    await wait(mockDelay);
    return okResult(`git reset --${mode} HEAD~1`);
  },

  async resetToCommit(project: GitProject, hash: string, mode: GitResetMode): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.resetToCommit(repositoryTarget(project), hash, mode);
    }

    await wait(mockDelay);
    return okResult(`git reset --${mode} ${hash}`);
  },

  async revertCommit(project: GitProject, hash: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.revertCommit(repositoryTarget(project), hash);
    }

    await wait(mockDelay);
    return okResult(`git revert --no-edit ${hash}`);
  },

  async cherryPickCommit(project: GitProject, hash: string): Promise<GitOperationResult> {
    if (window.gitUI) {
      return window.gitUI.cherryPickCommit(repositoryTarget(project), hash);
    }

    await wait(mockDelay);
    return okResult(`git cherry-pick ${hash}`);
  },

  async getHistoryPage(project: GitProject, query: GitHistoryQuery): Promise<GitHistoryPage> {
    if (window.gitUI) {
      return window.gitUI.getHistoryPage(repositoryTarget(project), query);
    }

    void project;
    await wait(mockDelay);
    const search = query.search?.trim().toLocaleLowerCase();
    const author = query.author?.trim().toLocaleLowerCase();
    const filePath = query.path?.trim().toLocaleLowerCase();
    const after = query.after?.trim();
    const before = query.before?.trim();
    const filtered = mockCommits.filter((commit) => {
      const commitDate = commit.authorDate.slice(0, 10);
      return (!search || `${commit.subject}\n${commit.body ?? ""}`.toLocaleLowerCase().includes(search)) &&
        (!author || `${commit.authorName}\n${commit.authorEmail}`.toLocaleLowerCase().includes(author)) &&
        (!filePath || commit.files.some((file) => file.path.toLocaleLowerCase().includes(filePath))) &&
        (!after || commitDate >= after) &&
        (!before || commitDate <= before);
    });
    const skip = Math.max(0, query.skip ?? 0);
    const limit = Math.max(1, query.limit ?? 80);
    const commits = filtered.slice(skip, skip + limit);
    return { commits, hasMore: skip + commits.length < filtered.length, nextSkip: skip + commits.length };
  },

  async getBlame(project: GitProject, filePath: string, revision?: string): Promise<GitBlameLine[]> {
    if (window.gitUI) {
      return window.gitUI.getBlame(repositoryTarget(project), filePath, revision);
    }

    void project;
    void revision;
    await wait(mockDelay);
    return mockCommits.slice(0, 3).map((commit, index) => ({
      lineNumber: index + 1,
      hash: commit.hash,
      shortHash: commit.shortHash,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      authorDate: commit.authorDate,
      content: index === 0 ? `// ${filePath}` : `const sampleLine${index} = ${index};`
    }));
  },

  async fetchRemote(project: GitProject, remoteName: string, prune = false): Promise<GitOperationResult> {
    return runTrackedGitOperation("fetch", `获取 ${remoteName}`, project.path, (operationId) =>
      desktopBridge().fetchRemote(repositoryTarget(project), remoteName, prune, { operationId })
    );
  },

  async getProjectLibrary(): Promise<ProjectLibraryState> {
    if (window.gitUI) {
      return window.gitUI.getProjectLibrary();
    }
    await wait(mockDelay);
    return { groups: browserProjectLibrary.groups.map((group) => ({ ...group })), recentProjectIds: [...browserProjectLibrary.recentProjectIds] };
  },

  async createProjectGroup(name: string): Promise<ProjectGroup> {
    if (window.gitUI) {
      return window.gitUI.createProjectGroup(name);
    }
    const group = { id: crypto.randomUUID(), name: name.trim(), sortOrder: browserProjectLibrary.groups.length };
    browserProjectLibrary = { ...browserProjectLibrary, groups: [...browserProjectLibrary.groups, group] };
    return group;
  },

  async renameProjectGroup(groupId: string, name: string): Promise<ProjectGroup> {
    if (window.gitUI) {
      return window.gitUI.renameProjectGroup(groupId, name);
    }
    const group = browserProjectLibrary.groups.find((item) => item.id === groupId);
    if (!group) {
      throw new Error("项目分组不存在。");
    }
    const renamed = { ...group, name: name.trim() };
    browserProjectLibrary = { ...browserProjectLibrary, groups: browserProjectLibrary.groups.map((item) => item.id === groupId ? renamed : item) };
    return renamed;
  },

  async deleteProjectGroup(groupId: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.deleteProjectGroup(groupId);
    }
    const exists = browserProjectLibrary.groups.some((group) => group.id === groupId);
    browserProjectLibrary = { ...browserProjectLibrary, groups: browserProjectLibrary.groups.filter((group) => group.id !== groupId) };
    mockProjects.forEach((project) => { if (project.groupId === groupId) project.groupId = undefined; });
    return exists;
  },

  async setProjectGroup(projectId: string, groupId?: string): Promise<GitProject> {
    if (window.gitUI) {
      return window.gitUI.setProjectGroup(projectId, groupId);
    }
    const project = mockProjects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在。");
    }
    project.groupId = groupId;
    return { ...project };
  },

  async markProjectOpened(projectId: string): Promise<GitProject> {
    if (window.gitUI) {
      return window.gitUI.markProjectOpened(projectId);
    }
    const project = mockProjects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在。");
    }
    project.lastOpenedAt = new Date().toISOString();
    browserProjectLibrary = { ...browserProjectLibrary, recentProjectIds: [projectId, ...browserProjectLibrary.recentProjectIds.filter((id) => id !== projectId)] };
    return { ...project };
  },

  async removeRecentProject(projectId: string): Promise<boolean> {
    if (window.gitUI) {
      return window.gitUI.removeRecentProject(projectId);
    }
    const exists = browserProjectLibrary.recentProjectIds.includes(projectId);
    browserProjectLibrary = { ...browserProjectLibrary, recentProjectIds: browserProjectLibrary.recentProjectIds.filter((id) => id !== projectId) };
    return exists;
  },

  async getUiPreferences(): Promise<UiPreferences> {
    if (window.gitUI) {
      return window.gitUI.getUiPreferences();
    }
    return { ...browserUiPreferences, shortcuts: { ...browserUiPreferences.shortcuts } };
  },

  async updateUiPreferences(input: Partial<UiPreferences>): Promise<UiPreferences> {
    if (window.gitUI) {
      return window.gitUI.updateUiPreferences(input);
    }
    const rightPanelWidth = input.rightPanelWidth === undefined
      ? browserUiPreferences.rightPanelWidth
      : Math.min(720, Math.max(400, input.rightPanelWidth));
    browserUiPreferences = {
      ...browserUiPreferences,
      ...input,
      rightPanelWidth,
      shortcuts: input.shortcuts ? { ...browserUiPreferences.shortcuts, ...input.shortcuts } : browserUiPreferences.shortcuts
    };
    return { ...browserUiPreferences, shortcuts: { ...browserUiPreferences.shortcuts } };
  },

  async initializeRepository(directoryPath: string, initialBranch: string, createGitignore: boolean): Promise<RepositoryCreationResult> {
    return desktopBridge().initializeRepository(directoryPath, initialBranch, createGitignore);
  },

  async cloneRepository(sourceUrl: string, destinationPath: string, options: GitCloneOptions): Promise<RepositoryCreationResult> {
    const operationId = beginGitOperation("clone", "克隆仓库", destinationPath);
    try {
      const result = await desktopBridge().cloneRepository(sourceUrl, destinationPath, options, { operationId });
      finishGitOperation(operationId, result.result.ok, result.result.messageZh);
      return result;
    } catch (error) {
      finishGitOperation(operationId, false, errorMessage(error));
      throw error;
    }
  },

  async getStashes(project: GitProject): Promise<GitStashEntry[]> {
    return desktopBridge().getStashes(repositoryTarget(project));
  },

  async getStashDetails(project: GitProject, selector: string): Promise<GitStashDetails> {
    return desktopBridge().getStashDetails(repositoryTarget(project), selector);
  },

  async createStash(project: GitProject, options: GitStashCreateOptions): Promise<GitOperationResult> {
    return desktopBridge().createStash(repositoryTarget(project), options);
  },

  async applyStash(project: GitProject, selector: string, restoreIndex = false): Promise<GitOperationResult> {
    return desktopBridge().applyStash(repositoryTarget(project), selector, restoreIndex);
  },

  async popStash(project: GitProject, selector: string, restoreIndex = false): Promise<GitOperationResult> {
    return desktopBridge().popStash(repositoryTarget(project), selector, restoreIndex);
  },

  async dropStash(project: GitProject, selector: string): Promise<GitOperationResult> {
    return desktopBridge().dropStash(repositoryTarget(project), selector);
  },

  async getRemotes(project: GitProject): Promise<GitRemoteInfo[]> {
    return desktopBridge().getRemotes(repositoryTarget(project));
  },

  async addRemote(project: GitProject, name: string, fetchUrl: string, pushUrl?: string): Promise<GitOperationResult> {
    return desktopBridge().addRemote(repositoryTarget(project), name, fetchUrl, pushUrl);
  },

  async updateRemote(project: GitProject, currentName: string, input: GitRemoteUpdateInput): Promise<GitOperationResult> {
    return desktopBridge().updateRemote(repositoryTarget(project), currentName, input);
  },

  async removeRemote(project: GitProject, name: string): Promise<GitOperationResult> {
    return desktopBridge().removeRemote(repositoryTarget(project), name);
  },

  async setBranchUpstream(project: GitProject, branchName: string, upstream: string): Promise<GitOperationResult> {
    return desktopBridge().setBranchUpstream(repositoryTarget(project), branchName, upstream);
  },

  async unsetBranchUpstream(project: GitProject, branchName: string): Promise<GitOperationResult> {
    return desktopBridge().unsetBranchUpstream(repositoryTarget(project), branchName);
  },

  async setDefaultRemote(project: GitProject, remoteName: string, role: "fetch" | "push", branchName?: string): Promise<GitOperationResult> {
    return desktopBridge().setDefaultRemote(repositoryTarget(project), remoteName, role, branchName);
  },

  async startRebase(project: GitProject, upstream: string, onto?: string): Promise<GitOperationResult> {
    return desktopBridge().startRebase(repositoryTarget(project), upstream, onto);
  },

  async getRebasePlan(project: GitProject, upstream: string): Promise<GitRebasePlanItem[]> {
    return desktopBridge().getRebasePlan(repositoryTarget(project), upstream);
  },

  async startInteractiveRebase(project: GitProject, upstream: string, plan: GitRebasePlanItem[], onto?: string): Promise<GitOperationResult> {
    return desktopBridge().startInteractiveRebase(repositoryTarget(project), upstream, plan, onto);
  },

  async continueRebase(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().continueRebase(repositoryTarget(project));
  },

  async skipRebase(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().skipRebase(repositoryTarget(project));
  },

  async abortRebase(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().abortRebase(repositoryTarget(project));
  },

  async continueCherryPick(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().continueCherryPick(repositoryTarget(project));
  },

  async skipCherryPick(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().skipCherryPick(repositoryTarget(project));
  },

  async abortCherryPick(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().abortCherryPick(repositoryTarget(project));
  },

  async continueRevert(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().continueRevert(repositoryTarget(project));
  },

  async skipRevert(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().skipRevert(repositoryTarget(project));
  },

  async abortRevert(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().abortRevert(repositoryTarget(project));
  },

  async resetBisect(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().resetBisect(repositoryTarget(project));
  },

  async startBisect(project: GitProject, badRef?: string, goodRef?: string): Promise<GitOperationResult> {
    return desktopBridge().startBisect(repositoryTarget(project), badRef, goodRef);
  },

  async markBisectGood(project: GitProject, ref?: string): Promise<GitOperationResult> {
    return desktopBridge().markBisectGood(repositoryTarget(project), ref);
  },

  async markBisectBad(project: GitProject, ref?: string): Promise<GitOperationResult> {
    return desktopBridge().markBisectBad(repositoryTarget(project), ref);
  },

  async skipBisect(project: GitProject, refs?: string[]): Promise<GitOperationResult> {
    return desktopBridge().skipBisect(repositoryTarget(project), refs);
  },

  async showCommitSignature(project: GitProject, revision: string): Promise<GitOperationResult> {
    return desktopBridge().showCommitSignature(repositoryTarget(project), revision);
  },

  async verifyCommitSignature(project: GitProject, revision: string): Promise<GitOperationResult> {
    return desktopBridge().verifyCommitSignature(repositoryTarget(project), revision);
  },

  async renameBranch(project: GitProject, branchName: string, nextName: string, force = false): Promise<GitOperationResult> {
    return desktopBridge().renameBranch(repositoryTarget(project), branchName, nextName, force);
  },

  async deleteRemoteBranch(project: GitProject, remoteName: string, branchName: string): Promise<GitOperationResult> {
    return desktopBridge().deleteRemoteBranch(repositoryTarget(project), remoteName, branchName);
  },

  async getTags(project: GitProject): Promise<GitTagInfo[]> {
    return desktopBridge().getTags(repositoryTarget(project));
  },

  async createTag(project: GitProject, name: string, target: string, message?: string): Promise<GitOperationResult> {
    return desktopBridge().createTag(repositoryTarget(project), name, target, message);
  },

  async deleteTag(project: GitProject, name: string): Promise<GitOperationResult> {
    return desktopBridge().deleteTag(repositoryTarget(project), name);
  },

  async pushTag(project: GitProject, remoteName: string, name: string): Promise<GitOperationResult> {
    return desktopBridge().pushTag(repositoryTarget(project), remoteName, name);
  },

  async deleteRemoteTag(project: GitProject, remoteName: string, name: string): Promise<GitOperationResult> {
    return desktopBridge().deleteRemoteTag(repositoryTarget(project), remoteName, name);
  },

  async getReflog(project: GitProject, maxCount = 100): Promise<GitReflogEntry[]> {
    return desktopBridge().getReflog(repositoryTarget(project), maxCount);
  },

  async resetToReflogEntry(project: GitProject, selector: string, mode: "mixed" | "hard"): Promise<GitOperationResult> {
    return desktopBridge().resetToReflogEntry(repositoryTarget(project), selector, mode);
  },

  async getLinkedWorktrees(project: GitProject): Promise<GitLinkedWorktree[]> {
    return desktopBridge().getLinkedWorktrees(repositoryTarget(project));
  },

  async addLinkedWorktree(project: GitProject, options: GitWorktreeAddOptions): Promise<GitOperationResult> {
    return desktopBridge().addLinkedWorktree(repositoryTarget(project), options);
  },

  async removeLinkedWorktree(project: GitProject, worktreePath: string, force = false): Promise<GitOperationResult> {
    return desktopBridge().removeLinkedWorktree(repositoryTarget(project), worktreePath, force);
  },

  async pruneLinkedWorktrees(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().pruneLinkedWorktrees(repositoryTarget(project));
  },

  async lockLinkedWorktree(project: GitProject, worktreePath: string, reason?: string): Promise<GitOperationResult> {
    return desktopBridge().lockLinkedWorktree(repositoryTarget(project), worktreePath, reason);
  },

  async unlockLinkedWorktree(project: GitProject, worktreePath: string): Promise<GitOperationResult> {
    return desktopBridge().unlockLinkedWorktree(repositoryTarget(project), worktreePath);
  },

  async moveLinkedWorktree(project: GitProject, options: GitWorktreeMoveOptions): Promise<GitOperationResult> {
    return desktopBridge().moveLinkedWorktree(repositoryTarget(project), options);
  },

  async repairLinkedWorktrees(project: GitProject, worktreePaths: string[] = []): Promise<GitOperationResult> {
    return desktopBridge().repairLinkedWorktrees(repositoryTarget(project), worktreePaths);
  },

  async getSubmodules(project: GitProject): Promise<GitSubmoduleInfo[]> {
    return desktopBridge().getSubmodules(repositoryTarget(project));
  },

  async initializeSubmodules(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().initializeSubmodules(repositoryTarget(project));
  },

  async updateSubmodules(project: GitProject, options: GitSubmoduleUpdateOptions): Promise<GitOperationResult> {
    return desktopBridge().updateSubmodules(repositoryTarget(project), options);
  },

  async syncSubmodules(project: GitProject, recursive = true): Promise<GitOperationResult> {
    return desktopBridge().syncSubmodules(repositoryTarget(project), recursive);
  },

  async addSubmodule(project: GitProject, options: GitSubmoduleAddOptions): Promise<GitOperationResult> {
    return desktopBridge().addSubmodule(repositoryTarget(project), options);
  },

  async setSubmoduleBranch(project: GitProject, modulePath: string, branch?: string): Promise<GitOperationResult> {
    return desktopBridge().setSubmoduleBranch(repositoryTarget(project), modulePath, branch);
  },

  async deinitializeSubmodule(project: GitProject, modulePath: string, force = false): Promise<GitOperationResult> {
    return desktopBridge().deinitializeSubmodule(repositoryTarget(project), modulePath, force);
  },

  async removeSubmodule(project: GitProject, modulePath: string, force = false): Promise<GitOperationResult> {
    return desktopBridge().removeSubmodule(repositoryTarget(project), modulePath, force);
  },

  async getLfsStatus(project: GitProject): Promise<GitLfsStatus> {
    return desktopBridge().getLfsStatus(repositoryTarget(project));
  },

  async installLfs(project: GitProject, scope: "local" | "global" = "local"): Promise<GitOperationResult> {
    return desktopBridge().installLfs(repositoryTarget(project), scope);
  },

  async pullLfs(project: GitProject, remoteName?: string, refs?: string[]): Promise<GitOperationResult> {
    return runTrackedGitOperation("lfs-pull", "拉取 LFS 对象", project.path, (operationId) =>
      desktopBridge().pullLfs(repositoryTarget(project), remoteName, refs, { operationId })
    );
  },

  async pruneLfs(project: GitProject): Promise<GitOperationResult> {
    return desktopBridge().pruneLfs(repositoryTarget(project));
  },

  async trackLfsPatterns(project: GitProject, patterns: string[]): Promise<GitOperationResult> {
    return desktopBridge().trackLfsPatterns(repositoryTarget(project), patterns);
  },

  async untrackLfsPatterns(project: GitProject, patterns: string[]): Promise<GitOperationResult> {
    return desktopBridge().untrackLfsPatterns(repositoryTarget(project), patterns);
  },

  async getLfsLocks(project: GitProject): Promise<GitLfsLock[]> {
    return desktopBridge().getLfsLocks(repositoryTarget(project));
  },

  async lockLfsFile(project: GitProject, filePath: string): Promise<GitOperationResult> {
    return desktopBridge().lockLfsFile(repositoryTarget(project), filePath);
  },

  async unlockLfsFile(project: GitProject, lockId: string, force = false): Promise<GitOperationResult> {
    return desktopBridge().unlockLfsFile(repositoryTarget(project), lockId, force);
  },

  async migrateLfs(project: GitProject, options: GitLfsMigrateOptions): Promise<GitOperationResult> {
    const operationId = beginGitOperation("lfs-migrate", "迁移 LFS 历史", project.path);
    try {
      const result = await desktopBridge().migrateLfs(repositoryTarget(project), options, { operationId });
      finishGitOperation(operationId, result.ok, result.messageZh);
      return result;
    } catch (error) {
      finishGitOperation(operationId, false, errorMessage(error));
      throw error;
    }
  },

  async readGitIgnore(project: GitProject): Promise<GitIgnoreDocument> {
    return desktopBridge().readGitIgnore(repositoryTarget(project));
  },

  async writeGitIgnore(project: GitProject, content: string, expectedRevision: string): Promise<boolean> {
    return desktopBridge().writeGitIgnore(repositoryTarget(project), content, expectedRevision);
  },

  async getSigningConfig(project: GitProject): Promise<GitSigningConfig> {
    return desktopBridge().getSigningConfig(repositoryTarget(project));
  },

  async setSigningConfig(project: GitProject, input: GitSigningConfigUpdate): Promise<GitOperationResult> {
    return desktopBridge().setSigningConfig(repositoryTarget(project), input);
  },

  async getGitIdentity(project: GitProject): Promise<GitIdentityConfig> {
    return desktopBridge().getGitIdentity(repositoryTarget(project));
  },

  async setGitIdentity(project: GitProject, input: GitIdentityUpdate): Promise<GitOperationResult> {
    return desktopBridge().setGitIdentity(repositoryTarget(project), input);
  },

  async getHostingLinks(project: GitProject, remoteName: string, commitHash?: string, branchName?: string): Promise<GitHostingLinks> {
    return desktopBridge().getHostingLinks(repositoryTarget(project), remoteName, commitHash, branchName);
  },

  async listHostingAccounts(): Promise<GitHostingAccountSummary[]> {
    return desktopBridge().listHostingAccounts();
  },

  async saveHostingAccount(provider: GitHostingProvider, remoteUrl: string, token: string): Promise<GitHostingAccountSummary> {
    return desktopBridge().saveHostingAccount(provider, remoteUrl, token);
  },

  async removeHostingAccount(provider: GitHostingProvider, host: string): Promise<boolean> {
    return desktopBridge().removeHostingAccount(provider, host);
  },

  async listHostingChangeRequests(provider: GitHostingProvider, remoteUrl: string): Promise<GitHostingChangeRequest[]> {
    return desktopBridge().listHostingChangeRequests(provider, remoteUrl);
  },

  async getHostingChangeRequest(provider: GitHostingProvider, remoteUrl: string, number: number): Promise<GitHostingChangeRequest> {
    return desktopBridge().getHostingChangeRequest(provider, remoteUrl, number);
  },

  async createHostingChangeRequest(
    provider: GitHostingProvider,
    remoteUrl: string,
    input: GitHostingCreateChangeInput
  ): Promise<GitHostingChangeRequest> {
    return desktopBridge().createHostingChangeRequest(provider, remoteUrl, input);
  },

  async commentHostingChangeRequest(provider: GitHostingProvider, remoteUrl: string, number: number, body: string): Promise<boolean> {
    return desktopBridge().commentHostingChangeRequest(provider, remoteUrl, number, body);
  },

  async reviewHostingChangeRequest(
    provider: GitHostingProvider,
    remoteUrl: string,
    input: GitHostingReviewInput
  ): Promise<boolean> {
    return desktopBridge().reviewHostingChangeRequest(provider, remoteUrl, input);
  },

  async mergeHostingChangeRequest(
    provider: GitHostingProvider,
    remoteUrl: string,
    input: GitHostingMergeInput
  ): Promise<boolean> {
    return desktopBridge().mergeHostingChangeRequest(provider, remoteUrl, input);
  }
};

async function runTrackedGitOperation(
  kind: GitLongOperationKind,
  label: string,
  repositoryPath: string,
  run: (operationId: string) => Promise<GitOperationResult>
): Promise<GitOperationResult> {
  const operationId = beginGitOperation(kind, label, repositoryPath);
  try {
    const result = await run(operationId);
    finishGitOperation(operationId, result.ok, result.messageZh ?? (result.ok ? "已完成" : result.stderr.trim() || "执行失败"));
    return result;
  } catch (error) {
    finishGitOperation(operationId, false, errorMessage(error));
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repositoryTarget(project: GitProject): RepositoryTarget {
  if (project.remote?.connectionEnabled === false) {
    throw new Error("远程连接已暂停，请先开启连接。");
  }
  return {
    path: project.path,
    remote: project.remote
  };
}

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

function desktopBridge() {
  if (!window.gitUI) {
    throw new Error("该仓库能力只在桌面应用中可用。");
  }
  return window.gitUI;
}
