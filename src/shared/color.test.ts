import { describe, expect, it } from "vitest";
import { deltaE2000, hexToLab, hexToOklch, hueWindowFrom, oklchToHex, scoreFromDelta } from "./color";

describe("deltaE2000 (Sharma et al. reference pairs)", () => {
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  it.each(pairs)("%j vs %j = %f", (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
  });
});

describe("conversions", () => {
  it("white is L=100 in Lab", () => {
    const [L, a, b] = hexToLab("#ffffff");
    expect(L).toBeCloseTo(100, 2);
    expect(a).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });
  it("oklch red maps to #ff0000", () => {
    expect(oklchToHex({ l: 0.62795536, c: 0.2576833, h: 29.2338851 })).toBe("#ff0000");
  });
  it("out-of-gamut chroma is clamped, not garbage", () => {
    expect(oklchToHex({ l: 0.5, c: 0.4, h: 140 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

it("score", () => {
  expect(scoreFromDelta(0)).toBe(100);
  expect(scoreFromDelta(10)).toBe(75);
  expect(scoreFromDelta(50)).toBe(0);
});

describe("hue window", () => {
  it("hexToOklch round-trips", () => {
    const col = hexToOklch("#ff0000");
    expect(col.l).toBeCloseTo(0.628, 3);
    expect(col.c).toBeCloseTo(0.2577, 3);
    expect(col.h).toBeCloseTo(29.23, 1);
  });
  it.each([1, 2, 7, 42, 1000])("colour %i lies inside its window, away from edges", (id) => {
    for (const hex of ["#ff0000", "#00ff80", "#3050c0", "#808080"]) {
      const h = hexToOklch(hex).h;
      const offset = (((h - hueWindowFrom(hex, id, 90)) % 360) + 360) % 360;
      expect(offset).toBeGreaterThanOrEqual(9);
      expect(offset).toBeLessThanOrEqual(81);
    }
  });
  it("window is not always centred", () => {
    const offsets = [1, 2, 3, 4, 5].map((id) => (hexToOklch("#ff0000").h - hueWindowFrom("#ff0000", id, 90) + 360) % 360);
    expect(new Set(offsets.map(Math.round)).size).toBeGreaterThan(1);
  });
});
