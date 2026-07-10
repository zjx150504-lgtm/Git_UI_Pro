# Git UI Pro PRD：独立版中文 Git Graph + 多项目管理器

版本：v0.1  
日期：2026-07-02  
状态：需求草案  
目标平台：Windows / macOS / Linux 桌面端  
默认语言：中文

## 1. 产品定位

Git UI Pro 是一款中文桌面 Git 可视化管理软件。产品核心不是替代命令行 Git，而是通过图形界面帮助用户查看项目历史、理解分支关系、处理常见 Git 操作，并管理多个本地 Git 项目。

产品体验参考 Codex 的工作区布局：左侧项目导航，中间主工作区，右侧详情面板，底部辅助控制台。

## 2. 目标用户

- 同时维护多个 Git 项目的开发者。
- 不希望频繁输入 Git 命令，但需要清晰理解分支、提交、合并历史的用户。
- 需要比 GitHub Desktop 更强的提交图、分支操作和本地项目管理能力，但不想使用过重商业 Git 工具的用户。

## 3. 产品目标

### 3.1 MVP 目标

- 支持多项目添加、搜索、切换和基础分组。
- 用中文界面展示 Git 项目的状态、历史图、提交详情和文件 diff。
- 支持工作区改动查看、stage / unstage、提交。
- 支持 fetch、pull、push。
- 支持基础分支操作：新建、切换、删除。
- 提供简单底部控制台作为辅助能力。
- 对危险操作提供中文确认，对 Git 错误提供可理解的中文提示和原始输出展开。

### 3.2 非目标

- 不重新实现 Git 内核，所有 Git 行为调用本机 `git` 命令。
- 不自动替用户决定冲突结果；内置三方冲突解决器只提供内容对比、选择、编辑和暂存能力。
- MVP 不做复杂终端管理、智能命令解析和自动补全。
- MVP 不做完整远程仓库管理，remote 管理先只读。
- MVP 不做 rebase、cherry-pick、revert、reset 的完整图形操作。

## 4. 技术边界

推荐技术栈：

- 桌面壳：Electron
- 前端：React + TypeScript
- 终端：xterm.js + node-pty
- Git 调用：自封装 Git CLI 层，或在底层使用 simple-git 并保留原始命令输出
- 本地配置：SQLite 或 JSON，MVP 可先使用 JSON，后续迁移 SQLite
- 提交图渲染：SVG 或 Canvas，MVP 可优先 SVG，后续按大仓库性能改为 Canvas / 虚拟滚动

关键原则：

- 使用用户本机 Git 配置、SSH key、Git Credential Manager 和 credential helper。
- Git 操作需要保留原始 stdout / stderr，供错误详情展开。
- 所有破坏性操作必须先在 UI 中二次确认。

## 5. 信息架构

主窗口由五个区域组成：

1. 顶部操作栏
2. 左侧项目栏
3. 中间主工作区
4. 右侧详情面板
5. 底部控制台

### 5.1 顶部操作栏

放置当前项目的高频操作：

- `fetch`
- `pull`
- `push`
- 新建分支
- 切换分支
- 提交
- 暂存
- 合并
- 变基
- 标签

MVP 只启用：

- `fetch`
- `pull`
- `push`
- 新建分支
- 切换分支
- 删除分支
- 提交
- 合并

未进入 MVP 的按钮可以隐藏，或以禁用状态进入“后续版本”。

### 5.2 左侧项目栏

项目栏用于管理多个本地仓库。

必须显示：

- 项目名称
- 项目路径
- 项目分组
- 当前分支
- 未提交改动数量
- ahead / behind 状态
- 收藏状态
- 最近打开状态

必须支持：

- 添加本地 Git 项目
- 批量扫描目录下的 Git 项目
- 删除项目记录，但不删除本地文件
- 项目分组：工作项目、个人项目、客户项目、自定义分组
- 搜索项目
- 收藏项目
- 最近打开项目
- 点击项目后加载 Git 状态和历史图

### 5.3 中间主工作区

主工作区包含两个主要视图：

- 历史图视图
- 工作区视图

MVP 默认进入历史图视图。

历史图需要显示：

- commit 节点
- 分支线
- merge 线
- 本地分支
- 远程分支
- tag
- HEAD 标识

工作区视图需要显示：

- unstaged 文件列表
- staged 文件列表
- 文件状态：新增、修改、删除、重命名、未跟踪、忽略
- staged / unstaged diff
- 提交信息输入框
- commit 按钮
- amend 选项

