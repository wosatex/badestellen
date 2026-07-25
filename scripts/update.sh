#!/usr/bin/env bash
# Badewasser — täglicher Datenabruf.
# In die Crontab: siehe README. Das Skript ist absichtlich still,
# solange alles klappt, damit Cron keine Mails verschickt.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${BADEWASSER_LOG:-$HERE/update.log}"
LOCK="${BADEWASSER_LOCK:-$HERE/.update.lock}"
OUT="${BADEWASSER_OUT:-$HERE/www/data/badewasser.json}"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -Is) Ein Lauf ist noch aktiv, übersprungen." >>"$LOG"
  exit 0
fi

# Log bei 1 MB rotieren, damit die Datei nicht wächst
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ]; then
  mv "$LOG" "$LOG.1"
fi

if node "$HERE/scripts/build-data.mjs" --out "$OUT" >>"$LOG" 2>&1; then
  exit 0
else
  code=$?
  echo "$(date -Is) FEHLGESCHLAGEN mit Code $code" >>"$LOG"
  # Cron meldet den Fehler per Mail, die alte Datei bleibt unangetastet
  exit "$code"
fi
