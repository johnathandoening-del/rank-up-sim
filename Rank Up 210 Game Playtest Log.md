# Rank Up 210-Game Playtest Log

Date started: 2026-08-14

Scope requested:
- 105 Player-vs-AI games: 7 games per class across 15 classes.
- 105 Delta Deck games with different Delta combinations.
- No AI-vs-AI games counted.
- A game counts only if it is played to a natural win/draw/scrape result.
- For Delta-quota games, at least two Evolutions must each be used for both skill value and battle attack/defense value.

Current browser target: `http://127.0.0.1:8765/index.html`

## Running Notes

- Direct `file://` browser navigation was blocked by browser policy, so the same local folder is being served through `localhost`.
- The browser inspection world cannot directly read page globals, so all logged state is taken from the live rendered UI/log plus local source definitions.
- I am not editing game code during this playtest.

## Game 1 - Light vs D4 Inferno - Standard Player-vs-AI

Status: in progress. Not yet counted toward the 105 total until the game ends naturally. Evolution quota not yet satisfied.

### Setup

- Mode: Standard Match.
- Player: Light.
- Opponent: Inferno.
- AI level: Distinguished 4.
- Evolutions: enabled.
- Coin flip: AI went first.

### Exchange 1 - AI Turn

Draw Phase:
- AI drew 2.
- AI first-turn switchdrew 5 Action Cards until none remained.

Promotion Phase:
- AI promoted to Inferno 2 and gained 1 MP.

Rally Phase:
- AI did not flank.

Main Phase:
- AI had 1 Action slot and did not use a visible Main Phase skill/action.

Standby Phase:
- No visible effect.

Battle Phase:
- AI was first player, so it could not attack.

End Phase:
- Turn passed to player.

### Exchange 2 - Player Turn

Draw Phase:
- Opening hand after mandatory first-turn switchdraws settled into Light 1, Light 3, Numeral 4, Numeral 6, Numeral 9.
- Mandatory switchdraws: Shining Star, Explore, Plus.
- Reasoning: first-turn Action Cards must be switchdrawn. This killed the early Shining Star tempo plan, so I shifted into a slower Light promotion/defense plan.

Promotion Phase:
- Promoted Light 1, gaining 1 MP.
- Reasoning: Light 1 was the only legal forward promotion from Light 0. I kept Light 3 in hand as a reactive defensive resource.

Rally Phase:
- No flank.
- Reasoning: remaining numerals were too large to flank under Light 1.

Main Phase:
- Did not use Light 1 skill.
- Reasoning: Light 1's search cost sends itself to the bottom of the Deck. Since I already had Light 3 and needed to preserve a Rank Zone, using it would have reset tempo for insufficient value.

Standby Phase:
- No action.

Battle Phase:
- No attack.
- Reasoning: Light 1 into Inferno 2 would lose combat and collapse the Rank Zone.

End Phase:
- Ended turn deliberately to preserve board and hand resources.

### Exchange 2 - AI Turn

Draw Phase:
- AI drew 2.

Promotion Phase:
- AI promoted to Inferno 4 and gained 2 MP.

Rally Phase:
- No visible flank.

Main Phase:
- AI used Battle Star, dropping 1 card from hand and giving its battlefield +3 NP/+1 RP.
- Reasoning observed: D4 chose immediate pressure into my low Rank Zone.

Standby Phase:
- No visible effect.

Battle Phase:
- AI attacked Light 1.
- I used Light 3's reactive skill, selected Light 3 as the cost, discarded it, negated the attack, returned Light 1 to hand, and lost 1 MP.
- Reasoning: this preserved casualties at 0 and reset the Rank Zone to Light 0 instead of letting the buffed Inferno 4 break through. The cost was acceptable because the AI's Battle Star pressure expired after this turn.

End Phase:
- AI turn ended.

### Exchange 3 - Player Turn

Draw Phase:
- Drew 2: Light 6 and Repair.
- Optional switchdrew Repair into a second Light 1.
- Reasoning: Repair had no Deadzone target and did not advance the current board plan.

Promotion Phase:
- Promoted Light 1 again and gained 1 MP.
- Reasoning: from Light 0, the other numerals in hand were too large; replaying Light 1 rebuilt the promotion ladder after the Light 3 defensive reset.

Rally Phase:
- Flanked the spare Light 1 to the Left Flank and gained 1 MP.
- Reasoning: this gave me a safe Light 1 skill source without sacrificing the Rank Zone.

Main Phase:
- Used the Left Flank Light 1 skill.
- Cost: Light 1 went to bottom of Deck.
- Search target: Light 4 to hand.
- Reasoning: Light 4 was the strongest legal next promotion from Rank Zone Light 1 and bridged naturally into Light 6.

Battle Phase:
- No attack.
- Reasoning: Rank Light 1 still could not fight AI's Inferno 4/5 line profitably.

### Exchange 3 - AI Turn

Draw Phase:
- AI drew 2.

Promotion Phase:
- AI promoted to Inferno 5 and lost 1 MP from the card's M value.

Rally Phase:
- AI flanked Inferno 5 on the left and Inferno 2 on the right.

Main/Standby:
- No visible additional action before Battle.

