/* Rank Up! — lockstep-relay ROOM SERVER (Phase 1)
 *
 * DELIBERATELY GAME-AGNOSTIC. It knows about rooms, seats, a shared seed, and an ordered stream of
 * opaque "action" messages. It does NOT know what a class / card / turn is — so adding game content
 * never touches this file (online-plan invariant #2). Rules live only in the client engine.
 *
 * Protocol (JSON over WebSocket):
 *   client -> server: {type:'join', room, name}
 *                     {type:'action', action}         // action is an opaque payload from the client
 *                     {type:'ping'}
 *   server -> client: {type:'joined', room, seat, seed, players}
 *                     {type:'peer', event:'join'|'leave', seat, name, players}
 *                     {type:'action', from, seat, seq, action}   // relayed in total order
 *                     {type:'error', msg}
 *                     {type:'pong'}
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8833;
const CLIENT_ROOT = path.join(__dirname, '..');        // this server also serves the game files (single deploy)
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.ttf':'font/ttf', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.md':'text/markdown; charset=utf-8' };
const SEATS = ['player', 'ai', 'ai2'];           // seat assignment by join order (matches the client engine's seat ids)
const rooms = new Map();                          // code -> { seed, seq, sockets:Set, seatBySocket:Map, nameBySocket:Map }

function newSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; }

function roomPlayers(room) {
  return [...room.sockets].map(s => ({ seat: room.seatBySocket.get(s), name: room.nameBySocket.get(s) || '?' }));
}
function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }
function broadcast(room, obj, except) { for (const s of room.sockets) if (s !== except) send(s, obj); }

const server = http.createServer((req, res) => {
  if (req.url === '/health') {   // health endpoint (used by the cloud host + a quick browser check)
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'rank-up-room-server', rooms: rooms.size }));
    return;
  }
  // Serve the static game files, so ONE deploy gives both the game (https://host/) and the room
  // WebSocket (wss://host). Clients connect same-origin when deployed.
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(CLIENT_ROOT, urlPath));
  if (!filePath.startsWith(CLIENT_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }   // no path traversal
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws._room = null;
  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch (_) { return; }

    if (msg.type === 'join') {
      const code = String(msg.room || 'default').slice(0, 32).toUpperCase();
      let room = rooms.get(code);
      if (!room) { room = { seed: newSeed(), seq: 0, started: false, sockets: new Set(), seatBySocket: new Map(), nameBySocket: new Map(), clsBySocket: new Map() }; rooms.set(code, room); }
      if (room.sockets.size >= 2) { send(ws, { type: 'error', msg: 'Room full.' }); return; }   // 2-player for v1
      const seatIdx = room.sockets.size;               // 0 = seat 'player', 1 = seat 'ai'
      const seat = SEATS[seatIdx];
      room.sockets.add(ws); room.seatBySocket.set(ws, seat); room.nameBySocket.set(ws, String(msg.name || 'guest').slice(0, 24));
      room.clsBySocket.set(ws, String(msg.cls || 'light'));
      ws._room = code; ws._seatIdx = seatIdx;
      send(ws, { type: 'joined', room: code, seat, seatIdx, players: roomPlayers(room) });
      broadcast(room, { type: 'peer', event: 'join', seat, name: room.nameBySocket.get(ws), players: roomPlayers(room) }, ws);
      console.log(`[join] room=${code} seat=${seat} name=${room.nameBySocket.get(ws)} cls=${room.clsBySocket.get(ws)} (${room.sockets.size} in room)`);

      // SHARED-IDENTITY start: once both seats are filled, hand every client the SAME setup — one seed,
      // both classes (by canonical seat index), and a canonical first seat derived from the seed. Each
      // client then builds a byte-identical game and controls only its own seatIdx.
      if (room.sockets.size === 2 && !room.started) {
        room.started = true;
        const socks = [...room.sockets];
        const bySeat = {}; socks.forEach(s => { bySeat[s._seatIdx] = s; });
        const seat0Class = room.clsBySocket.get(bySeat[0]);
        const seat1Class = room.clsBySocket.get(bySeat[1]);
        const firstSeat = room.seed % 2;
        socks.forEach(s => send(s, { type: 'start', seed: room.seed, seat0Class, seat1Class, firstSeat, mySeat: s._seatIdx }));
        console.log(`[start] room=${code} seed=${room.seed} classes=[${seat0Class},${seat1Class}] firstSeat=${firstSeat}`);
      }
      return;
    }

    const room = ws._room && rooms.get(ws._room);
    if (!room) { send(ws, { type: 'error', msg: 'Join a room first.' }); return; }

    if (msg.type === 'action') {
      // Total order: stamp a monotonic seq and relay to the OTHER clients. The sender already applied
      // optimistically (turn-based: one actor at a time), so we do NOT echo back to the sender.
      const seq = ++room.seq;
      const seat = room.seatBySocket.get(ws);
      broadcast(room, { type: 'action', from: seat, seat, seq, action: msg.action }, ws);
      return;
    }
    if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }
  });

  ws.on('close', () => {
    const code = ws._room; const room = code && rooms.get(code);
    if (!room) return;
    const seat = room.seatBySocket.get(ws);
    const name = room.nameBySocket.get(ws);
    room.sockets.delete(ws); room.seatBySocket.delete(ws); room.nameBySocket.delete(ws);
    broadcast(room, { type: 'peer', event: 'leave', seat, name, players: roomPlayers(room) });
    console.log(`[leave] room=${code} seat=${seat} (${room.sockets.size} left)`);
    if (room.sockets.size === 0) { rooms.delete(code); console.log(`[gc] room ${code} emptied`); }
  });
});

server.listen(PORT, () => console.log(`Rank Up! room server listening on http://localhost:${PORT}  (ws://localhost:${PORT})`));
