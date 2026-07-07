# Contributing

感谢你参与 Git UI Pro。

## 开发环境

需要安装：

- Node.js 20 及以上
- Git 2.x

安装依赖：

```bash
npm install
```

启动桌面开发模式：

```bash
npm run dev
```

只启动浏览器渲染层：

```bash
npm run dev:web
```

## 提交前检查

提交 Pull Request 前请至少运行：

```bash
npm run typecheck
npm run build
```

涉及 UI 的改动，请同时运行 `npm run dev` 或 `npm run dev:web` 做手工验证，并在 PR 中附截图或录屏。

## 代码规范

- 使用 TypeScript strict mode。
- React 组件优先使用函数组件和 hooks。
- 组件文件使用 PascalCase，例如 `WorkspaceView.tsx`。
- CSS class 使用 kebab-case，并沿用 `scm-`、`graph-`、`project-` 等已有前缀。
- 图标优先使用 `lucide-react`。
- 通知反馈优先使用项目现有的 `sonner` 和统一反馈组件。

## Git 操作约束

- 不要通过拼接 shell 字符串执行带用户输入的 Git 命令。
- Git 命令参数应通过数组传递。
- 删除、丢弃、重置、终止 merge/rebase 等危险操作必须有确认。
- Git 错误需要保留中文摘要和原始输出。

## Commit Message

提交信息使用 conventional commit 风格：

```text
type(scope): 中文摘要
```

示例：

```text
fix(graph): 修复合并线渲染错位
feat(scm): 增加提交前自动暂存提示
docs(readme): 补充本地开发说明
```

## Pull Request

PR 请包含：

1. 问题背景。
2. 主要实现说明。
3. 验证命令和结果。
4. UI 改动截图或录屏。
5. 是否改变 Git 行为或用户数据。
