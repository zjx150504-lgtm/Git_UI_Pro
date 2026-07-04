import { Check, ChevronDown, ChevronRight, Cloud, CloudDownload, CloudUpload, GitBranch, MoreHorizontal, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../api/client";
import { PathTooltip } from "./PathTooltip";
import type { ChangedFile, CommitNode, GitProject } from "../types/domain";
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

type GraphTone = "local" | "remote" | "synced" | "plain";
type GraphFileViewMode = "list" | "tree";

const GRAPH_TOOLBAR_ICON_SIZE = 16;

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
  panelOpen,
  onTogglePanel
}: GraphSidebarProps) {
  const [commitQuery, setCommitQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileViewMode, setFileViewMode] = useState<GraphFileViewMode>("list");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuPosition, setViewMenuPosition] = useState<{ top: number; left: number } | null>(null);
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
  const hoverTimerRef = useRef<number | undefined>();
  const closeTimerRef = useRef<number | undefined>();
  const filteredCommits = useMemo(() => {
    const keyword = commitQuery.trim().toLowerCase();
    if (!keyword) {
      return commits;
    }

    return commits.filter((commit) => `${commit.hash} ${commit.subject} ${commit.authorName} ${commit.authorEmail}`.toLowerCase().includes(keyword));
  }, [commits, commitQuery]);
  const rowTones = useMemo(() => buildGraphTones(filteredCommits), [filteredCommits]);
  const syncProject = project && ((project.status?.ahead ?? 0) > 0 || (project.status?.behind ?? 0) > 0) ? project : undefined;

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
    const rect = row.getBoundingClientRect();
    setHoverPosition({ x: rect.right + 8, y: rect.top - 4 });
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredCommit(commit);
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
        <button type="button" className="graph-title-label" title={panelOpen ? "收起图表" : "展开图表"} onClick={onTogglePanel}>
          <span className="graph-title-toggle" aria-hidden="true">
            {panelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="graph-title-text">图表</span>
          <span className="graph-count">{commits.length}</span>
        </button>
        {panelOpen ? (
          <div className="graph-toolbar" aria-label="图表操作">
            <button
              ref={searchButtonRef}
              type="button"
              className={`icon-button compact-icon ${searchOpen || commitQuery ? "active" : ""}`}
              title="搜索提交"
              onClick={() => {
                setViewMenuOpen(false);
                setSearchOpen((value) => !value);
              }}
            >
              <Search size={GRAPH_TOOLBAR_ICON_SIZE} />
            </button>
            {graphOperations.map((operation) => {
              const Icon = operation.icon;
              return (
                <button type="button" className="icon-button compact-icon" title={operation.title} key={operation.label} onClick={() => onOperation(operation.label)}>
                  <Icon size={GRAPH_TOOLBAR_ICON_SIZE} />
                </button>
              );
            })}
            <button
              ref={viewMenuButtonRef}
              type="button"
              className={`icon-button compact-icon ${viewMenuOpen ? "active" : ""}`}
              title="更多图表操作"
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              onClick={toggleViewMenu}
            >
              <MoreHorizontal size={GRAPH_TOOLBAR_ICON_SIZE} />
            </button>
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
              const tone = rowTones.get(commit.hash) ?? "plain";

              return (
                <GraphCommitRow
                  key={commit.hash}
                  commit={commit}
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
        <CommitHoverCard commit={hoveredCommit} x={hoverPosition.x} y={hoverPosition.y} onMouseEnter={keepHoverOpen} onMouseLeave={scheduleCloseHover} />
      ) : null}
    </section>
  );
}

