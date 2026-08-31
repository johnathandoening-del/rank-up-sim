# Game Report 4 — Making the AI Actually Think (audit + rebuild plan)

**Scope:** a read-only audit of the *entire* AI decision system and a concrete, no-patch plan to turn it from a reactive heuristic into an engine that actually reasons about the game — plans multi-turn lines, models your hidden information, and *knows what to expect* from game states (Wildfire draining MP every turn, a Reveal it should exploit, and the hundreds of other situations that today it walks past). **Nothing was changed.** This is the map before the build.

**Method:** I read every AI decision path in `index.html` — the two engines, the per-phase deciders, the evaluation functions, the difficulty ladder, the one lookahead it has, and the reactive layer — plus grepped the whole file for the two things it turns out to completely lack (opponent-hand memory: **0 hits**; general area-effect awareness in scoring: **1 hardcoded case**).

---

## PART 0 — The honest one-paragraph verdict

The bot is **greedy one-ply keyword scoring + a single shallow search over a fake, simplified combat model + a "roll a blunder" difficulty dial.** It does not simulate its own moves, it does not look ahead outside of attacking, it does not model your hand even after it literally reads it, and it has no concept of area effects, win conditions, or the clocks that decide the game. Every "smart"-looking decision is a regex match on card text. It plays the move the scoring formula forces on it. That is the whole thing. It is nowhere near a ceiling.

---

# THE MANDATORY STANDARD (this is the definition of "done" — not a goal, an acceptance test)

This is not "make it better." It is a hard, measurable bar the finished AI **must** reproduce, verified empirically by a self-play tournament **and** by you playing it across every mode. If the numbers below don't come out, it is not done, and I keep working until they do. The entire build is organized around passing this test, because a scripted/weights bot **cannot** produce a clean depth-monotone ladder — only genuine lookahead can. The ladder holding *is the proof the bot thinks.*

## S.1 — The tier ladder (weakest → strongest)
`Inept · Maladroit · Basic · Skilled 1 · Skilled 2 · Talented 1 · Talented 2 · D-Candidate 1 · D-Candidate 2 · D-Candidate 3 · Distinguished 1 · Distinguished 2 · Distinguished 3 · Distinguished 4`

## S.2 — The win-rate matrix (every pairing) — the generating rule
For any two tiers, let **k = rungs of separation**. The **stronger** side wins:
| k (gap) | Win split (stronger/weaker) |
|---|---|
| 0 (same tier) | **50 / 50** |
| 1 | **85 / 15** |
| 2 | **90 / 10** |
| 3 | **95 / 5** |
| 4 | **99.5 / 0.5** |
| **≥ 5** | **100 / 0** — never loses. "Not a conversation." |

