# 打包发布说明

## 常用命令

- `npm run release:win`: 启动本地发布控制台，在浏览器中完成版本更新、Windows 打包、版本提交、tag 和 GitHub/Gitee 双远端推送。
- `npm run icons`: 生成 `build/icon.ico`、`build/icon.png` 和 Linux PNG 图标集。
- `npm run dist:dir`: 生成未安装目录包到 `release/win-unpacked`，用于快速验证打包内容。
- `npm run dist:win`: 生成未签名 Windows NSIS 安装包和 Portable 便携版到 `release/`。
- `npm run dist:linux`: 生成 Linux AppImage 和 deb 包到 `release/`。
- `npm run dist:mac`: 按当前 Mac 架构生成 macOS DMG，以及应用内更新所需的 ZIP、ZIP blockmap 和 `latest-mac.yml`。
- `npm run dist:win:signed`: 生成签名 Windows 包，需先配置代码签名证书环境变量。

## Pull Request 检查

`.github/workflows/pull-request-checks.yml` 会在每个 Pull Request 上使用 Node.js 20 和全新依赖环境执行以下检查：

- `npm run typecheck`
- `npm run test:update`
- `npm run test:mac-update-metadata`
- `npm run build`

该工作流也支持手动触发。安装包构建仍由 `Build Installers` 工作流负责，不会因为普通 Pull Request 而触发 Windows、Linux 或 macOS 打包矩阵。

所有正式和验证打包产物统一输出到 `release/`，不要使用 `release-*` 临时输出目录。

## 本地发布控制台

执行以下命令后，脚本会监听随机的本机回环端口并自动打开浏览器：

```bash
npm run release:win
```

控制台会读取 `package.json` 当前版本和本地 `v*` tag 历史，并根据两者中的最高稳定版本推荐补丁、次版本和主版本号。确认发布后依次执行：

1. 检查当前分支、Git 身份、进行中的 Git 操作、目标 tag 和双远端分支状态。
2. 使用 `npm version --no-git-tag-version` 同步更新 `package.json` 与 `package-lock.json`。
3. 执行 `npm run dist:win -- --publish never`，确认 `release/` 中已生成对应版本的 NSIS 安装包、blockmap、Portable 和 `latest.yml`。
4. 按项目提交规范提交当前全部改动，创建带说明的 `v*` tag。
5. 分别向 Gitee 和 GitHub 原子推送当前分支与 tag。GitHub 收到 tag 后会触发 Actions，并独立创建 GitHub Release。
6. 若在控制台启用“GitHub 正式版完成后自动启动本地镜像同步”，GitHub Release 就绪后会启动单独的 Gitee 国内镜像任务；镜像失败不会改变正式版发布结果。

发布控制台默认识别指向 `gitee.com` 的现有远端。若尚未配置 GitHub 远端，会使用 `package.json` 的 `repository.url` 添加名为 `github` 的远端。HTTPS Git 远端需要提前通过 Git Credential Manager 配置凭据。

Gitee 国内镜像使用单独的私人令牌。可以在发布控制台中临时输入，也可以在启动控制台前设置 `GITEE_TOKEN`；令牌只保留在本机发布进程内，不写入仓库、浏览器存储或安装包。控制台读取 GitHub 正式附件时复用 Git 配置中的 GitHub 代理，而 Gitee API 和大文件上传保持国内直连。

发布前必须显式勾选确认项。构建失败且尚未暂存时，脚本会恢复两个版本文件；本地提交或 tag 已生成后不会自动回滚，远端推送失败时可在当前页面重试。Gitee 镜像可按任意已有稳定标签单独执行“同步 / 修复”，不需要重新发布版本。

Windows 安装包使用辅助安装向导，默认按当前用户安装，并允许用户选择安装目录；Portable 可以直接运行，不创建快捷方式、卸载项或系统级安装记录。

Windows 正式版同时发布 NSIS x64 安装版和 Portable x64 便携版。发布控制台会校验下面四项产物全部存在，任一缺失都会停止提交和推送：

