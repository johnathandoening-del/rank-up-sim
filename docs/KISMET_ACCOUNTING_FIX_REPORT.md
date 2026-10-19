# Kismet Response and Morale Accounting Fixes

## Scope

Direct edits to the existing activation observer, Kismet response handlers, and Kismet 8 attack-resolution handler. No new runtime wrappers or override layers. Unrelated working-copy edits were preserved and excluded from deployment.

## Root Causes and Changes

1. The activation observer compared NP/RP only for Numerals on the Battlefield. An Advantageous effect changing only cards in a hand, such as Neo Multi Star on a zero-NP/zero-RP field, produced no recorded change and therefore no Kismet 1/3/4 response. It now compares physical Numerals in all locations using the existing card inventory. Kismet 4 also restores those cards' stats and temporary modifier markers, including a changed card subsequently discarded as its cost. Response descriptions do not reveal hidden card names.
2. Kismet 3 checked historical eligibility separately for Drop and Deadzone. Moving the same card from Deadzone to Drop during the activation incorrectly disqualified it, despite both locations being legal. Eligibility now uses their combined historical and current pools. A reproduced example is dropping Kismet 3 for Boost's E2 and then responding to that NP change. The actual Bank payment, activation negation, and Morale resolve normally.
3. Kismet 8's secondary attack handler reapplied the full cumulative Action-drop count. It now remembers the count already settled by that card this turn and transfers only the increase. Its first dynamic S gain remains a single immediate payment for the hand cards discarded as its activation cost. Neither that first gain nor an already-settled secondary amount is repaid by another attack.
4. Kismet 8's card text now states the one-time initial gain and incremental secondary transfer explicitly. Its A remains 1. Drop history still counts all players' Action drops for any reason, including activation costs and earlier drops, not only cards drawn by Kismet 8.

## Concrete Accounting Example

With three Action Cards discarded for the cost:

- Activation: gain 3 MP once.
- First attack reveals and drops two more Actions: total 5, secondary transfer 5 MP.
- Second attack reveals and drops two more: total 7, secondary transfer 2 MP, not 7.
- Third attack reveals no Actions: no secondary transfer and no repeat of the initial gain.

Battle damage is accounted for separately in the assertions.

## Engine Verification

`node tools/headless/kismet-accounting-regressions.js`

290 controlled fixtures passed in both the isolated release checkout and the original working copy:

- 20 NP/RP-changing Advantageous E1 cards, each answered by Kismet 1, 3, and 4, with both reacting seats and both own/opponent activators: 240 cases. These include Seventh Star's RP-only change.
- Hand-only changes, all three responders, both seats, both activators: 12 cases.
- Kismet 3 moving between its two legal source locations: 2 cases.
- Three consecutive Kismet 8 attacks, both seats and both turn owners: 4 cases.
- Declining one activation without suppressing later ones, and once-per-turn stamp reset: 6 cases.
- An Action without an NP/RP change does not falsely prompt: 2 cases.
- Boost and Track Star Advantageous E2 effects, all three responders, both seats and both activators: 24 cases.

The pre-fix source was also loaded into the test engine without modifying the checkout: both the hand-only and crossed-pile reproductions failed to offer a response there.

## Online Browser Verification

62 distinct controlled browser fixtures passed in two batches (50 response/accounting cases and 12 Advantageous E2 cases), using two rendered human-seat clients and the actual local WebSocket room relay. The checks exercise owned modal/picker inputs, hidden private picker contents, mirrored non-actionable opponent controls, exact Morale outcomes, matching state signatures, and absence of a transport desync.

These are arranged regression fixtures, not natural-play matches. Twenty E1 cards were swept in the engine; the browser batches sample the E1 paths and exercise the specific repaired scenarios rather than replaying all 290 engine fixtures.

## Other Regression Checks

- Existing Kismet/Haste suite: 33 cases passed, with the obsolete compounding expectation corrected.
- Card-rules suite: 43 PASS rows, including the signed opening-M matrix and Temporal/Restorative/Benevolent 6 checks.
- Temporal/Addon suite: 16 cases passed.
- Rift/entry-history suite: 10 cases passed.
- Painted versus non-painted parity: 2,800 inputs passed.
- `git diff --check`: passed.

## Deployment and Limits

Both players must reload the deployed page and begin a new match; an already-running client retains its old JavaScript. Verification covers the enumerated paths, not a mathematical proof of every possible card interaction.
