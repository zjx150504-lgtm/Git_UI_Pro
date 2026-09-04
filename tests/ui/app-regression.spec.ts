import { expect, test, type Page, type TestInfo } from "@playwright/test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "打开仓库中心" })).toBeVisible();
}

async function openFirstWorktreeFile(page: Page) {
  const fileRow = page.locator(".scm-file-row").first();
  await expect(fileRow).toBeVisible();
  await fileRow.click();
  await expect(page.locator(".editor-detail-panel:not(.empty)")).toBeVisible();
}

async function createWordPreviewDataUrl() {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  archive.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  archive.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Word 阅读预览</w:t></w:r></w:p>
    <w:p><w:r><w:t>办公文档正文可以直接阅读。</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`);
  const base64 = await archive.generateAsync({ type: "base64" });
  return `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`;
}

async function createPresentationPreviewDataUrl() {
  const archive = new JSZip();
  archive.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>演示文稿阅读预览</a:t></a:r></a:p>
    <a:p><a:r><a:t>复杂动画交给系统应用，文字内容在这里快速查看。</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);
  const base64 = await archive.generateAsync({ type: "base64" });
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
}

function parseOpaqueColor(value: string): [number, number, number] {
  const color = value.trim();
  const hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16)
    ];
  }

  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  throw new Error(`无法解析颜色：${value}`);
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = parseOpaqueColor(color).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

async function captureThemeSmoke(page: Page, testInfo: TestInfo, theme: "light" | "dark") {
  const styles = await page.locator(".app-shell").evaluate((element) => {
    const appStyle = getComputedStyle(element);
    const chromeStyle = getComputedStyle(document.querySelector(".app-chrome")!);
    return {
      background: appStyle.getPropertyValue("--bg").trim(),
      text: appStyle.getPropertyValue("--text").trim(),
      chromeColor: chromeStyle.color,
      chromeBackground: chromeStyle.backgroundColor,
      chromeBoxShadow: chromeStyle.boxShadow
    };
  });

  expect(contrastRatio(styles.text, styles.background)).toBeGreaterThanOrEqual(7);
  expect(styles.chromeColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.chromeBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.chromeBoxShadow).not.toBe("none");
  await testInfo.attach(`${theme}-theme`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png"
  });
}

test("桌面宽度打开仓库中心不会产生横向溢出", async ({ page }) => {
  await openApp(page);
  const repositoryButton = page.getByRole("button", { name: "打开仓库中心" });
  const repositoryTooltip = page.locator('[role="tooltip"]').filter({ hasText: "仓库中心" });
  await repositoryButton.hover();
  await expect(repositoryTooltip).toBeVisible();
  await repositoryButton.click();
  await expect(repositoryTooltip).toBeHidden();

  const dialog = page.getByRole("dialog", { name: /git ui pro/i });
  await expect(dialog).toBeVisible();
  const metrics = await dialog.evaluate((element) => {
    const content = element.querySelector<HTMLElement>(".repository-center-content")!;
    const layout = element.querySelector<HTMLElement>(".repository-center-layout")!;
    const chrome = document.querySelector<HTMLElement>(".app-chrome")!;
    const rect = element.getBoundingClientRect();
    const chromeRect = chrome.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: rect.left,
      dialogTop: rect.top,
      dialogRight: rect.right,
      chromeBottom: chromeRect.bottom,
      dialogClientWidth: element.clientWidth,
      dialogScrollWidth: element.scrollWidth,
      layoutClientWidth: layout.clientWidth,
      layoutScrollWidth: layout.scrollWidth,
      contentClientWidth: content.clientWidth,
      contentScrollWidth: content.scrollWidth
    };
  });

  expect(metrics.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.dialogTop).toBeGreaterThanOrEqual(metrics.chromeBottom);
  expect(metrics.dialogRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
  expect(metrics.dialogScrollWidth).toBeLessThanOrEqual(metrics.dialogClientWidth + 1);
  expect(metrics.layoutScrollWidth).toBeLessThanOrEqual(metrics.layoutClientWidth + 1);
  expect(metrics.contentScrollWidth).toBeLessThanOrEqual(metrics.contentClientWidth + 1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1_200);
  await expect(repositoryTooltip).toBeHidden();
});

test("仓库中心按标签页加载并复用已读取的数据", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".scm-file-row").first()).toBeVisible();
  await page.evaluate(() => {
    const methodNames = [
      "getStashes",
      "getReflog",
      "getBranches",
      "getTags",
      "getRemotes",
      "getLinkedWorktrees",
      "getSubmodules",
      "getLfsStatus",
      "readGitIgnore",
      "getSigningConfig",
      "getGitIdentity",
      "listHostingAccounts"
    ] as const;
    const calls = Object.fromEntries(methodNames.map((name) => [name, 0])) as Record<(typeof methodNames)[number], number>;
    const tracked = <T,>(name: (typeof methodNames)[number], value: T) => async () => {
      calls[name] += 1;
      return value;
    };
    window.gitUI = {
      ...window.gitUI,
      getUiPreferences: async () => ({
        theme: "system", language: "zh-CN", bottomConsoleVisible: true, sidebarWidth: 240, rightPanelWidth: 420,
        consoleHeight: 240, fontSize: 14, fontFamily: "system-ui", diffViewMode: "split", diffWrap: false,
        pullStrategy: "ff-only", density: "comfortable", sidebarPosition: "left", confirmDestructiveActions: true, shortcuts: {}
      }),
      getProjectStatus: async () => ({
        currentBranch: "master", upstream: "origin/master", ahead: 0, behind: 0, stagedCount: 0,
        unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, hasConflicts: false
      }),
      onGitOperationProgress: () => () => undefined,
      getWindowState: async () => ({ isMaximized: false, isFullScreen: false }),
      onWindowStateChange: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      setNativeTheme: async () => undefined,
      getStashes: tracked("getStashes", []),
      getReflog: tracked("getReflog", []),
      getBranches: tracked("getBranches", []),
      getTags: tracked("getTags", []),
      getRemotes: tracked("getRemotes", []),
      getLinkedWorktrees: tracked("getLinkedWorktrees", []),
      getSubmodules: tracked("getSubmodules", []),
      getLfsStatus: tracked("getLfsStatus", { installed: false, initialized: false, version: "", files: [] }),
      readGitIgnore: tracked("readGitIgnore", { content: "", revision: "missing" }),
      getSigningConfig: tracked("getSigningConfig", { commitGpgSign: false, tagGpgSign: false, format: "openpgp", signingKey: null }),
      getGitIdentity: tracked("getGitIdentity", { valid: true, issues: [] }),
      listHostingAccounts: tracked("listHostingAccounts", [])
    } as typeof window.gitUI;
    (window as unknown as { __repositoryCenterLoadCalls: typeof calls }).__repositoryCenterLoadCalls = calls;
  });

  await page.getByRole("button", { name: "打开仓库中心" }).evaluate((button: HTMLButtonElement) => button.click());
  const dialog = page.getByRole("dialog", { name: /git ui pro/i });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls.getStashes)).toBeGreaterThan(0);

  const recoveryCalls = await page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls);
  expect(recoveryCalls.getReflog).toBeGreaterThan(0);
  expect(recoveryCalls.getLinkedWorktrees).toBe(0);
  expect(recoveryCalls.getSubmodules).toBe(0);
  expect(recoveryCalls.getLfsStatus).toBe(0);
  expect(recoveryCalls.getRemotes).toBe(0);
  expect(recoveryCalls.listHostingAccounts).toBe(0);

  await dialog.getByRole("button", { name: /仓库工具/ }).click();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls.getLinkedWorktrees)).toBeGreaterThan(0);
  const toolCalls = await page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls);
  expect(toolCalls.getSubmodules).toBeGreaterThan(0);
  expect(toolCalls.getLfsStatus).toBeGreaterThan(0);
  expect(toolCalls.getRemotes).toBe(0);

  await dialog.getByRole("button", { name: /远程与托管/ }).click();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls.getRemotes)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls.listHostingAccounts)).toBeGreaterThan(0);

  const toolLoadCount = toolCalls.getLinkedWorktrees;
  await dialog.getByRole("button", { name: /仓库工具/ }).click();
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (
    window as unknown as { __repositoryCenterLoadCalls: Record<string, number> }
  ).__repositoryCenterLoadCalls.getLinkedWorktrees)).toBe(toolLoadCount);
});

test("切换项目分组使用局部更新并快速完成", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "打开仓库中心" }).click();
  const dialog = page.getByRole("dialog", { name: /git ui pro/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /项目管理/ }).click();

  const groupSelect = dialog.getByRole("combobox", { name: "设置 Git UI Pro 的分组" });
  await expect(groupSelect).toBeVisible();
  const currentGroup = (await groupSelect.textContent())?.trim() ?? "";
  await groupSelect.click();
  const groupOptions = page.getByRole("listbox", { name: "设置 Git UI Pro 的分组" });
  await expect(groupOptions).toBeVisible();
  const nextGroup = (await groupOptions.getByRole("option").allTextContents())
    .map((label) => label.trim())
    .find((label) => label && label !== "未分组" && label !== currentGroup);
  expect(nextGroup).toBeTruthy();

  await page.evaluate(() => {
    const calls = { setProjectGroup: 0, getProjects: 0 };
    (window as unknown as { __projectGroupCalls: typeof calls }).__projectGroupCalls = calls;
    const currentBridge = window.gitUI;
    window.gitUI = {
      ...currentBridge,
      setProjectGroup: async (projectId, groupId) => {
        calls.setProjectGroup += 1;
        return { id: projectId, name: "Git UI Pro", path: "E:/Projects/Git-UI-Pro", groupId };
      },
      getProjects: async () => {
        calls.getProjects += 1;
        throw new Error("切换项目分组不应重新读取全部项目");
      }
    } as typeof window.gitUI;
  });

  await groupOptions.getByRole("option", { name: nextGroup! }).click();
  await page.waitForTimeout(50);
  await expect(groupSelect).toHaveText(nextGroup!);
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const calls = await page.evaluate(() => (window as unknown as { __projectGroupCalls: { setProjectGroup: number; getProjects: number } }).__projectGroupCalls);
  expect(calls).toEqual({ setProjectGroup: 1, getProjects: 0 });
});

test("批量刷新项目状态不会重载仓库中心的无关资源", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "打开仓库中心" }).click();
  const dialog = page.getByRole("dialog", { name: /git ui pro/i });
  await dialog.getByRole("button", { name: /项目管理/ }).click();
  const projectCheckbox = dialog.getByRole("checkbox", { name: "选择 Git UI Pro" });
  await expect(projectCheckbox).toBeVisible();

  await page.evaluate(() => {
    const methodNames = ["getStashes", "getReflog", "getBranches", "getTags", "getRemotes", "getLinkedWorktrees", "getSubmodules", "getLfsStatus"] as const;
    const calls = Object.fromEntries(methodNames.map((name) => [name, 0])) as Record<(typeof methodNames)[number], number>;
    let statusCalls = 0;
    const trackedEmpty = (name: (typeof methodNames)[number]) => async () => {
      calls[name] += 1;
      return [];
    };
    window.gitUI = {
      ...window.gitUI,
      getProjectStatus: async () => {
        statusCalls += 1;
        return {
          currentBranch: "master", upstream: "origin/master", ahead: 0, behind: 0, stagedCount: 0,
          unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, hasConflicts: false
        };
      },
      getHistoryPage: async () => ({ commits: [], hasMore: false, nextSkip: 0 }),
      getHistoryRefs: async () => [],
      getWorktree: async () => ({ stagedFiles: [], unstagedFiles: [] }),
      getStashes: trackedEmpty("getStashes"),
      getReflog: trackedEmpty("getReflog"),
      getBranches: trackedEmpty("getBranches"),
      getTags: trackedEmpty("getTags"),
      getRemotes: trackedEmpty("getRemotes"),
      getLinkedWorktrees: trackedEmpty("getLinkedWorktrees"),
      getSubmodules: trackedEmpty("getSubmodules"),
      getLfsStatus: async () => {
        calls.getLfsStatus += 1;
        return { installed: false, initialized: false, version: "", files: [] };
      }
    } as typeof window.gitUI;
    (window as unknown as { __batchRefreshCenterCalls: typeof calls }).__batchRefreshCenterCalls = calls;
    Object.defineProperty(window, "__batchRefreshStatusCalls", { get: () => statusCalls, configurable: true });
  });

  await projectCheckbox.check();
  await dialog.getByRole("button", { name: "执行（1）" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __batchRefreshStatusCalls: number }).__batchRefreshStatusCalls)).toBeGreaterThan(0);
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const calls = await page.evaluate(() => (
    window as unknown as { __batchRefreshCenterCalls: Record<string, number> }
  ).__batchRefreshCenterCalls);
  expect(Object.values(calls)).toEqual(Object.values(calls).map(() => 0));
});

test("项目栏头部使用单行等尺寸图标且搜索可展开", async ({ page }) => {
  await openApp(page);

  const readTooltipVisual = (selector: ReturnType<Page["locator"]>) => selector.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      color: style.color,
      fontSize: style.fontSize,
      padding: style.padding
    };
  });

  const metrics = await page.evaluate(() => {
    const search = document.querySelector<HTMLElement>(".project-rail-search")!;
    const searchInput = search.querySelector<HTMLInputElement>("input")!;
    const title = document.querySelector<HTMLElement>(".project-rail-header > strong")!;
    const headerControls = Array.from(document.querySelectorAll<HTMLElement>(".project-rail-actions .compact-icon"));
    const controlRects = headerControls.map((control) => control.getBoundingClientRect());
    const titleRect = title.getBoundingClientRect();
    return {
      searchWidth: search.getBoundingClientRect().width,
      searchInputOpacity: getComputedStyle(searchInput).opacity,
      controlCount: controlRects.length,
      controlWidthSpread: Math.max(...controlRects.map((rect) => rect.width)) - Math.min(...controlRects.map((rect) => rect.width)),
      controlTopSpread: Math.max(...controlRects.map((rect) => rect.top)) - Math.min(...controlRects.map((rect) => rect.top)),
      titleOverlapsControls: titleRect.width > 0 && titleRect.right > controlRects[0].left
    };
  });

  expect(metrics.searchWidth).toBeLessThanOrEqual(44);
  expect(metrics.searchInputOpacity).toBe("0");
  expect(metrics.controlCount).toBe(5);
  expect(metrics.controlWidthSpread).toBeLessThanOrEqual(1);
  expect(metrics.controlTopSpread).toBeLessThanOrEqual(1);
  expect(metrics.titleOverlapsControls).toBe(false);

  const searchControl = page.locator(".project-rail-search");
  const filterButton = page.getByRole("button", { name: "筛选项目：全部状态" });
  await expect(searchControl).toHaveCSS("cursor", "pointer");
  expect(await searchControl.getAttribute("title")).toBeNull();
  expect(await filterButton.getAttribute("title")).toBeNull();

  const scanButton = page.getByRole("button", { name: "扫描父目录中的 Git 项目" });
  const scanTooltip = page.locator('[role="tooltip"]').filter({ hasText: "扫描父目录中的 Git 项目" });
  await scanButton.hover();
  await expect(scanTooltip).toBeVisible();
  const referenceTooltipVisual = await readTooltipVisual(scanTooltip);

  await searchControl.hover();
  const searchTooltip = page.locator('[role="tooltip"]').filter({ hasText: "搜索项目" });
  await expect(searchTooltip).toBeVisible();
  expect(await readTooltipVisual(searchTooltip)).toEqual(referenceTooltipVisual);

  await filterButton.hover();
  const filterTooltip = page.locator('[role="tooltip"]').filter({ hasText: "筛选项目：全部状态" });
  await expect(filterTooltip).toBeVisible();
  expect(await readTooltipVisual(filterTooltip)).toEqual(referenceTooltipVisual);

  await searchControl.click();
  const searchInput = page.getByRole("textbox", { name: "搜索项目" });
  await expect(searchInput).toBeFocused();
  await expect.poll(async () => searchInput.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(80);
  const focusVisual = await searchControl.evaluate((element) => {
    const controlStyle = getComputedStyle(element);
    const inputStyle = getComputedStyle(element.querySelector("input")!);
    return {
      controlBoxShadow: controlStyle.boxShadow,
      inputBoxShadow: inputStyle.boxShadow,
      inputOutlineWidth: inputStyle.outlineWidth
    };
  });
  expect(focusVisual.controlBoxShadow).not.toContain("0px 0px 0px 3px");
  expect(focusVisual.inputBoxShadow).toBe("none");
  expect(focusVisual.inputOutlineWidth).toBe("0px");

  await page.mouse.move(0, 0);
  await searchInput.hover();
  await expect(searchTooltip).toBeVisible();
  expect(await readTooltipVisual(searchTooltip)).toEqual(referenceTooltipVisual);

  await page.locator(".workspace-shell").click({ position: { x: 518, y: 3 } });
  await expect(searchInput).not.toBeFocused();
  await expect.poll(async () => searchControl.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(44);
});

test("标题栏常驻居中显示当前项目名称", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(".project-rail-item.active")).toBeVisible();
  const currentProject = page.getByLabel("当前项目：Git UI Pro");
  await expect(currentProject).toBeVisible();
  await expect(currentProject).toHaveText("Git UI Pro");
  await expect(currentProject.locator("svg")).toHaveCount(0);

  const metrics = await page.evaluate(() => {
    const label = document.querySelector<HTMLElement>(".app-chrome-current-project")!.getBoundingClientRect();
    const titlebar = document.querySelector<HTMLElement>(".app-chrome-titlebar")!.getBoundingClientRect();
    const dragRegion = document.querySelector<HTMLElement>(".app-chrome-drag-region")!.getBoundingClientRect();
    const tools = document.querySelector<HTMLElement>(".app-chrome-tools")!.getBoundingClientRect();
    const controls = document.querySelector<HTMLElement>(".app-window-controls")!.getBoundingClientRect();
    const style = getComputedStyle(document.querySelector<HTMLElement>(".app-chrome-current-project")!);
    return {
      centerDelta: Math.abs((label.left + label.right) / 2 - (dragRegion.left + dragRegion.right) / 2),
      verticalCenterDelta: Math.abs((label.top + label.bottom) / 2 - (titlebar.top + titlebar.bottom) / 2),
      clearsTools: label.left >= tools.right,
      clearsWindowControls: label.right <= controls.left,
      labelInsideTitlebar: label.top >= titlebar.top && label.bottom <= titlebar.bottom,
      controlsInsideTitlebar: controls.top >= titlebar.top && controls.bottom <= titlebar.bottom,
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      paddingLeft: style.paddingLeft,
      fontWeight: style.fontWeight,
      lineHeight: Number.parseFloat(style.lineHeight),
      fontSize: Number.parseFloat(style.fontSize)
    };
  });
  expect(metrics.centerDelta).toBeLessThanOrEqual(1);
  expect(metrics.verticalCenterDelta).toBeLessThanOrEqual(1);
  expect(metrics.clearsTools).toBe(true);
  expect(metrics.clearsWindowControls).toBe(true);
  expect(metrics.labelInsideTitlebar).toBe(true);
  expect(metrics.controlsInsideTitlebar).toBe(true);
  expect(metrics.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.borderTopWidth).toBe("0px");
  expect(metrics.boxShadow).toBe("none");
  expect(metrics.paddingLeft).toBe("0px");
  expect(metrics.fontSize).toBe(13);
  expect(metrics.fontWeight).toBe("700");
  expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.4);

  await page.getByRole("button", { name: "收起项目栏" }).click();
  await expect(currentProject).toBeVisible();
  await page.getByRole("button", { name: "展开项目栏" }).click();
  await expect(currentProject).toBeVisible();
});

test("未跟踪文件通过行内图标添加到 gitignore 并刷新更改列表", async ({ page }) => {
  await page.goto("/");
  const fileRow = page.locator(".scm-file-row").filter({ hasText: "app.css" }).first();
  await expect(fileRow).toBeVisible();
  await expect(fileRow.locator(".scm-file-status")).toHaveText("U");

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __gitignoreWrite?: { content: string; expectedRevision: string };
    };
    window.gitUI = {
      readGitIgnore: async () => ({ exists: false, content: "", revision: "missing" }),
      writeGitIgnore: async (_repository, content, expectedRevision) => {
        testWindow.__gitignoreWrite = { content, expectedRevision };
        return true;
      },
      getProjectStatus: async () => ({
        currentBranch: "master",
        upstream: "origin/master",
        ahead: 1,
        behind: 0,
        stagedCount: 1,
        unstagedCount: 2,
        untrackedCount: 0,
        conflictedCount: 0,
        hasConflicts: false
      }),
      getWorktree: async () => ({
        stagedFiles: [{ path: "docs/PRD.md", status: "added", staged: true }],
        unstagedFiles: [
          { path: "src/App.tsx", status: "modified", staged: false },
          { path: "electron/gitService.ts", status: "modified", staged: false }
        ]
      })
    } as unknown as typeof window.gitUI;
  });

  await fileRow.click({ button: "right" });
  await expect(page.locator(".scm-file-context-menu")).toHaveCount(0);
  const rowActionButtons = fileRow.locator(".scm-row-actions button");
  await expect(rowActionButtons).toHaveCount(3);
  expect(await rowActionButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
    "暂存更改",
    "添加到 .gitignore",
    "放弃更改"
  ]);
  await fileRow.hover();
  await fileRow.getByRole("button", { name: "添加到 .gitignore" }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __gitignoreWrite?: unknown }).__gitignoreWrite))).toBe(true);
  const write = await page.evaluate(() => (window as typeof window & {
    __gitignoreWrite: { content: string; expectedRevision: string };
  }).__gitignoreWrite);
  expect(write).toEqual({ content: "/src/styles/app.css\n", expectedRevision: "missing" });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "已添加到 .gitignore" })).toBeVisible();
  await expect(fileRow).toBeHidden();
});

test("图表工具栏拖到最小宽度仍显示全部操作", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const toolbar = page.locator(".graph-toolbar");
  await expect(toolbar).toBeVisible();

  const divider = page.locator(".detail-resize");
  const dividerBox = await divider.boundingBox();
  expect(dividerBox).not.toBeNull();
  await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + 160);
  await page.mouse.down();
  await page.mouse.move(dividerBox!.x - 300, dividerBox!.y + 160);
  await page.mouse.up();
  await expect.poll(() => page.locator(".app-shell").evaluate((element) => getComputedStyle(element).getPropertyValue("--detail-width").trim())).toBe("400px");
  await expect.poll(() => page.locator(".source-control-pane").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(401);

  const metrics = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".source-control-pane")!;
    const toolbarElement = document.querySelector<HTMLElement>(".graph-toolbar")!;
    const toolbarRect = toolbarElement.getBoundingClientRect();
    const actions = Array.from(toolbarElement.children).filter((element) => getComputedStyle(element).display !== "none");
    const actionRects = actions.map((element) => element.getBoundingClientRect());
    const referenceLabel = toolbarElement.querySelector<HTMLElement>(".graph-ref-filter-button span")!;
    return {
      paneWidth: pane.getBoundingClientRect().width,
      actionCount: actions.length,
      buttonCount: toolbarElement.querySelectorAll("button").length,
      gap: Number.parseFloat(getComputedStyle(toolbarElement).gap),
      referenceLabelDisplay: getComputedStyle(referenceLabel).display,
      firstActionLeft: Math.min(...actionRects.map((rect) => rect.left)),
      lastActionRight: Math.max(...actionRects.map((rect) => rect.right)),
      toolbarLeft: toolbarRect.left,
      toolbarRight: toolbarRect.right
    };
  });

  expect(metrics.paneWidth).toBeGreaterThanOrEqual(399);
  expect(metrics.paneWidth).toBeLessThanOrEqual(401);
  expect(metrics.actionCount).toBe(9);
  expect(metrics.buttonCount).toBe(9);
  expect(metrics.gap).toBeLessThanOrEqual(1);
  expect(metrics.referenceLabelDisplay).not.toBe("none");
  expect(metrics.firstActionLeft).toBeGreaterThanOrEqual(metrics.toolbarLeft - 1);
  expect(metrics.lastActionRight).toBeLessThanOrEqual(metrics.toolbarRight + 1);
});

test("项目内搜索框统一使用无蓝色外圈的焦点状态", async ({ page }) => {
  await openApp(page);

  async function expectNeutralSearchFocus(containerSelector: string) {
    const container = page.locator(containerSelector);
    const input = container.locator("input");
    await expect(container).toBeVisible();
    await input.focus();
    await expect(input).toBeFocused();

    const visual = await container.evaluate((element) => {
      const containerStyle = getComputedStyle(element);
      const inputStyle = getComputedStyle(element.querySelector("input")!);
      return {
        containerBoxShadow: containerStyle.boxShadow,
        inputBoxShadow: inputStyle.boxShadow,
        inputOutlineWidth: inputStyle.outlineWidth
      };
    });

    expect(visual.containerBoxShadow).not.toMatch(/0px 0px 0px [23]px/);
    expect(visual.inputBoxShadow).toBe("none");
    expect(visual.inputOutlineWidth).toBe("0px");
  }

  await page.locator(".project-rail-branch").first().click();
  const branchDialog = page.getByRole("dialog", { name: "切换分支" });
  await expect(branchDialog).toBeVisible();
  await expectNeutralSearchFocus('.branch-dialog[aria-label="切换分支"] .branch-search');
  await branchDialog.getByTitle("关闭").click();

  await page.getByRole("button", { name: "搜索提交" }).click();
  await expectNeutralSearchFocus(".graph-search");
  const graphSearchLayout = await page.evaluate(() => {
    const panelRect = document.querySelector<HTMLElement>(".graph-panel")!.getBoundingClientRect();
    const rowRect = document.querySelector<HTMLElement>(".graph-search-row")!.getBoundingClientRect();
    const searchRect = document.querySelector<HTMLElement>(".graph-search")!.getBoundingClientRect();
    const inputRect = document.querySelector<HTMLElement>(".graph-search input")!.getBoundingClientRect();
    const listRect = document.querySelector<HTMLElement>(".graph-commit-list")!.getBoundingClientRect();
    return {
      rowBottom: rowRect.bottom,
      listTop: listRect.top,
      searchLeft: searchRect.left,
      searchRight: searchRect.right,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      inputWidth: inputRect.width
    };
  });
  expect(graphSearchLayout.rowBottom).toBeLessThanOrEqual(graphSearchLayout.listTop + 1);
  expect(graphSearchLayout.searchLeft).toBeGreaterThanOrEqual(graphSearchLayout.panelLeft);
  expect(graphSearchLayout.searchRight).toBeLessThanOrEqual(graphSearchLayout.panelRight);
  expect(graphSearchLayout.inputWidth).toBeGreaterThan(100);

  await page.getByRole("button", { name: "选择图表引用" }).click();
  const refsDialog = page.getByRole("dialog", { name: "选择图表引用" });
  await expect(refsDialog).toBeVisible();
  await expectNeutralSearchFocus(".graph-refs-search");
  await refsDialog.getByRole("button", { name: "关闭引用选择" }).click();

  await page.getByRole("button", { name: "命令历史" }).click();
  await expectNeutralSearchFocus(".console-history-search");
});

test("远程项目可以暂停后台连接并从暂停页重新开启", async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByRole("button", { name: "连接远程 Git 项目" }).click();

  const dialog = page.getByRole("dialog", { name: "连接远程仓库" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("SSH 主机").fill("offline.example.com");
  await dialog.getByLabel("仓库绝对路径").fill("/srv/projects/Payload-SDK-3.16.0");
  await dialog.getByRole("button", { name: "连接并添加" }).click();
  await expect(dialog).toBeHidden();

  const projectRow = page.locator(".project-rail-item", { hasText: "Payload-SDK-3.16.0" });
  await expect(projectRow).toBeVisible();
  const sidebarResize = page.locator(".sidebar-resize");
  const resizeBox = await sidebarResize.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + 120);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x - 80, resizeBox!.y + 120);
  await page.mouse.up();
  await expect.poll(() => page.locator(".app-shell").evaluate((element) => getComputedStyle(element).getPropertyValue("--sidebar-width").trim())).toBe("180px");

  const connectionSwitch = projectRow.getByRole("switch", { name: "关闭 Payload-SDK-3.16.0 的远程连接" });
  await expect(connectionSwitch).toBeChecked();
  await connectionSwitch.click();

  await expect(projectRow.getByRole("switch", { name: "开启 Payload-SDK-3.16.0 的远程连接" })).not.toBeChecked();
  await expect(projectRow).toContainText("连接已暂停");
  await expect(projectRow).toContainText("已暂停");
  const pausedNotice = page.getByRole("region", { name: "远程连接已暂停" });
  await expect(pausedNotice).toBeVisible();
  await expect(pausedNotice).toContainText("不会在后台轮询服务器");
  const narrowLayout = await projectRow.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const name = element.querySelector<HTMLElement>(".project-rail-name")!.getBoundingClientRect();
    const branch = element.querySelector<HTMLElement>(".project-rail-branch")!.getBoundingClientRect();
    const branchLabel = element.querySelector<HTMLElement>(".project-rail-branch span")!;
    const connection = element.querySelector<HTMLElement>(".project-remote-connection-switch")!.getBoundingClientRect();
    return {
      itemRight: item.right,
      connectionRight: connection.right,
      nameTop: name.top,
      branchTop: branch.top,
      connectionTop: connection.top,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      statusCount: element.querySelectorAll(".project-status").length,
      branchLabelDisplay: getComputedStyle(branchLabel).display
    };
  });
  expect(narrowLayout.connectionRight).toBeLessThanOrEqual(narrowLayout.itemRight);
  expect(Math.abs(narrowLayout.nameTop - narrowLayout.connectionTop)).toBeLessThanOrEqual(2);
  expect(narrowLayout.branchTop).toBeGreaterThan(narrowLayout.connectionTop);
  expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth);
  expect(narrowLayout.statusCount).toBe(0);
  expect(narrowLayout.branchLabelDisplay).not.toBe("none");
  await page.mouse.move(700, 700);
  await page.waitForTimeout(2_100);
  const pausedScreenshot = testInfo.outputPath("remote-connection-paused-narrow.png");
  await page.screenshot({ path: pausedScreenshot, fullPage: false });
  await testInfo.attach("remote-connection-paused-narrow", {
    path: pausedScreenshot,
    contentType: "image/png"
  });

  await pausedNotice.getByRole("button", { name: "开启远程连接" }).click();
  await expect(pausedNotice).toBeHidden();
  await expect(projectRow.getByRole("switch", { name: "关闭 Payload-SDK-3.16.0 的远程连接" })).toBeChecked();
});

for (const viewport of [
  { width: 850, height: 900 },
  { width: 700, height: 820 }
]) {
  test(`${viewport.width}x${viewport.height} 选择工作区文件后详情区仍在视口内`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    await openFirstWorktreeFile(page);

    const detail = page.locator(".editor-detail-panel:not(.empty)");
    const rect = await detail.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThanOrEqual(180);
    expect(rect!.height).toBeGreaterThanOrEqual(120);
    expect(rect!.x).toBeLessThan(viewport.width);
    expect(rect!.y).toBeLessThan(viewport.height);
    expect(rect!.x + rect!.width).toBeGreaterThan(0);
    expect(rect!.y + rect!.height).toBeGreaterThan(0);
    await expect(detail.getByRole("tab").first()).toBeVisible();
  });
}

test("键盘可以打开仓库中心并操作焦点和项目菜单", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".console-tab.active .console-tab-tooltip > .sr-only")).toContainText("Mock Shell");

  const repositoryButton = page.getByRole("button", { name: "打开仓库中心" });
  await repositoryButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /git ui pro/i });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(repositoryButton).toBeFocused();

  const project = page.locator(".project-rail-item").first();
  await project.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuItems = menu.locator("[role^='menuitem']");
  await expect(menuItems.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(project).toBeFocused();
});

test("项目右键菜单可以快速调整分组", async ({ page }) => {
  await page.goto("/");
  const project = page.locator(".project-rail-item").filter({ hasText: "Git UI Pro" }).first();
  await expect(project).toBeVisible();
  await project.click({ button: "right" });

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("项目分组");
  await expect(menu.getByRole("menuitemradio", { name: "个人项目" })).toHaveAttribute("aria-checked", "true");

  await menu.getByRole("menuitemradio", { name: "工作项目" }).click();
  await expect(menu).toBeHidden();
  const workGroup = page.locator(".project-rail-group").filter({
    has: page.locator(".project-rail-group-header").filter({ hasText: "工作项目" })
  });
  await expect(workGroup.locator(".project-rail-item").filter({ hasText: "Git UI Pro" })).toBeVisible();
  await expect(page.getByLabel("Notifications alt+T").getByText("已更新项目分组")).toBeVisible();
});

test("项目和分组名称可从右键菜单进入原位编辑", async ({ page }) => {
  await page.goto("/");
  const project = page.locator(".project-rail-item").filter({ hasText: "Git UI Pro" }).first();
  await project.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名项目" }).click();

  const projectNameInput = page.getByRole("textbox", { name: "修改项目名称：Git UI Pro" });
  await expect(projectNameInput).toBeVisible();
  await expect(projectNameInput).toBeFocused();
  await projectNameInput.fill("Git UI Pro 桌面端");
  await projectNameInput.press("Enter");
  await expect(project.locator(".project-rail-name-text")).toHaveText("Git UI Pro 桌面端");
  await expect(page.getByLabel("Notifications alt+T").getByText("已重命名项目")).toBeVisible();

  const groupHeader = page.locator(".project-rail-group-header").filter({ hasText: "个人项目" });
  await groupHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名分组" }).click();

  const groupNameInput = page.getByRole("textbox", { name: "修改项目分组名称：个人项目" });
  await expect(groupNameInput).toBeFocused();
  await groupNameInput.fill("桌面工具");
  await groupNameInput.press("Enter");
  await expect(page.locator(".project-rail-group-header").filter({ hasText: "桌面工具" })).toBeVisible();
  await expect(page.getByLabel("Notifications alt+T").getByText("已重命名项目分组")).toBeVisible();
});

test("提交信息草稿按项目隔离并在切回后恢复", async ({ page }) => {
  await page.goto("/");
  const messageInput = page.locator(".scm-commit-box textarea");
  const gitUiProject = page.locator(".project-rail-item").filter({ hasText: "Git UI Pro" }).first();
  const clientProject = page.locator(".project-rail-item").filter({ hasText: "Client Admin" }).first();

  await expect(messageInput).toBeVisible();
  await messageInput.fill("Git UI Pro 的提交草稿");

  await clientProject.click();
  await expect(messageInput).toHaveValue("");
  await expect(messageInput).toHaveAttribute("placeholder", /release\/2\.4/);
  await messageInput.fill("Client Admin 的提交草稿");

  await gitUiProject.click();
  await expect(messageInput).toHaveValue("Git UI Pro 的提交草稿");

  await clientProject.click();
  await expect(messageInput).toHaveValue("Client Admin 的提交草稿");
});

test("加载更多提交期间不重复显示加载入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".graph-commit-row").first()).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __finishHistoryLoad?: () => void;
      __historyLoadPending?: boolean;
    };
    const commit = {
      hash: "1111111111111111111111111111111111111111",
      shortHash: "1111111",
      parents: [],
      subject: "用于验证分页加载状态的提交",
      body: "分页请求完成前不应重复展示加载入口。",
      authorName: "UI Test",
      authorEmail: "ui-test@example.com",
      authorDate: "2026/08/20 10:00",
      committerName: "UI Test",
      committerEmail: "ui-test@example.com",
      committerDate: "2026/08/20 10:00",
      refs: [],
      lane: 0,
      color: "#2f9af8",
      files: []
    };
    const firstPage = { commits: [commit], hasMore: true, nextSkip: 1 };
    const lastPage = { commits: [], hasMore: false, nextSkip: 1 };
    window.gitUI = {
      getHistoryPage: async (_repository, query) => {
        if ((query.skip ?? 0) === 0) {
          return firstPage;
        }

        testWindow.__historyLoadPending = true;
        return new Promise((resolve) => {
          testWindow.__finishHistoryLoad = () => {
            testWindow.__historyLoadPending = false;
            resolve(lastPage);
          };
        });
      },
      getHistoryRefs: async () => []
    } as unknown as typeof window.gitUI;
  });

  await page.getByRole("button", { name: "选择图表引用" }).click();
  await page.getByRole("dialog", { name: "选择图表引用" }).getByRole("menuitemradio", { name: /全部/ }).click();
  const loadMore = page.getByRole("button", { name: "加载更多提交" });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __historyLoadPending?: boolean }).__historyLoadPending))).toBe(true);
  await expect(loadMore).toBeHidden();
  await page.evaluate(() => (window as typeof window & { __finishHistoryLoad?: () => void }).__finishHistoryLoad?.());
  await expect(page.locator(".graph-history-end")).toBeVisible();
});

test("文件对比铺满详情区并高亮行内变更", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.goto("/");
  const modifiedFile = page.locator(".scm-file-row").filter({ hasText: "App.tsx" }).first();
  await expect(modifiedFile).toBeVisible();
  await modifiedFile.click();

  const diffPanel = page.locator(".editor-diff-panel.split-mode");
  const diffGrid = diffPanel.locator(".split-diff-grid");
  await expect(diffGrid).toBeVisible();
  await expect(diffGrid.locator(".split-diff-inline-change")).toHaveCount(2);

  const metrics = await diffPanel.evaluate((panel) => {
    const grid = panel.querySelector<HTMLElement>(".split-diff-grid")!;
    const panelRect = panel.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      panelClientHeight: panel.clientHeight,
      panelContentWidth: panel.clientWidth - Number.parseFloat(window.getComputedStyle(panel).paddingRight),
      gridHeight: gridRect.height,
      gridWidth: gridRect.width,
      horizontalInset: gridRect.left - panelRect.left
    };
  });

  expect(metrics.horizontalInset).toBeLessThanOrEqual(1);
  expect(metrics.gridWidth).toBeGreaterThanOrEqual(metrics.panelContentWidth - 1);
  expect(metrics.gridHeight).toBeGreaterThanOrEqual(metrics.panelClientHeight - 16);
});

test("窄屏文件对比自动切换行内布局并在空间恢复后返回左右布局", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto("/");
  const modifiedFile = page.locator(".scm-file-row").filter({ hasText: "App.tsx" }).first();
  await expect(modifiedFile).toBeVisible();
  await modifiedFile.click();

  const diffPanel = page.locator(".editor-diff-panel");
  await expect(diffPanel).toBeVisible();
  await expect(diffPanel).not.toHaveClass(/split-mode/);
  await expect(diffPanel.locator(".diff-lines")).toBeVisible();
  expect(await diffPanel.evaluate((panel) => panel.clientWidth - Number.parseFloat(window.getComputedStyle(panel).paddingRight))).toBeLessThan(960);

  await page.getByRole("button", { name: "收起项目栏" }).click();
  await expect(diffPanel).toHaveClass(/split-mode/);
  await expect(diffPanel.locator(".split-diff-grid")).toBeVisible();
  expect(await diffPanel.evaluate((panel) => panel.clientWidth - Number.parseFloat(window.getComputedStyle(panel).paddingRight))).toBeGreaterThanOrEqual(960);
});

test("长文件对比使用整文件宽度并保持虚拟滚动高度稳定", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 720 });
  await page.goto("/");
  const modifiedFile = page.locator(".scm-file-row").filter({ hasText: "App.tsx" }).first();
  await expect(modifiedFile).toBeVisible();
  await page.getByRole("button", { name: "隐藏控制台" }).click();
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __diffMeasureTextCalls?: number };
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    testWindow.__diffMeasureTextCalls = 0;
    CanvasRenderingContext2D.prototype.measureText = function measureDiffText(text) {
      testWindow.__diffMeasureTextCalls = (testWindow.__diffMeasureTextCalls ?? 0) + 1;
      return originalMeasureText.call(this, text);
    };
    const diffLines = Array.from({ length: 650 }, (_, index) => ({
      type: index === 100 || index === 620 ? "add" as const : "context" as const,
      oldLineNumber: index === 100 || index === 620 ? undefined : index + 1,
      newLineNumber: index + 1,
      content: index === 620 ? `const wholeFileWidth = "${"x".repeat(420)}";` : `const line${index + 1} = ${index + 1};`
    }));
    window.gitUI = {
      getWorktreeFilePreview: async () => null,
      getWorktreeDiff: async () => diffLines,
      getWindowState: async () => ({ isMaximized: false, isFullScreen: false }),
      onWindowStateChange: () => () => undefined
    } as unknown as typeof window.gitUI;
  });

  await modifiedFile.click();
  const diffPanel = page.locator(".editor-diff-panel.split-mode");
  const horizontalScroll = page.locator(".split-diff-horizontal-scroll");
  const minimap = page.getByRole("scrollbar", { name: "文件差异概览" });
  await expect(diffPanel).toBeVisible();
  await expect(horizontalScroll).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(diffPanel.locator(".split-diff-cell.new .line-number").filter({ hasText: /^101$/ })).toBeVisible();
  const initialMetrics = await diffPanel.evaluate((panel) => ({
    scrollHeight: panel.scrollHeight,
    renderedRows: panel.querySelectorAll(".split-diff-row").length
  }));
  const horizontalRange = await horizontalScroll.evaluate((scroll) => scroll.scrollWidth - scroll.clientWidth);

  expect(initialMetrics.renderedRows).toBeLessThan(650);
  expect(horizontalRange).toBeGreaterThan(1_000);
  expect(await page.evaluate(() => (window as typeof window & { __diffMeasureTextCalls?: number }).__diffMeasureTextCalls ?? 0)).toBeLessThan(10);

  await minimap.focus();
  await minimap.press("End");
  await expect(diffPanel.locator(".split-diff-cell.new .line-number").filter({ hasText: /^650$/ })).toBeVisible();
  const minimapMax = await minimap.getAttribute("aria-valuemax");
  await expect.poll(() => minimap.getAttribute("aria-valuenow")).toBe(minimapMax);
  const longLineNumber = diffPanel.locator(".split-diff-cell.new .line-number").filter({ hasText: /^621$/ });
  await expect(longLineNumber).toBeVisible();
  const longLineCell = longLineNumber.locator("..");
  const renderedLongLineRange = await longLineCell.evaluate((cell) => {
    const wrap = cell.querySelector<HTMLElement>(".split-diff-code-wrap")!;
    const code = cell.querySelector<HTMLElement>(".split-diff-code-text")!;
    return code.scrollWidth - wrap.clientWidth;
  });
  const bottomScrollHeight = await diffPanel.evaluate((panel) => panel.scrollHeight);
  expect(Math.abs(horizontalRange - renderedLongLineRange)).toBeLessThanOrEqual(2);
  expect(Math.abs(bottomScrollHeight - initialMetrics.scrollHeight)).toBeLessThanOrEqual(1);
});

test("打开提交文件时使用圆形加载状态且不闪现空 diff 提示", async ({ page }) => {
  await page.goto("/");
  const firstCommit = page.locator(".graph-commit-row").first();
  await expect(firstCommit).toBeVisible();
  await firstCommit.click();

  const changedFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  await expect(changedFile).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __commitDiffPending?: boolean;
      __finishCommitDiff?: () => void;
    };
    window.gitUI = {
      getCommitFilePreview: async () => null,
      getCommitDiff: async () => new Promise((resolve) => {
        testWindow.__commitDiffPending = true;
        testWindow.__finishCommitDiff = () => {
          testWindow.__commitDiffPending = false;
          resolve([
            { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "标题" },
            { type: "add", newLineNumber: 2, content: "新增内容" }
          ]);
        };
      }),
      getWindowState: async () => ({ isMaximized: false, isFullScreen: false }),
      onWindowStateChange: () => () => undefined
    } as unknown as typeof window.gitUI;
  });

  await changedFile.click();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __commitDiffPending?: boolean }).__commitDiffPending))).toBe(true);
  const loadingState = page.getByRole("status", { name: "正在加载文件对比：docs/PRD.md" });
  await expect(loadingState).toBeVisible();
  await expect(loadingState.locator(".editor-diff-loading-spinner")).toBeVisible();
  await expect(page.getByText("没有可显示的文本 diff。")).toBeHidden();

  await page.evaluate(() => (window as typeof window & { __finishCommitDiff?: () => void }).__finishCommitDiff?.());
  await expect(loadingState).toBeHidden();
  await expect(page.locator(".editor-diff-panel .diff-line")).toHaveCount(2);
});

test("Markdown 默认使用源码差异并可按需切换阅读视图", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();
  await page.evaluate(() => {
    window.gitUI = {
      getCommitFilePreview: async () => null,
      getCommitDiff: async () => [
        { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "# Markdown 阅读标题" },
        { type: "context", oldLineNumber: 2, newLineNumber: 2, content: "" },
        { type: "add", newLineNumber: 3, content: "- 第一项" },
        { type: "add", newLineNumber: 4, content: "- 第二项" }
      ]
    } as unknown as typeof window.gitUI;
  });

  await page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" }).click();
  const readButton = page.getByRole("button", { name: "阅读", exact: true });
  const sourceButton = page.getByRole("button", { name: "源码", exact: true });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".editor-diff-panel .diff-line")).toHaveCount(4);
  await expect(page.locator(".markdown-document")).toHaveCount(0);

  await readButton.click();
  await expect(page.locator(".markdown-document h1")).toHaveText("Markdown 阅读标题");
  await expect(page.locator(".markdown-document li")).toHaveCount(2);
  const markdownWidthUsage = await page.locator(".markdown-document").evaluate((documentElement) => {
    const panel = documentElement.closest(".editor-diff-panel");
    return panel ? documentElement.getBoundingClientRect().width / panel.getBoundingClientRect().width : 0;
  });
  expect(markdownWidthUsage).toBeGreaterThan(0.9);

  await sourceButton.click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".editor-diff-panel .diff-line")).toHaveCount(4);

  await readButton.click();
  await expect(page.locator(".markdown-document h1")).toHaveText("Markdown 阅读标题");
});

test("大型 Markdown 阅读排版可被源码切换打断并在触底时分批加载", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();
  await page.evaluate(() => {
    const longParagraph = "用于验证大型 Markdown 阅读排版不会锁死主界面的内容。".repeat(8);
    window.gitUI = {
      getCommitFilePreview: async () => null,
      getCommitDiff: async () => Array.from({ length: 4_000 }, (_, index) => ({
        type: "context" as const,
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
        content: index % 20 === 0 ? `## 第 ${index / 20 + 1} 节` : longParagraph
      }))
    } as unknown as typeof window.gitUI;
  });

  await page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" }).click();
  const readButton = page.getByRole("button", { name: "阅读", exact: true });
  const sourceButton = page.getByRole("button", { name: "源码", exact: true });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");

  await readButton.click();
  await sourceButton.click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");

  await readButton.click();
  const markdownDocument = page.locator(".markdown-document");
  const markdownBatches = page.locator(".markdown-document-batch");
  await expect(markdownDocument).toBeVisible();
  await expect(page.locator(".document-preview-footnote")).toContainText("向下滚动继续加载");
  await expect.poll(() => markdownBatches.count()).toBeGreaterThan(0);

  const initialBatchCount = await markdownBatches.count();
  const initialLoadedCharacters = Number(await markdownDocument.getAttribute("data-loaded-characters"));
  const totalCharacters = Number(await markdownDocument.getAttribute("data-total-characters"));
  expect(initialLoadedCharacters).toBeGreaterThan(0);
  expect(initialLoadedCharacters).toBeLessThan(totalCharacters);

  await markdownDocument.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => markdownBatches.count()).toBeGreaterThan(initialBatchCount);
  await expect.poll(async () => Number(await markdownDocument.getAttribute("data-loaded-characters"))).toBeGreaterThan(initialLoadedCharacters);
});

