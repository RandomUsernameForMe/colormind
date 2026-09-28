import { hexToRgb, oklchToHex, type Oklch } from "../shared/color";

const L_MIN = 0.15;
const L_MAX = 0.97;
const C_MAX = 0.32;
const FIELD_W = 72;
const FIELD_H = 48;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });
const gradient = (dir: string, stops: string[]) => `linear-gradient(${dir}, ${stops.join(", ")})`;
const range = (n: number, f: (t: number) => string) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** Paints hue × lightness at chroma `c` into a small canvas; CSS stretches it smoothly over the stage. */
const paintField = (ctx: CanvasRenderingContext2D, hue: HueRange, c: number) => {
  const img = ctx.createImageData(FIELD_W, FIELD_H);
  for (let y = 0; y < FIELD_H; y++)
    for (let x = 0; x < FIELD_W; x++) {
      const hex = oklchToHex({ l: L_MAX - (y / (FIELD_H - 1)) * (L_MAX - L_MIN), c, h: hue.from + (x / (FIELD_W - 1)) * hue.width });
      img.data.set([...hexToRgb(hex).map((v) => v * 255), 255], (y * FIELD_W + x) * 4);
    }
  ctx.putImageData(img, 0, 0);
};

export type Picker = { hex: () => string; destroy: () => void };
export type HueRange = { from: number; width: number };

/** Whole stage is the picker: x = hue (within `hue`, unwrapped), y = lightness, slider/wheel = chroma. */
export const mountPicker = (stage: HTMLElement, chroma: HTMLInputElement, hue: HueRange = { from: 0, width: 360 }): Picker => {
  const full = hue.width >= 360;
  let col: Oklch = { l: 0.62, c: 0.12, h: hue.from + Math.random() * hue.width };
  const cross = div("cross");
  const field = Object.assign(document.createElement("canvas"), { className: "field", width: FIELD_W, height: FIELD_H });
  const ctx = field.getContext("2d")!;
  let paintedC = -1;
  stage.append(field, cross);
  stage.classList.remove("idle");
  Object.assign(chroma, { min: "0", max: String(C_MAX), step: "0.002", value: String(col.c) });

  const render = () => {
    if (col.c !== paintedC) paintField(ctx, hue, (paintedC = col.c));
    cross.style.backgroundColor = oklchToHex(col);
    cross.style.left = `${((col.h - hue.from) / hue.width) * 100}%`;
    cross.style.top = `${((L_MAX - col.l) / (L_MAX - L_MIN)) * 100}%`;
    chroma.style.background = gradient("to right", range(8, (t) => oklchToHex({ ...col, c: t * C_MAX })));
  };

  const update = (patch: Partial<Oklch>) => {
    col = { ...col, ...patch };
    col.c = Math.min(C_MAX, Math.max(0, col.c));
    col.l = Math.min(L_MAX, Math.max(L_MIN, col.l));
    col.h = full ? (col.h + 360) % 360 : Math.min(hue.from + hue.width, Math.max(hue.from, col.h));
    chroma.value = String(col.c);
    render();
  };

  const fromPointer = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    update({ h: hue.from + clamp01((e.clientX - r.left) / r.width) * (full ? 359.9 : hue.width), l: L_MAX - clamp01((e.clientY - r.top) / r.height) * (L_MAX - L_MIN) });
  };
  const onDown = (e: PointerEvent) => {
    stage.setPointerCapture(e.pointerId);
    fromPointer(e);
  };
  const onMove = (e: PointerEvent) => stage.hasPointerCapture(e.pointerId) && fromPointer(e);
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    update({ c: col.c - e.deltaY * 0.0002 });
  };
  const onChroma = () => update({ c: Number(chroma.value) });
  const keys: Record<string, Partial<Oklch>> = {
    ArrowLeft: { h: -3 },
    ArrowRight: { h: 3 },
    ArrowUp: { l: 0.01 },
    ArrowDown: { l: -0.01 },
    "+": { c: 0.005 },
    "-": { c: -0.005 },
  };
  const onKey = (e: KeyboardEvent) => {
    const d = keys[e.key];
    if (!d || (e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    update({ h: col.h + (d.h ?? 0), l: col.l + (d.l ?? 0), c: col.c + (d.c ?? 0) });
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("wheel", onWheel, { passive: false });
  chroma.addEventListener("input", onChroma);
  window.addEventListener("keydown", onKey);
  render();

  return {
    hex: () => oklchToHex(col),
    destroy: () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      cross.remove();
      field.remove();
      stage.classList.add("idle");
    },
  };
};
