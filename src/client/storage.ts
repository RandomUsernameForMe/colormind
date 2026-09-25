export type Entry = { colorId: number; hex: string; name: string; guess?: string; score?: number; discovered?: boolean };

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode – game still works, just forgets */
  }
};

export const playerId: string = read("cm.player") ?? crypto.randomUUID();
write("cm.player", playerId);

export const history = (): Entry[] => {
  try {
    return JSON.parse(read("cm.history") ?? "[]");
  } catch {
    return [];
  }
};

export const remember = (entry: Entry) => write("cm.history", JSON.stringify([entry, ...history()]));

/** Highest hint id the player has already seen, per colour – anything above is "new". */
const seen = (): Record<string, number> => {
  try {
    return JSON.parse(read("cm.seen") ?? "{}");
  } catch {
    return {};
  }
};

export const seenUpTo = (colorId: number) => seen()[colorId] ?? 0;

export const markSeen = (colorId: number, hintIds: number[]) =>
  write("cm.seen", JSON.stringify({ ...seen(), [colorId]: Math.max(seenUpTo(colorId), ...hintIds) }));
