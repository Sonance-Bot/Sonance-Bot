'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

// The static ffmpeg build segfaults on direct HTTP input in this environment,
// so network sources are fetched by a separate process (curl / yt-dlp) whose
// output is piped into ffmpeg's stdin. ffmpeg then only decodes — no networking.
const YTDLP = path.join(__dirname, '..', 'bin', 'yt-dlp');
const CURL = 'curl';
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');

/**
 * Per-guild player. Owns one voice connection + one audio player.
 * Maintains a queue, supports loop/shuffle and survives stream drops
 * (auto-reconnect) for true 24/7 playback.
 */
class GuildPlayer {
  constructor(guild) {
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.index = 0;
    this.loop = true;        // loop the whole queue (good for 24/7)
    this.shuffle = false;
    this.volume = 1.0;
    this.connection = null;
    this.channelId = null;
    this.lockedChannelId = null; // when set (auto-join), the bot is pinned here
    this.ffmpeg = null;
    this.fetcher = null;
    this.destroyed = false;
    this._watchdog = null;
    this._rejoining = false;

    this.player = createAudioPlayer({
      // Pause when the voice connection drops (no subscriber) so we don't burn
      // through the queue silently; resumes once we rejoin and re-subscribe.
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on(AudioPlayerStatus.Idle, () => this._onTrackEnd());
    this.player.on('error', (err) => {
      console.error(`[player:${this.guild.id}] resource error:`, err.message);
      // Skip the broken track after a short delay instead of dying.
      setTimeout(() => this._onTrackEnd(), 1500);
    });
  }

  connect(channel) {
    this.channelId = channel.id;
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.player);

    const conn = this.connection;
    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.destroyed) return;
      try {
        // Give discord.js a moment to auto-resume (e.g. voice region change).
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this._rejoin('disconnected');
      }
    });

    this._startWatchdog();
    return this.connection;
  }

  /**
   * Periodic safety net: if we are supposed to be connected but the voice
   * connection is gone/destroyed (e.g. kicked, silent drop), rejoin.
   */
  _startWatchdog() {
    if (this._watchdog) return;
    const live = new Set([
      VoiceConnectionStatus.Ready,
      VoiceConnectionStatus.Connecting,
      VoiceConnectionStatus.Signalling,
    ]);
    this._watchdog = setInterval(() => {
      if (this.destroyed || this._rejoining) return;
      const target = this.lockedChannelId || this.channelId;
      if (!target) return;
      // When locked (auto-join), also enforce being in the right channel: if the
      // bot was dragged elsewhere or pulled out, the cached voice state differs.
      if (this.lockedChannelId) {
        const actual = this.guild.members?.me?.voice?.channelId ?? null;
        if (actual !== this.lockedChannelId) { this._rejoin('watchdog-lock'); return; }
      }
      if (!live.has(this.connection?.state?.status)) this._rejoin('watchdog');
    }, 15_000);
    this._watchdog.unref?.();
  }

  // Pin the bot to a channel (auto-join). It will be dragged back if moved/kicked.
  lockChannel(id) { this.lockedChannelId = id; this.channelId = id; }
  unlock() { this.lockedChannelId = null; }
  returnToLock() { if (this.lockedChannelId) this._rejoin('moved'); }

  /** Full rejoin: fetch the channel fresh (cache may miss), reconnect, restart audio. */
  async _rejoin(reason) {
    const target = this.lockedChannelId || this.channelId;
    if (this.destroyed || this._rejoining || !target) return;
    this._rejoining = true;
    try {
      try { this.connection?.destroy(); } catch {}
      const channel = await this.guild.channels.fetch(target).catch(() => null);
      if (!channel) {
        console.warn(`[player:${this.guild.id}] rejoin (${reason}) fehlgeschlagen: Channel ${target} weg`);
        return;
      }
      console.warn(`[player:${this.guild.id}] Voice verloren/verschoben (${reason}) — rejoine #${channel.name}`);
      this.connect(channel);
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000).catch(() => {});
      // Restart the current track fresh so we get live audio, not a stale buffer.
      if (this.current || this.queue.length) this._playIndex(this.index);
    } catch (err) {
      console.error(`[player:${this.guild.id}] rejoin error: ${err.message}`);
    } finally {
      this._rejoining = false;
    }
  }

  async ensureConnected(channel) {
    if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
      this.connect(channel);
    }
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  enqueue(tracks, { replace = false } = {}) {
    if (replace) {
      this.queue = [...tracks];
      this.index = 0;
    } else {
      this.queue.push(...tracks);
    }
  }

  setLoop(v) { this.loop = !!v; }
  setShuffle(v) { this.shuffle = !!v; }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(200, percent)) / 100;
    if (this.current?.resource?.volume) {
      this.current.resource.volume.setVolume(this.volume);
    }
  }

  _nextIndex() {
    if (this.queue.length === 0) return -1;
    if (this.shuffle) return Math.floor(Math.random() * this.queue.length);
    let next = this.index + 1;
    if (next >= this.queue.length) {
      if (!this.loop) return -1;
      next = 0;
    }
    return next;
  }

  _onTrackEnd() {
    if (this.destroyed) return;
    const next = this._nextIndex();
    if (next === -1) {
      this.current = null;
      return;
    }
    this._playIndex(next);
  }

  async start() {
    if (this.queue.length === 0) throw new Error('Queue ist leer');
    await this._playIndex(this.index);
  }

  async _playIndex(i) {
    if (this.destroyed) return;
    const track = this.queue[i];
    if (!track) return;
    this.index = i;

    try {
      const resource = this._makeResource(track);
      this.current = { track, resource };
      this.player.play(resource);
      console.log(`[player:${this.guild.id}] ▶ ${track.title}`);
    } catch (err) {
      console.error(`[player:${this.guild.id}] failed to play "${track.title}":`, err.message);
      // Move on so one bad track never stalls a 24/7 stream.
      setTimeout(() => this._onTrackEnd(), 1500);
    }
  }

  _killProcs() {
    if (this.fetcher) {
      try { this.fetcher.kill('SIGKILL'); } catch {}
      this.fetcher = null;
    }
    if (this.ffmpeg) {
      try { this.ffmpeg.kill('SIGKILL'); } catch {}
      this.ffmpeg = null;
    }
  }

  /**
   * Spawn the process that fetches container bytes for a source.
   * The static ffmpeg's HTTP code segfaults here, so all networking lives in
   * this separate process; ffmpeg only decodes what it reads from stdin.
   */
  _spawnFetcher(track) {
    if (track.type === 'ytdlp') {
      return spawn(YTDLP, [
        '-f', 'bestaudio/best',
        '--no-warnings',
        '--no-playlist',
        '-o', '-',
        track.input,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    }

    // 'stream' = internet radio / direct URL. curl streams indefinitely and
    // retries on transient errors, which keeps the 24/7 feed alive.
    return spawn(CURL, [
      '-s', '-L',
      '--retry', '999',
      '--retry-delay', '2',
      '--retry-all-errors',
      track.input,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  _makeResource(track) {
    this._killProcs();

    const fetcher = this._spawnFetcher(track);
    this.fetcher = fetcher;
    fetcher.stderr.on('data', (d) => {
      const m = d.toString().trim();
      if (m) console.error(`[fetch:${this.guild.id}] ${m}`);
    });
    fetcher.on('error', (e) => console.error(`[fetch:${this.guild.id}] spawn error: ${e.message}`));

    // ffmpeg reads container bytes from the fetcher via stdin and emits raw PCM.
    const ff = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn', '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.ffmpeg = ff;

    fetcher.stdout.pipe(ff.stdin);
    // Swallow EPIPE when ffmpeg exits before the fetcher does.
    ff.stdin.on('error', () => {});
    fetcher.stdout.on('error', () => {});

    ff.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[ffmpeg:${this.guild.id}] ${msg}`);
    });
    ff.on('error', (e) => console.error(`[ffmpeg:${this.guild.id}] spawn error: ${e.message}`));

    const resource = createAudioResource(ff.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(this.volume);
    return resource;
  }

  skip() {
    // Triggers Idle -> _onTrackEnd.
    this.player.stop(true);
  }

  pause() { return this.player.pause(); }
  resume() { return this.player.unpause(); }

  stop() {
    this.queue = [];
    this.current = null;
    this.index = 0;
    this.player.stop(true);
    this._killProcs();
  }

  destroy() {
    this.destroyed = true;
    if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
    this.stop();
    this._killProcs();
    if (this.connection) {
      try { this.connection.destroy(); } catch {}
    }
  }

  nowPlaying() {
    return this.current?.track || null;
  }
}

module.exports = { GuildPlayer };
