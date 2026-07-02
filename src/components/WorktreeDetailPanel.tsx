import { CheckCircle2, Copy, FileText } from "lucide-react";
import type { ChangedFile, DiffLine } from "../types/domain";

interface WorktreeDetailPanelProps {
  file?: ChangedFile;
  diffLines: DiffLine[];
}

export function WorktreeDetailPanel({ file, diffLines }: WorktreeDetailPanelProps) {
  if (!file) {
    return (
      <aside className="detail-panel worktree-detail-panel">
        <div className="empty-state detail-empty">选择一个更改文件后查看文件路径、状态和 inline diff。</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel worktree-detail-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">工作区文件</span>
          <h2>{file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path}</h2>
        </div>
        <button type="button" className="icon-button" title="复制文件路径" onClick={() => void navigator.clipboard.writeText(file.path)}>
          <Copy size={16} />
        </button>
      </div>

      <div className="commit-meta">
        <MetaItem label="路径" value={file.path} />
        <MetaItem label="状态" value={statusLabel(file.status)} />
        <MetaItem label="区域" value={file.staged ? "已暂存的更改" : "更改"} />
      </div>

      <section className="diff-panel">
        <div className="section-title">
          <CheckCircle2 size={16} />
          Inline Diff
        </div>
        <div className="diff-file-name">
          <FileText size={14} />
          {file.path}
        </div>
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
      </section>
    </aside>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
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
