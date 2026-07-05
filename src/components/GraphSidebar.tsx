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
  Undo2
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../api/client";
import { PathTooltip } from "./PathTooltip";
import type { ChangedFile, CommitGraphAction, CommitNode, CommitRef, GitProject } from "../types/domain";
import { fileIconInfo } from "../utils/fileIcon";
import { absoluteFilePath } from "../utils/filePath";

interface GraphSidebarProps {
  project?: GitProject;
  commits: CommitNode[];
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
const graphMergeCurveTones: GraphBranchTone[] = ["branch-rose", "branch-amber", "branch-cyan", "branch-violet", "branch-green"];
const graphRowHeight = 28;
const graphNodeCenterY = 14;
const graphNodeRadius = 4.2;
const graphNodeTopY = graphNodeCenterY - graphNodeRadius;
const graphNodeBottomY = graphNodeCenterY + graphNodeRadius;
const graphLineOverlap = 2;
const graphNodeOverlap = 1;

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
  nodePass?: Extract<GraphSegment, { type: "line" }>;
  nodeX: number;
  nodeTone: GraphTone;
  merge: boolean;
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
  primaryBranches: Set<string>;
};

const GRAPH_TOOLBAR_ICON_SIZE = 16;
const COMMIT_HOVER_CARD_WIDTH = 400;
const COMMIT_HOVER_VIEWPORT_GAP = 12;
const COMMIT_HOVER_SPLIT_GAP = 14;
const COMMIT_HOVER_TOP_OFFSET = 20;
const COMMIT_HOVER_ARROW_SIZE = 8;