test("Word 和表格二进制文件在右侧使用专用阅读器", async ({ page }) => {
  const wordDataUrl = await createWordPreviewDataUrl();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["名称", "数量"],
    ["预览能力", 6],
    ["办公格式", "支持"]
  ]), "能力清单");
  const spreadsheetDataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${XLSX.write(workbook, { type: "base64", bookType: "xlsx" })}`;

  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();
  await page.evaluate(({ word, spreadsheet }) => {
    window.gitUI = {
      getCommitFilePreview: async (_repository, _hash, file) => file.path.endsWith(".md")
        ? {
            type: "document",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            dataUrl: word,
            sizeBytes: word.length,
            sourceDescription: "提交中的文件"
          }
        : {
            type: "spreadsheet",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            dataUrl: spreadsheet,
            sizeBytes: spreadsheet.length,
            sourceDescription: "提交中的文件"
          }
    } as unknown as typeof window.gitUI;
  }, { word: wordDataUrl, spreadsheet: spreadsheetDataUrl });

  const prdFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  const packageFile = page.locator(".graph-commit-file-row").filter({ hasText: "package.json" });
  await prdFile.click();
  await expect(page.locator(".word-document")).toContainText("Word 阅读预览");
  await expect(page.locator(".editor-diff-panel .diff-line")).toHaveCount(0);

  await packageFile.click();
  await expect(page.getByRole("region", { name: "package.json 表格预览" })).toBeVisible();
  await expect(page.locator(".spreadsheet-table")).toContainText("预览能力");
  await expect(page.locator(".spreadsheet-table")).toContainText("办公格式");
});

test("PDF 和演示文稿在右侧使用专用阅读器", async ({ page }) => {
  const pdfDataUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%%EOF", "utf8").toString("base64")}`;
  const presentationDataUrl = await createPresentationPreviewDataUrl();

  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();
  await page.evaluate(({ pdf, presentation }) => {
    window.gitUI = {
      getCommitFilePreview: async (_repository, _hash, file) => file.path.endsWith(".md")
        ? {
            type: "pdf",
            mimeType: "application/pdf",
            dataUrl: pdf,
            sizeBytes: pdf.length,
            sourceDescription: "提交中的文件"
          }
        : {
            type: "presentation",
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            dataUrl: presentation,
            sizeBytes: presentation.length,
            sourceDescription: "提交中的文件"
          }
    } as unknown as typeof window.gitUI;
  }, { pdf: pdfDataUrl, presentation: presentationDataUrl });

  const prdFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  const packageFile = page.locator(".graph-commit-file-row").filter({ hasText: "package.json" });
  await prdFile.click();
  await expect(page.locator(".pdf-preview-frame")).toBeVisible();
  await expect(page.locator(".document-preview-meta")).toContainText("内置 PDF 阅读器");

  await packageFile.click();
  await expect(page.locator(".presentation-slide-card")).toHaveCount(1);
  await expect(page.locator(".presentation-slide-card")).toContainText("演示文稿阅读预览");
});

