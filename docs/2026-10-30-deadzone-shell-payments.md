# Generic Deadzone Drop and Shell Audit

Date: October 30, 2026.

## Creator Ruling

Shells are allowed only for generic drops from the Deadzone. They lower the
counter without becoming physical cards. The counter never goes below -7.

- "A card" / "two cards" dropped from Deadzone: Shells may fill missing cards.
- "A Numeral", a named card, or a class/type-specific card: actual matching
  cards are required. Halcyon Star's three Restorative Numerals cannot be Shells.
- Repair E1 can drop a Shell. Recover E1 cannot recover a Shell.
- Returning/shuffling a card into Deck likewise requires a physical card.
- Other costs and requirements still apply; a Shell does not replace hand,
  Bank, Deck, Element, NP-total or named-card requirements.

## Direct Changes

The shared generic payment step now uses selectable Shells instead of silently
counting a shortfall. It preserves optional choices, the -7 floor, protected
Areas and the Rank 3 destination decision before continuing the skill.
Astute 7 also preserves a zero selection limit: paying with a Rank-zero Shell
reveals the opponent's hand but does not grant an extra discard.

The same classification is used by cost preflight and legacy bot affordability/
execution paths. Neo Orchestral Star's Lowlands-exclusion filter is explicitly
marked as a generic drop, not mistaken for a required card type. Its separate
real Drop-to-Deck requirement remains enforced.

Custom generic-payment helpers now use the existing Shell picker. Recover E2
drops itself, asks for a real Deadzone card or Shell, then asks which actual
Drop card to recover. The sole Recover remains eligible.

7th Purify no longer requires a physical Deadzone card as well as its real
hand/Bank NP payment. Ascendant's copied Purify also resolves its generic drop.
Light 7 and Restorative 7's other-player drops, and Blizzard 6's reactive and
End Phase drops, no longer silently skip an empty Deadzone.

Removed stale empty-zone skips from older Repair handlers. Repair E1 and
Cease E2's already-supported Shell behavior have additional regressions.

Removed Shell selection for Return E2's shuffle and misleading Shell wording/
routing for Halcyon Star E2's recovery. These operations move physical cards
only, in accordance with the drops-only ruling.

No runtime replacement layer was added. Card rules were edited in their
existing implementations. Threshold/phase-boundary checks are unchanged.

## Verification

- 240 runtime payment-step cases: 12 active generic definitions, ten seat/mode
  combinations across standard/Tag/Team, at CC 0 and -6.
- Coverage includes Blizzard 6, Shadow 7, Deckstructive 7, Restorative 7,
  Astute 7, Neo Rank Star, Neo Battle Star, Neo Draw Star, MAX Star,
  Neo Flank Star, Neo Orchestral Star and Neo Multi Star.
- Repair E1: every class, both standard seats.
- Recover E2: 190 class/seat/mode empty-zone cases, plus populated payments,
  alternative real Drop selections and casualty-queue continuation.
- Additional checks cover typed costs (including Temporal 7 and actual
  Halcyon Star activation), empty Recover E1 recovery, floor behavior, mixed
  Rank 3/Shell payments, Lowlands protection, optional choices, Purify, copied
  Purify, full Light/Restorative 7 flows, Blizzard 6 End Phase, Cease with only
  itself in Deadzone, and real-card-only Return E2.
- Chromium confirms actual Shell selection followed by Recover selection and
  Confirm clicks for Restorative and Shadow.
- Standard compatibility and four-client Tag/Team relay checks are run
  separately. Fixtures and automated relays are not natural full games.

Commands:

```powershell
node tools/headless/shell-payment-regressions.js
node tools/headless/recover-e2-regressions.js
node tools/recover-e2-browser.js
node tools/headless/online2v2.js tag2v2 250
node tools/headless/online2v2.js team2v2 250
```

Browser/network tests require their configured Playwright/Chromium and ws
dependencies. The strategy rebuild remains a separate local workstream.