### 5.4 右侧详情面板

点击 commit 后显示：

- 提交标题
- 完整提交信息
- 作者
- 提交者
- 提交时间
- commit hash
- 父提交
- 所属本地分支 / 远程分支 / tag
- 变更文件列表
- 文件 diff

MVP diff 模式：

- inline diff

后续 diff 模式：

- side-by-side diff

### 5.5 底部控制台

控制台是辅助功能，不作为核心开发重点。

MVP 支持：

- 在当前项目目录打开 shell
- 执行普通命令
- 切换项目时自动切换工作目录，或为每个项目保留一个终端 session

暂不支持：

- 智能 Git 命令解析
- 自动补全
- 复杂终端布局
- 多终端高级管理

## 6. MVP 功能清单

| 模块 | 功能 | 优先级 | MVP |
| --- | --- | --- | --- |
| 项目管理 | 添加本地 Git 项目 | P0 | 是 |
| 项目管理 | 批量扫描目录下 Git 项目 | P0 | 是 |
| 项目管理 | 删除项目记录但不删除文件 | P0 | 是 |
| 项目管理 | 项目搜索 | P0 | 是 |
| 项目管理 | 最近打开 | P1 | 是 |
| 项目管理 | 收藏项目 | P1 | 是 |
| 项目管理 | 项目分组 | P1 | 是 |
| Git 状态 | 当前分支 | P0 | 是 |
| Git 状态 | 未提交改动数量 | P0 | 是 |
| Git 状态 | ahead / behind | P0 | 是 |
| 历史图 | commit graph | P0 | 是 |
| 历史图 | 本地分支、远程分支、tag、HEAD | P0 | 是 |
| 历史图 | merge commit 关系 | P0 | 是 |
| 历史图 | 按作者、信息、hash 搜索 | P1 | 是 |
| 历史图 | 按分支筛选 | P1 | 是 |
| 历史图 | 时间范围过滤 | P2 | 否 |
| 提交详情 | commit 元信息 | P0 | 是 |
| 提交详情 | 变更文件列表 | P0 | 是 |
| Diff | inline diff | P0 | 是 |
| Diff | side-by-side diff | P2 | 否 |
| 工作区 | staged / unstaged 文件列表 | P0 | 是 |
| 工作区 | stage / unstage 文件 | P0 | 是 |
| 工作区 | commit | P0 | 是 |
| 工作区 | amend | P1 | 是 |
| 工作区 | discard 单文件改动 | P1 | 是 |
| 分支 | 查看本地 / 远程分支 | P0 | 是 |
| 分支 | 新建分支 | P0 | 是 |
| 分支 | 切换分支 | P0 | 是 |
| 分支 | 删除本地分支 | P0 | 是 |
| 分支 | 重命名分支 | P2 | 否 |
| 分支 | 从指定 commit 创建分支 | P1 | 是 |
| 远程 | fetch | P0 | 是 |
| 远程 | pull | P0 | 是 |
| 远程 | push | P0 | 是 |
| 远程 | push 并设置 upstream | P1 | 是 |
| 远程 | 查看 remote 地址 | P1 | 是 |
| Stash | 创建 / 应用 / 删除 stash | P2 | 否 |
| 冲突 | 检测冲突状态 | P1 | 是 |
| 冲突 | 冲突文件列表 | P1 | 是 |
| 控制台 | 当前项目 shell | P1 | 是 |
| 中文化 | 中文界面 | P0 | 是 |
| 中文化 | 中文错误提示 + 原始输出 | P0 | 是 |

## 7. 核心用户流程

### 7.1 添加单个项目

1. 用户点击“添加项目”。
2. 选择一个本地目录。
3. 应用执行 `git rev-parse --show-toplevel` 判断是否为 Git 仓库。
4. 如果是 Git 仓库，读取项目名称、当前分支、remote、状态摘要。
5. 项目加入左侧项目栏。
6. 自动加载该项目历史图。

异常：

- 非 Git 仓库：提示“所选目录不是 Git 仓库”。
- 无权限读取：提示“无法读取该目录，请检查权限”。
- 路径已存在：提示“该项目已添加”。

### 7.2 批量扫描项目

1. 用户点击“扫描目录”。
2. 选择根目录。
3. 应用递归查找包含 `.git` 的目录。
4. 展示扫描结果，默认全选。
5. 用户确认后批量添加。

约束：