test("快速切换提交文件时立即响应最后一次选择且旧请求不会覆盖", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();

  const prdFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  const packageFile = page.locator(".graph-commit-file-row").filter({ hasText: "package.json" });
  await expect(prdFile).toBeVisible();
  await expect(packageFile).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __cancelledCommitReadRequests?: string[];
      __slowCommitReadRequest?: string;
      __rejectSlowCommitDiff?: (error: Error) => void;
    };
    testWindow.__cancelledCommitReadRequests = [];
    window.gitUI = {
      getCommitFilePreview: async () => null,
      getCommitDiff: async (_repository, _hash, filePath, _knownFirstParent, readRequestId) => {
        if (filePath === "docs/PRD.md") {
          testWindow.__slowCommitReadRequest = readRequestId;
          return new Promise((_resolve, reject) => {
            testWindow.__rejectSlowCommitDiff = reject;
          });
        }
        return [{ type: "context", oldLineNumber: 1, newLineNumber: 1, content: "最后选择的 package.json" }];
      },
      cancelGitReadRequest: async (requestId) => {
        testWindow.__cancelledCommitReadRequests!.push(requestId);
        if (requestId === testWindow.__slowCommitReadRequest) {
          testWindow.__rejectSlowCommitDiff?.(new Error("文件对比加载已取消。"));
        }
        return true;
      }
    } as unknown as typeof window.gitUI;
  });

  await prdFile.click();
  await expect(page.getByRole("status", { name: "正在加载文件对比：docs/PRD.md" })).toBeVisible();
  await packageFile.click();

  await expect(packageFile).toHaveAttribute("aria-current", "true");
  await expect(packageFile).toBeFocused();
  await expect(page.getByText("最后选择的 package.json", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "正在加载文件对比：docs/PRD.md" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const testWindow = window as typeof window & {
      __cancelledCommitReadRequests?: string[];
      __slowCommitReadRequest?: string;
    };
    return testWindow.__cancelledCommitReadRequests?.includes(testWindow.__slowCommitReadRequest ?? "") ?? false;
  })).toBe(true);
  await expect(packageFile).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("最后选择的 package.json", { exact: true })).toBeVisible();
  await expect(page.getByText("较慢的第一个文件", { exact: true })).toBeHidden();
});

