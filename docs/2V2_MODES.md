# 2v2 modes — Tag and Team

The user's rules (2026-10-26) are summarised here; the engine design follows them.

## Rules

**Both modes.** Teams are A+B vs C+D. Turn order is A → D → B → C → A; only the starting player is random. An Exchange
counts once all four have had a turn. The player who goes last in the first round is the first who may declare an
attack. Partners may use each other's field cards as Evolution elements, as field-sacrifice cost payments, and as
Max Rank Up / Chief Flank material. A player may activate a Safeguard or Retaliatory card when their partner is being
attacked, or has been, as if it happened to them.
- "Target player" = any of the 4. "Target opponent" or a plain "your opponent" = the user picks one of the 2 opponents.
- "All players" = 4; "all other players" = 3; "all opponents" = the other team.
- You attack either opponent, never your partner (unless a card such as Betray forces it).
- Every player starts at 15 MP / 0 CC. ≤0 MP or ≥15 CC loses; ≥105 MP or ≤−7 CC wins.
- Once-per-War and once-per-turn limits stay single: two players never double them.
- Using a partner's skill: the user pays any hand or Deck cost and gets the benefit ("your" = the user).
- Online seats: the room creator is A, the first opponent to join is C, the next is D, and A's partner is B.

**Tag**
- One shared MP, CC and Deadzone per team. The Deadzone sits between the partners; B and D are mirrored (Deck on the
  right, Δ Zone on the left).
- Action Card limit = the highest A on the team's whole battlefield, whoever controls that Numeral. Uses are pooled
  across both partners within each turn.
- A teammate with an empty Deck skips their draw; the team loses only when both Decks are empty.
- Partners may use each other's Numeral skills.
- "Your field" effects hit both partners' fields.
- Addons may come from the partner's Flank, Rear Flank or Δ Zone — never the partner's Rank Zone, and a partner's
  card never leads an attack.

**Team**
- Each player has their own MP, CC, Deadzone and Action limit (standard layout, no mirroring).
- An eliminated player is greyed out. Their partner may still use their Δ Zone card while it is on the field.
- An eliminated player returns as soon as they no longer meet a loss condition.
- The team loses when both are eliminated. An empty Deck eliminates only that player.
- "Your field" means only your own. Addons may use only the partner's Δ Zone card.

## Engine design

- **Seats.** A = `player`, B = `ai3`, C = `ai`, D = `ai2`. The first opponent to join an online room is C, so seat
  order 0..3 = A, C, D, B. `G.teamOf` maps a seat to `AB` / `CD`, and `G.twoVtwo` is `'tag'` or `'team'`. Every other
  mode has no `teamOf`, so each seat is its own team and free-for-all play resolves exactly as before.
- **One relation.** `ruTeamOf` / `ruSameTeam` / `ruPartnerOf` feed `oppOf`, `oppList`, `livingOpponentsOf`, `ruEffOpp`
  and attack legality. An opponent is any living seat of another team.
- **Turn order.** `G.sideOrder` is a rotation of [A, D, B, C]. The existing rules already give the 2v2 behaviour:
  last-to-go-attacks-first (`canSideAttackYet`) and an Exchange advancing when the turn wraps to the anchor.
- **Winning.** The match ends when ≤1 team has a standing seat. In Team mode a seat is eliminated at the end-of-phase
  checkpoint and revived as soon as it no longer meets a loss condition (after a deck-out: once 2+ cards are back in its Deck).
- **Tag pools.** `G.teamPool[team] = {mp, cas, deadzone, areaTimers}`. Each partner's side exposes these through
  accessors linked to its own `G`'s pool. Every copy of `G` (bot lookahead `__S.restore`, `withSimulatedState`, the
  Temporal rewind) re-links them with `ruLinkTeamPools`, because a copy turns accessors into plain data.

## Status

Done (tests: `node tools/headless/twovtwo.js` — rules checks, random 4-seat games with no partner attacks and identical
replays; `MODE=tag2v2|team2v2 node tools/headless/hostsim.js` — the thinking bots on every seat):
- [x] Engine core: seats, teams, every opponent resolver team-aware, turn order A → D → B → C, team wins,
      Team-mode end-of-phase elimination and return, deck-out (Team: that player; Tag: only both Decks), result wording
- [x] Tag shared pools (MP, CC, Deadzone, Area timers and per-turn counters, Action Card uses) via accessors that every
      state copy re-links (`ruLinkTeamPools`); the team Action Card limit = highest A on the team battlefield
