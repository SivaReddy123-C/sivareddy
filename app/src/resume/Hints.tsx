/** Free offline writing hints - shown under a field, never blocking. */
export function Hints({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;
  return (
    <ul className="hints">
      {hints.map((h, i) => <li key={i}>{h}</li>)}
    </ul>
  );
}
