import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X, Terminal as TerminalIcon } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { apiClient } from "../api/client";
import type { GitProject, TerminalSessionInfo } from "../types/domain";

type ThemeName = "light" | "dark";
type TerminalStatus = "starting" | "running" | "exited" | "error";

interface ConsolePanelProps {
  project?: GitProject;
  theme: ThemeName;
  visible: boolean;
  onHide: () => void;
}

interface TerminalTab {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  title: string;
  status: TerminalStatus;
  statusText: string;
  session?: TerminalSessionInfo;
}

interface TerminalRuntime {
  terminal: Terminal;
  fitAddon: FitAddon;
  inputSubscription: { dispose: () => void };
  host?: HTMLDivElement;
  opened: boolean;
  resizeObserver?: ResizeObserver;
  resizeFrame: number;
  sessionId?: string;
}

export function ConsolePanel({ project, theme, visible, onHide }: ConsolePanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const activeByProjectRef = useRef(new Map<string, string>());
  const runtimeByTabRef = useRef(new Map<string, TerminalRuntime>());
  const tabBySessionRef = useRef(new Map<string, string>());
  const terminalSeedRef = useRef(0);
  const themeRef = useRef<ThemeName>(theme);

  const projectTabs = useMemo(() => (project ? tabs.filter((tab) => tab.projectId === project.id) : []), [project, tabs]);
  const activeTab = useMemo(() => projectTabs.find((tab) => tab.id === activeTabId) ?? projectTabs[0] ?? null, [activeTabId, projectTabs]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTab?.id ?? activeTabId;
    if (activeTab) {
      activeByProjectRef.current.set(activeTab.projectId, activeTab.id);
    }
  }, [activeTab, activeTabId]);

  useEffect(() => {
    const unsubscribeData = apiClient.onTerminalData((event) => {
      const tabId = tabBySessionRef.current.get(event.sessionId);
      if (!tabId) {
        return;
      }

      runtimeByTabRef.current.get(tabId)?.terminal.write(event.data);
    });
    const unsubscribeExit = apiClient.onTerminalExit((event) => {
      const tabId = tabBySessionRef.current.get(event.sessionId);
      if (!tabId) {
        return;
      }

      tabBySessionRef.current.delete(event.sessionId);
      const runtime = runtimeByTabRef.current.get(tabId);
      if (runtime) {
        runtime.sessionId = undefined;
        runtime.terminal.writeln("");
        runtime.terminal.writeln(`[进程已退出：${event.exitCode ?? event.signal ?? "unknown"}]`);
      }

      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                status: "exited",
                statusText: "已退出"
              }
            : tab
        )
      );
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
      for (const tabId of Array.from(runtimeByTabRef.current.keys())) {
        disposeTerminalRuntime(tabId);
      }
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
    window.requestAnimationFrame(() => {
      const host = panelRef.current ?? document.documentElement;
      for (const runtime of runtimeByTabRef.current.values()) {
        runtime.terminal.options.theme = terminalTheme(host, themeRef.current);
      }
    });
  }, [theme]);

  useEffect(() => {
    if (!visible || !project) {
      return;
    }

    const currentTabs = tabsRef.current.filter((tab) => tab.projectId === project.id);
    const rememberedTabId = activeByProjectRef.current.get(project.id);
    const rememberedTab = currentTabs.find((tab) => tab.id === rememberedTabId);
    if (rememberedTab) {
      setActiveTabId(rememberedTab.id);
      return;
    }

    if (currentTabs.length > 0) {
      setActiveTabId(currentTabs[0].id);
      return;
    }

    createTerminalTab(project);
  }, [project?.id, visible]);

  useEffect(() => {
    if (!visible || !activeTab) {
      return;
    }

    fitAndResizeTab(activeTab.id);
    runtimeByTabRef.current.get(activeTab.id)?.terminal.focus();
  }, [activeTab?.id, visible]);

  function createTerminalTab(targetProject = project) {
    if (!targetProject) {
      return;
    }

    const tabId = `terminal-tab-${Date.now()}-${++terminalSeedRef.current}`;
    const tabNumber = tabsRef.current.filter((tab) => tab.projectId === targetProject.id).length + 1;
    const terminal = createTerminal(panelRef.current ?? document.documentElement, themeRef.current);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const inputSubscription = terminal.onData((data) => {
      const runtime = runtimeByTabRef.current.get(tabId);
      if (runtime?.sessionId) {
        void apiClient.writeTerminal(runtime.sessionId, data);
      }
    });

    runtimeByTabRef.current.set(tabId, {
      terminal,
      fitAddon,
      inputSubscription,
      opened: false,
      resizeFrame: 0
    });

    terminal.writeln("正在启动控制台...");

    const nextTab: TerminalTab = {
      id: tabId,
      projectId: targetProject.id,
      projectName: targetProject.name,
      projectPath: targetProject.path,
      title: `终端 ${tabNumber}`,
      status: "starting",
      statusText: "启动中"
    };

    setTabs((current) => [...current, nextTab]);
    setActiveTabId(tabId);
    activeByProjectRef.current.set(targetProject.id, tabId);

    void apiClient
      .startTerminal(targetProject)
      .then((session) => {
        const runtime = runtimeByTabRef.current.get(tabId);
        if (!runtime) {
          void apiClient.disposeTerminal(session.sessionId);
          return;
        }

        runtime.sessionId = session.sessionId;
        tabBySessionRef.current.set(session.sessionId, tabId);
        setTabs((current) =>
          current.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  session,
                  status: "running",
                  statusText: session.shell
                }
              : tab
          )
        );
        fitAndResizeTab(tabId);
        if (activeTabIdRef.current === tabId && visible) {
          runtime.terminal.focus();
        }
      })
      .catch((error) => {
        const runtime = runtimeByTabRef.current.get(tabId);
        runtime?.terminal.writeln(`启动控制台失败：${error instanceof Error ? error.message : "未知错误"}`);
        setTabs((current) =>
          current.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  status: "error",
                  statusText: "启动失败"
                }
              : tab
          )
        );
      });
  }

  function attachTerminalHost(tabId: string, node: HTMLDivElement | null) {
    if (!node) {
      return;
    }

    const runtime = runtimeByTabRef.current.get(tabId);
    if (!runtime || runtime.host === node) {
      return;
    }

    runtime.host = node;
    if (!runtime.opened) {
      runtime.terminal.open(node);
      runtime.opened = true;
    }

    runtime.resizeObserver?.disconnect();
    runtime.resizeObserver = new ResizeObserver(() => fitAndResizeTab(tabId));
    runtime.resizeObserver.observe(node);
    fitAndResizeTab(tabId);
  }

  function fitAndResizeTab(tabId: string) {
    const runtime = runtimeByTabRef.current.get(tabId);
    if (!runtime?.host || !isVisible(runtime.host)) {
      return;
    }

    window.cancelAnimationFrame(runtime.resizeFrame);
    runtime.resizeFrame = window.requestAnimationFrame(() => {
      if (!runtime.host || !isVisible(runtime.host)) {
        return;
      }

      try {
        runtime.fitAddon.fit();
        if (runtime.sessionId) {
          void apiClient.resizeTerminal(runtime.sessionId, runtime.terminal.cols, runtime.terminal.rows);
        }
      } catch {
        // Hidden terminals can report zero dimensions during layout transitions.
      }
    });
  }

  function handleSelectTab(tab: TerminalTab) {
    setActiveTabId(tab.id);
    activeByProjectRef.current.set(tab.projectId, tab.id);
  }

  function handleCloseTab(tabId: string) {
    const closingTab = tabsRef.current.find((tab) => tab.id === tabId);
    if (!closingTab) {
      return;
    }

    const remainingProjectTabs = tabsRef.current.filter((tab) => tab.projectId === closingTab.projectId && tab.id !== tabId);
    const closingIndex = tabsRef.current.findIndex((tab) => tab.id === tabId);
    const nextActiveTab =
      remainingProjectTabs.find((tab) => tabsRef.current.indexOf(tab) > closingIndex) ??
      remainingProjectTabs[remainingProjectTabs.length - 1] ??
      null;

    disposeTerminalRuntime(tabId);
    setTabs((current) => current.filter((tab) => tab.id !== tabId));

    if (nextActiveTab) {
      activeByProjectRef.current.set(closingTab.projectId, nextActiveTab.id);
    } else {
      activeByProjectRef.current.delete(closingTab.projectId);
    }

    if (activeTabIdRef.current === tabId) {
      setActiveTabId(nextActiveTab?.id ?? null);
    }
  }

  function clearActiveTerminal() {
    if (!activeTab) {
      return;
    }

    const runtime = runtimeByTabRef.current.get(activeTab.id);
    runtime?.terminal.clear();
    runtime?.terminal.focus();
  }

  function disposeTerminalRuntime(tabId: string) {
    const runtime = runtimeByTabRef.current.get(tabId);
    if (!runtime) {
      return;
    }

    window.cancelAnimationFrame(runtime.resizeFrame);
    runtime.resizeObserver?.disconnect();
    runtime.inputSubscription.dispose();
    if (runtime.sessionId) {
      tabBySessionRef.current.delete(runtime.sessionId);
      void apiClient.disposeTerminal(runtime.sessionId);
    }

    runtime.terminal.dispose();
    runtimeByTabRef.current.delete(tabId);
  }

  const activePath = activeTab?.session?.cwd ?? activeTab?.projectPath ?? project?.path ?? "未选择目录";

  return (
    <section className={`console-panel ${visible ? "" : "hidden"}`} aria-label="控制台" ref={panelRef}>
      <div className="console-title">
        <TerminalIcon size={15} />
        <span className="console-title-label">控制台</span>
        <div className="console-tab-strip" role="tablist" aria-label="终端标签">
          {projectTabs.map((tab) => (
            <div className={`console-tab ${tab.id === activeTab?.id ? "active" : ""}`} role="presentation" key={tab.id}>
              <button type="button" className="console-tab-main" role="tab" aria-selected={tab.id === activeTab?.id} title={tab.projectPath} onClick={() => handleSelectTab(tab)}>
                <span>{tab.title}</span>
                <small>{tab.statusText}</small>
              </button>
              <button type="button" className="console-tab-close" title="关闭终端" onClick={() => handleCloseTab(tab.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="console-tab-add" title="新建终端" onClick={() => createTerminalTab(project)} disabled={!project}>
            <Plus size={14} />
          </button>
        </div>
        <span className="console-context" title={activePath}>
          {activePath}
        </span>
        <button type="button" className="icon-button console-close" title="清空当前终端" onClick={clearActiveTerminal} disabled={!activeTab}>
          <Trash2 size={14} />
        </button>
        <button type="button" className="icon-button console-close" title="隐藏控制台" onClick={onHide}>
          <X size={15} />
        </button>
      </div>
      <div className="console-terminal-stack">
        {tabs.map((tab) => (
          <div
            className={`console-terminal ${visible && tab.id === activeTab?.id ? "active" : ""}`}
            key={tab.id}
            ref={(node) => attachTerminalHost(tab.id, node)}
          />
        ))}
        {visible && project && projectTabs.length === 0 ? (
          <div className="console-empty-state">
            <p>当前项目没有打开的终端。</p>
            <button type="button" className="text-button" onClick={() => createTerminalTab(project)}>
              新建终端
            </button>
          </div>
        ) : null}
        {visible && !project ? <div className="console-empty-state">选择一个项目后使用控制台。</div> : null}
      </div>
    </section>
  );
}

function createTerminal(host: HTMLElement, theme: ThemeName): Terminal {
  return new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.25,
    scrollback: 5000,
    theme: terminalTheme(host, theme)
  });
}

function terminalTheme(host: HTMLElement, theme: ThemeName) {
  const style = getComputedStyle(host);
  return {
    background: cssVar(style, "--sunken", theme === "dark" ? "#0d1116" : "#f8fafc"),
    foreground: cssVar(style, "--text", theme === "dark" ? "#e7edf2" : "#1b2530"),
    cursor: cssVar(style, "--accent", theme === "dark" ? "#51c2a9" : "#148f7a"),
    selectionBackground: theme === "dark" ? "rgba(143, 183, 255, 0.30)" : "rgba(36, 95, 189, 0.22)",
    black: theme === "dark" ? "#15191f" : "#d9e1ea",
    red: cssVar(style, "--danger", theme === "dark" ? "#ef6b73" : "#b23b48"),
    green: cssVar(style, "--success", theme === "dark" ? "#7bd88f" : "#187a3f"),
    yellow: cssVar(style, "--warning", theme === "dark" ? "#f0c36b" : "#9a6412"),
    blue: cssVar(style, "--blue", theme === "dark" ? "#8fb7ff" : "#245fbd"),
    magenta: theme === "dark" ? "#c084fc" : "#7c3aed",
    cyan: cssVar(style, "--accent", theme === "dark" ? "#51c2a9" : "#148f7a"),
    white: cssVar(style, "--text-strong", theme === "dark" ? "#f3f7fa" : "#0f1720")
  };
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && element.clientWidth > 0 && element.clientHeight > 0;
}
