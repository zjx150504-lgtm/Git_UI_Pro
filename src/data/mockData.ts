import type { CommitNode, DiffLine, GitProject } from "../types/domain";

export const mockProjects: GitProject[] = [
  {
    id: "project-main",
    name: "Git UI Pro",
    path: "E:\\Projects\\Git-UI-Pro",
    groupId: "personal",
    favorite: true,
    lastOpenedAt: "2026-07-02T07:20:00.000Z",
    createdAt: "2026-07-02T07:20:00.000Z",
    updatedAt: "2026-07-02T07:20:00.000Z",
    status: {
      currentBranch: "master",
      upstream: "origin/master",
      ahead: 1,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 1,
      untrackedCount: 3,
      hasConflicts: false
    }
  },
  {
    id: "project-work",
    name: "Order Platform",
    path: "D:\\Work\\order-platform",
    groupId: "work",
    favorite: false,
    lastOpenedAt: "2026-06-30T10:10:00.000Z",
    createdAt: "2026-06-08T03:00:00.000Z",
    updatedAt: "2026-06-30T10:10:00.000Z",
    status: {
      currentBranch: "release/2.4",
      upstream: "origin/release/2.4",
      ahead: 2,
      behind: 1,
      stagedCount: 0,
      unstagedCount: 1,
      untrackedCount: 0,
      hasConflicts: true,
      operationState: "merge",
      mergeSourceBranch: "feature/invoice-flow",
      mergeTargetBranch: "release/2.4"
    }
  },
  {
    id: "project-client",
    name: "Client Admin",
    path: "D:\\Clients\\client-admin",
    groupId: "client",
    favorite: true,
    lastOpenedAt: "2026-06-28T12:30:00.000Z",
    createdAt: "2026-05-12T09:00:00.000Z",
    updatedAt: "2026-06-28T12:30:00.000Z",
    status: {
      currentBranch: "release/2.4",
      upstream: "origin/release/2.4",
      ahead: 0,
      behind: 3,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      hasConflicts: false
    }
  }
];

export const mockCommits: CommitNode[] = [
  {
    hash: "a70f6d55e8f69db719d871f4d6c19a6d71e09751",
    shortHash: "a70f6d5",
    parents: ["b13c48e"],
    subject: "新增 PRD 文档和 MVP 阶段拆分",
    body: "补充页面结构、数据结构、Git 命令映射和验收标准。",
    authorName: "zjx_master",
    authorEmail: "zjx@example.com",
    authorDate: "2026-07-02 15:20",
    committerName: "zjx_master",
    committerEmail: "zjx@example.com",
    committerDate: "2026-07-02 15:20",
    lane: 0,
    color: "#51c2a9",
    refs: [
      { type: "head", name: "HEAD" },
      { type: "localBranch", name: "master" },
      { type: "remoteBranch", name: "origin/master" }
    ],
    files: [
      { path: "docs/PRD.md", status: "added", staged: false },
      { path: "package.json", status: "added", staged: false }
    ]
  },
  {
    hash: "b13c48e6d2fa30776e39294f43f7d14f8408d03a",
    shortHash: "b13c48e",
    parents: ["8f6a921", "29d30d1"],
    subject: "合并项目扫描与收藏筛选",
    body: "项目栏支持按关键字搜索，并保留最近打开状态。",
    authorName: "Li Ming",
    authorEmail: "li.ming@example.com",
    authorDate: "2026-07-01 18:42",
    committerName: "Li Ming",
    committerEmail: "li.ming@example.com",
    committerDate: "2026-07-01 18:45",
    lane: 0,
    color: "#51c2a9",
    refs: [{ type: "tag", name: "v0.1-prd" }],
    files: [
      { path: "src/components/ProjectSidebar.tsx", status: "modified", staged: false },
      { path: "src/api/projects.ts", status: "modified", staged: false }
    ]
  },
  {
    hash: "29d30d1c5baf4edaf22111c99e944b671808d5e1",
    shortHash: "29d30d1",
    parents: ["8f6a921"],
    subject: "实现目录扫描排除规则",
    authorName: "Chen Qiao",
    authorEmail: "chen.qiao@example.com",
    authorDate: "2026-07-01 14:07",
    committerName: "Chen Qiao",
    committerEmail: "chen.qiao@example.com",
    committerDate: "2026-07-01 14:07",
    lane: 1,
    color: "#7aa7ff",
    refs: [{ type: "localBranch", name: "feature/project-scan" }],
    files: [{ path: "electron/gitService.ts", status: "modified", staged: false }]
  },
  {
    hash: "8f6a921dde1006c956194bc086f9f4f9f5c8d212",
    shortHash: "8f6a921",
    parents: ["5ac0c32"],
    subject: "搭建 Electron 和 React 主布局",
    authorName: "zjx_master",
    authorEmail: "zjx@example.com",
    authorDate: "2026-06-30 21:18",
    committerName: "zjx_master",
    committerEmail: "zjx@example.com",
    committerDate: "2026-06-30 21:18",
    lane: 0,
    color: "#51c2a9",
    refs: [],
    files: [
      { path: "src/App.tsx", status: "added", staged: false },
      { path: "src/styles/app.css", status: "added", staged: false }
    ]
  },
  {
    hash: "5ac0c327d4c0157ceecf651701726f18e6112219",
    shortHash: "5ac0c32",
    parents: [],
    subject: "初始化产品仓库",
    authorName: "zjx_master",
    authorEmail: "zjx@example.com",
    authorDate: "2026-06-29 09:30",
    committerName: "zjx_master",
    committerEmail: "zjx@example.com",
    committerDate: "2026-06-29 09:30",
    lane: 0,
    color: "#51c2a9",
    refs: [],
    files: [{ path: "README.md", status: "added", staged: false }]
  }
];

export const mockDiffLines: DiffLine[] = [
  { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "# Git UI Pro PRD：独立版中文 Git Graph + 多项目管理器" },
  { type: "context", oldLineNumber: 2, newLineNumber: 2, content: "" },
  { type: "add", newLineNumber: 3, content: "版本：v0.1" },
  { type: "add", newLineNumber: 4, content: "日期：2026-07-02" },
  { type: "context", oldLineNumber: 3, newLineNumber: 5, content: "" },
  { type: "delete", oldLineNumber: 4, content: "目标：Git 桌面客户端" },
  { type: "add", newLineNumber: 6, content: "目标：中文桌面 Git 可视化管理软件" }
];

