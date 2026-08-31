# Card Behavior Fix Plan — Reactive‑Check Log Spam + Recover Timing

Two separate issues from the play‑test logs:
1. Cards spamming *"<Card> must be used from hand or Battlefield"* (and siblings) dozens of times per turn.
2. Recover's Deadzone→hand timing.

---

## Part 1 — The "must be used from X" log spam

### Symptom
During a casualty‑draw cascade (and other reactive windows), the log fills with repeats like:
```
Astute 3 must be used from hand or Battlefield.
Astute 3 must be used from hand or Battlefield.
… (dozens of times)
```
It is not just Astute 3 — the same class of message fires for many cards.

### Root cause (one mechanism, not per‑card)
The engine has an eligibility poller, `sourceOK(def, entry, who)` (`index.html` ~L10622). When a card defines a `check(w, card, fieldZone)` predicate, `sourceOK` **defers to it**:
```js
if (typeof def.check === 'function') {
  try { return def.check(who, entry.card, entry.zone) !== false; } catch(e){ return false; }
}
```
`sourceOK` (and equivalent menu builders) are polled **constantly** — once for **every card in every zone** (hand / bank / deck / discard / deadzone / field) — every time the engine scans for usable skills. Call sites that poll `check`: **L5693, L8351, L10628, L10765, L11850, L23305**, plus the amalgamation and area scanners. A single casualty cascade triggers many scans.

A `check` predicate is supposed to be a **pure, silent true/false test**. But ~23 of them **log a failure message as a side effect** when they return `false`. So every poll of an ineligible card (e.g. Astute 3 sitting in the Deck while the scanner tests it) prints the failure line → dozens of identical lines per cascade.

**The message is never useful feedback.** The `check` *gates whether the skill is even offered*; an ineligible card never becomes selectable through the UI, so the line only ever originates from background polls. The genuine activation path already logs its own distinct failures (e.g. *"Astute 3: source card could not be sent to Drop."*).

### Complete audited list (found programmatically — every `check` whose body logs)
| Card(s) | `check` line(s) | Message |
|---|---|---|
| Shadow 6 (reactive, ×2) | L14847, L14854 | "Shadow 6 is reactive…" |
| Fission 2 | L15594 | "…only if it entered from another Fission skill." |
| Fission 3 | L15615 | "Fission 3 can only be used from Drop, Bank, or Battlefield." |
| Fission 9 | L15856 | battlefield‑only guard |
| Inferno 1 | L18423 | "Inferno 1 must be used from hand or Battlefield." |
| Inferno 4 | L18449 | "Inferno 4 must be used from hand or Bank." |
| Phantom 1 | L18715 | "Phantom 1 must be used from Battlefield or Deadzone." |
| **Astute 1 / 3 / 5 / 8 / 9** | L19102/19118/19127/19152/19165 | via shared guard `requireAstuteSource` (L19019) → "must be used from hand or Battlefield" / "…from the Rank Zone" / "…no longer in the selected source zone" |
| Extension 1 / 2 / 5 / 6 / 7 | L19671/19682/19699/19708/19725 | "Extension N must be in … Zone." |
| Maximum 0 / 2 / 4 / 6 | L20229/20247/20253/20259 | "Maximum N must be in Bank." / zone guards |
| Restorative 2 | L20571 | "Restorative 2 must be in Bank." |

Related (same "logs on every poll" family, different call path — fix alongside):
- **`requireAstuteSource`** (L19019) — the shared logging guard behind the 5 Astute checks. Fixing it here fixes all 5 at once.
- **`checkAscendantWin`** (L21806) — a 7th win‑condition check that logs `"7th win check: N/6 …"` every time it runs (a status line on every poll, not gated on an actual win). Not a `sourceOK` check, but the same "logs on a poll" defect.

### The fix (one uniform rule)
> **A `check` predicate must be pure and silent. No `safeLog` / `log` inside any `check`. Feedback about "you can't use this here" does not belong in an eligibility poll.**

Concretely:
1. **`requireAstuteSource`** (L19019): delete its `safeLog` calls (the "must be used from hand or Battlefield", "…from the Rank Zone", "…no longer in the selected source zone" lines). It becomes a pure boolean. → fixes Astute 1/3/5/8/9 in one edit.
2. **Each inline logging check** (Shadow 6, Fission 2/3/9, Inferno 1/4, Phantom 1, Extension 1/2/5/6/7, Maximum 0/2/4/6, Restorative 2): remove the `safeLog(...)` that precedes the `return false;`. Keep the boolean logic **unchanged** — only the logging line is deleted. Each is a one‑line removal.
3. **`checkAscendantWin`** (L21806): drop the `else safeLog('7th win check: …')` status line; keep the win trigger.

**Why this is safe (loses nothing):** the boolean logic of every check is untouched, so cards remain un‑usable from illegal zones exactly as before. The only change is that the *poll* stops narrating its own negative results. Real, one‑time feedback for a genuine failed activation is still produced by the activation steps themselves.

**Design guard for the future:** add a short comment at `sourceOK` and at `requireAstuteSource` stating "checks are polled every scan — never log here." (Optional: a dev‑only assertion that a `check` produced no log output.)

### Verification
- Re‑run `scratchpad/audit_checks.js` → expect **0** logging checks.
- Live: Phantom vs 7th, force a casualty cascade → confirm the "must be used from…" lines are gone.
- Regression: confirm each affected card still cannot be activated from an illegal zone (the option simply doesn't appear), and that a genuine failed activation still logs its own step‑level reason.

---

## Part 2 — Recover timing

### Spec (correct behavior)
Recover **E1** ("Damage Defense: Drop this card at end of battle. Add 1 card from your Deadzone to hand.") adds the Deadzone card **at the END**, not in the moment it is played.

### Finding — this is already implemented correctly
- Both human E1 paths call `queueRecoverEndPhase('player')` instead of adding immediately: **L5350** (`useSafe`) and **L7403** (v13 reactive handler).
- `queueRecoverEndPhase` (L621) only queues; the actual `takeFromDeadzone(..., 'hand', ...)` runs in `resolveRecoverEndPhaseQueue` (L627), which is drained at the **End Phase** via the turn spine at **L2466**.
- Recover **E2** ("Casualty Counter") adds from your **Drop** (discard), immediately — which is correct per the card ("Add one from your Drop to hand"); E2 never does a Deadzone→hand add. All the E2 handlers (L842, L1759, L1877, L1949, L12608) pull from `discard`.

So in the code I can trace, Recover's Deadzone→hand add is **already deferred to the End Phase**. I'm flagging this rather than fabricating a change to already‑correct code.

### One nuance that can *look* like "Recover added from Deadzone now"
When Recover **E2** drops a **Rank³⁺** Numeral from the Deadzone as its cost, the universal **Rank³ redirect** rule sends that card to your **hand** (not Discard) at that moment (same rule as Protect E2 at L839). That is the Rank³ redirect firing, not Recover's E1 add. If that's what was observed, the fix target is different (the Rank³ redirect), not Recover.

### What I need to fix the right thing
If you saw Recover put a card from your Deadzone into your hand *immediately*, tell me: which class/mode, and was it **E1** (Damage Defense) or **E2** (Casualty Counter)? The paths I can see all defer E1 correctly, so I don't want to "fix" working code — point me at the case and I'll correct exactly that.
