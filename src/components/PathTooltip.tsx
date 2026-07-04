import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PathTooltipProps {
  path?: string;
  content?: string;
  className?: string;
  placement?: "path" | "control";
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

export function PathTooltip({ path, content, className, placement, children }: PathTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | undefined>();
  const closeTimerRef = useRef<number | undefined>();
  const tooltipIdRef = useRef(`path-tooltip-${++pathTooltipIdSeed}`);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const classes = ["path-tooltip-anchor", className].filter(Boolean).join(" ");
  const tooltipContent = content ?? path;
  const resolvedPlacement = placement ?? (content ? "control" : "path");

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
    const popover = popoverRef.current;
    const measuredWidth = popover?.offsetWidth ?? estimateTooltipWidth(tooltipContent ?? "", maxWidth);
    const measuredHeight = popover?.offsetHeight ?? 32;
    const preferredLeft =
      resolvedPlacement === "control" ? rect.left + rect.width / 2 - measuredWidth / 2 : rect.left + TOOLTIP_HORIZONTAL_OFFSET;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - measuredWidth - 12));
    const preferredTop = rect.bottom + 8;
    const top =
      resolvedPlacement === "control" && preferredTop + measuredHeight > window.innerHeight - 12
        ? Math.max(12, rect.top - measuredHeight - 8)
        : Math.max(12, Math.min(preferredTop, window.innerHeight - measuredHeight - 12));
    setPosition({ left, top, maxWidth });
  }

  function showTooltipNow() {
    if (!tooltipContent) {
      return;
    }

    clearShowTimer();
    clearCloseTimer();
    window.dispatchEvent(new CustomEvent(PATH_TOOLTIP_OPEN_EVENT, { detail: { id: tooltipIdRef.current } }));
    updatePosition();
    setVisible(true);
  }

  function scheduleShowTooltip() {
    if (!tooltipContent) {
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

  useLayoutEffect(() => {
    if (visible) {
      updatePosition();
    }
  }, [visible, tooltipContent, resolvedPlacement]);

  const portalRoot = typeof document === "undefined" ? null : document.querySelector(".app-shell") ?? document.body;

  return (
    <span ref={anchorRef} className={classes} onMouseEnter={scheduleShowTooltip} onMouseLeave={scheduleHideTooltip} onFocus={scheduleShowTooltip} onBlur={scheduleHideTooltip}>
      {children}
      {visible && position && portalRoot
        ? createPortal(
            <span
              ref={popoverRef}
              className="path-tooltip-popover"
              role="tooltip"
              style={{ left: position.left, top: position.top, maxWidth: position.maxWidth }}
              onMouseEnter={showTooltipNow}
              onMouseLeave={hideTooltip}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {tooltipContent}
            </span>,
            portalRoot
          )
        : null}
    </span>
  );
}

function estimateTooltipWidth(content: string, maxWidth: number): number {
  const asciiCount = Array.from(content).filter((char) => char.charCodeAt(0) < 128).length;
  const wideCount = content.length - asciiCount;
  return Math.min(maxWidth, Math.max(56, asciiCount * 6.5 + wideCount * 12 + 20));
}
