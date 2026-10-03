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

## Architecture

1. **Headless real engine** (`tools/headless/`): the game's own scripts run in Node with a small fake DOM
   (`fakedom.js`), a virtual clock (timers fire instantly, in order) and seeded randomness (`engine.js`).
   No second copy of the rules.
2. **Inputs = moves**: matches run as a "virtual online" game watched by nobody — both seats are driven purely by
   the same inputs a human makes (`{t:'adv'}`, `{t:'hand',id}`, `{t:'zone',o,z}`, `{t:'modal',i}`,
   `{t:'pick',ix}`, …), applied through the battle-tested online receiver path (`match.js`). No built-in bot code
   runs; whoever drives the inputs plays.
3. **No-paint mode** (`nopaint.js`): drawing functions become no-ops; every rule pass still runs in order.
4. **Save / rewind** (`state.js`): complete position snapshots at quiet points (G + both RNG streams + queues);
   restoring drops the abandoned line's prompts, timers and continuations.
5. Next: move generation (macro-moves from quiet point to quiet point), hidden-information sampling, evaluation
   learned from self-play, search (ISMCTS over macro-moves to depth N), calibration, integration (Web Worker),
   cleanup of the old bot code.

## Verification tools

- `parity.js` — same inputs with and without painting → identical fingerprints after every input.
- `reftrace.js record|check` — proves an engine change didn't alter any game (fingerprint traces).
- `leaktest.js` — snapshot, play K inputs, rewind, replay → identical fingerprints and identical game object.
- `smoke.js` — whole games on random inputs; determinism check.

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
