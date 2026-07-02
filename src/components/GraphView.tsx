import { useMemo, useState } from "react";
import { Cloud, Copy, GitBranch, GitCommitHorizontal, GitFork, GitPullRequest, History, Search, Tag } from "lucide-react";
import type { CommitNode } from "../types/domain";

interface GraphViewProps {
  commits: CommitNode[];
  selectedHash: string;
  onSelectCommit: (hash: string) => void;
}

export function GraphView({ commits, selectedHash, onSelectCommit }: GraphViewProps) {
  const [query, setQuery] = useState("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("全部分支");
  const branchOptions = useMemo(() => {
    const names = new Set<string>();
    for (const commit of commits) {
      for (const ref of commit.refs) {
        if (ref.type === "localBranch" || ref.type === "remoteBranch") {
          names.add(ref.name);
        }
      }
    }
    return ["全部分支", ...Array.from(names).sort((left, right) => left.localeCompare(right, "zh-CN"))];
  }, [commits]);

  const filteredCommits = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const branchFiltered = commits;

    if (!keyword) {
      return branchFiltered;
    }

    return branchFiltered.filter((commit) =>
      `${commit.hash} ${commit.subject} ${commit.authorName} ${commit.authorEmail}`.toLowerCase().includes(keyword)
    );
  }, [commits, query, selectedBranch]);

  return (
    <section className="history-view">
      <div className="history-tools">
        <div className="history-title">
          <GitCommitHorizontal size={16} />
          源代码管理: 图形
        </div>
        <div className="history-filter-row">
          <label className="history-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作者、提交信息、hash" />
          </label>
          <div className="filter-menu-anchor">
            <button type="button" className="filter-button icon-only" title={selectedBranch} onClick={() => setBranchMenuOpen((value) => !value)}>
              <GitBranch size={16} />
            </button>
            {branchMenuOpen ? (
              <div className="floating-menu branch-menu">
                {branchOptions.map((branch) => (
                  <button
                    type="button"
                    className={branch === selectedBranch ? "active" : ""}
                    key={branch}
                    onClick={() => {
                      setSelectedBranch(branch);
                      setBranchMenuOpen(false);
                    }}
                  >
                    {branch}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="filter-button icon-only" title="远程">
            <Cloud size={16} />
          </button>
          <button type="button" className="filter-button icon-only" title="最近 90 天">
            <History size={16} />
          </button>
          <button type="button" className="filter-button icon-only" title="只看合并提交">
            <GitPullRequest size={16} />
          </button>
          <button type="button" className="filter-button icon-only" title="分支关系">
            <GitFork size={16} />
          </button>
          {selectedBranch !== "全部分支" ? <span className="active-filter-label">{selectedBranch}</span> : null}
        </div>
      </div>

      <div className="commit-table" role="list" aria-label="提交历史">
        {filteredCommits.length === 0 ? <div className="empty-state">当前仓库还没有可显示的提交历史。</div> : null}
        {filteredCommits.map((commit, index) => (
          <button
            type="button"
            role="listitem"
            className={`commit-row ${commit.hash === selectedHash ? "active" : ""}`}
            key={commit.hash}
            onClick={() => onSelectCommit(commit.hash)}
          >
            <CommitGraphCell commit={commit} isFirst={index === 0} isLast={index === commits.length - 1} />
            <div className="commit-summary">
              <div className="commit-title-row">
                <span className="commit-title">{commit.subject}</span>
                <span className="commit-hash">{commit.shortHash}</span>
              </div>
              <div className="ref-row">
                {commit.refs.map((ref) => (
                  <span className={`ref-chip ${ref.type}`} key={`${commit.hash}-${ref.type}-${ref.name}`}>
                    {ref.type === "tag" ? <Tag size={12} /> : null}
                    {ref.name}
                  </span>
                ))}
              </div>
            </div>
            <span className="commit-author">{commit.authorName}</span>
            <span className="commit-date">{commit.authorDate}</span>
            <span
              role="button"
              tabIndex={0}
              className="copy-hash"
              title="复制 commit hash"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(commit.hash);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  void navigator.clipboard.writeText(commit.hash);
                }
              }}
            >
              <Copy size={15} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CommitGraphCell({ commit, isFirst, isLast }: { commit: CommitNode; isFirst: boolean; isLast: boolean }) {
  const x = 24;

  return (
    <svg className="commit-graph-cell" viewBox="0 0 56 46" aria-hidden="true">
      {!isFirst ? <line x1={x} y1="0" x2={x} y2="18" className="graph-line" /> : null}
      {!isLast ? <line x1={x} y1="28" x2={x} y2="46" className="graph-line" /> : null}
      <circle cx={x} cy="23" r="5.5" className="graph-node" />
    </svg>
  );
}
