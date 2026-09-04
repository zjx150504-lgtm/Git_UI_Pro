import { Check, ChevronDown, Copy, Minus, Moon, PanelLeftClose, PanelLeftOpen, Square, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WindowState } from "../types/electron";
import { AppUpdateControl } from "./AppUpdateControl";
import { PathTooltip } from "./PathTooltip";

/** In-app brand mark — SVG stays sharp at titlebar size (~22px). */
const APP_ICON_URL = new URL("../assets/git-ui-pro-mark.svg", import.meta.url).href;

interface AppChromeProps {
  onCommand: (command: string) => void;
  sidebarCollapsed: boolean;
  currentProjectName?: string;
  theme: "light" | "dark";
  onToggleSidebar: () => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onOpenRepositoryCenter: () => void;
}

export function AppChrome({
  onCommand,
  sidebarCollapsed,
  currentProjectName,
  theme,
  onToggleSidebar,
  onThemeChange,
  onOpenRepositoryCenter
}: AppChromeProps) {
  const [windowState, setWindowState] = useState<WindowState>({ isMaximized: false, isFullScreen: false });
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeControlRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!themeMenuOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !themeControlRef.current?.contains(target)) {
        setThemeMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setThemeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [themeMenuOpen]);

  function runCommand(command: string) {
    onCommand(command);
  }

  return (
    <header className="app-chrome">
      <div className="app-chrome-titlebar">
        <div className="app-chrome-brand" aria-label="Git UI Pro">
          <img src={APP_ICON_URL} alt="" draggable={false} />
        </div>
        <button
          type="button"
          className="app-chrome-sidebar-button"
          aria-label={sidebarCollapsed ? "展开项目栏" : "收起项目栏"}
          title={sidebarCollapsed ? "展开项目栏" : "收起项目栏"}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="app-chrome-tools" aria-label="应用工具">
          <PathTooltip content="打开仓库中心" className="app-chrome-settings-tooltip" showOnFocus={false}>
            <button type="button" className="app-chrome-settings-button" aria-label="打开仓库中心" onClick={onOpenRepositoryCenter}>
              设置
            </button>
          </PathTooltip>
          <div className="app-chrome-theme-control" ref={themeControlRef}>
            <button
              type="button"
              className="app-chrome-theme-button"
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
              onClick={() => setThemeMenuOpen((open) => !open)}
            >
              主题
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {themeMenuOpen ? (
              <div className="app-chrome-theme-menu" role="menu" aria-label="选择主题">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === "light"}
                  onClick={() => {
                    onThemeChange("light");
                    setThemeMenuOpen(false);
                  }}
                >
                  <Sun size={14} aria-hidden="true" />
                  <span>明亮</span>
                  {theme === "light" ? <Check size={13} aria-hidden="true" /> : null}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === "dark"}
                  onClick={() => {
                    onThemeChange("dark");
                    setThemeMenuOpen(false);
                  }}
                >
                  <Moon size={14} aria-hidden="true" />
                  <span>黑暗</span>
                  {theme === "dark" ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <AppUpdateControl />
        </div>
        {currentProjectName ? (
          <div
            className="app-chrome-current-project"
            aria-label={`当前项目：${currentProjectName}`}
            aria-live="polite"
            title={currentProjectName}
          >
            <span>{currentProjectName}</span>
          </div>
        ) : null}
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