test("提交文件行使用上下键切换文件而不滚动整张图表", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();
  await page.evaluate(() => {
    window.gitUI = {
      getCommitFilePreview: async () => null,
      getCommitDiff: async (_repository, _hash, filePath) => [
        { type: "context", oldLineNumber: 1, newLineNumber: 1, content: `键盘打开 ${filePath}` }
      ]
    } as unknown as typeof window.gitUI;
  });

  const graphList = page.locator(".graph-commit-list");
  const prdFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  const packageFile = page.locator(".graph-commit-file-row").filter({ hasText: "package.json" });
  await prdFile.click();
  const initialScrollTop = await graphList.evaluate((element) => element.scrollTop);

  await prdFile.press("ArrowDown");
  await expect(packageFile).toBeFocused();
  await expect(packageFile).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("键盘打开 package.json", { exact: true })).toBeVisible();
  expect(await graphList.evaluate((element) => element.scrollTop)).toBe(initialScrollTop);

  await packageFile.press("ArrowUp");
  await expect(prdFile).toBeFocused();
  await expect(prdFile).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("键盘打开 docs/PRD.md", { exact: true })).toBeVisible();
  expect(await graphList.evaluate((element) => element.scrollTop)).toBe(initialScrollTop);
});

test("提交父行使用上下键只在提交之间切换", async ({ page }) => {
  await page.goto("/");
  const graphList = page.locator(".graph-commit-list");
  const commitRows = page.locator(".graph-commit-row");
  const firstCommit = commitRows.nth(0);
  const secondCommit = commitRows.nth(1);
  await firstCommit.click();
  const initialScrollTop = await graphList.evaluate((element) => element.scrollTop);

  await firstCommit.press("ArrowDown");
  await expect(secondCommit).toBeFocused();
  await expect(secondCommit).toHaveClass(/active/);
  await expect(secondCommit).toHaveAttribute("aria-expanded", "true");
  expect(await graphList.evaluate((element) => element.scrollTop)).toBe(initialScrollTop);

  await secondCommit.press("ArrowUp");
  await expect(firstCommit).toBeFocused();
  await expect(firstCommit).toHaveClass(/active/);
  await expect(firstCommit).toHaveAttribute("aria-expanded", "true");
  expect(await graphList.evaluate((element) => element.scrollTop)).toBe(initialScrollTop);
});

