import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
type DiffMarkerType = "add" | "delete" | "replace";
type DiffMarkerTone = "add" | "delete" | "empty";

interface SplitDiffRow {
  left?: DiffLine;
  right?: DiffLine;
  type: SplitDiffRowType;
}

interface DiffMarker {
  index: number;
  endIndex: number;
  type: DiffMarkerType;
  oldSegments: DiffMarkerLaneSegment[];
  newSegments: DiffMarkerLaneSegment[];
}

interface DiffMarkerLaneSegment {
  tone: DiffMarkerTone;
  count: number;
}

export function WorktreeDetailPanel({ tabs, activeTabId, repositoryPath, onSelectTab, onCloseTab, onPinTab }: WorktreeDetailPanelProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const diffScrollRef = useRef<HTMLElement>(null);
  const prefersSplitDiff = useSplitDiffLayout();
  const activeDiffLines = activeTab?.diffLines ?? [];
  const splitDiffRows = useMemo(() => buildSplitDiffRows(activeDiffLines), [activeDiffLines]);
  const splitDiffMarkers = useMemo(() => buildSplitDiffMarkers(splitDiffRows), [splitDiffRows]);
  const inlineDiffMarkers = useMemo(() => buildInlineDiffMarkers(activeDiffLines), [activeDiffLines]);
  const showSplitDiff = Boolean(prefersSplitDiff && activeTab && canUseSplitDiff(activeTab.file.status) && splitDiffRows.length > 0);

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

      <div className="editor-diff-shell">
        <section className={`diff-panel editor-diff-panel ${showSplitDiff ? "split-mode" : ""}`} ref={diffScrollRef}>
          {showSplitDiff ? (
            <div className="split-diff-grid" role="table" aria-label="左右文件对比">
              <div className="split-diff-header" role="row">
                <span>原文件</span>
                <span>当前文件</span>
              </div>
              <div className="split-diff-lines">
                {splitDiffRows.map((row, index) => (
                  <div className={`split-diff-row ${row.type}`} role="row" key={`${row.type}-${index}-${row.left?.oldLineNumber ?? ""}-${row.right?.newLineNumber ?? ""}`}>
                    <DiffCell side="old" line={row.left} />
                    <DiffCell side="new" line={row.right} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="diff-lines">
              {diffLines.length === 0 ? <div className="empty-inline">没有可显示的文本 diff。</div> : null}
              {diffLines.map((line, index) => (
                <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                  <span className="line-number">{line.oldLineNumber ?? ""}</span>
                  <span className="line-number">{line.newLineNumber ?? ""}</span>
                  <code>{line.content || " "}</code>
                </div>
              ))}
            </div>
          )}
        </section>
        <DiffScrollMap markers={showSplitDiff ? splitDiffMarkers : inlineDiffMarkers} totalRows={showSplitDiff ? splitDiffRows.length : diffLines.length} scrollContainerRef={diffScrollRef} />
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
      <code>{empty ? " " : line.content || " "}</code>
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

function DiffScrollMap({
  markers,
  totalRows,
  scrollContainerRef
}: {
  markers: DiffMarker[];
  totalRows: number;
  scrollContainerRef: RefObject<HTMLElement>;
}) {
  if (markers.length === 0 || totalRows === 0) {
    return null;
  }

  function scrollToMarker(index: number) {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const ratio = totalRows <= 1 ? 0 : index / (totalRows - 1);
    container.scrollTop = ratio * Math.max(0, container.scrollHeight - container.clientHeight);
  }

  return (
    <div className="diff-scroll-map" aria-label="变更定位">
      {markers.map((marker, markerIndex) => {
        const top = Math.min(99, Math.max(0, (marker.index / Math.max(1, totalRows)) * 100));
        const height = Math.max(0.8, Math.min(100 - top, ((marker.endIndex - marker.index + 1) / Math.max(1, totalRows)) * 100));

        return (
          <button
            type="button"
            className={`diff-scroll-marker ${marker.type}`}
            style={{ top: `${top}%`, height: `${height}%` }}
            aria-label={marker.type === "add" ? "跳转到新增位置" : marker.type === "delete" ? "跳转到删除位置" : "跳转到修改位置"}
            key={`${marker.type}-${marker.index}-${marker.endIndex}-${markerIndex}`}
            onClick={() => scrollToMarker(marker.index)}
          >
            <span className="diff-scroll-marker-lane">
              {marker.oldSegments.map((segment, segmentIndex) => (
                <span className={`diff-scroll-marker-segment ${segment.tone}`} style={{ flexGrow: segment.count }} key={`old-${segment.tone}-${segmentIndex}`} />
              ))}
            </span>
            <span className="diff-scroll-marker-lane">
              {marker.newSegments.map((segment, segmentIndex) => (
                <span className={`diff-scroll-marker-segment ${segment.tone}`} style={{ flexGrow: segment.count }} key={`new-${segment.tone}-${segmentIndex}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
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

function buildSplitDiffMarkers(rows: SplitDiffRow[]): DiffMarker[] {
  return groupDiffMarkers(
    rows.map((row) => {
      if (row.type === "context") {
        return null;
      }

      return {
        type: row.type === "replace" ? "replace" : row.type,
        oldTone: row.left ? "delete" : "empty",
        newTone: row.right ? "add" : "empty"
      };
    })
  );
}

function buildInlineDiffMarkers(lines: DiffLine[]): DiffMarker[] {
  return groupDiffMarkers(
    lines.map((line) => {
      if (line.type === "context") {
        return null;
      }

      return line.type === "add" ? { type: "add", oldTone: "empty", newTone: "add" } : { type: "delete", oldTone: "delete", newTone: "empty" };
    })
  );
}

interface DiffMarkerSample {
  type: DiffMarkerType;
  oldTone: DiffMarkerTone;
  newTone: DiffMarkerTone;
}

interface ActiveDiffMarker {
  index: number;
  endIndex: number;
  type: DiffMarkerType;
  oldTones: DiffMarkerTone[];
  newTones: DiffMarkerTone[];
}

function groupDiffMarkers(samples: Array<DiffMarkerSample | null>): DiffMarker[] {
  const markers: DiffMarker[] = [];
  let activeMarker: ActiveDiffMarker | null = null;

  samples.forEach((sample, index) => {
    if (!sample) {
      if (activeMarker) {
        markers.push(toDiffMarker(activeMarker));
        activeMarker = null;
      }
      return;
    }

    if (!activeMarker) {
      activeMarker = {
        index,
        endIndex: index,
        type: sample.type,
        oldTones: [sample.oldTone],
        newTones: [sample.newTone]
      };
      return;
    }

    activeMarker.endIndex = index;
    activeMarker.oldTones.push(sample.oldTone);
    activeMarker.newTones.push(sample.newTone);
    if (activeMarker.type !== sample.type) {
      activeMarker.type = "replace";
    }
  });

  if (activeMarker) {
    markers.push(toDiffMarker(activeMarker));
  }

  return markers;
}

function toDiffMarker(marker: ActiveDiffMarker): DiffMarker {
  return {
    index: marker.index,
    endIndex: marker.endIndex,
    type: marker.type,
    oldSegments: compressMarkerLane(marker.oldTones),
    newSegments: compressMarkerLane(marker.newTones)
  };
}

function compressMarkerLane(tones: DiffMarkerTone[]): DiffMarkerLaneSegment[] {
  const segments: DiffMarkerLaneSegment[] = [];

  tones.forEach((tone) => {
    const lastSegment = segments.at(-1);
    if (lastSegment?.tone === tone) {
      lastSegment.count += 1;
      return;
    }

    segments.push({ tone, count: 1 });
  });

  return segments;
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
