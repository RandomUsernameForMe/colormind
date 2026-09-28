/** mine = liked by me, own = written by me */
export type Hint = { id: number; questionId: number; question: string; text: string; likes: number; mine: boolean; own: boolean };
export type Question = { id: number; text: string };

/** hueFrom = start of the HUE_WINDOW-wide hue range the guesser picks from */
export type NextResponse = { done: true } | { done: false; colorId: number; hints: Hint[]; hueFrom: number };

export type GuessResponse = {
  hex: string;
  name: string;
  deltaE: number;
  score: number;
  avgScore: number | null;
  guessCount: number;
  question: Question;
  hints: Hint[];
};

export type DiscoverOptions = { free: boolean; options: string[]; questions: Question[] };

export type Answer = { questionId: number; text: string };

/** guess/score are null for colours the player discovered. hintIds exclude the player's own hints. */
export type ColorSummary = {
  colorId: number;
  hex: string;
  name: string;
  guess: string | null;
  score: number | null;
  avgScore: number | null;
  guessCount: number;
  hintIds: number[];
  answered: boolean;
};

export type HistoryResponse = {
  played: ColorSummary[];
  discovered: ColorSummary[];
  unplayed: { colorId: number; hintCount: number }[];
};

export type ColorDetail = ColorSummary & { hints: Hint[]; question: Question | null };

export const FREE_PICK_LIMIT = 5;
export const MIN_DISTANCE = 10;
export const MAX_HINT = 80;
export const MAX_NAME = 40;
export const HUE_WINDOW = 90;
