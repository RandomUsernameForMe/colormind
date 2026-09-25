import type { AdminColor, AdminHint, AdminOverview, AdminQuestion, ScorePoint } from "../shared/admin";
import { MAX_COLOR_QUESTIONS, MAX_QUESTION } from "../shared/admin";
import { MAX_NAME } from "../shared/api";
import { boolOf, fail, idOf, playerOf, textOf, type Body } from "./http";

const sha256 = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

/** Hashing first makes both inputs equal length, which timingSafeEqual requires. */
const checkAuth = async (req: Request, token: string | undefined) => {
  if (!token) fail(503, "Admin není nastavený (chybí ADMIN_TOKEN)");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const [a, b] = await Promise.all([sha256(given), sha256(token!)]);
  if (!crypto.subtle.timingSafeEqual(a, b)) fail(401, "Špatné heslo");
};

const bools = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, keys.includes(k) ? v === 1 : v]));

const overview = async (db: D1Database): Promise<AdminOverview> => {
  const [totals, days] = await db.batch([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM colors WHERE hidden = 0) AS colors,
      (SELECT COUNT(*) FROM colors WHERE hidden = 1) AS hiddenColors,
      (SELECT COUNT(*) FROM (SELECT player_id FROM guesses UNION SELECT player_id FROM hints UNION SELECT discoverer_id FROM colors)) AS players,
      (SELECT COUNT(*) FROM guesses) AS guesses,
      (SELECT COUNT(*) FROM hints WHERE hidden = 0) AS hints,
      (SELECT COUNT(*) FROM hints WHERE hidden = 1) AS hiddenHints`),
    db.prepare(`WITH RECURSIVE d(day) AS (SELECT date('now', '-6 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now'))
      SELECT d.day,
        (SELECT COUNT(*) FROM guesses g WHERE date(g.created_at, 'unixepoch') = d.day) AS guesses,
        (SELECT COUNT(*) FROM hints h WHERE date(h.created_at, 'unixepoch') = d.day) AS hints
      FROM d`),
  ]);
  return { ...(totals.results[0] as Omit<AdminOverview, "days">), days: days.results as AdminOverview["days"] };
};

const colors = async (db: D1Database): Promise<AdminColor[]> => {
  const { results } = await db
    .prepare(
      `WITH ranked AS (
         SELECT color_id, score,
           ROW_NUMBER() OVER (PARTITION BY color_id ORDER BY created_at, rowid) AS rn,
           COUNT(*) OVER (PARTITION BY color_id) AS n
         FROM guesses),
       trend AS (
         SELECT color_id, COUNT(*) AS n, ROUND(AVG(score)) AS avg,
           ROUND(AVG(CASE WHEN rn <= 5 THEN score END)) AS first5,
           ROUND(AVG(CASE WHEN rn > n - 5 THEN score END)) AS last5
         FROM ranked GROUP BY color_id)
       SELECT c.id, c.hex, c.name, c.discoverer_id AS discovererId, c.hidden, c.created_at AS createdAt,
         COALESCE(t.n, 0) AS guessCount, t.avg AS avgScore, t.first5, t.last5,
         (SELECT COUNT(*) FROM hints h WHERE h.color_id = c.id AND h.hidden = 0) AS hintCount,
         (SELECT json_group_array(question_id) FROM color_questions cq WHERE cq.color_id = c.id) AS questionIds
       FROM colors c LEFT JOIN trend t ON t.color_id = c.id
       ORDER BY c.id DESC`,
    )
    .all<Record<string, unknown>>();
  return results.map((r) => ({ ...bools(r, ["hidden"]), questionIds: JSON.parse(r.questionIds as string) }) as AdminColor);
};

const scores = async (db: D1Database, colorId: number): Promise<ScorePoint[]> =>
  (await db.prepare("SELECT score, created_at AS at FROM guesses WHERE color_id = ? ORDER BY created_at, rowid").bind(colorId).all<ScorePoint>()).results;

const questionIdsOf = async (db: D1Database, v: unknown) => {
  const ids = Array.isArray(v) ? v.map(idOf) : fail(400, "questionIds musí být pole");
  if (ids.length < 1 || ids.length > MAX_COLOR_QUESTIONS || new Set(ids).size !== ids.length) fail(400, `Barva potřebuje 1–${MAX_COLOR_QUESTIONS} různých otázek`);
  const found = await db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).first<{ n: number }>();
  if (found?.n !== ids.length) fail(400, "Neznámá otázka");
  return ids;
};

const updateColor = async (db: D1Database, body: Body) => {
  const id = idOf(body.id);
  const stmts: D1PreparedStatement[] = [];
  if (body.name !== undefined) stmts.push(db.prepare("UPDATE colors SET name = ? WHERE id = ?").bind(textOf(body.name, MAX_NAME), id));
  if (body.hidden !== undefined) stmts.push(db.prepare("UPDATE colors SET hidden = ? WHERE id = ?").bind(boolOf(body.hidden) ? 1 : 0, id));
  if (body.questionIds !== undefined) {
    const qids = await questionIdsOf(db, body.questionIds);
    stmts.push(db.prepare("DELETE FROM color_questions WHERE color_id = ?").bind(id));
    qids.forEach((q) => stmts.push(db.prepare("INSERT INTO color_questions (color_id, question_id) VALUES (?, ?)").bind(id, q)));
  }
  if (stmts.length === 0) fail(400, "Nic ke změně");
  await db.batch(stmts);
  return { ok: true };
};

const hints = async (db: D1Database, url: URL): Promise<AdminHint[]> => {
  const colorParam = url.searchParams.get("colorId");
  const playerParam = url.searchParams.get("player");
  const { results } = await db
    .prepare(
      `SELECT h.id, h.color_id AS colorId, c.hex AS colorHex, c.name AS colorName, q.text AS question, h.text,
         h.player_id AS playerId, (SELECT COUNT(*) FROM likes l WHERE l.hint_id = h.id) AS likes, h.hidden, h.created_at AS createdAt
       FROM hints h JOIN colors c ON c.id = h.color_id JOIN questions q ON q.id = h.question_id
       WHERE (?1 IS NULL OR h.color_id = ?1) AND (?2 IS NULL OR h.player_id = ?2)
       ORDER BY h.id DESC LIMIT 300`,
    )
    .bind(colorParam ? idOf(Number(colorParam)) : null, playerParam ? playerOf(playerParam) : null)
    .all<Record<string, unknown>>();
  return results.map((r) => bools(r, ["hidden"]) as AdminHint);
};

const hideHint = async (db: D1Database, body: Body) => {
  await db.prepare("UPDATE hints SET hidden = ? WHERE id = ?").bind(boolOf(body.hidden) ? 1 : 0, idOf(body.id)).run();
  return { ok: true };
};

const hidePlayerHints = async (db: D1Database, body: Body) => {
  const { meta } = await db.prepare("UPDATE hints SET hidden = ? WHERE player_id = ?").bind(boolOf(body.hidden) ? 1 : 0, playerOf(body.player)).run();
  return { changed: meta.changes };
};

const questions = async (db: D1Database): Promise<AdminQuestion[]> => {
  const { results } = await db
    .prepare(
      `SELECT q.id, q.text, q.active,
         (SELECT COUNT(*) FROM color_questions cq WHERE cq.question_id = q.id) AS colorCount,
         (SELECT COUNT(*) FROM hints h WHERE h.question_id = q.id) AS hintCount
       FROM questions q ORDER BY q.id`,
    )
    .all<Record<string, unknown>>();
  return results.map((r) => bools(r, ["active"]) as AdminQuestion);
};

const saveQuestion = async (db: D1Database, body: Body) => {
  const text = textOf(body.text, MAX_QUESTION);
  const active = body.active === undefined ? 1 : boolOf(body.active) ? 1 : 0;
  if (body.id === undefined) {
    const row = await db.prepare("INSERT INTO questions (text, active) VALUES (?, ?) RETURNING id").bind(text, active).first<{ id: number }>();
    return { id: row!.id };
  }
  const id = idOf(body.id);
  await db.prepare("UPDATE questions SET text = ?, active = ? WHERE id = ?").bind(text, active, id).run();
  return { id };
};

export const adminRoute = async (req: Request, url: URL, body: Body, db: D1Database, token: string | undefined) => {
  await checkAuth(req, token);
  switch (`${req.method} ${url.pathname}`) {
    case "GET /api/admin/check":
      return { ok: true };
    case "GET /api/admin/overview":
      return overview(db);
    case "GET /api/admin/colors":
      return colors(db);
    case "GET /api/admin/scores":
      return scores(db, idOf(Number(url.searchParams.get("colorId"))));
    case "POST /api/admin/color":
      return updateColor(db, body);
    case "GET /api/admin/hints":
      return hints(db, url);
    case "POST /api/admin/hint":
      return hideHint(db, body);
    case "POST /api/admin/player-hints":
      return hidePlayerHints(db, body);
    case "GET /api/admin/questions":
      return questions(db);
    case "POST /api/admin/question":
      return saveQuestion(db, body);
    default:
      return fail(404, "Nenalezeno");
  }
};