- `Git-UI-Pro-Setup-<version>-x64.exe`: NSIS 正式版安装包。
- `Git-UI-Pro-Setup-<version>-x64.exe.blockmap`: 增量下载索引。
- `Git-UI-Pro-Portable-<version>-x64.exe`: 无需安装的 Windows x64 便携版。
- `latest.yml`: electron-updater 更新元数据；文件名固定，不包含版本号。

## Windows 应用内更新

应用内更新同时支持 Windows x64 NSIS 安装版和 Portable 便携版。开发环境、网页预览和其他操作系统不检查 Windows 在线更新源。

Windows 正式版启动后会静默检查 Gitee 国内更新源，Gitee 不可用或镜像尚未同步完整时自动回退到 GitHub。发现比当前版本更高的稳定版时，左上角显示更新入口。用户打开更新面板后手动开始下载，应用不会在后台自动下载，也不会在用户正常关闭应用时自动安装。安装版下载完成后，用户需要点击“打开更新安装程序”；应用退出并显示 NSIS 安装界面，安装完成后自动启动新版本。

首次启用时需要先发布并手动安装一个包含双更新源逻辑的基线版本。更早、尚未集成该更新器的旧版本不会自动切换到国内源；从基线版本开始，后续 Gitee 或 GitHub Release 均可完成应用内升级。

GitHub Release 必须同时上传同一版本的 NSIS `.exe`、对应 `.exe.blockmap`、Portable `.exe` 和 `latest.yml`。Gitee Release 除这四项外还会上传 `update-manifest.json`，清单分别记录安装版与 Portable 的文件名、大小和 SHA-256。镜像缺项或摘要不匹配时，客户端不会下载可疑资产，而会尝试 GitHub 备用源。为避免 Gitee 仓库累计 1GB 的附件配额阻断发布，本地镜像同步只保留最近 3 个正式版本的受管下载附件；更早版本的 Release 页面、标签和说明继续保留，完整历史附件仍可从 GitHub 获取。

安装版继续通过 electron-updater 和 blockmap 完成差分下载，差分条件不满足时回退到完整安装包。Portable 使用独立下载与替换流程：更新包流式写入当前 Portable 所在磁盘，严格校验大小和 SHA-256，用户确认后由独立 PowerShell 辅助进程等待应用及外层启动器退出，再替换 Portable 可执行文件并启动新版本。新版本窗口成功加载并写入健康标记后才删除上一版本；若 90 秒内未通过健康检查，则自动恢复旧文件并重新启动。

Portable 默认把项目列表、分组、偏好设置、终端历史和更新状态保存在程序旁边的 `Git-UI-Pro-Data` 目录，与安装版数据隔离。目录不可写时会回退到 `%APPDATA%/Git UI Pro Portable` 并显示中文提示。托管平台令牌继续使用 Windows `safeStorage` 加密；把 Portable 移动到其他电脑或 Windows 账号后，无法解密的令牌需要重新授权，不会以明文方式迁移。

发布后应至少在一台未开启代理的 Windows x64 设备上分别验证安装版与 Portable 的检查、下载、退出更新、重启和版本号，并使用两个连续正式版本验证 Portable 的文件替换及配置保留。

安装向导会在开始安装前显示桌面快捷方式选项，默认勾选“创建桌面快捷方式”，用户可以取消。

打包后的 Windows 应用会保留 `contextIsolation` 并关闭 renderer sandbox，以规避部分自定义安装目录下 Electron renderer 子进程启动失败导致的黑屏问题。

## macOS 应用内更新

macOS x64 与 arm64 已集成通过 GitHub 检查、下载并安装新版本的代码。DMG 是用户手动下载安装时使用的镜像包；electron-updater 在 macOS 上通过 Squirrel.Mac 安装更新，必须使用同版本、同架构的 ZIP 载荷，因此 Release 继续包含 `.zip`、`.zip.blockmap` 和 `latest-mac.yml`。这些 ZIP 文件不是额外提供给用户的安装方式。

两个 macOS runner 会分别生成架构专属元数据。发布 job 使用 `scripts/merge-mac-update-metadata.mjs` 校验版本、架构、文件名、大小与 SHA-512 后，将它们合并成一个 `latest-mac.yml`，供 x64 和 arm64 客户端共同读取。macOS 当前只开放 GitHub 更新源，不提供 Gitee 更新源和历史版本回退；Windows 行为保持不变。

