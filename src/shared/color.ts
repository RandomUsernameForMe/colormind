export type Rgb = [number, number, number];
export type Lab = [number, number, number];
export type Oklch = { l: number; c: number; h: number };

const HEX_RE = /^#[0-9a-f]{6}$/;

export const isHex = (s: unknown): s is string => typeof s === "string" && HEX_RE.test(s);

export const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;

export const rgbToHex = (rgb: Rgb): string =>
  "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

// OKLab → linear sRGB, matrices by Björn Ottosson
const oklchToLinear = ({ l, c, h }: Oklch): Rgb => {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
};

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Lowers chroma until the colour fits into sRGB. */
export const clampChroma = (col: Oklch): Oklch => {
  if (inGamut(oklchToLinear(col))) return col;
  let lo = 0;
  let hi = col.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...col, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...col, c: lo };
};

export const oklchToHex = (col: Oklch): string => rgbToHex(oklchToLinear(clampChroma(col)).map(fromLinear) as Rgb);

// linear sRGB → OKLab, matrices by Björn Ottosson
export const hexToOklch = (hex: string): Oklch => {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: (deg(Math.atan2(B, A)) + 360) % 360 };
};

/** Start of the hue range the guesser may pick from. Stable per colour; target sits at 10–90 % of the width, never at an edge. */
export const hueWindowFrom = (hex: string, colorId: number, width: number) => {
  const pos = 0.1 + 0.8 * ((colorId * 0.6180339887) % 1);
  return (hexToOklch(hex).h - pos * width + 360) % 360;
};

export const hexToLab = (hex: string): Lab => {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 colour difference. */
export const deltaE2000 = ([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number => {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));

  const Lm = (L1 + L2) / 2;
  const Cm = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hm /= 2;
    else hm = h1p + h2p < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  }
  const T =
    1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cm;
  const SH = 1 + 0.015 * Cm * T;
  const Cm7p = Cm ** 7;
  const RT = -2 * Math.sqrt(Cm7p / (Cm7p + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hm - 275) / 25) ** 2))));

  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
};

export const hexDistance = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));

export const scoreFromDelta = (dE: number) => Math.max(0, Math.round(100 - 2.5 * dE));

export const verdict = (score: number) =>
  score >= 95 ? "Téměř přesně" : score >= 80 ? "Velmi blízko" : score >= 60 ? "Blízko" : score >= 35 ? "Trochu vedle" : "Úplně jinde";
