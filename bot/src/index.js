'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} = require('discord.js');

const { commands } = require('./commands');
const { GuildPlayer } = require('./player');
const { resolveQuery } = require('./sources');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');

// config.json is optional: in containers/CI everything can come from env vars.
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  console.warn(`Keine config.json unter ${CONFIG_PATH} — nutze Umgebungsvariablen/Defaults.`);
}

// Environment variables override file values (secrets belong in env, not in git).
if (process.env.DISCORD_TOKEN) config.token = process.env.DISCORD_TOKEN;
if (process.env.DISCORD_CLIENT_ID) config.clientId = process.env.DISCORD_CLIENT_ID;
if (process.env.DISCORD_GUILD_ID !== undefined) config.guildId = process.env.DISCORD_GUILD_ID;
if (process.env.DEFAULT_VOLUME) config.defaultVolume = Number(process.env.DEFAULT_VOLUME);
if (process.env.ALLOWED_ROLES) {
  config.allowedRoles = process.env.ALLOWED_ROLES.split(',').map((s) => s.trim()).filter(Boolean);
}

if (!config.token || config.token.startsWith('DEIN')) {
  console.error('Kein Bot-Token gefunden. Setze DISCORD_TOKEN (env) oder token in config.json.');
  process.exit(1);
}
if (!config.clientId || config.clientId.startsWith('DEIN')) {
  console.error('Keine Client-ID gefunden. Setze DISCORD_CLIENT_ID (env) oder clientId in config.json.');
  process.exit(1);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  } catch (err) {
    console.error(`Konnte config.json nicht speichern (${CONFIG_PATH}): ${err.message}`);
  }
}

/**
 * Role gate. If config.allowedRoles is empty/unset, everyone may use the bot.
 * Otherwise only members with one of those role IDs — plus server admins, as a
 * safety net so a misconfigured list can't lock everyone out.
 */
function memberHasAccess(interaction) {
  const allowed = config.allowedRoles;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const roles = interaction.member?.roles;
  const roleIds = roles?.cache ? [...roles.cache.keys()] : Array.isArray(roles) ? roles : [];
  return allowed.some((id) => roleIds.includes(id));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

/** @type {Map<string, GuildPlayer>} guildId -> player */
const players = new Map();

function getPlayer(guild) {
  let p = players.get(guild.id);
  if (!p) {
    p = new GuildPlayer(guild);
    p.setVolume(config.defaultVolume ?? 100);
    players.set(guild.id, p);
  }
  return p;
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commands;
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Slash-Commands fuer Guild ${config.guildId} registriert.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log('Globale Slash-Commands registriert (Propagation kann ~1h dauern).');
  }
}

async function doAutoJoin() {
  const aj = config.autoJoin;
  if (!aj?.enabled) return;
  try {
    const guild = await client.guilds.fetch(aj.guildId);
    const channel = await guild.channels.fetch(aj.channelId);
    if (!channel || !channel.isVoiceBased()) {
      console.error('AutoJoin: channelId ist kein Voice-Channel.');
      return;
    }
    const player = getPlayer(guild);
    player.lockChannel(channel.id); // pin: auto-join keeps the bot in this channel
    await player.ensureConnected(channel);

    const src = aj.source || {};
    if (src.query) {
      const tracks = await resolveQuery(src.query);
      if (tracks.length === 0) {
        console.error('AutoJoin: keine Tracks aus der Quelle aufgeloest.');
        return;
      }
      player.setLoop(src.loop !== false);
      player.setShuffle(!!src.shuffle);
      player.enqueue(tracks, { replace: true });
      await player.start();
      console.log(`AutoJoin: starte ${tracks.length} Track(s) in #${channel.name}.`);
    }
  } catch (err) {
    console.error('AutoJoin fehlgeschlagen:', err.message);
  }
}

client.once('clientReady', async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await doAutoJoin();
});

