/* Rank Up! — client NET module (Phase 1)
 * Bridges the deterministic engine + action model to the room server:
 *   • receives the room's shared SEED and starts an identically-seeded game
 *   • forwards each LOCAL player action (via the action model's ruOnLocalAction hook) to the room
 *   • applies each RELAYED action from the room via ruApplyAction (which suppresses re-forwarding)
 * Turn-based + one shared game → optimistic local apply + relay keeps both clients in lockstep.
 * The engine's rules are never touched here (transport only). */
(function(){
  if (window.RUNet) return;
  var ws = null;
  var state = { connected:false, room:null, seat:null, seed:null, name:null, active:false, applied:0, sent:0, lastSeq:0,
                clientId:null, lastConnect:null, reconnectTimer:null, reconnectTries:0, intentionalClose:false };
  var opts = { pCls:'light', aCls:'inferno' };

  // Stable per-tab id so a dropped/reloaded tab reclaims its SAME seat, while a second live tab from the same
  // browser profile can still join as the other player instead of stealing the first seat.
  function clientId(){
    if (state.clientId) return state.clientId;
    var browserId = null, tabId = null;
    try { browserId = localStorage.getItem('ru_browser_id') || localStorage.getItem('ru_client_id'); } catch(e){}
    if (!browserId) {
      browserId = 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('ru_browser_id', browserId); } catch(e){}
    } else {
      try { localStorage.setItem('ru_browser_id', browserId); } catch(e){}
    }
    try { tabId = sessionStorage.getItem('ru_tab_client_id'); } catch(e){}
    if (!tabId) {
      tabId = 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      try { sessionStorage.setItem('ru_tab_client_id', tabId); } catch(e){}
    }
    state.clientId = String(browserId + '|' + tabId).slice(0, 64);
    return state.clientId;
  }

  function log2(m){ try { (window.log ? window.log : console.log)('[net] ' + m, 'info'); } catch(e){ try{ console.log('[net]', m); }catch(_){} } }
  function setStatus(text, cls){ try { var e = document.getElementById('online-status'); if (e) { e.textContent = text; e.className = 'online-status' + (cls ? ' ' + cls : ''); } } catch(_){} }
  function showLeave(on){ try { var b = document.getElementById('online-leave-btn'); if (b) b.style.display = on ? '' : 'none'; var j = document.getElementById('online-join-btn'); if (j) j.disabled = !!on; } catch(_){} }

  function oppName(){
    // The name of the OTHER seat (for rematch prompts). mySeat 0 → seat1's name, else seat0's.
    try { return (state.mySeat === 1) ? (state.name0 || 'your opponent') : (state.name1 || 'your opponent'); } catch(e){ return 'your opponent'; }
  }
  function postDeclineModal(){
    // Opponent declined / cancelled a rematch (or we cancelled). Offer the two off-ramps the user asked for:
    // keep playing (vs a local AI bot) or leave to the menu. Leaving disconnects from the room.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}
    if (typeof openModal !== 'function') return;
    openModal('No rematch',
      '<div class="wbanner"><p>' + oppName() + ' isn’t up for a rematch.</p><p>Play on against a local AI, or leave the room?</p></div>',
      [{ label:'Play vs AI', cls:'mb-skill', fn:function(){ try{closeModal();}catch(e){} window.RUNet.disconnect(); try{ if(typeof G!=='undefined'&&G)G._netMode=false; }catch(e){} if(typeof startGame==='function') startGame(); }},
       { label:'Leave to Menu', fn:function(){ try{closeModal();}catch(e){} window.RUNet.disconnect(); try{ var gs=document.getElementById('game-screen'),ts=document.getElementById('title-screen'); if(gs)gs.classList.remove('active'); if(ts)ts.classList.add('active'); if(typeof refreshAIPick==='function')refreshAIPick(); }catch(e){} }}]);
  }
  window.ruNetPostDecline = postDeclineModal;

  function startNetGame(cfg){
    // SHARED-IDENTITY: every client builds the byte-identical game from the same seed + both classes;
    // only mySeat (which seat this client drives) differs. initGame reads RU_NET_CONFIG.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}   // dismiss any game-over / rematch-waiting modal before the fresh game builds
    state.seed = cfg.seed; state.mySeat = cfg.mySeat; state.name0 = cfg.name0; state.name1 = cfg.name1; state.active = true; state.spectator = !!cfg.spectator; state.applied = 0; state.lastSeq = 0;
    window.RU_NET_CONFIG = { seed: cfg.seed, mySeat: cfg.mySeat, seat0Class: cfg.seat0Class, seat1Class: cfg.seat1Class, firstSeat: cfg.firstSeat,
      seat0DeltaDeck: cfg.seat0DeltaDeck || [], seat1DeltaDeck: cfg.seat1DeltaDeck || [] };
    if (typeof startGame === 'function') startGame();
    window.RU_NET_CONFIG = null;
    // Stash the two synced Δ Decks on G so installDeltaDecks (which runs ~80ms later, after RU_NET_CONFIG is
    // cleared) builds identical evolutions for BOTH seats on every client, keyed by canonical seat index.
    try { if (typeof G !== 'undefined' && G) G._netDeltaDecks = { player: cfg.seat0DeltaDeck || [], ai: cfg.seat1DeltaDeck || [] }; } catch(e){}
    // Attach the real player names to the seat data so the HUD shows them (and they follow the POV swap).
    // Also flag THIS device's own seat object so logs/prompts can say "You"/"your" for the local player and
    // the name for everyone else — the flag rides on the seat OBJECT, so it stays correct through the POV
    // foreign-apply swap (the object moves between the 'player'/'ai' labels, the flag moves with it).
    try {
      if (typeof G !== 'undefined' && G) {
        if (G.player) {
          G.player._netName = cfg.name0 || 'Player 1';
          G.player._seatNo = 1;
          G.player._seatLabel = 'Player 1';
          G.player._isHumanSeat = true;
          G.player.isBot = false;
        }
        if (G.ai) {
          G.ai._netName = cfg.name1 || 'Player 2';
          G.ai._seatNo = 2;
          G.ai._seatLabel = 'Player 2';
          G.ai._isHumanSeat = true;
          G.ai.isBot = false;
        }
        if (G.player) G.player._isLocalHuman = false;
        if (G.ai) G.ai._isLocalHuman = false;
        // Spectator: read-only, owns no seat — leave both _isLocalHuman false so every prompt is a mirror and
        // all input is blocked (see the action-model + ruPromptIsMine spectator guards). Players own their seat.
        if (cfg.spectator) { G._spectator = true; }
        else if (G._localSeat && G[G._localSeat]) { G[G._localSeat]._isLocalHuman = true; }
        if (cfg.spectator) setStatus('Spectating room "' + (state.room||'') + '" — read-only.', 'ok');
        if (typeof renderAll === 'function') renderAll();
      }
    } catch(e){}
    log2('game started — seed ' + cfg.seed + ', you are Player ' + (cfg.mySeat + 1) + ', controlling the bottom board.');
  }

  // Reconnect catch-up: build the identical base game, install both Δ Decks synchronously (they normally land
  // ~80ms later, but the replay needs evolutions in place first or an Amalgamation action would desync), then
  // replay every logged action by tag to reproduce the exact live state.
  function resumeNetGame(cfg){
    startNetGame(cfg);
    try { if (typeof installDeltaDecks === 'function') installDeltaDecks(); } catch(e){}
    var lg = cfg.log || [];
    try {
      for (var i = 0; i < lg.length; i++) {
        var e = lg[i];
        var seq = Number(e.seq || (i + 1));
        if (seq && seq <= state.lastSeq) continue;
        if (e.from === 'ai') window.ruApplyForeignAction(e.action);
        else window.ruApplyAction(e.action);
        if (seq) state.lastSeq = seq;
        state.applied++;
      }
    } catch(err){ console.error('[net] resume replay failed', err); }
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}      // drop any stale prompt the replay left open
    try { if (typeof renderAll === 'function') renderAll(); } catch(e){}
    setStatus('Reconnected — caught up to the live game.', 'ok');
    log2('resumed: replayed ' + lg.length + ' actions.');
  }

  function handle(msg){
    switch (msg.type) {
      case 'joined':
        state.room = msg.room; state.seat = msg.seat; state.mySeat = msg.seatIdx;
        log2('joined room ' + msg.room + ' as Player ' + (msg.seatIdx + 1) + ' — waiting for opponent…');
        setStatus('In room "' + msg.room + '" as Player ' + (msg.seatIdx + 1) + '. Waiting for an opponent to join…', 'ok');
        break;
      case 'start':
        log2('match starting…');
        setStatus('Opponent found — starting match!', 'ok');
        startNetGame(msg);
        break;
      case 'resume':
        // We reconnected mid-game: rebuild the identical base game, then replay the server's action log to
        // catch up to the exact live state (deterministic engine → same state as the opponent).
        log2('reconnected — catching up (' + ((msg.log && msg.log.length) || 0) + ' actions)…');
        setStatus('Reconnecting — catching up…', 'ok');
        resumeNetGame(msg);
        break;
      case 'action':
        // apply-by-tag (shared-identity): the acting seat comes from the server (msg.from). A 'player'
        // action applies normally; an 'ai' action applies via the perspective swap. Same rule on every
        // client → identical result → lockstep.
        try {
          var seq = Number(msg.seq || 0);
          if (seq && seq <= state.lastSeq) return;
          if (msg.from === 'ai') window.ruApplyForeignAction(msg.action);
          else window.ruApplyAction(msg.action);
          if (seq) state.lastSeq = seq;
          state.applied++;
        } catch(e){ console.error('[net] apply failed', e, msg); }
        break;
      case 'peer':
        log2('peer ' + msg.event + ' (seat ' + msg.seat + ', ' + (msg.players ? msg.players.length : '?') + ' in room)');
        if (msg.event === 'disconnect') {
          setStatus((msg.name || 'Your opponent') + ' disconnected — waiting up to ' + Math.round((msg.graceMs||90000)/1000) + 's for them to reconnect…', 'err');
          try { if (typeof log === 'function') log((msg.name || 'Opponent') + ' disconnected — holding the game for a reconnect…', 'imp'); } catch(e){}
        } else if (msg.event === 'resume') {
          setStatus((msg.name || 'Your opponent') + ' reconnected — resuming.', 'ok');
          try { if (typeof log === 'function') log((msg.name || 'Opponent') + ' reconnected.', 'imp'); } catch(e){}
        }
        break;
      case 'reset':
        // Opponent left (no reconnect in v1) — the room reset to a clean waiting state. Return to the
        // lobby so a fresh match can start; the seat this client will get may change, so we re-sync on the
        // next 'joined'/'start'.
        state.active = false; state.mySeat = null; state.lastSeq = 0; state.applied = 0;
        if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
        setStatus('Your opponent left — match ended. You are back in the room; a new opponent can join, or change the code.', 'err');
        try { var gs = document.getElementById('game-screen'), ts = document.getElementById('title-screen'); if (gs) gs.classList.remove('active'); if (ts) ts.classList.add('active'); } catch(e){}
        break;
      case 'rematch-vote':
        // The opponent asked for a rematch. Surface it; if the local game-over modal offers a Rematch
        // button, the player just clicks it and both restart (server deals a fresh 'start').
        log2((msg.name || 'Opponent') + ' wants a rematch.');
        setStatus((msg.name || 'Your opponent') + ' wants a rematch — accept to play again.', 'ok');
        break;
      case 'rematch-declined':
        log2((msg.name || 'Opponent') + ' declined the rematch.');
        postDeclineModal();
        break;
      case 'stats':
        // Updated ratings after a match — surface each player's record in the log.
        try {
          (msg.players || []).forEach(function(p){ log2(p.name + ': ' + p.elo + ' Elo (' + p.wins + 'W-' + p.losses + 'L' + (p.draws ? '-' + p.draws + 'D' : '') + ')'); });
        } catch(e){}
        break;
      case 'error':
        log2('room error: ' + msg.msg);
        setStatus(msg.msg || 'Room error.', 'err');
        showLeave(false);
        // Stale client (a deploy happened after this page loaded) — offer a one-click refresh.
        if (msg.code === 'stale' && typeof openModal === 'function') {
          try { openModal('Update available',
            '<div class="wbanner"><p>' + (msg.msg || 'A new version is available.') + '</p></div>',
            [{ label:'Refresh now', cls:'mb-skill', fn:function(){ try{ location.reload(true); }catch(e){ location.reload(); } }}, { label:'Later', fn:function(){ try{closeModal();}catch(e){} }}]); } catch(e){}
        }
        break;
    }
  }

  // Auto-reconnect after an unexpected drop: retry the same room every few seconds until the server's grace
  // window (~90s) — each attempt re-joins with our clientId, so the server resumes us with the action log.
  function scheduleReconnect(){
    if (state.reconnectTimer || !state.active || state.intentionalClose) return;
    state.reconnectTimer = setTimeout(function attempt(){
      state.reconnectTimer = null;
      if (!state.active || state.intentionalClose) return;
      if (state.connected) return;
      state.reconnectTries++;
      if (state.reconnectTries > 40) { setStatus('Could not reconnect — the match may have ended. Rejoin the room to try again.', 'err'); state.active = false; showLeave(false); return; }
      log2('reconnect attempt ' + state.reconnectTries + '…');
      setStatus('Connection lost — reconnecting (' + state.reconnectTries + ')…', 'err');
      try { var lc = state.lastConnect || {}; window.RUNet.connect(lc.url, lc.room, lc.name, { cls: lc.cls, _resume: true }); } catch(e){}
      state.reconnectTimer = setTimeout(attempt, 3000);
    }, 1500);
  }

  window.RUNet = {
    connect: function(url, room, name, o){
      o = o || {};
      // this client's chosen class: explicit opt, else the menu selection (pCls), else light
      var myClass = o.cls || (typeof pCls !== 'undefined' && pCls) || 'light';
      opts.cls = myClass;
      state.name = name || 'guest';
      state.intentionalClose = false;
      state.lastConnect = { url: url, room: room, name: state.name, cls: myClass };   // remembered for auto-reconnect
      var wsUrl = url || ('ws://' + (location.hostname || 'localhost') + ':8833');
      ws = new WebSocket(wsUrl);
      var thisWs = ws;
      // Free-tier hosts sleep after ~15 min idle and take up to a minute to wake — the WS connect can look
      // dead meanwhile, so show a "waking up" status and let the socket keep trying.
      if (!o._resume) setStatus('Connecting to the server… (a free-tier server can take up to a minute to wake up)');
      ws.onopen = function(){ state.connected = true; if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; } state.reconnectTries = 0;
        log2('connected → ' + wsUrl + '; joining "' + room + '" as ' + myClass); if (!o._resume) setStatus('Connected. Joining room "' + room + '"…'); showLeave(true);
        // Send our Δ Deck so the server can relay both players' decks — evolutions must be identical on every
        // client or an Amalgamation Rank Up desyncs (each side would build different evolution cards).
        var dd = (Array.isArray(window.RU_PLAYER_DELTA_DECK) ? window.RU_PLAYER_DELTA_DECK.slice(0,3) : []);
        // clientId lets the server give us back our SAME seat on reconnect; build lets it reject a stale client.
        ws.send(JSON.stringify({ type:'join', room:room, name:state.name, cls:myClass, deltaDeck:dd, build: state.loadedBuild || null, clientId: clientId(), spectator: !!o.spectator })); };
      ws.onmessage = function(ev){ try { handle(JSON.parse(ev.data)); } catch(e){ console.error('[net] bad msg', e); } };
      ws.onclose = function(){ if (thisWs !== ws) return;   // superseded by a newer socket (reconnect) — ignore
        state.connected = false; log2('disconnected');
        // Unexpected drop while a match is live → try to reconnect to the same room (server holds our seat and
        // replays the log so we resume). A deliberate leave (intentionalClose) or a non-active state just tidies up.
        if (state.active && !state.intentionalClose) { setStatus('Connection lost — reconnecting…', 'err'); scheduleReconnect(); }
        else { state.active = false; showLeave(false); }
      };
      ws.onerror = function(){ log2('socket error'); if (!state.active) { setStatus('Could not reach the server at ' + wsUrl + '. If it was asleep, wait a few seconds and try again.', 'err'); showLeave(false); } };
      // forward local player actions to the room (skipped automatically while applying a relayed action, since ruApplyAction sets G._replaying)
      window.ruOnLocalAction = function(a){ if (state.active && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type:'action', action:a })); state.sent++; } };
    },
    state: function(){ return JSON.parse(JSON.stringify(state)); },
    isActive: function(){ return !!state.active; },
    oppName: function(){ return oppName(); },
    // Vote to rematch (true) or decline/cancel (false). When BOTH seats vote true the server deals a fresh
    // identically-seeded game (a new 'start') and both clients rebuild in the same room.
    rematch: function(vote){ try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'rematch', vote: !!vote })); } catch(e){} },
    // Report the finished match's winner (canonical seat 'player'|'ai'|'draw') so the server updates ratings.
    // Both clients report the same result; the server records it once. Spectators don't call this.
    reportResult: function(winner){ try { if (!state.spectator && ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'result', winner: winner })); } catch(e){} },
    disconnect: function(){ state.intentionalClose = true; state.active = false; if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; } if (ws) try { ws.close(); } catch(e){} }
  };

  // ── Lobby glue (title-screen "Play Online" panel) ──
  // Where's the room server? Deployed, the room server also serves this page, so it's same-origin
  // (wss://host). In local dev the game is served by python on :8832 while the WS server runs on :8833.
  function defaultWsUrl(){
    try {
      if (location.port === '8832') return 'ws://' + location.hostname + ':8833';   // local dev split
      var proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
      return proto + '//' + location.host;                                          // same-origin (deployed / node-served)
    } catch(e){ return 'ws://localhost:8833'; }
  }
  // Pre-fill the server field with the right default once the DOM is ready.
  function initServerField(){ try { var s = document.getElementById('online-server'); if (s && (!s.value || s.value.indexOf('localhost') !== -1)) s.value = defaultWsUrl(); } catch(e){} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initServerField); else initServerField();

  // The http(s) origin of the room server (for /health), derived from the WS URL.
  function httpBase(){
    try {
      var w = defaultWsUrl();
      return w.replace(/^ws/, 'http').replace(/\/$/, '');
    } catch(e){ return ''; }
  }
  // On load: hit /health once. This (1) captures the build we loaded under, so the server can reject us if a
  // deploy lands before we join (else we'd desync), and (2) starts WAKING a sleeping free-tier server early,
  // so the first Play-Online click connects fast. A keep-alive ping every 10 min stops the server sleeping
  // mid-session while anyone has the page open. All best-effort — failures are ignored (offline/localhost).
  function pingHealth(){
    try {
      var base = httpBase(); if (!base) return;
      fetch(base + '/health?cb=' + Date.now(), { cache:'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.build) state.loadedBuild = j.build; })
        .catch(function(){});
    } catch(e){}
  }
  function initHealth(){ pingHealth(); try { setInterval(pingHealth, 10*60*1000); } catch(e){} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHealth); else initHealth();

  window.ruJoinOnline = function(){
    var nameEl = document.getElementById('online-name'), roomEl = document.getElementById('online-room'), srvEl = document.getElementById('online-server');
    var name = (nameEl && nameEl.value.trim()) || 'Guest';
    var room = (roomEl && roomEl.value.trim()) || '';
    var url  = (srvEl && srvEl.value.trim()) || defaultWsUrl();
    var cls  = (typeof pCls !== 'undefined' && pCls) || null;
    if (!cls) { setStatus('Pick your Combat-Class above first.', 'err'); return; }
    if (!room) { setStatus('Enter a room code (any word) and share it with your friend.', 'err'); return; }
    setStatus('Connecting…');
    try { window.RUNet.connect(url, room.toUpperCase(), name, { cls: cls }); }
    catch(e){ setStatus('Connection failed: ' + (e && e.message ? e.message : e), 'err'); }
  };
  window.ruSpectateOnline = function(){
    var roomEl = document.getElementById('online-room'), srvEl = document.getElementById('online-server');
    var room = (roomEl && roomEl.value.trim()) || '';
    var url  = (srvEl && srvEl.value.trim()) || defaultWsUrl();
    if (!room) { setStatus('Enter the room code you want to watch.', 'err'); return; }
    setStatus('Connecting to watch room "' + room.toUpperCase() + '"…');
    try { window.RUNet.connect(url, room.toUpperCase(), (document.getElementById('online-name')||{}).value || 'Spectator', { cls: (typeof pCls!=='undefined'&&pCls)||'light', spectator: true }); }
    catch(e){ setStatus('Connection failed: ' + (e && e.message ? e.message : e), 'err'); }
  };
  window.ruLeaveOnline = function(){ try { window.RUNet.disconnect(); } catch(e){} showLeave(false); setStatus('Left the room.'); };

  // Ratings board — fetch /leaderboard and show it in a modal.
  window.ruLeaderboard = function(){
    var base = httpBase(); if (!base) { setStatus('Leaderboard unavailable.', 'err'); return; }
    setStatus('Loading leaderboard…');
    fetch(base + '/leaderboard?cb=' + Date.now(), { cache:'no-store' })
      .then(function(r){ return r.json(); })
      .then(function(j){
        var rows = (j && j.leaderboard) || [];
        setStatus(rows.length ? '' : 'No games recorded yet — play an online match to appear here.');
        if (typeof openModal !== 'function') return;
        var body = '<div class="wbanner" style="max-height:60vh;overflow:auto;"><table style="width:100%;font-size:.8rem;border-collapse:collapse;">' +
          '<tr style="color:var(--text-dim);text-align:left;"><th style="padding:.2rem .4rem;">#</th><th>Player</th><th>Elo</th><th>W</th><th>L</th><th>D</th></tr>' +
          (rows.length ? rows.map(function(p,i){ return '<tr><td style="padding:.2rem .4rem;">' + (i+1) + '</td><td>' + esc(p.name) + '</td><td><b>' + p.elo + '</b></td><td>' + p.wins + '</td><td>' + p.losses + '</td><td>' + (p.draws||0) + '</td></tr>'; }).join('')
                        : '<tr><td colspan="6" style="padding:.6rem;color:var(--text-dim);">No games recorded yet.</td></tr>') +
          '</table></div>';
        openModal('🏆 Leaderboard', body, [{ label:'Close', cls:'mb-skill', fn:function(){ try{closeModal();}catch(e){} }}]);
      })
      .catch(function(){ setStatus('Could not load the leaderboard (is the server awake?).', 'err'); });
  };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
})();
