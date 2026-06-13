'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const YTDLP = path.join(__dirname, '..', 'bin', 'yt-dlp');

const isUrl = (s) => /^https?:\/\//i.test(s);
const isYouTube = (s) => /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(s);

/**
 * A "track" is { title, type, input } where:
 *   - type 'stream' -> input is a direct audio URL (radio / icecast)
 *   - type 'ytdlp'  -> input is a youtube watch URL, streamed via yt-dlp at play time
 */

function ytdlpJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });
  });
}

/**
 * Resolve a user query into an array of tracks.
 * Handles: direct stream URL (radio), YouTube video/playlist, or a search term.
 */
async function resolveQuery(query) {
  // Direct non-YouTube URL -> internet radio / audio stream.
  if (isUrl(query) && !isYouTube(query)) {
    return [{ title: query, type: 'stream', input: query }];
  }

  // Plain text -> YouTube search (first result).
  if (!isUrl(query)) {
    query = `ytsearch1:${query}`;
  }

  // YouTube (video, playlist or ytsearch): get a flat list of entries.
  const raw = await ytdlpJson([
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    query,
  ]);
  const data = JSON.parse(raw);
  const entries = Array.isArray(data.entries) ? data.entries : [data];
  return entries
    .filter((e) => e && (e.id || e.url))
    .map((e) => ({
      title: e.title || e.id,
      type: 'ytdlp',
      // Always prefer the watch URL (from the video id) so yt-dlp re-resolves a
      // fresh stream URL on every play. For a single video, e.url is the direct
      // googlevideo CDN URL, which expires after hours -> 403 on the next loop.
      input: e.id ? `https://www.youtube.com/watch?v=${e.id}` : e.url,
    }));
}

module.exports = { resolveQuery, isYouTube, isUrl };
