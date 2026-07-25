#!/usr/bin/env node
/**
 * Holt beide amtlichen Quellen, rechnet sie um und schreibt www/data/badewasser.json.
 * Läuft ohne Abhängigkeiten auf Node 18 oder neuer.
 *
 *   node scripts/build-data.mjs
 *   node scripts/build-data.mjs --out /pfad/zu/www/data/badewasser.json
 *   node scripts/build-data.mjs --berlin-file ./History.csv --brandenburg-file ./badestellen.kml
 *
 * Grundregel: Eine kaputte Antwort darf gute Daten nie überschreiben.
 * Fällt eine Quelle aus, bleiben deren Badestellen aus dem letzten Lauf stehen.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BE_CSV_URL, BB_KML_URL, BE_SEITE, BB_SEITE, ZONES,
  buildBerlinSites, buildBrandenburgSites,
} from "./lib/badewasser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const OUT = resolve(arg("--out") || resolve(ROOT, "www/data/badewasser.json"));
const BE_FILE = arg("--berlin-file");
const BB_FILE = arg("--brandenburg-file");
const TIMEOUT = +(arg("--timeout") || 25000);
const UA = "badewasser-pwa/1.0 (privates Projekt; liest oeffentliche Badegewaesserdaten)";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), "WARN", ...a);

async function grab(url, file) {
  if (file) return readFile(resolve(file), "utf8");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 500) throw new Error(`nur ${text.length} Bytes`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function previous() {
  try {
    if (!existsSync(OUT)) return null;
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return null;
  }
}

const newest = (sites) => sites.reduce((a, s) => (s.date && s.date > a ? s.date : a), "");

async function main() {
  const prev = await previous();
  const prevOf = (land) => (prev?.sites || []).filter((s) => s.land === land);

  let berlin = null, brandenburg = null;
  const status = {
    berlin: { ok: false, url: BE_CSV_URL, seite: BE_SEITE, count: 0, latest: "", note: "" },
    brandenburg: { ok: false, url: BB_KML_URL, seite: BB_SEITE, count: 0, latest: "", note: "" },
  };

  try {
    const raw = await grab(BE_CSV_URL, BE_FILE);
    berlin = buildBerlinSites(raw);
    status.berlin = { ...status.berlin, ok: true, count: berlin.length, latest: newest(berlin) };
    log(`Berlin: ${berlin.length} Badestellen, jüngste Probe ${status.berlin.latest}`);
  } catch (e) {
    warn("Berlin fehlgeschlagen:", e.message);
    berlin = prevOf("BE");
    status.berlin.note = `Abruf fehlgeschlagen (${e.message}), Stand vom letzten Lauf`;
    status.berlin.count = berlin.length;
    status.berlin.latest = newest(berlin);
    status.berlin.stale = true;
  }

  try {
    const raw = await grab(BB_KML_URL, BB_FILE);
    brandenburg = buildBrandenburgSites(raw);
    status.brandenburg = { ...status.brandenburg, ok: true, count: brandenburg.length, latest: newest(brandenburg) };
    log(`Brandenburg: ${brandenburg.length} Badestellen, jüngste Probe ${status.brandenburg.latest || "ohne Datum"}`);
  } catch (e) {
    warn("Brandenburg fehlgeschlagen:", e.message);
    brandenburg = prevOf("BB");
    status.brandenburg.note = `Abruf fehlgeschlagen (${e.message}), Stand vom letzten Lauf`;
    status.brandenburg.count = brandenburg.length;
    status.brandenburg.latest = newest(brandenburg);
    status.brandenburg.stale = true;
  }

  const sites = [...berlin, ...brandenburg];
  if (!sites.length) {
    warn("Beide Quellen leer und kein alter Stand vorhanden. Es wird nichts geschrieben.");
    process.exit(1);
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: status,
    zones: ZONES,
    sites,
  };

  const json = JSON.stringify(payload);
  await mkdir(dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, json, "utf8");
  await rename(tmp, OUT); // atomar, der Server sieht nie eine halbe Datei
  log(`geschrieben: ${OUT} (${sites.length} Badestellen, ${(json.length / 1024).toFixed(0)} KB)`);

  if (status.berlin.stale || status.brandenburg.stale) {
    warn("Mindestens eine Quelle war nicht erreichbar, alte Daten wurden übernommen.");
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "FEHLER", e);
  process.exit(1);
});
