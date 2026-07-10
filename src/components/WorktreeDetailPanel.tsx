import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { AlertTriangle, Check, Copy, FileText, GitMerge, Maximize2, RefreshCw, RotateCcw, Save, X, ZoomIn, ZoomOut } from "lucide-react";
import { PathTooltip } from "./PathTooltip";
import type { ChangedFile, ConflictFileDetails, ConflictResolutionInput, DiffLine, FilePreview } from "../types/domain";
import { absoluteFilePath } from "../utils/filePath";

export interface WorktreeEditorTab {
  id: string;
  file: ChangedFile;
  diffLines: DiffLine[];
  pinned: boolean;
  preview?: FilePreview | null;
  sourceType?: "worktree" | "commit";
  commitHash?: string;
  sourceLabel?: string;
  subtitle?: string;
  conflict?: ConflictFileDetails;
  loading?: boolean;
  loadError?: string;
}

interface WorktreeDetailPanelProps {
  tabs: WorktreeEditorTab[];
  activeTabId: string | null;
  repositoryPath?: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
  onResolveConflict: (tab: WorktreeEditorTab, input: ConflictResolutionInput) => Promise<boolean>;
  onRetryLoad: (tab: WorktreeEditorTab) => Promise<void>;
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
const MEDIA_MIN_SCALE = 0.2;
const MEDIA_MAX_SCALE = 8;
const MEDIA_ZOOM_STEP = 1.2;
const MEDIA_PAN_STEP = 36;

export function WorktreeDetailPanel({
  tabs,
  activeTabId,
  repositoryPath,
  onSelectTab,
  onCloseTab,
  onPinTab,
  onResolveConflict,
  onRetryLoad
}: WorktreeDetailPanelProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const diffPanelRef = useRef<HTMLElement>(null);
  const splitDiffRef = useRef<HTMLDivElement>(null);
  const splitScrollRef = useRef<HTMLDivElement>(null);
  const diffScrollFrameRef = useRef<number | undefined>();
  const prefersSplitDiff = useSplitDiffLayout();
  const activeDiffLines = activeTab?.diffLines ?? [];
  const mediaPreview = activeTab?.preview;
  const splitDiffRows = useMemo(() => buildSplitDiffRows(activeDiffLines), [activeDiffLines]);
  const showSplitDiff = Boolean(!mediaPreview && prefersSplitDiff && activeTab && canUseSplitDiff(activeTab.file.status) && splitDiffRows.length > 0);
  const [splitMaxScroll, setSplitMaxScroll] = useState(0);
  const [splitScrollX, setSplitScrollX] = useState(0);
  const [diffPanelHeight, setDiffPanelHeight] = useState(0);
  const [diffScrollTop, setDiffScrollTop] = useState(0);
  const virtualRowCount = mediaPreview ? 0 : showSplitDiff ? splitDiffRows.length : activeDiffLines.length;
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

      <div className={`editor-diff-shell ${activeTab.conflict ? "conflict-mode" : ""} ${activeTab.loadError ? "load-error-mode" : ""}`} style={splitDiffStyle}>
        {activeTab.loading ? (
          <div className="editor-empty-state conflict-loading-state">
            <GitMerge size={20} />
            <span>正在读取冲突内容...</span>
          </div>
        ) : activeTab.loadError ? (
          <div className="editor-load-error" role="alert">
            <span className="editor-load-error-icon" aria-hidden="true">
              <AlertTriangle size={20} />
            </span>
            <div className="editor-load-error-content">
              <strong>{file.status === "conflicted" ? "无法读取冲突详情" : "无法加载文件详情"}</strong>
              <p>{activeTab.loadError}</p>
              <button type="button" onClick={() => void onRetryLoad(activeTab)}>
                <RefreshCw size={15} />
                {file.status === "conflicted" ? "刷新工作区并重试" : "重新加载"}
              </button>
            </div>
          </div>
        ) : activeTab.conflict ? (
          <ConflictResolver tab={activeTab} onResolve={onResolveConflict} />
        ) : (
        <section className={`diff-panel editor-diff-panel ${showSplitDiff ? "split-mode" : ""} ${mediaPreview ? "media-mode" : ""}`} ref={diffPanelRef} onScroll={handleDiffPanelScroll}>
          {mediaPreview ? (
            <MediaPreview preview={mediaPreview} filePath={file.path} />
          ) : showSplitDiff ? (
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
        )}
        {showSplitDiff && splitMaxScroll > 0 ? (
          <div className="split-diff-horizontal-scroll" ref={splitScrollRef} onScroll={(event) => setSplitScrollX(event.currentTarget.scrollLeft)}>
            <div style={{ width: `calc(100% + ${splitMaxScroll}px)` }} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

type ConflictViewMode = "blocks" | "three-way" | "result";

interface ParsedConflictBlock {
  id: string;
  start: number;
  end: number;
  lineNumber: number;
  current: string;
  base?: string;
  incoming: string;
}

function ConflictResolver({ tab, onResolve }: { tab: WorktreeEditorTab; onResolve: WorktreeDetailPanelProps["onResolveConflict"] }) {
  const details = tab.conflict!;
  const initialDraft = conflictInitialDraft(details);
  const [draft, setDraft] = useState(initialDraft);
  const [viewMode, setViewMode] = useState<ConflictViewMode>(() => (parseConflictBlocks(initialDraft).length > 0 ? "blocks" : "three-way"));
  const [busy, setBusy] = useState(false);
  const blocks = useMemo(() => parseConflictBlocks(draft), [draft]);
  const initialBlockCount = useMemo(() => parseConflictBlocks(initialDraft).length, [initialDraft]);
  const resolvedBlockCount = Math.max(0, initialBlockCount - blocks.length);

  useEffect(() => {
    const nextDraft = conflictInitialDraft(details);
    setDraft(nextDraft);
    setViewMode(parseConflictBlocks(nextDraft).length > 0 ? "blocks" : "three-way");
    setBusy(false);
  }, [details.token]);

  function applyBlock(block: ParsedConflictBlock, choice: "current" | "incoming" | "both") {
    const replacement = choice === "current" ? block.current : choice === "incoming" ? block.incoming : joinConflictSides(block.current, block.incoming);
    setDraft((current) => `${current.slice(0, block.start)}${replacement}${current.slice(block.end)}`);
  }

  async function resolve(input: Omit<ConflictResolutionInput, "expectedToken">) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onResolve(tab, { ...input, expectedToken: details.token });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="conflict-resolver" aria-label={`解决冲突 ${details.path}`}>
      <header className="conflict-resolver-header">
        <div className="conflict-resolver-summary">
          <GitMerge size={17} />
          <span>
            <strong>{blocks.length > 0 ? `${blocks.length} 个冲突块` : "冲突内容已合并"}</strong>
            {initialBlockCount > 0 ? `已处理 ${resolvedBlockCount} / ${initialBlockCount}` : "等待确认最终结果"}
          </span>
        </div>
        <div className="conflict-whole-actions">
          <button type="button" onClick={() => void resolve({ choice: "current" })} disabled={busy}>
            采用 {details.currentLabel}{details.currentExists ? "" : "（删除）"}
          </button>
          <button type="button" onClick={() => void resolve({ choice: "incoming" })} disabled={busy}>
            采用 {details.incomingLabel}{details.incomingExists ? "" : "（删除）"}
          </button>
        </div>
      </header>

      {details.editable ? (
        <>
          <div className="conflict-view-tabs" role="tablist" aria-label="冲突查看模式">
            <button type="button" role="tab" aria-selected={viewMode === "blocks"} className={viewMode === "blocks" ? "active" : ""} onClick={() => setViewMode("blocks")}>
              冲突块 {blocks.length}
            </button>
            <button type="button" role="tab" aria-selected={viewMode === "three-way"} className={viewMode === "three-way" ? "active" : ""} onClick={() => setViewMode("three-way")}>
              三方原文
            </button>
            <button type="button" role="tab" aria-selected={viewMode === "result"} className={viewMode === "result" ? "active" : ""} onClick={() => setViewMode("result")}>
              最终结果
            </button>
          </div>

          <div className="conflict-resolver-body">
            {viewMode === "blocks" ? (
              blocks.length > 0 ? (
                <div className="conflict-block-list">
                  {blocks.map((block, index) => (
                    <article className="conflict-block" key={block.id}>
                      <header className="conflict-block-header">
                        <strong>冲突 {index + 1}</strong>
                        <span>第 {block.lineNumber} 行</span>
                        <div>
                          <button type="button" onClick={() => applyBlock(block, "current")} disabled={busy}>采用当前</button>
                          <button type="button" onClick={() => applyBlock(block, "incoming")} disabled={busy}>采用传入</button>
                          <button type="button" onClick={() => applyBlock(block, "both")} disabled={busy}>保留两者</button>
                        </div>
                      </header>
                      <div className="conflict-block-sides">
                        <ConflictTextPane label={details.currentLabel} content={block.current} tone="current" />
                        <ConflictTextPane label={details.incomingLabel} content={block.incoming} tone="incoming" />
                      </div>
                      {block.base !== undefined ? (
                        <details className="conflict-block-base">
                          <summary>共同基线</summary>
                          <pre>{block.base || "（空内容）"}</pre>
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="conflict-resolved-state">
                  <Check size={22} />
                  <strong>没有剩余冲突标记</strong>
                  <span>最终结果可以保存并标记为已解决</span>
                </div>
              )
            ) : viewMode === "three-way" ? (
              <div className="conflict-three-way" role="table" aria-label="冲突三方原文">
                <ConflictTextPane label="共同基线" content={details.baseExists ? details.baseContent ?? "" : ""} exists={details.baseExists} tone="base" />
                <ConflictTextPane label={details.currentLabel} content={details.currentExists ? details.currentContent ?? "" : ""} exists={details.currentExists} tone="current" />
                <ConflictTextPane label={details.incomingLabel} content={details.incomingExists ? details.incomingContent ?? "" : ""} exists={details.incomingExists} tone="incoming" />
              </div>
            ) : (
              <textarea className="conflict-result-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="最终合并结果" />
            )}
          </div>

          <footer className="conflict-resolver-footer">
            <button type="button" className="text-button" onClick={() => setDraft(initialDraft)} disabled={busy || draft === initialDraft}>
              <RotateCcw size={14} />
              重置
            </button>
            <button type="button" className="primary-action" onClick={() => void resolve({ choice: "content", content: draft })} disabled={busy || blocks.length > 0}>
              <Save size={14} />
              {busy ? "正在保存" : "保存并标记已解决"}
            </button>
          </footer>
        </>
      ) : (
        <div className="conflict-noneditable">
          <FileText size={22} />
          <strong>{details.isBinary ? "二进制文件冲突" : "冲突文件过大"}</strong>
          <span>请选择当前版本或传入版本作为最终结果</span>
        </div>
      )}
    </section>
  );
}

function ConflictTextPane({
  label,
  content,
  exists = true,
  tone
}: {
  label: string;
  content: string;
  exists?: boolean;
  tone: "base" | "current" | "incoming";
}) {
  return (
    <section className={`conflict-text-pane ${tone}`}>
      <header>{label}</header>
      <pre>{exists ? content || "（空内容）" : "（文件已删除）"}</pre>
    </section>
  );
}

function conflictInitialDraft(details: ConflictFileDetails): string {
  return details.resultContent ?? details.currentContent ?? details.incomingContent ?? "";
}

function parseConflictBlocks(content: string): ParsedConflictBlock[] {
  const blocks: ParsedConflictBlock[] = [];
  const pattern = /^<<<<<<<[^\r\n]*\r?\n([\s\S]*?)(?=^(?:\|\|\|\|\|\|\||=======))(?:^\|\|\|\|\|\|\|[^\r\n]*\r?\n([\s\S]*?)(?=^=======))?^=======\r?\n([\s\S]*?)^>>>>>>>[^\r\n]*(?:\r?\n|$)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const start = match.index;
    blocks.push({
      id: `${start}-${pattern.lastIndex}`,
      start,
      end: pattern.lastIndex,
      lineNumber: content.slice(0, start).split(/\r?\n/).length,
      current: match[1] ?? "",
      base: match[2],
      incoming: match[3] ?? ""
    });
  }
  return blocks;
}

function joinConflictSides(current: string, incoming: string): string {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  return `${current}${current.endsWith("\n") || current.endsWith("\r") ? "" : "\n"}${incoming}`;
}

function MediaPreview({ preview, filePath }: { preview: FilePreview; filePath: string }) {
  const fileName = filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const zoomLabel = `${Math.round(scale * 100)}%`;
  const mediaStyle = {
    transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`
  } satisfies CSSProperties;

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    setLoadFailed(false);
    dragRef.current = null;
  }, [preview.dataUrl, preview.type]);

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function panBy(deltaX: number, deltaY: number) {
    setOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY
    }));
  }

  function zoomBy(factor: number, anchor?: { clientX: number; clientY: number }) {
    setScale((currentScale) => {
      const nextScale = clampNumber(Number((currentScale * factor).toFixed(3)), MEDIA_MIN_SCALE, MEDIA_MAX_SCALE);
      if (nextScale !== currentScale && anchor && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const anchorX = anchor.clientX - rect.left - rect.width / 2;
        const anchorY = anchor.clientY - rect.top - rect.height / 2;
        const ratio = nextScale / currentScale;

        setOffset((currentOffset) => ({
          x: anchorX - (anchorX - currentOffset.x) * ratio,
          y: anchorY - (anchorY - currentOffset.y) * ratio
        }));
      }

      return nextScale;
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? MEDIA_ZOOM_STEP : 1 / MEDIA_ZOOM_STEP, { clientX: event.clientX, clientY: event.clientY });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target instanceof HTMLVideoElement) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const withCommand = event.ctrlKey || event.metaKey;
    if (withCommand && isZoomInKey(event.key)) {
      event.preventDefault();
      zoomBy(MEDIA_ZOOM_STEP);
      return;
    }

    if (withCommand && isZoomOutKey(event.key)) {
      event.preventDefault();
      zoomBy(1 / MEDIA_ZOOM_STEP);
      return;
    }

    if (withCommand && event.key === "0") {
      event.preventDefault();
      resetView();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const panStep = event.shiftKey ? MEDIA_PAN_STEP * 2 : MEDIA_PAN_STEP;
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        panBy(0, -panStep);
        break;
      case "ArrowDown":
        event.preventDefault();
        panBy(0, panStep);
        break;
      case "ArrowLeft":
        event.preventDefault();
        panBy(-panStep, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        panBy(panStep, 0);
        break;
    }
  }

  return (
    <div className="editor-media-preview">
      <div className="editor-media-toolbar" aria-label="媒体预览工具">
        <div className="editor-media-toolgroup">
          <PathTooltip content="缩小 (Ctrl + -)" className="editor-media-action-tooltip">
            <button
              type="button"
              className="icon-button compact-icon editor-media-tool"
              aria-label="缩小"
              disabled={scale <= MEDIA_MIN_SCALE}
              onClick={() => zoomBy(1 / MEDIA_ZOOM_STEP)}
            >
              <ZoomOut size={15} />
            </button>
          </PathTooltip>
          <span className="editor-media-scale" aria-label={`当前缩放 ${zoomLabel}`}>
            {zoomLabel}
          </span>
          <PathTooltip content="放大 (Ctrl + +)" className="editor-media-action-tooltip">
            <button
              type="button"
              className="icon-button compact-icon editor-media-tool"
              aria-label="放大"
              disabled={scale >= MEDIA_MAX_SCALE}
              onClick={() => zoomBy(MEDIA_ZOOM_STEP)}
            >
              <ZoomIn size={15} />
            </button>
          </PathTooltip>
          <PathTooltip content="适应窗口 (Ctrl + 0)" className="editor-media-action-tooltip">
            <button type="button" className="icon-button compact-icon editor-media-tool" aria-label="适应窗口" onClick={resetView}>
              <Maximize2 size={15} />
            </button>
          </PathTooltip>
        </div>
      </div>
      <div
        className={`editor-media-stage ${preview.type}-stage ${dragging ? "dragging" : ""}`}
        ref={stageRef}
        role="group"
        tabIndex={0}
        aria-label={`${fileName} ${preview.type === "video" ? "视频预览" : "图片预览"}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        {preview.type === "video" ? (
          <video key={preview.dataUrl} className="editor-preview-media video" style={mediaStyle} controls preload="metadata" onError={() => setLoadFailed(true)}>
            <source src={preview.dataUrl} type={preview.mimeType} />
          </video>
        ) : (
          <img className="editor-preview-media image" style={mediaStyle} src={preview.dataUrl} alt={fileName} draggable={false} onError={() => setLoadFailed(true)} />
        )}
        {loadFailed ? <div className="editor-media-error">当前格式无法在查看区解码。</div> : null}
      </div>
      <div className="editor-media-meta">
        <span>{preview.sourceDescription}</span>
        <span>{preview.mimeType}</span>
        <span>{formatBytes(preview.sizeBytes)}</span>
      </div>
    </div>
  );
}

function isZoomInKey(key: string): boolean {
  return key === "+" || key === "=" || key === "Add";
}

function isZoomOutKey(key: string): boolean {
  return key === "-" || key === "_" || key === "Subtract";
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