当前阶段暂不使用 Developer ID。`package.json` 和 GitHub Actions 均显式设置 `identity=null`、`notarize=false`，不需要配置 Apple 证书或公证 Secrets。生成的应用未签名、未公证，首次打开可能被 Gatekeeper 阻止，用户需要在 Finder 中右键选择“打开”并按系统提示确认。与此同时，`package.json` 的 `featureFlags.macosInAppUpdates` 保持为 `false`，应用不会显示 macOS 更新入口，也不会启动后台更新检查；DMG、ZIP、blockmap、`latest-mac.yml` 和 `MacUpdater` 代码仍正常构建和保留。

macOS 应用内更新仍要求 Developer ID 签名，因此当前未签名版本不作为可靠的自动更新基线。ZIP 和更新元数据暂时保留，便于以后恢复签名时直接启用发布链路。届时用户需要先手动安装首个已经签名、公证且包含更新器的基线 DMG；更早的未签名版本不能通过补充 Release 附件远程转换为签名基线。

恢复 Developer ID 后，将 `featureFlags.macosInAppUpdates` 改为 `true`，再重新开启签名、公证及流水线验证，并至少用两个连续版本在 Intel Mac 和 Apple Silicon Mac 上分别验证检查、ZIP 下载、退出安装、重启和版本号。该开关关闭时，`updateCapabilities` 会让 macOS 返回空更新源，因此不会创建 `MacUpdater`、安排后台检查或提供手动更新操作。

## Windows 签名

默认配置保留图标和版本资源编辑，但将 `win.signExecutable` 设为 `false`，方便本地生成未签名包。

正式发布前使用 `npm run dist:win:signed`，并按 electron-builder 约定提供证书：

- `CSC_LINK` 或 `WIN_CSC_LINK`: `.pfx` 文件路径、base64 内容或证书链接。
- `CSC_KEY_PASSWORD` 或 `WIN_CSC_KEY_PASSWORD`: 证书密码。

签名配置位于 `package.json` 的 `build.win.signtoolOptions`，当前使用 SHA-256 和 DigiCert RFC 3161 时间戳服务器。

未签名构建不会写入伪造的 `publisherName`，避免应用内更新把未签名安装包误判为发行商不匹配；使用真实证书执行签名构建时，electron-builder 会从证书自动生成发行商信息并启用签名校验。

## 原生模块

项目依赖 `@homebridge/node-pty-prebuilt-multiarch`。打包配置关闭 `npmRebuild`，使用 postinstall 已安装的 Electron ABI 预编译产物，并通过 `asarUnpack` 解包：

- `build/Release/**/*.node`
- `build/Release/*.dll`
- `build/Release/*.exe`
- `prebuilds/**/*`
- `third_party/**/*`

这样 packaged app 的终端功能可以从 `app.asar.unpacked` 读取 node-pty 原生文件。

## Electron runtime

`build.electronDist` 指向 `node_modules/electron/dist`，打包时复用本地已安装的 Electron runtime，避免发布验证阶段重复从 GitHub 下载 Electron。

所有 `dist*` 脚本会先执行 `npm run ensure:electron`，校验 Electron 的版本文件、`path.txt` 和当前平台可执行文件。如果 npm 包存在但 runtime 下载不完整，会自动重新运行 `node_modules/electron/install.js`；发布控制台也会在修改版本号前完成同一项预检，避免构建到打包阶段才失败。

首次生成 NSIS 安装包时，electron-builder 仍可能需要下载 NSIS 工具链并缓存到本机；缓存完成后后续构建会复用。

## GitHub Actions 多平台构建

项目已提供 `.github/workflows/build-installers.yml`，支持手动构建和 tag 构建：

- 手动构建：GitHub 仓库页面进入 `Actions` -> `Build Installers` -> `Run workflow`。
- tag 构建：推送 `v*` 格式 tag，例如 `v0.1.0`。

主发布工作流会分别在以下环境执行：

