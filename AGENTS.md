docs(rules): 补充提交流程约束

1. 在项目规则文档中新增中文 git commit 描述建议要求
2. 明确提交信息必须包含标题、编号变更说明和涉及文件清单
3. 补充不得自动执行 git commit 或 git push 的流程限制

涉及文件:
1. AGENTS.md# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the Vite renderer app. UI components live in `src/components/`, shared domain types in `src/types/`, renderer API access in `src/api/client.ts`, browser mock data in `src/data/mockData.ts`, and global styling in `src/styles/app.css`. `electron/` contains the desktop runtime, including `main.ts`, `preload.ts`, `gitService.ts`, and `configStore.ts`. Product notes are in `docs/PRD.md`. Generated output belongs in `dist/` and `dist-electron/`; do not edit those files by hand.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start Vite, watch Electron TypeScript, and launch the Electron app.
- `npm run dev:web`: run only the renderer at `http://127.0.0.1:5173` for browser UI checks.
- `npm run typecheck`: run strict TypeScript checks for both renderer and Electron code.
- `npm run build`: compile Electron and build the renderer for production.
- `npm run preview`: preview the production renderer build locally.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode enabled. Prefer React function components and hooks. Name components and files that export components in PascalCase, such as `WorkspaceView.tsx`; use camelCase for variables, functions, callbacks, and local helpers. Keep CSS class names descriptive and kebab-case, matching existing prefixes such as `scm-`, `graph-`, and `project-`. The project uses 2-space indentation. Use `lucide-react` for icons and `sonner` for toast notifications rather than custom one-off replacements.

## Testing Guidelines

No dedicated test runner is configured yet. Treat `npm run typecheck` and `npm run build` as the required validation gates before handing off changes. For UI changes, also run `npm run dev:web` or `npm run dev` and verify the affected interaction visually. If adding automated tests later, use colocated names like `ComponentName.test.tsx` or module-level `*.test.ts` files, and document the new command in `package.json`.

## Commit & Pull Request Guidelines

Recent history uses conventional commit prefixes with scopes, often in Chinese, for example `fix(scm): 对齐 Git 提交面板交互`, `feat(notification): 优化 Git 操作通知反馈`, and `style(ui): 统一源代码管理面板字体和对齐`. Use the same pattern: `type(scope): concise summary`.

After completing changes, provide a Chinese `git commit` message suggestion, but do not automatically run `git commit` or `git push`. The suggestion must use this segmented format: first-line title, blank line, numbered change notes, blank line, `涉及文件:`, then numbered repository-relative file paths. The title format is `type(scope): 中文摘要`. Each numbered note should describe the changed area, key behavior change, risk fix, or documentation sync point; do not provide only a vague one-line summary.

Commit message suggestion template:

```text
type(scope): 中文摘要

1. 第一条变更说明
2. 第二条变更说明
3. 第三条变更说明

涉及文件:
1. path/to/file-a
2. path/to/file-b
3. path/to/file-c
```

Pull requests should include a short problem summary, key implementation notes, validation commands run, and screenshots or screen recordings for visible UI changes. Link related issues when available and call out any Git behavior changes explicitly.

## Agent-Specific Instructions

Keep changes scoped to the requested behavior and follow existing component boundaries. Do not overwrite unrelated local edits. Avoid committing generated build output unless the task specifically requires it.