test("切换回已查看的提交文件时复用缓存", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();

  const prdFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  const packageFile = page.locator(".graph-commit-file-row").filter({ hasText: "package.json" });
  await expect(prdFile).toBeVisible();
  await expect(packageFile).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __commitPreviewCalls?: string[];
      __commitDiffCalls?: string[];
      __commitDiffParents?: Array<string | null | undefined>;
    };
    testWindow.__commitPreviewCalls = [];
    testWindow.__commitDiffCalls = [];
    testWindow.__commitDiffParents = [];
    window.gitUI = {
      getCommitFilePreview: async (_repository, _hash, file) => {
        testWindow.__commitPreviewCalls!.push(file.path);
        return null;
      },
      getCommitDiff: async (_repository, _hash, filePath, knownFirstParent) => {
        testWindow.__commitDiffCalls!.push(filePath ?? "");
        testWindow.__commitDiffParents!.push(knownFirstParent);
        return [{ type: "context", oldLineNumber: 1, newLineNumber: 1, content: `缓存 ${filePath}` }];
      }
    } as unknown as typeof window.gitUI;
  });

  await prdFile.click();
  await expect(page.getByText("缓存 docs/PRD.md", { exact: true })).toBeVisible();
  await packageFile.click();
  await expect(page.getByText("缓存 package.json", { exact: true })).toBeVisible();
  await prdFile.click();
  await expect(page.getByText("缓存 docs/PRD.md", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "正在加载文件对比：docs/PRD.md" })).toBeHidden();

  const calls = await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __commitPreviewCalls?: string[];
      __commitDiffCalls?: string[];
      __commitDiffParents?: Array<string | null | undefined>;
    };
    return {
      previews: testWindow.__commitPreviewCalls,
      diffs: testWindow.__commitDiffCalls,
      parents: testWindow.__commitDiffParents
    };
  });
  expect(calls.previews).toEqual(["docs/PRD.md", "package.json"]);
  expect(calls.diffs).toEqual(["docs/PRD.md", "package.json"]);
  expect(calls.parents).toEqual(["b13c48e", "b13c48e"]);
});

