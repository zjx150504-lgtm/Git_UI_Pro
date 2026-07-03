import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Undo2 } from "lucide-react";
import type { ChangedFile, CommitInput, GitProject, WorktreeState } from "../types/domain";

interface WorkspaceViewProps {
  project?: GitProject;
  worktree: WorktreeState;
  onRefresh: () => void;
  onStageFile: (file: ChangedFile) => void;
  onStageAll: () => void;
  onUnstageFile: (file: ChangedFile) => void;
  onUnstageAll: () => void;
  onDiscardFile: (file: ChangedFile) => void;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
  selectedFilePath?: string;
  selectedFileStaged?: boolean;
  onCommit: (input: CommitInput) => void;
  focusRequest: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function WorkspaceView({
  project,
  worktree,
  onRefresh,
  onStageFile,
  onStageAll,
  onUnstageFile,
  onUnstageAll,
  onDiscardFile,
  onSelectFile,
  onPinFile,
  selectedFilePath,
  selectedFileStaged,
  onCommit,
  focusRequest,
  panelOpen,
  onTogglePanel
}: WorkspaceViewProps) {
  const [message, setMessage] = useState("");
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const commitActionsRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const changeCount = worktree.unstagedFiles.length + worktree.stagedFiles.length;
  const commitDisabled = worktree.stagedFiles.length === 0;

  useEffect(() => {
    if (focusRequest > 0) {
      messageInputRef.current?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    if (!commitMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!commitActionsRef.current?.contains(event.target as Node)) {
        setCommitMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [commitMenuOpen]);

  function submitCommit(options: Partial<CommitInput> = {}) {
    const commitMessage = splitCommitMessage(message);
    onCommit({
      ...commitMessage,
      ...options
    });
    setCommitMenuOpen(false);
  }

  return (
    <section className={`scm-view ${panelOpen ? "" : "panel-collapsed"}`}>
      <div className="scm-titlebar">
        <span>源代码管理</span>
        <button type="button" className="icon-button" title="刷新工作区" onClick={onRefresh}>
          <RefreshCw size={16} />
        </button>
      </div>

      <button type="button" className="scm-panel-toggle" onClick={onTogglePanel}>
        {panelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>更改</span>
        <span className="scm-count">{changeCount}</span>
      </button>

      {panelOpen ? (
        <div className="scm-panel-body">
          <form
            className="scm-commit-box"
            onSubmit={(event) => {
              event.preventDefault();
              submitCommit();
            }}
          >
            <textarea
              ref={messageInputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.ctrlKey && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`消息(Ctrl+Enter) 在"${project?.status?.currentBranch ?? "当前分支"}"提交`}
              rows={2}
            />
            <div className="scm-commit-actions" ref={commitActionsRef}>
              <button type="submit" className="scm-commit-button" disabled={commitDisabled}>
                <Check size={17} />
                提交
              </button>
              <button type="button" className="scm-commit-menu" title="提交选项" onClick={() => setCommitMenuOpen((value) => !value)}>
                <ChevronDown size={17} />
              </button>
              {commitMenuOpen ? (
                <div className="floating-menu commit-menu">
                  <button type="button" disabled={commitDisabled} onClick={() => submitCommit()}>
                    提交
                  </button>
                  <button type="button" onClick={() => submitCommit({ amend: true })}>
                    修改上次提交
                  </button>
                  <button type="button" disabled={commitDisabled} onClick={() => submitCommit({ pushAfterCommit: true })}>
                    提交并推送
                  </button>
                </div>
              ) : null}
            </div>
          </form>

          <ScmSection
            title="更改"
            count={worktree.unstagedFiles.length}
            emptyText="没有未暂存改动。"
            actionTitle="暂存所有更改"
            actionIcon={<Plus size={16} />}
            onAction={onStageAll}
            open={changesOpen}
            onToggle={() => setChangesOpen((value) => !value)}
          >
            {worktree.unstagedFiles.map((file) => (
              <ScmFileRow
                file={file}
                selected={file.path === selectedFilePath && selectedFileStaged === false}
                key={`unstaged-${file.path}-${file.status}`}
                primaryActionTitle="暂存更改"
                primaryActionIcon={<Plus size={15} />}
                onPrimaryAction={() => onStageFile(file)}
                onDiscard={() => onDiscardFile(file)}
                onSelect={() => onSelectFile(file)}
                onPin={() => onPinFile(file)}
              />
            ))}
          </ScmSection>

          {worktree.stagedFiles.length > 0 ? (
            <ScmSection
              title="已暂存的更改"
              count={worktree.stagedFiles.length}
              emptyText="没有已暂存改动。"
              actionTitle="取消暂存所有更改"
              actionIcon={<Undo2 size={16} />}
              onAction={onUnstageAll}
              open={stagedOpen}
              onToggle={() => setStagedOpen((value) => !value)}
            >
              {worktree.stagedFiles.map((file) => (
                <ScmFileRow
                  file={file}
                  selected={file.path === selectedFilePath && selectedFileStaged === true}
                  key={`staged-${file.path}-${file.status}`}
                  primaryActionTitle="取消暂存"
                  primaryActionIcon={<Undo2 size={15} />}
                  onPrimaryAction={() => onUnstageFile(file)}
                  onDiscard={() => onDiscardFile(file)}
                  onSelect={() => onSelectFile(file)}
                  onPin={() => onPinFile(file)}
                />
              ))}
            </ScmSection>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function splitCommitMessage(message: string): Pick<CommitInput, "subject" | "body"> {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const subjectIndex = lines.findIndex((line) => line.trim().length > 0);
  if (subjectIndex < 0) {
    return { subject: "" };
  }

  const subject = lines[subjectIndex].trim();
  const body = lines.slice(subjectIndex + 1).join("\n").trim();
  return body ? { subject, body } : { subject };
}

function ScmSection({
  title,
  count,
  emptyText,
  actionTitle,
  actionIcon,
  onAction,
  open,
  onToggle,
  children
}: {
  title: string;
  count: number;
  emptyText: string;
  actionTitle: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="scm-section">
      <div className="scm-section-header" role="button" tabIndex={0} onClick={onToggle} onKeyDown={(event) => event.key === "Enter" && onToggle()}>
        <div>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{title}</span>
          <span className="scm-count">{count}</span>
        </div>
        <button
          type="button"
          className="icon-button compact-icon"
          title={actionTitle}
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          disabled={count === 0}
        >
          {actionIcon}
        </button>
      </div>
      {open ? count === 0 ? <div className="empty-inline scm-empty">{emptyText}</div> : <div className="scm-file-list">{children}</div> : null}
    </section>
  );
}

function ScmFileRow({
  file,
  selected,
  primaryActionTitle,
  primaryActionIcon,
  onPrimaryAction,
  onDiscard,
  onSelect,
  onPin
}: {
  file: ChangedFile;
  selected: boolean;
  primaryActionTitle: string;
  primaryActionIcon: React.ReactNode;
  onPrimaryAction: () => void;
  onDiscard: () => void;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <div
      className={`scm-file-row ${selected ? "active" : ""}`}
      role="button"
      tabIndex={0}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onPin}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onSelect();
        }
      }}
    >
      <span className={`scm-file-icon ${fileIconClass(file.path)}`}>{fileIcon(file.path)}</span>
      <span className="scm-file-main">
        <span className="scm-file-name" title={file.path}>
          {file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path}
        </span>
        <span className="scm-file-dir">{directoryName(file.path)}</span>
      </span>
      <span className="scm-file-trailing">
        <span className="scm-row-actions">
          <button
            type="button"
            className="icon-button compact-icon"
            title={primaryActionTitle}
            onClick={(event) => {
              event.stopPropagation();
              onPrimaryAction();
            }}
          >
            {primaryActionIcon}
          </button>
          <button
            type="button"
            className="icon-button compact-icon danger-icon"
            title="放弃更改"
            onClick={(event) => {
              event.stopPropagation();
              onDiscard();
            }}
          >
            <Undo2 size={15} />
          </button>
        </span>
        <span className={`scm-file-status ${file.status}`}>{statusCode(file.status)}</span>
      </span>
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
  return "default";
}
