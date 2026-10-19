# Temporal 4 and Addon Attack Allowances

## Direct Source Changes

No new runtime script, replacement-function wrapper, or post-load override layer was added. Existing history recording, Temporal 4 resolution, Casualty processing, and Addon commitment code were edited.

## Temporal 4

- The anchor is the last resolved attack on an earlier turn, not the beginning of its Battle Phase. Its board, participants, Addons, and original target are retained. Earlier attacks in that phase are not changed or offered again.
- A generic non-Neo Advantageous Star is selected from Deck or Discard. Its activation is applied at the historical attack without its costs. The existing deterministic history engine then reconciles the subsequent committed inputs against the changed state, including actual Deck order, future hands, damage, and Deadzones. Players do not choose a replacement Battle Phase.
- Original Casualty counts are recorded per recipient for the historical attack. Draws beyond that baseline really happen, but Action Cards in those additional Casualties have their Secondary Effects negated. The cards are not removed from the Deck by a counter-only adjustment, and their E2 Morale/effects do not fire.
- Ordinary Casualty E2 effects remain available. Suppression is scoped to the amendment and does not permanently mark a card or suppress later normal Casualties.
- Temporal 4's card text and activation prompt state the additional-Casualty restriction.

### Encore Star

After the recorded attack, eligible Numerals from the historical Battlefield use their remaining attacks against the original target. These attacks go through the normal attack path and are recorded in the reconstructed history. An unused eligible Numeral with two attacks therefore attacks twice; an original attacker with one left attacks once more. No new target is chosen. A removed attacker or a destroyed original target is not fabricated or replaced to allow an otherwise impossible attack. Existing attack bans and eligibility still apply.

## Addons

The normal board-target path, Delta-target path, and legacy AI Addon path previously set a supporting card's remaining attacks to zero. They now share a one-attack spending operation. A card with two attacks retains one after supporting an Addon; a card with three retains two. It is marked exhausted only at zero. The existing `attackAdditionally` exception continues to spend no attack for providing an Addon. Delta-target attacks also retain their Addon participants in battle records.

## Verification

Reproducible engine commands:

```powershell
node tools/headless/temporal-addon-regressions.js
node tools/headless/card-rules-regressions.js
node tools/headless/kismet-online.js
node tools/headless/parity.js 4 700
```

The new suite contains 16 two-human-seat fixtures: 12 Addon cases and four historical Battle Star/Encore cases. Its browser version uses two rendered clients, actual owned controls, and the real WebSocket relay. These are controlled regression fixtures, not natural-play matches.

Assertions include:

- Two and three attack allowances from actual Encore Star activations, followed by an Addon and another real attack.
- Rank and Delta targets, a Delta Addon source, the free-Addon exception, and identical results from both seats.
- The user's Rank 2 Numeral 5 example becomes 8 NP / Rank 3 at the historical attack, while an earlier Numeral 3 attack in that phase remains unchanged.
- Historical Encore produces exactly six attacks: twice each from three eligible Numerals, against the same original target.
- A formerly drawn Action Card enters the historical Deadzone instead, without granting its E2 Morale or effect; future hand contents change.
- A normal present-day Protect Casualty still offers its owner's E2 activation.

The broader card-rules suite also checks all eight eligible generic Stars, both source piles, and both seats. Its two former new-E2-choice scenarios now assert that the additional historical E2 is negated, reflecting the clarified rule.

### Results

- All 16 new engine fixtures passed in both the release checkout and the original local checkout with its unrelated work preserved.
- All 16 new browser fixtures passed through the real room relay. No browser errors or warnings were recorded in the final run.
- All 47 broader card-rules fixtures and the starting-M checks for all 19 classes passed.
- All 33 Kismet/Haste engine regressions passed.
- Four 700-input painted/non-painted sequences remained identical (2,800 inputs).

The browser harness waits for automatic historical consequences to settle, or for a genuine owned choice, before advancing the recorded test steps. The Encore driver also yields when an attack is awaiting its continuation rather than repeatedly attempting an unspent attack in a tight loop.
