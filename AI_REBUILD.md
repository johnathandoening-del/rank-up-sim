# Rank Up! AI rebuild — design and progress log

Goal: bots that genuinely think — they play the game forward in their head with the REAL rules, model the
opponent's replies, re-plan after every action, and choose the line that leads to the best future position.
No scripted text-matching, no random "mistake dice", no luck or card advantages.

## Requirements (from the user, binding)

**Lookahead N** (turns simulated forward: its own turn, the opponent's reply, …):

| Tier | N | Occasionally |
|---|---|---|
| Distinguished 4 | 7 | always 7 |
| Distinguished 3 | 5 | 6 (~1 turn in 10) |
| Distinguished 2 | 5 | always 5 |
| Distinguished 1 | 4 | 5 (~1 in 7) |
| D-Candidate 3 | 4 | 5 (~1 in 10) |
| D-Candidate 2 | 4 | always 4 |
| D-Candidate 1 | 4 | 3 (~1 in 7) |
| Talented 2 | 3 | 4 (~1 in 10) |
| Talented 1 | 3 | 2 (~1 in 7) |
| Skilled 2 | 2 | 3 (~1 in 7) |
| Skilled 1 | 2 | 1 (~1 in 5) |
| Basic | 1 | 2 (~1 in 7) |
| Maladroit | 1 | 2 (~1 in 10) |
| Inept | 1 | 2 (~1 in 15) |

**Win-rate matrix** (1v1, with AND without Evolutions): same tier 50/50 · 1 sub-tier apart 85/15 · 2 apart 90/10 ·
3 apart 95/5 · 4 apart 99.5/0.5 · 5+ apart 100/0. Bottom is steeper: Maladroit beats Inept 90/10, Basic beats
Inept 95/5, Skilled 1 beats Inept 99.5/0.5.

**100/0** means literally never: every loss in such a pairing is a defect, investigated from its replay and fixed.
A genuinely unwinnable deal is shown to the user, never hidden or faked.

**Same luck for everyone**: no peeking at hidden information (opponent hand, deck orders, future random rolls),
no better deals. **Δ**: none below Talented 2, increasing from there; Δ cards (every Δ type, not just
Amalgamations) chosen to serve the bot's plan.

**Think time**: up to ~10–20 s per phase for top tiers is fine; bots must not rush through turns.

**1v1v1 / Royale**: win rates follow pairwise strength (Plackett–Luce fitted to the matrix; e.g. D4 vs D3 vs D3 ≈ 74% D4).

**All modes**: AI vs player, AI vs AI, 1v1v1, Royale, Tournament (random brackets, real escalation), Gauntlet.
Verified finally by playing as a human in the real UI.

## Architecture (built)

1. **One real engine, many realms.** `ai/realm.js` turns any global object into a game realm: the fake DOM
   (`ai/fakedom.js`), a virtual clock (timers run when settled, in order), seeded randomness and the window stubs. The
   Node tools (`tools/headless/engine.js`, a vm context) and the browser bot worker (`ai/worker.js`, its own global)
   load the game's own scripts into it. No second copy of the rules.
2. **Inputs = moves.** Every seat is driven by the same inputs a human makes (`{t:'adv'}`, `{t:'zone',o,z}`,
   `{t:'modal',i}`, `{t:'pick',ix}`, ...), applied in the order every screen applies one: *settle -> pre-input
   checkpoint -> input* (`ai/match.js`, the worker and the bot's own simulation all do this).
3. **The bot** (`ai/brain.js`): turn search phase by phase (every phase searched, Battle included; widening passes;
   unfinished positions always completed); prompts mid-action answered best-first for itself and worst-for-it for
   others; hidden cards re-dealt per imagined world at the current point (what was seen stays). Every decision: one
   turn search FINDS the candidate actions (the best few + the best pass), then EVERY world SCORES every candidate (the
   action, the best rest of the turn in that world, N-1 more turns by each side's quick develop-and-attack planner),
   each with an even share of the effort; actions compared world by world, worlds added until the best is clearly
   ahead, and one not clearly better than passing loses to passing. The bot commits to the action only (attack mode ->
   attacker -> target) and thinks again at its next decision. Judgment noise / temperature for lower tiers. Effort is
   counted where work happens; fixed-effort mode makes strength device-independent and games replayable. 2-4 seats.
4. **Tiers** (`ai/tiers.js`): the user's N table + worlds, width, effort, temperature; Δ only from Talented 2.
5. **Live game** (`ai/host.js` + `ai/worker.js`): solo matches of every mode run under the online lockstep rules with
   every bot seat input-driven (`G._soloNet`, `G._botSeats`). The page keeps the last quiet position (a plain-data
   copy) + the inputs since; the worker restores it, replays and plans; the move returns through the input layer at a
   readable pace, once the page's own game is exactly where the bot planned.

## Verification tools

- `parity.js` — same inputs with and without painting → identical fingerprints after every input.
- `reftrace.js record|check` — proves an engine change didn't alter any game (fingerprint traces).
- `leaktest.js` — snapshot, play K inputs, rewind, replay → identical fingerprints and identical game object.
- `smoke.js` — whole games on random inputs; determinism check.
- `dupcheck.js` — random games; no card ever in two places, no Rank Zone ever empty.
- `hostsim.js` — the page/worker protocol end to end (2-4 seats): the worker must rebuild the page's exact position.
- `arena.js` / `ladder.js` — mirrored-deal matches between policies, in parallel; a series of them unattended.
- `selfplay.js` / `fit.js` — self-play data (positions + per-game Δ Decks) and evaluation fitting (split by game,
  rule-known weight signs).
- `replay.js` — one arena game played again exactly (seed, classes, seats, bots): every input, why, and its log; the
  bot's weighed candidates for chosen turns. In the browser: `RUBots.history()` / `RUBots.explain(k)`.

## Progress log

- **2026-10-03** — Diagnosis of the old bot (text-regex scoring, combat-only toy search, mistake dice, bots
  auto-passing prompts in AI-vs-AI, cheapest-first picks in skill prompts, deterministic tournaments, Gauntlet
  D-Candidate round falling back to Basic). Headless engine built: loads in ~125 ms with zero errors; full games
  run through the input layer; deterministic. No-paint mode: parity OK (identical fingerprints), ~4,000
  inputs/s per core. RNG state exposed (`ruRngState` / `ruRngRestore`) — 10 reference games / 25,000
  fingerprints unchanged. Snapshot/restore: 48/48 leak checks identical; ~0.9 ms each.
- **2026-10-03 (later)** — Old-bot baseline, 200 headless AI-vs-AI games per pairing (strong side's share of decided
  games): Dis4 vs Inept 81.8% (target 100), Dis4 vs Dis3 52.0% (85), Dis4 vs Talented1 57.3% (100), Basic vs Inept
  65.1% (95), DC2 vs DC1 55.7% (85). Move generation on the real engine (legal = the engine accepts it; probing never
  disturbs the game, 0/4946). Planner v1: per-first-move beam over whole turns, adversarial answers to the other
  player's mid-turn prompts, hidden info re-dealt per world, N-turn lookahead on top lines, plan kept until the
  visible position deviates. Fixed: null moves (start+cancel) and comparing unfinished turns with finished ones.
- **2026-10-03 (later)** — Game fix found by the bot: switchdraw accepted ANY hand card (only the dialog's buttons
  enforced the rule); doSD now allows only Action Cards, plus Area / Rank³+ on the first turn, judged from the game's
  own state (G._sdFirst), never the input's claim. Planner fixes: attack mode expanded into complete attacks; positions
  reached twice are searched once; switchdraw switches are separate decisions (each reveals a card); planned inputs
  that name a card not actually there drop the plan; adaptive paired world sampling with "don't act on noise";
  lazy position copies (only kept lines are copied); virtual time per engine step capped (a polling Casualty Draw
  step no longer spins minutes of timers). Tools: arena.js (parallel, mirrored deals), selfplay.js + fit.js
  (learned evaluation weights).
- **2026-10-03/04** — Game fix: the rank-zone keeper (moves the top Bank card into an empty Rank Zone) ran on a
  free 120 ms timer — a desync source online — now a render-time rule pass (deterministic checkpoints online, every
  render solo). Headless drops the page's display timers (animations, odometer, button refresh) which had cost ~1/3 of
  search time. Planner: prompt chains skip answers that lead round in a circle (use skill → cancel → same window);
  turn completion plays a real move when advancing is refused (must-attack after an Advantageous card); mid-action
  re-deals keep the opponent's just-played cards. Learned evaluation v1 from 42 self-play games (2,494 positions):
  held-out outcome prediction 77.6% vs 46.5% for the hand-set start. Threat features added (best attack damage each
  way, enemy cards beatable, raw Morale/Casualty/deck margins). Tier table (tiers.js) with the user's N schedule.
- **2026-10-03/04** — Phase-by-phase turn search (the old value-pruned search starved the Battle Phase: bots rarely
  attacked and games ran to deck-out). vs a random mover: 94.6% -> 100% (56/56, fixed effort 4,000); games 24 -> 7
  turns, decided by Morale / Casualties. Game fixes found by bot play: cards duplicating across zones (Subtract,
  'any'-source skills used from Drop/Deadzone, every move helper, Divide/Protect Star costs, Deckstroy), Drawbridge /
  Seven Heaven leaving an empty Rank Zone, stale prompt buttons firing, Stand Down placeholder ids, reaction windows
  reaching only one seat in 3-4 seat games. Live integration: thinking bots play every solo mode in the browser
  (Standard, Tournament, Gauntlet, AI vs AI, 1v1v1, Royale); tournaments draw random tiered fields and settle bot
  matches by the ladder's win rates; the Gauntlet climbs all 14 tiers. Measurements (fixed effort, 56 games each): 4x
  effort 58.5%; N=2 vs N=1 at equal effort 40%; temperature 0 vs 1 49%, 1 vs 3 54.5%, 3 vs 8 60.7% (the strength curve
  is shallow: the evaluation is the bottleneck). Next: a better evaluation from 2,000 self-play games, Δ card values
  from the same games, then tier calibration.
- **2026-10-03 (evening)** — Played full games against Distinguished 1 in the browser. Found and fixed by playing:
  (1) the bot followed the rest of a line chosen in ONE imagined world — knowing that world's hidden cards (it
  attacked an NP 0 Rank into NP 1 because its imagined casualty draws were good); (2) with lookahead, the first world
  could spend the whole budget, so later worlds scored only "end turn" and an attack seen in 1 world beat a pass seen
  in 5 — now candidates are found once and scored in every world (paired) and the bot re-thinks every decision;
  (3) bot inputs skipped the phase rules the human UI enforces (Plus played in the Promotion Phase to unlock bigger
  flanks; flanks in the Promotion Phase; Restorative 3 / Amalgamation at any time) — the input layer now holds every
  input to the table's windows, and bots may also Stand Down / Relieve wherever a player can; (4) `tryFlank` treated
  slot 'rear' as the Right Flank (any class) — the Extension Rear Flank is now its own placement for players and bots;
  (5) Counterstrike's "+2 NP until end of your next turn" was wiped at the end of the turn it was used. Judgment
  noise measured as the strongest strength dial (S0 vs S25 84.3%, S0 vs S60 92.7%); best (old planner, 3,000 evals)
  vs random 97.4% of 266 decided (7 losses, 11 unfinished — now recorded with seeds for replay).
