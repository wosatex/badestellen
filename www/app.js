/* Badewasser Berlin & Brandenburg — Oberfläche.
   Alle Daten kommen fertig gerechnet aus data/badewasser.json,
   das ein Cron-Skript einmal täglich neu schreibt. */

const DATA_URL = "data/badewasser.json";

const BB_LEVELS = {
  1: { label: "Keine Beanstandungen", verb: "Zum Baden gut geeignet", c: "#137360", rank: 88 },
  2: { label: "Beanstandet", verb: "Warnhinweise beachten", c: "#D99A21", rank: 60 },
  3: { label: "Beanstandet", verb: "Empfehlung: nicht baden", c: "#C4652A", rank: 42 },
  4: { label: "Badeverbot", verb: "Zeitweiliges Badeverbot", c: "#A32C2C", rank: 15 },
  5: { label: "Badeverbot", verb: "Dauerhaftes Badeverbot", c: "#7D1F1F", rank: 5 },
};
const BB_UNKNOWN = { label: "Ohne Angabe", verb: "Einstufung nicht im Datensatz", c: "#7E8F97", rank: 55 };
const lvlOf = (l) => BB_LEVELS[l] || BB_UNKNOWN;

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

let DATA = null;
const state = { land: "alle", q: "", sort: "score", issues: false, open: null, geo: null, geoState: "idle" };

/* ------------------------------ Helfer ----------------------------- */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const zoneOf = (key) => (DATA?.zones || []).find((z) => z.key === key) || { label: "Ohne Bewertung", verb: "", c: "#7E8F97" };

