import { ChevronDown, ChevronRight, Cloud, CloudDownload, CloudUpload, GitBranch, MoreHorizontal, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommitNode, GitProject } from "../types/domain";

interface GraphSidebarProps {
  project?: GitProject;
  commits: CommitNode[];
  selectedHash: string;
  onSelectCommit: (hash: string) => void;
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

export function GraphSidebar({ project, commits, selectedHash, onSelectCommit, onOperation, panelOpen, onTogglePanel }: GraphSidebarProps) {
  const [commitQuery, setCommitQuery] = useState("");
  const [hoveredCommit, setHoveredCommit] = useState<CommitNode | undefined>();
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
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

  return (
    <section className={`graph-sidebar graph-panel ${panelOpen ? "" : "panel-collapsed"}`}>
      <div className="graph-section-title">
        <button type="button" className="graph-title-toggle" onClick={onTogglePanel}>
          {panelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          图表
          <span>{commits.length}</span>
        </button>
        {panelOpen ? (
          <div className="graph-toolbar" aria-label="图表操作">
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
          <div className="graph-search-row">
            <label className="history-search graph-search">
              <Search size={14} />
              <input value={commitQuery} onChange={(event) => setCommitQuery(event.target.value)} placeholder="搜索提交" />
            </label>
          </div>

          <div className="graph-commit-list" role="list" aria-label="提交图">
            {filteredCommits.length === 0 ? <div className="empty-state graph-empty">当前仓库没有可显示的提交。</div> : null}
            {syncProject ? <GraphSyncRow project={syncProject} /> : null}
            {filteredCommits.map((commit, index) => {
              const tone = rowTones.get(commit.hash) ?? "plain";
              const visibleRefs = commit.refs.filter((ref) => ref.type !== "head");

              return (
                <button
                  type="button"
                  role="listitem"
                  className={`graph-commit-row graph-tone-${tone} ${commit.hash === selectedHash ? "active" : ""}`}
                  key={commit.hash}
                  onClick={() => onSelectCommit(commit.hash)}
                  onMouseEnter={(event) => scheduleHover(commit, event.currentTarget)}
                  onMouseLeave={scheduleCloseHover}
                  onFocus={(event) => {
                    scheduleHover(commit, event.currentTarget);
                  }}
                  onBlur={scheduleCloseHover}
                >
                  <CompactGraphCell isFirst={index === 0} isLast={index === filteredCommits.length - 1} tone={tone} />
                  <span className="graph-commit-main">
                    <span className="graph-commit-subject">{commit.subject}</span>
                    {visibleRefs.length > 0 ? (
                      <span className="graph-ref-row">
                        {visibleRefs.map((ref) => (
                          <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
                            {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
                            {ref.name}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
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
        {commit.refs.slice(0, 4).map((ref) => (
          <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
            {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
            {ref.name}
          </span>
        ))}
        <code>{commit.shortHash}</code>
      </div>
    </div>
  );
}

function CompactGraphCell({ isFirst, isLast, tone }: { isFirst: boolean; isLast: boolean; tone: GraphTone }) {
  return (
    <svg className={`compact-graph-cell graph-tone-${tone}`} viewBox="0 0 24 34" aria-hidden="true">
      {!isFirst ? <line x1="12" y1="0" x2="12" y2="15" className="graph-line" /> : null}
      {!isLast ? <line x1="12" y1="21" x2="12" y2="34" className="graph-line" /> : null}
      <circle cx="12" cy="18" r="4.2" className="graph-node" />
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
