import { X, Terminal } from "lucide-react";
import type { GitProject } from "../types/domain";

interface ConsolePanelProps {
  project?: GitProject;
  onClose: () => void;
}

export function ConsolePanel({ project, onClose }: ConsolePanelProps) {
  return (
    <section className="console-panel">
      <div className="console-title">
        <Terminal size={16} />
        控制台
        <span>{project?.path ?? "未选择目录"}</span>
        <button type="button" className="icon-button console-close" title="关闭控制台" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="console-body">
        <span className="prompt">PS</span>
        <span className="cwd">{project?.path ?? "~"}</span>
        <span className="cursor">›</span>
        <span className="muted-command">底部终端将在接入 xterm.js 和 node-pty 后执行真实命令</span>
      </div>
    </section>
  );
}