function fmtIso(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${+d}. ${MONTHS[+m - 1]} ${y}`;
}
function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso + "T00:00:00Z");
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / 86400000);
}
function ageLabel(d) {
  if (d == null) return "ohne Messdatum";
  if (d <= 0) return "heute gemessen";
  if (d === 1) return "gestern gemessen";
  if (d < 7) return `vor ${d} Tagen gemessen`;
  if (d < 14) return "vor gut einer Woche gemessen";
  if (d < 21) return "vor rund zwei Wochen gemessen";
  return `vor ${Math.floor(d / 7)} Wochen gemessen`;
}
function agoLabel(isoTs) {
  const mins = Math.round((Date.now() - Date.parse(isoTs)) / 60000);
  if (!isFinite(mins)) return "";
  if (mins < 60) return "vor wenigen Minuten geholt";
  const h = Math.round(mins / 60);
  if (h < 24) return `vor ${h} ${h === 1 ? "Stunde" : "Stunden"} geholt`;
  const d = Math.round(h / 24);
  return `vor ${d} ${d === 1 ? "Tag" : "Tagen"} geholt`;
}
function distKm(a, b, c, d) {
  const R = 6371, p = Math.PI / 180;
  const x = (c - a) * p, y = (d - b) * p;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const num = (raw) => {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^([<>])?\s*([\d.,]+)/);
  if (!m) return null;
  const v = parseFloat(m[2].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return isFinite(v) ? v : null;
};

const rankOf = (s) => (s.land === "BE" ? (s.score == null ? -1 : s.score) : lvlOf(s.lvl).rank);
const isIssue = (s) => (s.land === "BE" ? s.score != null && s.score < 70 : s.lvl != null && s.lvl >= 2);

/* -------------------- Blaualgen: Warnung für Hunde ------------------
 * Cyanobakterien (Blaualgen) können für Hunde giftig bis tödlich sein,
 * schon bei Kontakt mit dem Fell oder wenig Schlucken. Ab 10 µg/l
 * Chlorophyll a (Stufe „leicht erhöht") wird deshalb gewarnt, ab
 * 40 µg/l („erhöht"/„stark erhöht") in der stärkeren Farbe. */
const ICO_WARN =
  `<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-1.5px;margin-right:2px">
    <path d="M12 3.3 22.3 20.6H1.7Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
    <line x1="12" y1="9.4" x2="12" y2="14.6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
    <circle cx="12" cy="17.6" r="1.15" fill="currentColor"/>
  </svg>`;
const ICO_PAW =
  `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-2px;margin-right:3px">
    <ellipse cx="12" cy="17" rx="6.3" ry="5.2" fill="currentColor"/>
    <circle cx="5.1" cy="8.7" r="2.55" fill="currentColor"/>
    <circle cx="10.6" cy="5.3" r="2.65" fill="currentColor"/>
    <circle cx="16.4" cy="6.2" r="2.55" fill="currentColor"/>
    <circle cx="20.3" cy="10.7" r="2.25" fill="currentColor"/>
  </svg>`;

function dogRisk(chla) {
  if (chla == null || !isFinite(chla)) return null;
  if (chla >= 40) return { cls: "bad", c: "#A32C2C", bg: "#FBECEC", bd: "#E2B4B4" };
  if (chla >= 10) return { cls: "mid", c: "#8A6414", bg: "#FBF2E2", bd: "#E0C79A" };
  return null;
}
function dogTag(chla) {
  const r = dogRisk(chla);
  if (!r) return "";
  return `<span class="tag dogtag ${r.cls}" title="Blaualgen können für Hunde giftig sein">${ICO_WARN}${ICO_PAW}Hunde</span>`;
}
function dogNotice(chla) {
  const r = dogRisk(chla);
  if (!r) return "";
  return `<p class="notice dognotice ${r.cls}">
    <strong>${ICO_WARN}${ICO_PAW}Für Hunde giftig:</strong> Blaualgen (Cyanobakterien) können bei Hunden schon durch
    Schlecken am Fell oder wenig Schlucken zu schweren Vergiftungen führen. Tiere hier nicht schwimmen oder trinken
    lassen und das Fell danach gründlich abspülen.
  </p>`;
}

/* ------------------------------ Laden ------------------------------ */

async function load() {
  const btn = $("refresh");
  btn.disabled = true;
  btn.textContent = "lädt …";
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json.sites || !json.sites.length) throw new Error("leerer Datensatz");
    DATA = json;
    render();
  } catch (e) {
    if (!DATA) {
      $("stand").textContent = "Keine Daten verfügbar.";
      $("banners").innerHTML =
        `<p class="banner bad">Die Datendatei konnte nicht geladen werden${navigator.onLine ? "" : " und das Gerät ist offline"}.
         Wenn die App neu eingerichtet wurde, muss das Update-Skript einmal gelaufen sein.</p>`;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Aktualisieren";
  }
}

/* ---------------------------- Darstellung -------------------------- */

function render() {
  if (!DATA) return;
  renderHead();
  renderLands();
  renderHero();
  renderChips();
  renderList();
  renderQuellen();
}

function renderHead() {
  const be = DATA.sources.berlin, bb = DATA.sources.brandenburg;
  $("stand").textContent =
    `Berlin: Probe ${fmtIso(be.latest) || "–"} · ${be.count} Stellen — ` +
    `Brandenburg: Probe ${fmtIso(bb.latest) || "–"} · ${bb.count} Stellen — ` +
    agoLabel(DATA.generatedAt);

  const b = [];
  const stale = Math.round((Date.now() - Date.parse(DATA.generatedAt)) / 86400000);
  if (stale >= 2) b.push(`<p class="banner">Der letzte erfolgreiche Abruf ist ${stale} Tage her. Läuft der Cronjob noch?</p>`);
  if (be.note) b.push(`<p class="banner">Berlin: ${esc(be.note)}</p>`);
  if (bb.note) b.push(`<p class="banner">Brandenburg: ${esc(bb.note)}</p>`);
  if (!bb.count) b.push(`<p class="banner">Für Brandenburg liegen noch keine Daten vor. Das Update-Skript einmal laufen lassen.</p>`);
  $("banners").innerHTML = b.join("");
}

function renderLands() {
  const n = (l) => (l === "alle" ? DATA.sites.length : DATA.sites.filter((s) => s.land === l).length);
  $("lands").innerHTML = [["alle", "Beide"], ["BE", "Berlin"], ["BB", "Brandenburg"]]
    .map(([k, l]) => `<button type="button" class="land${state.land === k ? " on" : ""}" data-land="${k}">${l}<span class="land-n">${n(k)}</span></button>`)
    .join("");
}

function renderHero() {
  const scope = DATA.sites.filter((s) => state.land === "alle" || s.land === state.land);
  const be = scope.filter((s) => s.land === "BE");
  const bb = scope.filter((s) => s.land === "BB");
  const beFine = be.filter((s) => s.score != null && s.score >= 70).length;
  const bbFine = bb.filter((s) => s.lvl === 1).length;
  const probs = scope.filter(isIssue).sort((a, b2) => rankOf(a) - rankOf(b2));

  let h = `<p class="lede">`;
  if (be.length) h += `<strong>${beFine}</strong> von ${be.length} Berliner Badestellen sind unbedenklich. `;
  if (bb.length) h += `<strong>${bbFine}</strong> von ${bb.length} Brandenburger Badestellen sind ohne Beanstandung.`;
  h += `</p>`;

  if (be.length) {
    const bins = new Array(20).fill(0);
    for (const s of be) if (s.score != null) bins[Math.min(19, Math.floor(s.score / 5))]++;
    const max = Math.max(1, ...bins);
    const colAt = (v) => zoneOf((DATA.zones.slice().reverse().find((z) => v >= z.from) || DATA.zones[0]).key).c;
    h += `<div class="scale">
      <p class="scale-cap">Berechnete Bewertung, Berlin</p>
      <div class="scale-hist" aria-hidden="true">${bins.map((n2, i) =>
        `<span style="height:${(n2 / max) * 100}%;background:${colAt(i * 5 + 2)};opacity:${n2 ? .9 : 0}"></span>`).join("")}</div>
      <div class="scale-bar">${DATA.zones.map((z) =>
        `<div class="scale-seg" style="flex-grow:${z.to - z.from};background:${z.c}"><b>${z.label}</b></div>`).join("")}</div>
      <div class="scale-ticks">${[0, 35, 55, 70, 85, 100].map((t) =>
        `<span style="left:${t}%">${t}</span>`).join("")}</div>
    </div>`;
  }

  if (bb.length) {
    const parts = [1, 2, 3, 4, 5].map((l) => ({ l, n: bb.filter((s) => s.lvl === l).length })).filter((p) => p.n);
    const ohne = bb.filter((s) => !s.lvl).length;
    h += `<div class="bbscale">
      <p class="scale-cap">Amtliche Beurteilung, Brandenburg</p>
      <div class="bbbars">${parts.map((p) =>
        `<div class="bbbar" style="flex-grow:${p.n}"><i style="background:${lvlOf(p.l).c}"></i><span><b>${p.n}</b>${esc(lvlOf(p.l).verb)}</span></div>`).join("")}
        ${ohne ? `<div class="bbbar" style="flex-grow:${ohne}"><i style="background:${BB_UNKNOWN.c}"></i><span><b>${ohne}</b>ohne Angabe</span></div>` : ""}
      </div>
      <p class="bbnote">Der Brandenburger Datensatz enthält keine Keimzahlen. Deshalb steht hier die amtliche Einstufung statt einer berechneten Zahl.</p>
    </div>`;
  }

  if (probs.length) {
    h += `<div class="probs"><h2>Heute auffällig</h2><div class="probs-list">${probs.slice(0, 12).map((p) => {
      const c = p.land === "BE" ? zoneOf(p.zone).c : lvlOf(p.lvl).c;
      const why = p.land === "BE" ? (p.reasons[0]?.t || zoneOf(p.zone).verb) : (p.bem || lvlOf(p.lvl).verb);
      return `<button type="button" class="prob" data-jump="${esc(p.id)}">
        <i style="background:${c}">${p.land === "BE" ? p.score : "BB"}</i>
        <span><u>${esc(p.name)}</u><s>${esc(why)}</s></span></button>`;
    }).join("")}</div></div>`;
  }

  h += `<p class="disclaim">Für Berlin rechnet die App die amtlichen Messwerte in eine Skala von 0 bis 100 um – das ist
        keine Behördennote. Für Brandenburg wird die amtliche Einstufung unverändert übernommen.
        Details <a href="#methode">unten</a>.</p>`;

  $("hero").innerHTML = h;
}

function renderChips() {
  const sorts = [["score","Beste zuerst"],["worst","Schlechteste zuerst"],["clear","Klarstes Wasser"],["temp","Wärmstes Wasser"],["name","A–Z"]];
  const near = state.geoState === "asking" ? "sucht Standort …" : state.geo ? "Nächste zuerst" : "In meiner Nähe";
  $("chips").innerHTML =
    sorts.map(([k, l]) => `<button type="button" class="chip${state.sort === k ? " on" : ""}" data-sort="${k}">${l}</button>`).join("") +
    `<button type="button" class="chip${state.sort === "dist" ? " on" : ""}" data-near="1">${near}</button>` +
    `<button type="button" class="chip alt${state.issues ? " on" : ""}" data-issues="1">Nur Auffälligkeiten</button>`;
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = DATA.sites.filter((s) => {
    if (state.land !== "alle" && s.land !== state.land) return false;
    if (state.issues && !isIssue(s)) return false;
    if (!q) return true;
    return (s.name + " " + (s.gew || "")).toLowerCase().includes(q);
  });
  if (state.geo) list = list.map((s) => ({ ...s, dist: s.lat != null ? distKm(state.geo.lat, state.geo.lon, s.lat, s.lon) : null }));
  const byName = (a, b) => a.name.localeCompare(b.name, "de");
  const t = (s) => num(s.land === "BE" ? s.values.temp : s.temp) ?? -99;
  const st = (s) => s.sichtM ?? -1;
  if (state.sort === "score") list.sort((a, b) => rankOf(b) - rankOf(a) || byName(a, b));
  else if (state.sort === "worst") list.sort((a, b) => rankOf(a) - rankOf(b) || byName(a, b));
  else if (state.sort === "name") list.sort(byName);
  else if (state.sort === "temp") list.sort((a, b) => t(b) - t(a) || byName(a, b));
  else if (state.sort === "clear") list.sort((a, b) => st(b) - st(a) || byName(a, b));
  else if (state.sort === "dist") list.sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9));
  return list;
}

function renderList() {
  const list = visible();
  if (!list.length) {
    $("list").innerHTML = `<p class="empty">Keine Badestelle gefunden. <button type="button" class="linky" data-reset="1">Filter zurücksetzen</button></p>`;
    return;
  }
  $("list").innerHTML = list.map((s) => (s.land === "BE" ? cardBE(s) : cardBB(s))).join("");
}

/* ------------------------------ Karten ----------------------------- */

function metaTags(s, extra) {
  const d = daysSince(s.date);
  const t = num(s.land === "BE" ? s.values.temp : s.temp);
  const staleAfter = s.land === "BE" ? 20 : 32;
  return `<span class="card-meta">
    <span class="tag ${s.land === "BE" ? "be" : "bb"}">${s.land === "BE" ? "Berlin" : "Brandenburg"}</span>
    <span class="tag${d != null && d > staleAfter ? " stale" : ""}">${ageLabel(d)}</span>
    ${t != null ? `<span class="tag temp">${String(t).replace(".", ",")} °C</span>` : ""}
    ${extra || ""}</span>`;
}

function cardBE(s) {
  const z = zoneOf(s.zone);
  const open = state.open === s.id;
  return `<article class="card" data-id="${esc(s.id)}" style="--zone:${z.c}">
    <button type="button" class="card-head" data-toggle="${esc(s.id)}" aria-expanded="${open}">
      <span class="score" style="color:${z.c}">${s.score == null ? "–" : s.score}</span>
      <span class="card-main">
        <span class="card-name">${esc(s.name)}</span>
        <span class="card-sub">${esc(s.gew)}${s.dist != null ? ` · ${s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist)} km` : ""}</span>
        <span class="card-bar"><i style="width:${s.score ?? 0}%;background:${z.c}"></i></span>
        <span class="card-verdict tight"><strong style="color:${z.c}">${z.label}</strong> · ${esc(s.reasons[0]?.t || z.verb)}</span>
        ${metaTags(s, `${s.capped ? `<span class="tag capped">Amt: ${esc(s.color)}</span>` : ""}${s.warn ? `<span class="tag alarm">Warnhinweis</span>` : ""}${dogTag(num(s.values.chla))}`)}
      </span>
      <span class="chev" aria-hidden="true">${open ? "–" : "+"}</span>
    </button>
    ${open ? bodyBE(s) : ""}</article>`;
}

const OK = { l: "unauffällig", c: "#137360" }, MID = { l: "leicht erhöht", c: "#D99A21" };
const BAD = { l: "erhöht", c: "#C4652A" }, WORST = { l: "stark erhöht", c: "#A32C2C" }, NA = { l: "nicht gemessen", c: "#7E8F97" };

function metric(label, raw, unit, st, note, fill) {
  return `<div class="metric">
    <div class="m-head"><span class="m-label">${label}</span>
      <span class="m-value">${esc(raw || "–")}${unit ? `<em> ${unit}</em>` : ""}</span></div>
    <div class="m-track"><i style="width:${Math.max(2, Math.min(100, fill))}%;background:${st.c}"></i></div>
    <div class="m-note"><strong style="color:${st.c}">${st.l}</strong>${note ? ` · ${note}` : ""}</div>
  </div>`;
}

function secchi(raw, m) {
  const pct = m == null ? null : (Math.min(m, 3) / 3) * 100;
  return `<div class="secchi">
    <div class="secchi-col"><u style="top:33.3%"></u><u style="top:66.6%"></u>
      ${pct != null ? `<i style="top:${pct}%"></i>` : ""}</div>
    <div class="secchi-scale"><span>0 m</span><span>1</span><span>2</span><span>3+</span></div>
    <div class="secchi-val">${raw ? esc(raw) + (/m$/.test(raw) ? "" : " m") : "keine Angabe"}</div></div>`;
}

function sparkline(history) {
  const pts = (history || []).filter((h) => h.s != null);
  if (pts.length < 3) return "";
  const W = 260, H = 46;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * (W - 6) + 3);
  const ys = pts.map((p) => H - 5 - (p.s / 100) * (H - 12));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const y85 = H - 5 - 0.85 * (H - 12);
  const colAt = (v) => zoneOf((DATA.zones.slice().reverse().find((z) => v >= z.from) || DATA.zones[0]).key).c;
  return `<div class="spark">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Verlauf der Bewertung über die Saison">
      <line class="spark-ref" x1="0" y1="${y85}" x2="${W}" y2="${y85}"></line>
      <path class="spark-line" d="${d}"></path>
      ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="${i === xs.length - 1 ? 3.2 : 1.8}" fill="${colAt(pts[i].s)}"></circle>`).join("")}
    </svg>
    <div class="spark-cap"><span>${fmtIso(pts[0].d).replace(/ \d{4}$/, "")}</span>
      <span>Saisonverlauf · gestrichelt = Grenze „Sehr gut“</span>
      <span>${fmtIso(pts[pts.length - 1].d).replace(/ \d{4}$/, "")}</span></div></div>`;
}

