'use strict';
// V2 position source: tails CS2's console.log (written when the game runs
// with the -condebug launch option) and extracts position fixes from
// `getpos` output lines:
//   setpos -1080.504883 240.213409 -160.031250;setang 1.23 -45.67 0.00
//
// getpos is sv_cheats-protected in CS2, so this source works on practice
// servers — which is where lineups are learned and spots are captured.
// Reading the log is passive: the game writes it, we only ever read it
// (spec §2/§8 — no game-file modification).

const fs = require('fs');
const { EventEmitter } = require('events');

const SETPOS_RE = /setpos(?:_exact)?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;

function parsePositions(text) {
  const out = [];
  for (const m of text.matchAll(SETPOS_RE)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
  }
  return out;
}

class ConsoleLogWatcher extends EventEmitter {
  constructor({ logPath, intervalMs = 300 }) {
    super();
    this.logPath = logPath;
    this.intervalMs = intervalMs;
    this._offset = null; // null = take EOF on first sight; never replay history
    this._carry = '';    // partial last line between polls
    this._timer = null;
    this._reading = false;
  }

  start() {
    if (!this.logPath || this._timer) return this;
    this._timer = setInterval(() => this._poll(), this.intervalMs);
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _poll() {
    if (this._reading) return;
    fs.stat(this.logPath, (err, st) => {
      if (err) {
        this._offset = null; // file not there (yet) — keep waiting
        return;
      }
      if (this._offset === null || st.size < this._offset) {
        // First sight of the file, or it was truncated (-conclearlog /
        // new game session): start fresh at the end, don't replay.
        this._offset = st.size;
        this._carry = '';
        return;
      }
      if (st.size === this._offset) return;

      const start = this._offset;
      this._offset = st.size;
      this._reading = true;
      const stream = fs.createReadStream(this.logPath, {
        start,
        end: st.size - 1,
        encoding: 'utf8'
      });
      let text = '';
      stream.on('data', (chunk) => { text += chunk; });
      stream.on('error', () => { this._reading = false; });
      stream.on('end', () => {
        this._reading = false;
        text = this._carry + text;
        const lastNewline = text.lastIndexOf('\n');
        this._carry = lastNewline === -1 ? text : text.slice(lastNewline + 1);
        const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
        for (const pos of parsePositions(complete)) this.emit('position', pos);
      });
    });
  }
}

module.exports = { ConsoleLogWatcher, parsePositions };
