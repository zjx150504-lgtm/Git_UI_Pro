import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import type { ChangedFile, CommitInput, GitProject, WorktreeState } from "../types/domain";
import { absoluteFilePath } from "../utils/filePath";

interface WorkspaceViewProps {
  project?: GitProject;
  worktree: WorktreeState;
  onStageFile: (file: ChangedFile) => void;
  onStageAll: () => void;
  onUnstageFile: (file: ChangedFile) => void;
  onUnstageAll: () => void;
  onDiscardFile: (file: ChangedFile) => void;
  onDiscardAll: () => void;
  onSelectFile: (file: ChangedFile) => void;
  onPinFile: (file: ChangedFile) => void;
  selectedFilePath?: string;
  selectedFileStaged?: boolean;
  onCommit: (input: CommitInput) => Promise<boolean>;
  onSyncChanges: () => Promise<void>;
  focusRequest: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const COMMIT_MESSAGE_MIN_HEIGHT = 34;
const COMMIT_MESSAGE_MAX_HEIGHT = 260;

export function WorkspaceView({
  project,
  worktree,
  onStageFile,
  onStageAll,
  onUnstageFile,
  onUnstageAll,
  onDiscardFile,
  onDiscardAll,
  onSelectFile,
  onPinFile,
  selectedFilePath,
  selectedFileStaged,
  onCommit,
  onSyncChanges,
  focusRequest,
  panelOpen,
  onTogglePanel
}: WorkspaceViewProps) {
  const [message, setMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [commitMenuPosition, setCommitMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [changesOpen, setChangesOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const commitActionsRef = useRef<HTMLDivElement>(null);
  const commitMenuButtonRef = useRef<HTMLButtonElement>(null);
  const commitMenuRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const stagedCount = worktree.stagedFiles.length;
  const unstagedCount = worktree.unstagedFiles.length;
  const changeCount = unstagedCount + stagedCount;
  const willAutoStage = stagedCount === 0 && unstagedCount > 0;
  const outgoingCount = project?.status?.ahead ?? 0;
  const canSyncOutgoing = changeCount === 0 && outgoingCount > 0;
  const commitDisabled = changeCount === 0 && !canSyncOutgoing;
  const commitTitle = canSyncOutgoing
    ? `同步 ${outgoingCount} 个本地提交到远程。`
    : willAutoStage
      ? `${unstagedCount} 个文件未暂存，提交时会自动暂存并提交。`
      : "提交已暂存的更改";
  const primaryActionLabel = canSyncOutgoing ? `同步更改 ${outgoingCount} 个` : "提交";

  useEffect(() => {
    if (focusRequest > 0) {
      messageInputRef.current?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    const input = messageInputRef.current;
    if (!input) {
      return;
    }

    input.style.height = `${COMMIT_MESSAGE_MIN_HEIGHT}px`;
    const nextHeight = Math.min(COMMIT_MESSAGE_MAX_HEIGHT, Math.max(COMMIT_MESSAGE_MIN_HEIGHT, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > COMMIT_MESSAGE_MAX_HEIGHT ? "auto" : "hidden";
  }, [message, panelOpen]);

  useEffect(() => {
    if (!commitMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!commitActionsRef.current?.contains(target) && !commitMenuRef.current?.contains(target)) {
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

  function toggleCommitMenu() {
    const rect = commitMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setCommitMenuPosition({
        top: rect.bottom + 4,
        left: rect.left - 1
      });
    }
    setCommitMenuOpen((value) => !value);
  }

  async function submitCommit(options: Partial<CommitInput> & { syncAfterCommit?: boolean } = {}) {
    if (commitBusy) {
      return;
    }

    const { syncAfterCommit, ...commitOptions } = options;

    if (canSyncOutgoing && !commitOptions.amend && !commitOptions.pushAfterCommit && !syncAfterCommit) {
      setCommitBusy(true);
      try {
        await onSyncChanges();
        setCommitMenuOpen(false);
      } finally {
        setCommitBusy(false);
      }
      return;
    }

    const commitMessage = splitCommitMessage(message);
    setCommitBusy(true);
    try {
      const committed = await onCommit({
        ...commitMessage,
        ...commitOptions
      });
      if (committed) {
        setMessage("");
        if (syncAfterCommit) {
          await onSyncChanges();
        }
      }
      setCommitMenuOpen(false);
    } finally {
      setCommitBusy(false);
    }
  }

  return (
    <section className={`scm-view ${panelOpen ? "" : "panel-collapsed"}`}>
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
              void submitCommit();
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
              rows={1}
            />
            <div className="scm-commit-control" ref={commitActionsRef}>
              <div className={`scm-commit-actions ${canSyncOutgoing ? "sync-mode" : ""}`}>
                <button type="submit" className="scm-commit-button" title={commitTitle} disabled={commitDisabled || commitBusy}>
                  {canSyncOutgoing ? <RefreshCw size={17} /> : <Check size={17} />}
                  {primaryActionLabel}
                </button>
                {!canSyncOutgoing ? (
                  <button type="button" className="scm-commit-menu" title="提交选项" onClick={toggleCommitMenu} ref={commitMenuButtonRef}>
                    <ChevronDown size={17} />
                  </button>
                ) : null}
              </div>
              {!canSyncOutgoing && commitMenuOpen && commitMenuPosition && typeof document !== "undefined"
                ? createPortal(
                    <div className="floating-menu commit-menu commit-menu-portal" style={commitMenuPosition} ref={commitMenuRef}>
                      <button type="button" title={commitTitle} disabled={commitDisabled || commitBusy} onClick={() => void submitCommit()}>
                        提交
                      </button>
                      <button type="button" disabled={commitBusy} onClick={() => void submitCommit({ amend: true })}>
                        提交(修改)
                      </button>
                      <button type="button" title={commitTitle} disabled={commitDisabled || commitBusy} onClick={() => void submitCommit({ pushAfterCommit: true })}>
                        提交和推送
                      </button>
                      <button type="button" title={commitTitle} disabled={commitDisabled || commitBusy} onClick={() => void submitCommit({ syncAfterCommit: true })}>
                        提交和同步
                      </button>
                    </div>,
                    document.querySelector(".app-shell") ?? document.body
                  )
                : null}
            </div>
          </form>

          {worktree.stagedFiles.length > 0 ? (
            <ScmSection
              title="暂存的更改"
              count={worktree.stagedFiles.length}
              emptyText="没有已暂存改动。"
              actions={[
                {
                  title: "取消暂存所有更改",
                  icon: <Undo2 size={16} />,
                  onAction: onUnstageAll
                }
              ]}
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
                  onSelect={() => onSelectFile(file)}
                  onPin={() => onPinFile(file)}
                  repositoryPath={project?.path}
                />
              ))}
            </ScmSection>
          ) : null}

          {worktree.unstagedFiles.length > 0 ? (
            <ScmSection
              title="更改"
              count={worktree.unstagedFiles.length}
              emptyText="没有未暂存改动。"
              actions={[
                {
                  title: "取消所有更改",
                  icon: <Trash2 size={15} />,
                  onAction: onDiscardAll,
                  danger: true
                },
                {
                  title: "暂存所有更改",
                  icon: <Plus size={16} />,
                  onAction: onStageAll
                }
              ]}
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
                  repositoryPath={project?.path}
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
  actions,
  open,
  onToggle,
  children
}: {
  title: string;
  count: number;
  emptyText: string;
  actions: Array<{ title: string; icon: React.ReactNode; onAction: () => void; danger?: boolean; disabled?: boolean }>;
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
        <div className="scm-section-actions">
          {actions.map((action) => (
            <button
              type="button"
              className={`icon-button compact-icon ${action.danger ? "danger-icon" : ""}`}
              title={action.title}
              key={action.title}
              onClick={(event) => {
                event.stopPropagation();
                action.onAction();
              }}
              disabled={count === 0 || action.disabled}
            >
              {action.icon}
            </button>
          ))}
        </div>
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
  onPin,
  repositoryPath
}: {
  file: ChangedFile;
  selected: boolean;
  primaryActionTitle: string;
  primaryActionIcon: React.ReactNode;
  onPrimaryAction: () => void;
  onDiscard?: () => void;
  onSelect: () => void;
  onPin: () => void;
  repositoryPath?: string;
}) {
  const clickTimerRef = useRef<number | undefined>();

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
    <div
      className={`scm-file-row ${selected ? "active" : ""}`}
      role="button"
      tabIndex={0}
      title={absoluteFilePath(repositoryPath, file.path)}
      onClick={scheduleSelect}
      onDoubleClick={(event) => {
        event.preventDefault();
        pinImmediately();
      }}
      onKeyDown={(event) => {
        if (event.ctrlKey && event.key === "Enter") {
          pinImmediately();
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          onSelect();
        }
      }}
    >
      <span className={`scm-file-icon ${fileIconClass(file.path)}`}>{fileIcon(file.path)}</span>
      <span className="scm-file-main">
        <span className="scm-file-name">
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
          {onDiscard ? (
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
          ) : null}
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
