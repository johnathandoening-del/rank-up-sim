# Rank Up! — Online Multiplayer Plan

**Status:** Approved direction, not yet started (waiting on "build online mode").
**Last updated:** 2026-08-30
**Scope:** Turn the standalone single-file game (`index.html` + `styles.css`, ~24k lines, served locally on :8832) into a real online multiplayer web app that friends on different networks can play.

---

## 0. Decisions locked in

| Area | Decision |
|---|---|
| **Hosting** | Free cloud host (always-on, reachable anytime even when Kychi's PC is off). Accept a few seconds' cold-start after idle. No paid services for v1. |
| **Who plays** | **Private rooms (join by code) now**, but architected so **public matchmaking is a later switch, not a rewrite**. |
| **Identity** | Usernames, **no passwords** — claim a name, remembered on the device; ratings + match history tracked. Real logins can come later for cross-device. |
| **Devices** | Desktop browsers for v1. Mobile/touch is its own later pass. |

### Assumed defaults (in effect unless changed)
- **Trusted clients for now** — no heavy anti-cheat yet; friends won't cheat. Anti-cheat arrives with the public phase.
- **Reconnect / rejoin** — a dropped player hops back into the same seat.
- **Bots stay** — offline solo play keeps working, and bots can fill empty seats in a room.
- **Seeded RNG from day one** — so every future class / evolution / mode stays sync-safe automatically.
- **Ship online with the current 15 classes first**, then add the remaining 6 classes, 3 evolutions, and new modes on the live game.

---

## 1. Design invariants (non-negotiables)

These are the rules that keep the game *maintainable* after it goes online. Every phase is built to preserve them.

1. **One engine, one source of truth.** The game rules (classes, effects, decks, phases, win checks) live in exactly one place. The network layer never re-implements a rule.
2. **The netcode is transport-only.** The server moves *actions* and *state* between players and enforces turn order. It does **not** know what a "class" or an "evolution" is. → Adding content never touches the server.
3. **Determinism.** Given the same seed + the same ordered list of player actions, every client computes the identical game state. All randomness flows through one seeded RNG.
4. **Content stays a one-place edit.** Adding class #16, evolution #2, or a new mode is the same kind of edit as today (a `CM` entry, deck data in `buildDeck`, effects in `SDEFS`/`ACDEFS`, an icon glyph in the font + `RU_CLASS_ICONS`). It then works online with zero netcode changes.
5. **Public is a feature flag, not a fork.** A private game is "a room with a code." Public matchmaking later = "auto-drop players into open rooms," reusing the exact same room/seat/sync/reconnect/rating code.

---

## 2. Architecture overview

```
   Player A browser            Player B browser            (Spectators)
 ┌──────────────────┐        ┌──────────────────┐
 │  Rank Up client  │        │  Rank Up client  │
 │  ┌────────────┐  │        │  ┌────────────┐  │
 │  │ GAME ENGINE│  │        │  │ GAME ENGINE│  │   ← the SAME engine module,
 │  │ (rules,    │  │        │  │ (rules,    │  │     rules in one place
 │  │  seeded RNG)│  │        │  │  seeded RNG)│  │
 │  └────────────┘  │        │  └────────────┘  │
 │   net module     │        │   net module     │
 └────────┬─────────┘        └────────┬─────────┘
          │  WebSocket (actions ↕, state sync ↕)   │
          └───────────────┬────────────────────────┘
                          ▼
             ┌──────────────────────────┐
             │      ROOM SERVER (Node)   │   ← generic; knows rooms/seats/turns,
             │  • rooms + join codes      │     NOT game rules
             │  • seat assignment         │
             │  • ordered action relay    │
             │  • turn-ownership gate      │
             │  • seed authority           │
             │  • reconnect / replay log   │
             │  • usernames + ratings (DB) │
             └──────────────────────────┘
                          │
                    ┌───────────┐
                    │ small DB  │  (SQLite/file first → hosted Postgres if public scale needs it)
                    └───────────┘
```

**Model for v1: lockstep-relay.** The server assigns a game seed and relays player actions in a single total order; every client runs the shared engine deterministically and stays in sync. The server enforces that only the seat whose turn it is may act. Reconnecting/late clients catch up from the action log (or a state snapshot).

**Why this model:** it reuses the existing client engine almost as-is, keeps rules in one place (invariant #1/#2), and keeps the server small and game-agnostic (invariant #4). The bridge to anti-cheat later: because the engine is one JS module, the **server can run that same module headless (Node)** to validate/authoritatively resolve games during the public phase — a capability upgrade, not a rewrite.

---

## 3. Tech stack

- **Server:** Node.js (so it can reuse the JS engine module later), WebSockets (lightweight `ws` or a thin framework). Dependency-light.
- **Persistence:** start with SQLite/JSON file (free, trivial); migrate to hosted Postgres only if/when public scale demands it.
- **Client:** the existing `index.html` + `styles.css`, plus a new **net module** and an **online-mode UI** (name entry, room create/join, lobby). Engine gets a determinism + action-boundary refactor (see §5).
- **Host:** free cloud tier (Fly.io / Render / Railway / Cloudflare — chosen at deploy). Version-stamped so clients auto-update on reload.
- **Dev workflow (Windows/PowerShell):** unchanged for content — edit files, reload. New: run the server locally for testing, deploy on release.

---

## 4. Phases

Effort is relative (S / M / L / XL), not calendar time. Order is deliberate: **hardest, riskiest work first** so everything after is downhill.

### Phase 0 — Foundations (the hard 20%) · **L**
De-risk everything before any lobby exists.
- ✅ **DONE — Seeded RNG.** Two-stream mulberry32 in `index.html` (~L141): `ruRand()` shared/lockstep stream, `ruAiRand()` host-local AI stream, `ruRandInt/ruRandPick`, `ruRandId` (per-game counter — deterministic IDs that don't perturb the random stream). Seeded in `initGame` via `window.RU_INJECTED_SEED` (server injects online; solo generates one); recorded as `G._seed`. All 23 game-affecting `Math.random` calls converted (shuffle, coin-flip, `uid`, effect bank/hand picks, `randomPick` helpers, `makeStart` ids, AI rolls incl. `ruRollCorrect`); ~27 cosmetic (particles/dust/rain) + menu-config + pre-seed fallbacks left on `Math.random` intentionally. **Verified:** same seed → byte-identical decks/hands/turn-order/IDs; different seed differs; normal game plays with no errors; card conservation intact (64/64).
- ✅ **DONE — Action model (input-replay).** Module at the very end of `index.html` (before `</body>`). Instead of re-implementing rules, it captures the local player's **inputs** as compact messages and re-applies them; because the engine is seeded, replaying the inputs reproduces state. Recording hooks the **real DOM-click layer**, so AI / auto-answer paths (which invoke handlers programmatically) are NOT recorded — the AI regenerates deterministically from the seed on replay. Cards referenced by (deterministic) id. API: `ruStartRecording/ruStopRecording/ruActionLog/ruApplyAction/ruReplayActions`, flag `G._actionLog`. Wrapped inputs: `advPhase`(adv), `endTurnNow`(end), `cancelAll`, `standDownMode`, `startAttackMode`, `relieveMode`, `bankZoneClick`, `deltaZoneClick`, `deadzoneClick`, `viewZone`, `handClick`(hand,byId), `zoneClick`, `openSkillMenuV10`; **modal** buttons (by index, via `_showModalNow`); **picker** confirm/skip (by ids, via `confirmPick`/`skipPick`). **Verified:** record→replay on a fresh same-seed game yields byte-identical state for (a) phase-advances and (b) a real card play (promote = `hand` + `modal`), same card ids.
- 🟡 **State snapshot + action log**: action log ✅; a canonical `G`-snapshot helper still lives only in the test harness — formalize a reusable `ruSnapshot()` for reconnect/catch-up.
- 🟡 **Full replay test**: core actions proven (adv/hand/modal). Remaining action types (attack via zone-clicks, skill with a **picker** `pick` action, flank, relieve, bank-skill) are built but validated incrementally as real games exercise them in Phase 1 — a desync there pinpoints any unwrapped path.
- **Done when:** a game can be driven entirely by a scripted action list, and replaying it twice yields identical state.

### Phase 1 — First playable online slice · **L**
Two humans, one private room, different networks, real moves syncing.
- ✅ **DONE — Room server** (`server/room-server.js`, Node + `ws`, port 8833; `cd server && npm start`). Game-agnostic: rooms by code, seat assignment by join order (`player`/`ai`/`ai2`), one shared seed per room handed out on join, ordered action relay (stamps a seq, broadcasts to the OTHER clients — sender applied optimistically), peer join/leave, `/health` endpoint. Knows zero game rules.
- ✅ **DONE — Client net module** (`net.js`, loaded by `index.html`). `RUNet.connect(url,room,name,{pCls,aCls})`: joins, receives the shared seed → starts an identically-seeded game, forwards each local player action via the action model's `ruOnLocalAction` hook, applies each relayed action via `ruApplyAction` (which suppresses re-forwarding through `G._replaying`).
- ✅ **DONE — Transport lockstep PROVEN.** Two browser tabs in room R1: same seed (both 43883164), A drove 5 real actions (advance/promote/advance×2), relayed through the server → B reached **byte-identical** state (2981 chars, hash 84503393). This is the networked-spectator / one-driver proof of seed-sync + relay + determinism.
- 🟡 **Seat control (2 independent players) — approach chosen + core primitives PROVEN.** Approach = **MIRRORED-LOCAL**: each client runs the engine with ITSELF as `'player'` (so the whole deeply-`'player'`-hardcoded play path — `handClick`→`tryFlank`/`tryPromote`/`startSkill`/`activateArea`, all of which hardcode `G.player` — works UNCHANGED). The opponent seat is `'ai'`, driven by relayed actions. Two primitives built + verified:
    - ✅ **`ruApplyForeignAction(a)`** (in the action-model module): applies an opponent's `'player'`-perspective action to OUR `'ai'` seat by swapping player/ai objects + turn label, running the normal handler, swapping back, re-rendering. **Verified:** a foreign promote moved the *opponent's* rank (Inferno 0→Numeral 3, hand 5→4), left the local player untouched, restored the turn. Exact for synchronous actions (phase/promote/flank/attack/end); timer-based skill flows validated per-skill in hardening.
    - ✅ **AI suppression** — `aiDo` early-returns when `G._netMode` (single choke point). **Verified:** ai no-ops in net mode, so the opponent seat is human-driven.
- ⚠️ **KEY FINDING (2026-08-30): mirrored-local is NOT viable as-is.** Built the mirror setup (canonical deck-build order via `makeGameState(...,buildOrder)` + `RU_NET_CONFIG` path in `initGame`). Deck build mirrors PERFECTLY (ids `c-ff-*` identical; the *inferno*/second-player mirror `A.ai === B.player` is byte-exact). But the *first-player* mirror diverges: the engine treats the `'ai'` seat as a **bot** even when it's a remote human — first-turn **switchdraw** is manual for `'player'` (index.html:2432) but **auto** for `'ai'` (index.html:2451), so the same physical seat draws differently by label. This is one of MANY `isP = G.turn==='player'` asymmetries (attacks, reactions, prompts); chasing them all under mirroring is unbounded desync risk.
- ✅ **PIVOT → SHARED-IDENTITY lockstep** (robust). Both clients run the LITERAL SAME game (identical `G`: same seed, `'player'`=seat0, `'ai'`=seat1, both classes) — **already proven deterministic** by the spectator test. Because both clients are byte-identical, the player/ai asymmetries are identical on both → **they can never desync**; worst case the `'ai'`-seat human gets a bot-style auto-decision (a UX limit, fixed incrementally by making specific `isP` spots treat `'ai'` as human when `G._netMode`), never a broken game. Action tagging: a `'player'` action applies via `ruApplyAction`, an `'ai'` action via `ruApplyForeignAction` — same rule on both clients.
- ✅ **DONE — Shared-identity setup + apply-by-tag (verified).** `initGame`'s `RU_NET_CONFIG` path now builds the SHARED-IDENTITY game: `pCls=seat0Class`, `aCls=seat1Class`, `sideOrder=['player','ai']`, canonical `firstTurn`, no mirror/buildOrder → **byte-identical `G` on every client** (verified: two setups, `STATE_IDENTICAL: true`). Only `G._localSeat` differs (`seat0`→`'player'`, `seat1`→`'ai'`). **Apply-by-tag** is the one lockstep rule (in `net.js`): a `player`-tagged action → `ruApplyAction`, an `ai`-tagged action → `ruApplyForeignAction`. **Verified:** a `player`-tag and an `ai`-tag `advPhase` each advanced the correct seat's phase; an `ai`-tag promote drove the ai seat leaving the player untouched. Same rule both clients ⇒ can't desync.
- ✅ **DONE — POV (render + input) + full 2-tab setup, VERIFIED.**
    - **Render POV:** `renderAll` (index.html ~L5244) swaps the two seat objects + turn label ONLY around the paint for the `'ai'`-controlling client, then restores — so every render function shows the local seat at the BOTTOM with no per-function change; game state stays canonical. Verified: seat-1 client shows its own (inferno) seat at bottom, and state is byte-unchanged by render.
    - **Input POV:** the action-model wrappers + modal + picker now foreign-apply for the `'ai'` client (`localDrivesAi()` guard): a local input is recorded/relayed (server stamps `from='ai'`) and executed via `ruApplyForeignAction` to drive the `'ai'` seat. Verified: seat-1's `advPhase` advanced the ai seat's phase, turn stayed correct, action relayed.
    - **Server + net.js shared-identity start:** server (`room-server.js`) collects each client's `cls` on join and, when both seats fill, sends `start` with `{seed, seat0Class, seat1Class, firstSeat, mySeat}`; `net.js` builds via `RU_NET_CONFIG`. **Verified 2-tab:** A (seat0/light) + B (seat1/inferno) → byte-identical canonical `G` (same seed), each viewing its OWN seat at bottom.
- ✅ **DONE — FIRST FULLY WORKING 2-PLAYER GAME (verified end-to-end over the network).**
    - **Turn-gate**: action-model wrapper blocks off-turn `{adv,end,hand,sdMode,atkMode,rvMode}` (before record/relay, so no off-turn no-op is sent). View/modal/picker stay open.
    - **Switchdraw neutralized** under `G._netMode`: the human player's mandatory first-turn switchdraw auto-resolves like the AI's (index.html ~L2434/2446/2456 gated with `!G._netMode`) — identical on both clients, no blocking modal. (Interactive switchdraw over the net is a later add.)
    - **2-tab playtest (R4, light vs inferno):** both byte-identical at start (no modal); **A played a full turn → B synced; B played a full turn via its own POV/foreign-apply → A synced; turn handed back, Exchange 2, byte-identical (hash 292091455).** A card play (promote via hand+modal) also relayed and applied identically (hash 2203248172). Note: turn-handoff (`endTurnCore`) is deferred via `setTimeout`, so a per-action hash can differ for a moment then converges — normal.
- ✅ **DONE — Lobby UI (verified).** Title-screen panel (`#online-panel` in index.html; `.online-*` styles in styles.css): name + room-code + server-URL fields, PLAY ONLINE / Leave buttons, live status line. `net.js` adds `ruJoinOnline()` (reads the fields + the class picked in the grid → `RUNet.connect`) and `ruLeaveOnline()`, and pushes status on every event (connecting / waiting / opponent-found / error / opponent-left). **Verified end-to-end:** Alice(light)+Bob(inferno) each picked a class, typed a name + room "duel1", clicked PLAY ONLINE → auto-started when both present → both on the game screen, each seeing its OWN seat at bottom, byte-identical. **No console needed.**
- ⬜ **Remaining (reach + refinement, not core correctness):** (1) **DEPLOY** the room server to the free cloud host so it works across real networks — it's localhost-only now (the lobby's server field defaults to `ws://localhost:8833`; deployed it'd be the cloud `wss://…` URL) — this is Phase 4. (2) Neutralize more `'ai'`-as-bot spots as real play surfaces them (attacks/reactions/specific skill prompts) — each is consistent on both clients so it degrades to an auto-decision, never a desync. (3) Turn-gate refinement for reactions (allow Safeguard/Retaliatory on the opponent's turn). (4) Reconnect (`ruSnapshot()` catch-up). (5) Then Phases 3 (usernames/Elo) & 5 (public).
- **Done when:** Kychi + the Dutch friend, on different WiFi, play a full 2-player game to a win with correct, in-sync state.

### Phase 2 — Rooms, seats & resilience · **M–L**
- Create/join **by code**; room list you own; leave/close.
- N-seat online (1v1v1 online — the seat abstraction already exists).
- **Bots fill empty seats** (bot runs on ONE authoritative point — the room host — and its actions are relayed like a player's, so all clients stay identical).
- **Reconnect/rejoin**: disconnect grace timer, catch-up via action log/snapshot, seat "disconnected" state.
- **Spectators**: read-only action stream.
- **Done when:** rooms are stable, a mid-game disconnect recovers, and 1v1v1 + bot-fill work online.

### Phase 3 — Identities & ratings · **M**
- Username claim (device-remembered), guest fallback.
- Match history + **Elo-style ratings** (private-scope leaderboard among your group).
- Basic profiles.
- **Done when:** games report results to the server, ratings update, and history/leaderboard render.

### Phase 4 — Hardening & deploy · **M**
- ✅ **DONE — Deploy-ready single container (verified locally).** The room server (`server/room-server.js`) now ALSO serves the static game files, so ONE deploy = game (`https://host/`) + multiplayer (`wss://host`) at one URL. Client auto-detects the WS URL (`net.js` `defaultWsUrl()`: same-origin `wss://` when deployed, `ws://host:8833` in the python-`:8832` dev split) and pre-fills the lobby's server field. Deploy files added at repo root: **`Dockerfile`** (universal), **`.dockerignore`**, **`.gitignore`**, **`render.yaml`** (Render blueprint), **`DEPLOY.md`** (step-by-step). **Verified:** served the game from the Node server on :8833, lobby auto-filled `ws://localhost:8833`, same-origin WS connected + joined a room.
- ⬜ **USER STEP (can't be automated — needs an account):** create a free cloud account and deploy per `DEPLOY.md` (recommended: **Render** — free, no card, WebSockets; push repo to GitHub → New Blueprint). Result is a public URL everyone opens. (Free tier sleeps ~15 min idle → ~30–60s first-connect wake; optional `/health` pinger keeps it warm.)
- ⬜ Version stamping + auto-update, disconnect/abandon handling + room GC (basic GC already: empty rooms are deleted), reconnect (`ruSnapshot()` catch-up), light abuse guards (name filter, rate limits), logging.
- **Done when:** anyone with the URL + a room code can play across networks reliably.

### Phase 5 — Public mode (later, "when you feel like it") · **L**
The switch you asked to keep open.
- Open matchmaking queue (match by rating), reusing all Phase 2/3 plumbing.
- **Anti-cheat upgrade:** run the shared engine **headless on the server** to validate/authoritatively resolve games. Report/mute/ban tooling.
- Global leaderboards.
- **Done when:** a stranger can queue and get matched, and results are server-validated.

### Ongoing / parallel — Content
Lands automatically because the engine is the single source of truth (invariant #4):
- **15 → 21 classes:** 6 more `CM` entries + decks + effects + 6 glyphs in `RU_Classic_Icons.ttf` + 6 lines in `RU_CLASS_ICONS` (one place).
- **1 → 4 evolutions:** engine content.
- **New game modes:** plug into the `sideOrder`/seat + phase system (same path 1v1v1 uses).
- New randomness in any of the above **must** use the seeded RNG (the one discipline).

---

## 5. The hard part, in detail (Phase 0)

The single biggest risk is **making the existing engine deterministic and giving it a clean action boundary**, because it has a lot of shared global state (`G`) and DOM-coupled logic (`renderAll`, `buildCard`, `el()`).

- **We do NOT need a perfect rules/rendering separation for v1 lockstep.** We need: seeded RNG, a serializable action stream, remote actions routed into the same entry points the bots use, and turn-ownership gating. The engine can stay largely as-is on the client; the net layer wraps it.
- **The full pure-engine extraction** (so the server can run it headless for anti-cheat) is deferred to Phase 5 and done incrementally — not a big-bang rewrite.
- **Multi-step prompts are actions too.** Every choice in a picker/modal (pick N from hand, choose an opponent, confirm) is its own message. These must be enumerated carefully — they're the fiddliest part of the action model.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Determinism drift (clients desync) | One seeded RNG + a permanent replay test (same seed+actions → identical state). Catch drift in CI, not in a live game. |
| Global-state coupling makes serialization hard | Snapshot/restore `G` wholesale first; refine into a cleaner state object only as needed. Don't over-engineer for v1. |
| Free host cold-starts / sleeps | Acceptable for a friend group (few-second wake). Revisit (paid VPS) only if it annoys you. |
| Trusted-client cheating | Fine for private/friends. Public phase adds server-side validation via the same engine module. |
| Mid-game version updates cause desync | Version stamp; players in a game reload to the new version between matches. Trivial at friend scale. |
| Content accidentally forks the rules onto the server | Hard invariant #2 — server stays game-agnostic. Enforced in review. |

---

## 7. Open questions / deferred decisions

- Exact free host (Fly/Render/Railway/Cloudflare) — decide at Phase 4 deploy.
- Rating formula details (Elo K-factor, provisional games) — decide at Phase 3.
- Mobile/touch UI — separate later pass, not in v1.
- Real accounts/login (cross-device) — later, layered on usernames without touching the engine.
- Chat / emotes / friend lists — nice-to-haves, unscheduled.

---

## 8. Kickoff

- **"build online mode"** → start Phase 0 → Phase 1 (first cross-network 2-player game).
- Content work (classes/evolutions/modes) can proceed in parallel any time — it's independent of the netcode by design.
