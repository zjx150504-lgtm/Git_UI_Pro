import { ChevronDown, ChevronRight, Cloud, CloudDownload, CloudUpload, GitBranch, MoreHorizontal, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";
import type { ChangedFile, CommitNode, GitProject } from "../types/domain";

interface GraphSidebarProps {
  project?: GitProject;
  commits: CommitNode[];
  selectedHash: string;
  onSelectCommit: (hash: string) => void;
  onSelectCommitFile: (commit: CommitNode, file: ChangedFile) => void;
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

export function GraphSidebar({
  project,
  commits,
  selectedHash,
  onSelectCommit,
  onSelectCommitFile,
  selectedCommitFileHash,
  selectedCommitFilePath,
  onOperation,
  panelOpen,
  onTogglePanel
}: GraphSidebarProps) {
  const [commitQuery, setCommitQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitDetailsByHash, setCommitDetailsByHash] = useState<Record<string, CommitNode>>({});
  const [loadingDetailsHash, setLoadingDetailsHash] = useState<string | null>(null);
  const [detailsErrorByHash, setDetailsErrorByHash] = useState<Record<string, string>>({});
  const [hoveredCommit, setHoveredCommit] = useState<CommitNode | undefined>();
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
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
    setExpandedHash(null);
    setCommitDetailsByHash({});
    setDetailsErrorByHash({});
    setLoadingDetailsHash(null);
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
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(hoverTimerRef.current);
    const rect = row.getBoundingClientRect();
    setHoverPosition({ x: rect.right + 8, y: rect.top - 4 });
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredCommit(commit);
    }, 450);
  }

  function scheduleCloseHover() {
    window.clearTimeout(hoverTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoveredCommit(undefined);
    }, 160);
  }

  function keepHoverOpen() {
    window.clearTimeout(closeTimerRef.current);
  }

  async function handleCommitClick(commit: CommitNode) {
    const nextExpandedHash = expandedHash === commit.hash ? null : commit.hash;
    onSelectCommit(commit.hash);

    if (!nextExpandedHash) {
      setExpandedHash(null);
      return;
    }

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
        <div className="graph-title-label">
          <button type="button" className="graph-title-toggle" title={panelOpen ? "收起图表" : "展开图表"} onClick={onTogglePanel}>
            {panelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <span className="graph-title-text">图表</span>
          <span className="graph-count">{commits.length}</span>
        </div>
        {panelOpen ? (
          <div className="graph-toolbar" aria-label="图表操作">
            <button
              type="button"
              className={`icon-button compact-icon ${searchOpen || commitQuery ? "active" : ""}`}
              title="搜索提交"
              onClick={() => setSearchOpen((value) => !value)}
            >
              <Search size={14} />
            </button>
            {graphOperations.map((operation) => {
              const Icon = operation.icon;
              return (
                <button type="button" className="icon-button compact-icon" title={operation.title} key={operation.label} onClick={() => onOperation(operation.label)}>
                  <Icon size={14} />
                </button>
              );
            })}
            <button type="button" className="icon-button compact-icon" title="更多图表操作">
              <MoreHorizontal size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {panelOpen ? (
        <>
          {searchOpen ? (
            <div className="graph-search-row">
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
                  selected={commit.hash === selectedHash}
                  expanded={commit.hash === expandedHash}
                  details={commitDetailsByHash[commit.hash]}
                  loadingDetails={loadingDetailsHash === commit.hash}
                  detailsError={detailsErrorByHash[commit.hash]}
                  selectedFilePath={selectedCommitFileHash === commit.hash ? selectedCommitFilePath : undefined}
                  isFirst={index === 0}
                  isLast={index === filteredCommits.length - 1}
                  onSelect={() => void handleCommitClick(commit)}
                  onSelectFile={(file) => onSelectCommitFile(commit, file)}
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
  selectedFilePath,
  isFirst,
  isLast,
  onSelect,
  onSelectFile,
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
  selectedFilePath?: string;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onSelectFile: (file: ChangedFile) => void;
  onHoverStart: (row: HTMLElement) => void;
  onHoverEnd: () => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const subjectMeasureRef = useRef<HTMLSpanElement>(null);
  const authorMeasureRef = useRef<HTMLSpanElement>(null);
  const [showAuthor, setShowAuthor] = useState(false);
  const visibleRefs = commit.refs.filter((ref) => ref.type !== "head" && !ref.name.endsWith("/HEAD"));

  useEffect(() => {
    const textElement = textRef.current;
    if (!textElement || !commit.authorName) {
      setShowAuthor(false);
      return;
    }

    const measure = () => {
      const subjectWidth = subjectMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const authorWidth = authorMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const availableWidth = textElement.getBoundingClientRect().width;
      const authorGap = 8;
      setShowAuthor(subjectWidth + authorGap + authorWidth <= availableWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(textElement);
    return () => observer.disconnect();
  }, [commit.authorName, commit.subject]);

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
          <span className="graph-commit-text" ref={textRef}>
            <span className="graph-commit-subject">{commit.subject}</span>
            {showAuthor ? <span className="graph-commit-author">{commit.authorName}</span> : null}
            <span className="graph-measure" ref={subjectMeasureRef} aria-hidden="true">
              {commit.subject}
            </span>
            <span className="graph-measure" ref={authorMeasureRef} aria-hidden="true">
              {commit.authorName}
            </span>
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
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
        />
      ) : null}
    </div>
  );
}

function GraphCommitExpansion({
  commit,
  loading,
  error,
  selectedFilePath,
  onSelectFile
}: {
  commit: CommitNode;
  loading: boolean;
  error?: string;
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
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

  return (
    <div className="graph-commit-expansion" aria-label="提交变更文件">
      {commit.files.map((file) => (
        <button
          type="button"
          className={`graph-commit-file-row ${selectedFilePath === file.path ? "active" : ""}`}
          title={file.path}
          key={`${commit.hash}-${file.path}-${file.status}`}
          onClick={() => onSelectFile(file)}
        >
          <span className={`scm-file-icon ${fileIconClass(file.path)}`}>{fileIcon(file.path)}</span>
          <span className="graph-commit-file-main">
            <span className="graph-commit-file-name">{file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path}</span>
            <span className="graph-commit-file-dir">{directoryName(file.path)}</span>
          </span>
          <span className={`graph-commit-file-status ${file.status}`}>{statusCode(file.status)}</span>
        </button>
      ))}
    </div>
  );
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
    <svg className={`compact-graph-cell graph-tone-${tone}`} viewBox="0 0 24 32" aria-hidden="true">
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