test("提交变更文件默认使用平铺列表视图", async ({ page }) => {
  await page.goto("/");
  const firstCommit = page.locator(".graph-commit-row").first();
  await expect(firstCommit).toBeVisible();
  await firstCommit.click();

  const expansion = page.locator(".graph-commit-expansion").first();
  await expect(expansion).toBeVisible();
  await expect(expansion.locator(".graph-commit-file-tree")).toHaveCount(0);
  await expect(expansion.locator(".graph-commit-folder-row")).toHaveCount(0);

  const changedFile = expansion.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  await expect(changedFile).toBeVisible();
  await expect(changedFile.locator(".graph-commit-file-dir")).toHaveText("docs");
});

test("提交文件列表突出显示当前预览文件", async ({ page }) => {
  await page.goto("/");
  await page.locator(".graph-commit-row").first().click();

  const changedFile = page.locator(".graph-commit-file-row").filter({ hasText: "PRD.md" });
  await expect(changedFile).toBeVisible();
  await expect(changedFile).not.toHaveClass(/active/);
  await expect(changedFile).not.toHaveAttribute("aria-current", "true");

  await changedFile.click();
  await expect(changedFile).toHaveClass(/active/);
  await expect(changedFile).toHaveAttribute("aria-current", "true");

  const selectedVisual = await changedFile.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    const row = element.getBoundingClientRect();
    const commitRow = element.closest(".graph-commit-entry")!.querySelector<HTMLElement>(".graph-commit-row")!.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      borderLeftColor: style.borderLeftColor,
      borderLeftWidth: style.borderLeftWidth,
      boxShadow: style.boxShadow,
      rowTop: row.top,
      commitRowBottom: commitRow.bottom
    };
  });
  expect(selectedVisual.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(selectedVisual.borderLeftWidth)).toBeGreaterThan(0);
  expect(selectedVisual.borderLeftColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(selectedVisual.boxShadow).not.toContain("inset");
  expect(selectedVisual.rowTop - selectedVisual.commitRowBottom).toBeGreaterThanOrEqual(2);
});

