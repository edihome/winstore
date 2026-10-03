export default function FinanceSummary({ tiles }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat-tile p-4" style={{ "--tile-accent": "var(--color-teal)", "--tile-soft": "var(--color-teal-soft)", "--tile-glow": "rgba(15, 111, 99, 0.3)" }}>
          <p className="field-label mb-2">{tile.label}</p>
          <p className="stat-tile-value font-display text-2xl font-semibold">{tile.value}</p>
        </div>
      ))}
    </div>
  );
}
