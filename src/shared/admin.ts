export type AdminDay = { day: string; guesses: number; hints: number };

export type AdminOverview = {
  colors: number;
  hiddenColors: number;
  players: number;
  guesses: number;
  hints: number;
  hiddenHints: number;
  days: AdminDay[];
};

/** first5/last5 = average score of the first and last five guesses – the convergence measure. */
export type AdminColor = {
  id: number;
  hex: string;
  name: string;
  discovererId: string;
  hidden: boolean;
  createdAt: number;
  guessCount: number;
  avgScore: number | null;
  first5: number | null;
  last5: number | null;
  hintCount: number;
  questionIds: number[];
};

export type AdminHint = {
  id: number;
  colorId: number;
  colorHex: string;
  colorName: string;
  question: string;
  text: string;
  playerId: string;
  likes: number;
  hidden: boolean;
  createdAt: number;
};

export type AdminQuestion = { id: number; text: string; active: boolean; colorCount: number; hintCount: number };

export type ScorePoint = { score: number; at: number };

/** Below this many guesses first5 and last5 overlap, so the trend means nothing. */
export const TREND_MIN_GUESSES = 10;
export const MAX_QUESTION = 120;
export const MAX_COLOR_QUESTIONS = 5;
