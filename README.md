# Discord 24/7 Music Bot

Spielt durchgehend Musik in einem Voice-Channel. Quellen:

- **Internet-Radio / direkte Stream-URL** (Icecast/Shoutcast MP3 usw.)
- **YouTube** – Videos, Live-Streams, Playlists oder Suchbegriffe (via `yt-dlp`)

Steuerung per **Slash-Commands** und/oder **Auto-Join beim Start**.
24/7-tauglich: automatischer Reconnect bei Verbindungsabbruch, defekte Tracks
werden übersprungen statt den Stream zu killen.

## Konfiguration

Werte kommen aus `config.json` **oder** Umgebungsvariablen (env überschreibt Datei).
Für lokale Tests reicht `config.json`, für Container/CI nutzt du env-Variablen.

| config.json | Env-Variable | Zweck |
|---|---|---|
| `token` | `DISCORD_TOKEN` | Bot-Token (**geheim**) |
| `clientId` | `DISCORD_CLIENT_ID` | Application ID |
| `guildId` | `DISCORD_GUILD_ID` | Server-ID (gesetzt = Slash-Commands sofort da; leer = global, ~1 h) |
| `defaultVolume` | `DEFAULT_VOLUME` | Start-Lautstärke (0–200) |
| `allowedRoles` | `ALLOWED_ROLES` | Rollen-IDs mit Bot-Zugriff (env: komma-getrennt) |

`config.json` ist `.gitignore`d. Vorlage: `config.example.json`.

### Bot erstellen

[Discord Developer Portal](https://discord.com/developers/applications) → Application
anlegen → **Bot**-Tab → Token. Einladen über **OAuth2 → URL Generator**: Scopes
`bot` + `applications.commands`, Permissions `Connect`, `Speak`, `View Channel`.

## Lokal starten

```bash
cp config.example.json config.json   # Token + clientId eintragen
npm install
npm start
```

## Slash-Commands

| Command | Beschreibung |
|---|---|
| `/play query:<...> [replace]` | Radio-URL, YouTube-Link/Playlist oder Suchbegriff |
| `/join` · `/leave` | Voice-Channel betreten / verlassen |
| `/skip` · `/stop` | Track überspringen / stoppen + Queue leeren |
| `/pause` · `/resume` | Pausieren / Fortsetzen |
| `/volume percent:<0-200>` | Lautstärke |
| `/loop enabled:<bool>` | Queue endlos loopen (für 24/7) |
| `/shuffle enabled:<bool>` | Zufallswiedergabe |
| `/nowplaying` · `/queue` | Aktueller Track / Warteschlange |
| `/autojoin set\|disable\|status` | Auto-Join konfigurieren (s. u.) |

## Auto-Join (24/7-Start)

Bei aktiviertem Auto-Join joint der Bot beim Start automatisch einen festen
Channel und spielt eine feste Quelle. Konfigurierbar **per Befehl** (wird live in
`config.json` gespeichert):

```
/autojoin set channel:#voice source:<URL|YouTube|Suchbegriff> [loop] [shuffle]
/autojoin status
/autojoin disable
```

…oder direkt in `config.json` unter `autoJoin` (s. `config.example.json`).

## Zugriffskontrolle

`allowedRoles` leer → jeder darf. Mit Rollen-IDs → nur Mitglieder mit einer
dieser Rollen (Server-Admins immer, als Sicherheitsnetz). IDs per
Entwicklermodus → Rechtsklick auf die Rolle → „ID kopieren".

## Deployment (Docker)

Das Image enthält Node, curl, python3 und ein frisches `yt-dlp`; `ffmpeg` kommt
aus dem npm-Paket `ffmpeg-static`. Secrets via env, `/autojoin`-Stand in einem
Volume unter `/data`.

```bash
cp .env.example .env        # Token usw. eintragen (.env ist gitignored)
docker compose up -d --build
docker compose logs -f
```

Ohne Compose:

```bash
docker build -t musicbot .
docker run -d --name musicbot --restart unless-stopped \
  -e DISCORD_TOKEN=... -e DISCORD_CLIENT_ID=... -e DISCORD_GUILD_ID=... \
  -v musicbot-data:/data musicbot
```

`restart: unless-stopped` sorgt für echtes 24/7 (übersteht Crashes & Reboots).

## CI/CD (GitHub Actions)

`.github/workflows/ci.yml` definiert zwei Jobs:

1. **lint** (push + PR) – Syntax-Check + Modul-Load
2. **build** (nur push auf `main`) – baut das Image und pusht es in die **GitHub
   Container Registry** `ghcr.io/<owner>/<repo>` (`:latest` + `:sha-<kurz>`)

Keine Secrets nötig — der Build nutzt den eingebauten `GITHUB_TOKEN` (Job-
Permission `packages: write`). Das GHCR-Package ist anfangs privat; in den
Package-Settings auf **public** stellen, wenn jeder es ziehen können soll.

**Deployment** passiert auf dem Zielserver selbst: dort läuft ein Cron, der das
frisch gepushte Image ausrollt:

```bash
cd /opt/sonance && docker compose pull && docker compose up -d
```

Dazu liegt auf dem Server eine `docker-compose.yml` (Image-Default zeigt auf GHCR,
sonst via `MUSICBOT_IMAGE` überschreiben) und eine `.env` mit den Secrets. Bei
**privatem** Package vorher einmalig `docker login ghcr.io` (mit einem PAT,
Scope `read:packages`); bei public entfällt das.

## Technische Hinweise

- **yt-dlp** unter `bin/yt-dlp` (lokal) bzw. im Image frisch geladen. Update:
  `bin/yt-dlp -U`.
- Das statische ffmpeg öffnet **keine** URLs selbst (Segfault in mancher
  Umgebung); Netzwerk-Bytes holt `curl`/`yt-dlp` und pipt sie in ffmpegs stdin.
- Opus-Encoding über das reine JS-Paket `opusscript` (kein Compiler nötig). Auf
  einem Server ist `@discordjs/opus` schneller (benötigt Build-Tools).
