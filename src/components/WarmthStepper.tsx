/**
 * Compact 1–5 warmth selector. Used in Settings > Bedding and
 * Settings > Clothing to tag each item with a warmth rating that the
 * Thermal Fit insights page sums into a per-night warmth score.
 *
 * value = null means "not set" — all buttons render unselected so the
 * user is prompted to set a value. Clicking any number writes it.
 */
export function WarmthStepper({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (warmth: number) => void;
}) {
  return (
    <div
      className="flex gap-4"
      role="radiogroup"
      aria-label="Warmth 1 (light) to 5 (heavy)"
      title="Warmth 1 (light) to 5 (heavy)"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              minWidth: 28,
              padding: '4px 8px',
              opacity: value === null ? 0.6 : 1,
            }}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
