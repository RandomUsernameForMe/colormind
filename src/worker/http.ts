export type Body = Record<string, unknown>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

const PLAYER_RE = /^[0-9a-f-]{36}$/;
export const playerOf = (v: unknown): string => (typeof v === "string" && PLAYER_RE.test(v) ? v : fail(400, "Neplatný hráč"));
export const idOf = (v: unknown): number => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(400, "Neplatné id"));
export const textOf = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s.length > 0 && s.length <= max ? s : fail(400, `Text musí mít 1–${max} znaků`);
};
export const boolOf = (v: unknown): boolean => (typeof v === "boolean" ? v : fail(400, "Očekávám true/false"));
