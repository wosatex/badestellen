# Badewasser Berlin & Brandenburg

Wasserqualität der amtlichen Badestellen auf einer klaren Skala. Eine statische Seite plus ein
Skript, das einmal täglich die beiden Behördenquellen holt. Als PWA aufs iPhone installierbar
und danach auch ohne Empfang benutzbar.

```
scripts/build-data.mjs      holt beide Quellen, rechnet, schreibt www/data/badewasser.json
scripts/update.sh           Cron-Wrapper mit Sperre und Log
scripts/lib/badewasser.mjs  Parser und Bewertungslogik
www/                        die Seite, genau dieses Verzeichnis wird ausgeliefert
.github/workflows/          serverlose Alternative über GitHub Actions und Pages
```

Keine Abhängigkeiten, kein Build-Schritt. Nur Node 18 oder neuer für das Update-Skript.

---

## 1. Einrichten

```bash
git clone <dein-repo> /srv/badewasser
cd /srv/badewasser
chmod +x scripts/update.sh
node scripts/build-data.mjs        # erster Abruf, legt www/data/badewasser.json an
```

Prüfen, ob es geklappt hat:

```bash
node -e "const d=require('./www/data/badewasser.json');console.log(d.sites.length,'Badestellen');console.log(d.sources)"
```

Lokal ansehen:

```bash
cd www && python3 -m http.server 8080     # dann http://localhost:8080
```

Service Worker laufen nur über HTTPS oder auf `localhost`. Zum Testen reicht `localhost`,
für das iPhone brauchst du echtes HTTPS.

## 2. Cronjob

```bash
crontab -e
```

```cron
# Badewasserdaten, täglich 6:20 Uhr
20 6 * * * /srv/badewasser/scripts/update.sh
```

Einmal am Tag genügt. Berlin wird alle ein bis zwei Wochen beprobt, Brandenburg alle zwei bis
vier – häufiger abzurufen ändert nichts am Ergebnis und belastet nur fremde Server.

Das Skript ist still, solange alles klappt. Bei einem Fehler schreibt es ins Log und liefert
einen Exit-Code ungleich null, worauf Cron dir eine Mail schickt.

```bash
tail -f /srv/badewasser/update.log
```

**Wichtig:** Fällt eine der beiden Quellen aus, bleiben deren Badestellen aus dem letzten
erfolgreichen Lauf stehen und werden im Kopf der App als veraltet markiert. Eine kaputte
Antwort überschreibt nie gute Daten, geschrieben wird atomar über `rename`.

## 3. Ausliefern

**Caddy** – kümmert sich selbst um das Zertifikat:

```caddyfile
badewasser.deine-domain.de {
    root * /srv/badewasser/www
    file_server
    header /data/*.json Cache-Control "no-cache"
    header /sw.js Cache-Control "no-cache"
    encode gzip zstd
}
```

**nginx**:

```nginx
server {
    server_name badewasser.deine-domain.de;
    root /srv/badewasser/www;
    gzip on;
    gzip_types application/json application/javascript text/css;

    location = /sw.js            { add_header Cache-Control "no-cache"; }
    location /data/              { add_header Cache-Control "no-cache"; }
    location / { try_files $uri $uri/ /index.html; }
    # HTTPS z. B. über certbot
}
```

`sw.js` und die Datendatei dürfen nicht langfristig gecacht werden, sonst bekommst du
Aktualisierungen nie zu sehen.

### Ohne eigenen Server

Nimm den mitgelieferten Workflow: Repo auf GitHub, unter *Settings → Pages* als Quelle
*GitHub Actions* wählen, fertig. Die Action holt die Daten täglich, committet sie und
veröffentlicht `www/` über Pages – inklusive HTTPS. Kostet nichts und braucht keine Maschine.

## 4. Aufs iPhone legen

1. Die Seite in **Safari** öffnen, nicht in Chrome – nur Safari darf auf iOS installieren.
2. Unten auf **Teilen** tippen.
3. **Zum Home-Bildschirm** wählen, Namen bestätigen.

Danach startet sie im Vollbild ohne Adressleiste, mit eigenem Symbol. Beim ersten Start legt
der Service Worker die Seite und die Daten in den Offline-Speicher. Am See funktioniert sie
dann auch ohne Netz und zeigt oben, wie alt der Stand ist.

Nach Änderungen an `index.html`, `app.js`, `app.css` oder den Icons die Zahl in `www/sw.js`
hochzählen (`const VERSION = "v2"`), sonst behalten installierte Geräte die alte Fassung.

---

## Wie die Bewertung entsteht

**Berlin** liefert alle Messwerte der Saison als CSV. Daraus rechnet die App eine Zahl von 0 bis
100: Start bei 100, Abzüge für E. coli und Enterokokken nach der EU-Badegewässerrichtlinie
2006/7/EG, für Chlorophyll a nach den UBA-Leitwerten 40 und 100 µg/l, für geringe Sichttiefe,
coliforme Bakterien und amtliche Warnhinweise. Die amtliche Ampel deckelt das Ergebnis: bei gelb
höchstens 58, bei rot höchstens 25 Punkte. Die Bewertung fällt also nie besser aus als die des
Amts, kann aber schlechter ausfallen – etwa wenn ein grün geführter See 66 µg/l Chlorophyll a
hat.

**Brandenburg** liefert im KML-Export nur Messdatum, Temperatur, Sichttiefe, eine Bemerkung und
die amtliche fünfstufige Beurteilung, aber keine Keimzahlen. Eine vergleichbare Zahl wäre
Scheingenauigkeit, deshalb steht dort die amtliche Einstufung, mit Link auf die Detailseite, wo
die Laborwerte stehen.

Die Skala ist eine Lesehilfe, keine Behördenauskunft.

## Quellen

- Lageso Berlin, [Liste der Badestellen](https://www.berlin.de/lageso/gesundheit/gesundheitsschutz/badegewaesser/liste-der-badestellen/)
  und [Messwerte als CSV](https://www.data.lageso.de/baden/00_History_gesamt/History.csv)
- LAVG Brandenburg, [Badestellenkarte](https://badestellen.brandenburg.de/) und
  [badestellen.kml](https://badestellen.brandenburg.de/web/badestellen/badestellen/-/export/badestellen.kml)

Vor einem öffentlichen Betrieb lohnt ein Blick in die Nutzungsbedingungen beider Anbieter.
Ein Abruf pro Tag ist unauffällig, das macht ein einzelner Besucher der Website auch.
