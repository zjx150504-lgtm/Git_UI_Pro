import { GitBranch, Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface AppChromeProps {
  onCommand: (command: string) => void;
}

type ChromeMenu = {
  id: string;
  label: string;
  items: Array<{ label: string; command: string; separatorBefore?: boolean }>;
};

const chromeMenus: ChromeMenu[] = [
  {
    id: "file",
    label: "文件",
    items: [{ label: "退出", command: "app:quit" }]
  },
  {
    id: "edit",
    label: "编辑",
    items: [
      { label: "撤销", command: "edit:undo" },
      { label: "重做", command: "edit:redo" },
      { label: "剪切", command: "edit:cut", separatorBefore: true },
      { label: "复制", command: "edit:copy" },
      { label: "粘贴", command: "edit:paste" },
      { label: "全选", command: "edit:selectAll" }
    ]
  },
  {
    id: "view",
    label: "视图",
    items: [
      { label: "重新加载", command: "view:reload" },
      { label: "强制重新加载", command: "view:forceReload" },
      { label: "开发者工具", command: "view:toggleDevTools" },
      { label: "实际大小", command: "view:resetZoom", separatorBefore: true },
      { label: "放大", command: "view:zoomIn" },
      { label: "缩小", command: "view:zoomOut" },
      { label: "切换全屏", command: "view:toggleFullscreen", separatorBefore: true }
    ]
  },
  {
    id: "window",
    label: "窗口",
    items: [
      { label: "最小化", command: "window:minimize" },
      { label: "关闭窗口", command: "window:close" }
    ]
  },
  {
    id: "help",
    label: "帮助",
    items: [{ label: "关于 Git UI Pro", command: "help:about" }]
  }
];

export function AppChrome({ onCommand }: AppChromeProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenMenuId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenuId]);

  function runCommand(command: string) {
    setOpenMenuId(null);
    onCommand(command);
  }

  return (
    <header className="app-chrome" ref={rootRef}>
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
          <button type="button" title="最大化/还原" onClick={() => runCommand("window:toggleMaximize")}>
            <Square size={12} />
          </button>
          <button type="button" className="close" title="关闭" onClick={() => runCommand("window:close")}>
            <X size={14} />
          </button>
        </div>
      </div>
      <nav className="app-chrome-menu" aria-label="应用菜单">
        {chromeMenus.map((menu) => (
          <div className="app-chrome-menu-group" key={menu.id}>
            <button
              type="button"
              className={openMenuId === menu.id ? "active" : ""}
              aria-haspopup="menu"
              aria-expanded={openMenuId === menu.id}
              onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
            >
              {menu.label}
            </button>
            {openMenuId === menu.id ? (
              <div className="app-chrome-menu-popover" role="menu">
                {menu.items.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    className={item.separatorBefore ? "with-separator" : ""}
                    key={`${menu.id}-${item.command}`}
                    onClick={() => runCommand(item.command)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </header>
  );
}
