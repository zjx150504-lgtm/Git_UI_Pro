import type { ChangedFile, CommitNode, GitHistoryRef } from "../types/domain";

export interface GraphRegressionScenario {
  id: string;
  title: string;
  description: string;
  commits: CommitNode[];
  historyRefs: GitHistoryRef[];
  expectations: string[];
}

const baseDate = "2026-07-06 10:00";

function file(path: string, status: ChangedFile["status"] = "modified"): ChangedFile {
  return { path, status, staged: false };
}

function commit(input: {
  hash: string;
  parents: string[];
  subject: string;
  author?: string;
  refs?: CommitNode["refs"];
  files?: ChangedFile[];
  lane?: number;
}): CommitNode {
  return {
    hash: input.hash,
    shortHash: input.hash.slice(0, 7),
    parents: input.parents,
    subject: input.subject,
    authorName: input.author ?? "Regression Bot",
    authorEmail: "regression@example.com",
    authorDate: baseDate,
    committerName: input.author ?? "Regression Bot",
    committerEmail: "regression@example.com",
    committerDate: baseDate,
    refs: input.refs ?? [],
    lane: input.lane ?? 0,
    color: "#51c2a9",
    files: input.files ?? []
  };
}

export const graphRegressionScenarios: GraphRegressionScenario[] = [
  {
    id: "linear-current-remote-tag",
    title: "线性历史 + 当前分支 + 远程 + 标签",
    description: "验证基础直线、HEAD、本地分支、远程分支和标签在同一条线上时的显示。",
    commits: [
      commit({
        hash: "1000000000000000000000000000000000000001",
        parents: ["1000000000000000000000000000000000000002"],
        subject: "feat: 完成当前分支提交",
        refs: [
          { type: "head", name: "HEAD" },
          { type: "localBranch", name: "master" },
          { type: "remoteBranch", name: "origin/master" }
        ],
        files: [file("src/App.tsx"), file("src/styles/app.css")]
      }),
      commit({
        hash: "1000000000000000000000000000000000000002",
        parents: ["1000000000000000000000000000000000000003"],
        subject: "docs: 更新 README",
        refs: [{ type: "tag", name: "v1.0.0" }],
        files: [file("README.md")]
      }),
      commit({
        hash: "1000000000000000000000000000000000000003",
        parents: [],
        subject: "chore: 初始化仓库",
        files: [file("package.json", "added")]
      })
    ],
    historyRefs: [
      { id: "refs/heads/master", name: "master", type: "branch", revision: "1000000000000000000000000000000000000001", category: "branches", current: true },
      {
        id: "refs/remotes/origin/master",
        name: "origin/master",
        type: "remoteBranch",
        revision: "1000000000000000000000000000000000000001",
        category: "remote branches",
        upstream: true
      },
      { id: "refs/tags/v1.0.0", name: "v1.0.0", type: "tag", revision: "1000000000000000000000000000000000000002", category: "tags" }
    ],
    expectations: ["主线垂直且无多余偏移", "当前分支和远程分支标签颜色不同", "展开第一条提交后文件不遮挡主线"]
  },
  {
    id: "merge-with-expanded-files",
    title: "二父合并 + 展开文件",
    description: "验证合并弧线和展开文件内部延长线的连接位置。",
    commits: [
      commit({
        hash: "2000000000000000000000000000000000000001",
        parents: ["2000000000000000000000000000000000000002", "2000000000000000000000000000000000000004"],
        subject: "Merge branch 'feature/sidebar'",
        refs: [
          { type: "head", name: "HEAD" },
          { type: "localBranch", name: "dev" }
        ],
        files: [file("src/components/GraphSidebar.tsx"), file("src/styles/app.css"), file("docs/GRAPH_REGRESSION.md", "added")]
      }),
      commit({
        hash: "2000000000000000000000000000000000000002",
        parents: ["2000000000000000000000000000000000000003"],
        subject: "fix(graph): 调整主线节点",
        files: [file("src/components/GraphSidebar.tsx")]
      }),
      commit({
        hash: "2000000000000000000000000000000000000004",
        parents: ["2000000000000000000000000000000000000003"],
        subject: "feat(graph): 添加侧栏交互",
        refs: [{ type: "remoteBranch", name: "origin/feature/sidebar" }],
        files: [file("src/components/ProjectRail.tsx"), file("src/components/GraphSidebar.tsx")]
      }),
      commit({
        hash: "2000000000000000000000000000000000000003",
        parents: ["2000000000000000000000000000000000000005"],
        subject: "style(ui): 统一面板间距",
        files: [file("src/styles/app.css")]
      }),
      commit({
        hash: "2000000000000000000000000000000000000005",
        parents: [],
        subject: "chore: 基线提交",
        files: [file("package-lock.json")]
      })
    ],
    historyRefs: [
      { id: "refs/heads/dev", name: "dev", type: "branch", revision: "2000000000000000000000000000000000000001", category: "branches", current: true },
      {
        id: "refs/remotes/origin/feature/sidebar",
        name: "origin/feature/sidebar",
        type: "remoteBranch",
        revision: "2000000000000000000000000000000000000004",
        category: "remote branches"
      }
    ],
    expectations: ["合并弧线连接到节点右侧中点", "展开文件时支线不中断", "文件列表有足够缩进不压住分支线"]
  },
  {
    id: "diverged-local-remote",
    title: "本地与远程分歧",
    description: "验证本地 ahead 和远程 behind 同屏时的颜色、标签和线条收束。",
    commits: [
      commit({
        hash: "3000000000000000000000000000000000000001",
        parents: ["3000000000000000000000000000000000000003"],
        subject: "feat(local): 本地新增设置项",
        refs: [
          { type: "head", name: "HEAD" },
          { type: "localBranch", name: "feature/settings" }
        ],
        files: [file("src/components/TopBar.tsx")]
      }),
      commit({
        hash: "3000000000000000000000000000000000000002",
        parents: ["3000000000000000000000000000000000000003"],
        subject: "fix(remote): 远程修复默认配置",
        refs: [{ type: "remoteBranch", name: "origin/feature/settings" }],
        files: [file("electron/configStore.ts")]
      }),
      commit({
        hash: "3000000000000000000000000000000000000003",
        parents: ["3000000000000000000000000000000000000004"],
        subject: "feat(settings): 配置存储基线",
        files: [file("electron/configStore.ts"), file("src/App.tsx")]
      }),
      commit({
        hash: "3000000000000000000000000000000000000004",
        parents: [],
        subject: "Initial commit",
        files: [file("README.md", "added")]
      })
    ],
    historyRefs: [
      {
        id: "refs/heads/feature/settings",
        name: "feature/settings",
        type: "branch",
        revision: "3000000000000000000000000000000000000001",
        category: "branches",
        current: true
      },
      {
        id: "refs/remotes/origin/feature/settings",
        name: "origin/feature/settings",
        type: "remoteBranch",
        revision: "3000000000000000000000000000000000000002",
        category: "remote branches",
        upstream: true
      }
    ],
    expectations: ["本地分支节点使用蓝色系", "远程分支节点使用紫色系", "两条线在共同祖先处自然收束"]
  },
  {
    id: "octopus-merge-and-long-files",
    title: "多父合并 + 长文件列表",
    description: "验证三父合并、多条支线和长文件列表展开后的滚动与缩进。",
    commits: [
      commit({
        hash: "4000000000000000000000000000000000000001",
        parents: [
          "4000000000000000000000000000000000000002",
          "4000000000000000000000000000000000000003",
          "4000000000000000000000000000000000000004"
        ],
        subject: "Merge branches 'api', 'ui' and 'docs'",
        refs: [{ type: "localBranch", name: "integration" }],
        files: [
          file("app/core/api.ts"),
          file("app/ui/panel.tsx"),
          file("docs/usage.md"),
          file("scripts/build.ts"),
          file("package.json"),
          file("package-lock.json"),
          file("src/styles/app.css")
        ]
      }),
      commit({ hash: "4000000000000000000000000000000000000002", parents: ["4000000000000000000000000000000000000005"], subject: "feat(api): 添加分页接口" }),
      commit({ hash: "4000000000000000000000000000000000000003", parents: ["4000000000000000000000000000000000000005"], subject: "feat(ui): 添加结果面板" }),
      commit({ hash: "4000000000000000000000000000000000000004", parents: ["4000000000000000000000000000000000000005"], subject: "docs: 更新接口说明" }),
      commit({ hash: "4000000000000000000000000000000000000005", parents: [], subject: "chore: 集成基线" })
    ],
    historyRefs: [
      { id: "refs/heads/integration", name: "integration", type: "branch", revision: "4000000000000000000000000000000000000001", category: "branches" },
      { id: "refs/heads/api", name: "api", type: "branch", revision: "4000000000000000000000000000000000000002", category: "branches" },
      { id: "refs/heads/ui", name: "ui", type: "branch", revision: "4000000000000000000000000000000000000003", category: "branches" },
      { id: "refs/heads/docs", name: "docs", type: "branch", revision: "4000000000000000000000000000000000000004", category: "branches" }
    ],
    expectations: ["多父合并不会产生多余竖线", "展开长文件列表后线条仍垂直", "文件名列不遮挡第三条及之后的分支线"]
  }
];
