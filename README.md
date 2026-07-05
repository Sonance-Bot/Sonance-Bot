# Sonance

**24/7-Discord-Musikbot** — spielt durchgehend Musik in einem Voice-Channel:
Internet-Radio-Streams und YouTube (Videos, Playlists, Suche), mit Auto-Join beim
Start und automatischem Reconnect. Steuerung per Slash-Commands.

- 🎧 **Quellen:** Icecast/Shoutcast-Streams, direkte MP3-URLs, YouTube (via `yt-dlp`)
- ♾️ **24/7-tauglich:** Auto-Join beim Start, Reconnect bei Abbruch, defekte Tracks
  werden übersprungen statt den Stream zu killen
- 🐳 **Ein Container:** fertiges Image auf GHCR — keine Build-Tools nötig
- 🔒 **Zugriffskontrolle** per Discord-Rollen

---

## Selfhosting in 3 Schritten (Docker)

Du brauchst nur **Docker** und einen **Discord-Bot-Token**.

### 1 · Discord-Bot anlegen

Im [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application** anlegen.
2. Tab **Bot** → **Reset Token** → Token kopieren (das ist dein `token`, geheim halten).
3. Die **Application ID** (Tab *General Information*) ist dein `clientId`.
4. Tab **OAuth2 → URL Generator**: Scopes `bot` + `applications.commands`,
   Permissions `View Channel`, `Connect`, `Speak`. Die generierte URL öffnen und den
   Bot auf deinen Server einladen.

### 2 · Konfigurieren

Leg dir neben dem Container eine `config.json` an (Vorlage:
[`bot/config.example.json`](bot/config.example.json)):

```json
{
  "token": "DEIN_BOT_TOKEN",
  "clientId": "DEINE_APPLICATION_ID",
  "guildId": "DEINE_SERVER_ID",

  "autoJoin": {
    "enabled": true,
    "guildId": "DEINE_SERVER_ID",
    "channelId": "DEINE_VOICE_CHANNEL_ID",
    "source": { "query": "http://ice1.somafm.com/fluid-128-mp3", "loop": true, "shuffle": false }
  },

  "defaultVolume": 100,
  "allowedRoles": []
}
```

> **IDs kopieren:** Discord → Einstellungen → *Erweitert* → **Entwicklermodus** an,
> dann Rechtsklick auf Server / Channel / Rolle → „ID kopieren".
> `guildId` gesetzt = Slash-Commands sind sofort verfügbar (leer = global, ~1 h Propagation).
> `autoJoin.enabled: true` = der Bot betritt beim Start automatisch den Channel und
> spielt die `source` (perfekt für 24/7). `allowedRoles: []` = jeder darf steuern.

### 3 · Starten

```bash
docker run -d --name sonance --restart unless-stopped \
  -v "$PWD/config.json:/data/config.json" \
  ghcr.io/sonance-bot/sonance-bot:latest

docker logs -f sonance      # "Eingeloggt als …" = läuft
```

Das Image ist **public** — kein `docker login` und kein Build nötig.
`--restart unless-stopped` sorgt für echtes 24/7 (übersteht Crashes **und** Server-Reboots).

<details>
<summary><b>Alternative: docker compose</b> (Secrets via <code>.env</code> statt config.json)</summary>

In [`bot/`](bot/) liegt eine fertige `docker-compose.yml`:

```bash
cd bot
cp .env.example .env        # DISCORD_TOKEN + DISCORD_CLIENT_ID eintragen
docker compose up -d
docker compose logs -f
```

Auto-Join setzt du hier per Slash-Command live (siehe unten) — es wird im Volume
`sonance-data:/data` persistiert.
</details>

---

## Bedienung (Slash-Commands)

| Command | Wirkung |
|---|---|
| `/play query:<URL\|YouTube\|Suchbegriff> [replace]` | Stream/Track abspielen bzw. an die Queue hängen (`replace:true` ersetzt die Queue) |
| `/join` · `/leave` | Voice-Channel betreten / verlassen |
| `/skip` · `/stop` | Track überspringen / stoppen + Queue leeren |
| `/pause` · `/resume` | Pausieren / fortsetzen |
| `/volume percent:<0–200>` | Lautstärke setzen |
| `/loop enabled:<bool>` · `/shuffle enabled:<bool>` | Endlos-Loop (24/7) / Zufallswiedergabe |
| `/nowplaying` · `/queue` | Aktueller Track / Warteschlange anzeigen |
| `/autojoin set\|status\|disable` | Auto-Join beim Start konfigurieren (wird live gespeichert) |

**Auto-Join live setzen** (statt via `config.json`):

```
/autojoin set channel:#dein-voice source:<URL|YouTube|Suchbegriff> [loop] [shuffle]
```

**Zugriffskontrolle:** Ist `allowedRoles` leer, darf jeder steuern. Mit Rollen-IDs
dürfen nur Mitglieder mit einer dieser Rollen — Server-Admins immer (Sicherheitsnetz).

---

## Aktualisieren

Das Image wird per CI **bei jeder Code-Änderung und zusätzlich wöchentlich** neu
gebaut (frisches `yt-dlp`, da sich die YouTube-Extraction oft ändert).

```bash
# einzelner Container:
docker pull ghcr.io/sonance-bot/sonance-bot:latest
docker rm -f sonance && docker run -d --name sonance --restart unless-stopped \
  -v "$PWD/config.json:/data/config.json" ghcr.io/sonance-bot/sonance-bot:latest

# oder mit compose:
cd bot && docker compose pull && docker compose up -d
```

---

## Mehr

- **Volle Doku** (alle Env-Variablen, CI/CD, technische Hinweise): [`bot/README.md`](bot/README.md)
- **Code:** [`bot/`](bot/) — Node.js 22, discord.js v14
- **Website / Wiki:** [Sonance-Bot/sonance-website](https://github.com/Sonance-Bot/sonance-website)

## Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE) — © 2026 Robin Wolff.
Nutzung, Änderung und Weitergabe nur für **nicht-kommerzielle** Zwecke.
