import { AlertCircle, Check, FileKey2, FolderOpen, LoaderCircle, Server, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { GitProject, RemoteProjectInput, RemoteProjectTestResult } from "../types/domain";

interface RemoteProjectDialogProps {
  onClose: () => void;
  onChooseIdentityFile: () => Promise<string | null>;
  onTest: (input: RemoteProjectInput) => Promise<RemoteProjectTestResult>;
  onAdd: (input: RemoteProjectInput) => Promise<GitProject>;
}

type FieldName = "host" | "username" | "port" | "repositoryPath" | "identityFile";
type FormState = Record<FieldName, string>;
type ConnectionFeedback = { tone: "success" | "error"; message: string; detail?: string };

const initialForm: FormState = {
  host: "",
  username: "",
  port: "",
  repositoryPath: "",
  identityFile: ""
};

export function RemoteProjectDialog({ onClose, onChooseIdentityFile, onTest, onAdd }: RemoteProjectDialogProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);
  const [busyAction, setBusyAction] = useState<"test" | "add" | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busy = busyAction !== null;
  const errors = useMemo(() => validateForm(form), [form]);

  useEffect(() => {
    if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    hostInputRef.current?.focus();
    return () => {
      window.requestAnimationFrame(() => {
        if (!dialogRef.current?.isConnected) {
          previousFocusRef.current?.focus();
        }
      });
    };
  }, []);

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [busy, onClose]);

  function updateField(field: FieldName, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  }

  function markTouched(field: FieldName) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function markAllTouched() {
    setTouched({ host: true, username: true, port: true, repositoryPath: true, identityFile: true });
  }

  function buildInput(): RemoteProjectInput {
    return {
      host: form.host.trim(),
      username: form.username.trim() || undefined,
      port: form.port.trim() ? Number(form.port) : undefined,
      repositoryPath: form.repositoryPath.trim().replace(/\\/g, "/"),
      identityFile: form.identityFile.trim() || undefined
    };
  }

  async function testConnection() {
    markAllTouched();
    if (Object.keys(errors).length > 0) {
      setFeedback({ tone: "error", message: "请先修正连接信息。" });
      return;
    }

    setBusyAction("test");
    setFeedback(null);
    try {
      const result = await onTest(buildInput());
      if (result.ok) {
        setFeedback({ tone: "success", message: "连接成功", detail: result.repositoryRoot });
      } else {
        setFeedback({ tone: "error", message: result.messageZh ?? "连接失败", detail: result.stderr.trim() || undefined });
      }
    } catch (error) {
      setFeedback(errorFeedback(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    markAllTouched();
    if (Object.keys(errors).length > 0) {
      setFeedback({ tone: "error", message: "请先修正连接信息。" });
      return;
    }

    setBusyAction("add");
    setFeedback(null);
    try {
      await onAdd(buildInput());
    } catch (error) {
      setFeedback(errorFeedback(error));
      setBusyAction(null);
    }
  }

  async function chooseIdentityFile() {
    const filePath = await onChooseIdentityFile();
    if (filePath) {
      updateField("identityFile", filePath);
      markTouched("identityFile");
    }
  }

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="branch-dialog-backdrop remote-project-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <section
        ref={dialogRef}
        className="branch-dialog remote-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-project-title"
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="branch-dialog-header">
          <span className="branch-dialog-title" id="remote-project-title">
            <Server size={15} />
            连接远程仓库
          </span>
          <button type="button" className="icon-button compact-icon" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={14} />
          </button>
        </header>

        <form className="remote-project-form" onSubmit={submit} noValidate>
          <div className="remote-project-fields">
            <Field label="SSH 主机" error={touched.host ? errors.host : undefined} className="remote-host-field">
              <input
                ref={hostInputRef}
                value={form.host}
                onChange={(event) => updateField("host", event.target.value)}
                onBlur={() => markTouched("host")}
                placeholder="server.example.com 或 SSH 别名"
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <Field label="用户名" error={touched.username ? errors.username : undefined}>
              <input
                value={form.username}
                onChange={(event) => updateField("username", event.target.value)}
                onBlur={() => markTouched("username")}
                placeholder="使用 SSH 配置"
                autoComplete="username"
                disabled={busy}
              />
            </Field>
            <Field label="端口" error={touched.port ? errors.port : undefined}>
              <input
                value={form.port}
                onChange={(event) => updateField("port", event.target.value.replace(/\D/g, ""))}
                onBlur={() => markTouched("port")}
                placeholder="22"
                inputMode="numeric"
                disabled={busy}
              />
            </Field>
            <Field label="仓库绝对路径" error={touched.repositoryPath ? errors.repositoryPath : undefined} className="remote-path-field">
              <input
                value={form.repositoryPath}
                onChange={(event) => updateField("repositoryPath", event.target.value)}
                onBlur={() => markTouched("repositoryPath")}
                placeholder="/srv/projects/my-repository"
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <Field label="私钥文件（可选）" error={touched.identityFile ? errors.identityFile : undefined} className="remote-key-field">
              <div className="remote-key-input">
                <FileKey2 size={14} aria-hidden="true" />
                <input
                  value={form.identityFile}
                  onChange={(event) => updateField("identityFile", event.target.value)}
                  onBlur={() => markTouched("identityFile")}
                  placeholder="使用 SSH Agent 或默认私钥"
                  autoComplete="off"
                  disabled={busy}
                />
                <button type="button" className="icon-button compact-icon" aria-label="选择私钥文件" onClick={() => void chooseIdentityFile()} disabled={busy}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </Field>
          </div>

          <div className="remote-auth-summary">
            <span>认证</span>
            <strong>SSH Agent / 私钥</strong>
            <small>不保存密码</small>
          </div>

          {feedback ? (
            <div className={`remote-connection-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
              {feedback.tone === "success" ? <Check size={15} /> : <AlertCircle size={15} />}
              <span>
                <strong>{feedback.message}</strong>
                {feedback.detail ? <small>{feedback.detail}</small> : null}
              </span>
            </div>
          ) : null}

          <div className="branch-dialog-actions remote-project-actions">
            <button type="button" className="text-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className="text-button remote-test-button" onClick={() => void testConnection()} disabled={busy}>
              {busyAction === "test" ? <LoaderCircle className="spin" size={14} /> : <Server size={14} />}
              测试连接
            </button>
            <button type="submit" className="primary-action remote-connect-button" disabled={busy}>
              {busyAction === "add" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
              连接并添加
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, error, className = "", children }: { label: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`remote-project-field ${error ? "invalid" : ""} ${className}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="remote-field-error">{error}</small> : null}
    </label>
  );
}

function validateForm(form: FormState): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  const host = form.host.trim();
  const username = form.username.trim();
  const port = form.port.trim();
  const repositoryPath = form.repositoryPath.trim().replace(/\\/g, "/");
  if (!host) {
    errors.host = "请输入 SSH 主机。";
  } else if (!/^[a-z0-9._:-]+$/i.test(host) || host.startsWith("-")) {
    errors.host = "主机名或 SSH 别名格式不正确。";
  }
  if (username && !/^[a-z0-9._-]+$/i.test(username)) {
    errors.username = "用户名格式不正确。";
  }
  if (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
    errors.port = "端口应为 1 到 65535。";
  }
  if (!repositoryPath) {
    errors.repositoryPath = "请输入远程仓库路径。";
  } else if (!repositoryPath.startsWith("/")) {
    errors.repositoryPath = "请输入服务器上的绝对路径。";
  }
  return errors;
}

function errorFeedback(error: unknown): ConnectionFeedback {
  const raw = error instanceof Error ? error.message : "连接失败。";
  const clean = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim();
  const [message, ...details] = clean.split(/\r?\n/).filter(Boolean);
  return { tone: "error", message: message || "连接失败。", detail: details.join("\n") || undefined };
}