Battle Phase:
- AI used Inferno 5 as an Addon, attacking my Light 1 with Inferno 5 at NP 10.
- I lost 9 MP and took two casualty draws from Rank advantage.
- Casualty 1: Multiply. I skipped its E2 because AI had 0 casualties, so it would mostly mill me without payoff.
- Casualty 2: Counterstrike. I activated E2 and sent AI's Inferno 5 flank to Deadzone, queuing 2 MP loss at End Phase.
- AI then attacked with Inferno 2 into my Light 1, causing 1 MP loss and another casualty.
- Casualty 3: Numeral 5, sent to Deadzone.

End Phase:
- Counterstrike made AI lose 2 MP.

### Exchange 4 - Player Turn

Draw Phase:
- Drew Light 3 and Numeral 2.

Promotion Phase:
- Promoted to Light 4 and gained 2 MP.
- Reasoning: Light 4 was the strongest legal promotion and let me contest the remaining Inferno 2 flank.

Rally Phase:
- Flanked Numeral 4 left and Numeral 2 right.
- Reasoning: Numeral 4 was meant to clear Inferno 2; Numeral 2 was a low-cost defensive body.

Battle Phase:
- Numeral 4 attacked AI's Inferno 2 and destroyed it.
- AI responded with Burning Star, making me lose 4 MP and counterattacking with a boosted Inferno 5.
- AI's counterattack destroyed Numeral 4, put my MP below zero, and caused a Cease casualty draw.
- I activated Cease E2, dropping spent Counterstrike as cost. Cease gave +3 MP and stopped further casualty flips that turn.
- Reasoning: the game delays loss checks until phase end, so this was a legitimate scrape line and kept me above zero before the phase ended.

End Phase:
- Ended without further attacks because AI's boosted Rank Zone was too large.

### Exchange 4 - AI Turn

Draw Phase:
- AI drew 2.

Promotion/Rally:
- AI promoted to Numeral 7 and flanked Numeral 1.

Battle Phase:
- AI attacked my Numeral 2 using Numeral 1 as Addon.
- I used Light 3 from hand, dropped it, negated the attack, returned Numeral 2 to hand, and lost 0 MP.
- Reasoning: this was the ideal Light 3 target because returning a Rank 0 card costs no morale.

### Exchange 5 - Player Turn

Draw Phase:
- Drew Recover and Light 5.
- Kept Recover instead of switchdrawing it.
- Reasoning: at 2 MP, Recover's +3 MP safeguard activation and delayed Deadzone pickup could be survival-critical.

Promotion Phase:
- Promoted to Light 6 and gained 2 MP.

Rally Phase:
- Flanked Light 5 left and Numeral 6 right.
- Reasoning: I needed medium bodies to absorb attacks and contest D4's board.

Battle Phase:
- Declined to attack.
- Reasoning: D4 had 1 unknown hand card, and attacking small flanks had already triggered Burning Star. Passing forced D4 to break the board rather than giving it a retaliatory window.

### Exchange 5 - AI Turn

Draw/Promotion:
- AI drew 2 and promoted to Numeral 9.

Main Phase:
- AI used Reverse, gaining 1 MP and negating my Action Card Death Draw effects for the turn.

Battle Phase:
- AI declared an attack with Numeral 9.
- I used Recover, gaining 3 MP and queuing End Phase Deadzone recovery.
- AI used Numeral 1 as Addon and attacked my Numeral 6 at NP 10.
- Numeral 6 was destroyed; I lost 4 MP and drew Shining Star as a casualty.
- Reverse negated Shining Star's E2.

End Phase:
- Recover let me add Shining Star from Deadzone to hand.
- Reasoning: I chose Shining Star because the next turn needed morale and a swing card more than another basic numeral.

### Exchange 6 - Player Turn

Draw Phase:
- Drew another Shining Star and Explore.
- Optional switchdrew Explore into Plus.
- Reasoning: Explore was too expensive for the low-MP position; Shining Star and Plus were more immediately useful.

Promotion Phase:
- Promoted to Numeral 9 and gained 2 MP.

Rally Phase:
- Flanked Numeral 2 right.

Main Phase:
- Used Shining Star, gaining 5 MP and buffing Light 5 from NP 5 to NP 7.
- Reasoning: this gave enough morale buffer to attack without instantly dying to the next response.

Battle Phase:
- Declared with Rank Zone Numeral 9.
- Added Light 5 (+7 NP) and Numeral 2 (+2 NP) as Addons.
- Attacked AI Rank Zone Numeral 9 at total NP 18.
- AI lost 9 MP and drew Inferno 4 as a casualty.
- I declined further attacks.
- Reasoning: the big hit mattered, but attacking AI's tiny flank risked another Burning Star-style punish.

### Exchange 6 - AI Turn

Draw/Rally/Main:
- AI drew 2, flanked Numeral 2 right, then used Multiply.
- Multiply doubled Rank, Flank, Rear Flank, and Delta Zone Numerals on both sides until end of turn.

Battle Phase:
- AI used Numeral 1 as Addon and attacked my Light 5 at NP 20 into NP 10.
- I lost 10 MP, falling to 3 MP, and Light 5 was sent to Deadzone.

### Blocking Issue

After AI destroyed Light 5 during Exchange 6 Battle Phase, the game remained on AI's Battle Phase with:
- no open modal,
- no new log entries after `YOU's Light 5 sent to Deadzone.`,
- no automatic phase advance after more than 60 seconds,
- no natural win/loss/draw/scrape result.

Result: Game 1 is invalid for the requested count because it stalled before completion.

Issue classification: browser-confirmed gameplay blocker. The AI Battle Phase can stall after a successful AI attack destroys a player flank while no response modal is open.
