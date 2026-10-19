# Opening Morale, Temporal 4, Restorative 5, and Benevolent Amalgamation 6

## Changes

### Opening Numeral 0 Morale

Every player starts at 15 MP, then their starting Numeral 0 applies its signed printed M once, before the first turn's draws. This follows the owner's clarification that negative M applies too.

- Restorative: 20 MP.
- Maximum and Celestial: 16 MP.
- Ochre and Kismet: 14 MP.
- The other current classes: 15 MP.

The previous code already applied positive M but skipped negative M. The shared start rule now handles both signs and cannot repeat the boost when Draw Phase is entered again.

### Temporal 4

Temporal 4 selects a non-Neo, generic Advantageous Star from Deck or Discard after paying its seven-card mill. It no longer offers a paid activation when there is no previous Battle Phase to change.

The existing timeline engine restores the recorded past position, automatically activates the selected Star there without its costs, and replays the intervening inputs using the changed state. This changes actual battles, Morale, Casualty Draws, subsequent Deck positions, and cards drawn later; it is not a present-turn statistical adjustment.

Changed mandatory one-button confirmations are answered by the replay so a different Casualty Draw does not strand it. A genuinely new choice still pauses for its owning player. Recorded choices that are no longer legal are not replaced with invented strategic decisions. The battle log returns to its historical prefix and is rebuilt from the changed events instead of retaining obsolete future entries.

Flank Star's embedded Morale payment is now a distinct cost step, so Temporal 4 correctly waives it without skipping the actual buffs.

### Restorative 5

The obsolete manual opponent-card picker is replaced by a prompt when Restorative 5 participates as attacker or defender. Accepting mills one card, grants its printed S, and grants MP equal to the current Rank of the card being attacked. When Restorative 5 is defending, that means its own Rank, not the attacker's Rank. This uses the same skill/negation flow as other triggered Numeral skills. It is once per turn, as the owner confirmed; a turn-number guard prevents a field refresh from enabling a second activation.

### Benevolent Amalgamation 6

Its existing destruction-save handler now uses the normal skill flow, with an owned Element-cost choice and printed S. On successful resolution it restores the Numeral, locks all Action Card types for the rest of that turn, and queues an owned Drop-to-hand recovery for End Phase. The turn cannot hand off until that recovery choice finishes. A turn-stamped usage mark also prevents phase-local `usedSkill` resets from enabling another use in the same turn.

The recovery uses the existing End Phase recovery queue. Normal Recover still takes its card from Deadzone; the Amalgamation takes its card from Drop.

## Engine Verification

```powershell
node tools/headless/card-rules-regressions.js
node tools/headless/kismet-online.js
node tools/headless/parity.js 4 700
```

- All 19 classes, both first-seat orders, both players' opening Morale, and no repeat M application: passed.
- Restorative 5 attacking/defending from either seat: actual mill, S, attacked-card Rank, and no second activation after a field refresh: passed.
- Benevolent 6 saving a Flank or itself from either seat: Element payment, S, destruction reversal, all Action locks, delayed recovery, choice ownership, handoff, and lock expiry: passed.
- Temporal 4: all eight eligible generic Advantageous Stars, both source piles, both seats (32 cases): passed. These assert historical battle NP, changed damage and actual Casualties, later hand contents, waived costs, Star ownership, return to the present, and removal of obsolete log rows.
- Two additional Temporal 4 cases, one per seat: a formerly drawn Protect becomes a real past Casualty, its new E2 decision belongs to the opponent, and the obsolete future hand card disappears: passed.
- The previous 33 Kismet/Haste engine regression cases: passed.
- Painted/non-painted parity: identical across four seeded 700-input sequences (2,800 inputs).

The eight Stars tested are Rank Star, Battle Star, Draw Star, Multi-Star, Flank Star, Thrash Star, Encore Star, and Orchestral Star.

## Browser Verification

All 47 distinct browser fixtures passed with two rendered game clients and the real WebSocket room relay, in batches of 45 plus the two additional E2 scenarios. Each fixture starts in fresh pages so timers or callbacks from another test cannot carry into it. Inputs use owned game buttons, board zones, and pickers. Checks cover mirrored private choices, state synchronization, and the engine-asserted outcome. The four Restorative 5 scenarios were rerun with a repeat attack after a field refresh to check the explicit once-per-turn guard.

These are arranged regression fixtures, not natural-play matches and not a claim that every possible card interaction has been proven correct.
