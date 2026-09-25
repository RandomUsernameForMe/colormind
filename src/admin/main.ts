import type { AdminColor, AdminHint, AdminOverview, AdminQuestion, ScorePoint } from "../shared/admin";
import { MAX_QUESTION, TREND_MIN_GUESSES } from "../shared/admin";
import { MAX_NAME } from "../shared/api";
import { barChart, scoreChart } from "./charts";

const root = document.getElementById("admin")!;
const TOKEN_KEY = "cm.admin";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(sel: string, from: ParentNode = root) => from.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string, from: ParentNode = root) => [...from.querySelectorAll<T>(sel)];
const date = (unix: number) => new Date(unix * 1000).toLocaleString("cs", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const shortId = (id: string) => id.slice(0, 8);

const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const setToken = (t: string | null) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* no storage – user will log in again */
  }
};

class Unauthorized extends Error {}

const call = async <T>(path: string, body?: object): Promise<T> => {
  const res = await fetch(`/api/admin/${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) throw new Unauthorized(data.error);
  if (!res.ok) throw new Error(data.error ?? "Chyba");
  return data as T;
};

const toast = (msg: string, bad = false) => {
  const el = Object.assign(document.createElement("p"), { className: `toast ${bad ? "bad" : ""}`, textContent: msg });
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
};

const guard = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Unauthorized) {
      setToken(null);
      return showLogin(e.message);
    }
    toast(e instanceof Error ? e.message : String(e), true);
  }
};

// ---------- login ----------

const showLogin = (error = "") => {
  root.innerHTML = `
    <form class="login panel" id="login">
      <h1>Colormind admin</h1>
      <label for="pw">Heslo</label>
      <input id="pw" type="password" autocomplete="current-password" required />
      ${error ? `<p class="error">${esc(error)}</p>` : ""}
      <button class="primary">Přihlásit</button>
    </form>`;
  $<HTMLFormElement>("#login").onsubmit = (e) => {
    e.preventDefault();
    setToken($<HTMLInputElement>("#pw").value);
    guard(async () => {
      await call("check");
      route();
    });
  };
  $("#pw").focus();
};

// ---------- shell ----------

const TABS = [
  ["prehled", "Přehled"],
  ["barvy", "Barvy"],
  ["napovedy", "Nápovědy"],
  ["otazky", "Otázky"],
] as const;
type Tab = (typeof TABS)[number][0];

const parseHash = () => {
  const [tab, query] = location.hash.slice(1).split("?");
  return { tab: (TABS.some(([t]) => t === tab) ? tab : "prehled") as Tab, params: new URLSearchParams(query) };
};

const shell = (tab: Tab, content: string) => {
  root.innerHTML = `
    <header class="top">
      <h1>Colormind <span>admin</span></h1>
      <nav>${TABS.map(([t, label]) => `<a href="#${t}" class="${t === tab ? "on" : ""}">${label}</a>`).join("")}</nav>
      <button class="ghost" id="logout">Odhlásit</button>
    </header>
    <section class="content">${content}</section>`;
  $("#logout").onclick = () => {
    setToken(null);
    showLogin();
  };
};

// ---------- overview ----------

const hiddenNote = (n: number) => (n === 0 ? "" : `${n} ${n === 1 ? "skrytá" : n <= 4 ? "skryté" : "skrytých"}`);

const stat = (label: string, value: number, note = "") => `<div class="stat panel"><b>${value}</b><span>${label}</span>${note ? `<small>${note}</small>` : ""}</div>`;

const showOverview = async () => {
  const o = await call<AdminOverview>("overview");
  shell(
    "prehled",
    `<div class="stats">
      ${stat("barev v poolu", o.colors, hiddenNote(o.hiddenColors))}
      ${stat("hráčů", o.players)}
      ${stat("tipů", o.guesses)}
      ${stat("nápověd", o.hints, hiddenNote(o.hiddenHints))}
    </div>
    <div class="charts">
      <div class="panel"><h2>Tipy za 7 dní</h2>${barChart(o.days, "guesses", "tipů")}</div>
      <div class="panel"><h2>Nápovědy za 7 dní</h2>${barChart(o.days, "hints", "nápověd")}</div>
    </div>`,
  );
};

// ---------- colours ----------

const trend = (c: AdminColor) => {
  if (c.guessCount < TREND_MIN_GUESSES || c.first5 === null || c.last5 === null) return `<span class="muted">málo dat</span>`;
  const d = c.last5 - c.first5;
  const cls = d > 2 ? "up" : d < -2 ? "down" : "flat";
  const arrow = d > 2 ? "▲" : d < -2 ? "▼" : "▶";
  return `<span class="trend ${cls}" title="Průměr prvních 5 tipů → posledních 5">${c.first5} → ${c.last5} <i aria-hidden="true">${arrow}</i><span class="sr">${d > 0 ? "zlepšení" : d < 0 ? "zhoršení" : "beze změny"}</span></span>`;
};

const colorRow = (c: AdminColor) => `
  <tr class="${c.hidden ? "is-hidden" : ""}" data-id="${c.id}">
    <td><span class="sw" style="background:${c.hex}" title="${c.hex}"></span></td>
    <td><input class="name" value="${esc(c.name)}" maxlength="${MAX_NAME}" aria-label="Jméno barvy" /></td>
    <td class="num">${c.guessCount}</td>
    <td class="num">${c.avgScore ?? "–"}</td>
    <td>${trend(c)}</td>
    <td class="num"><a href="#napovedy?colorId=${c.id}">${c.hintCount}</a></td>
    <td><label class="toggle"><input type="checkbox" class="hide" ${c.hidden ? "checked" : ""} /> skrytá</label></td>
    <td><button class="ghost small detail">Detail</button></td>
  </tr>`;

const colorDetail = (c: AdminColor, points: ScorePoint[], qs: AdminQuestion[]) => `
  <tr class="detail-row"><td colspan="8">
    <div class="detail-grid">
      <div>
        <h3>Skóre tipů v čase</h3>
        ${scoreChart(points)}
        <p class="muted">Objevil hráč <a href="#napovedy?player=${c.discovererId}">${shortId(c.discovererId)}</a> · ${date(c.createdAt)} · ${c.hex}</p>
      </div>
      <form class="qform">
        <h3>Otázky u barvy</h3>
        ${qs
          .map(
            (q) => `<label class="check ${q.active ? "" : "inactive"}"><input type="checkbox" value="${q.id}" ${c.questionIds.includes(q.id) ? "checked" : ""} /> ${esc(q.text)}</label>`,
          )
          .join("")}
        <button class="primary small">Uložit otázky</button>
      </form>
    </div>
  </td></tr>`;

const showColors = async () => {
  const [colors, qs] = await Promise.all([call<AdminColor[]>("colors"), call<AdminQuestion[]>("questions")]);
  shell(
    "barvy",
    colors.length === 0
      ? `<p class="muted">Pool je prázdný.</p>`
      : `<div class="panel table-wrap"><table>
          <thead><tr><th></th><th>Jméno</th><th class="num">Tipů</th><th class="num">Průměr</th><th>Trend (prvních 5 → posledních 5)</th><th class="num">Nápověd</th><th></th><th></th></tr></thead>
          <tbody>${colors.map(colorRow).join("")}</tbody>
        </table></div>`,
  );
  const byId = new Map(colors.map((c) => [c.id, c]));
  $$<HTMLTableRowElement>("tr[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);
    const save = (patch: object, msg: string) => guard(async () => (await call("color", { id, ...patch }), toast(msg)));
    $<HTMLInputElement>(".name", row).onchange = (e) => save({ name: (e.target as HTMLInputElement).value }, "Jméno uloženo");
    $<HTMLInputElement>(".hide", row).onchange = (e) => {
      const hidden = (e.target as HTMLInputElement).checked;
      row.classList.toggle("is-hidden", hidden);
      save({ hidden }, hidden ? "Barva skryta z poolu" : "Barva vrácena do poolu");
    };
    $(".detail", row).onclick = () =>
      guard(async () => {
        const open = row.nextElementSibling?.classList.contains("detail-row");
        $$(".detail-row").forEach((r) => r.remove());
        if (open) return;
        const points = await call<ScorePoint[]>(`scores?colorId=${id}`);
        row.insertAdjacentHTML("afterend", colorDetail(byId.get(id)!, points, qs));
        const form = row.nextElementSibling!.querySelector<HTMLFormElement>(".qform")!;
        form.onsubmit = (e) => {
          e.preventDefault();
          const questionIds = $$<HTMLInputElement>("input:checked", form).map((i) => Number(i.value));
          guard(async () => {
            await call("color", { id, questionIds });
            byId.get(id)!.questionIds = questionIds;
            toast("Otázky uloženy");
          });
        };
      });
  });
};

// ---------- hints ----------

const hintRow = (h: AdminHint) => `
  <tr class="${h.hidden ? "is-hidden" : ""}" data-id="${h.id}">
    <td><a href="#napovedy?colorId=${h.colorId}" class="color-link"><span class="sw" style="background:${h.colorHex}"></span>${esc(h.colorName)}</a></td>
    <td class="muted">${esc(h.question)}</td>
    <td class="hint-text">${esc(h.text)}</td>
    <td class="num">${h.likes}</td>
    <td><a href="#napovedy?player=${h.playerId}" class="mono">${shortId(h.playerId)}</a></td>
    <td class="muted nowrap">${date(h.createdAt)}</td>
    <td><button class="ghost small toggle-hint">${h.hidden ? "Obnovit" : "Skrýt"}</button></td>
  </tr>`;

const showHints = async (params: URLSearchParams) => {
  const query = new URLSearchParams([...params].filter(([k]) => k === "colorId" || k === "player"));
  const [hints, colors] = await Promise.all([call<AdminHint[]>(`hints?${query}`), call<AdminColor[]>("colors")]);
  const colorId = params.get("colorId");
  const player = params.get("player");
  shell(
    "napovedy",
    `<form class="filters" id="filters">
      <label>Barva <select name="colorId"><option value="">všechny</option>${colors
        .map((c) => `<option value="${c.id}" ${String(c.id) === colorId ? "selected" : ""}>${esc(c.name)}</option>`)
        .join("")}</select></label>
      <label>Hráč <input name="player" value="${esc(player ?? "")}" placeholder="celé ID hráče" /></label>
      <button class="ghost small">Filtrovat</button>
      ${colorId || player ? `<a href="#napovedy" class="small">Zrušit filtr</a>` : ""}
    </form>
    ${
      player
        ? `<div class="panel player-bar">Hráč <span class="mono">${esc(player)}</span>
            <button class="ghost small" id="hide-all">Skrýt všechny jeho nápovědy</button>
            <button class="ghost small" id="show-all">Obnovit všechny</button></div>`
        : ""
    }
    ${
      hints.length
        ? `<div class="panel table-wrap"><table>
            <thead><tr><th>Barva</th><th>Otázka</th><th>Nápověda</th><th class="num">👍</th><th>Hráč</th><th>Kdy</th><th></th></tr></thead>
            <tbody>${hints.map(hintRow).join("")}</tbody></table></div>
           <p class="muted">Zobrazeno ${hints.length} nejnovějších${hints.length === 300 ? " (limit)" : ""}.</p>`
        : `<p class="muted">Žádné nápovědy.</p>`
    }`,
  );
  $<HTMLFormElement>("#filters").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    const q = new URLSearchParams([...data].filter(([, v]) => String(v).trim()) as [string, string][]);
    location.hash = `napovedy${q.size ? `?${q}` : ""}`;
  };
  $$<HTMLButtonElement>(".toggle-hint").forEach((btn) => {
    const row = btn.closest("tr")!;
    btn.onclick = () =>
      guard(async () => {
        const hidden = !row.classList.contains("is-hidden");
        await call("hint", { id: Number(row.dataset.id), hidden });
        row.classList.toggle("is-hidden", hidden);
        btn.textContent = hidden ? "Obnovit" : "Skrýt";
      });
  });
  const bulk = (hidden: boolean) =>
    guard(async () => {
      const { changed } = await call<{ changed: number }>("player-hints", { player, hidden });
      toast(`${hidden ? "Skryto" : "Obnoveno"}: ${changed}`);
      showHints(params);
    });
  if (player) {
    $("#hide-all").onclick = () => bulk(true);
    $("#show-all").onclick = () => bulk(false);
  }
};

// ---------- questions ----------

const questionRow = (q: AdminQuestion) => `
  <tr data-id="${q.id}" class="${q.active ? "" : "is-hidden"}">
    <td><input class="qtext" value="${esc(q.text)}" maxlength="${MAX_QUESTION}" aria-label="Text otázky" /></td>
    <td><label class="toggle"><input type="checkbox" class="active" ${q.active ? "checked" : ""} /> aktivní</label></td>
    <td class="num">${q.colorCount}</td>
    <td class="num">${q.hintCount}</td>
    <td><button class="ghost small save">Uložit</button></td>
  </tr>`;

const showQuestions = async () => {
  const qs = await call<AdminQuestion[]>("questions");
  shell(
    "otazky",
    `<p class="muted">Neaktivní otázky se nenabízí u nově objevených barev. U existujících barev zůstávají, dokud je v detailu barvy neodškrtneš.</p>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Otázka</th><th></th><th class="num">Barev</th><th class="num">Nápověd</th><th></th></tr></thead>
      <tbody>${qs.map(questionRow).join("")}</tbody>
    </table></div>
    <form class="panel add-q" id="add-q">
      <label for="new-q">Nová otázka</label>
      <input id="new-q" maxlength="${MAX_QUESTION}" required placeholder="Např. Jaká hudba k té barvě hraje?" />
      <button class="primary small">Přidat</button>
    </form>`,
  );
  $$<HTMLTableRowElement>("tr[data-id]").forEach((row) => {
    $(".save", row).onclick = () =>
      guard(async () => {
        const active = $<HTMLInputElement>(".active", row).checked;
        await call("question", { id: Number(row.dataset.id), text: $<HTMLInputElement>(".qtext", row).value, active });
        row.classList.toggle("is-hidden", !active);
        toast("Otázka uložena");
      });
  });
  $<HTMLFormElement>("#add-q").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      await call("question", { text: $<HTMLInputElement>("#new-q").value, active: true });
      toast("Otázka přidána");
      showQuestions();
    });
  };
};

// ---------- routing ----------

const route = () => {
  if (!token()) return showLogin();
  const { tab, params } = parseHash();
  const screens: Record<Tab, () => Promise<void>> = {
    prehled: showOverview,
    barvy: showColors,
    napovedy: () => showHints(params),
    otazky: showQuestions,
  };
  guard(screens[tab]);
};

window.addEventListener("hashchange", route);
route();
