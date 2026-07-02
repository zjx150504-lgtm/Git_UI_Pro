import { Copy, FileText, X } from "lucide-react";
import type { ChangedFile, DiffLine } from "../types/domain";

interface WorktreeDetailPanelProps {
  file?: ChangedFile;
  diffLines: DiffLine[];
  onCloseFile: () => void;
}

export function WorktreeDetailPanel({ file, diffLines, onCloseFile }: WorktreeDetailPanelProps) {
  if (!file) {
    return (
      <aside className="detail-panel worktree-detail-panel editor-detail-panel">
        <div className="editor-empty-state">
          <FileText size={22} />
          <span>选择一个工作树文件查看对比。</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel worktree-detail-panel editor-detail-panel">
      <div className="editor-tab-row">
        <div className="editor-tab active">
          <FileText size={14} />
          <span>{file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path}</span>
          <small>{statusLabel(file.status)}</small>
          <button type="button" className="editor-tab-close" title="关闭当前文件" onClick={onCloseFile}>
            <X size={13} />
          </button>
        </div>
        <button type="button" className="icon-button compact-icon" title="复制文件路径" onClick={() => void navigator.clipboard.writeText(file.path)}>
          <Copy size={15} />
        </button>
      </div>

      <div className="editor-breadcrumb">
        <span>{file.staged ? "已暂存的更改" : "更改"}</span>
        <span>{file.path}</span>
      </div>

      <section className="diff-panel editor-diff-panel">
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
