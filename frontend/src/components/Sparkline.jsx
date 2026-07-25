/**
 * ============================================================
 * File: Sparkline.jsx
 * Module: Shared Components
 *
 * Description:
 * Dependency-free SVG area sparkline for the dashboard's revenue
 * trend. Scales to its container width, draws a soft filled area
 * under the line, and marks the last point.
 * ============================================================
 */

export default function Sparkline({ points = [], height = 56, stroke = "var(--color-teal)", fill = "rgba(15, 111, 99, 0.12)" }) {
  const width = 240; // viewBox units; the SVG itself stretches to 100%.
  const pad = 4;

  if (points.length < 2) {
    return <div className="skeleton" style={{ height }} aria-hidden="true" />;
  }

  const max = Math.max(...points, 1);
  const stepX = (width - pad * 2) / (points.length - 1);
  const scaleY = (value) => height - pad - (value / max) * (height - pad * 2);
  const coords = points.map((value, index) => [pad + index * stepX, scaleY(value)]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${(pad + (points.length - 1) * stepX).toFixed(1)},${height - pad}`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      role="img"
      aria-label="Revenue trend"
    >
      <polygon points={area} fill={fill} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="3" fill={stroke} />
    </svg>
  );
}
