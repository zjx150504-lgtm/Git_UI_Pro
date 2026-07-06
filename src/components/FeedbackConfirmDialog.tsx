import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useEffect } from "react";

export type FeedbackConfirmTone = "default" | "warning" | "danger";

export interface FeedbackConfirmOptions {
  title: string;
  description?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: FeedbackConfirmTone;
}

interface FeedbackConfirmDialogProps {
  state: FeedbackConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FeedbackConfirmDialog({ state, onCancel, onConfirm }: FeedbackConfirmDialogProps) {
  const tone = state.tone ?? "default";
  const Icon = tone === "default" ? Info : AlertTriangle;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="branch-dialog-backdrop feedback-confirm-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className={`branch-dialog feedback-confirm-dialog tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={state.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="branch-dialog-header feedback-confirm-header">
          <span className="branch-dialog-title">
            <Icon size={16} />
            {state.title}
          </span>
          <button type="button" className="icon-button compact-icon" title="关闭" onClick={onCancel}>
            <X size={14} />
          </button>
        </header>
        <div className="feedback-confirm-body">
          {state.description ? <p>{state.description}</p> : null}
          {state.detail ? <pre>{state.detail}</pre> : null}
        </div>
        <footer className="branch-dialog-actions feedback-confirm-actions">
          <button type="button" className="text-button" onClick={onCancel}>
            {state.cancelLabel ?? "取消"}
          </button>
          <button type="button" className="primary-action branch-primary-action" onClick={onConfirm}>
            <Check size={14} />
            {state.confirmLabel ?? "确认"}
          </button>
        </footer>
      </section>
    </div>
  );
}