- 扫描深度 MVP 默认限制为 4 层。
- 避免进入 `node_modules`、`.cache`、`dist`、`build` 等高成本目录。
- 同一路径去重。

### 7.3 切换项目

1. 用户点击左侧项目。
2. 应用取消当前项目未完成的非关键加载任务。
3. 加载新项目 Git 状态、分支、remote、历史图。
4. 底部控制台切换到新项目路径，或恢复该项目终端 session。
5. 中间主工作区刷新为新项目的历史图。

### 7.4 查看提交详情和 diff

1. 用户点击历史图中的 commit。
2. 右侧详情面板展示 commit 元信息。
3. 读取该 commit 的变更文件列表。
4. 用户点击文件后展示 inline diff。
5. 用户可复制 commit hash。

### 7.5 工作区提交

1. 用户进入工作区视图。
2. 应用展示 staged / unstaged 文件。
3. 用户选择文件执行 stage / unstage。
4. 用户输入提交标题和可选正文。
5. 用户点击“提交”。
6. 应用执行 commit。
7. 成功后刷新状态和历史图。

校验：

- 提交标题不能为空。
- 没有 staged 文件时禁用提交按钮。
- Git hooks 失败时展示中文摘要和原始输出。

### 7.6 远程同步

`fetch`：

1. 用户点击 `fetch`。
2. 应用执行 `git fetch --prune`。
3. 刷新远程分支、ahead / behind、历史图。

`pull`：

1. 用户点击 `pull`。
2. 应用确认当前分支存在 upstream。
3. 执行 `git pull --ff-only` 或按设置执行普通 pull。
4. 出现冲突时进入冲突状态视图。

`push`：

1. 用户点击 `push`。
2. 如果当前分支无 upstream，提示“推送并设置 upstream”。
3. 执行 push。
4. 刷新 ahead / behind 状态。

### 7.7 分支操作

新建分支：

1. 用户点击“新建分支”。
2. 输入分支名。
3. 可选择起点：当前 HEAD 或指定 commit。
4. 执行创建，可选是否立即切换。

切换分支：

1. 用户点击“切换分支”。
2. 选择本地分支或远程分支。
3. 如果工作区有未提交改动，提示可能影响切换。
4. 执行 checkout / switch。

删除本地分支：

1. 用户选择本地分支。
2. 显示确认：“删除本地分支不会删除远程分支。”
3. 执行删除。

## 8. 数据结构草案

MVP 可以使用 JSON 文件保存应用配置：

```ts
interface AppConfig {
  version: number;
  projects: GitProject[];
  groups: ProjectGroup[];
  recentProjectIds: string[];
  ui: UISettings;
}

interface ProjectGroup {
  id: string;
  name: string;
  sortOrder: number;
}

interface GitProject {
  id: string;
  name: string;
  path: string;
  groupId?: string;
  favorite: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface UISettings {
  theme: "system" | "light" | "dark";
  language: "zh-CN";
  bottomConsoleVisible: boolean;
  rightPanelWidth: number;
}
```

运行时 Git 状态不建议长期持久化，应从 Git 命令刷新：

```ts
interface GitStatusSummary {
  projectId: string;
  currentBranch: string | null;
  headHash: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  hasConflicts: boolean;
  operationState?: "merge" | "rebase" | "cherry-pick" | "revert";
  mergeSourceBranch?: string;
  mergeTargetBranch?: string;
}

interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  subject: string;
  body?: string;
  refs: CommitRef[];
}

interface CommitRef {
  type: "head" | "localBranch" | "remoteBranch" | "tag";
  name: string;
}

interface ChangedFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";
  staged: boolean;
}

interface DiffFile {
  oldPath?: string;
  newPath: string;
  status: ChangedFile["status"];
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "delete";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

interface BranchInfo {
  name: string;
  fullName: string;
  type: "local" | "remote";
  current: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  headHash: string;
}

interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

interface GitOperationResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  messageZh?: string;
}
```

## 9. Git 命令映射表

