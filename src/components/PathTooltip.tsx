import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PathTooltipProps {
  path?: string;
  className?: string;
  children: ReactNode;
}

interface TooltipPosition {
  left: number;
  top: number;
  maxWidth: number;
}

export function PathTooltip({ path, className, children }: PathTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | undefined>();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const classes = ["path-tooltip-anchor", className].filter(Boolean).join(" ");

  function clearCloseTimer() {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  function updatePosition() {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const maxWidth = Math.min(460, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - maxWidth - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 48));
    setPosition({ left, top, maxWidth });
  }

  function showTooltip() {
    if (!path) {
      return;
    }

    clearCloseTimer();
    updatePosition();
    setVisible(true);
  }

  function scheduleHideTooltip() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, 220);
  }

  function hideTooltip() {
    clearCloseTimer();
    setVisible(false);
  }

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    []
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const syncPosition = () => updatePosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [visible]);

  const portalRoot = typeof document === "undefined" ? null : document.querySelector(".app-shell") ?? document.body;

  return (
    <span ref={anchorRef} className={classes} onMouseEnter={showTooltip} onMouseLeave={scheduleHideTooltip} onFocus={showTooltip} onBlur={scheduleHideTooltip}>
      {children}
      {visible && position && portalRoot
        ? createPortal(
            <span
              className="path-tooltip-popover"
              role="tooltip"
              style={{ left: position.left, top: position.top, maxWidth: position.maxWidth }}
              onMouseEnter={showTooltip}
              onMouseLeave={hideTooltip}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {path}
            </span>,
            portalRoot
          )
        : null}
    </span>
  );
}