- `windows-latest`: `npm run dist:win`
- `ubuntu-latest`: `npm run dist:linux`
- `macos-15-intel`: `npm run dist:mac`，生成未签名 macOS x64 DMG 与更新载荷
- `macos-15`: `npm run dist:mac`，生成未签名 macOS arm64 DMG 与更新载荷

每个系统都会独立执行 `npm ci`，避免复用其它系统的 `node_modules`，这对 `node-pty` 这类原生依赖很重要。

构建产物会作为 GitHub Actions artifacts 上传，名称分别是：

- `git-ui-pro-windows-x64`
- `git-ui-pro-linux-x64`
- `git-ui-pro-macos-x64`
- `git-ui-pro-macos-arm64`

Actions 只上传安装包、Portable、各平台更新元数据和必要的 blockmap，不上传各平台解包目录。两个 macOS job 会在上传前确认 DMG、ZIP、ZIP blockmap 和 `latest-mac.yml` 均已生成，校验 DMG 完整性，并确认应用主程序和 `node-pty` 原生模块符合目标架构；当前不执行签名或公证票据校验。发布 job 会合并两个架构的 macOS 元数据，GitHub Release 最终只保留一个 `latest-mac.yml`。

当工作流由 `v*` 格式 tag 触发时，会在 Windows、Linux 和 macOS 构建全部完成后自动创建 GitHub Release，并把各平台安装包上传到该 Release。主工作流到此即视为正式发布完成，不再从 GitHub Actions 直接向 Gitee 上传大文件。

Gitee 国内镜像由本地发布控制台执行。控制台会先从 GitHub Release 读取权威附件清单：本地产物或缓存与 GitHub 的大小、SHA-256 一致时直接复用，否则通过本机 GitHub 代理下载到系统临时缓存。随后从本机国内网络依次上传安装包、blockmap、Portable、`latest.yml`，最后上传 `update-manifest.json`。

上传过程中会显示总进度、当前文件和逐文件状态，并支持安全取消。单文件上传总时限为 25 分钟，连续 2 分钟没有传输进度会终止；文件全部发送后，Gitee 服务器必须在 3 分钟内返回结果。失败后重新执行会先校验 Gitee 已有附件的文件大小，完整附件直接跳过，避免再次上传整个文件。只有五项附件均存在且大小一致时才会把镜像标记为就绪。

如果 GitHub Release 已发布，但 Gitee 页面缺少自定义附件，在本地运行 `npm run release:win`，在“Gitee 国内镜像”中填写已有标签和令牌并点击“同步 / 修复”即可，无需重新创建 tag。GitHub 仓库中的 `Repair Gitee Release Mirror` 仍作为无人值守的备用修复入口；只有使用该备用工作流时才需要在 Actions Secrets 中配置 `GITEE_TOKEN`。

尚未包含双更新源逻辑的 v0.1.25 及更早客户端仍只会访问 GitHub，无法通过服务端配置让旧程序自动改用 Gitee。需要开启代理完成一次升级，或在 Gitee 附件修复后手动下载并覆盖安装基线版本；从包含双更新源逻辑的版本开始，后续检查会优先直连 Gitee。

`.github/workflows/build-macos-installer.yml` 继续提供单独的 macOS x64 验证入口；正式 `v*` tag 发布不需要额外触发该工作流。macOS runner 排队或构建失败会阻止 GitHub Release 创建，确保 Release 不会缺少 DMG 或预留的应用内更新载荷。

首次运行时，electron-builder 可能会下载对应系统的打包工具链，耗时会比本地构建更长。

## 远程仓库

Gitee 和 GitHub 远程仓库可以同时存在，不冲突。推荐保留 Gitee 为 `origin`，新增 GitHub 为 `github`：

```bash
git remote add github https://github.com/zjx150504-lgtm/Git_UI_Pro.git
git push github master
```

以后可以按需分别推送：

```bash
git push origin master
git push github master
```

正式发布版本时，同时推送 tag 到两个远程：

```bash
git push github v0.1.0
git push origin v0.1.0
```

GitHub 会通过 Actions 自动生成 Release；Gitee 安装包由本地发布控制台作为独立任务同步，避免 GitHub Actions 到 Gitee 的大文件链路阻塞正式发布。