| 场景 | Git 命令 | 说明 |
| --- | --- | --- |
| 判断仓库根目录 | `git rev-parse --show-toplevel` | 添加项目时使用 |
| 判断当前 HEAD | `git rev-parse HEAD` | 无提交仓库可能失败，需要兼容 |
| 当前分支 | `git branch --show-current` | detached HEAD 时返回空 |
| 仓库状态 | `git status --porcelain=v2 --branch --ignored=matching` | 解析当前分支、ahead / behind、文件状态 |
| 本地分支 | `git for-each-ref refs/heads --format=...` | 避免解析人类可读输出 |
| 远程分支 | `git for-each-ref refs/remotes --format=...` | 过滤 `origin/HEAD` |
| tag 列表 | `git for-each-ref refs/tags --format=...` | 绑定 commit hash |
| remote 地址 | `git remote -v` | MVP 只读 |
| 历史图数据 | `git log --all --topo-order --date=iso-strict --decorate=full --parents --pretty=format:...` | 应用自己渲染 graph，不直接依赖 `--graph` |
| commit 详情 | `git show --format=fuller --name-status --no-renames <hash>` | 元信息和文件列表 |
| commit diff | `git show --format= --patch --find-renames <hash> -- <path>` | 单文件 diff |
| 两个提交差异 | `git diff --name-status <base> <target>` | 后续支持 |
| 工作区 unstaged diff | `git diff -- <path>` | 文件可选 |
| 工作区 staged diff | `git diff --cached -- <path>` | 文件可选 |
| stage 文件 | `git add -- <path>` | 路径必须使用参数数组传递 |
| unstage 文件 | `git restore --staged -- <path>` | 兼容旧 Git 时可 fallback 到 `git reset -- <path>` |
| discard 文件 | `git restore -- <path>` | 必须确认 |
| commit | `git commit -m <subject> [-m <body>]` | message 用参数传递，避免 shell 注入 |
| amend | `git commit --amend` | MVP 可支持 amend message 或 amend staged files |
| fetch | `git fetch --prune` | 可配置 remote |
| pull | `git pull --ff-only` | MVP 默认更安全，后续可配置策略 |
| push | `git push` | 无 upstream 时提示 |
| push upstream | `git push -u <remote> <branch>` | 设置 upstream |
| 新建分支 | `git branch <name> [startPoint]` | 可选起点 |
| 新建并切换 | `git switch -c <name> [startPoint]` | 兼容旧 Git 时 fallback 到 checkout |
| 切换分支 | `git switch <branch>` | 兼容旧 Git 时 fallback 到 checkout |
| 删除本地分支 | `git branch -d <branch>` | 强删 `-D` 后续支持且需确认 |
| merge 预检 | `git merge-base [--is-ancestor] <source> <target>` | 校验共同历史并判断快进、合并提交或无需合并 |
| merge 执行 | `git switch <target>` + `git merge --ff/--no-ff --no-edit <source>` | 仅允许干净工作区和本地目标分支 |
| 冲突检测 | `git status --porcelain=v2 --branch` | 解析 unmerged 状态 |
| 冲突三方内容 | `git show :1:<path>` / `:2:<path>` / `:3:<path>` | 分别读取共同基线、当前分支和传入分支版本 |
| 冲突解决 | 写入合并结果 + `git add -- <path>` | 保存前校验快照未过期且不再包含冲突标记 |
| merge 继续 | `git merge --continue` | 冲突 MVP |
| merge 终止 | `git merge --abort` | 冲突 MVP |
| rebase 继续 | `git rebase --continue` | 冲突 MVP |
| rebase 终止 | `git rebase --abort` | 冲突 MVP |

实现要求：

- 不通过拼接 shell 字符串执行带用户输入的命令。
- 使用 `spawn` 参数数组传递命令参数。
- 所有命令必须设置工作目录。
- 长时间命令需要展示 loading 和可取消状态。
- 命令失败需要返回中文摘要和原始输出。
- merge 必须由用户明确选择本地目标分支，执行前展示来源、目标、合并结果类型和目标分支远端差异。
- merge 执行前必须再次校验工作区干净；普通失败自动切回来源分支，冲突终止后恢复并切回来源分支。
- 冲突文件必须在预览区展示冲突块、三方原文和最终结果，支持逐块采用当前、采用传入、保留两者及手动编辑。
- 冲突未解决时禁止普通暂存、批量暂存和提交；二进制或超大文件仅允许整侧版本选择。

## 10. 错误提示与危险操作

### 10.1 中文错误提示

错误提示需要分两层：

1. 默认展示人能理解的中文摘要。
2. 提供“展开原始 Git 输出”查看 stdout / stderr。

示例：

