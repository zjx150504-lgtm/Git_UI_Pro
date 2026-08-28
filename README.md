# Git UI Pro

中文桌面 Git 可视化管理软件，面向需要同时维护多个本地 Git 仓库的开发者。

Git UI Pro 不重新实现 Git 内核，所有仓库操作都调用用户本机的 `git` 命令。它的目标是把项目管理、工作区改动、提交图、分支状态、提交详情和文件 diff 做成更清晰的中文桌面界面。

## 界面预览

### 主工作区：项目、提交图与文件差异

![Git UI Pro 主工作区，展示多项目管理、提交图和文件差异](docs/images/screenshots/workspace-overview.png)

### 提交图与 Git 操作

![Git UI Pro 提交图操作菜单与文件内容预览](docs/images/screenshots/commit-graph-actions.png)

### 远程仓库连接

![Git UI Pro 通过 SSH 添加远程服务器仓库](docs/images/screenshots/remote-repository-connection.png)

### 版本更新与安全回退

![Git UI Pro 版本更新、历史版本与安全回退界面](docs/images/screenshots/version-update-and-rollback.png)

### 发布控制台

![Git UI Pro 发布控制台，展示版本规划、双远端发布进度、实时日志和历史版本](docs/images/screenshots/release-console.png)

### 仓库中心与分支管理

![Git UI Pro 仓库中心的分支管理界面](docs/images/screenshots/repository-center-branches.png)

### 深色主题与提交详情

![Git UI Pro 深色主题下的提交图、提交详情和文件差异](docs/images/screenshots/dark-theme-commit-details.png)

## 功能特性

- 多项目管理：添加、扫描、搜索、收藏、分组和切换本地 Git 仓库。
- 远程项目：通过 SSH 连接服务器仓库，并可按项目暂停远程连接。
- 源代码管理：查看暂存区和未暂存改动，支持 stage、unstage、discard、commit 和 amend。
- 提交图：展示提交历史、主线、合并线、本地分支、远程分支、tag 和 HEAD。
- 提交详情：查看提交元信息、变更文件列表和 inline diff。
- 仓库中心：集中管理分支、远程仓库、标签、工作树、子模块、Git LFS 和项目设置。
- 分支操作：查看、新建、切换、合并和删除本地分支，并支持从指定提交创建分支。
- 远程同步：支持 fetch、pull、push，以及无 upstream 分支的推送引导。
- 控制台：在当前项目目录中打开辅助终端。
- 发布控制台：规划语义化版本、记录发布说明、构建 Windows 安装版与 Portable，并跟踪 Gitee 与 GitHub 双远端发布进度。
- 版本更新：Windows 安装版与 Portable 支持检查、下载和应用新版本，并可查看历史版本和选择安全回退目标；macOS 更新基础代码与发布元数据已集成，但未签名期间关闭更新入口和后台检查，待启用 Developer ID 后再作为正式更新通道。
- 外观主题：支持明亮、深色主题和完全收起的项目侧栏。
- 中文反馈：Git 操作成功、失败、危险操作确认和原始输出查看都使用中文界面。

## 系统要求

- Windows、macOS 或 Linux 桌面系统。
- Node.js 20 及以上，用于本地开发和打包。
- Git 2.x，且 `git` 命令可在系统 PATH 中访问。

## 安装

正式版本会通过 GitHub 和 Gitee Releases 发布：

- GitHub: <https://github.com/zjx150504-lgtm/Git_UI_Pro/releases>
- Gitee（国内下载）: <https://gitee.com/zjx_master/git-ui-pro/releases>

Windows x64 发行版提供两种形式：

- `Git-UI-Pro-Setup-<版本号>-x64.exe`：安装版，带安装向导、快捷方式和卸载入口。
- `Git-UI-Pro-Portable-<版本号>-x64.exe`：便携版，无需安装，项目配置默认保存在程序旁边的 `Git-UI-Pro-Data` 目录。

两种 Windows 正式版都支持应用内更新，并优先使用 Gitee 国内更新源、失败后回退 GitHub。Portable 更新会在退出后替换自身；新版本未能正常启动时会自动恢复上一版本。

macOS 发行版提供 `Git-UI-Pro-<版本号>-mac-x64.dmg` 和 `Git-UI-Pro-<版本号>-mac-arm64.dmg` 镜像包。当前暂不使用 Developer ID，DMG 未签名且未公证，首次打开需要按 macOS 安全提示手动授权。普通用户只需下载对应架构的 DMG；GitHub Release 中同时保留 `.zip`、`.zip.blockmap` 和 `latest-mac.yml`，供以后启用签名更新通道时使用。

macOS 应用内更新要求 Developer ID 签名。当前未签名版本不显示应用内更新入口，也不会执行后台更新检查；DMG、ZIP、`.zip.blockmap`、`latest-mac.yml` 和 `MacUpdater` 基础代码仍会保留。以后完成签名和公证后，将 `package.json` 中 `featureFlags.macosInAppUpdates` 改为 `true`，并重新发布签名 DMG，用户手动安装首个签名版本后才能可靠地使用应用内更新。

当前项目仍处于早期版本。如果 Releases 中还没有安装包，可以在 GitHub Actions 的 `Build Installers` 工作流中下载对应系统的 artifacts。

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run dev:web
npm run typecheck
npm run build
npm run release:win
npm run dist:win
npm run dist:linux
npm run dist:mac
```

更多打包说明见 [docs/PACKAGING.md](docs/PACKAGING.md)。

## 发布流程

推荐运行本地发布控制台：

```bash
npm run release:win
```

控制台会显示当前版本、推荐版本和历史 tag，并完成版本文件更新、Windows 打包、规范化版本提交、tag 以及 Gitee/GitHub 双远端推送。GitHub 收到 tag 后会自动执行多平台构建、创建 Release，并在配置 `GITEE_TOKEN` 后同步国内更新资产。详细约束和失败恢复方式见 [docs/PACKAGING.md](docs/PACKAGING.md)。

需要手动发布时：

1. 确认本地校验通过：

   ```bash
   npm run typecheck
   npm run build
   ```

2. 推送代码到 GitHub 和 Gitee。

3. 创建并推送 `v*` 格式 tag，例如：

   ```bash
   git tag v0.1.0
   git push github v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions 会自动构建 Windows、Linux 和 macOS 安装包，全部构建成功后创建 GitHub Release；Gitee 国内更新源由本地发布控制台单独同步。

## 隐私说明

Git UI Pro 默认只读取和操作用户主动添加的本地 Git 仓库。远程同步行为由用户仓库中的 Git remote 配置决定，软件不会额外上传仓库内容、文件路径或凭据信息。

详细说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 贡献

欢迎通过 Issue 和 Pull Request 反馈问题或改进项目。提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 社区致谢

本项目认可并感谢 [LINUX DO](https://linux.do/) 开源社区为开发者提供交流、分享和互助的平台。
