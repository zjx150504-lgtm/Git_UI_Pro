import { AlertTriangle, CheckCircle2, Clock, Copy, FileText } from "lucide-react";
import type { ChangedFile, CommitNode, DiffLine } from "../types/domain";

interface DetailPanelProps {
  commit?: CommitNode;
  diffLines: DiffLine[];
  selectedFilePath?: string;
  onSelectFile: (file: ChangedFile) => void;
}

export function DetailPanel({ commit, diffLines, selectedFilePath, onSelectFile }: DetailPanelProps) {
  if (!commit) {
    return (
      <aside className="detail-panel">
        <div className="empty-state detail-empty">选择一个提交后查看提交信息、文件列表和 inline diff。</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">提交详情</span>
          <h2>{commit.subject}</h2>
        </div>
        <button type="button" className="icon-button" title="复制完整 hash" onClick={() => void navigator.clipboard.writeText(commit.hash)}>
          <Copy size={16} />
        </button>
      </div>

      <div className="commit-meta">
        <MetaItem label="作者" value={`${commit.authorName} <${commit.authorEmail}>`} />
        <MetaItem label="提交时间" value={commit.authorDate} icon={<Clock size={14} />} />
        <MetaItem label="Commit" value={commit.hash} />
        <MetaItem label="父提交" value={commit.parents.length > 0 ? commit.parents.join(", ") : "无"} />
      </div>

      {commit.body ? <p className="commit-body">{commit.body}</p> : null}

      <section className="changed-files">
        <div className="section-title">
          <FileText size={16} />
          变更文件
        </div>
        {commit.files.map((file) => (
          <ChangedFileRow file={file} selected={file.path === selectedFilePath} onSelectFile={onSelectFile} key={`${file.path}-${file.status}`} />
        ))}
        {commit.files.length === 0 ? <div className="empty-inline">该提交没有可解析的文件变更。</div> : null}
      </section>

      <section className="diff-panel">
        <div className="section-title">
          <CheckCircle2 size={16} />
          Inline Diff
        </div>
        <div className="diff-file-name">{selectedFilePath ?? commit.files[0]?.path ?? "未选择文件"}</div>
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

      <div className="danger-note">
        <AlertTriangle size={16} />
        危险操作会在执行前使用中文二次确认。
      </div>
    </aside>
  );
}

function MetaItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="meta-item">
      <span className="meta-label">
        {icon}
        {label}
      </span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

function ChangedFileRow({ file, selected, onSelectFile }: { file: ChangedFile; selected: boolean; onSelectFile: (file: ChangedFile) => void }) {
  return (
    <button type="button" className={`file-row file-row-button ${selected ? "active" : ""}`} onClick={() => onSelectFile(file)}>
      <span className={`file-status ${file.status}`}>{statusLabel(file.status)}</span>
      <span className="file-path">{file.path}</span>
    </button>
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
