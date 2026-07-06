import { Copy, GitBranch, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WindowState } from "../types/electron";

interface AppChromeProps {
  onCommand: (command: string) => void;
}

export function AppChrome({ onCommand }: AppChromeProps) {
  const [windowState, setWindowState] = useState<WindowState>({ isMaximized: false, isFullScreen: false });
  const shouldRestore = windowState.isMaximized || windowState.isFullScreen;

  useEffect(() => {
    let cancelled = false;

    const statePromise = window.gitUI?.getWindowState?.();
    void statePromise?.then((state) => {
      if (!cancelled) {
        setWindowState(state);
      }
    });

    const unsubscribe = window.gitUI?.onWindowStateChange?.((state) => setWindowState(state));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  function runCommand(command: string) {
    onCommand(command);
  }

  return (
    <header className="app-chrome">
      <div className="app-chrome-titlebar">
        <div className="app-chrome-brand">
          <GitBranch size={14} />
          <span>Git UI Pro</span>
        </div>
        <div className="app-chrome-drag-region" />
        <div className="app-window-controls" aria-label="窗口控制">
          <button type="button" title="最小化" onClick={() => runCommand("window:minimize")}>
            <Minus size={14} />
          </button>
          <button type="button" title={shouldRestore ? "还原" : "最大化"} onClick={() => runCommand("window:toggleMaximize")}>
            {shouldRestore ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button type="button" className="close" title="关闭" onClick={() => runCommand("window:close")}>
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
