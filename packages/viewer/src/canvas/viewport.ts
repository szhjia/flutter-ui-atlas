import {CANVAS_ZOOM} from './constants';
import type {CanvasNode, Size, Viewport} from './types';

export function clampZoom(zoom: number) {
  return Math.max(CANVAS_ZOOM.min, Math.min(CANVAS_ZOOM.max, zoom));
}

export function contentBounds(nodes: CanvasNode[]) {
  if (!nodes.length) return {x: 0, y: 0, width: 224, height: 528};
  const x = Math.min(...nodes.map(n => n.x));
  const y = Math.min(...nodes.map(n => n.y));
  return {
    x,
    y,
    width: Math.max(...nodes.map(n => n.x + n.width)) - x,
    height: Math.max(...nodes.map(n => n.y + n.height)) - y
  };
}

export function panExtent(nodes: CanvasNode[]): [[number, number], [number, number]] {
  const b = contentBounds(nodes);
  return [
    [b.x - 480, b.y - 480],
    [b.x + b.width + 480, b.y + b.height + 480]
  ];
}

export function constrainViewport(view: Viewport, size: Size, extent: [[number, number], [number, number]]): Viewport {
  const zoom = clampZoom(view.zoom);
  const axis = (value: number, pixels: number, min: number, max: number) => {
    const low = pixels - max * zoom,
      high = -min * zoom;
    return low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));
  };
  return {
    x: axis(view.x, size.width, extent[0][0], extent[1][0]),
    y: axis(view.y, size.height, extent[0][1], extent[1][1]),
    zoom
  };
}

export function fitViewport(nodes: CanvasNode[], size: Size): Viewport {
  const b = contentBounds(nodes);
  const zoom = clampZoom(
    Math.min(CANVAS_ZOOM.base, Math.max(1, size.width - 80) / b.width, Math.max(1, size.height - 176) / b.height)
  );
  return {
    x: size.width / 2 - (b.x + b.width / 2) * zoom,
    y: (size.height - 16) / 2 - (b.y + b.height / 2) * zoom,
    zoom
  };
}
