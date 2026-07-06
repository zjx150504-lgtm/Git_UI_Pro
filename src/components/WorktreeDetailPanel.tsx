import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent as ReactUIEvent } from "react";
import { Copy, FileText, X } from "lucide-react";
import { PathTooltip } from "./PathTooltip";
import type { ChangedFile, DiffLine } from "../types/domain";
import { absoluteFilePath } from "../utils/filePath";

export interface WorktreeEditorTab {
  id: string;
  file: ChangedFile;
  diffLines: DiffLine[];
  pinned: boolean;
  sourceType?: "worktree" | "commit";
  commitHash?: string;
  sourceLabel?: string;
  subtitle?: string;
}

interface WorktreeDetailPanelProps {
  tabs: WorktreeEditorTab[];
  activeTabId: string | null;
  repositoryPath?: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
}

type SplitDiffRowType = "context" | "add" | "delete" | "replace";

interface SplitDiffRow {
  left?: DiffLine;
  right?: DiffLine;
  type: SplitDiffRowType;
}

const DIFF_ROW_HEIGHT = 24;
const DIFF_VIRTUAL_THRESHOLD = 500;
const DIFF_VIRTUAL_OVERSCAN = 36;

export function WorktreeDetailPanel({ tabs, activeTabId, repositoryPath, onSelectTab, onCloseTab, onPinTab }: WorktreeDetailPanelProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const diffPanelRef = useRef<HTMLElement>(null);
  const splitDiffRef = useRef<HTMLDivElement>(null);
  const splitScrollRef = useRef<HTMLDivElement>(null);
  const diffScrollFrameRef = useRef<number | undefined>();
  const prefersSplitDiff = useSplitDiffLayout();
  const activeDiffLines = activeTab?.diffLines ?? [];
  const splitDiffRows = useMemo(() => buildSplitDiffRows(activeDiffLines), [activeDiffLines]);
  const showSplitDiff = Boolean(prefersSplitDiff && activeTab && canUseSplitDiff(activeTab.file.status) && splitDiffRows.length > 0);
  const [splitMaxScroll, setSplitMaxScroll] = useState(0);
  const [splitScrollX, setSplitScrollX] = useState(0);
  const [diffPanelHeight, setDiffPanelHeight] = useState(0);
  const [diffScrollTop, setDiffScrollTop] = useState(0);
  const virtualRowCount = showSplitDiff ? splitDiffRows.length : activeDiffLines.length;
  const diffVirtualEnabled = virtualRowCount > DIFF_VIRTUAL_THRESHOLD;
  const diffVirtualRange = useMemo(() => {
    if (!diffVirtualEnabled) {
      return {
        startIndex: 0,
        endIndex: virtualRowCount,
        topPadding: 0,
        bottomPadding: 0
      };
    }

    const startIndex = clampNumber(Math.floor(diffScrollTop / DIFF_ROW_HEIGHT) - DIFF_VIRTUAL_OVERSCAN, 0, virtualRowCount);
    const endIndex = clampNumber(Math.ceil((diffScrollTop + diffPanelHeight) / DIFF_ROW_HEIGHT) + DIFF_VIRTUAL_OVERSCAN, startIndex, virtualRowCount);

    return {
      startIndex,
      endIndex,
      topPadding: startIndex * DIFF_ROW_HEIGHT,
      bottomPadding: (virtualRowCount - endIndex) * DIFF_ROW_HEIGHT
    };
  }, [diffPanelHeight, diffScrollTop, diffVirtualEnabled, virtualRowCount]);
  const visibleDiffLines = diffVirtualEnabled ? activeDiffLines.slice(diffVirtualRange.startIndex, diffVirtualRange.endIndex) : activeDiffLines;
  const visibleSplitDiffRows = diffVirtualEnabled ? splitDiffRows.slice(diffVirtualRange.startIndex, diffVirtualRange.endIndex) : splitDiffRows;

  useLayoutEffect(() => {
    const panel = diffPanelRef.current;
    if (!panel) {
      return;
    }

    const measure = () => setDiffPanelHeight(panel.clientHeight);
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(panel);
    return () => resizeObserver.disconnect();
  }, [activeTab?.id]);

  useEffect(() => {
    setDiffScrollTop(0);
    setSplitScrollX(0);
    if (diffPanelRef.current) {
      diffPanelRef.current.scrollTop = 0;
    }
    if (splitScrollRef.current) {
      splitScrollRef.current.scrollLeft = 0;
    }
  }, [activeTab?.id, showSplitDiff]);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(diffScrollFrameRef.current ?? 0);
    },
    []
  );

  useLayoutEffect(() => {
    if (!showSplitDiff) {
      setSplitMaxScroll(0);
      setSplitScrollX(0);
      return;
    }

    const root = splitDiffRef.current;
    if (!root) {
      return;
    }

    const measure = () => {
      const codeWraps = Array.from(root.querySelectorAll<HTMLElement>(".split-diff-code-wrap"));
      const nextMaxScroll = Math.ceil(
        codeWraps.reduce((maxScroll, wrap) => {
          const code = wrap.querySelector<HTMLElement>(".split-diff-code-text");
          if (!code) {
            return maxScroll;
          }

          return Math.max(maxScroll, code.scrollWidth - wrap.clientWidth);
        }, 0)
      );

      setSplitMaxScroll(nextMaxScroll);
      setSplitScrollX((current) => Math.min(current, nextMaxScroll));
      if (splitScrollRef.current && splitScrollRef.current.scrollLeft > nextMaxScroll) {
        splitScrollRef.current.scrollLeft = nextMaxScroll;
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [diffVirtualRange.endIndex, diffVirtualRange.startIndex, showSplitDiff, splitDiffRows.length]);

  const splitDiffStyle = showSplitDiff ? ({ "--split-scroll-x": `${splitScrollX}px` } as CSSProperties) : undefined;

  function handleDiffPanelScroll(event: ReactUIEvent<HTMLElement>) {
    const scrollTop = event.currentTarget.scrollTop;
    window.cancelAnimationFrame(diffScrollFrameRef.current ?? 0);
    diffScrollFrameRef.current = window.requestAnimationFrame(() => {
      setDiffScrollTop(scrollTop);
    });
  }

  if (!activeTab) {
    return (
      <aside className="detail-panel worktree-detail-panel editor-detail-panel empty">
        <div className="editor-empty-state">
          <FileText size={20} />
          <span>选择文件查看变更</span>
        </div>
      </aside>
    );
  }

  const { file, diffLines } = activeTab;
  const activeAbsolutePath = absoluteFilePath(repositoryPath, file.path);

  return (
    <aside className="detail-panel worktree-detail-panel editor-detail-panel">
      <div className="editor-tab-row">
        <div className="editor-tabs" role="tablist" aria-label="工作树文件">
          {tabs.map((tab) => (
            <div
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeTab.id}
              className={`editor-tab ${tab.id === activeTab.id ? "active" : ""} ${tab.pinned ? "pinned" : "preview"}`}
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={() => onPinTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSelectTab(tab.id);
                }
              }}
            >
              <FileText size={14} />
              <PathTooltip path={absoluteFilePath(repositoryPath, tab.file.path)} className="editor-tab-name">
                {tab.file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? tab.file.path}
              </PathTooltip>
              <small>{statusLabel(tab.file.status)}</small>
              <button
                type="button"
                className="editor-tab-close"
                title="关闭文件"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <PathTooltip content="复制绝对路径" className="editor-action-tooltip">
          <button type="button" className="icon-button compact-icon" aria-label="复制绝对路径" onClick={() => void navigator.clipboard.writeText(activeAbsolutePath)}>
            <Copy size={15} />
          </button>
        </PathTooltip>
      </div>

      <div className="editor-breadcrumb">
        <span>{activeTab.sourceLabel ?? (file.staged ? "已暂存的更改" : "更改")}</span>
        <span>{file.path}</span>
        {activeTab.subtitle ? <span>{activeTab.subtitle}</span> : null}
      </div>

      <div className="editor-diff-shell" style={splitDiffStyle}>
        <section className={`diff-panel editor-diff-panel ${showSplitDiff ? "split-mode" : ""}`} ref={diffPanelRef} onScroll={handleDiffPanelScroll}>
          {showSplitDiff ? (
            <div className="split-diff-grid" role="table" aria-label="左右文件对比" ref={splitDiffRef}>
              <div className="split-diff-header" role="row">
                <span>原文件</span>
                <span>当前文件</span>
              </div>
              <div className="split-diff-lines">
                {diffVirtualEnabled && diffVirtualRange.topPadding > 0 ? <div className="diff-virtual-spacer" style={{ height: diffVirtualRange.topPadding }} aria-hidden="true" /> : null}
                {visibleSplitDiffRows.map((row, visibleIndex) => {
                  const index = diffVirtualEnabled ? diffVirtualRange.startIndex + visibleIndex : visibleIndex;
                  return (
                  <div className={`split-diff-row ${row.type}`} role="row" key={`${row.type}-${index}-${row.left?.oldLineNumber ?? ""}-${row.right?.newLineNumber ?? ""}`}>
                    <DiffCell side="old" line={row.left} />
                    <DiffCell side="new" line={row.right} />
                  </div>
                  );
                })}
                {diffVirtualEnabled && diffVirtualRange.bottomPadding > 0 ? <div className="diff-virtual-spacer" style={{ height: diffVirtualRange.bottomPadding }} aria-hidden="true" /> : null}
              </div>
            </div>
          ) : (
            <div className="diff-lines">
              {diffLines.length === 0 ? <div className="empty-inline">没有可显示的文本 diff。</div> : null}
              {diffVirtualEnabled && diffVirtualRange.topPadding > 0 ? <div className="diff-virtual-spacer" style={{ height: diffVirtualRange.topPadding }} aria-hidden="true" /> : null}
              {visibleDiffLines.map((line, visibleIndex) => {
                const index = diffVirtualEnabled ? diffVirtualRange.startIndex + visibleIndex : visibleIndex;
                return (
                <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                  <span className="line-number">{line.oldLineNumber ?? ""}</span>
                  <span className="line-number">{line.newLineNumber ?? ""}</span>
                  <code>{line.content || " "}</code>
                </div>
                );
              })}
              {diffVirtualEnabled && diffVirtualRange.bottomPadding > 0 ? <div className="diff-virtual-spacer" style={{ height: diffVirtualRange.bottomPadding }} aria-hidden="true" /> : null}
            </div>
          )}
        </section>
        {showSplitDiff && splitMaxScroll > 0 ? (
          <div className="split-diff-horizontal-scroll" ref={splitScrollRef} onScroll={(event) => setSplitScrollX(event.currentTarget.scrollLeft)}>
            <div style={{ width: `calc(100% + ${splitMaxScroll}px)` }} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function DiffCell({ side, line }: { side: "old" | "new"; line?: DiffLine }) {
  const lineNumber = side === "old" ? line?.oldLineNumber : line?.newLineNumber;
  const empty = !line;

  return (
    <div className={`split-diff-cell ${side} ${line?.type ?? "empty"}`}>
      <span className="line-number">{lineNumber ?? ""}</span>
      <span className="split-diff-code-wrap">
        <code className="split-diff-code-text">{empty ? " " : line.content || " "}</code>
      </span>
    </div>
  );
}

function useSplitDiffLayout() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.gitUI ? false : window.matchMedia("(min-width: 1440px)").matches;
  });

  useEffect(() => {
    if (window.gitUI) {
      let cancelled = false;

      void window.gitUI.getWindowState().then((state) => {
        if (!cancelled) {
          setEnabled(state.isMaximized || state.isFullScreen);
        }
      });

      const unsubscribe = window.gitUI.onWindowStateChange((state) => setEnabled(state.isMaximized || state.isFullScreen));
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    const media = window.matchMedia("(min-width: 1440px)");
    const sync = () => setEnabled(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return enabled;
}

function canUseSplitDiff(status: ChangedFile["status"]) {
  return status === "modified" || status === "renamed" || status === "copied" || status === "conflicted";
}

function buildSplitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.type === "context") {
      rows.push({ left: line, right: line, type: "context" });
      index += 1;
      continue;
    }

    const deletes: DiffLine[] = [];
    const adds: DiffLine[] = [];

    while (lines[index]?.type === "delete") {
      deletes.push(lines[index]);
      index += 1;
    }

    while (lines[index]?.type === "add") {
      adds.push(lines[index]);
      index += 1;
    }

    if (deletes.length === 0 && adds.length === 0 && line.type === "add") {
      adds.push(line);
      index += 1;
    }

    const rowCount = Math.max(deletes.length, adds.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const left = deletes[rowIndex];
      const right = adds[rowIndex];
      rows.push({
        left,
        right,
        type: left && right ? "replace" : left ? "delete" : "add"
      });
    }
  }

  return rows;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function statusLabel(status: ChangedFile["status"]): string {
  const labels: Record<ChangedFile["status"], string> = {
    added: "新增",
    modified: "修改",
    deleted: "删除",
    renamed: "重命名",
    copied: "复制",
    untracked: "未跟踪",
    ignored: "忽略",
    conflicted: "冲突"
  };

  return labels[status];
}
