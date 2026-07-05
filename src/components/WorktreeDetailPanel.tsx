import { useMemo, useRef, type RefObject } from "react";
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

interface DiffMarker {
  index: number;
  type: "add" | "delete" | "replace";
}

export function WorktreeDetailPanel({ tabs, activeTabId, repositoryPath, onSelectTab, onCloseTab, onPinTab }: WorktreeDetailPanelProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const diffScrollRef = useRef<HTMLElement>(null);
  const activeDiffLines = activeTab?.diffLines ?? [];
  const splitDiffRows = useMemo(() => buildSplitDiffRows(activeDiffLines), [activeDiffLines]);
  const splitDiffMarkers = useMemo(() => buildSplitDiffMarkers(splitDiffRows), [splitDiffRows]);
  const inlineDiffMarkers = useMemo(() => buildInlineDiffMarkers(activeDiffLines), [activeDiffLines]);
  const showSplitDiff = Boolean(activeTab && canUseSplitDiff(activeTab.file.status) && splitDiffRows.length > 0);

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

      <section className={`diff-panel editor-diff-panel ${showSplitDiff ? "split-mode" : ""}`} ref={diffScrollRef}>
        {showSplitDiff ? (
          <>
            <DiffScrollMap markers={splitDiffMarkers} totalRows={splitDiffRows.length} scrollContainerRef={diffScrollRef} />
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
          </>
        ) : (
          <>
            <DiffScrollMap markers={inlineDiffMarkers} totalRows={diffLines.length} scrollContainerRef={diffScrollRef} />
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
          </>
        )}
      </section>
    </aside>
  );
}

function DiffCell({ side, line }: { side: "old" | "new"; line?: DiffLine }) {
  const lineNumber = side === "old" ? line?.oldLineNumber : line?.newLineNumber;
  const empty = !line;

  return (
    <div className={`split-diff-cell ${line?.type ?? "empty"}`}>
      <span className="line-number">{lineNumber ?? ""}</span>
      <code>{empty ? " " : line.content || " "}</code>
    </div>
  );
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
      {markers.map((marker, markerIndex) => (
        <button
          type="button"
          className={`diff-scroll-marker ${marker.type}`}
          style={{ top: `${Math.min(98, Math.max(1, (marker.index / Math.max(1, totalRows - 1)) * 100))}%` }}
          aria-label={marker.type === "add" ? "跳转到新增位置" : marker.type === "delete" ? "跳转到删除位置" : "跳转到修改位置"}
          key={`${marker.type}-${marker.index}-${markerIndex}`}
          onClick={() => scrollToMarker(marker.index)}
        />
      ))}
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
  return rows
    .map((row, index): DiffMarker | null => (row.type === "context" ? null : { index, type: row.type === "replace" ? "replace" : row.type }))
    .filter((marker): marker is DiffMarker => Boolean(marker));
}

function buildInlineDiffMarkers(lines: DiffLine[]): DiffMarker[] {
  return lines
    .map((line, index): DiffMarker | null => (line.type === "context" ? null : { index, type: line.type }))
    .filter((marker): marker is DiffMarker => Boolean(marker));
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