test("长提交悬浮详情在小窗口内滚动而不越界", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 320 });
  await page.goto("/");
  await expect(page.locator(".graph-commit-row").first()).toBeVisible();
  await page.locator(".graph-commit-row").first().hover();

  const card = page.locator(".commit-hover-card");
  await expect(card).toBeVisible();
  const heading = card.locator(".commit-hover-heading");
  const author = card.locator(".commit-hover-author");
  const subject = card.locator(".commit-hover-subject");
  const body = card.locator(".commit-hover-body");
  await expect(heading).toBeVisible();
  await expect(author).toBeVisible();
  await expect(subject).toBeVisible();
  await expect(body).toBeVisible();
  await body.evaluate((element) => {
    element.textContent = Array.from(
      { length: 40 },
      (_, index) => `${index + 1}. 这是用于验证超长提交说明在小窗口内滚动展示的回归文本。`
    ).join("\n");
  });

  await expect.poll(async () => card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0
      && rect.top >= 0
      && rect.right <= window.innerWidth + 1
      && rect.bottom <= window.innerHeight + 1;
  })).toBe(true);
  const headingMetrics = await card.evaluate((element) => {
    const headingElement = element.querySelector<HTMLElement>(".commit-hover-heading")!;
    const authorElement = element.querySelector<HTMLElement>(".commit-hover-author")!;
    const subjectElement = element.querySelector<HTMLElement>(".commit-hover-subject")!;
    const bodyElement = element.querySelector<HTMLElement>(".commit-hover-body")!;
    const cardRect = element.getBoundingClientRect();
    const headingRect = headingElement.getBoundingClientRect();
    const authorRect = authorElement.getBoundingClientRect();
    const subjectRect = subjectElement.getBoundingClientRect();
    const bodyRect = bodyElement.getBoundingClientRect();
    return {
      headingInsideCard: headingRect.top >= cardRect.top && headingRect.bottom <= cardRect.bottom,
      subjectBelowAuthor: subjectRect.top >= authorRect.bottom,
      bodyBelowHeading: bodyRect.top >= headingRect.bottom,
      subjectHeight: subjectRect.height,
      subjectLineHeight: Number.parseFloat(getComputedStyle(subjectElement).lineHeight)
    };
  });
  expect(headingMetrics.headingInsideCard).toBe(true);
  expect(headingMetrics.subjectBelowAuthor).toBe(true);
  expect(headingMetrics.bodyBelowHeading).toBe(true);
  expect(headingMetrics.subjectHeight).toBeGreaterThanOrEqual(headingMetrics.subjectLineHeight - 1);
  const metrics = await body.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
});

test("亮色和暗色主题保持关键文字可读并完成截图 smoke", async ({ page }, testInfo) => {
  await openApp(page);
  await expect(page.locator(".app-shell")).toHaveClass(/theme-light/);
  await captureThemeSmoke(page, testInfo, "light");

  await page.getByRole("button", { name: "主题" }).click();
  await page.getByRole("menuitemradio", { name: "黑暗" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/theme-dark/);
  await captureThemeSmoke(page, testInfo, "dark");
});