function bodyBE(s) {
  const v = s.values, n = (x) => num(x);
  const ec = n(v.ecoli), ie = n(v.entero), cb = n(v.colif), ch = n(v.chla);
  return `<div class="card-body">
    ${s.warn ? `<p class="notice alarm"><strong>Warnhinweis des Lageso:</strong> ${esc(s.warn)}</p>` : ""}
    ${s.info ? `<p class="notice"><strong>Hinweis:</strong> ${esc(s.info)}</p>` : ""}
    ${dogNotice(ch)}
    <div class="metrics">
      ${metric("E. coli", v.ecoli, "KBE/100 ml",
        ec == null ? NA : ec > 1000 ? WORST : ec > 500 ? BAD : ec > 100 ? MID : OK,
        "Fäkalkeim. EU-Grenze für „ausreichend“: 900",
        ec == null ? 0 : (Math.log10(Math.max(ec, 10)) / Math.log10(2000)) * 100)}
      ${metric("Intestinale Enterokokken", v.entero, "KBE/100 ml",
        ie == null ? NA : ie > 400 ? WORST : ie > 200 ? BAD : ie > 50 ? MID : OK,
        "Fäkalkeim. EU-Grenze für „ausreichend“: 330",
        ie == null ? 0 : (Math.log10(Math.max(ie, 10)) / Math.log10(800)) * 100)}
      ${metric("Blaualgen (Chlorophyll a)", v.chla, "µg/l",
        ch == null ? NA : ch >= 100 ? WORST : ch >= 40 ? BAD : ch >= 10 ? MID : OK,
        "UBA-Leitwerte: ab 40 auffällig, ab 100 kritisch",
        ch == null ? 0 : (ch / 130) * 100)}
      ${metric("Coliforme Bakterien", v.colif, "KBE/100 ml",
        cb == null ? NA : cb > 5000 ? BAD : cb > 1000 ? MID : OK,
        "Zusatzindikator, nicht in der EU-Richtlinie",
        cb == null ? 0 : (Math.log10(Math.max(cb, 100)) / Math.log10(10000)) * 100)}
    </div>
    <div class="sight"><div class="sight-txt"><h3>Sichttiefe</h3>
      <p>Wie tief die weiße Scheibe noch zu sehen ist. Unter 1 m wird die Wasserrettung schwierig, unter 0,5 m rät das Lageso vom Schwimmen ab.</p>
      </div>${secchi(v.sicht, s.sichtM)}</div>
    ${s.reasons.length ? `<div class="why"><h3>Was die Bewertung drückt</h3>
      <ul>${s.reasons.map((r) => `<li><b>−${r.w}</b> ${esc(r.t)}</li>`).join("")}</ul>
      ${s.capped ? `<p class="why-cap">Das Lageso führt diese Stelle als <strong>${esc(s.color)}</strong>. Die Bewertung wird deshalb gedeckelt.</p>` : ""}
      </div>` : ""}
    ${sparkline(s.history)}
    <a class="src" href="${esc(s.url)}" target="_blank" rel="noreferrer">Badestellen-Seite des Lageso ↗</a>
  </div>`;
}

