import { ChevronDown, ChevronRight, Cloud, CloudDownload, CloudUpload, GitBranch, MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommitNode } from "../types/domain";

interface GraphSidebarProps {
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
  { label: "切换分支", title: "切换分支", icon: GitBranch },
  { label: "删除分支", title: "删除本地分支", icon: Trash2 }
];

export function GraphSidebar({ commits, selectedHash, onSelectCommit, onOperation, panelOpen, onTogglePanel }: GraphSidebarProps) {
  const [commitQuery, setCommitQuery] = useState("");
  const [hoveredCommit, setHoveredCommit] = useState<CommitNode | undefined>();
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const filteredCommits = useMemo(() => {
    const keyword = commitQuery.trim().toLowerCase();
    if (!keyword) {
      return commits;
    }

    return commits.filter((commit) => `${commit.hash} ${commit.subject} ${commit.authorName} ${commit.authorEmail}`.toLowerCase().includes(keyword));
  }, [commits, commitQuery]);

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
            {filteredCommits.map((commit, index) => (
              <button
                type="button"
                role="listitem"
                className={`graph-commit-row ${commit.hash === selectedHash ? "active" : ""}`}
                key={commit.hash}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredCommit(commit);
                  setHoverPosition({ x: rect.right, y: rect.top });
                  onSelectCommit(commit.hash);
                }}
                onMouseEnter={(event) => {
                  setHoveredCommit(commit);
                  setHoverPosition({ x: event.clientX, y: event.clientY });
                }}
                onMouseMove={(event) => setHoverPosition({ x: event.clientX, y: event.clientY })}
                onMouseLeave={() => setHoveredCommit(undefined)}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredCommit(commit);
                  setHoverPosition({ x: rect.right, y: rect.top });
                }}
                onBlur={() => setHoveredCommit(undefined)}
              >
                <CompactGraphCell isFirst={index === 0} isLast={index === filteredCommits.length - 1} />
                <span className="graph-commit-main">
                  <span className="graph-commit-title-row">
                    <span className="graph-commit-subject">{commit.subject}</span>
                  </span>
                  <span className="graph-commit-meta">
                    <span>{commit.shortHash}</span>
                    <span>{commit.authorName}</span>
                  </span>
                  {commit.refs.length > 0 ? (
                    <span className="graph-ref-row">
                      {commit.refs.map((ref) => (
                        <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
                          {ref.type === "remoteBranch" ? <Cloud size={10} /> : ref.type === "localBranch" ? <GitBranch size={10} /> : null}
                          {ref.name}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {hoveredCommit ? <CommitHoverCard commit={hoveredCommit} x={hoverPosition.x} y={hoverPosition.y} /> : null}
    </section>
  );
}

function CommitHoverCard({ commit, x, y }: { commit: CommitNode; x: number; y: number }) {
  const bodyLines = commit.body
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 9);

  return (
    <div className="commit-hover-card" style={{ left: x + 18, top: y + 18 }}>
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

function CompactGraphCell({ isFirst, isLast }: { isFirst: boolean; isLast: boolean }) {
  return (
    <svg className="compact-graph-cell" viewBox="0 0 24 42" aria-hidden="true">
      {!isFirst ? <line x1="12" y1="0" x2="12" y2="15" className="graph-line" /> : null}
      {!isLast ? <line x1="12" y1="27" x2="12" y2="42" className="graph-line" /> : null}
      <circle cx="12" cy="21" r="4.6" className="graph-node" />
    </svg>
  );
}
