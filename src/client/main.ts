import type { Answer, ColorDetail, ColorSummary, GuessResponse, Hint, HistoryResponse, Question } from "../shared/api";
import { HUE_WINDOW, MAX_HINT, MAX_NAME } from "../shared/api";
import { verdict } from "../shared/color";
import { api } from "./api";
import { mountPicker, type Picker } from "./picker";
import { history, markSeen, remember, seenUpTo } from "./storage";

const stage = document.getElementById("stage")!;
const truth = document.getElementById("truth")!;
const app = document.getElementById("app")!;

let picker: Picker | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;

const screen = (html: string, mood: "free" | "idle" = "idle") => {
  picker?.destroy();
  picker = null;
  truth.classList.remove("shown");
  stage.classList.toggle("idle", mood === "idle");
  stage.classList.remove("drift");
  app.innerHTML = html;
};

const setBg = (hex: string) => (stage.style.backgroundColor = hex);

const showError = (e: unknown) => {
  const box = document.createElement("p");
  box.className = "toast";
  box.textContent = e instanceof Error ? e.message : String(e);
  app.append(box);
  setTimeout(() => box.remove(), 4000);
};

const groupHints = (hints: Hint[]) =>
  [...Map.groupBy(hints, (h) => h.question)].map(([question, list]) => ({ question, list }));

/** Czech plural: [1, 2–4, 5+] */
const plural = (n: number, [one, few, many]: [string, string, string]) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

const hintSize = (likes: number) => `${Math.min(1.5, 1 + likes * 0.08)}em`;

const hintsHtml = (hints: Hint[], likeable: boolean, newAfter = Infinity) =>
  hints.length === 0
    ? `<p class="muted">Zatím žádné nápovědy.</p>`
    : groupHints(hints)
        .map(
          ({ question, list }) => `
      <section class="group">
        <h3>${esc(question)}</h3>
        <ul>${list
          .map(
            (h) => `<li style="font-size:${hintSize(h.likes)}" class="${h.id > newAfter && !h.own ? "new" : ""}">
              <span>${esc(h.text)}${h.own ? ` <small class="tag">tvoje</small>` : ""}</span>
              ${likeable ? `<button class="like ${h.mine ? "on" : ""}" data-hint="${h.id}" aria-pressed="${h.mine}">👍 <b>${h.likes}</b></button>` : h.likes ? `<small>👍 ${h.likes}</small>` : ""}
            </li>`,
          )
          .join("")}</ul>
      </section>`,
        )
        .join("");

const wireLikes = () =>
  app.querySelectorAll<HTMLButtonElement>(".like").forEach((btn) => {
    btn.onclick = async () => {
      const { liked } = await api.like(Number(btn.dataset.hint)).catch((e) => (showError(e), { liked: btn.classList.contains("on") }));
      const count = btn.querySelector("b")!;
      if (liked !== btn.classList.contains("on")) count.textContent = String(Number(count.textContent) + (liked ? 1 : -1));
      btn.classList.toggle("on", liked);
      btn.setAttribute("aria-pressed", String(liked));
    };
  });

const answerForm = (question: Question, submitLabel: string, skipLabel: string) => `
  <form id="answer">
    <label for="text" class="eyebrow">Teď ty: ${esc(question.text)}</label>
    <input id="text" maxlength="${MAX_HINT}" autocomplete="off" placeholder="Pár slov, bez názvu barvy" />
    <div class="row">
      <button type="button" id="skip" class="ghost">${skipLabel}</button>
      <button class="primary">${submitLabel}</button>
    </div>
  </form>`;

const wireAnswer = (colorId: number, question: Question, then: () => Promise<unknown>) => {
  $("#skip").onclick = () => then().catch(showError);
  $<HTMLFormElement>("#answer").onsubmit = async (e) => {
    e.preventDefault();
    const text = $<HTMLInputElement>("#text").value.trim();
    try {
      if (text) await api.hint(colorId, question.id, text);
      await then();
    } catch (err) {
      showError(err);
    }
  };
  $("#text").focus();
};

// ---------- intro ----------

const showIntro = () => {
  const past = history();
  const scored = past.filter((e) => e.score !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((s, e) => s + e.score!, 0) / scored.length) : null;
  screen(`
    <div class="intro card">
      <h1>Colormind</h1>
      <p class="lead">Uhodni barvu jen podle toho, co o ní napsali ostatní. Pak ji popiš dalším.</p>
      <div class="row">
        <button class="primary" id="play">Hrát</button>
        <button class="ghost" id="history">Historie</button>
      </div>
      ${
        past.length
          ? `<div class="history">
              <p class="muted">${plural(scored.length, ["tip", "tipy", "tipů"])}${avg !== null ? ` · průměr ${avg}` : ""}${past.some((e) => e.discovered) ? ` · objeveno ${past.filter((e) => e.discovered).length}` : ""}</p>
              <div class="swatches" id="swatches" role="button" tabindex="0" aria-label="Otevřít historii">${past
                .slice(0, 40)
                .map(
                  (e) => `<span class="sw ${e.discovered ? "found" : ""}" title="${esc(e.name)}${e.score !== undefined ? ` · ${e.score}` : " · objeveno"}"
                    style="--a:${e.guess ?? e.hex};--b:${e.hex}"></span>`,
                )
                .join("")}</div>
            </div>`
          : ""
      }
    </div>`);
  stage.classList.add("drift");
  $("#play").onclick = () => play().catch(showError);
  $("#history").onclick = () => showHistory().catch(showError);
  const sw = app.querySelector<HTMLElement>("#swatches");
  if (sw) sw.onclick = $("#history").onclick;
};

