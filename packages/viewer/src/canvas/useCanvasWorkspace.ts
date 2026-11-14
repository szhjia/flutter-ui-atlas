import {useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';

export function useCanvasWorkspace(live: boolean) {
  const main = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const [size, setSize] = useState({width: 900, height: 800});
  const [mainWidth, setMainWidth] = useState(1280);
  const [width, setWidth] = useState<number | null>(null);
  const drag = useRef<{x: number; width: number} | null>(null);
  const maxWidth = Math.max(320, Math.min(720, mainWidth - 520));
  const inspectorWidth = Math.max(320, Math.min(maxWidth, width ?? (live ? 440 : 354)));
  const setInspectorWidth = (next: number) => setWidth(Math.max(320, Math.min(maxWidth, next)));

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (main.current) setMainWidth(main.current.clientWidth);
      if (stage.current) setSize({width: stage.current.clientWidth, height: stage.current.clientHeight});
    });
    if (main.current) observer.observe(main.current);
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  return {
    main,
    stage,
    size,
    inspectorWidth,
    maxWidth,
    resizeProps: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        drag.current = {x: event.clientX, width: inspectorWidth};
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (drag.current) setInspectorWidth(drag.current.width + drag.current.x - event.clientX);
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onLostPointerCapture() {
        drag.current = null;
      },
      onDoubleClick() {
        setWidth(null);
      },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        setInspectorWidth(
          event.key === 'Home'
            ? 320
            : event.key === 'End'
              ? maxWidth
              : inspectorWidth + (event.key === 'ArrowLeft' ? 20 : -20)
        );
      }
    }
  };
}
