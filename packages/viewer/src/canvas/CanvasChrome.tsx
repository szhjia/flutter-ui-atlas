import {useId, useRef, useState, type ReactNode} from 'react';
import {Info, Minus, Plus, ScanSearch} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Checkbox} from '../components/ui/checkbox';
import {Separator} from '../components/ui/separator';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '../components/ui/select';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '../components/ui/tooltip';
import {CANVAS_ZOOM} from './constants';
import type {ArrangementMode} from './arrange';

function Tool({
  label,
  children,
  onClick,
  disabled
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CanvasChrome({
  layoutTools,
  mode,
  onModeChange,
  zoom,
  onZoom,
  onFit,
  showEdges,
  onShowEdges,
  unroutable
}: {
  layoutTools: ReactNode;
  mode: ArrangementMode;
  onModeChange: (mode: ArrangementMode) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  showEdges: boolean;
  onShowEdges: (show: boolean) => void;
  unroutable: number;
}) {
  const checkId = useId();
  const bar = useRef<HTMLDivElement>(null);
  const [commandsKey, setCommandsKey] = useState(0);
  const restoreCommandFocus = () =>
    queueMicrotask(() => {
      if (document.activeElement === document.body)
        bar.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    });
  return (
    <TooltipProvider delayDuration={350}>
      <div
        className="canvas-layout-bar canvas-surface"
        role="toolbar"
        aria-label="Layout controls"
        data-atlas-canvas-controls
        ref={bar}
        onClick={restoreCommandFocus}
        onBlur={event => {
          if (event.target instanceof HTMLButtonElement && event.target.disabled && !event.relatedTarget)
            restoreCommandFocus();
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && bar.current?.querySelector('[role="dialog"]')) {
            event.preventDefault();
            event.stopPropagation();
            setCommandsKey(value => value + 1);
            restoreCommandFocus();
          }
        }}
      >
        <div key={commandsKey}>{layoutTools}</div>
        <Separator orientation="vertical" />
        <Select value={mode} onValueChange={value => onModeChange(value as ArrangementMode)}>
          <SelectTrigger aria-label="Auto layout preset" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" data-atlas-canvas-controls>
            <SelectGroup>
              <SelectItem value="balanced">Balanced layout</SelectItem>
              <SelectItem value="horizontal">Horizontal flow</SelectItem>
              <SelectItem value="vertical">Vertical flow</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div
        className="canvas-zoom canvas-surface"
        role="toolbar"
        aria-label="Canvas controls"
        data-atlas-canvas-controls
      >
        <Tool label="Zoom out" onClick={() => onZoom(zoom / 1.2)} disabled={zoom <= CANVAS_ZOOM.min + 0.001}>
          <Minus aria-hidden="true" />
        </Tool>
        <Button
          variant="ghost"
          className="min-w-14 tabular-nums"
          aria-label="Reset zoom to 100%"
          onClick={() => onZoom(CANVAS_ZOOM.base)}
        >
          {Math.round((zoom / CANVAS_ZOOM.base) * 100)}%
        </Button>
        <Tool label="Zoom in" onClick={() => onZoom(zoom * 1.2)} disabled={zoom >= CANVAS_ZOOM.max - 0.001}>
          <Plus aria-hidden="true" />
        </Tool>
        <Separator orientation="vertical" />
        <Tool label="Fit view" onClick={onFit}>
          <ScanSearch aria-hidden="true" />
        </Tool>
      </div>
      <div
        className="map-legend canvas-surface"
        role="toolbar"
        aria-label="Connection legend"
        data-atlas-canvas-controls
      >
        {unroutable > 0 && (
          <span className="canvas-routing-warning" role="status">
            {unroutable} unrouted
          </span>
        )}
        <span className="canvas-key">
          <i />
          Verified by interaction
        </span>
        <span className="canvas-key">
          <i className="declared" />
          Declared, unverified
        </span>
        <Separator orientation="vertical" />
        <label htmlFor={checkId}>
          <Checkbox id={checkId} checked={showEdges} onCheckedChange={value => onShowEdges(value === true)} />
          Show connections
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Canvas help">
              <Info aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {unroutable
              ? `${unroutable} transitions need more space; select a screen to see the list.`
              : 'Drag screens to move them. Pan within the map; scroll to zoom.'}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