// ---------- guessing ----------

const play = async (colorId?: number) => {
  const next = await api.next(colorId);
  if (next.done) return showDone();
  screen(
    `
    <aside class="card hints">
      <p class="eyebrow">Co o barvě říkají ostatní</p>
      ${hintsHtml(next.hints, false)}
    </aside>
    <div class="bar card">
      <p class="how">Táhni po ploše — vodorovně odstín, svisle světlost. Sytost dole nebo kolečkem.</p>
      <label class="chroma">Sytost <input type="range" id="chroma" /></label>
      <button class="primary" id="guess">Tipnout</button>
    </div>`,
    "free",
  );
  picker = mountPicker(stage, $<HTMLInputElement>("#chroma"), { from: next.hueFrom, width: HUE_WINDOW });
  $("#guess").onclick = async () => {
    const hex = picker!.hex();
    try {
      const res = await api.guess(next.colorId, hex);
      remember({ colorId: next.colorId, hex: res.hex, name: res.name, guess: hex, score: res.score });
      showReveal(next.colorId, hex, res);
    } catch (e) {
      showError(e);
    }
  };
};

const showReveal = (colorId: number, guessHex: string, res: GuessResponse) => {
  screen(`
    <div class="corner tl">Tvůj tip</div>
    <div class="corner br">${esc(res.name)}</div>
    <div class="card reveal">
      <div class="score"><b>${res.score}</b><span>${verdict(res.score)}</span></div>
      <p class="muted">ΔE ${res.deltaE.toFixed(1)}${res.avgScore !== null ? ` · ostatní průměrně ${res.avgScore} (${res.guessCount}×)` : " · jsi první, kdo tipoval"}</p>
      <p>Objevitel ji pojmenoval <em>${esc(res.name)}</em>.</p>
      <p class="eyebrow">Které nápovědy sedí?</p>
      <div class="hint-list">${hintsHtml(res.hints, true)}</div>
      ${answerForm(res.question, "Uložit a další", "Přeskočit")}
    </div>`);
  stage.style.backgroundColor = guessHex;
  truth.style.backgroundColor = res.hex;
  requestAnimationFrame(() => requestAnimationFrame(() => truth.classList.add("shown")));
  markSeen(colorId, res.hints.map((h) => h.id));
  wireLikes();
  wireAnswer(colorId, res.question, () => play());
};

// ---------- history ----------

const newCount = (c: ColorSummary) => c.hintIds.filter((id) => id > seenUpTo(c.colorId)).length;

const tile = (c: ColorSummary) => {
  const fresh = newCount(c);
  return `<button class="tile" data-color="${c.colorId}">
    <span class="tile-sw" style="--a:${c.guess ?? c.hex};--b:${c.hex}"></span>
    <span class="tile-name">${esc(c.name)}</span>
    <span class="tile-meta">${c.score !== null ? `${c.score} b.` : `průměr ${c.avgScore ?? "–"}`}${c.guess && !c.answered ? " · bez nápovědy" : ""}</span>
    ${fresh ? `<span class="badge">+${fresh}</span>` : ""}
  </button>`;
};

const tilesSection = (title: string, items: ColorSummary[]) =>
  items.length ? `<h2 class="eyebrow">${title} (${items.length})</h2><div class="tiles">${items.map(tile).join("")}</div>` : "";

const mysteryTile = (u: HistoryResponse["unplayed"][number]) =>
  `<button class="tile mystery" data-play="${u.colorId}"><span class="tile-sw">?</span><span class="tile-meta">${plural(u.hintCount, ["nápověda", "nápovědy", "nápověd"])}</span></button>`;

const showHistory = async () => {
  const h = await api.history();
  const empty = h.played.length + h.discovered.length + h.unplayed.length === 0;
  screen(`
    <div class="card history-page">
      <div class="row head">
        <h1>Historie</h1>
        <button class="ghost" id="home">Domů</button>
      </div>
      ${h.unplayed.length ? `<h2 class="eyebrow">Čeká na tebe (${h.unplayed.length})</h2><div class="tiles">${h.unplayed.map(mysteryTile).join("")}</div>` : ""}
      ${tilesSection("Odehrané", h.played)}
      ${tilesSection("Objevené", h.discovered)}
      ${empty ? `<p class="muted">Zatím nic. Pool je prázdný.</p>` : ""}
    </div>`);
  stage.classList.add("drift");
  $("#home").onclick = showIntro;
  app.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((b) => (b.onclick = () => play(Number(b.dataset.play)).catch(showError)));
  app.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => (b.onclick = () => showDetail(Number(b.dataset.color)).catch(showError)));
};

