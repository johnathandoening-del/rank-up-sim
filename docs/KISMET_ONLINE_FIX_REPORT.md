# Kismet and Haste Online Fix Verification

Later ruling: Kismet 8 settles only the increase in the cumulative all-player Action-drop count on each qualifying attack. The original full-total-per-attack behavior described below is superseded by [the response/accounting fix report](KISMET_ACCOUNTING_FIX_REPORT.md).

## Scope

Direct edits to the existing game engine and card data. No added runtime override layer.
Unrelated unfinished AI, Area Card, and other gameplay changes were excluded from this release.

## Causes and Fixes

1. Action-effect snapshots included temporary client input context. Negating a remotely played Action could restore `_replaying: true`, suppressing the responding player's next network input. Snapshot capture and restoration now exclude the input context, preserving the currently executing input on each client.
2. Kismet 7 and 8 were not registered for opponent-turn skill windows. Both now offer legal skills on either player's turn. Eligibility is checked before offering a skill, and newly legal skills are considered after an input resolves, not only at phase entry.
3. Haste's attack picker incorrectly required a Haste-class attacker. Haste 2 grants its attack to the Rank Zone card, including classless cards. Eligibility now requires a current-turn, per-card attack grant instead of a class test or a broad global flag. Spending a grant decrements it. Passing a skill window does not pass the separate attack window. Ending a turn before Battle offers any pending granted attack first.
4. Kismet 8's A is now 1. Its secondary damage and Morale use the cumulative number of Action Cards dropped by all players this turn, for any reason. All game Drop writes use one counted operation. Retrieval does not erase a prior drop, and dropping the same Action again counts again. Counts reset by turn and participate in the normal effect rewind.

## Focused Engine Tests

Run from the repository root:

```powershell
node tools/headless/kismet-online.js
```

This generates the ignored browser fixture file `tools/headless/data/online-regression.json` and asserts 33 cases:

- Kismet 1/3/4 from each seat, answering either player's Action.
- Kismet 3 from both Drop and Deadzone, including Casualty adjustment.
- Kismet 4 with a hand payment or Bank payment.
- Distinct effect negation, activation negation, change-only negation, damage, Morale, costs, and tutoring.
- Kismet 7's full multi-player choice sequence, damage, Casualty adjustment, and attack prohibition.
- Haste 2's actual granted attack in Battle or before an early turn end, including a classless attacker and exclusion of ungranted attacks.
- Kismet 8's A, off-turn attacks, reveal/drop sequence, cumulative damage, and Morale.
- Kismet 9's retrieval, next-turn placement, Action ceding, draws, negation, lock duration, and Morale transfer.
- Kismet 3 making Kismet 7 affordable in the same phase, with no repeated unchanged pass prompt.
- Kismet 0's paid defensive prompt and actual Morale/Casualty damage negation.
- Drop history through immediate retrieval, repeated drops, non-Actions, batches, rendering, and a turn change.

## Real Browser and WebSocket Verification

After generating fixtures, start the regular room server locally and open `/tools/online-regression.html`. Click **Run Tests**.

The test page renders two actual game clients with separate seat identities connected through the normal WebSocket room server. Modal and picker inputs are clicked on the owning client and relayed to the other client. The other client is checked for hidden private picker cards and non-actionable mirrored prompts. Both clients must finish each case with identical state fingerprints and the exact engine-asserted outcomes, without a transport desync.

Result: **all 33 browser cases passed** on the isolated release source.

These are deliberately arranged regression fixtures, not natural-play matches or evidence of strategic mastery. State setup and some phase transitions are controlled by the harness; actual player choices use the normal input/relay path.

## Broader Checks

- `git diff --check`: passed.
- `node tools/headless/parity.js 4 700`: identical painted/non-painted state sequences across 2,800 inputs, covering Temporal/Extension, Blizzard/Negative, Deckstructive/Kismet, and Haste/Astute.
- `node tools/headless/smoke.js 6 15`: 20,005 randomized inputs, no reported engine exceptions; repeated first seed had identical fingerprints. Two runs reached a winner; four reached the harness's input cap. These are smoke tests, not six completed playtests.

## Limits

This validates the listed effects, ownership, and synchronization paths. It is not a claim that every possible combination of all cards is proven bug-free. Both online players must reload the deployed game before starting a new room so they run the same engine version.