// Channel-Lock: solange Auto-Join aktiv ist, den Bot sofort zurückziehen, wenn er
// verschoben oder rausgezogen wird.
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.id !== client.user?.id) return; // nur der Bot selbst
  const player = players.get(newState.guild.id);
  if (!player?.lockedChannelId) return;
  if (newState.channelId !== player.lockedChannelId) {
    console.warn(`[lock:${newState.guild.id}] Bot in falschem Channel (${newState.channelId ?? 'raus'}) — zurück zu ${player.lockedChannelId}`);
    player.returnToLock();
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName: cmd } = interaction;

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: 'Nur auf Servern nutzbar.', ephemeral: true });
  }
  if (!memberHasAccess(interaction)) {
    return interaction.reply({
      content: 'Du hast keine Berechtigung, diesen Bot zu benutzen.',
      ephemeral: true,
    });
  }
  const player = getPlayer(guild);

  // Helper: the voice channel of the invoking member.
  const memberChannel = interaction.member?.voice?.channel || null;

  try {
    switch (cmd) {
      case 'join': {
        if (player.lockedChannelId) {
          const locked = await guild.channels.fetch(player.lockedChannelId).catch(() => null);
          if (locked) {
            await player.ensureConnected(locked);
            return interaction.reply(`Auto-Join aktiv — Bot bleibt in **${locked.name}**.`);
          }
        }
        if (!memberChannel) return interaction.reply({ content: 'Du bist in keinem Voice-Channel.', ephemeral: true });
        await player.ensureConnected(memberChannel);
        return interaction.reply(`Beigetreten: **${memberChannel.name}**`);
      }

      case 'play': {
        const query = interaction.options.getString('query', true);
        const replace = interaction.options.getBoolean('replace') ?? false;
        // When auto-join pins the bot, always use the locked channel.
        const channel = player.lockedChannelId
          ? await guild.channels.fetch(player.lockedChannelId).catch(() => null)
          : (memberChannel || guild.channels.cache.get(player.channelId));
        if (!channel) return interaction.reply({ content: 'Tritt erst einem Voice-Channel bei.', ephemeral: true });

        await interaction.deferReply();
        await player.ensureConnected(channel);
        const tracks = await resolveQuery(query);
        if (tracks.length === 0) return interaction.editReply('Nichts gefunden.');

        const wasEmpty = player.queue.length === 0 || replace;
        player.enqueue(tracks, { replace });
        if (wasEmpty || !player.nowPlaying()) await player.start();

        const head = tracks[0].title;
        return interaction.editReply(
          tracks.length === 1
            ? `${replace ? 'Spiele' : 'Hinzugefuegt'}: **${head}**`
            : `${replace ? 'Spiele' : 'Hinzugefuegt'}: **${tracks.length} Tracks** (ab **${head}**)`,
        );
      }

      case 'skip':
        player.skip();
        return interaction.reply('Uebersprungen.');

      case 'stop':
        player.stop();
        return interaction.reply('Gestoppt und Queue geleert.');

      case 'pause':
        return interaction.reply(player.pause() ? 'Pausiert.' : 'Konnte nicht pausieren.');

      case 'resume':
        return interaction.reply(player.resume() ? 'Fortgesetzt.' : 'Konnte nicht fortsetzen.');

      case 'leave':
        if (player.lockedChannelId) {
          return interaction.reply({ content: 'Auto-Join ist aktiv — erst `/autojoin disable`, dann `/leave`.', ephemeral: true });
        }
        player.destroy();
        players.delete(guild.id);
        return interaction.reply('Channel verlassen.');

      case 'volume': {
        const pct = interaction.options.getInteger('percent', true);
        player.setVolume(pct);
        return interaction.reply(`Lautstaerke: **${pct}%**`);
      }

      case 'loop': {
        const v = interaction.options.getBoolean('enabled', true);
        player.setLoop(v);
        return interaction.reply(`Loop: **${v ? 'an' : 'aus'}**`);
      }

      case 'shuffle': {
        const v = interaction.options.getBoolean('enabled', true);
        player.setShuffle(v);
        return interaction.reply(`Shuffle: **${v ? 'an' : 'aus'}**`);
      }

      case 'nowplaying': {
        const np = player.nowPlaying();
        return interaction.reply(np ? `Laeuft gerade: **${np.title}**` : 'Es laeuft nichts.');
      }

      case 'queue': {
        if (player.queue.length === 0) return interaction.reply('Queue ist leer.');
        const lines = player.queue
          .slice(0, 15)
          .map((t, i) => `${i === player.index ? '▶' : `${i + 1}.`} ${t.title}`);
        const more = player.queue.length > 15 ? `\n… und ${player.queue.length - 15} weitere` : '';
        return interaction.reply(`**Queue (${player.queue.length})**\n${lines.join('\n')}${more}`);
      }

      case 'autojoin': {
        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
          const aj = config.autoJoin;
          if (!aj?.enabled) return interaction.reply({ content: 'Auto-Join ist **deaktiviert**.', ephemeral: true });
          const s = aj.source || {};
          return interaction.reply({
            content: `Auto-Join **aktiv**\n• Channel: <#${aj.channelId}>\n• Quelle: \`${s.query}\`\n• Loop: ${s.loop !== false ? 'an' : 'aus'} · Shuffle: ${s.shuffle ? 'an' : 'aus'}`,
            ephemeral: true,
          });
        }

        if (sub === 'disable') {
          config.autoJoin = { ...(config.autoJoin || {}), enabled: false };
          saveConfig();
          player.unlock(); // Bot ist nicht mehr an den Channel gefesselt
          return interaction.reply('Auto-Join **deaktiviert**. Der Bot ist nicht mehr an den Channel gefesselt; laufende Wiedergabe bleibt.');
        }

        // sub === 'set'
        const channel = interaction.options.getChannel('channel', true);
        const source = interaction.options.getString('source', true);
        const loop = interaction.options.getBoolean('loop') ?? true;
        const shuffle = interaction.options.getBoolean('shuffle') ?? false;

        await interaction.deferReply();
        config.autoJoin = {
          enabled: true,
          guildId: guild.id,
          channelId: channel.id,
          source: { query: source, loop, shuffle },
        };
        saveConfig();

        // Sofort anwenden: an Channel fesseln, beitreten + abspielen.
        player.lockChannel(channel.id);
        await player.ensureConnected(channel);
        const tracks = await resolveQuery(source);
        if (tracks.length === 0) {
          return interaction.editReply(`Gespeichert für <#${channel.id}>, aber die Quelle ergab keine Tracks. Prüfe \`${source}\`.`);
        }
        player.setLoop(loop);
        player.setShuffle(shuffle);
        player.enqueue(tracks, { replace: true });
        await player.start();
        return interaction.editReply(
          `Auto-Join gespeichert & gestartet in **${channel.name}**\n• Quelle: \`${source}\` (${tracks.length} Track(s))\n• Loop: ${loop ? 'an' : 'aus'} · Shuffle: ${shuffle ? 'an' : 'aus'}\nDer Bot ist jetzt an diesen Channel **gefesselt** (kehrt bei Verschieben/Rauswurf zurück) und joint **bei jedem Start**.`,
        );
      }

      default:
        return interaction.reply({ content: 'Unbekannter Befehl.', ephemeral: true });
    }
  } catch (err) {
    console.error(`[cmd:${cmd}]`, err);
    const msg = `Fehler: ${err.message}`;
    if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
    else interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

process.on('SIGINT', () => { for (const p of players.values()) p.destroy(); process.exit(0); });
process.on('SIGTERM', () => { for (const p of players.values()) p.destroy(); process.exit(0); });

(async () => {
  try {
    await registerCommands();
  } catch (err) {
    if (err?.code === 50001) {
      const invite = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&permissions=3146752&scope=bot%20applications.commands`;
      console.error(`Command-Registrierung fehlgeschlagen (Missing Access): Der Bot ist nicht auf Guild ${config.guildId} oder wurde ohne 'applications.commands'-Scope eingeladen.`);
      console.error(`Bot einladen: ${invite}`);
    } else {
      console.error('Command-Registrierung fehlgeschlagen:', err.message);
    }
    // Trotzdem einloggen — nach dem Einladen reicht ein Neustart zum Nachregistrieren.
  }
  await client.login(config.token);
})();