function cardBB(s) {
  const z = lvlOf(s.lvl);
  const open = state.open === s.id;
  const mark = s.lvl === 1
    ? `<path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="${z.c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : s.lvl >= 4
    ? `<path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="${z.c}" stroke-width="2.5" stroke-linecap="round"/>`
    : `<path d="M12 7v6.5M12 16.5v.6" stroke="${z.c}" stroke-width="2.5" stroke-linecap="round"/>`;
  return `<article class="card" data-id="${esc(s.id)}" style="--zone:${z.c}">
    <button type="button" class="card-head" data-toggle="${esc(s.id)}" aria-expanded="${open}">
      <span class="score bb" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26">
        <circle cx="12" cy="12" r="9" fill="none" stroke="${z.c}" stroke-width="2.5"/>${mark}</svg></span>
      <span class="card-main">
        <span class="card-name">${esc(s.name)}</span>
        <span class="card-sub">${esc(s.gew || "Brandenburg")}${s.dist != null ? ` · ${s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist)} km` : ""}</span>
        <span class="card-verdict"><strong style="color:${z.c}">${z.label}</strong> · ${z.verb}</span>
        ${metaTags(s, `${s.sichtM != null && s.sichtM < 1 ? `<span class="tag capped">Sicht unter 1 m</span>` : ""}${s.bem ? `<span class="tag alarm">Bemerkung</span>` : ""}`)}
      </span>
      <span class="chev" aria-hidden="true">${open ? "–" : "+"}</span>
    </button>
    ${open ? bodyBB(s) : ""}</article>`;
}

function bodyBB(s) {
  const z = lvlOf(s.lvl);
  return `<div class="card-body">
    ${s.bem ? `<p class="notice${s.lvl >= 2 ? " alarm" : ""}"><strong>Bemerkung des Gesundheitsamts:</strong> ${esc(s.bem)}</p>` : ""}
    <p class="notice"><strong>Amtliche Beurteilung:</strong> ${z.verb}.</p>
    <div class="kv">
      <div><b>Messung</b><span>${fmtIso(s.date) || "keine Angabe"}</span></div>
      <div><b>Wassertemperatur</b><span>${esc(s.temp || "keine Angabe")}</span></div>
      <div><b>Sichttiefe</b><span>${esc(s.sicht || "keine Angabe")}</span></div>
    </div>
    ${s.sichtM != null ? `<div class="sight"><div class="sight-txt"><h3>Sichttiefe</h3>
      <p>Unter 1 m wird die Wasserrettung schwierig. Das Gesundheitsamt weist dann meist gesondert darauf hin.</p>
      </div>${secchi(s.sicht, s.sichtM)}</div>` : ""}
    <p class="gap">Keimzahlen für E. coli und Enterokokken stehen nicht im Brandenburger Datensatz. Sie finden sich auf
       der Detailseite der Badestelle, zusammen mit dem Badegewässerprofil.</p>
    <a class="src" href="${esc(s.url)}" target="_blank" rel="noreferrer">Messwerte beim LAVG ansehen ↗</a>
  </div>`;
}

function renderQuellen() {
  const be = DATA.sources.berlin, bb = DATA.sources.brandenburg;
  $("quellen").innerHTML =
    `Quellen: <a href="${esc(be.seite)}" target="_blank" rel="noreferrer">Lageso Berlin, Liste der Badestellen</a> ·
     <a href="${esc(be.url)}" target="_blank" rel="noreferrer">Messwerte als CSV</a> ·
     <a href="${esc(bb.seite)}" target="_blank" rel="noreferrer">LAVG Brandenburg, Badestellenkarte</a> ·
     <a href="${esc(bb.url)}" target="_blank" rel="noreferrer">badestellen.kml</a>`;
}

/* ----------------------------- Bedienung --------------------------- */

document.addEventListener("click", (e) => {
  const t = (sel) => e.target.closest(sel);
  let el;
  if ((el = t("[data-land]"))) { state.land = el.dataset.land; render(); }
  else if ((el = t("[data-sort]"))) { state.sort = el.dataset.sort; renderChips(); renderList(); }
  else if (t("[data-issues]")) { state.issues = !state.issues; renderChips(); renderList(); }
  else if (t("[data-near]")) { askGeo(); }
  else if (t("[data-reset]")) { state.q = ""; state.issues = false; state.land = "alle"; $("search").value = ""; render(); }
  else if ((el = t("[data-toggle]"))) {
    state.open = state.open === el.dataset.toggle ? null : el.dataset.toggle;
    renderList();
  } else if ((el = t("[data-jump]"))) {
    const id = el.dataset.jump;
    state.q = ""; state.issues = false; $("search").value = "";
    state.open = id; renderList();
    const safe = (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
    const card = document.querySelector(`.card[data-id="${safe}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("flash");
      setTimeout(() => card.classList.remove("flash"), 2300);
    }
  }
});

