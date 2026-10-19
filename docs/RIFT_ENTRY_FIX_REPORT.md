# Retrograde Rift and Temporal 9

## Retrograde Rift

The Delta Zone was already named in the history code, but the Delta Deck and cards inside an Evolution were missing from its inventory. Consequently, a newly formed Evolution had no recorded Delta Deck destination, and spent/attached Elements could not reliably return to their original hosts or zones.

The existing history inventory and restore operation now include:

- Active Delta Zone cards and physical Evolution cards in each player's Delta Deck.
- Elements, their host Evolution's identity, and their order within that host.
- Returning a new Evolution to the Delta Deck and its materials to their historical locations.
- Restoring a defeated/replaced Evolution and its original Elements.
- Restoring spent Elements on either player's side.

Locations are resolved using the actual physical cards, not copied replacement cards. All selected moves are detached before placement so Delta/field occupancy does not make a legitimate restoration fail. Stale Element references left by an Evolution's defeat are removed while its materials are restored; one card cannot be left simultaneously in the Drop and attached to an Evolution.

Rift itself remains where its removal placed it, and its existing draw-two resolution and once-per-Exchange rule are retained.

## Temporal 9

The owner clarified that the skill includes Numerals that entered the Battlefield and subsequently left it.

The field watch now records actual entry events. Each turn's Draw Phase history contains an entry-sequence boundary. Capture now happens before that Draw Phase resolves, rather than afterwards, so entries caused during Draw are included and the recorded locations are genuinely from turn start. Re-entering Draw in the same turn does not replace that snapshot. Temporal 9 selects every other distinct Numeral that entered after the start of its owner's previous turn's Draw Phase, including entrants now in the Drop, Deadzone, Bank, or an Evolution's Elements.

Established Numerals do not become targets merely because they remain on the Battlefield or move between Battlefield positions. Numerals that moved between off-field piles without entering the Battlefield are not targets either. Only Numerals actually returned grant the +1 NP bonus. Temporal 9's card text and resolution log describe this scope. Its 15-card cost, printed S, self-exclusion, and once-per-Exchange limit are unchanged.

## Online State

The shared-state fingerprint now includes Delta Deck card identities and active Evolution Element identities/order, rather than relying on Delta/Evolution counts alone. Browser fixture assertions also compare complete physical card locations on both clients, including attached Elements, in addition to the engine fingerprint.

## Verification

```powershell
node tools/headless/rift-entry-regressions.js
node tools/headless/card-rules-regressions.js
node tools/headless/temporal-addon-regressions.js
node tools/headless/kismet-online.js
node tools/headless/parity.js 4 700
```

- Ten new engine fixtures passed: four Rift scenarios plus one mixed Temporal 9 scenario, each from both player seats.
- Ten corresponding two-human-seat browser fixtures passed through the actual WebSocket room relay, with owned prompts and physical-location/Element checks.
- The mixed Temporal 9 case returns six entrants from several locations, including one that entered during Draw itself, while leaving established Numerals, a never-entered hand Numeral, and an Action Card untouched. The bonus is exactly +6 NP, and the full mill cost and printed S resolve.
- The previous 47 card-rule fixtures, all 19 opening-M checks, 16 Temporal/Addon fixtures, and 33 Kismet/Haste regressions passed.
- Four 700-input painted/non-painted parity sequences remained identical (2,800 inputs).

These are controlled regression fixtures, not claims of naturally played full matches or exhaustive verification of every possible interaction.

The changes edit the existing field watch, historical inventory/restore code, skill definition, and synchronization fingerprint. No runtime override layer was added.
