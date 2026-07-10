# Git UI Pro

中文桌面 Git 可视化管理软件，面向需要同时维护多个本地 Git 仓库的开发者。

Git UI Pro 不重新实现 Git 内核，所有仓库操作都调用用户本机的 `git` 命令。它的目标是把项目管理、工作区改动、提交图、分支状态、提交详情和文件 diff 做成更清晰的中文桌面界面。

## 功能特性

- 多项目管理：添加、扫描、搜索、收藏和切换本地 Git 仓库。
- 源代码管理：查看暂存区和未暂存改动，支持 stage、unstage、discard、commit 和 amend。
- 提交图：展示提交历史、主线、合并线、本地分支、远程分支、tag 和 HEAD。
- 提交详情：查看提交元信息、变更文件列表和 inline diff。
- 分支操作：查看、新建、切换、删除本地分支，并支持从指定提交创建分支。
- 远程同步：支持 fetch、pull、push，以及无 upstream 分支的推送引导。
- 控制台：在当前项目目录中打开辅助终端。
- 中文反馈：Git 操作成功、失败、危险操作确认和原始输出查看都使用中文界面。

## 系统要求

- Windows、macOS 或 Linux 桌面系统。
- Node.js 20 及以上，用于本地开发和打包。
- Git 2.x，且 `git` 命令可在系统 PATH 中访问。

## 安装

正式版本会通过 GitHub Releases 发布：

- GitHub: <https://github.com/zjx150504-lgtm/Git_UI_Pro/releases>
- Gitee: 请在 Gitee 仓库的发行版页面查看同步发布内容。

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

控制台会显示当前版本、推荐版本和历史 tag，并完成版本文件更新、Windows 打包、规范化版本提交、tag 以及 Gitee/GitHub 双远端推送。GitHub 收到 tag 后会自动执行多平台构建并创建 Release。详细约束和失败恢复方式见 [docs/PACKAGING.md](docs/PACKAGING.md)。

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

4. GitHub Actions 会自动构建 Windows、Linux、macOS 安装包，并在 tag 触发时创建 GitHub Release。

## 隐私说明

Git UI Pro 默认只读取和操作用户主动添加的本地 Git 仓库。远程同步行为由用户仓库中的 Git remote 配置决定，软件不会额外上传仓库内容、文件路径或凭据信息。

详细说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 贡献

欢迎通过 Issue 和 Pull Request 反馈问题或改进项目。提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
