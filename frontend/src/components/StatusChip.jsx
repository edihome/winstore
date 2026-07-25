/**
 * ============================================================
 * File: StatusChip.jsx
 * Module: Shared Components
 *
 * Description:
 * Status pill with a leading glyph so state is never conveyed by
 * color alone (color-blind users see the shape, screen readers read
 * the text). Tones map to the app's semantic colors: success=settled,
 * warning=needs attention, danger=stopped, info=in progress,
 * neutral=inert.
 * ============================================================
 */

const TONES = {
  success: { className: "bg-signal-soft text-signal", glyph: "✓" },
  warning: { className: "bg-amber-soft text-amber-dark", glyph: "!" },
  danger: { className: "bg-clay-soft text-clay", glyph: "✕" },
  info: { className: "bg-sky-soft text-sky", glyph: "●" },
  neutral: { className: "bg-paper text-ink-soft", glyph: "○" },
};

export default function StatusChip({ tone = "neutral", children }) {
  const { className, glyph } = TONES[tone] || TONES.neutral;
  return (
    <span className={`status-chip ${className}`}>
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}