const detailStats = (d: ColorDetail) =>
  [
    d.score !== null ? `tvůj tip ${d.score} b.` : "tvůj objev",
    d.guessCount ? `ostatní průměrně ${d.avgScore} (${d.guessCount}×)` : "zatím nikdo další netipoval",
  ].join(" · ");

const showDetail = async (colorId: number): Promise<void> => {
  const d = await api.color(colorId);
  const seenBefore = seenUpTo(colorId);
  const fresh = newCount(d);
  screen(`
    ${d.guess ? `<div class="corner tl">Tvůj tip</div>` : ""}
    <div class="card reveal">
      <button class="ghost back" id="back">← Historie</button>
      <h2 class="detail-name">${esc(d.name)}</h2>
      <p class="muted">${detailStats(d)}</p>
      <p class="eyebrow">Nápovědy${fresh ? ` · ${plural(fresh, ["nová", "nové", "nových"])}` : ""}</p>
      <div class="hint-list">${hintsHtml(d.hints, true, seenBefore)}</div>
      ${d.question ? answerForm(d.question, "Uložit nápovědu", "Teď ne") : ""}
    </div>`);
  if (d.guess) {
    stage.style.backgroundColor = d.guess;
    truth.style.backgroundColor = d.hex;
    truth.classList.add("shown");
  } else setBg(d.hex);
  markSeen(colorId, d.hintIds);
  wireLikes();
  $("#back").onclick = () => showHistory().catch(showError);
  if (d.question) wireAnswer(colorId, d.question, () => showDetail(colorId));
};

// ---------- discovering ----------

const showDone = () => {
  screen(`
    <div class="card intro">
      <h2>Všechno máš uhodnuté</h2>
      <p class="lead">Pool je vyčerpaný. Objev novou barvu, pojmenuj ji a napiš k ní první nápovědy.</p>
      <div class="row">
        <button class="ghost" id="home">Domů</button>
        <button class="primary" id="discover">Objevit novou barvu</button>
      </div>
    </div>`);
  stage.classList.add("drift");
  $("#home").onclick = showIntro;
  $("#discover").onclick = () => discover().catch(showError);
};

const discover = async () => {
  const opts = await api.discoverOptions();
  if (opts.options.length === 0) throw new Error("Nenašla se žádná dost odlišná barva. Pool je plný!");
  screen(`
    <div class="options">${opts.options.map((hex) => `<button class="option" style="background:${hex}" data-hex="${hex}" aria-label="Vybrat barvu"></button>`).join("")}</div>
    <p class="card eyebrow pick-label">Vyber barvu, kterou objevíš</p>`);
  app.querySelectorAll<HTMLButtonElement>(".option").forEach((b) => (b.onclick = () => showNaming(b.dataset.hex!, opts.questions)));
};

const showNaming = (hex: string, questions: Question[]) => {
  screen(`
    <form class="card reveal" id="naming">
      <p class="eyebrow">Tvoje nová barva</p>
      <label for="name">Jak se jmenuje?</label>
      <input id="name" maxlength="${MAX_NAME}" required autocomplete="off" placeholder="Třeba Babiččina kuchyň" />
      <p class="muted">Jméno ostatní uvidí až po tipu. Odpověz aspoň na dvě otázky — to budou první nápovědy.</p>
      ${questions
        .map(
          (q) => `<label for="q${q.id}">${esc(q.text)}</label>
                  <input id="q${q.id}" data-q="${q.id}" maxlength="${MAX_HINT}" autocomplete="off" />`,
        )
        .join("")}
      <div class="row">
        <button type="button" class="ghost" id="back">Zpět</button>
        <button class="primary">Přidat do poolu</button>
      </div>
    </form>`);
  setBg(hex);
  $("#back").onclick = () => discover().catch(showError);
  $<HTMLFormElement>("#naming").onsubmit = async (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>("#name").value.trim();
    const answers: Answer[] = [...app.querySelectorAll<HTMLInputElement>("input[data-q]")]
      .map((i) => ({ questionId: Number(i.dataset.q), text: i.value.trim() }))
      .filter((a) => a.text);
    if (answers.length < 2) return showError(new Error("Odpověz aspoň na dvě otázky"));
    try {
      const { colorId } = await api.discover(hex, name, answers);
      remember({ colorId, hex, name, discovered: true });
      showDiscovered(hex, name);
    } catch (err) {
      showError(err);
    }
  };
  $("#name").focus();
};

const showDiscovered = (hex: string, name: string) => {
  screen(`
    <div class="card intro">
      <p class="eyebrow">Přidáno do poolu</p>
      <h2>${esc(name)}</h2>
      <p class="lead">Ostatní ji teď budou hádat podle tvých slov.</p>
      <div class="row">
        <button class="ghost" id="home">Domů</button>
        <button class="primary" id="more">Objevit další</button>
      </div>
    </div>`);
  setBg(hex);
  $("#home").onclick = showIntro;
  $("#more").onclick = () => discover().catch(showError);
};

showIntro();
