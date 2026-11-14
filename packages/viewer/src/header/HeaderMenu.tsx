import {useRef, useState, type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '../components/ui/popover';

const focusableControls = 'button:not(:disabled),a[href],input,select,[tabindex="0"]';

export function HeaderMenu({label, children}: {label: string; children: ReactNode}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  function restoreCommandFocus() {
    // The unchanged layout toolbar can disable or unmount its focused command.
    queueMicrotask(() => {
      if (document.activeElement === document.body || document.activeElement === panel.current) {
        panel.current?.querySelector<HTMLElement>(focusableControls)?.focus();
      }
    });
  }

  return (
    <div className="map-header-menu" ref={container}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="map-header-menu-trigger">
            {label}
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={panel}
          container={container.current}
          align="end"
          sideOffset={9}
          collisionPadding={12}
          className="w-max max-w-[calc(100vw-24px)]"
          aria-label={`${label} controls`}
          onClick={restoreCommandFocus}
          onBlur={event => {
            if (event.target instanceof HTMLButtonElement && event.target.disabled && !event.relatedTarget) {
              restoreCommandFocus();
            }
          }}
        >
          {children}
        </PopoverContent>
      </Popover>
    </div>
  );
}
