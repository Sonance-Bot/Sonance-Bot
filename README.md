# Sonance

Monorepo für **Sonance** — einen 24/7-Discord-Musikbot samt zugehöriger Website.

## Projekte

| Ordner | Beschreibung |
|---|---|
| [`bot/`](bot/) | Der Discord-Bot (Node.js, discord.js). Radio-Streams & YouTube, Auto-Join, 24/7-Reconnect. → [bot/README.md](bot/README.md) |
| [`website/`](website/) | Website mit Infos, Deployment-Anleitungen und Wiki. 🚧 In Aufbau. → [website/README.md](website/README.md) |

## Entwicklung

Jedes Projekt ist eigenständig und wird in seinem Unterordner gebaut/betrieben:

```bash
cd bot && npm install && npm start   # Bot lokal starten (Setup s. bot/README.md)
```

CI/CD läuft pro Projekt über eigene GitHub-Actions-Workflows
(`.github/workflows/bot.yml`), die nur bei Änderungen am jeweiligen Ordner triggern.

## Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE) — © 2026 Robin Wolff.
Nutzung, Änderung und Weitergabe nur für **nicht-kommerzielle** Zwecke.