export function GraphSidebar({
  project,
  commits,
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
  const viewMenuButtonRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const commitContextMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | undefined>();
  const closeTimerRef = useRef<number | undefined>();
  const filteredCommits = useMemo(() => {
    const keyword = commitQuery.trim().toLowerCase();
    if (!keyword) {
      return commits;
    }

    return commits.filter((commit) => `${commit.hash} ${commit.subject} ${commit.authorName} ${commit.authorEmail}`.toLowerCase().includes(keyword));
  }, [commits, commitQuery]);
  const graphContext = useMemo(() => buildGraphBranchContext(project), [project?.status?.currentBranch, project?.status?.upstream]);
  const rowTones = useMemo(() => buildGraphTones(filteredCommits, graphContext), [filteredCommits, graphContext]);
  const graphLayouts = useMemo(() => buildGraphLayouts(filteredCommits, rowTones, graphContext), [filteredCommits, rowTones, graphContext]);
  const syncProject = project && ((project.status?.ahead ?? 0) > 0 || (project.status?.behind ?? 0) > 0) ? project : undefined;
  const localOnlyCount = project?.status?.upstream ? project.status.ahead : commits.length;

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimerRef.current);
      window.clearTimeout(closeTimerRef.current);
    },
    []
  );

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
      for (const commit of commits.slice(0, 40)) {
        if (cancelled) {
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

          <div className="graph-commit-list" role="list" aria-label="提交图">
            {filteredCommits.length === 0 ? <div className="empty-state graph-empty">当前仓库没有可显示的提交。</div> : null}
            {syncProject ? <GraphSyncRow project={syncProject} /> : null}
            {filteredCommits.map((commit, index) => {
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

  return (
    <div role="listitem" className={`graph-commit-entry graph-tone-${tone} ${expanded ? "expanded" : ""} ${isLast ? "last" : ""}`}>
      <button
        type="button"
        className={`graph-commit-row graph-tone-${tone} ${selected ? "active" : ""}`}
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
                  {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
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
  loading,
  error,
  viewMode,
  repositoryPath,
  selectedFilePath,
  onSelectFile,
  onPinFile
}: {
  commit: CommitNode;
  loading: boolean;
  error?: string;
  viewMode: GraphFileViewMode;
  repositoryPath?: string;
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
}) {
  if (loading) {
    return <div className="graph-commit-expansion graph-commit-expansion-loading" aria-label="正在读取变更文件" />;
  }

  if (error) {
    return <div className="graph-commit-expansion graph-commit-expansion-state error">{error}</div>;
  }

  if (commit.files.length === 0) {
    return <div className="graph-commit-expansion graph-commit-expansion-state">没有可显示的变更文件。</div>;
  }

  if (viewMode === "tree") {
    return (
      <div className="graph-commit-expansion" aria-label="提交变更文件">
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
    <div className="graph-commit-expansion" aria-label="提交变更文件">
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

function buildGraphBranchContext(project?: GitProject): GraphBranchContext {
  const currentBranch = project?.status?.currentBranch ?? undefined;
  const upstream = project?.status?.upstream;

  return {
    currentBranch,
    upstream,
    primaryBranches: primaryBranchNames(upstream)
  };
}

function primaryBranchNames(upstream?: string): Set<string> {
  const names = new Set(["master", "main", "origin/master", "origin/main"]);
  const remoteName = upstream ? upstream.split("/")[0] : undefined;

  if (remoteName) {
    names.add(`${remoteName}/master`);
    names.add(`${remoteName}/main`);
  }

  return names;
}

function visibleRefsForCommit(commit: CommitNode, graphContext: GraphBranchContext): CommitRef[] {
  return commit.refs
    .filter((ref) => isVisibleGraphRef(ref, graphContext))
    .sort((left, right) => graphRefPriority(left, graphContext) - graphRefPriority(right, graphContext) || left.name.localeCompare(right.name));
}

function isVisibleGraphRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  if (ref.type === "head" || ref.name.endsWith("/HEAD")) {
    return false;
  }

  return isCurrentBranchRef(ref, graphContext) || isUpstreamBranchRef(ref, graphContext) || isPrimaryBranchRef(ref, graphContext);
}

function isCurrentBranchRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  return ref.type === "localBranch" && Boolean(graphContext.currentBranch) && ref.name === graphContext.currentBranch;
}

function isUpstreamBranchRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  return ref.type === "remoteBranch" && Boolean(graphContext.upstream) && ref.name === graphContext.upstream;
}

function isPrimaryBranchRef(ref: CommitRef, graphContext: GraphBranchContext): boolean {
  if (ref.type !== "localBranch" && ref.type !== "remoteBranch") {
    return false;
  }

  if (isCurrentBranchRef(ref, graphContext) || isUpstreamBranchRef(ref, graphContext)) {
    return false;
  }

  return graphContext.primaryBranches.has(ref.name);
}

function graphRefPriority(ref: CommitRef, graphContext: GraphBranchContext): number {
  if (isCurrentBranchRef(ref, graphContext)) {
    return 0;
  }

  if (isUpstreamBranchRef(ref, graphContext)) {
    return 1;
  }

  if (isPrimaryBranchRef(ref, graphContext)) {
    return ref.type === "remoteBranch" ? 2 : 3;
  }

  return 4;
}

function refChipClassName(ref: CommitRef, graphContext: GraphBranchContext): string {
  return `ref-chip ${ref.type} ${isPrimaryBranchRef(ref, graphContext) ? "primaryBranch" : ""}`;
}

function GraphSyncRow({ project }: { project: GitProject }) {
  const branch = project.status?.currentBranch ?? "当前分支";
  const ahead = project.status?.ahead ?? 0;
  const behind = project.status?.behind ?? 0;
  const label = ahead > 0 && behind > 0 ? "传入/传出的更改" : ahead > 0 ? "传出的更改" : "传入的更改";

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
            {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
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
  const firstParentMainline = buildFirstParentMainline(commits, visibleHashes);
  const lanes: string[] = [];
  const laneTones: GraphTone[] = [];
  const laneSideBranches: boolean[] = [];
  const laneStartsAtNode: boolean[] = [];
  let mergeCurveToneIndex = 0;

  commits.forEach((commit, rowIndex) => {
    let laneIndex = lanes.indexOf(commit.hash);
    const existedInLane = laneIndex >= 0;
    const inheritedTone = normalizedGraphTone(rowTones.get(commit.hash));
    const directTone = refTone(commit, graphContext);
    const isMainlineCommit = firstParentMainline.has(commit.hash);

    if (laneIndex < 0) {
      laneIndex = 0;
      lanes.splice(0, 0, commit.hash);
      laneTones.splice(0, 0, directTone ?? inheritedTone);
      laneSideBranches.splice(0, 0, false);
      laneStartsAtNode.splice(0, 0, false);
    }

    const laneTone = normalizedGraphTone(laneTones[laneIndex] ?? directTone);
    const laneIsSideBranch = laneSideBranches[laneIndex] ?? false;
    const laneStartsHere = laneStartsAtNode[laneIndex] ?? false;
    const nodeTone = laneIsSideBranch && !isMainlineCommit && isBranchGraphTone(laneTone) ? laneTone : directTone ?? inheritedTone;
    laneTones[laneIndex] = nodeTone;
    laneSideBranches[laneIndex] = laneIsSideBranch && !isMainlineCommit;
    laneStartsAtNode[laneIndex] = false;
    const closingLaneIndices = lanes.reduce<number[]>((indices, hash, index) => {
      if (index !== laneIndex && hash === commit.hash) {
        indices.push(index);
      }

      return indices;
    }, []);
    const closingLaneIndexSet = new Set(closingLaneIndices);

    const segments: GraphSegment[] = [];
    let nodePass: Extract<GraphSegment, { type: "line" }> | undefined;
    lanes.forEach((_hash, index) => {
      const tone = normalizedGraphTone(laneTones[index]);
      const x = graphLaneX(index);
      if (closingLaneIndexSet.has(index)) {
        return;
      }

      if (index === laneIndex) {
        if (existedInLane && rowIndex > 0) {
          if (laneIsSideBranch && isBranchGraphTone(nodeTone)) {
            nodePass = { type: "line", tone, x, y1: laneStartsHere ? graphNodeCenterY : -graphLineOverlap, y2: graphRowHeight + graphLineOverlap };
          } else if (!laneStartsHere) {
            segments.push({ type: "line", tone, x, y1: 0, y2: graphNodeTopY - 1 });
          }
        }
        return;
      }

      segments.push({
        type: "line",
        tone,
        x,
        y1: isBranchGraphTone(tone) ? -graphLineOverlap : 0,
        y2: isBranchGraphTone(tone) ? graphRowHeight + graphLineOverlap : graphRowHeight
      });
    });
    closingLaneIndices.forEach((index) => {
      segments.push({
        type: "curve",
        tone: normalizedGraphTone(laneTones[index]),
        x1: graphLaneX(index),
        y1: 0,
        x2: graphNodeConnectionX(laneIndex, commit.parents.length > 1),
        y2: graphNodeCenterY,
        connectToNode: true
      });
    });

    const parents = visibleParentHashes(commit.parents, visibleHashes);
    const nextLanes = lanes.slice();
    const nextLaneTones = laneTones.slice();
    const nextLaneSideBranches = laneSideBranches.slice();
    const nextLaneStartsAtNode = laneStartsAtNode.slice();
    nextLanes.splice(laneIndex, 1);
    nextLaneTones.splice(laneIndex, 1);
    nextLaneSideBranches.splice(laneIndex, 1);
    nextLaneStartsAtNode.splice(laneIndex, 1);
    removeGraphLaneEntries(nextLanes, nextLaneTones, nextLaneSideBranches, nextLaneStartsAtNode, commit.hash);

    const parentTargets = parents.map(({ hash: parentHash, parentIndex }) => {
      const parentCommit = commitsByHash.get(parentHash);
      const directParentTone = parentCommit ? refTone(parentCommit, graphContext) : undefined;
      const parentMainlineTone = directParentTone ?? normalizedGraphTone(rowTones.get(parentHash));
      let targetIndex = nextLanes.indexOf(parentHash);
      const targetExists = targetIndex >= 0;
      const targetLaneIsSideBranch = targetExists ? nextLaneSideBranches[targetIndex] : false;
      const parentIsNextRow = parentHash === commits[rowIndex + 1]?.hash;
      const closesSideToNextMainNode = parentIndex === 0 && laneIsSideBranch && parentIsNextRow && targetExists && !targetLaneIsSideBranch;
      const connectsMergeToNextNode = parentIndex > 0 && parentIsNextRow;
      const targetCommitIsMerge = (parentCommit?.parents.length ?? 0) > 1;

      if (targetIndex < 0) {
        targetIndex = Math.min(laneIndex + parentIndex, nextLanes.length);
      }

      const parentIsSideBranch = parentIndex > 0 || (laneIsSideBranch && !closesSideToNextMainNode);
      let parentTone: GraphTone;
      let edgeTone: GraphTone;

      if (parentIndex > 0) {
        const sideLaneIndex = targetExists && !targetLaneIsSideBranch ? targetIndex + 1 : targetIndex;
        parentTone = targetExists && targetLaneIsSideBranch ? normalizedGraphTone(nextLaneTones[targetIndex]) : graphBranchLaneTone(sideLaneIndex);
        if (targetExists && targetLaneIsSideBranch) {
          edgeTone = nextGraphMergeCurveTone(mergeCurveToneIndex);
          mergeCurveToneIndex += 1;
        } else {
          edgeTone = parentTone;
        }
      } else if (parentIsSideBranch) {
        parentTone = nodeTone;
        edgeTone = nodeTone;
      } else {
        parentTone = parentMainlineTone;
        edgeTone = nodeTone;
      }

      if (targetExists && parentIsSideBranch && !targetLaneIsSideBranch) {
        targetIndex += 1;
        nextLanes.splice(targetIndex, 0, parentHash);
        nextLaneTones.splice(targetIndex, 0, parentTone);
        nextLaneSideBranches.splice(targetIndex, 0, true);
        nextLaneStartsAtNode.splice(targetIndex, 0, connectsMergeToNextNode);
      } else if (targetExists && !parentIsSideBranch && targetLaneIsSideBranch) {
        nextLanes.splice(targetIndex, 0, parentHash);
        nextLaneTones.splice(targetIndex, 0, parentTone);
        nextLaneSideBranches.splice(targetIndex, 0, false);
        nextLaneStartsAtNode.splice(targetIndex, 0, false);
      } else if (!targetExists) {
        nextLanes.splice(targetIndex, 0, parentHash);
        nextLaneTones.splice(targetIndex, 0, parentTone);
        nextLaneSideBranches.splice(targetIndex, 0, parentIsSideBranch);
        nextLaneStartsAtNode.splice(targetIndex, 0, connectsMergeToNextNode);
      } else if (parentIsSideBranch) {
        nextLaneTones[targetIndex] = parentTone;
        nextLaneSideBranches[targetIndex] = true;
        nextLaneStartsAtNode[targetIndex] = connectsMergeToNextNode || nextLaneStartsAtNode[targetIndex];
      } else {
        nextLaneTones[targetIndex] = parentTone;
        nextLaneSideBranches[targetIndex] = false;
        nextLaneStartsAtNode[targetIndex] = false;
      }

      return {
        laneIndex: targetIndex,
        parentIndex,
        tone: normalizedGraphTone(edgeTone),
        connectToNode: connectsMergeToNextNode || closesSideToNextMainNode,
        sourceOnLane: closesSideToNextMainNode,
        targetMerge: targetCommitIsMerge,
        targetOnLane: parentIndex > 0
      };
    });

    for (const target of parentTargets) {
      const sourceX = target.sourceOnLane ? graphLaneX(laneIndex) : target.connectToNode || target.parentIndex > 0 ? graphNodeConnectionX(laneIndex, commit.parents.length > 1) : graphLaneX(laneIndex);
      const targetX = target.targetOnLane ? graphLaneX(target.laneIndex) : target.connectToNode ? graphNodeConnectionX(target.laneIndex, target.targetMerge) : graphLaneX(target.laneIndex);
      const sourceY =
        target.sourceOnLane || (laneIsSideBranch && target.laneIndex === laneIndex && target.parentIndex === 0 && !target.connectToNode)
          ? graphNodeBottomY - graphNodeOverlap
          : target.connectToNode
            ? graphNodeCenterY
            : target.parentIndex === 0
              ? graphNodeBottomY
              : graphNodeCenterY;
      const targetY = target.targetOnLane ? graphRowHeight + graphNodeTopY + graphNodeOverlap : target.connectToNode ? graphRowHeight + graphNodeCenterY : graphRowHeight;
      if (targetX === sourceX) {
        if (laneIsSideBranch && target.parentIndex === 0 && !target.connectToNode) {
          continue;
        }

        segments.push({ type: "line", tone: target.tone, x: targetX, y1: sourceY, y2: targetY });
      } else {
        segments.push({
          type: "curve",
          tone: target.tone,
          x1: sourceX,
          y1: sourceY,
          x2: targetX,
          y2: targetY,
          merge: target.parentIndex > 0,
          connectToNode: target.connectToNode
        });
      }
    }

    layouts.set(commit.hash, {
      segments,
      nodePass,
      nodeX: graphLaneX(laneIndex),
      nodeTone,
      merge: commit.parents.length > 1
    });

    lanes.splice(0, lanes.length, ...nextLanes);
    laneTones.splice(0, laneTones.length, ...nextLaneTones.map(normalizedGraphTone));
    laneSideBranches.splice(0, laneSideBranches.length, ...nextLaneSideBranches);
    laneStartsAtNode.splice(0, laneStartsAtNode.length, ...nextLaneStartsAtNode);
  });

  return layouts;
}

function fallbackGraphLayout(commit: CommitNode, tone: GraphTone): GraphRowLayout {
  return {
    segments: commit.parents.length > 0 ? [{ type: "line", tone: normalizedGraphTone(tone), x: graphLaneX(0), y1: graphNodeBottomY, y2: graphRowHeight }] : [],
    nodeX: graphLaneX(0),
    nodeTone: normalizedGraphTone(tone),
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

function removeGraphLaneEntries(lanes: string[], laneTones: GraphTone[], laneSideBranches: boolean[], laneStartsAtNode: boolean[], hash: string) {
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    if (lanes[index] !== hash) {
      continue;
    }

    lanes.splice(index, 1);
    laneTones.splice(index, 1);
    laneSideBranches.splice(index, 1);
    laneStartsAtNode.splice(index, 1);
  }
}

function buildFirstParentMainline(commits: CommitNode[], visibleHashes: Set<string>): Set<string> {
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const mainline = new Set<string>();
  let currentHash: string | undefined = commits[0]?.hash;

  while (currentHash && !mainline.has(currentHash)) {
    mainline.add(currentHash);
    const currentCommit = commitsByHash.get(currentHash);
    currentHash = currentCommit?.parents[0] ? visibleParentHash(currentCommit.parents[0], visibleHashes) : undefined;
  }

  return mainline;
}

function visibleParentHash(parent: string, visibleHashes: Set<string>): string | undefined {
  return visibleHashes.has(parent) ? parent : Array.from(visibleHashes).find((hash) => hash.startsWith(parent));
}

function normalizedGraphTone(tone: GraphTone | undefined): GraphTone {
  return tone && tone !== "plain" ? tone : "local";
}

function isBranchGraphTone(tone: GraphTone): boolean {
  return tone === "secondary" || graphBranchTones.includes(tone as GraphBranchTone);
}

function graphBranchLaneTone(laneIndex: number): GraphTone {
  return graphBranchTones[Math.max(0, laneIndex - 1) % graphBranchTones.length];
}

function nextGraphMergeCurveTone(index: number): GraphTone {
  return graphMergeCurveTones[index % graphMergeCurveTones.length];
}

function graphLaneX(laneIndex: number): number {
  return 8 + Math.min(laneIndex, 2) * 14;
}

function graphNodeConnectionX(laneIndex: number, merge: boolean): number {
  return graphLaneX(laneIndex) + (merge ? 5.2 : 4.2);
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
          <circle cx={layout.nodeX} cy={graphNodeCenterY} r="5.2" className={`graph-merge-ring graph-node-${layout.nodeTone}`} />
          <circle cx={layout.nodeX} cy={graphNodeCenterY} r="2.3" className={`graph-merge-dot graph-node-${layout.nodeTone}`} />
        </>
      ) : (
        <circle cx={layout.nodeX} cy={graphNodeCenterY} r="4.2" className={`graph-node graph-node-${layout.nodeTone}`} />
      )}
      {layout.nodePass ? (
        <line
          x1={layout.nodePass.x}
          y1={layout.nodePass.y1}
          x2={layout.nodePass.x}
          y2={layout.nodePass.y2}
          className={`graph-line graph-line-${layout.nodePass.tone} graph-node-pass`}
        />
      ) : null}
    </svg>
  );
}

function graphCurvePath(segment: Extract<GraphSegment, { type: "curve" }>): string {
  if (segment.connectToNode) {
    const bulgeX = Math.max(segment.x1, segment.x2) + 6;
    return `M ${segment.x1} ${segment.y1} C ${bulgeX} ${segment.y1} ${bulgeX} ${segment.y2} ${segment.x2} ${segment.y2}`;
  }

  if (!segment.merge) {
    return `M ${segment.x1} ${segment.y1} C ${segment.x1} ${graphRowHeight} ${segment.x2} ${graphRowHeight - 3} ${segment.x2} ${segment.y2}`;
  }

  const direction = segment.x2 > segment.x1 ? 1 : -1;
  const bulgeX = segment.x2 + direction * 6;
  return `M ${segment.x1} ${segment.y1} C ${bulgeX} ${segment.y1} ${bulgeX} ${segment.y2 - 4} ${segment.x2} ${segment.y2}`;
}

function refTone(commit: CommitNode, graphContext: GraphBranchContext): GraphTone | undefined {
  const visibleRefs = visibleRefsForCommit(commit, graphContext);
  const hasCurrent = visibleRefs.some((ref) => isCurrentBranchRef(ref, graphContext));
  const hasUpstream = visibleRefs.some((ref) => isUpstreamBranchRef(ref, graphContext));
  const hasPrimary = visibleRefs.some((ref) => isPrimaryBranchRef(ref, graphContext));

  if (hasCurrent && hasUpstream) {
    return "synced";
  }

  if (hasCurrent) {
    return "local";
  }

  if (hasUpstream) {
    return "remote";
  }

  if (hasPrimary) {
    return "primary";
  }

  return undefined;
}
