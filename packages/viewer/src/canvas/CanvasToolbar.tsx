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
        Undo
      </button>
      <button disabled={!canRedo} onClick={redo} title="⌘ / Ctrl Shift Z">
        Redo
      </button>
      {onLock && <button onClick={onLock}>{locked ? 'Unlock screen' : 'Lock screen'}</button>}
      <button disabled={!count} onClick={() => setConfirm(true)}>
        Arrange visible screens
      </button>
      {confirm && (
        <div className="atlas-arrange-confirm" role="dialog" aria-label="Confirm layout arrangement">
          <strong>Arrange {count} visible, unlocked screens?</strong>
          <span>Hidden and locked screens stay in place. You can undo this.</span>
          <button
            onClick={() => {
              arrange();
              setConfirm(false);
            }}
          >
            Arrange screens
          </button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
