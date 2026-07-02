import { Copy, FileText, X } from "lucide-react";
import type { ChangedFile, DiffLine } from "../types/domain";

export interface WorktreeEditorTab {
  id: string;
  file: ChangedFile;
  diffLines: DiffLine[];
  pinned: boolean;
}

interface WorktreeDetailPanelProps {
  tabs: WorktreeEditorTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
}

export function WorktreeDetailPanel({ tabs, activeTabId, onSelectTab, onCloseTab, onPinTab }: WorktreeDetailPanelProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) {
    return (
      <aside className="detail-panel worktree-detail-panel editor-detail-panel empty">
        <div className="editor-empty-state">
          <FileText size={20} />
          <span>选择文件查看变更。</span>
        </div>
      </aside>
    );
  }

  const { file, diffLines } = activeTab;

  return (
    <aside className="detail-panel worktree-detail-panel editor-detail-panel">
      <div className="editor-tab-row">
        <div className="editor-tabs" role="tablist" aria-label="工作树文件">
          {tabs.map((tab) => (
            <div
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeTab.id}
              className={`editor-tab ${tab.id === activeTab.id ? "active" : ""} ${tab.pinned ? "pinned" : "preview"}`}
              key={tab.id}
              title={tab.pinned ? tab.file.path : `${tab.file.path} - 双击固定`}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={() => onPinTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSelectTab(tab.id);
                }
              }}
            >
              <FileText size={14} />
              <span className="editor-tab-name">{tab.file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? tab.file.path}</span>
              <small>{statusLabel(tab.file.status)}</small>
              <button
                type="button"
                className="editor-tab-close"
                title="关闭文件"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
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
