import { oklchToHex, type Oklch } from "../shared/color";

const L_MIN = 0.15;
const L_MAX = 0.97;
const C_MAX = 0.32;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });
const gradient = (dir: string, stops: string[]) => `linear-gradient(${dir}, ${stops.join(", ")})`;
const range = (n: number, f: (t: number) => string) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

export type Picker = { hex: () => string; destroy: () => void };

/** Whole stage is the picker: x = hue, y = lightness, slider/wheel = chroma. */
export const mountPicker = (stage: HTMLElement, chroma: HTMLInputElement): Picker => {
  let col: Oklch = { l: 0.62, c: 0.12, h: Math.random() * 360 };
  const cross = div("cross");
  const hueStrip = div("strip strip-h");
  const lightStrip = div("strip strip-v");
  stage.append(cross, hueStrip, lightStrip);
  stage.classList.remove("idle");
  Object.assign(chroma, { min: "0", max: String(C_MAX), step: "0.002", value: String(col.c) });

  const render = () => {
    stage.style.backgroundColor = oklchToHex(col);
    cross.style.left = `${(col.h / 360) * 100}%`;
    cross.style.top = `${((L_MAX - col.l) / (L_MAX - L_MIN)) * 100}%`;
    hueStrip.style.background = gradient("to right", range(12, (t) => oklchToHex({ ...col, h: t * 360 })));
    lightStrip.style.background = gradient("to bottom", range(8, (t) => oklchToHex({ ...col, l: L_MAX - t * (L_MAX - L_MIN) })));
    chroma.style.background = gradient("to right", range(8, (t) => oklchToHex({ ...col, c: t * C_MAX })));
  };

  const update = (patch: Partial<Oklch>) => {
    col = { ...col, ...patch };
    col.c = Math.min(C_MAX, Math.max(0, col.c));
    col.l = Math.min(L_MAX, Math.max(L_MIN, col.l));
    col.h = (col.h + 360) % 360;
    chroma.value = String(col.c);
    render();
  };

  const fromPointer = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    update({ h: clamp01((e.clientX - r.left) / r.width) * 359.9, l: L_MAX - clamp01((e.clientY - r.top) / r.height) * (L_MAX - L_MIN) });
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
      hueStrip.remove();
      lightStrip.remove();
      stage.classList.add("idle");
    },
  };
};
