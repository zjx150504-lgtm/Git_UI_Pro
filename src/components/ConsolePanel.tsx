import { useEffect, useRef, useState } from "react";
import { Trash2, X, Terminal as TerminalIcon } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { apiClient } from "../api/client";
import type { GitProject, TerminalSessionInfo } from "../types/domain";

interface ConsolePanelProps {
  project?: GitProject;
  onClose: () => void;
}

export function ConsolePanel({ project, onClose }: ConsolePanelProps) {
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let resizeFrame = 0;
    const terminal = createTerminal(host);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitTerminal = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        fitAddon.fit();
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void apiClient.resizeTerminal(sessionId, terminal.cols, terminal.rows);
        }
      });
    };

    const inputSubscription = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void apiClient.writeTerminal(sessionId, data);
      }
    });
    const unsubscribeData = apiClient.onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });
    const unsubscribeExit = apiClient.onTerminalExit((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }

      terminal.writeln("");
      terminal.writeln(`[进程已退出：${event.exitCode ?? event.signal ?? "unknown"}]`);
      sessionIdRef.current = null;
      setSession(null);
    });
    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(host);

    terminal.writeln("正在启动控制台...");
    if (!project) {
      terminal.writeln("请选择一个 Git 项目后使用控制台。");
    } else {
      void apiClient
        .startTerminal(project)
        .then((nextSession) => {
          if (disposed) {
            void apiClient.disposeTerminal(nextSession.sessionId);
            return;
          }

          sessionIdRef.current = nextSession.sessionId;
          setSession(nextSession);
          fitTerminal();
          terminal.focus();
        })
        .catch((error) => {
          terminal.writeln(`启动控制台失败：${error instanceof Error ? error.message : "未知错误"}`);
        });
    }

    fitTerminal();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      inputSubscription.dispose();
      unsubscribeData();
      unsubscribeExit();

      if (sessionIdRef.current) {
        void apiClient.disposeTerminal(sessionIdRef.current);
      }

      sessionIdRef.current = null;
      setSession(null);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [project?.path]);

  function clearTerminal() {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }

  return (
    <section className="console-panel" aria-label="控制台">
      <div className="console-title">
        <TerminalIcon size={16} />
        控制台
        <span>{session?.cwd ?? project?.path ?? "未选择目录"}</span>
        <small>{session?.shell ?? "未启动"}</small>
        <button type="button" className="icon-button console-close" title="清空输出" onClick={clearTerminal}>
          <Trash2 size={14} />
        </button>
        <button type="button" className="icon-button console-close" title="关闭控制台" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="console-terminal" ref={terminalHostRef} />
    </section>
  );
}

function createTerminal(host: HTMLElement): Terminal {
  const style = getComputedStyle(host);
  return new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.25,
    scrollback: 5000,
    theme: {
      background: cssVar(style, "--sunken", "#101317"),
      foreground: cssVar(style, "--text", "#dfe7ef"),
      cursor: cssVar(style, "--accent", "#2f9e8f"),
      selectionBackground: "rgba(80, 140, 210, 0.32)"
    }
  });
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}
