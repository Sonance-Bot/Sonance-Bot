'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Spielt eine Radio-URL, YouTube-Link/Playlist oder einen Suchbegriff ab')
    .addStringOption((o) =>
      o.setName('query')
        .setDescription('Radio-URL, YouTube-Link/-Playlist oder Suchbegriff')
        .setRequired(true))
    .addBooleanOption((o) =>
      o.setName('replace').setDescription('Aktuelle Queue ersetzen statt anhaengen'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Bot tritt deinem aktuellen Voice-Channel bei')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Ueberspringt den aktuellen Track')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stoppt die Wiedergabe und leert die Queue')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausiert die Wiedergabe')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Setzt die Wiedergabe fort')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Bot verlaesst den Voice-Channel')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Setzt die Lautstaerke (0-200%)')
    .addIntegerOption((o) =>
      o.setName('percent').setDescription('0-200').setRequired(true)
        .setMinValue(0).setMaxValue(200))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Schaltet das Loopen der Queue an/aus')
    .addBooleanOption((o) =>
      o.setName('enabled').setDescription('true = an, false = aus').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Schaltet Zufallswiedergabe an/aus')
    .addBooleanOption((o) =>
      o.setName('enabled').setDescription('true = an, false = aus').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Zeigt den aktuell laufenden Track')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Zeigt die aktuelle Warteschlange')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('autojoin')
    .setDescription('24/7 Auto-Join: Bot startet automatisch in festem Channel mit fester Quelle')
    .addSubcommand((sc) =>
      sc.setName('set')
        .setDescription('Auto-Join einrichten, aktivieren und sofort starten')
        .addChannelOption((o) =>
          o.setName('channel')
            .setDescription('Voice-Channel, in dem automatisch gespielt wird')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(true))
        .addStringOption((o) =>
          o.setName('source')
            .setDescription('Radio-URL, YouTube-Link/Playlist oder Suchbegriff')
            .setRequired(true))
        .addBooleanOption((o) =>
          o.setName('loop').setDescription('Endlos loopen (Standard: an)'))
        .addBooleanOption((o) =>
          o.setName('shuffle').setDescription('Zufallswiedergabe (Standard: aus)')))
    .addSubcommand((sc) =>
      sc.setName('disable').setDescription('Auto-Join deaktivieren'))
    .addSubcommand((sc) =>
      sc.setName('status').setDescription('Aktuelle Auto-Join-Konfiguration anzeigen'))
    .toJSON(),
];

module.exports = { commands };