function GraphCommitRow({
  commit,
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
  onSelectFile,
  onPinFile,
  onHoverStart,
  onHoverEnd
}: {
  commit: CommitNode;
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
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
  onHoverStart: (row: HTMLElement) => void;
  onHoverEnd: () => void;
}) {
  const visibleRefs = commit.refs.filter((ref) => ref.type !== "head" && !ref.name.endsWith("/HEAD"));

  return (
    <div role="listitem" className={`graph-commit-entry graph-tone-${tone} ${expanded ? "expanded" : ""} ${isLast ? "last" : ""}`}>
      <button
        type="button"
        className={`graph-commit-row graph-tone-${tone} ${selected ? "active" : ""}`}
        aria-expanded={expanded}
        onClick={onSelect}
        onMouseEnter={(event) => onHoverStart(event.currentTarget)}
        onMouseLeave={onHoverEnd}
        onFocus={(event) => onHoverStart(event.currentTarget)}
        onBlur={onHoverEnd}
      >
        <CompactGraphCell isFirst={isFirst} isLast={isLast} tone={tone} />
        <span className="graph-commit-main">
          <span className="graph-commit-text">
            <span className="graph-commit-subject">{commit.subject}</span>
            {commit.authorName ? <span className="graph-commit-author">{commit.authorName}</span> : null}
          </span>
          {visibleRefs.length > 0 ? (
            <span className="graph-ref-row">
              {visibleRefs.map((ref) => (
                <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
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
      <span className={`scm-file-icon ${fileIconClass(file.path)}`}>{fileIcon(file.path)}</span>
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

function fileIcon(filePath: string): string {
  if (/\.(tsx|jsx)$/i.test(filePath)) {
    return "TSX";
  }
  if (/\.tsx?$/i.test(filePath)) {
    return "TS";
  }
  if (/\.css$/i.test(filePath)) {
    return "#";
  }
  if (/\.md$/i.test(filePath)) {
    return "MD";
  }
  return "";
}

function fileIconClass(filePath: string): string {
  if (/\.(tsx|jsx)$/i.test(filePath)) {
    return "react";
  }
  if (/\.tsx?$/i.test(filePath)) {
    return "typescript";
  }
  if (/\.css$/i.test(filePath)) {
    return "css";
  }
  if (/\.md$/i.test(filePath)) {
    return "markdown";
  }
  return "";
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
  x,
  y,
  onMouseEnter,
  onMouseLeave
}: {
  commit: CommitNode;
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const bodyLines = commit.body
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 7);

  const left = typeof window === "undefined" ? x : Math.max(12, Math.min(x, window.innerWidth - 430));
  const top = typeof window === "undefined" ? y : Math.max(12, Math.min(y, window.innerHeight - 360));

  return (
    <div className="commit-hover-card" style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="commit-hover-author">
        <strong>{commit.authorName}</strong>
        <span>{commit.authorDate}</span>
      </div>
      <div className="commit-hover-subject">{commit.subject}</div>
      {bodyLines && bodyLines.length > 0 ? (
        <ol className="commit-hover-body">
          {bodyLines.map((line, index) => (
            <li key={`${commit.hash}-${index}`}>{line.replace(/^\d+[.)、]\s*/, "")}</li>
          ))}
        </ol>
      ) : null}
      <div className="commit-hover-footer">
        {commit.refs
          .filter((ref) => ref.type !== "head" && !ref.name.endsWith("/HEAD"))
          .slice(0, 4)
          .map((ref) => (
          <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
            {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
            <span className="ref-chip-label">{ref.name}</span>
          </span>
        ))}
        <code>{commit.shortHash}</code>
      </div>
    </div>
  );
}

function CompactGraphCell({ isFirst, isLast, tone }: { isFirst: boolean; isLast: boolean; tone: GraphTone }) {
  return (
    <svg className={`compact-graph-cell graph-tone-${tone} ${isFirst ? "graph-first-node" : ""}`} viewBox="0 0 24 32" aria-hidden="true">
      {!isFirst ? <line x1="12" y1="0" x2="12" y2="13" className="graph-line" /> : null}
      {!isLast ? <line x1="12" y1="19" x2="12" y2="32" className="graph-line" /> : null}
      <circle cx="12" cy="16" r="4.2" className="graph-node" />
    </svg>
  );
}

function buildGraphTones(commits: CommitNode[]): Map<string, GraphTone> {
  const tones = new Map<string, GraphTone>();
  let activeTone: GraphTone = "plain";

  for (const commit of commits) {
    const tone: GraphTone = refTone(commit) ?? activeTone;
    tones.set(commit.hash, tone);
    if (tone !== "plain") {
      activeTone = tone;
    }
  }

  return tones;
}

function refTone(commit: CommitNode): GraphTone | undefined {
  const hasLocal = commit.refs.some((ref) => ref.type === "head" || ref.type === "localBranch");
  const hasRemote = commit.refs.some((ref) => ref.type === "remoteBranch");

  if (hasLocal && hasRemote) {
    return "synced";
  }

  if (hasLocal) {
    return "local";
  }

  if (hasRemote) {
    return "remote";
  }

  return undefined;
}
