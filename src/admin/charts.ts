import type { AdminDay, ScorePoint } from "../shared/admin";

const W = 320;
const H = 120;
const PAD = { top: 10, right: 8, bottom: 22, left: 28 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.`;
};

/** Bar with 4px rounded top, flat on the baseline. */
const barPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, h, w / 2);
  const base = y + h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
};

const gridLine = (y: number, label: string) =>
  `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" class="grid"/><text x="${PAD.left - 6}" y="${y + 3}" class="axis" text-anchor="end">${label}</text>`;

export const barChart = (days: AdminDay[], key: "guesses" | "hints", unit: string) => {
  const max = Math.max(1, ...days.map((d) => d[key]));
  const slot = plotW / days.length;
  const barW = Math.min(28, slot - 6);
  const bars = days
    .map((d, i) => {
      const h = (d[key] / max) * plotH;
      const x = PAD.left + i * slot + (slot - barW) / 2;
      const y = PAD.top + plotH - h;
      return `<g class="hit"><rect x="${PAD.left + i * slot}" y="${PAD.top}" width="${slot}" height="${plotH}" fill="transparent"/>
        ${d[key] ? `<path d="${barPath(x, y, barW, h)}" class="bar"/>` : ""}
        <text x="${x + barW / 2}" y="${H - 6}" class="axis" text-anchor="middle">${dayLabel(d.day)}</text>
        <title>${dayLabel(d.day)}: ${d[key]} ${unit}</title></g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${unit} za posledních 7 dní">
    ${gridLine(PAD.top, String(max))}${gridLine(PAD.top + plotH, "0")}${bars}</svg>`;
};

const rolling = (values: number[], window: number) =>
  values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

export const ROLLING_WINDOW = 5;

/** Each guess as a dot (x = order of guess), plus rolling mean – rising line = community converging. */
export const scoreChart = (points: ScorePoint[]) => {
  if (points.length === 0) return `<p class="muted">Zatím žádné tipy.</p>`;
  const xOf = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yOf = (score: number) => PAD.top + plotH - (score / 100) * plotH;
  const mean = rolling(points.map((p) => p.score), ROLLING_WINDOW);
  const line = mean.map((m, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(m).toFixed(1)}`).join("");
  const dots = points
    .map(
      (p, i) =>
        `<g class="hit"><circle cx="${xOf(i)}" cy="${yOf(p.score)}" r="10" fill="transparent"/><circle cx="${xOf(i)}" cy="${yOf(p.score)}" r="4" class="dot"/>
         <title>Tip #${i + 1}: ${p.score} b. · ${new Date(p.at * 1000).toLocaleDateString("cs")} · průměr ${Math.round(mean[i])}</title></g>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Skóre jednotlivých tipů v pořadí">
    ${gridLine(yOf(100), "100")}${gridLine(yOf(50), "50")}${gridLine(yOf(0), "0")}
    ${dots}<path d="${line}" class="mean"/>
    <text x="${PAD.left}" y="${H - 6}" class="axis">1. tip</text>
    <text x="${W - PAD.right}" y="${H - 6}" class="axis" text-anchor="end">${points.length}. tip</text>
  </svg>
  <p class="legend"><span class="key dot-key"></span> jednotlivé tipy <span class="key line-key"></span> klouzavý průměr (${ROLLING_WINDOW})</p>`;
};
