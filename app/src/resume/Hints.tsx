/**
 * Writing hints. Deliberately quiet:
 *  - only the field you're editing shows a hint (no wall of warnings)
 *  - only the single most useful hint, never a list
 *  - dismissing, or accepting an AI suggestion, settles that text for good -
 *    the tool must not re-nag about a decision the user already made
 */
export function Hints({ hints, show, onDismiss }: {
  hints: string[];
  show: boolean;
  onDismiss?: () => void;
}) {
  if (!show || hints.length === 0) return null;
  return (
    <div className="hint-line">
      <span>{hints[0]}</span>
      {onDismiss && (
        <button className="hint-dismiss" onClick={onDismiss} title="Dismiss this hint">×</button>
      )}
    </div>
  );
}