This rule reproduces every pairing you specified exactly (Distinguished 4 vs Distinguished 3 = 85/15, vs Distinguished 2 = 90/10, vs Distinguished 1 = 95/5, vs D-Candidate 3 = 99.5/0.5, vs anything below = 100/0; and identically down the whole ladder). **Anchors that must hold no matter what:**
- **A tier is a mountain, not a rung.** Each step up must *feel* like a wall — decisively winning the step below, and utterly dominating anything two+ steps down.
- **Distinguished 4 is Grandmaster.** It never loses to anything playing below ~0.87 quality (its D-Candidate-3 floor). Magnus doesn't lose to a 2200; Distinguished 4 doesn't either. The moment a sub-D-Candidate-3 bot can *contend* with Distinguished 4, the build has failed.
- **Inept is bottom-of-the-barrel** — it makes the most mistakes, only 50/50 with itself, and should not beat anything above Maladroit.
- Every anchor holds **going first or second** (initiative must not flip a result it shouldn't), and **with and without Evolutions** (Δ Deck / Δ Zone), across **all modes**.

## S.3 — The search-depth schedule (this is *where the gap comes from*)
Difficulty = **how many plies of the real game the bot looks ahead**, period. No blunder dial. `N` is a full **game-tree depth**: *my whole turn → the opponent's best-reply whole turn → my reply → …*, using the belief model for their hidden cards. A move is chosen by the value of the position `N` plies later, not by its immediate score. This is exactly why chess ratings separate the way they do, and it's the mechanism that produces S.2.

| Tier | Base N | Occasional N | ~Frequency |
|---|---|---|---|
| Distinguished 4 | **7** | — (always 7) | — |
| Distinguished 3 | 5 | **6** (up) | 1 per ~10 turns |
| Distinguished 2 | **5** | — (always 5) | — |
| Distinguished 1 | 4 | **5** (up) | 1 per ~7 turns |
| D-Candidate 3 | 4 | **5** (up) | 1 per ~10 turns |
| D-Candidate 2 | **4** | — (always 4) | — |
| D-Candidate 1 | 4 | **3** (down) | 1 per ~7 turns |
| Talented 2 | 3 | **4** (up) | 1 per ~10 turns |
| Talented 1 | 3 | **2** (down) | 1 per ~7 turns |
| Skilled 2 | 2 | **3** (up) | 1 per ~7 turns |
| Skilled 1 | 2 | **1** (down) | 1 per ~5 turns |
| Basic | 1 | **2** (up) | 1 per ~7 turns |
| Maladroit | 1 | **2** (up) | 1 per ~10 turns |
| Inept | 1 | **2** (up) | 1 per ~15 turns |

(The `.1` sub-tiers occasionally *dip* — they sit at the bottom of their band; the top-of-band and floor tiers occasionally *flash* one ply deeper. This maps onto the existing `ruEffectiveDepthFor` `{depth, occ, every}` slots — the plumbing exists; what's missing is a search worth pointing it at.) **Note:** a deeper search only beats a shallower one if BOTH share the same strong evaluation — otherwise depth searches garbage. So depth is necessary but not sufficient; it must sit on top of a real `evalState` (below). The calibration harness is what proves the pairing of depth + eval actually yields S.2.

---

# HOW WE GUARANTEE *ACTUAL* THINKING (not weights, not scripts) — and how we prove it

Your skepticism is the correct default. Here is the design that makes thinking real, followed by the harness that makes it **verifiable instead of a promise.**

### T.1 — It searches the REAL game, including the opponent's replies
Every decision runs a negamax/expectimax over the **headless forward model** (Part 4, Layer 1): apply my candidate move, then have the opponent play *their* best reply (drawn from the belief model over their hidden cards), then my reply, `N` plies deep, and score the **resulting position** at the leaf. Consequences are not an afterthought — they're the whole computation. This is why it can **rebound**: it never commits to a line whose refutation it can see, and it *re-searches from the actual state after every event*, so if a skill/attack gets negated, blocked, or backfires, the very next decision plans out of the new reality instead of running a dead script.

### T.2 — It evaluates position and resources, not one-turn material
`evalState` scores a whole position by features that decide games (Part 4, Layer 2 + the Part 5 knowledge layer): the clocks (MP→0, casualty→15, deck→0, Morale), tempo/initiative, card advantage across hand/Bank/**Deadzone**, standing area effects, board power, and **future potential**. Critically it values things that *look* like a loss but are a gain:
- A **card in your Deadzone that can still act** — Phantom 1, Restorative 3, Phantom 6, Haste 7, and every DZ-usable skill — is scored as a live asset, so **losing a battle that lands your recursion piece in the DZ scores higher than a hollow "winning" board.** (Your exact example.)
- A **Bank being built toward a payoff** (Light 8 → the 9 surge; the escalating "8" combos) is worth more than its face material.
- A **setup skill that enables next turn's stronger play** outscores an immediate but hollow swing, because the search sees the stronger position two plies later.

### T.3 — Non-aggression, survival, and comebacks are first-class outputs
Because the leaf is evaluated `N` plies out, a defensive/stall/setup line that reaches a winning position beats an aggressive line that wins *this* exchange but loses the game. "Play to stay alive so I can come back" is not a special case — it is literally what a deep search returns when the aggressive line loses at depth. The bot will pass on a "free" trade, hold a Safeguard/Cease for the swing that matters, and bait a negate — because those score better at depth.

### T.4 — Combos and card-fit emerge; they are not scripted lists
The forward model *executes* skill+action+skill sequences, so a two-card combo — or a card that fits a *different* combo better than the obvious one — is discovered by search, not hardcoded. Openings and going-first-vs-second fall out naturally: they are just different search roots with different tempo, plus an optional thin per-class opening prior; the first and second player genuinely play differently, like White and Black.

### T.5 — THE GUARANTEE: an empirical calibration harness (this is the part that makes S.2 real)
This is the difference between "it should be smart" and "it is smart, and here's the receipt." I build a **headless self-play tournament runner** on top of the forward model:
1. For **every** tier pairing in S.2, play **thousands of seeded games** — both seatings (first/second), 1v1 **and** 1v1v1, **with and without** Evolutions.
2. Measure the actual win split per pairing.
3. If any cell misses its S.2 target (within a tight tolerance), **tune that tier's depth / branching width / evaluation-completeness** and the shared `evalState` weights — then re-run.
4. **Repeat until every cell of the matrix passes.** I do not stop, and I do not call it done, until the harness reproduces S.2 top to bottom.

Why this is the proof, not marketing: a placeholder-weights or script bot produces a **flat, noisy** ladder (Inept beats Distinguished sometimes — exactly today's bug). Only a real evaluation + genuine depth produces a **monotone, decisive** ladder where +1 tier = 85/15 and +5 = 100/0. If the harness shows S.2, the thinking is real by construction. If it doesn't, the build isn't finished. And because the harness is headless and seeded, it's reproducible — you can re-run it, and you'll play the finished bot yourself to confirm it *feels* like S.2 from the seat, not just on paper.

### T.6 — Self-play tuning of the evaluation (so weights aren't guessed)
The `evalState` feature weights are **not** hand-set numbers we hope are right (that's the current failure). They are tuned by **self-play**: the harness runs games, credits the features that correlate with winning, and adjusts — a small, honest optimization loop — until the top tier's play is coherent and the ladder in S.2 holds. Weights that don't earn their keep in self-play get cut. This is how "actual thinking" replaces "placeholder weights."

---

# SCOPE — non-negotiable coverage

- **Every mode:** 1v1 vs human, **1v1v1**, AI-vs-AI, Gauntlet, Tournament, and any mode not named — the standard applies to all of them (the brain is mode-agnostic because it operates on game state, not on a mode).
- **With and without Evolutions** (Δ Deck / Δ Zone): the forward model and `evalState` must fully model Amalgamations (the Δ Zone) — defeat routing, elements, the works — so the ladder holds identically whether Evolutions are on or off.
- **Verified from the seat, not just on paper:** after implementation, **I play it myself** across modes and tiers to confirm it plays like the standard describes — that Distinguished 4 feels near-unbeatable and Inept feels like it barely knows the rules — because you will absolutely be able to tell, and a passing harness that *feels* wrong in-hand is not a pass.

---

## PART 1 — Exactly how it decides today

### 1.1 Two engines, both heuristic
- **Legacy `_aiBase` / `aiDo` chain** (drives the `ai` seat in 1v1 / Gauntlet / Tournament). Per-phase inline greedy logic.
- **`ru135RunBotSide`** → `botPromote` / `botRally` / `botMain` / `botBattle` / `ruSmartSkillPass` (drives `ai2`, and `ai` in 1v1v1 / AI-vs-AI). This is the "newer" brain and the one worth rebuilding around.

### 1.2 Per-phase decisions — all one-ply, all a formula
| Phase | Function | How it "decides" | Lookahead |
|-------|----------|------------------|-----------|
| Promotion | `botPromote` (~13161) | score = `numeral*3 + rank*4 + M*3 + jump*6 + rankJump*5 + skillQ*0.6`; take the top (or the **worst** on a failed difficulty roll) | **none** |
| Rally | `botRally` (~13189) | score = `numeral*3 + rank*4 + M*2 + skillQ*0.5`; place best 2 flanks | **none** |
| Main (Action Cards) | `botMain` (~13232) | `actionScore` (keyword regex), fire best within `A` slots | **none** |
| Skills | `ruSmartSkillPass` (~13146) | `skillScore` (keyword regex), fire best within `maxSkills` | **none** |
| Battle (attacks) | `botBattle` (~13322) | per-attacker `smartTargetFor`, plus `_ruCombatPlan` for tie/losing trades | **the only lookahead — and it's fake (see 1.4)** |

Everything except attacking is **0-ply**: pick the highest-scoring option right now, with no idea what happens next turn.

### 1.3 The evaluation is a bag of keywords, not a simulation
`skillScore` (~10647) and `actionScore` (~10911) score a card by **regex-matching its text**: `+20` for "attack up to", `+28` for "another attack", `+24` for "directly", `+18` for "add one/search/draw", `+20` for "opponent loses/casualty/mill", `-30` for "cannot attack this turn" in battle, etc., plus `classPlanBonus` (a per-class weight table) and a handful of board-size checks (`hand<2 → -18`, `bank<1 → -22`). It **never runs the skill** to see what it actually does or what state it leaves. `boardPower` (~11673) is raw material: `np*16 + rp*10 + A*5`. There is no notion of card advantage, tempo, initiative, or winning *lines*.

### 1.4 The one "search" is over a made-up game
`_ruCombatPlan` (~22516) is a real negamax with pruning — but it searches an **abstraction, not the game**. Every card is flattened to `{np, rp}`; the entire game is modeled as MP + casualty exchanges (`resolveAttack` at ~22523 is a toy combat resolver, *not* the real `resolveAtk`). Its leaf evaluation (`leaf`, ~22557) is `(myMP − foeMP) + material*0.4 − casDiff*casW*0.5`. So even the lookahead the bot has is planning a **different, simpler game** than the one being played — no skills, no Action Cards, no deck, no area effects, no randomness. `botBattle` feeds it `{np,rp}` snapshots (~13343) and uses the result only to decide which *tie/losing* attacks to commit.

### 1.5 Difficulty is a self-sabotage dial, not intelligence
`RU_LADDER_ERROR_RATE` (~22487) is 14 rungs from `0.94` error (Inept) to `0.003` (Distinguished 4). `ruRollCorrect(w)` (~22495) is a per-decision coin flip weighted by tier. On a **failed** roll the bot doesn't "think less" — it deliberately takes the **objectively worst** option (worst promotion, worst flank, worst attack target, opposite of the right commit — see the comments at ~13180, ~13360). `ruEffectiveDepthFor` (~22496) does scale search *depth* by tier, **but only `_ruCombatPlan` reads depth** — promote/rally/main/skills ignore it entirely. So "harder" mostly means "blunders on purpose less often," not "sees further."

### 1.6 The reactive layer
Safeguard / Retaliatory / opponent-turn responses (the `ru172` family, seat-parameterized in earlier work) are also **threshold heuristics** ("if attacked and I hold a Safeguard, maybe use it") — no evaluation of whether spending the card now beats holding it, and no lookahead.

---

## PART 2 — The five things it fundamentally lacks

1. **A forward model of the real game.** It cannot ask "if I do X, what does the board actually look like, and what's my best reply to their best reply?" for anything but the fake combat abstraction. This is the root of everything.
2. **Opponent modeling.** Grepping the whole file for any hand-knowledge memory (`knownHand`, `oppHand`, `revealedHand`, `_seenHand`, …) returns **zero**. When the AI plays **Reveal / Spy / Astute 1/3/5/8/9** and literally sees your hand or deck, it **throws the information away**. It plays as if your hidden cards don't exist.
3. **Game-state awareness ("what to expect").** No general model of the strategic situation. It does not know that an active **Wildfire** means it bleeds MP every turn until removed, that **The Lowlands** locks alt-win-cons and hits −9 MP, that it's one **casualty** from `cas=15` (loss), or that it's about to **deck out**. There is exactly **one** hardcoded area case in all of scoring (Inferno 1 avoids fetching a duplicate Wildfire, ~10692). Everything else about the board's *meaning* is invisible to it.
4. **Multi-turn planning and combos.** It plays move-by-move. It doesn't set up a Shadow-8 multi-attack line, a mill-to-deck-out plan, a Seven-Heaven six-7s win, or a lockdown — beyond a single card's immediate keyword bonus.
5. **Difficulty by depth, not dice.** A weak human doesn't *choose* the worst move; they just don't see as far. The current model has this backwards.

---

## PART 3 — The blocker: why it can't search the real game today

The game logic is **fused to the UI and to global mutable state**, so you cannot cheaply say "simulate this move on a copy." Specifically the rules code:
- **mutates the single global `G`** in place (no clean clone/apply/undo),
- **opens modals / pickers** (`openModal`, `openPicker`, `chooseCards`, …) and waits for a *human click* to continue,
- **drives flow with `setTimeout`** (the `aiDo` 680 ms think-timer, `beginPhase` chains, the casualty-draw queue `step()` which defers on open modals),
- **renders to the DOM** (`renderAll`) as part of resolving effects,
- **uses randomness** inline (`shuffle`, casualty draws, random-Bank picks) with no seeding or expectation handling.

The smoking gun is the **`ru167` "AI-vs-AI modal safety net"** (~22605): AI-vs-AI mode had to install a global auto-resolver at the UI primitives because "many individual card/skill interactions were written assuming a human is present to click." That is the exact wall a search engine hits — the rules can't run to completion without a human unless something fakes the clicks. **You cannot build a real AI on top of rules that can't be executed headlessly and deterministically.** So the foundation must come first.

---

## PART 4 — The rebuild plan (remove/replace, no patches)

Built in layers; each is independently testable. The order matters — the forward model is the keystone.

### Layer 1 — Headless simulation core (the foundation, the hard part)
- **A serializable state snapshot** (`cloneState()`): deep-copy of `G` reduced to game facts (zones, hands, decks, MP, cas, timers, flags), no DOM/closures.
- **A synchronous, side-effect-free `applyMove(state, move)`** that resolves a move (promote / flank / attack / skill / action / reactive) fully in memory: no modals, no `setTimeout`, no `renderAll`, no logging. This means extracting the *rules* out of the UI-coupled effect fns into pure functions the live game and the simulator both call. (This also permanently kills the class of "AI-vs-AI stalls on a missed modal" bugs and lets the `ru167` net be deleted.)
- **Deterministic/seeded randomness**: a seedable RNG so a simulated line is reproducible, plus an *expectation/sampling* mode for genuinely random effects (shuffles, casualty draws) so search can average outcomes instead of committing to one lucky roll.
- **Move legality/generation** (`legalMoves(state, seat, phase)`): the full set of legal choices for a seat in a phase, including skill sub-choices.

*This is the majority of the engineering.* Everything above it is comparatively small.

### Layer 2 — A real evaluation function `evalState(state, seat)`
Replaces keyword scoring with features that actually decide games:
- **MP race** (yours vs each opponent; distance to 0 = loss).
- **Casualty clock** (distance to `cas=15` loss; and `cas=−7`, the negative-Deadzone threshold).
- **Deck-out clock** (deck size; running out = loss) — huge for Deckstructive/Astute mill plans.
- **Card advantage** (hand + playable Bank + recurable Deadzone).
- **Board power & initiative** (who can attack profitably next).
- **Tempo / attacks-remaining.**
- **Win-condition proximity** (per class — see Part 5).
- **Active-area deltas** (the standing MP/NP swing an area is applying every turn — see Part 5).
Weights tuned by self-play, not guessed.

### Layer 3 — Search (difficulty = depth, not dice)
- **Expectimax / negamax over whole turns** (promotion→rally→main→standby→battle→end as one planned sequence), with alpha-beta and move-ordering from Layer 2. Chance nodes for random effects (sampled).
- For the branchier states, **MCTS** is the natural fit (handles hidden info + randomness gracefully).
- **Difficulty tiers = search depth (`N` from the S.3 schedule) + branching width + evaluation completeness.** The 14 rungs use the exact per-tier `N` in **S.3** (Distinguished 4 = 7 plies always; Inept = 1 ply, a rare flash of 2), fed through the existing `ruEffectiveDepthFor` `{depth, occ, every}` slots. Delete the "pick the worst option" self-sabotage entirely — weakness comes from *not seeing as far*, exactly like a real weak player. `N` counts **both my plies and the opponent's reply plies** (full game-tree depth), not just my own turns.

### Layer 4 — Opponent belief model
- Maintain a **belief over each opponent's hidden hand/deck** derived from public information: opening hand size, cards drawn, cards played/discarded/ceded, and — critically — **direct reveals** (Reveal, Spy, Astute 1/3/5/8/9, and any "look at" effect). When the AI sees your hand, it **records and uses it**: plays around your known Safeguards, times attacks to dodge your known counters, and picks disruption that strips your known plan.
- Feed the belief into search as **determinizations** (sample plausible opponent hands, search each, average) — the standard way strong imperfect-information engines handle this.

### Layer 5 — Knowledge / "what to expect" layer
Encode the strategic meaning of game states as **evaluation features and search priors**, so the strong tiers automatically respect them (full catalog in Part 5): active area effects, per-class win conditions, the clocks, standing threats, and the major card-interaction archetypes. This is where "if Wildfire is up against me, I'm on a burn clock — race or remove it" and "I've seen his hand, he has no answer to a direct attack — go face" live.

### Layer 6 — Integration (no patches, remove/replace)
- Route **both** engines' phase deciders through one `chooseMove(state, seat, phase, depth)` backed by Layers 1–5. `botPromote/botRally/botMain/ruSmartSkillPass/botBattle` and the legacy `_aiBase` branches become thin adapters that call it.
- Keep the old keyword heuristics **only** as a last-resort fallback for any effect not yet in the simulator, and shrink that set to zero over time.
- Delete `ruRollCorrect`'s worst-option branch; keep the ladder but redefine each rung as (depth, width, eval-completeness).

---

## PART 5 — The knowledge catalog: "every little thing" a strong AI must know

This is the list the user is asking for — the situations the bot currently ignores. Each becomes an evaluation feature and/or a search prior in Layer 5.

### 5.1 Active Area Cards — what each *means* when it's in a Deadzone (for and against)
The AI must read the live area state and price its standing effect into every turn's plan:
- **Wildfire (Inferno):** after 3 turns, every player loses MP = their board RP each opponent Main Phase → a **burn clock**. If it's against you: race or remove it. If it's yours: stall and protect it. *(Today: not modeled at all beyond avoiding a duplicate fetch.)*
- **The Lowlands (Negative):** −9 MP to all others on entry, **cannot be removed**, **all alt-win-cons negated**, decks recycle. Massively changes what's winnable — the AI must abandon mill/alt plans and play the MP/casualty game.
- **Frozen Tundra (Blizzard):** Blizzard +1 NP / Inferno −1 NP while in Deadzone → shifts every combat math on the board.
- **Dark Domain (Shadow):** mill + all Benevolent −1 NP; Rank-0-flank lockdown finisher.
- **Shining Justice (Light), Higher Ground (Maximum), Drawbridge (Deckstructive), Halcyon Highlands (Restorative), Fast Track (Haste), The Library (Astute), Seven Heaven (7th), Dreadnaught Airship (Zero), Morbid Cemetery (Phantom)** — each has a passive + once-per-turn + once-per-war effect that reshapes the board (NP swings, attack denial, MP swings, casualty draws, recursion). All must be priced in.
- **Class-specific and neutral areas (Fission/Extension too).** The eval needs an "area-effect vector" per side each turn.

### 5.2 Win conditions per class (the AI should *pursue* its own)
Each deck wins a different way; the AI should steer toward its own and deny the opponent's:
- Deck-out/denial (Deckstructive, Astute), casualty race (Inferno, Negative, Phantom), lockdown (Blizzard, Zero, Shadow), tempo/burst (Maximum, Haste), recursion grind (Restorative, Extension), the **Seven Heaven six-7s** alt-win (7th), MP-drain, and the standard MP=0 / cas=15 outs. `CLASS_PLAY_STYLE` (~10520) already *hints* at this per-class weighting — the rebuild makes it an actual objective, not a scoring nudge.

### 5.3 The clocks (terminal-distance awareness)
- **MP → 0** (you lose), per side.
- **Casualty → 15** (you lose); **→ −7** (negative-Deadzone threshold).
- **Deck size → 0** (deck-out loss on the next mandatory draw).
- Distance to each of these is a first-class eval feature and a search tiebreaker (take the line that wins the race, not the one with the prettiest board).

### 5.4 Reveal / knowledge exploitation
Every "look at opponent hand/deck" effect must update the belief model and change subsequent play: known Safeguards → don't walk into them; known lack of answers → commit; known key card → strip it with disruption. *(Today: 100% wasted.)*

### 5.5 Reactive-window judgment
Safeguard / Retaliatory / opponent-turn skills evaluated by **"is spending this now worth more than holding it,"** via a shallow search of the defense, not a threshold.

### 5.6 Card-interaction archetypes (the "hundreds of circumstances")
Rather than 200 special-cases, the simulator makes these *emergent* — because search actually resolves the effect and evaluates the result. The strong AI will then naturally: extend multi-attack "8" combos (Shadow 8 / Inferno 8 / etc.), value Deadzone recursion (Phantom 1, Restorative 3), set up Chief-Flank / promotion-into-skill lines, race mill vs casualty, respect frozen/negated states, and weigh MP costs against payoff — all without hand-authored rules, because it can *see the consequence*.

---

## PART 6 — Difficulty redesign (implements the S.3 schedule)

Replace the blunder dial with a monotonic ladder of **capability**, per the exact **S.3** depth table:
- **Search depth `N`** — the primary lever, set per tier by S.3 (Distinguished 4 = 7 always; Inept = 1 with a rare flash of 2). `N` is full game-tree depth (my plies + opponent-reply plies), with the `{depth, occ, every}` occasional bumps/dips exactly as S.3 specifies.
- **Branching width / pruning** scales with tier (top tiers consider more lines before pruning).
- **Evaluation completeness**: low tiers use a coarse eval (material + MP only) and no belief model; high tiers use the full feature set + opponent modeling + determinization sampling.
- **Knowledge access**: low tiers ignore area/win-con/clock features; high tiers price them all in.
Result: a low tier is *genuinely* weaker (short-sighted, unaware) and a high tier is *genuinely* strong — the gap is real skill compounding over a match, which is what produces the S.2 win-rate matrix. **The blunder dial (`ruRollCorrect`'s worst-option branch) is deleted** — a weak tier is weak because it can't see far, never because it throws on purpose.

---

## PART 7 — How we prove it's real (verification = the S.2 acceptance test)

The primary proof is **the calibration harness reproducing the S.2 matrix** — that is the definition of done. Supporting probes:
- **The S.2 tournament (the gate):** every one of the 14×14 pairings, thousands of seeded games each, both seatings, 1v1 and 1v1v1, Evolutions on and off. Every cell must land on its S.2 target within tolerance. A weak-tier win over a 5+-rung-stronger tier is treated as a **defect to fix**, not accepted variance.
- **Monotonicity & separation:** each tier beats the one below decisively (≥85/15) and dominates 2+ below — no coin-flips between adjacent bands, no upsets across bands.
- **Tactics suite:** hand-built positions with a single correct line (a free win it must take, a Cease it must hold, a DZ-recursion "loss" it must accept, a lethal race it must win, a negate it must play around). Top tiers pass; low tiers fail by *not seeing it*, not by throwing.
- **Knowledge probes:** with Wildfire up it shifts to remove/race; after a Reveal its next plays use the seen cards; against a mill deck it protects its Deck; holding Phantom 1/Restorative 3 it accepts a battle loss to set up the DZ replay.
- **No-hang guarantee:** AI-vs-AI runs to completion with the `ru167` safety net *removed* — proof the headless forward model is complete and deterministic.
- **The human check (you):** after it passes on paper, **I play it myself** across modes and tiers, and you play it, to confirm it *feels* like the standard — Distinguished 4 near-unbeatable, Inept clueless. A harness pass that feels wrong in-hand is not a pass.

---

## PART 8 — Honest scope, risk, phasing

- **This is a real project, not a tweak** — up to and including ripping the current bot out by the roots, which you've authorized. ~80% of the effort is Layer 1 (extracting pure, headless, deterministic rules from UI-coupled effect fns). Layers 2–6 are comparatively small once the forward model exists.
- **Risk is concentrated in Layer 1** (behavior parity between the live rules and the simulator). Mitigation: build the simulator by *calling the same extracted rule functions the live game uses*, and add a parity harness (simulate a move, apply it live, assert identical resulting state) so drift is caught immediately.
- **On variance and the "100/0" cells (honest, no hand-wave):** the game has real randomness (shuffles, casualty draws, random-Bank picks). "100/0" does **not** mean I pretend dice don't exist — it means the skill gap must be made **so large that variance cannot bridge it across the calibration sample**, exactly like a Grandmaster not losing to a beginner even though chess has no dice and this game does. If a 5+-rung-weaker bot ever wins, that is a **miscalibration to fix** (deepen/tune the stronger tier, add mulligan logic, sequence to avoid needlessly swingy lines) — **not** an outcome I accept and explain away. The bar is the bar.
- **The build is gated on the S.2 harness — I do not stop until it passes** (and feels right in-hand across all modes, Evolutions on and off).
- **Phasing (each phase independently shippable, remove/replace, no patches):**
  1. Extract headless rules + `cloneState`/`applyMove`/`legalMoves` + parity harness (delete `ru167`).
  2. Real `evalState` + short-depth full-turn search behind one `chooseMove`; route `ru135` phase deciders through it.
  3. Depth-scaled difficulty on the exact **S.3** schedule; delete the blunder dial.
  4. Opponent belief model + reveal exploitation + determinization.
  5. Knowledge layer (area/win-con/clock/tempo/recursion features) + reactive-window search + comeback/adaptation.
  6. **Build the S.2 self-play tournament harness; tune depth/width/eval by self-play until every matrix cell passes** — all modes, both seatings, Evolutions on/off. Fold the legacy `_aiBase` seat onto the same brain; shrink the heuristic fallback to zero.
  7. **I play it, you play it** — confirm the standard from the seat, then it's done.

---

## PART 9 — What "actual thinking" looks like in this game (your principles, made concrete)

The engine must embody these — and because they're evaluated by real search over the real game, they are *behaviors that fall out of depth + a good eval*, not scripted rules:
- **A loss can be a gain.** Accept a battle loss that lands Phantom 1 / Restorative 3 (or any DZ-usable skill) in your Deadzone, because next turn it acts from there — the search scores that resulting position above a hollow "win."
- **Setups vs payoffs.** Value a skill/card that *enables* a stronger play next turn over an immediate but hollow swing (Light 8 banking toward the 9 surge; filling Bank/DZ for a combo).
- **Survive to come back.** When aggression loses at depth, the search chooses the defensive/stall line that keeps you alive into a winning position — non-aggressive play is a first-class output.
- **Cards fit multiple combos.** The same card may serve a *different* combo better; search finds the better fit instead of a fixed pairing.
- **Resources are position.** MP, hand, Bank, Deck, Deadzone, Morale, tempo/initiative and area state are all evaluated together — not "did I win a card this turn."
- **Speed differentials.** Some plans are simply faster (aggro vs grind vs mill vs casualty vs deck-out); the clock features let the AI pick the race it wins and deny the opponent theirs.
- **Openings & going first/second.** First and second seats are different search roots with different tempo (like White/Black), plus a thin per-class opening prior — the AI opens differently on the play vs the draw.
- **Rebound when refuted.** Because it re-searches from the true state after every event, a negated/blocked/backfired play just leads to the next-best line — it adapts instead of running a dead script.

The difference between *appearing* strategic and *being* strategic is exactly this: a keyword-scorer can look busy, but only a search that evaluates the real resulting position N plies out can actually pull these off. The S.2 harness is the line between the two — and it's the line I won't call "done" until it's crossed.

**Bottom line:** the current bot is a keyword-matcher with a blunder dial and a toy combat search. Making it *think* is entirely doable in this codebase with no external anything — but it is gated on one real piece of engineering: a clean, headless, deterministic forward model of the game. Build that, and the rest (search, evaluation, opponent modeling, knowledge) is standard game-AI work that will produce a bot that plans, punishes, exploits what it sees, and gets genuinely sharper as difficulty rises.

---

# APPENDIX A — Every card, and the strategic state the AI must factor in

Wildfire and Reveal were two examples of a hundred. This is the whole board. For each card: the mechanical hook, then **the state-awareness / plan the strong AI must have** — both when *it* holds the card and when the *opponent* does. In the rebuild these become evaluation features, search priors, and belief-model triggers; nothing here is a special-case hack, because a real forward model makes most of it emergent.

## A.1 — Area Cards (all 15) — each rewrites the board while in a Deadzone

| Area (class) | Effect | What the AI must factor in |
|---|---|---|
| **Shining Justice** (Light) | Light +1 NP in DZ; ≤3×/game negate a Malevolent skill (drop 2); 1×/game drop hand(3+) → opponents can't attack 3 turns | Live +1 NP shifts every Light combat; the skill-negate is a held interrupt to time against the opponent's key skill; the attack-lock is a tempo bomb worth stalling toward. Against you: your Malevolent skills may get negated — bait it. |
| **Wildfire** (Inferno) | after 3 turns in DZ, everyone loses MP = their board RP each opp Main Phase; 1×/game drop hand → send opp Rank+Flanks to DZ, all lose 10 MP | A **burn clock**: race, or remove/neutralize before turn 3; keep your board RP low if it's against you. The nuke is a game-ender to play around. |
| **Frozen Tundra** (Blizzard) | Blizzard +1 NP / Inferno −1 NP in DZ; drop a Blizzard to negate an attack; if the attacker was Inferno, it can't attack next turn | Standing NP swing changes clash math on every trade; the negate is a per-attack interrupt (hold a Blizzard). Against an Inferno deck it's a soft lock. |
| **Dark Domain** (Shadow) | Shadow +1 NP in DZ; 1×/turn mill 1 → all Benevolent −1 NP EoT; 1×/exchange negate a Shadow skill cost; 1×/game cede hand → all opp Numerals become Rank-0 Flanks | The Benevolent −1 is repeatable board control; the cost-negate enables expensive Shadow skills for free; the finisher strips the opponent's Rank Zone — a win-con to set up. |
| **Higher Ground** (Maximum) | on a Maximum-Rank-Up turn → opponent can't use skills that turn; 1×/game drop hand + mill = cards → all your Maximum Numerals become Rank MAX | Synchronize Maximum Rank Up with the skill-lock to alpha-strike safely; the mass Rank-MAX is a burst-finisher window. |
| **Drawbridge** (Deckstructive) | opp adds cards outside Draw Phase → mill 1 each; drop a hand card → opp mills = its Rank; hand≥7 → everyone redraws; pay 5 MP → all draw 2 + opp adds 1 from DZ | Pure **deck-out engine** — every opp draw/search is punished; track the opponent's deck size as the real clock, not their MP. |
| **The Lowlands** (Negative) | all others −9 Morale on entry; **cannot be removed**; **all alt-win-cons negated**; decks recycle instead of deck-out | Game-defining: abandon mill/alt plans (they're off), the deck-out clock is gone, play the MP + casualty race. The −9 swing is a huge tempo hit to plan the entry timing of. |
| **Halcyon Highlands** (Restorative) | Phantom −1 RP in DZ; 1×/exchange drop hand+deck top → +1 MP per hand card; 1×/war send hand(5+)+top20 deck → +20 Morale, can't attack 3 turns | MP-engine (reward for a big hand); the once-per-war is a huge Morale swing at the cost of tempo — sequence it when safe. The −1 RP hoses Phantom clash/casualty math. |
| **Fast Track** (Haste) | Haste +1 NP on opp turn; on a Haste Rank-Up, attack 3× for 8 MP; 1×/turn negate a Safeguard activation; 1×/exchange if you attacked on opp turn → Rank +2 NP and attack again | Opponent-turn tempo engine; the Safeguard-negate lets Haste push through defenses — sequence attacks to bait then negate. |
| **The Library** (Astute) | Retaliatory vs Astute → 2 MP back to user; 1×/turn pay 3 MP → peek/drop opp hand OR reorder a deck OR fetch Astute; 1×/war pay 15 + drop hand → look top 7 of all decks, drop 2 each | A repeatable **information + disruption** engine — this is exactly where the belief model compounds: peek every turn, drop their key card, fetch answers. |
| **Seven Heaven** (7th) | a Numeral 7 can be used as a Flank **without needing Chief Flank or relief from any player** (treated as Rank≤2); 1×/turn: +2 MP per 7 on all fields OR each opp −2 MP per non-7 on their field OR negate a 7's skill cost / a non-7 skill activation; 1×/war destroy all your non-7s (min 2) → nobody attacks 7 turns | Free-flank flexibility for 7s + MP swings + a board-reset finisher. **Correction: the six-7s win condition is NOT this area — it is the Talented Numeral-7 "Ascendant" skill (see A.2, 7th). Seven Heaven merely *enables* the 7s to be deployed freely; the win-con lives on Ascendant.** The AI must value Seven Heaven as the setup that lets an Ascendant/six-7s plan operate, not as the win itself. |
| **Dreadnaught Airship** (Zero) | on entry → all Numerals lose all NP that turn; 1×/turn (discard): set a Numeral's A to 0, or stop an opp gaining Morale, or pay MP to zero a Numeral until it leaves; 1×/war cede hand NP ≥ 2× an opp's Morale → that opp's Morale → 0 | A **lockdown/denial** engine; the once-per-war is a direct kill line if the opponent's Morale is low — track their Morale as a hittable target. |
| **Morbid Cemetery** (Phantom) | doesn't count to your Casualty Count; Phantom+Shadow +1 NP, Restorative+Light −1 NP in DZ; 1×/turn return a Phantom sent to your DZ by a Retaliatory/opposing skill; 1×/war drop → casualty draws = cards dropped, can't attack 3 turns | Lets Phantom **recur from the DZ** and safely stack casualties (the casualty race is Phantom's win-con); the once-per-war is a big casualty burst. |
| **Obelus Oubliette** (Fission) | while in DZ/field, all players +1 MP whenever a Fission skill activates; 1×/turn mill 1 → negate the next Double/Multiply/Multi-Star effect | MP-engine tied to Fission skill frequency; the Multiply-family negate is a held counter to the opponent's doubling burst. |
| **City of Recreation** (Extension) | with 2+ Extension Numerals, Flank cards can't be destroyed in battle (per turn); shuffle 4 Drop → Deck (cost) | A **Flank shield** that flips combat math — value building 2+ Extension Numerals; the recycle fuels Extension's Drop-return engine. |

## A.2 — Numeral skills, class by class (every Numeral)

Legend: **★** = defines a class win-con / high-value combo the AI must actively pursue. "Basic" = stat-stick (still matters as combat NP/RP the eval must weigh; no special awareness).

**Light** — 0: reactive *no Morale/Casualty from attacks involving it* → **hold as a defensive wall, time it on your key card**. 1: fetch a Light card → consistency/finding 0 & 9. 2: Rank Zone +1 attack → tempo. 3: reactive *negate an attack + bounce your Numeral to hand* (lose MP=RP) → a held interrupt that saves a card. 4/5: Basic. 6: reactive *negate all Morale on this card* → defensive wall. 7: drop 2 your DZ + opp drops 1 (no attack) → DZ swing + denial. 8: invest 2 Light from Discard to Bank (no attack) → **Bank-builds toward the 9 combo** (recursion). ★9: S1 Rank³-lock; S2 Shining-Justice surge — NP = Light RP in Bank, gain MP, attack up to Flank-count times, stand down a Flank each hit → **the Light burst finisher; the whole deck sets this up (8→Bank, area in DZ)**.

**Inferno** — 0 (Bank): negate Wildfire's own first effect → protects your Wildfire engine. 1: send a Wildfire to DZ → **arms the burn clock (don't fetch a duplicate)**. 2: Rank Zone +1 attack. 3: opponents −3 MP (to DZ) → **direct MP burn (all opponents)**. 4: Rank +1 attack, opponents −3 MP at Damage Step → tempo + burn. 5/6/7: Basic (note their negative M). ★8: *attack up to a Bank card's Numeral times*, +MP after 2 hits, opp −MP=RP each hit → **the escalating multi-attack combo — set up the Bank/hand cost, it's worth far more than one swing**. 9: opp loses MP = lowRank × RP of 2 highest (no attack) → big burst MP burn.

**Blizzard** — ★0: reactive *freeze the attacker until end of opp next turn* → **repeatable lockdown; the core of Blizzard's control win**. 1: fetch a Safeguard → defensive consistency. 2: opp Rank Zone −1 NP + can't attack next turn → soft lock + debuff. 3/4: Basic. 5: mill on attack → if Blizzard milled, target −2 NP → mill-synergy + debuff (**deck-out awareness**). 6: *neither player can attack this turn* + opp drops 1 DZ → **hard tempo lock (freeze the whole board)**. 7: if milled an Action, fetch 2 Safeguards + *nobody takes damage until your next turn* → total defensive wall. ★9: place a Blizzard Digit in the opponent's Flank that can't be removed for RP turns → **a permanent blocker jammed onto the opponent's board (lockdown finisher)**.

**Shadow** — 0: use an Advantageous Action's **second** effect → flexible value. 1: fetch a Shadow card → consistency. 2: Rank +1 attack. ★3: *steal the targeted Numeral as your Flank* (upkeep 3/turn) → **theft — swings board material hard; factor upkeep and the option to dump it to opp DZ**. 4/5: Basic. 6: reactive *negate an opponent's skill for their next turn* → **a held counter to the opponent's key skill (huge vs combo decks)**. 7: drop 1 your DZ, opp takes a Casualty Draw (no attack) → casualty pressure. ★8: *attack up to a Bank card's Numeral times*, +MP, +NP every 3 hits → the escalating multi-attack combo. 9: on attack, negate opponent's Advantageous 2nd-effects; opp's Damage-Step Morale boosts get subtracted → shuts down the opponent's Action-card defense.

**Maximum** — 0: 1×/game become Rank MAX in Battle → a burst window. 1: fetch an Area (can't use Actions next turn) → **enables the area engine (Higher Ground)**. 2: Rank + a Flank each +1 attack → double tempo. 3: Basic. ★4: *all your Numerals +1 attack* → **board-wide extra-attack alpha-strike**. 5: Basic. ★6: *all your Numerals +1 attack and +1 NP* → bigger alpha-strike. 7: Basic. ★8: *attack up to a Bank card's Numeral times*, +MP after 2 → multi-attack combo. 9: Basic. **10** (MAX): drop 5 hand (NP≥25)+top5 → use either effect of any Action dropped → explosive value. **11** (MAX): declare an Action type from 3 dropped → free Action effects + MP. **12** (MAX): S1 multiply your Advantageous Action effects by a sent card's Rank; S2 use 2 Bank Maximum skills free → **the Maximum combo ceiling — factor these entirely (currently the eval barely knows they exist)**.

**Deckstructive** — ★0: reactive *negate an attack + the attacker mills = the NP that would've hit* → **defensive + deck-out in one; core of the mill win**. 1: fetch an Area → engine. 2: Rank +1 attack; opp takes no Casualty but **mills 2 per casualty avoided** → converts damage into deck-out. ★3: *all other players mill 3* → **direct deck-out clock (all opponents)**. 4: everyone draws 3, opponents drop the Actions they drew → refuel while denying opp Actions. 5: Basic. 6: Basic (drops your own last 2 on entry — a self-mill cost). ★7: opponents mill = a dropped DZ card's Rank, you draw (no attack) → scalable mill. ★8: *attack up to a Numeral times; instead of Morale, opp mills 2 per MP; +MP after 3* → **the deck-out multi-attack combo (the win-con)**. 9: Basic. 10/11/12 (MAX): Basic stat-sticks. **The whole class = drive the opponent's deck to 0; the AI must track opponent deck size as the primary clock.**

**Negative** — 0: reactive *gain Morale = the Numeral that kills this* → makes trading into it bad for the opponent. 1: fetch an Area; if opp holds an Area, bounce it to their Deck → **denies the opponent's area engine**. 2: Rank +1 attack; opp Rank −2 NP → tempo + debuff. 3: target opp Numeral −3 NP (their next turn) → single-target debuff (**choose which in 1v1v1**). 4: Basic. 5: *all opp Numerals −3 NP* → board-wide debuff (their side). 6: Basic (returns an Action to Deck on attack/defeat). ★7: *all other players' Numerals −3 NP and −1 RP* → **mass debuff (all opponents) — swings every clash and casualty**. 8: Basic. 9: all opp Numerals −NP = a ceded Numeral; all players add 1 from DZ → big debuff + recursion. **Negative's plan = shrink the opponent's board below yours, then race — the eval must price standing −NP effects.**

**Restorative** — ★0: reactive *negate all Casualty Damage from an attack* (drop hand+deck) → **stops the casualty race cold — hold it**. 1: fetch 2 Restorative + all others draw/+2 Morale → engine (note it *helps opponents* too — factor the tradeoff). 2: Rank +1 attack. ★3: *return this from DZ/Drop to hand* (+3 Morale if from DZ) → **infinite recursion + Morale — the grind engine**. 4: Basic. 5: on attack, gain MP = attacked card's Rank → MP engine. 6: Basic. 7: drop 2 your DZ + draw; all others drop DZ/draw/+3 Morale (no attack) → DZ cycle (again helps opponents — weigh it). ★8: *attack up to the highest Restorative sent to Drop*, +NP = its Rank → a Drop-fueled multi-attack burst. 9: Basic. **Plan = outlast via Morale + recursion; the AI must value Morale gain and DZ/Drop return, not just board.**

**Astute** — ★0: reactive *opponent reveals hand, you discard one of theirs* → **information + disruption on defense — a belief-model goldmine**. ★1: *look at opp hand*, fetch an Astute of equal value → **see + answer**. ★3: look/reorder opp top 3 → deck manipulation/info. ★5: look opp top 5, drop 2 → mill + info. ★7: opp reveals hand, drop cards = a DZ card's Rank → **see + strip their hand**. ★8: opp reveals top 8, you choose 2 to hand / 2 to discard / rest back → deck sculpting. ★9: opp reveals hand + top 9, add = lowest used → total information. 2/4/6: Basic. **Astute is the class the belief model matters most for — nearly every skill reveals hidden info the AI must record and exploit; today it's 100% wasted.**

**Zero** — 0: reactive *no Morale/Casualty from an attack* → defensive wall. 1: fetch a Zero (M→0) → consistency. 2: Rank +1 attack; that attack's Casualty → 0 → tempo without giving casualties back. 3: Basic. 4: opp Rank Zone A → 0 (their next turn) → **denies opponent Action Cards**. 5: Basic. 6: opp draws 0 next Draw Phase → **denies their draw (card-starve)**. 7: Basic (enters as NP 0 unless promoted from Zero). ★8: *attack extra up to a sent card's Rank; deals 0 Morale; each attacked Numeral's A → 0* → **lockdown multi-attack (zeroes the opponent's Action economy)**. ★9: S1 opponent *can't gain Morale* for their Rank turns; S2 zero the attacked Numeral → **hard denial finisher**. **Zero = deny (A, draws, Morale, NP); the AI must value denial states, which the eval currently can't see.**

**Haste** — 0: reactive fetch a Fast Track → engine. 1: (opp turn) fetch a Haste → consistency. ★2: (opp turn) *your Rank Zone may attack on the opponent's turn* → **off-turn tempo — attack when they can't respond**. 4: attack opponent **directly** + optionally use an Advantageous Action mid-attack → **bypass blockers**. ★6: halve NP/RP but attack **directly** (opp turn), on success fetch a Haste → evasive direct damage. 7: (opp turn) fetch up to 2 Haste from DZ (no other skills) → DZ recursion. ★8: negate all Safeguards + *attack up to a sent Numeral*, +2 NP each → **push a multi-attack through their defenses (with Fast Track, lethal)**. 3/5/9: Basic. **Haste = act on the opponent's turn and hit face directly; the AI must plan off-turn windows and direct-attack lines the current model ignores entirely.**

**Phantom** — ★0: reactive *send opp hand cards to their DZ = your Casualty Count* → scales with the casualty race. ★1: fetch a Phantom + *all others send last Deck card to DZ* → recursion + chip. 3: *send target's top 3 Deck to DZ* → mill-as-casualty. 4: on attack, mill; if Phantom, attack **directly** → conditional direct. ★6: on attack, return a Rank≤2 Phantom from DZ to hand (bounce back if the attack fails) → **DZ recursion loop**. 7: Basic (immune to Safeguard primaries → unblockable-ish). ★8: *attack up to a sent Numeral*, +NP/+RP every 2 → multi-attack. ★9: opp takes Casualty Draws + loses Morale = a sent Phantom's Numeral → **the casualty-race finisher**. 2/5: Basic. **Phantom = win the casualty race + recur from DZ (with Morbid Cemetery); the AI must value casualty count as offense, which today it treats only as its own loss clock.**

**7th** — 0: Basic (can't attack). 1: tuck this, put a Numeral 7 on top of Deck → **stacks toward a 7-collection plan**. 2: Rank +1 attack. ★7 (base "Skilled" variant): drop 1, search Deck for a Numeral 7 → **gather 7s**. ★7 (**"Ascendant" Talented variant**): copy a Numeral-7 skill, OR attack 7 times, OR pursue the **six-7s + Seven Heaven win condition** → **THIS is where the six-7s alt-win actually lives (not the area card)**. 3/4/5/6/8/9: Basic. **7th's identity is collecting 7s to fire the Ascendant six-7s win, with Seven Heaven enabling free 7-flanking along the way; the AI must actively hoard Numeral 7s, value the Ascendant line, and treat Seven Heaven as its enabler — currently all invisible to it.**

**Fission** — 0: **cannot be removed from the Rank Zone by skills/Actions** (a permanent anchor). 1: fetch a Fission; if 4+, drop a Classless-1 into the vacated zone → board-building. 2: (if it entered via a Fission skill) Rank +NP = the source Numeral, +1 attack → **rewards the Fission split-chain**. 3: stand down a Rank Zone, that owner splits 2 Numerals from Deck into Flanks totaling the stood-down NP → board manipulation. 4: send a Rank Zone to Drop, split into 2 from Deck (no attack) → **split engine**. 5: Basic (if hit by a Retaliatory, splits into 2 flanks). 8: Basic (on 5+ MP loss same turn it's defeated, split into 2 from Deck) → resilience. ★9: move each opp hand card to different zones, +2 MP/card, opp −2 MP/card; end of turn splits into 3 → **disruption + MP swing + board flood (the Fission engine)**. 6/7: minor. **Fission = split cards to flood the board + feed Obelus Oubliette's MP engine; the AI must value the split-chain and the un-removable anchor.**

**Extension** — 0 (Bank, reactive): negate the removal of a Rear Flank → protects the Rear Flank engine. 1: fetch an Extension → consistency. 2: Rear Flank +1 attack → tempo. ★5: attack **directly** from the Rear Flank (no other attacks/Actions/casualties) → evasive direct hit. 6: move this to the Rear Flank → sets up the Rear Flank engine (Extension-only zone). ★7: place an Extension into the Rear Flank ignoring rules → board-building. ★9: send 3 Bank→DZ, return 9 Drop→Deck, drop 4+ hand → this + Rear Flank attack +1 per Rank²+ Extension returned → **the Extension multi-attack payoff off Drop-recursion**. 3/4/8: Basic. **Extension = a Rear Flank engine fueled by Drop→Deck recursion + City of Recreation's flank shield; the AI must value the Rear Flank and the recursion loop.**

**Classless (0–9)** — no skills; pure stat-sticks. Still central to the eval as raw combat NP/RP and as Chief-Flank/relieve material (a Classless 9 is Rank² with NP 9, etc.). No special awareness, but the combat model must weigh them accurately.

## A.3 — Action Cards (every card)

### Advantageous (proactive)
- **Repair** — remove a DZ card (heals your casualty count). *Value your own casualty clock.*
- **Plus** / **Rank Star** / **Battle Star** / **Multi-Star** — board-wide NP/RP buffs (yours). *Time before a big attack; combos with alpha-strikes.*
- **Multiply** — double **all** Numerals' NP (both sides). *Swings clash math massively both ways — only good when you win the resulting clashes.*
- **Explore** / **Search** / **Muster** / **Draw** / **Draw Star** / **Wander** — dig/refuel. *Consistency; find the win-con piece; Wander/Explore fetch Areas.*
- **Set** — set a card on top of Deck. *Guarantee your next draw (combos with reveals/deck-stack).*
- **Reveal** / **Spy** — **see opponent's hand** (Spy also blocks their Safeguards). *Belief-model core — record it, play around known answers, strip known threats.* (Spy = a Safeguard-lock attack window.)
- **Motivate** / **Boost** — Morale / Rank-Zone NP pumps. *Morale race + clash math.*
- **Reanimate** / **Revive** — bring a Numeral from DZ back to a Flank. *DZ recursion (board material).*
- **Neo Rank/Battle/Draw/Flank Star** — Neo variants (DZ-fueled buffs, debuffs, draw, flank). *Value DZ as a resource; Neo Battle Star debuffs a chosen opponent.*
- **Shining Star** (Light) — Light +2 NP / Malevolent −1 NP (all fields). *Board-wide swing keyed to alignment.*
- **Shaded Star** (Shadow) — your Rank/Flanks +NP = lowest on all fields + 2 RP. *Scales with board state.*
- **MAX Star** (Maximum) — all players drop 1 DZ; your Numerals +2 NP/+2 RP. *Buff + symmetric DZ hit.*
- **Studious Star** (Astute) — look at an opponent's top 5, drop 1, reorder. *Info + mill.*
- **Halcyon Star** (Restorative) — Rank Zone +NP = ½ Morale; all draw. *Morale-scaling.*
- **Track Star** (Haste) — Rank +4 NP, if opp lost 6+ MP attack again. *Tempo/burst.*
- **Supplementary Star / Flank Star / Neo Flank Star** (Extension) — Rank/Flank pumps off Flank count. *Reward wide boards.*

### Safeguard (reactive defense — the AI must hold these and time them)
- **Protect** — 1 less Casualty; Flanks can't be destroyed this turn. *Blunts an alpha-strike.*
- **Cease** — **negate an attack outright** / negate all further Casualty Draws. *The premier defensive interrupt — hold for the biggest swing.*
- **Recover** — add a DZ card to hand at end of battle. *Defense + recursion.*
- **Return** — shuffle Drop→Deck if a Numeral would be defeated. *Anti-deck-out + saves a card.*
- **Reduce** — attacker loses NP = its Rank when your Flank is targeted. *Flips a clash.*
- **Divide** — halve all Morale Damage this turn. *Damage sponge.*
- **Freezing Star** (Blizzard) — negate the attack, both gain Morale = the attacker; casualty immunity for Rank turns. *Big defensive tempo.*
- **Naught Star** (Zero) — negate an attack on a Zero Numeral. *Class defense.*
- **Nullify** — negate all Morale & Casualty this turn. *Full stop.*
- **Recycle** — on a ceded Flank, return it to Deck + fetch a Classless of equal NP. *Anti-loss recursion.*
**AI must know: whether it holds one, and evaluate spend-now vs hold — the current threshold heuristic doesn't.**

### Retaliatory (post-attack punishers — trigger windows the AI must recognize)
- **Strike** / **Counterattack** / **Counterstrike** — MP burn / Rank-Zone counterattack after being hit. *Bait-and-punish; hold for after their swing.*
- **Betray** — negate casualties + force the opponent's highest to attack their lowest. *Board self-destruct — huge tempo.*
- **Subtract** — negate Morale + drain the opponent's Rank NP = damage avoided. *Defense→offense.*
- **Discard** — opponent drops cards = casualties you took. *Hand denial.*
- **Deckstroy** — opponent drops top 3 of Deck. *Deck-out punish.*
- **Assassinate** — opponent sends a hand card to DZ. *Hand strip.*
- **Burning Star** (Inferno) — opponents lose MP = their DZ size. *Scaling MP burn.*
- **Minus Star** (Negative) — opponent sends a Bank card to DZ + loses MP. *Resource strip.*
- **Drop Star** (Deckstructive) — Rank +3 NP counterattack; on success opp top 5 → Drop. *Mill punish.*
- **Haunting Star** (Phantom) — Rank +2 RP + direct attack after taking a casualty; or 5 Casualty Draws. *Casualty-race punish.*
**AI must know: these only fire in the retaliation window — it must sandbag them and value the trigger, not just the immediate number.**

---

**How this catalog is used (not as 200 hacks):** the forward model in Part 4 *executes* each of these, so the AI sees the real resulting state and evaluates it — the "awareness" columns above become emergent from search + the evaluation features (clocks, area vector, Morale, casualty count, deck size, board power, belief). The catalog is the checklist that the evaluation and the knowledge layer must *cover*, and the verification suite (Part 7) must probe: every clock, every area, every reveal, every reactive window, every multi-attack combo, every recursion loop — not just Wildfire, not just Reveal.
