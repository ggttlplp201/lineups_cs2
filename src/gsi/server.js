'use strict';
// GSI listener (spec §5.2).
// CS2 POSTs JSON game state to http://127.0.0.1:<port>. We validate the
// auth token, ACK fast (the game blocks on `timeout` otherwise), and emit:
//   'payload'  — every valid payload
//   'status'   — { connected: boolean } edge-triggered
//
// The watchdog window is derived from the cfg's heartbeat (10s): if the
// game is alive but nothing changes, GSI still POSTs every `heartbeat`
// seconds, so silence beyond ~2.5x heartbeat means CS2 is gone.

const http = require('http');
const { EventEmitter } = require('events');

const MAX_BODY_BYTES = 1024 * 1024; // GSI payloads are a few KB; 1MB is paranoid headroom
const HEARTBEAT_SECONDS = 10;
const WATCHDOG_MS = HEARTBEAT_SECONDS * 2500;

class GsiServer extends EventEmitter {
  constructor({ port, token }) {
    super();
    this.port = port;
    this.token = token;
    this.connected = false;
    this.lastSeen = 0;
    this._watchdog = null;
    this._server = null;
  }

  start() {
    this._server = http.createServer((req, res) => this._handle(req, res));
    this._server.on('error', (err) => this.emit('error', err));
    this._server.listen(this.port, '127.0.0.1', () => {
      this.emit('listening', this.port);
    });
    this._watchdog = setInterval(() => {
      if (this.connected && Date.now() - this.lastSeen > WATCHDOG_MS) {
        this.connected = false;
        this.emit('status', { connected: false });
      }
    }, 1000);
    return this;
  }

  stop() {
    if (this._watchdog) clearInterval(this._watchdog);
    if (this._server) this._server.close();
  }

  _handle(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const token = payload.auth && payload.auth.token;
      if (this.token && token !== this.token) {
        res.writeHead(401).end();
        return;
      }
      // ACK immediately; never make the game wait on our processing.
      res.writeHead(200).end('');

      this.lastSeen = Date.now();
      if (!this.connected) {
        this.connected = true;
        this.emit('status', { connected: true });
      }
      this.emit('payload', payload);
    });
  }
}

module.exports = { GsiServer, HEARTBEAT_SECONDS };
