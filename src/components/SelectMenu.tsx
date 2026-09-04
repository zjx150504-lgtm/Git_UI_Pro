import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import "../styles/select-menu.css";

const SELECT_MENU_VIEWPORT_GAP = 8;
const SELECT_MENU_MAX_HEIGHT = 288;
const SELECT_MENU_MIN_HEIGHT = 132;
const SELECT_MENU_MIN_WIDTH = 168;
const SELECT_MENU_TYPEAHEAD_RESET = 700;

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface SelectMenuProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectMenuOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  emptyText?: string;
}

/**
 * Keyboard-accessible replacement for a native `<select>`, following the ARIA
 * select-only combobox pattern: focus stays on the trigger and the active
 * option is tracked with `aria-activedescendant`, so the portalled popup never
 * fights the surrounding dialog focus trap.
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  className = "",
  disabled = false,
  emptyText = "没有可选项"
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ query: "", timer: 0 });
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    const dismiss = () => {
      setOpen(false);
      setActiveIndex(-1);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return;
      }
      dismiss();
    };
    // Re-anchors instead of dismissing, because focusing the trigger can scroll
    // its container and would otherwise close the popup as it opens. Only a
    // trigger scrolled out of view dismisses it.
    const reanchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        dismiss();
        return;
      }
      updateMenuPosition();
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      reanchor();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", reanchor);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", reanchor);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  // Scrolls the popup itself rather than calling `scrollIntoView`, which also
  // scrolls ancestor containers and would trip the dismiss-on-scroll handler.
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || activeIndex < 0 || !menu) {
      return;
    }
    const option = menu.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!option) {
      return;
    }
    const optionBottom = option.offsetTop + option.offsetHeight;
    if (option.offsetTop < menu.scrollTop) {
      menu.scrollTop = option.offsetTop;
    } else if (optionBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = optionBottom - menu.clientHeight;
    }
  }, [activeIndex, open]);

  useEffect(() => () => window.clearTimeout(typeaheadRef.current.timer), []);

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const spaceBelow = window.innerHeight - rect.bottom - SELECT_MENU_VIEWPORT_GAP;
    const spaceAbove = rect.top - SELECT_MENU_VIEWPORT_GAP;
    const openAbove = spaceBelow < SELECT_MENU_MIN_HEIGHT && spaceAbove > spaceBelow;
    const available = openAbove ? spaceAbove : spaceBelow;
    const width = Math.max(rect.width, SELECT_MENU_MIN_WIDTH);
    const left = Math.max(
      SELECT_MENU_VIEWPORT_GAP,
      Math.min(rect.left, window.innerWidth - width - SELECT_MENU_VIEWPORT_GAP)
    );
    const maxHeight = Math.max(SELECT_MENU_MIN_HEIGHT, Math.min(SELECT_MENU_MAX_HEIGHT, available));

    setMenuStyle(openAbove
      ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight }
      : { top: rect.bottom + 4, left, width, maxHeight });
  }

  function openMenu(preferredIndex?: number) {
    if (disabled) {
      return;
    }
    updateMenuPosition();
    const fallback = selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex
      : nextEnabledIndex(options, 0, 1);
    setActiveIndex(preferredIndex ?? fallback);
    setOpen(true);
  }

  function closeMenu(restoreFocus = true) {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  function commitOption(index: number) {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    if (option.value !== value) {
      onChange(option.value);
    }
    closeMenu();
  }

  function moveActiveIndex(step: number) {
    const from = activeIndex < 0 ? selectedIndex : activeIndex;
    const start = Math.min(Math.max(from + step, 0), options.length - 1);
    const next = nextEnabledIndex(options, start, step);
    if (next >= 0) {
      setActiveIndex(next);
    }
  }

  function runTypeahead(character: string) {
    window.clearTimeout(typeaheadRef.current.timer);
    typeaheadRef.current.query += character.toLowerCase();
    typeaheadRef.current.timer = window.setTimeout(() => {
      typeaheadRef.current.query = "";
    }, SELECT_MENU_TYPEAHEAD_RESET);

    const query = typeaheadRef.current.query;
    const origin = activeIndex < 0 ? selectedIndex : activeIndex;
    const offset = query.length > 1 ? 0 : 1;
    const match = findByPrefix(options, query, Math.max(origin, -1) + offset);
    if (match < 0) {
      return;
    }
    if (open) {
      setActiveIndex(match);
    } else {
      commitOption(match);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      if (!open) {
        return;
      }
      // Keep the surrounding dialog from treating this as a request to close.
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (event.key === "Tab") {
      if (open) {
        closeMenu(false);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        commitOption(activeIndex);
      } else {
        openMenu();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveActiveIndex(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!open) {
        return;
      }
      event.preventDefault();
      setActiveIndex(event.key === "Home"
        ? nextEnabledIndex(options, 0, 1)
        : nextEnabledIndex(options, options.length - 1, -1));
      return;
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      runTypeahead(event.key);
    }
  }

  const portalTarget = typeof document === "undefined"
    ? null
    : document.querySelector(".app-shell") ?? document.body;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`select-menu-trigger ${className}`.trim()}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`select-menu-trigger-label ${selectedOption ? "" : "placeholder"}`.trim()}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {selectedOption?.hint ? <span className="select-menu-trigger-hint">{selectedOption.hint}</span> : null}
        <ChevronDown className="select-menu-chevron" size={14} aria-hidden="true" />
      </button>
      {open && menuStyle && portalTarget
        ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            className="floating-menu select-menu-popup"
            style={menuStyle}
            aria-label={ariaLabel}
          >
            {options.length === 0 ? <div className="select-menu-empty">{emptyText}</div> : null}
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${baseId}-option-${index}`}
                type="button"
                role="option"
                data-index={index}
                className={`select-menu-option ${index === activeIndex ? "active" : ""}`.trim()}
                aria-selected={option.value === value}
                aria-disabled={option.disabled ? true : undefined}
                tabIndex={-1}
                // Preserve focus on the trigger so the popup is not dismissed mid-click.
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => !option.disabled && setActiveIndex(index)}
                onClick={() => commitOption(index)}
              >
                <span className="select-menu-option-mark" aria-hidden="true">
                  <Check size={12} />
                </span>
                <span className="select-menu-option-label">{option.label}</span>
                {option.hint ? <span className="select-menu-option-hint">{option.hint}</span> : null}
              </button>
            ))}
          </div>,
          portalTarget
        )
        : null}
    </>
  );
}

function nextEnabledIndex<T extends string>(options: ReadonlyArray<SelectMenuOption<T>>, from: number, step: number): number {
  for (let index = from; index >= 0 && index < options.length; index += step) {
    if (!options[index].disabled) {
      return index;
    }
  }
  return -1;
}

function findByPrefix<T extends string>(options: ReadonlyArray<SelectMenuOption<T>>, query: string, from: number): number {
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (from + offset + options.length) % options.length;
    const option = options[index];
    if (!option.disabled && option.label.toLowerCase().startsWith(query)) {
      return index;
    }
  }
  return -1;
}