$("search").addEventListener("input", (e) => { state.q = e.target.value; renderList(); });
$("refresh").addEventListener("click", load);

function askGeo() {
  if (state.geo) { state.sort = "dist"; renderChips(); renderList(); return; }
  if (!navigator.geolocation) return fail();
  state.geoState = "asking"; renderChips();
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.geo = { lat: p.coords.latitude, lon: p.coords.longitude };
        state.geoState = "ok"; state.sort = "dist";
        $("hint").hidden = true;
        renderChips(); renderList();
      },
      fail, { timeout: 8000, maximumAge: 300000 }
    );
  } catch { fail(); }
  function fail() {
    state.geoState = "nope"; renderChips();
    const h = $("hint");
    h.textContent = "Standort nicht verfügbar. Die anderen Sortierungen funktionieren weiterhin.";
    h.hidden = false;
  }
}

/* ---------------------- Homescreen-Hinweis (iOS) ------------------- */

(function iosTip() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  let hidden = false;
  try { hidden = localStorage.getItem("bw-tip") === "1"; } catch {}
  if (isIos && !standalone && !hidden) {
    const tip = $("iosTip");
    tip.hidden = false;
    $("iosTipClose").addEventListener("click", () => {
      tip.hidden = true;
      try { localStorage.setItem("bw-tip", "1"); } catch {}
    });
  }
})();

/* --------------------------- Service Worker ------------------------ */

if ("serviceWorker" in navigator) {
  // Verhindert, dass ein einmal installierter Service Worker eine veraltete
  // sw.js/app.css/app.js aus dem HTTP-Cache weiterverwendet, und lädt die
  // Seite automatisch einmal neu, sobald eine neue Version übernommen hat.
  let refreshed = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshed) return;
    refreshed = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  });
}

$("list").innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton"></div>`).join("");
load();
