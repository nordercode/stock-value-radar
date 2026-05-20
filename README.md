# Stock Value Radar

Mobile Webapp zur schnellen Aktienbewertung mit Suche nach Ticker oder Firmenname, EUR-Kursdarstellung, Chart-Zeiträumen, Bewertungsbalken und kompakten Kennzahlen.

## Lokal starten

```bash
node server.js
```

Danach im Browser öffnen:

```text
http://localhost:4173
```

## Auf dem Handy im selben WLAN testen

Beim Start zeigt der Server zusätzlich eine Adresse wie diese an:

```text
http://192.168.x.x:4173
```

Diese URL auf dem Smartphone öffnen. Desktop und Smartphone müssen im selben WLAN sein. Falls macOS fragt, den eingehenden Netzwerkzugriff für Node erlauben.

## Öffentlich hosten

Diese App braucht einen kleinen Node-Server für die Finanzdaten. GitHub Pages allein reicht dafür nicht, weil dort nur statische Dateien laufen.

Gute Optionen:

- Render: neues Web Service aus dem GitHub-Repo, Start Command `node server.js`
- Railway: neues Projekt aus dem GitHub-Repo, Start Command `node server.js`
- Fly.io: Node-App deployen, Port aus `PORT` wird automatisch unterstützt

Für GitHub als Code-Quelle:

```bash
git init
git add .
git commit -m "Add stock value radar"
git branch -M main
git remote add origin <dein-github-repo-url>
git push -u origin main
```

