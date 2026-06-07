# Sonance

24/7-Discord-Musikbot — spielt durchgehend Musik in einem Voice-Channel
(Radio-Streams & YouTube, Auto-Join, automatischer Reconnect).

Der Bot-Code liegt in **[`bot/`](bot/)** → Setup & Doku: [bot/README.md](bot/README.md).

```bash
cd bot && npm install && npm start
```

CI/CD baut das Docker-Image bei Änderungen unter `bot/` und pusht es nach GHCR
(`.github/workflows/bot.yml`).

## Website

Die Website (Infos, Deployment-Anleitungen, Wiki) ist ein eigenes Projekt:
**[Sonance-Bot/sonance-website](https://github.com/Sonance-Bot/sonance-website)**.

## Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE) — © 2026 Robin Wolff.
Nutzung, Änderung und Weitergabe nur für **nicht-kommerzielle** Zwecke.