- [x] Safeguard / Retaliatory windows for the attacked player's partner (`offerTeamDefense` / `offerTeamRetaliation`)
- [x] Addons from the partner (`ruAddonZonesOf`: Tag = Flanks, Rear Flank, Δ; Team = Δ; never the Rank Zone)
- [x] Partner Numeral skills in Tag (`ruCanUsePartnerSkill`); a skill's "this card" cost moves the card from the board
      that actually holds it (`ruSourceSide`, used by every source helper)
- [x] Menu modes, the solo match (you + bot partner vs two bots), seat names, the board layout (`layoutTwoVTwo`; Tag's
      shared Deadzone between partners with B and D mirrored)
- [x] Bots: the partner is an ally in evaluation (`worth`), move candidates include the partner's board

- [x] Opponent choice from card text (`ruChoosesOpponent`, replacing the RU_SKILL_CHOOSE / RU_ACTION_CHOOSE name
      lists): "target opponent" → the user picks; a plain "opponent" in a proactive skill or Advantageous card → the
      user picks; attack-context sentences, "that opponent", attack grants, "all / each opponents", card-pick skills and
      reactive skills do not ask. Retaliatory "target opponent" cards pick their foe (`G._retFoe`). A partner answering
      for an attacked teammate reads the attack as if it had happened to them (`G._answerFor` in `lastAttack`).
- [x] "All other players" (3, the partner too) vs "all opponents" (the other team): `ruAllPlayers` /
      `ruAllOtherPlayers` (Restorative 1 / 7, Phantom 1, Deckstructive 3, Negative 7, Negative 9); in Team mode they reach
      an eliminated player, so an all-players Morale gain or Deadzone removal brings them back. "An opponent's" card
      picks and `allOpponents` mean another team (Neo Strike Star E2, Petrify E2, Normalize, Balance, Debilitate E2,
      Fullmetal's target opponent).
- [x] Tag "your field" = both partners' fields: the NP / RP change a "your field" effect makes is mirrored to the
      partner's field per zone kind, with the zone-wide modifier (`ruMirrorFieldToPartner`).
- [x] The partner's Battlefield as material (both modes): Chief Flank, Max Rank Up, Amalgamation Elements
      (`ruPartnerFieldMaterial`, `ruFieldCardToDrop`, `ruPartnerChiefTargets`); "this card" costs of a partner's skill
      (`ruSourceSide`).
- [x] Team mode deck-out: the player returns once 2+ cards are back in their Deck (ruling 2026-10-27).
- [x] Online rooms: the creator's Mode (2v2 Tag / Team) makes a four-seat room; joiners pick "Join as opponent /
      partner" (first opponent C, next D, partner B); a four-seat start builds the match on every client
      (`tools/headless/online2v2.js`: real server, seating by role, four clients in lockstep). 2v2 results are not rated.

- [x] Tag: a team acts as ONE player (ruling 2026-10-27) — "each opponent" / "all players" Morale effects change a
      team's shared pool once (`ruOncePerTeam`, `ruEachOpp`), "players without a Numeral 7" / Asteroid Field judge the
      team's whole Battlefield (`ruPlayerSeats`), "all other players" is the other team. Per-seat resources (hand, Deck,
      field) stay per seat.
- [x] Answering for the attacked partner (ruling 2026-10-27): the payer chooses who gets the effect
      (`ruChooseBeneficiary`); the card resolves as that seat while every cost — the card, its Action slot, hand and
      Deck costs, cost pickers — is the payer's (`G._benefit`, `ruCostSeat`, `ruNoActionSlot`).
- [x] Tag's shared Deadzone (2026-10-28): a Casualty Draw's Dead Draw its owner leaves unused is offered to the partner
      (`partnerDeadDraw`; the partner pays and gets the effect), and a "Casualty Draws against you" stop covers both
      partners (`isNeg` over `ruPlayerSeats`). An Area's wash is one band per team over both boards, centred on the shared
      Deadzone (`.team-area-band`, laid out by `layoutTwoVTwo`); every board's own wash is measured from its Deadzone in
      the board's layout, so boards turned on the table wash from the right end.
- [x] Every seat's Δ Zone card is drawn on every screen, and every seat's Extension entries are processed (both used to
      cover only the first two seats); a Δ Zone with no Evolution shows no Elements label.
- [x] Cancelling an effect's board pick (`boardPick`) answers it "no card" (`G._oppZoneNoneOk`): the effect ends through
      its own path and the attack / Casualty line it belongs to goes on. (Before, Cancel dropped the continuation: a
      defender's Balance / Normalize cancelled mid-attack made the attack vanish.)
