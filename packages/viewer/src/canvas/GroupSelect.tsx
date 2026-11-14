import {useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';

const allGroups = '全部';

function groupLabel(value: string) {
  return value === allGroups ? 'All features' : value;
}

export function GroupSelect({
  groups,
  value,
  onChange
}: {
  groups: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const options = [allGroups, ...groups.filter(group => group !== allGroups)];
  const selectedIndex = Math.max(0, options.indexOf(value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const index = Math.min(activeIndex, options.length - 1);

  useLayoutEffect(() => {
    const menu = list.current;
    const trigger = field.current;
    if (!open || !menu || !trigger) return;
    function placeMenu() {
      if (!menu || !trigger) return;
      const {left, bottom} = trigger.getBoundingClientRect();
      const margin = 8;
      const rightBound = document.documentElement.clientWidth - margin - menu.offsetWidth;
      const alignedLeft = Math.max(margin, Math.min(left, rightBound));
      menu.style.insetInlineStart = `${alignedLeft - left}px`;
      menu.style.maxHeight = `min(18rem, ${Math.max(0, window.innerHeight - bottom - 14)}px)`;
    }
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !trigger?.contains(event.target)) setOpen(false);
    }
    placeMenu();
    window.addEventListener('resize', placeMenu);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('resize', placeMenu);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);

  useLayoutEffect(() => {
    list.current?.children[index]?.scrollIntoView({block: 'nearest'});
  }, [open, index]);

  function openMenu() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function select(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openMenu();
        else setActiveIndex(Math.min(options.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))));
        break;
      case 'Home':
      case 'End':
        if (!open) break;
        event.preventDefault();
        setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) select(options[index]);
        else openMenu();
        break;
      case 'Escape':
        if (!open) break;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  const label = groupLabel(options[selectedIndex]);
  return (
    <div className="atlas-group-select" ref={field}>
      <button
        type="button"
        role="combobox"
        aria-label={`Feature group: ${label}`}
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${index}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKey}
        onBlur={() => setOpen(false)}
      >
        <span title={label}>{label}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul id={id} role="listbox" aria-label="Feature group" hidden={!open} ref={open ? list : null}>
        {options.map((option, optionIndex) => (
          <li
            key={option}
            id={`${id}-${optionIndex}`}
            role="option"
            aria-selected={optionIndex === selectedIndex}
            data-active={optionIndex === index}
            onMouseDown={event => event.preventDefault()}
            onClick={() => select(option)}
          >
            <span>{groupLabel(option)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
