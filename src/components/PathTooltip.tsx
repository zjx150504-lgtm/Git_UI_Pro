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

const TOOLTIP_HORIZONTAL_OFFSET = 36;
const TOOLTIP_SHOW_DELAY_MS = 1000;
const PATH_TOOLTIP_OPEN_EVENT = "git-ui-pro:path-tooltip-open";
let pathTooltipIdSeed = 0;

export function PathTooltip({ path, className, children }: PathTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | undefined>();
  const closeTimerRef = useRef<number | undefined>();
  const tooltipIdRef = useRef(`path-tooltip-${++pathTooltipIdSeed}`);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const classes = ["path-tooltip-anchor", className].filter(Boolean).join(" ");

  function clearCloseTimer() {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  function clearShowTimer() {
    window.clearTimeout(showTimerRef.current);
    showTimerRef.current = undefined;
  }

  function updatePosition() {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const maxWidth = Math.min(460, window.innerWidth - 24);
    const preferredLeft = rect.left + TOOLTIP_HORIZONTAL_OFFSET;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - maxWidth - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 48));
    setPosition({ left, top, maxWidth });
  }

  function showTooltipNow() {
    if (!path) {
      return;
    }

    clearShowTimer();
    clearCloseTimer();
    updatePosition();
    window.dispatchEvent(new CustomEvent(PATH_TOOLTIP_OPEN_EVENT, { detail: { id: tooltipIdRef.current } }));
    setVisible(true);
  }

  function scheduleShowTooltip() {
    if (!path) {
      return;
    }

    clearShowTimer();
    clearCloseTimer();
    showTimerRef.current = window.setTimeout(showTooltipNow, TOOLTIP_SHOW_DELAY_MS);
  }

  function scheduleHideTooltip() {
    clearShowTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, 220);
  }

  function hideTooltip() {
    clearShowTimer();
    clearCloseTimer();
    setVisible(false);
  }

  useEffect(
    () => () => {
      clearShowTimer();
      clearCloseTimer();
    },
    []
  );

  useEffect(() => {
    const onTooltipOpen = (event: Event) => {
      const activeTooltipId = event instanceof CustomEvent ? event.detail?.id : undefined;
      if (activeTooltipId === tooltipIdRef.current) {
        return;
      }

      clearCloseTimer();
      clearShowTimer();
      setVisible(false);
    };

    window.addEventListener(PATH_TOOLTIP_OPEN_EVENT, onTooltipOpen);
    return () => window.removeEventListener(PATH_TOOLTIP_OPEN_EVENT, onTooltipOpen);
  }, []);

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
    <span ref={anchorRef} className={classes} onMouseEnter={scheduleShowTooltip} onMouseLeave={scheduleHideTooltip} onFocus={scheduleShowTooltip} onBlur={scheduleHideTooltip}>
      {children}
      {visible && position && portalRoot
        ? createPortal(
            <span
              className="path-tooltip-popover"
              role="tooltip"
              style={{ left: position.left, top: position.top, maxWidth: position.maxWidth }}
              onMouseEnter={showTooltipNow}
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
