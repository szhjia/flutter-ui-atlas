import {useState} from 'react';
export function CanvasToolbar({
  canUndo,
  canRedo,
  undo,
  redo,
  arrange,
  count,
  locked,
  onLock
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  arrange: () => void;
  count: number;
  locked?: boolean;
  onLock?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="atlas-layout-tools">
      <button disabled={!canUndo} onClick={undo} title="⌘ / Ctrl Z">
        撤销
      </button>
      <button disabled={!canRedo} onClick={redo} title="⌘ / Ctrl Shift Z">
        重做
      </button>
      {onLock && <button onClick={onLock}>{locked ? '解锁页面' : '锁定页面'}</button>}
      <button disabled={!count} onClick={() => setConfirm(true)}>
        整理可见页面
      </button>
      {confirm && (
        <div className="atlas-arrange-confirm" role="dialog" aria-label="整理布局确认">
          <strong>整理 {count} 个可见、未锁定页面？</strong>
          <span>隐藏和锁定页面保持原位，可撤销。</span>
          <button
            onClick={() => {
              arrange();
              setConfirm(false);
            }}
          >
            确认整理
          </button>
          <button onClick={() => setConfirm(false)}>取消</button>
        </div>
      )}
    </div>
  );
}
