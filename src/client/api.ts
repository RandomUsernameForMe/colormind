import type { Answer, ColorDetail, DiscoverOptions, GuessResponse, HistoryResponse, NextResponse } from "../shared/api";
import { playerId } from "./storage";

const call = async <T>(path: string, body?: object): Promise<T> => {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ player: playerId, ...body }) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Něco se pokazilo");
  return data as T;
};

export const api = {
  next: (colorId?: number) => call<NextResponse>(`/api/next?player=${playerId}${colorId ? `&id=${colorId}` : ""}`),
  history: () => call<HistoryResponse>(`/api/history?player=${playerId}`),
  color: (colorId: number) => call<ColorDetail>(`/api/color?player=${playerId}&id=${colorId}`),
  guess: (colorId: number, hex: string) => call<GuessResponse>("/api/guess", { colorId, hex }),
  hint: (colorId: number, questionId: number, text: string) => call("/api/hint", { colorId, questionId, text }),
  like: (hintId: number) => call<{ liked: boolean }>("/api/like", { hintId }),
  discoverOptions: () => call<DiscoverOptions>("/api/discover"),
  discover: (hex: string, name: string, answers: Answer[]) => call<{ colorId: number }>("/api/discover", { hex, name, answers }),
};
