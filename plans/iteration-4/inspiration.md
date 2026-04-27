# Iteration 4 — Inspiration

Substrate after iter-3 is clean: dt in seconds, hitstop pose correct, input retained through freeze, K.O. pause, wall-shove. The opponent is still a stationary patroller with no attacks — the player only takes damage by walking into them. **No threat = no fight.** Iter-3 designated the **crouch + telegraphed jab** keystone as the iter-4 candidate; that remains the headline. The other proposals below either compose with the keystone (#2, #3) or stand alone as tightly-scoped ≤50 LOC drops (#4, #5).

Five proposals, ordered by recommended priority.

---

## 1 — Telegraphed opponent jab + crouch duck (KEYSTONE PAIR)

**Inspiring games:** Punch-Out!! (telegraph + dodge), Street Fighter II (crouch as defensive primitive).

**Trigger.**
- *Jab:* opponent within `JAB_RANGE` (~60 px) of player AND `opponent.jabCooldown <= 0` AND `opponent.knockback` inactive AND `opponent.hp > 0`. Roll a fixed-cooldown attack: `opponent.jabWindup = 0.5` (long, readable), then `opponent.jabActive = 0.12` (active frames), then cooldown.
- *Duck:* player holds `S` or `ArrowDown` while `onGround`. State, not impulse — release returns to standing.

**Mechanic.**
- Jab tell renders as `>>>` text or `?` over opponent's head plus a color shift during windup; on active frames the opponent extends a fist (mirror of player's `====`) at fistY = `opponent.y - 50`. Hit-test: `Math.abs(opponentFistX - player.x) < 28` AND `playerFistY` band overlap. If player is ducking, the player's head/torso band shifts down ~14 px so the jab whiffs over them.
- Duck zeroes player vx (commit cost) and skips the jump check. Render swaps `O / /|\ / / \` to a compressed `_O_ / /|\` pose.
- On hit: player takes damage (e.g. 6), hitFlash, hitstop, knockback into `player.vx` mirroring the existing punch knockback path.
- On whiff (jab active frames pass without overlap): opponent enters `opponent.recovery = 0.35 s` during which their `hitFlash`-like color is dim and `patrolDir` freezes — this is the punish window for proposal #2.

**Reward.** Real fight. Read the tell, duck under, counter-punch into recovery for safe damage. The whole loop becomes a Punch-Out cadence: bait → dodge → punish.

**LOC budget.** ~45. Opponent state machine (idle/windup/active/recovery) ~15, hit-test ~8, render telegraph + extended fist ~10, crouch input + pose + hurtbox shift ~12.

**Sharpening vs. iter-3 designation.**
- *Hurtbox shift, not invincibility.* Ducking lowers the hit band, doesn't grant i-frames. A jab at head height misses; a low attack (future) would still connect.
- *Recovery is opponent-side only.* Player whiff recovery (deferred idea) is a separate proposal — keep this one to the opponent's punish window.
- *Telegraph length 0.5 s.* Long enough that a first-time player can read it; iter-5 can shorten as difficulty scales.
- *Cooldown ~1.2 s.* Gives 2 jabs per opponent traversal across patrol range, not a stunlock.

**Composes with shipped systems:** reuses `hitFlash`, `hitstop`, `knockback`, the contact-zone separation (jab respects `CONTACT_RANGE` differently — only triggers *outside* contact zone, so contact damage and jab don't double-tick).

---

## 2 — Counter-punch bonus damage in opponent recovery

**Inspiring game:** Street Fighter II / Third Strike (whiff-punish), Punch-Out!! (star punch on perfect dodge).

**Trigger.** Player's punch lands while `opponent.recovery > 0` (the post-whiff window from #1).

**Mechanic.** If `opponent.recovery > 0` at hit-test pass, deal `PUNCH_DAMAGE * 1.5` (12 instead of 8), bump knockback to `540` (vs. 360), and lengthen hitstop to `HITSTOP_DURATION * 1.5`. Optional flourish: render fist-impact text `*POW*` at the opponent's position for the freeze.

**Reward.** Skill differential. Trade with the opponent and you lose; bait + counter and you out-damage them. Closes the inspiration loop opened by #1 — without #2, the punish window has no payoff.

**LOC budget.** ~10. One conditional in the existing punch-connect block, one extra render flourish.

**Composes:** sits inside the existing punch-connect branch (post-iter-3 block at lines 166–173). Adds zero new state. Depends entirely on #1 shipping `opponent.recovery`.

---

## 3 — Aerial palm-down (jump-cancelable diving punch)

**Inspiring games:** Divekick (the entire game), Shoryuken anti-air inversion.

**Trigger.** Player presses `J` while `!player.onGround` AND `player.vy > 0` (descending). Single-use per air-time (set a flag, clear on landing).

**Mechanic.** Diving punch hit-test fires every frame for ~0.25 s while `vy > 0`: fist at `(player.x + facing * 28, player.y - 30)` — lower than standing punch, angled down. On contact: `PUNCH_DAMAGE`, large vertical-flavor knockback (push opponent away AND set `opponent.vy = -200` for a tiny pop), player gets bounce: `player.vy = -480` (half a fresh jump). On whiff: nothing special, lands normally — but `punchCooldown` still applies, so spamming dives has cost.

**Reward.** Jump becomes useful again. Currently jump is purely defensive (and barely that, since opponent has no attack). With #1 shipped, jump is a third option for clearing a jab — and with #3, it's also offensive: read the jab → jump → divepunch into the recovery window. Three-way RPS: walk-punch / duck-counter / jump-divepunch.

**LOC budget.** ~25. Air-state flag + alternate fist position + bounce + render variant (different fist angle, e.g. `\\\\\\` instead of `====`).

**Composes:** reuses punch animation system — new branch in `drawStick` for airborne-punch pose. Reuses `punchCooldown`, `hitstop`, `knockback`. The bounce is genuinely novel (no current vertical-knockback channel) but it's just two assignments. Pairs naturally with the vertical-hitcheck idea deferred from iter-3 (#6.2 jump rehab).

**Defer-to-iter-5 case:** if the keystone (#1) plus #2 already eats 55 LOC, push #3 out. It's the *third* answer in a rock-paper-scissors that works fine at two.

---

## 4 — Whiff-recovery window on player punch (self-punish)

**Inspiring game:** Street Fighter (recovery frames), Bushido Blade (commitment).

**Trigger.** Player throws a punch that does NOT connect (i.e. the hit-test in the connect block fails). Currently this is invisible — the cooldown ticks down identically to a hit.

**Mechanic.** On whiff, set `player.whiffRecovery = 0.25 s` (separate from `punchCooldown`). During whiffRecovery: player walk speed halved, punch input ignored, jump still allowed (escape valve). Render the player slightly dimmer or with a small `...` glyph above the head to read.

**Reward.** Punches feel like a commitment, not a free poke. Mashing J at empty air now has a small but real cost. Combined with #1, this means: opponent's jab tell → if you mash early, you whiff into their active frames → eat the jab. Punishes panic. Without #1, this still adds texture (you can't infinitely back-mash J to control space).

**LOC budget.** ~15. New player field, decrement, gating wantPunch + walk speed mid-update, dim/glyph in render.

**Composes:** orthogonal to #1/#2/#3 — it's about punishing the player, not the opponent. Tightens the meta around the keystone but doesn't depend on it. Could ship even if #1 is descoped (would still add real depth to the existing system).

**Risk.** This is a "feel-tax" — first-iteration tuning matters. Start with 0.25 s; iterate down if it feels punishing in solo play without opponent threat.

---

## 5 — Stamina meter with punch cost + auto-regen

**Inspiring games:** Bushido Blade (commitment economy), Dark Souls (stamina as universal verb-cost).

**Trigger.** Always on. New `player.stamina` (0..100), drains 25 per punch, 40 per dive (#3 if shipped), regens at 30/sec when idle (no attack/jump). Punch fizzles if stamina < 25 (treat as a denied input — small `X` flash, no whiff penalty since the move never came out).

**Mechanic.** Render a small bar under the player HP bar (or beside the existing one). Stamina depletion gates spam — you can throw 3–4 punches in a flurry, then must reposition for ~2 seconds.

**Reward.** Pacing. Currently the player's punch cooldown is 0.3 s, so 3+ punches/sec is sustainable forever. Stamina enforces breath windows where the player has to walk/dodge, which is exactly when the opponent's jab (#1) becomes scary. Composes with the keystone to make the fight feel like a rhythm, not a button-mash.

**LOC budget.** ~20. New field + decrement + regen + UI bar + denied-input flash.

**Composes:** mirrors HP bar rendering (DRY-able if iter-5 wants to extract a `drawBar` helper). Naturally extends to opponent stamina later (their jab cost), giving a unified resource model.

**Defer case.** Best landed *after* there's something to spend stamina on — if #1+#3 ship, the player has 3 attack verbs (punch, dive) plus jump, and stamina has bite. If only #1+#2 ship (just standing punch), stamina is less interesting; consider iter-5.

---

## Composition summary

The keystone (#1) plus #2 is the **minimum viable iter-4** — it transforms the game from "patrol target" to "sparring partner" in ~55 LOC. That fits the iteration's stated ~45-LOC keystone budget plus a 10-LOC payoff hook.

If LOC headroom permits (target ≤80 total): add #4 for player-side commitment (~15 LOC) — it's the cleanest tonal complement, makes the keystone's punish loop bidirectional.

#3 (divepunch) and #5 (stamina) are stronger as **iter-5** picks: #3 wants the keystone in place to be the third RPS option, and #5 wants more verbs to gate. Both are listed here so the planner can compare against #4 if the keystone ships smaller than expected.

## Notes on opponent threat (the question this iteration must answer)

Today, the opponent damages the player only on body-contact (CONTACT_RANGE < 10 px). This means: range = safe, melee = trade. There's no mid-range threat, so the player's optimal strategy is "walk in to ~38 px (PUNCH_REACH), punch, walk out." Repeat. The fight has no rhythm because the opponent doesn't punctuate space.

#1 is the answer. A telegraphed jab at ~60 px:
- forces the player to *react* (duck, jump, retreat) instead of mash,
- creates a punish window (#2) so reading the tell pays off,
- gives the opponent presence in the mid-range that's currently empty,
- composes with all shipped systems (hitstop, knockback, hitFlash) instead of inventing new ones.

Without it, no other proposal in this list reaches its full value. Ship the keystone.