| Git 情况 | 中文提示 |
| --- | --- |
| authentication failed | 认证失败，请检查账号权限、SSH key 或 credential 配置。 |
| non-fast-forward | 远程分支包含本地没有的提交，请先 pull 或 fetch 后处理差异。 |
| merge conflict | 操作产生冲突，请先解决冲突文件，然后继续或终止操作。 |
| pathspec did not match | 找不到指定分支、提交或文件，请确认名称是否正确。 |
| not a git repository | 当前目录不是 Git 仓库。 |

### 10.2 危险操作确认

必须确认：

- discard 单个文件改动
- 删除本地分支
- 强制删除本地分支
- hard reset
- rebase
- abort merge / rebase

确认文案示例：

- “丢弃文件改动后无法从 Git 恢复，是否继续？”
- “删除本地分支不会删除远程分支，是否继续？”
- “硬重置会丢弃未保存的改动，是否继续？”

## 11. 开发阶段拆分

### 阶段 0：工程骨架

目标：

- 建立 Electron + React + TypeScript 项目。
- 建立主进程 / 渲染进程通信边界。
- 建立 Git CLI 服务层。
- 建立本地配置存储。
- 建立基础中文 UI 框架。

交付：

- 可启动桌面应用。
- 左中右下基础布局。
- 能调用 `git --version` 并显示结果。

### 阶段 1：多项目管理

目标：

- 添加本地项目。
- 扫描目录项目。
- 项目列表、搜索、收藏、最近打开、分组。
- 切换项目并刷新 Git 状态。

验收：

- 可以添加至少 3 个本地仓库。
- 切换项目后当前分支、改动数量、ahead / behind 正确刷新。
- 删除项目记录不会删除本地文件。

### 阶段 2：历史图和提交详情

目标：

- 加载 commit 历史。
- 渲染 commit graph。
- 展示 HEAD、本地分支、远程分支、tag。
- 点击 commit 展示详情和文件列表。
- 查看 inline diff。

验收：

- merge commit 有正确父子关系。
- 分支、tag、HEAD 标签显示正确。
- 可复制 commit hash。
- diff 能展示新增、修改、删除、重命名。

### 阶段 3：工作区和提交

目标：

- 展示 staged / unstaged 文件。
- 支持 stage / unstage。
- 支持查看 staged / unstaged diff。
- 支持 commit。
- 支持 amend。
- 支持 discard 单文件改动并确认。

验收：

- stage / unstage 后列表和 diff 正确刷新。
- commit 成功后历史图出现新提交。
- commit hook 失败时能展示中文提示和原始输出。

### 阶段 4：远程和分支 MVP

目标：

- 支持 fetch / pull / push。
- 支持 push 当前分支并设置 upstream。
- 支持新建、切换、删除本地分支。
- 支持从指定 commit 创建分支。
- 支持冲突检测和冲突文件列表。
- 接入底部控制台。

验收：

- fetch 后远程分支刷新。
- push 后 ahead / behind 状态刷新。
- 无 upstream 时能引导设置 upstream。
- 切换分支和删除分支有明确中文反馈。
- 冲突状态能显示文件列表，并提供打开文件、继续、终止按钮。

### 阶段 5：打磨和发布准备

目标：

- 完善错误提示映射。
- 完成危险操作确认。
- 大仓库基础性能优化。
- 打包安装程序。
- 基础自动化测试和手工验收清单。

验收：

- 在 Windows 上可安装和启动。
- 对 1 万提交以内仓库有可接受加载速度。
- 常见 Git 操作失败时不会让界面进入不可恢复状态。

## 12. 后续版本规划

- rebase / cherry-pick / revert / reset 图形操作。
- stash 完整管理。
- 冲突解决器增强：逐行选择、语义辅助和更多二进制文件处理策略。
- 多仓库批量 fetch / pull。
- GitHub / GitLab / Gitee 集成。
- 打开远程 commit、branch、repository 页面。
- 主题、快捷键、自定义布局。
- 大仓库性能优化。
- 提交图虚拟滚动和缓存。
- side-by-side diff。
- remote 增删改管理。

## 13. 验收标准摘要

MVP 可以发布的最低标准：

- 用户可以添加和切换多个 Git 项目。
- 用户可以在中文界面中看清当前分支、未提交改动、ahead / behind。
- 用户可以查看 commit graph、commit 详情和 inline diff。
- 用户可以完成 stage、unstage、commit。
- 用户可以执行 fetch、pull、push。
- 用户可以新建、切换、删除本地分支。
- 危险操作都有中文确认。
- Git 错误都有中文摘要，并可展开原始输出。
- 底部控制台能在当前项目目录执行普通命令。
