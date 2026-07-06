import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  Undo2
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject, type UIEvent as ReactUIEvent } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../api/client";
import { PathTooltip } from "./PathTooltip";
import type { ChangedFile, CommitGraphAction, CommitNode, CommitRef, GitHistoryFilter, GitHistoryRef, GitOperationState, GitProject } from "../types/domain";
import { fileIconInfo } from "../utils/fileIcon";
import { absoluteFilePath } from "../utils/filePath";

interface GraphSidebarProps {
  project?: GitProject;
  commits: CommitNode[];
  historyRefs: GitHistoryRef[];
  historyFilter: GitHistoryFilter;
  onHistoryFilterChange: (filter: GitHistoryFilter) => void;
  selectedHash: string;
  onSelectCommit: (hash: string) => void;
  onSelectCommitFile: (commit: CommitNode, file: ChangedFile) => void;
  onPinCommitFile: (commit: CommitNode, file: ChangedFile) => void;
  selectedCommitFileHash?: string;
  selectedCommitFilePath?: string;
  onOperation: (operation: string) => void;
  onCommitAction: (action: CommitGraphAction, commit: CommitNode) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const graphOperations = [
  { label: "fetch", title: "抓取远程更新", icon: RefreshCw },
  { label: "pull", title: "拉取当前分支", icon: CloudDownload },
  { label: "push", title: "推送当前分支", icon: CloudUpload },
  { label: "新建分支", title: "新建分支", icon: Plus },
  { label: "切换分支", title: "切换分支", icon: GitBranch }
];

const graphBranchTones = ["branch-rose", "branch-cyan", "branch-violet", "branch-amber", "branch-green"] as const;
const graphRowHeight = 28;
const graphNodeCenterY = 14;
const graphNodeRadius = 4.2;
const graphMergeRingRadius = 5.2;
const graphNodeCurveControl = 3.2;
const graphLaneCurveControl = 5;
const graphFileBaseGutter = 24;
const graphFileLanePadding = 10;

type GraphBranchTone = (typeof graphBranchTones)[number];
type GraphTone = "local" | "remote" | "primary" | "secondary" | "synced" | "plain" | GraphBranchTone;
type GraphFileViewMode = "list" | "tree";
type GraphSegment =
  | {
      type: "line";
      tone: GraphTone;
      x: number;
      y1: number;
      y2: number;
    }
  | {
      type: "curve";
      tone: GraphTone;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      merge?: boolean;
      connectToNode?: boolean;
    };
type GraphRowLayout = {
  segments: GraphSegment[];
  expansionLines: GraphExpansionLine[];
  nodeX: number;
  nodeTone: GraphTone;
  merge: boolean;
};
type GraphExpansionLine = {
  x: number;
  tone: GraphTone;
};
type GraphLaneNode = {
  id: string;
  tone: GraphTone;
};
type VisibleGraphParent = {
  hash: string;
  parentIndex: number;
};
type CommitContextMenuState = {
  commit: CommitNode;
  x: number;
  y: number;
  isHead: boolean;
  isLocalOnly: boolean;
  canUndoHead: boolean;
};
type GraphBranchContext = {
  currentBranch?: string;
  upstream?: string;
  visibleRefIds: Set<string>;
  showAllRefs: boolean;
};

const GRAPH_TOOLBAR_ICON_SIZE = 16;
const COMMIT_HOVER_CARD_WIDTH = 400;
const COMMIT_HOVER_VIEWPORT_GAP = 12;
const COMMIT_HOVER_SPLIT_GAP = 14;
const COMMIT_HOVER_TOP_OFFSET = 20;
const COMMIT_HOVER_ARROW_SIZE = 8;
const COMMIT_DETAILS_PREFETCH_LIMIT = 8;
const GRAPH_VIRTUAL_THRESHOLD = 140;
const GRAPH_VIRTUAL_OVERSCAN = 20;
const GRAPH_OPERATION_ROW_HEIGHT = 28;
const GRAPH_SYNC_ROW_HEIGHT = 26;
const GRAPH_REFS_MENU_WIDTH = 360;
const GRAPH_REFS_MENU_ESTIMATED_HEIGHT = 360;

export function GraphSidebar({
  project,
  commits,
  historyRefs,
  historyFilter,
  onHistoryFilterChange,
  selectedHash,
  onSelectCommit,
  onSelectCommitFile,
  onPinCommitFile,
  selectedCommitFileHash,
  selectedCommitFilePath,
  onOperation,
  onCommitAction,
  panelOpen,
  onTogglePanel
}: GraphSidebarProps) {
  const [commitQuery, setCommitQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileViewMode, setFileViewMode] = useState<GraphFileViewMode>("list");
  const [refsMenuOpen, setRefsMenuOpen] = useState(false);
  const [refsMenuPosition, setRefsMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [refsQuery, setRefsQuery] = useState("");
  const [refsDraftFilter, setRefsDraftFilter] = useState<GitHistoryFilter | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuPosition, setViewMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<CommitContextMenuState | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitDetailsByHash, setCommitDetailsByHash] = useState<Record<string, CommitNode>>({});
  const [loadingDetailsHash, setLoadingDetailsHash] = useState<string | null>(null);
  const [detailsErrorByHash, setDetailsErrorByHash] = useState<Record<string, string>>({});
  const [hoveredCommit, setHoveredCommit] = useState<CommitNode | undefined>();
  const [hoveredDotHash, setHoveredDotHash] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchRowRef = useRef<HTMLDivElement>(null);
  const graphListRef = useRef<HTMLDivElement>(null);
  const refsButtonRef = useRef<HTMLButtonElement>(null);
  const refsMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuButtonRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const commitContextMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | undefined>();
  const closeTimerRef = useRef<number | undefined>();
  const graphScrollFrameRef = useRef<number | undefined>();
  const [graphListHeight, setGraphListHeight] = useState(0);
  const [graphListScrollTop, setGraphListScrollTop] = useState(0);
  const filteredCommits = useMemo(() => {
    const keyword = commitQuery.trim().toLowerCase();
    if (!keyword) {
      return commits;
    }

    return commits.filter((commit) => `${commit.hash} ${commit.subject} ${commit.authorName} ${commit.authorEmail}`.toLowerCase().includes(keyword));
  }, [commits, commitQuery]);
  const graphContext = useMemo(() => buildGraphBranchContext(project, historyRefs, historyFilter), [project, historyRefs, historyFilter]);
  const historyFilterLabel = graphHistoryFilterLabel(historyFilter, historyRefs);
  const rowTones = useMemo(() => buildGraphTones(filteredCommits, graphContext), [filteredCommits, graphContext]);
  const graphLayouts = useMemo(() => buildGraphLayouts(filteredCommits, rowTones, graphContext), [filteredCommits, rowTones, graphContext]);
  const operationProject = project && (project.status?.operationState || project.status?.hasConflicts) ? project : undefined;
  const syncProject = project && ((project.status?.ahead ?? 0) > 0 || (project.status?.behind ?? 0) > 0) ? project : undefined;
  const localOnlyCount = project?.status?.upstream ? project.status.ahead : commits.length;
  const virtualGraphEnabled = filteredCommits.length > GRAPH_VIRTUAL_THRESHOLD && !expandedHash;
  const graphVirtualRange = useMemo(() => {
    if (!virtualGraphEnabled) {
      return {
        startIndex: 0,
        endIndex: filteredCommits.length,
        topPadding: 0,
        bottomPadding: 0
      };
    }

    const fixedRowsOffset = (operationProject ? GRAPH_OPERATION_ROW_HEIGHT : 0) + (syncProject ? GRAPH_SYNC_ROW_HEIGHT : 0);
    const viewportStart = Math.max(0, graphListScrollTop - fixedRowsOffset);
    const viewportEnd = Math.max(viewportStart, graphListScrollTop + graphListHeight - fixedRowsOffset);
    const startIndex = clampNumber(Math.floor(viewportStart / graphRowHeight) - GRAPH_VIRTUAL_OVERSCAN, 0, filteredCommits.length);
    const endIndex = clampNumber(Math.ceil(viewportEnd / graphRowHeight) + GRAPH_VIRTUAL_OVERSCAN, startIndex, filteredCommits.length);

    return {
      startIndex,
      endIndex,
      topPadding: startIndex * graphRowHeight,
      bottomPadding: (filteredCommits.length - endIndex) * graphRowHeight
    };
  }, [filteredCommits.length, graphListHeight, graphListScrollTop, operationProject, syncProject, virtualGraphEnabled]);
  const visibleCommits = virtualGraphEnabled ? filteredCommits.slice(graphVirtualRange.startIndex, graphVirtualRange.endIndex) : filteredCommits;

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimerRef.current);
      window.clearTimeout(closeTimerRef.current);
      window.cancelAnimationFrame(graphScrollFrameRef.current ?? 0);
    },
    []
  );

  useLayoutEffect(() => {
    const list = graphListRef.current;
    if (!list) {
      return;
    }

    const measure = () => setGraphListHeight(list.clientHeight);
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [panelOpen]);

  useEffect(() => {
    setGraphListScrollTop(0);
    if (graphListRef.current) {
      graphListRef.current.scrollTop = 0;
    }
  }, [project?.id, commitQuery]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchRowRef.current?.contains(target) || searchButtonRef.current?.contains(target)) {
        return;
      }

      setSearchOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!refsMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refsMenuRef.current?.contains(target) || refsButtonRef.current?.contains(target)) {
        return;
      }

      closeRefsMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRefsMenu();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [refsMenuOpen]);

  useEffect(() => {
    if (!viewMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (viewMenuRef.current?.contains(target) || viewMenuButtonRef.current?.contains(target)) {
        return;
      }

      setViewMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [viewMenuOpen]);

  useEffect(() => {
    if (!commitContextMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (commitContextMenuRef.current?.contains(target)) {
        return;
      }

      setCommitContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitContextMenu(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [commitContextMenu]);

  useEffect(() => {
    setExpandedHash(null);
    setCommitDetailsByHash({});
    setDetailsErrorByHash({});
    setLoadingDetailsHash(null);
    setHoveredDotHash(null);
  }, [project?.id]);

  useEffect(() => {
    let cancelled = false;

    const prefetch = async () => {
      for (const commit of commits.slice(0, COMMIT_DETAILS_PREFETCH_LIMIT)) {
        if (cancelled || document.hidden) {
          return;
        }

        await ensureCommitDetails(commit);
      }
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [project?.id, commits]);

  function handleGraphListScroll(event: ReactUIEvent<HTMLDivElement>) {
    const scrollTop = event.currentTarget.scrollTop;
    window.cancelAnimationFrame(graphScrollFrameRef.current ?? 0);
    graphScrollFrameRef.current = window.requestAnimationFrame(() => {
      setGraphListScrollTop(scrollTop);
    });
  }

  function scheduleHover(commit: CommitNode, row: HTMLElement) {
    setHoveredDotHash(commit.hash);
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(hoverTimerRef.current);
    const rowRect = row.getBoundingClientRect();
    const sourcePaneRect = row.closest(".source-control-pane")?.getBoundingClientRect();
    const nextPosition = {
      x: (sourcePaneRect?.right ?? rowRect.right) + COMMIT_HOVER_SPLIT_GAP,
      y: rowRect.top + rowRect.height / 2
    };
    const showHover = () => {
      setHoverPosition(nextPosition);
      setHoveredCommit(commit);
    };

    if (hoveredCommit) {
      showHover();
      return;
    }

    hoverTimerRef.current = window.setTimeout(() => {
      showHover();
    }, 450);
  }

  function scheduleCloseHover() {
    setHoveredDotHash(null);
    window.clearTimeout(hoverTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoveredCommit(undefined);
    }, 160);
  }

  function keepHoverOpen() {
    window.clearTimeout(closeTimerRef.current);
  }

  function selectFileViewMode(mode: GraphFileViewMode) {
    setFileViewMode(mode);
    setViewMenuOpen(false);
  }

  function closeRefsMenu() {
    setRefsMenuOpen(false);
    setRefsDraftFilter(null);
  }

  function toggleRefsMenu() {
    const rect = refsButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const opensUp = rect.bottom + GRAPH_REFS_MENU_ESTIMATED_HEIGHT > window.innerHeight - 8;
      setRefsMenuPosition({
        top: opensUp ? Math.max(8, rect.top - GRAPH_REFS_MENU_ESTIMATED_HEIGHT - 4) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - GRAPH_REFS_MENU_WIDTH - 8))
      });
    }

    setSearchOpen(false);
    setViewMenuOpen(false);
    setRefsMenuOpen((value) => {
      const nextOpen = !value;
      setRefsDraftFilter(nextOpen ? cloneHistoryFilter(historyFilter) : null);
      return nextOpen;
    });
  }

  function selectHistoryFilterMode(mode: Exclude<GitHistoryFilter["mode"], "custom">) {
    setRefsQuery("");
    setRefsDraftFilter({ mode });
  }

  function toggleHistoryRef(ref: GitHistoryRef) {
    const draftFilter = refsDraftFilter ?? historyFilter;
    const currentRefIds = draftFilter.mode === "custom" ? draftFilter.refIds ?? [] : [];
    const nextRefIds = currentRefIds.includes(ref.id) ? currentRefIds.filter((id) => id !== ref.id) : [...currentRefIds, ref.id];
    if (nextRefIds.length === 0) {
      setRefsDraftFilter({ mode: "auto" });
      return;
    }

    setRefsDraftFilter({ mode: "custom", refIds: nextRefIds });
  }

  function applyHistoryRefFilter() {
    onHistoryFilterChange(refsDraftFilter ?? historyFilter);
    closeRefsMenu();
  }

  function toggleViewMenu() {
    const rect = viewMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setViewMenuPosition({
        top: rect.bottom + 4,
        left: rect.left - 1
      });
    }

    setSearchOpen(false);
    setViewMenuOpen((value) => !value);
  }

  function openCommitContextMenu(event: ReactMouseEvent, commit: CommitNode) {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(hoverTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
    setHoveredCommit(undefined);
    setHoveredDotHash(commit.hash);

    const commitIndex = commits.findIndex((item) => item.hash === commit.hash);
    const currentBranch = project?.status?.currentBranch;
    const isHead = currentBranch ? commit.refs.some((ref) => ref.type === "localBranch" && ref.name === currentBranch) : commitIndex === 0;
    const isLocalOnly = commitIndex >= 0 && commitIndex < localOnlyCount;
    setCommitContextMenu({
      commit,
      x: Math.min(event.clientX, window.innerWidth - 246),
      y: Math.min(event.clientY, window.innerHeight - 330),
      isHead,
      isLocalOnly,
      canUndoHead: !isHead || commit.parents.length > 0
    });
  }

  function runCommitContextAction(action: CommitGraphAction, commit: CommitNode) {
    setCommitContextMenu(null);
    onCommitAction(action, commit);
  }

  async function handleCommitClick(commit: CommitNode) {
    const nextExpandedHash = expandedHash === commit.hash ? null : commit.hash;

    if (!nextExpandedHash) {
      onSelectCommit("");
      setExpandedHash(null);
      setHoveredDotHash(null);
      return;
    }

    onSelectCommit(commit.hash);
    setHoveredDotHash(commit.hash);

    const hasReadyDetails = Boolean(commitDetailsByHash[commit.hash]) || commit.files.length > 0;
    if (!hasReadyDetails) {
      await ensureCommitDetails(commit);
    } else {
      void ensureCommitDetails(commit);
    }

    setExpandedHash(nextExpandedHash);
  }

  async function ensureCommitDetails(commit: CommitNode): Promise<CommitNode | undefined> {
    const cached = commitDetailsByHash[commit.hash];
    if (cached) {
      return cached;
    }

    if (commit.files.length > 0) {
      setCommitDetailsByHash((current) => (current[commit.hash] ? current : { ...current, [commit.hash]: commit }));
      return commit;
    }

    if (loadingDetailsHash === commit.hash) {
      return undefined;
    }

    if (!project) {
      setCommitDetailsByHash((current) => ({ ...current, [commit.hash]: commit }));
      return commit;
    }

    setLoadingDetailsHash(commit.hash);
    setDetailsErrorByHash((current) => {
      const next = { ...current };
      delete next[commit.hash];
      return next;
    });

    try {
      const details = await apiClient.getCommitDetails(project, commit.hash);
      setCommitDetailsByHash((current) => ({ ...current, [commit.hash]: details }));
      return details;
    } catch (error) {
      setDetailsErrorByHash((current) => ({
        ...current,
        [commit.hash]: error instanceof Error ? error.message : "无法读取提交变更。"
      }));
      return undefined;
    } finally {
      setLoadingDetailsHash((current) => (current === commit.hash ? null : current));
    }
  }

  return (
    <section className={`graph-sidebar graph-panel ${panelOpen ? "" : "panel-collapsed"}`}>
      <div className="graph-section-title">
        <PathTooltip content={panelOpen ? "收起图表" : "展开图表"} className="graph-title-tooltip">
          <button type="button" className="graph-title-label" aria-label={panelOpen ? "收起图表" : "展开图表"} onClick={onTogglePanel}>
            <span className="graph-title-toggle" aria-hidden="true">
              {panelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
            <span className="graph-title-text">图表</span>
            <span className="graph-count">{commits.length}</span>
          </button>
        </PathTooltip>
        {panelOpen ? (
          <div className="graph-toolbar" aria-label="图表操作">
            <PathTooltip content="选择图表引用" className="graph-toolbar-tooltip">
              <button
                ref={refsButtonRef}
                type="button"
                className={`graph-ref-filter-button ${refsMenuOpen ? "active" : ""}`}
                aria-label="选择图表引用"
                aria-haspopup="menu"
                aria-expanded={refsMenuOpen}
                onClick={toggleRefsMenu}
              >
                <GitBranch size={14} />
                <span>{historyFilterLabel}</span>
              </button>
            </PathTooltip>
            <PathTooltip content="搜索提交" className="graph-toolbar-tooltip">
              <button
                ref={searchButtonRef}
                type="button"
                className={`icon-button compact-icon ${searchOpen || commitQuery ? "active" : ""}`}
                aria-label="搜索提交"
                onClick={() => {
                  setViewMenuOpen(false);
                  setSearchOpen((value) => !value);
                }}
              >
                <Search size={GRAPH_TOOLBAR_ICON_SIZE} />
              </button>
            </PathTooltip>
            {graphOperations.map((operation) => {
              const Icon = operation.icon;
              return (
                <PathTooltip content={operation.title} className="graph-toolbar-tooltip" key={operation.label}>
                  <button type="button" className="icon-button compact-icon" aria-label={operation.title} onClick={() => onOperation(operation.label)}>
                    <Icon size={GRAPH_TOOLBAR_ICON_SIZE} />
                  </button>
                </PathTooltip>
              );
            })}
            <PathTooltip content="更多图表操作" className="graph-toolbar-tooltip">
              <button
                ref={viewMenuButtonRef}
                type="button"
                className={`icon-button compact-icon ${viewMenuOpen ? "active" : ""}`}
                aria-label="更多图表操作"
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
                onClick={toggleViewMenu}
              >
                <MoreHorizontal size={GRAPH_TOOLBAR_ICON_SIZE} />
              </button>
            </PathTooltip>
            {refsMenuOpen && refsMenuPosition && typeof document !== "undefined"
              ? createPortal(
                  <GraphHistoryRefsMenu
                    refs={historyRefs}
                    filter={refsDraftFilter ?? historyFilter}
                    query={refsQuery}
                    onQueryChange={setRefsQuery}
                    onSelectMode={selectHistoryFilterMode}
                    onToggleRef={toggleHistoryRef}
                    onApply={applyHistoryRefFilter}
                    menuRef={refsMenuRef}
                    style={refsMenuPosition}
                  />,
                  document.querySelector(".app-shell") ?? document.body
                )
              : null}
            {viewMenuOpen && viewMenuPosition && typeof document !== "undefined"
              ? createPortal(
                  <div className="floating-menu graph-view-menu graph-view-menu-portal" role="menu" style={viewMenuPosition} ref={viewMenuRef}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={fileViewMode === "list"}
                      className={fileViewMode === "list" ? "active" : ""}
                      onClick={() => selectFileViewMode("list")}
                    >
                      <span className="graph-view-menu-check" aria-hidden="true">
                        {fileViewMode === "list" ? <Check size={14} /> : null}
                      </span>
                      以列表形式查看
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={fileViewMode === "tree"}
                      className={fileViewMode === "tree" ? "active" : ""}
                      onClick={() => selectFileViewMode("tree")}
                    >
                      <span className="graph-view-menu-check" aria-hidden="true">
                        {fileViewMode === "tree" ? <Check size={14} /> : null}
                      </span>
                      以树形式查看
                    </button>
                  </div>,
                  document.querySelector(".app-shell") ?? document.body
                )
              : null}
          </div>
        ) : null}
      </div>

      {panelOpen ? (
        <>
          {searchOpen ? (
            <div className="graph-search-row" ref={searchRowRef}>
              <label className="history-search graph-search">
                <Search size={14} />
                <input
                  ref={searchInputRef}
                  value={commitQuery}
                  onChange={(event) => setCommitQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="搜索提交"
                />
              </label>
            </div>
          ) : null}

          <div className="graph-commit-list" role="list" aria-label="提交图" ref={graphListRef} onScroll={handleGraphListScroll}>
            {filteredCommits.length === 0 ? <div className="empty-state graph-empty">当前仓库没有可显示的提交。</div> : null}
            {operationProject ? <GraphOperationRow project={operationProject} /> : null}
            {syncProject ? <GraphSyncRow project={syncProject} /> : null}
            {virtualGraphEnabled && graphVirtualRange.topPadding > 0 ? <div className="graph-virtual-spacer" style={{ height: graphVirtualRange.topPadding }} aria-hidden="true" /> : null}
            {visibleCommits.map((commit, visibleIndex) => {
              const index = virtualGraphEnabled ? graphVirtualRange.startIndex + visibleIndex : visibleIndex;
              const graphLayout = graphLayouts.get(commit.hash) ?? fallbackGraphLayout(commit, rowTones.get(commit.hash) ?? "local");
              const tone = graphLayout.nodeTone;

              return (
                <GraphCommitRow
                  key={commit.hash}
                  commit={commit}
                  graphContext={graphContext}
                  graphLayout={graphLayout}
                  tone={tone}
                  selected={commit.hash === selectedHash || commit.hash === hoveredDotHash || commit.hash === expandedHash}
                  expanded={commit.hash === expandedHash}
                  details={commitDetailsByHash[commit.hash]}
                  loadingDetails={loadingDetailsHash === commit.hash}
                  detailsError={detailsErrorByHash[commit.hash]}
                  fileViewMode={fileViewMode}
                  repositoryPath={project?.path}
                  selectedFilePath={selectedCommitFileHash === commit.hash ? selectedCommitFilePath : undefined}
                  isFirst={index === 0}
                  isLast={index === filteredCommits.length - 1}
                  onSelect={() => void handleCommitClick(commit)}
                  onContextMenu={(event) => openCommitContextMenu(event, commit)}
                  onSelectFile={(file) => onSelectCommitFile(commit, file)}
                  onPinFile={(file) => onPinCommitFile(commit, file)}
                  onHoverStart={(row) => scheduleHover(commit, row)}
                  onHoverEnd={scheduleCloseHover}
                />
              );
            })}
            {virtualGraphEnabled && graphVirtualRange.bottomPadding > 0 ? <div className="graph-virtual-spacer" style={{ height: graphVirtualRange.bottomPadding }} aria-hidden="true" /> : null}
          </div>
        </>
      ) : null}
      {hoveredCommit ? (
        <CommitHoverCard commit={hoveredCommit} graphContext={graphContext} x={hoverPosition.x} y={hoverPosition.y} onMouseEnter={keepHoverOpen} onMouseLeave={scheduleCloseHover} />
      ) : null}
      {commitContextMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              className="floating-menu graph-commit-menu"
              role="menu"
              style={{ left: commitContextMenu.x, top: commitContextMenu.y }}
              ref={commitContextMenuRef}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={() => runCommitContextAction("copyHash", commitContextMenu.commit)}>
                <Copy size={14} />
                复制提交 hash
              </button>
              <button type="button" role="menuitem" onClick={() => runCommitContextAction("copyMessage", commitContextMenu.commit)}>
                <GitCommitHorizontal size={14} />
                复制提交信息
              </button>
              <div className="menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!commitContextMenu.isHead || !commitContextMenu.isLocalOnly}
                onClick={() => runCommitContextAction("amendMessage", commitContextMenu.commit)}
              >
                <MessageSquareText size={14} />
                修改此提交信息
              </button>
              <button type="button" role="menuitem" onClick={() => runCommitContextAction("revert", commitContextMenu.commit)}>
                <RotateCcw size={14} />
                还原此提交
              </button>
              <button type="button" role="menuitem" onClick={() => runCommitContextAction("cherryPick", commitContextMenu.commit)}>
                <GitCommitHorizontal size={14} />
                Cherry-pick 此提交
              </button>
              <button type="button" role="menuitem" onClick={() => runCommitContextAction("createBranch", commitContextMenu.commit)}>
                <GitBranchPlus size={14} />
                从此提交创建分支
              </button>
              <div className="menu-separator" role="separator" />
              <button type="button" role="menuitem" disabled={!commitContextMenu.canUndoHead} onClick={() => runCommitContextAction("resetSoft", commitContextMenu.commit)}>
                <Undo2 size={14} />
                {commitContextMenu.isHead ? "撤销此提交，保留更改" : "重置到此提交，保留更改"}
              </button>
              <button type="button" role="menuitem" disabled={!commitContextMenu.canUndoHead} onClick={() => runCommitContextAction("resetMixed", commitContextMenu.commit)}>
                <Undo2 size={14} />
                {commitContextMenu.isHead ? "撤销此提交，取消暂存" : "重置到此提交，取消暂存"}
              </button>
              <button type="button" role="menuitem" className="danger" disabled={!commitContextMenu.canUndoHead} onClick={() => runCommitContextAction("resetHard", commitContextMenu.commit)}>
                <AlertTriangle size={14} />
                {commitContextMenu.isHead ? "撤销此提交，丢弃更改" : "重置到此提交，丢弃更改"}
              </button>
            </div>,
            document.querySelector(".app-shell") ?? document.body
          )
        : null}
    </section>
  );
}

function GraphHistoryRefsMenu({
  refs,
  filter,
  query,
  onQueryChange,
  onSelectMode,
  onToggleRef,
  onApply,
  menuRef,
  style
}: {
  refs: GitHistoryRef[];
  filter: GitHistoryFilter;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectMode: (mode: Exclude<GitHistoryFilter["mode"], "custom">) => void;
  onToggleRef: (ref: GitHistoryRef) => void;
  onApply: () => void;
  menuRef: RefObject<HTMLDivElement>;
  style: CSSProperties;
}) {
  const selectedRefIds = new Set(filter.mode === "custom" ? filter.refIds ?? [] : []);
  const selectedCount = filter.mode === "all" || filter.mode === "auto" ? 1 : selectedRefIds.size;
  const filteredRefs = filterHistoryRefs(refs, query);
  const groups = groupHistoryRefs(filteredRefs);

  return (
    <div className="floating-menu graph-refs-menu graph-refs-menu-portal" role="menu" style={style} ref={menuRef} onPointerDown={(event) => event.stopPropagation()}>
      <div className="graph-refs-menu-header">
        <span>已选 {selectedCount} 项</span>
        <button type="button" className="graph-refs-apply" onClick={onApply}>
          确定
        </button>
      </div>
      <label className="history-search graph-refs-search">
        <Search size={14} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="筛选分支或标签" />
      </label>
      <div className="graph-refs-static">
        <button type="button" role="menuitemcheckbox" aria-checked={filter.mode === "all"} className={filter.mode === "all" ? "active" : ""} onClick={() => onSelectMode("all")}>
          <span className="graph-view-menu-check" aria-hidden="true">
            {filter.mode === "all" ? <Check size={14} /> : null}
          </span>
          <span>
            <strong>全部</strong>
            <small>所有历史记录项引用</small>
          </span>
        </button>
        <button type="button" role="menuitemcheckbox" aria-checked={filter.mode === "auto"} className={filter.mode === "auto" ? "active" : ""} onClick={() => onSelectMode("auto")}>
          <span className="graph-view-menu-check" aria-hidden="true">
            {filter.mode === "auto" ? <Check size={14} /> : null}
          </span>
          <span>
            <strong>自动</strong>
            <small>当前历史记录项引用</small>
          </span>
        </button>
      </div>
      <div className="graph-refs-list">
        {groups.map((group) => (
          <div className="graph-refs-group" key={group.category}>
            <div className="graph-refs-group-title">{historyRefCategoryLabel(group.category)}</div>
            {group.refs.map((ref) => {
              const selected = selectedRefIds.has(ref.id);
              const Icon = ref.type === "remoteBranch" ? Cloud : ref.type === "tag" ? Tag : GitBranch;
              return (
                <button type="button" role="menuitemcheckbox" aria-checked={selected} className={selected ? "active" : ""} key={ref.id} onClick={() => onToggleRef(ref)}>
                  <span className="graph-view-menu-check" aria-hidden="true">
                    {selected ? <Check size={14} /> : null}
                  </span>
                  <Icon size={14} />
                  <span className="graph-ref-picker-text">
                    <strong>{ref.name}</strong>
                    <small>{historyRefDescription(ref)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {filteredRefs.length === 0 ? <div className="graph-refs-empty">没有匹配的引用。</div> : null}
      </div>
    </div>
  );
}

function GraphCommitRow({
  commit,
  graphContext,
  graphLayout,
  tone,
  selected,
  expanded,
  details,
  loadingDetails,
  detailsError,
  fileViewMode,
  repositoryPath,
  selectedFilePath,
  isFirst,
  isLast,
  onSelect,
  onContextMenu,
  onSelectFile,
  onPinFile,
  onHoverStart,
  onHoverEnd
}: {
  commit: CommitNode;
  graphContext: GraphBranchContext;
  graphLayout: GraphRowLayout;
  tone: GraphTone;
  selected: boolean;
  expanded: boolean;
  details?: CommitNode;
  loadingDetails: boolean;
  detailsError?: string;
  fileViewMode: GraphFileViewMode;
  repositoryPath?: string;
  selectedFilePath?: string;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
  onHoverStart: (row: HTMLElement) => void;
  onHoverEnd: () => void;
}) {
  const visibleRefs = visibleRefsForCommit(commit, graphContext);
  const rowStyle = {
    "--graph-row-gutter": `${graphFileGutter(graphLayout.expansionLines)}px`
  } as CSSProperties;

  return (
    <div role="listitem" className={`graph-commit-entry graph-tone-${tone} ${expanded ? "expanded" : ""} ${isLast ? "last" : ""}`}>
      <button
        type="button"
        className={`graph-commit-row graph-tone-${tone} ${selected ? "active" : ""}`}
        style={rowStyle}
        aria-expanded={expanded}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        onMouseEnter={(event) => onHoverStart(event.currentTarget)}
        onMouseLeave={onHoverEnd}
        onFocus={(event) => onHoverStart(event.currentTarget)}
        onBlur={onHoverEnd}
      >
        <CompactGraphCell layout={graphLayout} isFirst={isFirst} />
        <span className="graph-commit-main">
          <span className="graph-commit-text">
            <span className="graph-commit-subject">{commit.subject}</span>
            {commit.authorName ? <span className="graph-commit-author">{commit.authorName}</span> : null}
          </span>
          {visibleRefs.length > 0 ? (
            <span className="graph-ref-row">
              {visibleRefs.map((ref) => (
                <span className={refChipClassName(ref, graphContext)} key={`${commit.hash}-${ref.type}-${ref.name}`}>
                  {ref.type === "remoteBranch" ? (
                    <Cloud size={10} />
                  ) : ref.type === "localBranch" ? (
                    <GitBranch size={10} />
                  ) : ref.type === "tag" ? (
                    <Tag size={10} />
                  ) : (
                    <GitCommitHorizontal size={10} />
                  )}
                  <span className="ref-chip-label">{ref.name}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <GraphCommitExpansion
          commit={details ?? commit}
          graphLayout={graphLayout}
          loading={loadingDetails}
          error={detailsError}
          viewMode={fileViewMode}
          repositoryPath={repositoryPath}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
          onPinFile={onPinFile}
        />
      ) : null}
    </div>
  );
}

function GraphCommitExpansion({
  commit,
  graphLayout,
  loading,
  error,
  viewMode,
  repositoryPath,
  selectedFilePath,
  onSelectFile,
  onPinFile
}: {
  commit: CommitNode;
  graphLayout: GraphRowLayout;
  loading: boolean;
  error?: string;
  viewMode: GraphFileViewMode;
  repositoryPath?: string;
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
}) {
  const expansionLines = graphLayout.expansionLines;
  const fileGutter = graphFileGutter(expansionLines);
  const expansionStyle = {
    "--graph-expansion-x": `${graphLayout.nodeX}px`,
    "--graph-expansion-color": graphToneColor(graphLayout.nodeTone),
    "--graph-file-gutter": `${fileGutter}px`
  } as CSSProperties;

  if (loading) {
    return (
      <div className="graph-commit-expansion graph-commit-expansion-loading" style={expansionStyle} aria-label="正在读取变更文件">
        <GraphExpansionLines lines={expansionLines} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="graph-commit-expansion graph-commit-expansion-state error" style={expansionStyle}>
        <GraphExpansionLines lines={expansionLines} />
        {error}
      </div>
    );
  }

  if (commit.files.length === 0) {
    return (
      <div className="graph-commit-expansion graph-commit-expansion-state" style={expansionStyle}>
        <GraphExpansionLines lines={expansionLines} />
        没有可显示的变更文件。
      </div>
    );
  }

  if (viewMode === "tree") {
    return (
      <div className="graph-commit-expansion" style={expansionStyle} aria-label="提交变更文件">
        <GraphExpansionLines lines={expansionLines} />
        <GraphCommitFileTree
          files={commit.files}
          repositoryPath={repositoryPath}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
          onPinFile={onPinFile}
        />
      </div>
    );
  }

  return (
    <div className="graph-commit-expansion" style={expansionStyle} aria-label="提交变更文件">
      <GraphExpansionLines lines={expansionLines} />
      {commit.files.map((file) => (
        <GraphCommitFileRow
          file={file}
          repositoryPath={repositoryPath}
          selected={selectedFilePath === file.path}
          showDirectory
          key={`${commit.hash}-${file.path}-${file.status}`}
          onSelect={() => onSelectFile(file)}
          onPin={() => onPinFile(file)}
        />
      ))}
    </div>
  );
}

function GraphExpansionLines({ lines }: { lines: GraphExpansionLine[] }) {
  return (
    <div className="graph-commit-expansion-lines" aria-hidden="true">
      {lines.map((line) => (
        <span
          className="graph-commit-expansion-line"
          style={
            {
              "--graph-expansion-line-x": `${line.x}px`,
              "--graph-expansion-line-color": graphToneColor(line.tone)
            } as CSSProperties
          }
          key={`${line.x}-${line.tone}`}
        />
      ))}
    </div>
  );
}

function graphFileGutter(lines: GraphExpansionLine[]): number {
  const maxLineX = lines.reduce((max, line) => Math.max(max, line.x), 0);
  return Math.max(graphFileBaseGutter, maxLineX + graphFileLanePadding);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type GraphFileTreeEntry =
  | {
      type: "directory";
      name: string;
      path: string;
      children: GraphFileTreeEntry[];
    }
  | {
      type: "file";
      name: string;
      file: ChangedFile;
    };

type MutableGraphFileDirectory = {
  name: string;
  path: string;
  directories: Map<string, MutableGraphFileDirectory>;
  files: ChangedFile[];
};

function GraphCommitFileTree({
  files,
  repositoryPath,
  selectedFilePath,
  onSelectFile,
  onPinFile
}: {
  files: ChangedFile[];
  repositoryPath?: string;
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
}) {
  const entries = useMemo(() => buildGraphFileTree(files), [files]);

  return (
    <div className="graph-commit-file-tree">
      {entries.map((entry) => (
        <GraphCommitFileTreeEntry
          entry={entry}
          level={0}
          repositoryPath={repositoryPath}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
          onPinFile={onPinFile}
          key={entry.type === "directory" ? `dir-${entry.path}` : `file-${entry.file.path}-${entry.file.status}`}
        />
      ))}
    </div>
  );
}

function GraphCommitFileTreeEntry({
  entry,
  level,
  repositoryPath,
  selectedFilePath,
  onSelectFile,
  onPinFile
}: {
  entry: GraphFileTreeEntry;
  level: number;
  repositoryPath?: string;
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (entry.type === "file") {
    return (
      <GraphCommitFileRow
        file={entry.file}
        repositoryPath={repositoryPath}
        selected={selectedFilePath === entry.file.path}
        showDirectory={false}
        level={level}
        onSelect={() => onSelectFile(entry.file)}
        onPin={() => onPinFile(entry.file)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className="graph-commit-folder-row"
        style={graphFileIndentStyle(level)}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span aria-hidden="true" />
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="graph-commit-folder-name">{entry.name}</span>
      </button>
      {collapsed
        ? null
        : entry.children.map((child) => (
            <GraphCommitFileTreeEntry
              entry={child}
              level={level + 1}
              repositoryPath={repositoryPath}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
              onPinFile={onPinFile}
              key={child.type === "directory" ? `dir-${child.path}` : `file-${child.file.path}-${child.file.status}`}
            />
          ))}
    </>
  );
}

function GraphCommitFileRow({
  file,
  repositoryPath,
  selected,
  level = 0,
  showDirectory = true,
  onSelect,
  onPin
}: {
  file: ChangedFile;
  repositoryPath?: string;
  selected: boolean;
  level?: number;
  showDirectory?: boolean;
  onSelect: () => void;
  onPin: () => void;
}) {
  const clickTimerRef = useRef<number | undefined>();
  const fullPath = absoluteFilePath(repositoryPath, file.path);
  const icon = fileIconInfo(file.path);

  useEffect(
    () => () => {
      window.clearTimeout(clickTimerRef.current);
    },
    []
  );

  function scheduleSelect() {
    window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      onSelect();
    }, 260);
  }

  function pinImmediately() {
    window.clearTimeout(clickTimerRef.current);
    onPin();
  }

  return (
    <button
      type="button"
      className={`graph-commit-file-row ${selected ? "active" : ""}`}
      style={graphFileIndentStyle(level)}
      onClick={scheduleSelect}
      onDoubleClick={(event) => {
        event.preventDefault();
        pinImmediately();
      }}
    >
      <span className={`scm-file-icon ${icon.className}`}>{icon.label}</span>
      <span className="graph-commit-file-main">
        <PathTooltip path={fullPath} className="graph-commit-file-name">
          {file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path}
        </PathTooltip>
        {showDirectory ? <span className="graph-commit-file-dir">{directoryName(file.path)}</span> : null}
      </span>
      <span className={`graph-commit-file-status ${file.status}`}>{statusCode(file.status)}</span>
    </button>
  );
}

function buildGraphFileTree(files: ChangedFile[]): GraphFileTreeEntry[] {
  const root: MutableGraphFileDirectory = createGraphFileDirectory("", "");

  for (const file of files) {
    const parts = file.path.split(/[\\/]/).filter(Boolean);
    let directory = root;

    for (const part of parts.slice(0, -1)) {
      const nextPath = directory.path ? `${directory.path}/${part}` : part;
      const existing = directory.directories.get(part);
      if (existing) {
        directory = existing;
        continue;
      }

      const nextDirectory = createGraphFileDirectory(part, nextPath);
      directory.directories.set(part, nextDirectory);
      directory = nextDirectory;
    }

    directory.files.push(file);
  }

  return graphFileDirectoryEntries(root);
}

function createGraphFileDirectory(name: string, path: string): MutableGraphFileDirectory {
  return {
    name,
    path,
    directories: new Map(),
    files: []
  };
}

function graphFileDirectoryEntries(directory: MutableGraphFileDirectory): GraphFileTreeEntry[] {
  const directories: GraphFileTreeEntry[] = Array.from(directory.directories.values()).map((child) => ({
    type: "directory",
    name: child.name,
    path: child.path,
    children: graphFileDirectoryEntries(child)
  }));
  const files: GraphFileTreeEntry[] = directory.files.map((file) => ({
    type: "file",
    name: file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path,
    file
  }));

  return [...directories, ...files].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function graphFileIndentStyle(level: number): CSSProperties {
  return { "--graph-file-indent": `${level * 16}px` } as CSSProperties;
}

function statusCode(status: ChangedFile["status"]): string {
  const labels: Record<ChangedFile["status"], string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "U",
    ignored: "I",
    conflicted: "!"
  };

  return labels[status];
}

function directoryName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.length > 0 ? parts.join("/") : "";
}

function buildGraphBranchContext(project: GitProject | undefined, historyRefs: GitHistoryRef[], historyFilter: GitHistoryFilter): GraphBranchContext {
  const currentBranch = project?.status?.currentBranch ?? undefined;
  const upstream = project?.status?.upstream;
  const visibleRefIds = new Set<string>();
  const currentRef = historyRefs.find((ref) => ref.current) ?? (currentBranch ? { id: `refs/heads/${currentBranch}` } : undefined);
  const upstreamRef = historyRefs.find((ref) => ref.upstream) ?? (upstream ? { id: `refs/remotes/${upstream}` } : undefined);

  if (historyFilter.mode === "custom") {
    for (const refId of historyFilter.refIds ?? []) {
      visibleRefIds.add(refId);
    }
  } else if (historyFilter.mode === "auto") {
    if (currentRef) {
      visibleRefIds.add(currentRef.id);
    }
    if (upstreamRef) {
      visibleRefIds.add(upstreamRef.id);
    }
  }

  return {
    currentBranch,
    upstream,
    visibleRefIds,
    showAllRefs: historyFilter.mode === "all"
  };
}

function visibleRefsForCommit(commit: CommitNode, graphContext: GraphBranchContext): CommitRef[] {
  return commit.refs
    .filter((ref) => isVisibleGraphRef(ref, graphContext))
    .sort((left, right) => graphRefPriority(left, graphContext) - graphRefPriority(right, graphContext) || left.name.localeCompare(right.name));
}

function isVisibleGraphRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  if (ref.name.endsWith("/HEAD")) {
    return false;
  }

  if (ref.type === "head") {
    return !graphContext.currentBranch;
  }

  if (graphContext.showAllRefs) {
    return true;
  }

  return graphContext.visibleRefIds.has(commitRefId(ref)) || isCurrentBranchRef(ref, graphContext) || isUpstreamBranchRef(ref, graphContext);
}

function isCurrentBranchRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  return ref.type === "localBranch" && Boolean(graphContext.currentBranch) && ref.name === graphContext.currentBranch;
}

function isUpstreamBranchRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  return ref.type === "remoteBranch" && Boolean(graphContext.upstream) && ref.name === graphContext.upstream;
}

function graphRefPriority(ref: CommitRef, graphContext: GraphBranchContext): number {
  if (isCurrentBranchRef(ref, graphContext)) {
    return 0;
  }

  if (isUpstreamBranchRef(ref, graphContext)) {
    return 1;
  }

  if (graphContext.visibleRefIds.has(commitRefId(ref))) {
    return 2;
  }

  if (ref.type === "tag") {
    return 4;
  }

  return 3;
}

function refChipClassName(ref: CommitRef, graphContext: GraphBranchContext): string {
  return `ref-chip ${ref.type} ${graphContext.visibleRefIds.has(commitRefId(ref)) ? "selectedRef" : ""}`;
}

function commitRefId(ref: CommitRef): string {
  switch (ref.type) {
    case "localBranch":
      return `refs/heads/${ref.name}`;
    case "remoteBranch":
      return `refs/remotes/${ref.name}`;
    case "tag":
      return `refs/tags/${ref.name}`;
    case "head":
      return "HEAD";
  }
}

function graphHistoryFilterLabel(filter: GitHistoryFilter, refs: GitHistoryRef[]): string {
  if (filter.mode === "all") {
    return "全部";
  }

  if (filter.mode === "auto") {
    return "自动";
  }

  const refIds = filter.refIds ?? [];
  if (refIds.length === 1) {
    return refs.find((ref) => ref.id === refIds[0])?.name ?? "1 项";
  }

  return `${refIds.length} 项`;
}

function cloneHistoryFilter(filter: GitHistoryFilter): GitHistoryFilter {
  return filter.mode === "custom" ? { mode: "custom", refIds: [...(filter.refIds ?? [])] } : { mode: filter.mode };
}

function filterHistoryRefs(refs: GitHistoryRef[], query: string): GitHistoryRef[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return refs;
  }

  return refs.filter((ref) => `${ref.name} ${ref.id} ${ref.category}`.toLowerCase().includes(keyword));
}

function groupHistoryRefs(refs: GitHistoryRef[]): Array<{ category: GitHistoryRef["category"]; refs: GitHistoryRef[] }> {
  const categoryOrder: GitHistoryRef["category"][] = ["branches", "remote branches", "tags"];
  return categoryOrder
    .map((category) => ({
      category,
      refs: refs.filter((ref) => ref.category === category)
    }))
    .filter((group) => group.refs.length > 0);
}

function historyRefCategoryLabel(category: GitHistoryRef["category"]): string {
  switch (category) {
    case "branches":
      return "分支";
    case "remote branches":
      return "远程分支";
    case "tags":
      return "标签";
  }
}

function historyRefDescription(ref: GitHistoryRef): string {
  const revision = ref.revision ? ref.revision.slice(0, 7) : "";
  if (ref.current) {
    return "当前分支";
  }

  if (ref.upstream) {
    return revision ? `${revision} 处的远程分支` : "处的远程分支";
  }

  if (ref.type === "remoteBranch") {
    return revision ? `${revision} 处的远程分支` : "远程分支";
  }

  if (ref.type === "tag") {
    return revision ? `${revision} 处的标签` : "标签";
  }

  return revision;
}

function GraphOperationRow({ project }: { project: GitProject }) {
  const state = project.status?.operationState;
  const hasConflicts = Boolean(project.status?.hasConflicts);
  const branch = project.status?.currentBranch ?? "分离 HEAD";
  const copy = graphOperationCopy(state, hasConflicts);

  return (
    <div className={`graph-operation-row ${hasConflicts ? "conflict" : state ?? "status"}`}>
      <span className="graph-operation-icon">{hasConflicts ? <AlertTriangle size={13} /> : <GitCommitHorizontal size={13} />}</span>
      <span className="graph-operation-label">{copy.label}</span>
      <span className="graph-operation-detail">{copy.detail ?? branch}</span>
    </div>
  );
}

function graphOperationCopy(state: GitOperationState | undefined, hasConflicts: boolean): { label: string; detail?: string } {
  if (!state) {
    return {
      label: hasConflicts ? "存在冲突" : "Git 操作进行中",
      detail: hasConflicts ? "先处理冲突文件" : undefined
    };
  }

  const conflictSuffix = hasConflicts ? "，解决冲突后继续" : "";
  switch (state) {
    case "merge":
      return { label: "正在合并", detail: `合并操作进行中${conflictSuffix}` };
    case "rebase":
      return { label: "正在变基", detail: `变基操作进行中${conflictSuffix}` };
    case "cherry-pick":
      return { label: "正在 Cherry-pick", detail: `摘取提交进行中${conflictSuffix}` };
    case "revert":
      return { label: "正在还原", detail: `还原提交进行中${conflictSuffix}` };
    case "bisect":
      return { label: "正在二分定位", detail: "Git bisect 操作进行中" };
  }
}

function GraphSyncRow({ project }: { project: GitProject }) {
  const branch = project.status?.currentBranch ?? "当前分支";
  const ahead = project.status?.ahead ?? 0;
  const behind = project.status?.behind ?? 0;
  const label =
    ahead > 0 && behind > 0
      ? `待推送 ${ahead} / 待拉取 ${behind}`
      : ahead > 0
        ? `待推送 ${ahead} 个提交`
        : `待拉取 ${behind} 个提交`;

  return (
    <div className="graph-sync-row">
      <span className={ahead > 0 && behind > 0 ? "sync-ring mixed" : ahead > 0 ? "sync-ring outgoing" : "sync-ring incoming"} />
      <span>{label}</span>
      <span>{branch}</span>
    </div>
  );
}

function CommitHoverCard({
  commit,
  graphContext,
  x,
  y,
  onMouseEnter,
  onMouseLeave
}: {
  commit: CommitNode;
  graphContext: GraphBranchContext;
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const bodyText = commit.body?.trim();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number>();
  const style = commitHoverCardStyle(x, y, cardHeight);

  useLayoutEffect(() => {
    const nextHeight = cardRef.current?.getBoundingClientRect().height;
    if (!nextHeight) {
      return;
    }

    setCardHeight((current) => (current && Math.abs(current - nextHeight) < 1 ? current : nextHeight));
  }, [bodyText, commit.hash]);

  return (
    <div className="commit-hover-card" style={style} ref={cardRef} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="commit-hover-author">
        <strong>{commit.authorName}</strong>
        <span>{commit.authorDate}</span>
      </div>
      <div className="commit-hover-subject">{commit.subject}</div>
      {bodyText ? <div className="commit-hover-body">{bodyText}</div> : null}
      <div className="commit-hover-footer">
        {visibleRefsForCommit(commit, graphContext)
          .slice(0, 4)
          .map((ref) => (
          <span className={refChipClassName(ref, graphContext)} key={`${commit.hash}-${ref.type}-${ref.name}`}>
            {ref.type === "remoteBranch" ? (
              <Cloud size={10} />
            ) : ref.type === "localBranch" ? (
              <GitBranch size={10} />
            ) : ref.type === "tag" ? (
              <Tag size={10} />
            ) : (
              <GitCommitHorizontal size={10} />
            )}
            <span className="ref-chip-label">{ref.name}</span>
          </span>
        ))}
        <code>{commit.shortHash}</code>
      </div>
    </div>
  );
}

function commitHoverCardStyle(x: number, targetY: number, cardHeight?: number): CSSProperties {
  if (typeof window === "undefined") {
    return { left: x, top: targetY };
  }

  const left = Math.max(COMMIT_HOVER_VIEWPORT_GAP, Math.min(x, window.innerWidth - COMMIT_HOVER_CARD_WIDTH - COMMIT_HOVER_VIEWPORT_GAP));
  const measuredHeight = cardHeight ?? 0;
  const preferredTop = targetY - COMMIT_HOVER_TOP_OFFSET;
  const maxTop = measuredHeight > 0 ? window.innerHeight - measuredHeight - COMMIT_HOVER_VIEWPORT_GAP : window.innerHeight - COMMIT_HOVER_VIEWPORT_GAP;
  const top = Math.max(COMMIT_HOVER_VIEWPORT_GAP, Math.min(preferredTop, maxTop));
  const arrowInset = 12;
  const arrowTop = Math.max(arrowInset, Math.min(targetY - top - COMMIT_HOVER_ARROW_SIZE / 2, Math.max(arrowInset, measuredHeight - arrowInset)));

  return {
    left,
    top,
    "--commit-hover-arrow-top": `${arrowTop}px`
  } as CSSProperties;
}

function buildGraphTones(commits: CommitNode[], graphContext: GraphBranchContext): Map<string, GraphTone> {
  const tones = new Map<string, GraphTone>();
  let activeTone: GraphTone = "plain";

  for (const commit of commits) {
    const tone: GraphTone = refTone(commit, graphContext) ?? activeTone;
    tones.set(commit.hash, tone);
    if (tone !== "plain") {
      activeTone = tone;
    }
  }

  return tones;
}

function buildGraphLayouts(commits: CommitNode[], rowTones: Map<string, GraphTone>, graphContext: GraphBranchContext): Map<string, GraphRowLayout> {
  const layouts = new Map<string, GraphRowLayout>();
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  let outputLanesFromPreviousRow: GraphLaneNode[] = [];
  let branchToneIndex = 0;

  commits.forEach((commit) => {
    const parents = visibleParentHashes(commit.parents, visibleHashes);
    const inputLanes = outputLanesFromPreviousRow.map((lane) => ({ ...lane }));
    const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.hash);
    const nodeIndex = inputIndex >= 0 ? inputIndex : inputLanes.length;
    const directTone = refTone(commit, graphContext);
    const inheritedTone = normalizedGraphTone(rowTones.get(commit.hash));
    const outputLanes: GraphLaneNode[] = [];
    let firstParentAdded = false;

    if (parents.length > 0) {
      for (const lane of inputLanes) {
        if (lane.id === commit.hash) {
          if (!firstParentAdded) {
            outputLanes.push({ id: parents[0].hash, tone: normalizedGraphTone(directTone ?? lane.tone) });
            firstParentAdded = true;
          }
          continue;
        }

        outputLanes.push({ ...lane });
      }
    } else {
      for (const lane of inputLanes) {
        if (lane.id !== commit.hash) {
          outputLanes.push({ ...lane });
        }
      }
    }

    for (let parentIndex = firstParentAdded ? 1 : 0; parentIndex < parents.length; parentIndex += 1) {
      const parentHash = parents[parentIndex].hash;
      const parentCommit = commitsByHash.get(parentHash);
      const parentTone =
        parentIndex === 0
          ? directTone ?? rowTones.get(commit.hash)
          : parentCommit
            ? refTone(parentCommit, graphContext)
            : undefined;

      outputLanes.push({
        id: parentHash,
        tone: normalizedGraphTone(parentTone ?? graphBranchLaneTone(branchToneIndex))
      });

      if (!parentTone) {
        branchToneIndex += 1;
      }
    }

    const nodeTone = outputLanes[nodeIndex]?.tone ?? inputLanes[nodeIndex]?.tone ?? directTone ?? inheritedTone;

    const segments: GraphSegment[] = [];
    const expansionLines = new Map<number, GraphExpansionLine>();
    let outputLaneIndex = 0;

    for (let index = 0; index < inputLanes.length; index += 1) {
      const inputLane = inputLanes[index];
      const inputX = graphLaneX(index);

      if (inputLane.id === commit.hash) {
        if (index !== nodeIndex) {
          segments.push({
            type: "curve",
            tone: inputLane.tone,
            x1: inputX,
            y1: 0,
            x2: graphLaneX(nodeIndex),
            y2: graphNodeCenterY,
            connectToNode: true
          });
        } else {
          outputLaneIndex += 1;
        }
        continue;
      }

      while (outputLaneIndex < outputLanes.length && outputLanes[outputLaneIndex].id === commit.hash) {
        outputLaneIndex += 1;
      }

      if (outputLaneIndex < outputLanes.length && inputLane.id === outputLanes[outputLaneIndex].id) {
        const outputX = graphLaneX(outputLaneIndex);
        if (index === outputLaneIndex) {
          segments.push({ type: "line", tone: inputLane.tone, x: inputX, y1: 0, y2: graphRowHeight });
        } else {
          segments.push({
            type: "curve",
            tone: inputLane.tone,
            x1: inputX,
            y1: 0,
            x2: outputX,
            y2: graphRowHeight
          });
        }
        expansionLines.set(outputLaneIndex, { x: outputX, tone: inputLane.tone });
        outputLaneIndex += 1;
      }
    }

    const nodeX = graphLaneX(nodeIndex);
    if (inputIndex >= 0) {
      segments.push({ type: "line", tone: inputLanes[inputIndex].tone, x: nodeX, y1: 0, y2: graphNodeCenterY });
    }

    if (parents.length > 0) {
      const outputTone = outputLanes[nodeIndex]?.tone ?? nodeTone;
      segments.push({ type: "line", tone: outputTone, x: nodeX, y1: graphNodeCenterY, y2: graphRowHeight });
      expansionLines.set(nodeIndex, { x: nodeX, tone: outputTone });

      for (let parentIndex = 1; parentIndex < parents.length; parentIndex += 1) {
        const parentOutputIndex = findLastGraphLaneIndex(outputLanes, parents[parentIndex].hash);
        if (parentOutputIndex < 0 || parentOutputIndex === nodeIndex) {
          continue;
        }

        segments.push({
          type: "curve",
          tone: outputLanes[parentOutputIndex].tone,
          x1: nodeX,
          y1: graphNodeCenterY,
          x2: graphLaneX(parentOutputIndex),
          y2: graphRowHeight,
          merge: true
        });
        expansionLines.set(parentOutputIndex, { x: graphLaneX(parentOutputIndex), tone: outputLanes[parentOutputIndex].tone });
      }
    }

    layouts.set(commit.hash, {
      segments,
      expansionLines: Array.from(expansionLines.values()).sort((left, right) => left.x - right.x),
      nodeX,
      nodeTone: normalizedGraphTone(nodeTone),
      merge: commit.parents.length > 1
    });

    outputLanesFromPreviousRow = outputLanes;
  });

  return layouts;
}

function findLastGraphLaneIndex(lanes: GraphLaneNode[], id: string): number {
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    if (lanes[index].id === id) {
      return index;
    }
  }

  return -1;
}

function fallbackGraphLayout(commit: CommitNode, tone: GraphTone): GraphRowLayout {
  const normalizedTone = normalizedGraphTone(tone);
  const segments: GraphSegment[] = commit.parents.length > 0 ? [{ type: "line", tone: normalizedTone, x: graphLaneX(0), y1: graphNodeCenterY, y2: graphRowHeight }] : [];
  return {
    segments,
    expansionLines: commit.parents.length > 0 ? [{ x: graphLaneX(0), tone: normalizedTone }] : [],
    nodeX: graphLaneX(0),
    nodeTone: normalizedTone,
    merge: commit.parents.length > 1
  };
}

function visibleParentHashes(parents: string[], visibleHashes: Set<string>): VisibleGraphParent[] {
  const result: VisibleGraphParent[] = [];
  parents.forEach((parent, parentIndex) => {
    const visibleParent = visibleParentHash(parent, visibleHashes);
    if (!visibleParent || result.some((item) => item.hash === visibleParent)) {
      return;
    }

    result.push({ hash: visibleParent, parentIndex });
  });

  return result;
}

function visibleParentHash(parent: string, visibleHashes: Set<string>): string | undefined {
  return visibleHashes.has(parent) ? parent : Array.from(visibleHashes).find((hash) => hash.startsWith(parent));
}

function normalizedGraphTone(tone: GraphTone | undefined): GraphTone {
  return tone && tone !== "plain" ? tone : "local";
}

function graphBranchLaneTone(laneIndex: number): GraphTone {
  return graphBranchTones[Math.max(0, laneIndex - 1) % graphBranchTones.length];
}

function graphLaneX(laneIndex: number): number {
  return 8 + Math.min(laneIndex, 2) * 14;
}

function graphToneColor(tone: GraphTone): string {
  switch (tone) {
    case "remote":
      return "#b886ff";
    case "primary":
      return "#f97316";
    case "secondary":
      return "#f0c36b";
    case "branch-rose":
      return "#d63384";
    case "branch-cyan":
      return "#0ea5a8";
    case "branch-violet":
      return "#8b5cf6";
    case "branch-amber":
      return "#f0b429";
    case "branch-green":
      return "#22a06b";
    case "local":
    case "synced":
    case "plain":
    default:
      return "#2f98ff";
  }
}

function CompactGraphCell({ layout, isFirst }: { layout: GraphRowLayout; isFirst: boolean }) {
  return (
    <svg className={`compact-graph-cell graph-tone-${layout.nodeTone} ${isFirst ? "graph-first-node" : ""}`} viewBox={`0 0 44 ${graphRowHeight}`} aria-hidden="true">
      {layout.segments.map((segment, index) =>
        segment.type === "line" ? (
          <line
            x1={segment.x}
            y1={segment.y1}
            x2={segment.x}
            y2={segment.y2}
            className={`graph-line graph-line-${segment.tone}`}
            key={`line-${index}-${segment.x}-${segment.y1}-${segment.y2}`}
          />
        ) : (
          <path
            d={graphCurvePath(segment)}
            className={`graph-line graph-line-${segment.tone}`}
            key={`curve-${index}-${segment.x1}-${segment.x2}`}
          />
        )
      )}
      {layout.merge ? (
        <>
          <circle cx={layout.nodeX} cy={graphNodeCenterY} r={graphMergeRingRadius} className={`graph-merge-ring graph-node-${layout.nodeTone}`} />
          <circle cx={layout.nodeX} cy={graphNodeCenterY} r="2.3" className={`graph-merge-dot graph-node-${layout.nodeTone}`} />
        </>
      ) : (
        <circle cx={layout.nodeX} cy={graphNodeCenterY} r={graphNodeRadius} className={`graph-node graph-node-${layout.nodeTone}`} />
      )}
    </svg>
  );
}

function graphCurvePath(segment: Extract<GraphSegment, { type: "curve" }>): string {
  if (segment.connectToNode) {
    const midY = (segment.y1 + segment.y2) / 2;
    const direction = graphCurveDirection(segment.x1, segment.x2);
    const nodeX = segment.x2 + direction * graphMergeRingRadius;
    const nodeControlX = nodeX + direction * graphNodeCurveControl;
    return `M ${segment.x1} ${segment.y1} C ${segment.x1} ${midY} ${nodeControlX} ${segment.y2} ${nodeX} ${segment.y2}`;
  }

  if (!segment.merge) {
    return `M ${segment.x1} ${segment.y1} C ${segment.x1} ${graphNodeCenterY} ${segment.x2} ${graphNodeCenterY} ${segment.x2} ${segment.y2}`;
  }

  const midY = (segment.y1 + segment.y2) / 2;
  const direction = graphCurveDirection(segment.x2, segment.x1);
  const nodeX = segment.x1 + direction * graphMergeRingRadius;
  const nodeControlX = nodeX + direction * graphNodeCurveControl;
  return `M ${nodeX} ${segment.y1} C ${nodeControlX} ${segment.y1} ${segment.x2} ${segment.y2 - graphLaneCurveControl} ${segment.x2} ${segment.y2}`;
}

function graphCurveDirection(targetX: number, originX: number): number {
  return targetX >= originX ? 1 : -1;
}

function refTone(commit: CommitNode, graphContext: GraphBranchContext): GraphTone | undefined {
  const visibleRefs = visibleRefsForCommit(commit, graphContext);
  const hasCurrent = visibleRefs.some((ref) => isCurrentBranchRef(ref, graphContext));
  const hasUpstream = visibleRefs.some((ref) => isUpstreamBranchRef(ref, graphContext));
  const hasSelected = visibleRefs.some((ref) => graphContext.visibleRefIds.has(commitRefId(ref)));

  if (hasCurrent && hasUpstream) {
    return "synced";
  }

  if (hasCurrent) {
    return "local";
  }

  if (hasUpstream) {
    return "remote";
  }

  if (hasSelected) {
    return "primary";
  }

  return undefined;
}
