import type { Answer, ColorDetail, ColorSummary, DiscoverOptions, GuessResponse, Hint, HistoryResponse, NextResponse, Question } from "../shared/api";
import { FREE_PICK_LIMIT, MAX_HINT, MAX_NAME, MIN_DISTANCE } from "../shared/api";
import { clampChroma, hexDistance, isHex, oklchToHex, scoreFromDelta } from "../shared/color";

import { adminRoute } from "./admin";
import { fail, HttpError, idOf, json, playerOf, textOf, type Body } from "./http";

type Env = { DB: D1Database; ADMIN_TOKEN?: string };

const hintsFor = async (db: D1Database, colorId: number, player: string): Promise<Hint[]> => {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.question_id AS questionId, q.text AS question, h.text,
              COUNT(l.player_id) AS likes, COALESCE(MAX(l.player_id = ?2), 0) AS mine, h.player_id = ?2 AS own
       FROM hints h JOIN questions q ON q.id = h.question_id
       LEFT JOIN likes l ON l.hint_id = h.id
       WHERE h.color_id = ?1 AND h.hidden = 0 GROUP BY h.id ORDER BY likes DESC, h.id`,
    )
    .bind(colorId, player)
    .all<Omit<Hint, "mine" | "own"> & { mine: number; own: number }>();
  return results.map((h) => ({ ...h, mine: h.mine === 1, own: h.own === 1 }));
};

const UNPLAYED = `FROM colors c
  WHERE c.discoverer_id != ?1 AND c.hidden = 0
    AND NOT EXISTS (SELECT 1 FROM guesses g WHERE g.color_id = c.id AND g.player_id = ?1)`;

/** Without colorId picks the unplayed colour with most hints; with it, that exact colour (if still unplayed). */
const next = async (db: D1Database, player: string, colorId: number | null): Promise<NextResponse> => {
  const row = await db
    .prepare(
      `SELECT c.id ${UNPLAYED} AND (?2 IS NULL OR c.id = ?2)
       ORDER BY (SELECT COUNT(*) FROM hints h WHERE h.color_id = c.id AND h.hidden = 0) DESC, RANDOM() LIMIT 1`,
    )
    .bind(player, colorId)
    .first<{ id: number }>();
  if (!row && colorId) fail(404, "Tuhle barvu už hrát nemůžeš");
  if (!row) return { done: true };
  return { done: false, colorId: row.id, hints: (await hintsFor(db, row.id, player)).map((h) => ({ ...h, mine: false })) };
};

const leastAnsweredQuestion = (db: D1Database, colorId: number) =>
  db
    .prepare(
      `SELECT q.id, q.text FROM color_questions cq JOIN questions q ON q.id = cq.question_id
       WHERE cq.color_id = ?1
       ORDER BY (SELECT COUNT(*) FROM hints h WHERE h.color_id = ?1 AND h.question_id = q.id), RANDOM() LIMIT 1`,
    )
    .bind(colorId)
    .first<Question>();

const guess = async (db: D1Database, body: Body): Promise<GuessResponse> => {
  const player = playerOf(body.player);
  const colorId = idOf(body.colorId);
  const hex = isHex(body.hex) ? body.hex : fail(400, "Neplatná barva");
  const color = await db.prepare("SELECT hex, name, discoverer_id FROM colors WHERE id = ? AND hidden = 0").bind(colorId).first<{ hex: string; name: string; discoverer_id: string }>();
  if (!color) fail(404, "Barva neexistuje");
  if (color!.discoverer_id === player) fail(400, "Vlastní barvu nehádáš");

  const deltaE = hexDistance(hex, color!.hex);
  const score = scoreFromDelta(deltaE);
  const { meta } = await db
    .prepare("INSERT INTO guesses (color_id, player_id, hex, delta_e, score) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(colorId, player, hex, deltaE, score)
    .run();
  if (meta.changes === 0) fail(409, "Tuhle barvu už jsi tipoval/a");

  const stats = await db
    .prepare("SELECT AVG(score) AS avg, COUNT(*) AS n FROM guesses WHERE color_id = ? AND player_id != ?")
    .bind(colorId, player)
    .first<{ avg: number | null; n: number }>();
  return {
    hex: color!.hex,
    name: color!.name,
    deltaE,
    score,
    avgScore: stats?.avg == null ? null : Math.round(stats.avg),
    guessCount: stats?.n ?? 0,
    question: (await leastAnsweredQuestion(db, colorId)) ?? fail(500, "Barva nemá otázky"),
    hints: await hintsFor(db, colorId, player),
  };
};

const addHint = async (db: D1Database, body: Body) => {
  const player = playerOf(body.player);
  const colorId = idOf(body.colorId);
  const questionId = idOf(body.questionId);
  const text = textOf(body.text, MAX_HINT);
  const allowed = await db
    .prepare(
      `SELECT 1 FROM guesses g JOIN color_questions cq ON cq.color_id = g.color_id
       WHERE g.color_id = ?1 AND g.player_id = ?2 AND cq.question_id = ?3`,
    )
    .bind(colorId, player, questionId)
    .first();
  if (!allowed) fail(403, "Nápovědu můžeš napsat až po tipu");
  const already = await db.prepare("SELECT 1 FROM hints WHERE color_id = ? AND player_id = ?").bind(colorId, player).first();
  if (already) fail(409, "K téhle barvě už nápovědu máš");
  await db.prepare("INSERT INTO hints (color_id, question_id, player_id, text) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(colorId, questionId, player, text).run();
  return { ok: true };
};

const toggleLike = async (db: D1Database, body: Body) => {
  const player = playerOf(body.player);
  const hintId = idOf(body.hintId);
  const { meta } = await db.prepare("INSERT INTO likes (hint_id, player_id) SELECT id, ? FROM hints WHERE id = ? ON CONFLICT DO NOTHING").bind(player, hintId).run();
  if (meta.changes === 0) await db.prepare("DELETE FROM likes WHERE hint_id = ? AND player_id = ?").bind(hintId, player).run();
  return { liked: meta.changes > 0 };
};

const SUMMARY = `
  SELECT c.id AS colorId, c.hex, c.name, g.hex AS guess, g.score,
    (SELECT ROUND(AVG(x.score)) FROM guesses x WHERE x.color_id = c.id AND x.player_id != ?1) AS avgScore,
    (SELECT COUNT(*) FROM guesses x WHERE x.color_id = c.id AND x.player_id != ?1) AS guessCount,
    (SELECT json_group_array(h.id) FROM hints h WHERE h.color_id = c.id AND h.player_id != ?1 AND h.hidden = 0) AS hintIds,
    EXISTS (SELECT 1 FROM hints h WHERE h.color_id = c.id AND h.player_id = ?1) AS answered
  FROM colors c LEFT JOIN guesses g ON g.color_id = c.id AND g.player_id = ?1
  WHERE (g.player_id IS NOT NULL OR c.discoverer_id = ?1) AND (?2 IS NULL OR c.id = ?2)
  ORDER BY COALESCE(g.created_at, c.created_at) DESC, c.id DESC`;

type SummaryRow = Omit<ColorSummary, "hintIds" | "answered"> & { hintIds: string; answered: number };

const summaries = async (db: D1Database, player: string, colorId: number | null): Promise<ColorSummary[]> =>
  (await db.prepare(SUMMARY).bind(player, colorId).all<SummaryRow>()).results.map((r) => ({
    ...r,
    hintIds: JSON.parse(r.hintIds),
    answered: r.answered === 1,
  }));

const history = async (db: D1Database, player: string): Promise<HistoryResponse> => {
  const all = await summaries(db, player, null);
  const { results: unplayed } = await db
    .prepare(`SELECT c.id AS colorId, (SELECT COUNT(*) FROM hints h WHERE h.color_id = c.id AND h.hidden = 0) AS hintCount ${UNPLAYED} ORDER BY c.id`)
    .bind(player)
    .all<{ colorId: number; hintCount: number }>();
  return { played: all.filter((c) => c.guess), discovered: all.filter((c) => !c.guess), unplayed };
};

/** Only colours the player has guessed or discovered – otherwise it would leak the answer. */
const detail = async (db: D1Database, player: string, colorId: number): Promise<ColorDetail> => {
  const [summary] = await summaries(db, player, colorId);
  if (!summary) fail(404, "Tuhle barvu ještě neznáš");
  return {
    ...summary,
    hints: await hintsFor(db, colorId, player),
    question: summary.guess && !summary.answered ? await leastAnsweredQuestion(db, colorId) : null,
  };
};

const allHexes = async (db: D1Database) => (await db.prepare("SELECT hex FROM colors WHERE hidden = 0").all<{ hex: string }>()).results.map((r) => r.hex);

const isDistinct = (hex: string, others: string[]) => others.every((o) => hexDistance(hex, o) >= MIN_DISTANCE);

const randomHex = () => oklchToHex(clampChroma({ l: 0.2 + Math.random() * 0.75, c: Math.random() * 0.3, h: Math.random() * 360 }));

const pickOptions = (existing: string[], count: number) => {
  const picked: string[] = [];
  for (let i = 0; i < 2000 && picked.length < count; i++) {
    const hex = randomHex();
    if (isDistinct(hex, [...existing, ...picked])) picked.push(hex);
  }
  return picked;
};

const randomQuestions = async (db: D1Database) =>
  (await db.prepare("SELECT id, text FROM questions WHERE active = 1 ORDER BY RANDOM() LIMIT 3").all<Question>()).results;

const discoverOptions = async (db: D1Database): Promise<DiscoverOptions> => {
  const existing = await allHexes(db);
  const free = existing.length < FREE_PICK_LIMIT;
  return { free, options: free ? [] : pickOptions(existing, 3), questions: await randomQuestions(db) };
};

const discover = async (db: D1Database, body: Body) => {
  const player = playerOf(body.player);
  const hex = isHex(body.hex) ? body.hex : fail(400, "Neplatná barva");
  const name = textOf(body.name, MAX_NAME);
  const answers = Array.isArray(body.answers) ? (body.answers as Answer[]) : fail(400, "Chybí odpovědi");
  const parsed = answers.map((a) => ({ questionId: idOf(a?.questionId), text: textOf(a?.text, MAX_HINT) }));
  if (parsed.length < 2 || parsed.length > 3 || new Set(parsed.map((a) => a.questionId)).size !== parsed.length) fail(400, "Odpověz na 2–3 různé otázky");
  if (!isDistinct(hex, await allHexes(db))) fail(409, "Moc podobná barva už v poolu je, zkus jinou");

  const color = await db.prepare("INSERT INTO colors (hex, name, discoverer_id) VALUES (?, ?, ?) RETURNING id").bind(hex, name, player).first<{ id: number }>();
  const colorId = color!.id;
  await db.batch(
    parsed.flatMap((a) => [
      db.prepare("INSERT INTO color_questions (color_id, question_id) VALUES (?, ?)").bind(colorId, a.questionId),
      db.prepare("INSERT INTO hints (color_id, question_id, player_id, text) VALUES (?, ?, ?, ?)").bind(colorId, a.questionId, player, a.text),
    ]),
  );
  return { colorId };
};

const route = async (req: Request, env: Env) => {
  const db = env.DB;
  const url = new URL(req.url);
  const key = `${req.method} ${url.pathname}`;
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Body) : {};
  if (url.pathname.startsWith("/api/admin/")) return adminRoute(req, url, body, db, env.ADMIN_TOKEN);
  const player = () => playerOf(url.searchParams.get("player"));
  const colorParam = url.searchParams.get("id");
  const colorId = colorParam === null ? null : idOf(Number(colorParam));
  switch (key) {
    case "GET /api/next":
      return next(db, player(), colorId);
    case "GET /api/history":
      return history(db, player());
    case "GET /api/color":
      return detail(db, player(), colorId ?? fail(400, "Chybí id"));
    case "POST /api/guess":
      return guess(db, body);
    case "POST /api/hint":
      return addHint(db, body);
    case "POST /api/like":
      return toggleLike(db, body);
    case "GET /api/discover":
      return discoverOptions(db);
    case "POST /api/discover":
      return discover(db, body);
    default:
      return fail(404, "Nenalezeno");
  }
};

export default {
  async fetch(req, env) {
    try {
      return json(await route(req, env));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Chyba serveru" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
