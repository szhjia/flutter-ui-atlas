import {memo, useMemo} from 'react';
import {EdgeLabelRenderer, useViewport} from '@xyflow/react';
import {placeLabels} from './place-labels';
import type {CanvasNode, RoutedEdge} from './types';
import type {MapEdge} from '../model';
export function EdgeLabels({
  routes,
  nodes,
  edges,
  focusedIds,
  onChoose
}: {
  routes: RoutedEdge[];
  nodes: CanvasNode[];
  edges: MapEdge[];
  focusedIds: Set<string>;
  onChoose: (id: string) => void;
}) {
  const {zoom} = useViewport();
  const specs = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    return edges.map(e => {
      const text = ctx?.measureText(e.action).width ?? e.action.length * 12;
      const width = Math.min(160, Math.max(56, text + 20)),
        height = text > 140 ? 44 : 28;
      return {id: e.id, size: {width: width / zoom, height: height / zoom}, priority: e.status === 'observed' ? 1 : 0};
    });
  }, [edges, zoom]);
  const labels = placeLabels(routes, nodes, specs, zoom, focusedIds);
  return (
    <EdgeLabelRenderer>
      {labels
        .filter(l => l.mode !== 'hidden')
        .map(l => {
          const edge = edges.find(e => e.id === l.id)!,
            size = specs.find(s => s.id === l.id)!.size;
          return (
            <Label
              key={l.id}
              id={l.id}
              action={edge.action}
              focused={focusedIds.has(l.id)}
              mode={l.mode}
              width={size.width * zoom}
              height={size.height * zoom}
              x={l.center.x}
              y={l.center.y}
              zoom={zoom}
              onChoose={onChoose}
            />
          );
        })}
    </EdgeLabelRenderer>
  );
}

const Label = memo(function Label({
  id,
  action,
  focused,
  mode,
  width,
  height,
  x,
  y,
  zoom,
  onChoose
}: {
  id: string;
  action: string;
  focused: boolean;
  mode: string;
  width: number;
  height: number;
  x: number;
  y: number;
  zoom: number;
  onChoose: (id: string) => void;
}) {
  return (
    <button
      data-edge-label={id}
      className={`atlas-edge-label nodrag nopan ${focused ? 'is-focused' : ''}`}
      title={action}
      aria-label={`Transition: ${action}`}
      style={{
        width: mode === 'count' ? 26 : width,
        height: mode === 'count' ? 26 : height,
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${1 / zoom})`
      }}
      onClick={() => onChoose(id)}
    >
      <span>{mode === 'count' ? '⋯' : action}</span>
    </button>
  );
});
