# Iteration 5 — Inspiration

State recap. Iter-4 keystone shipped: opponent has telegraphed jab (yellow `!`, 0.5s windup, 12 dmg, JAB_RANGE=80), counter-punch in recovery deals 1.5x, crouch (S/down) drops hurtbox 16 px to whiff jab over you. Loop is now: walk into JAB_RANGE -> read tell -> crouch -> walk forward -> punch in recovery. Works once. Predictable on the second cycle: opponent always jabs after exactly 1.2 s idle, always at JAB_RANGE, always the same windup.

Sharpening targets called out:
- Jump remains useless (jab can be ducked, not jumped over -- band check fails on airborne y-50 too, and jumping forward overshoots). Need a reason to leave the ground.
- Player punch has zero whiff cost. Asymmetric with opponent's recovery window.
- Combat rhythm is metronomic at 1.2 s idle, no mixup.
- Crouch is purely defensive; crouch+J is the same standing punch.

Five proposals below. Each names the inspiring game, the trigger, the mechanic, and the reward. All ASCII-friendly, all <=50 LOC. Ranked roughly by leverage on the loop.

---

## 1. Divepunch -- jump rehab (Divekick / Street Fighter Shoryuken air-button)

**Inspiration.** Divekick (whole game = one airborne attack); SF Shoryuken anti-air feel.

**Trigger.** Press J while `!player.onGround && player.vy > -200` (i.e. on the way down, or at the apex -- not on the ascent). One per jump (`airAttackUsed` flag, cleared on landing).

**Mechanic.** Locks horizontal velocity to `400 * facing` and vertical to `+540` until ground. Hitbox: a fist drawn at `(x + facing*24, y - 30)` with a generous diagonal hurt cone -- if it overlaps the opponent's standing band (-65..-5) at any frame during the dive, deals 14 dmg + horizontal knockback. On landing without contact, the player is locked in a `airWhiffRecovery` of 0.4 s (no walk, no punch, no crouch). Rendering: stick goes `>O>` head + `\|` arm + body angled forward.

**Reward.** Beats the jab cleanly when timed -- jump *over* the windup `!`, dive *down* onto opponent during their active or recovery for an aerial counter. Gives a third axis to the rock-paper-scissors: jab loses to crouch, crouch-walk-in loses to jab counter (player has to commit ground), divepunch loses to staying-back-and-jabbing-on-landing (whiff recovery = free hit). Also opens jump's first real use.

**Risk / failure mode.** Spam-jump-divepunch as a rushdown solution. Mitigated by: (a) `airWhiffRecovery` 0.4 s on miss is *long*, longer than opponent JAB_RECOVERY -- punishable by the AI's next jab if player lands in JAB_RANGE; (b) ascent-only J does nothing (no early commitment); (c) horizontal lock means missing means landing past the opponent into the wall.

**LOC.** ~30. Divepunch state on player + flag, J-handler branch on airborne, hit-test in update, render branch in `drawStick`.

---

## 2. Player punch whiff-recovery (Bushido Blade / Samurai Shodown)

**Inspiration.** Bushido Blade -- every swing commits your whole body. Samsho's heavy-whiff penalty.

**Trigger.** Punch *attempt* that does NOT register a hit on the connect-block (i.e. `punchAttempts++` runs but the hit-test conditional fails). Currently the fall-through is silent.

**Mechanic.** On whiff, set `player.whiffLock = 0.35` s. While `whiffLock > 0`: ignore movement input (vx target = 0), ignore jump, ignore crouch transition, ignore further punch buffer. Punch animation continues to play through (already 0.2 s active + return). Render hint: stick's punching arm stays extended an extra ~0.15 s past PUNCH_DURATION, with arm slowly retracting -- visually "off-balance."

**Reward.** Closes the symmetry the keystone opened -- the opponent commits 0.35 s on a missed jab, now you do too. Punishes mash-J at long range (currently free) and turns "spam J as you walk in" into a real risk: you walked in, threw early, opponent's jab is mid-windup, you can't crouch, you eat 12.

**Risk / failure mode.** Feels punishing if not telegraphed -- player will think the controls broke. Mitigation: `whiffLock` < `PUNCH_COOLDOWN + buffer time`, so it's only ~100 ms of *additional* lock past the existing cooldown; also the arm-droop render makes it readable.

**LOC.** ~12. One field, one timer-tick, two input gates, one render tweak.

**Composes with #1.** Divepunch already has its own `airWhiffRecovery`. Both are the "you committed, eat it" lever from the same pattern.

---

## 3. Opponent feint -- variable-rhythm jab (Street Fighter II Dhalsim feint, Tekken stance mixup)

**Inspiration.** SFII Dhalsim's slow-vs-fast limb feints; Tekken's stance variance.

**Trigger.** When opponent enters `windup`, roll `Math.random() < 0.30`. If feint: opponent never advances to `active`. After `JAB_WINDUP * 0.85` s (slightly shorter than full windup, so the rhythm tells), state goes straight to `recovery` of 0.2 s (NOT the full 0.35 -- shorter recovery so feint isn't free-punish bait). Visual: `!` glyph turns from yellow `#ffcc66` to dim grey `#888` at the 60% mark of windup -- the "feint tell" is the *fade*, not the absence.

**Mechanic.** Two state additions on opponent: `isFeint: false` (set at windup entry), and a check in the windup -> active transition that diverts to recovery if `isFeint`. The active hit-test never runs.

**Reward.** Breaks metronome rhythm. Player who blind-crouches every `!` will eat the *next* real jab because they crouched on a feint, stood up, walked forward expecting recovery, got hit by a real jab next cycle. Forces the player to *watch* the glyph color -- a real read, not a pavlovian reflex. The faded glyph is the keystone tell upgraded into a mixup.

**Risk / failure mode.** RNG can stack three feints in a row -> player stops crouching -> real jab connects, feels unfair. Mitigation: hard cap at 1 feint per 2 jabs (`opponent.feintsSinceReal` counter, clamped). Also: 30% rate keeps real jabs in the majority -- crouching is still the right *default*.

**LOC.** ~18. Two opponent fields, ~5 lines in windup entry, ~3 lines in transition, ~3 lines in render for color swap, counter clamp.

**Composes with keystone.** Same `!` glyph, same windup state -- this is a tell-modifier, not a new state machine. Stays cheap.

---

## 4. Crouch-uppercut -- low-to-high anti-air / startup cancel (Street Fighter crouching HP, KOF C uppercut)

**Inspiration.** SF Ryu's `crHP` / Shoryuken antecedent; KOF heavy crouch uppercut.

**Trigger.** Press J while `player.crouching && player.onGround` -- replaces the standard punch when crouched. Currently crouch+J fires the standard punch (fist at y-50, in the standing band) which is geometrically odd (a crouched stick can't reach up there).

**Mechanic.** Different hitbox arc: fist *starts* at `(x + facing*20, y - 20)` (low, near belt), *travels upward* to `(x + facing*30, y - 70)` (above standing head) over the 0.2 s active. Hits opponent's standing band (-65..-5) AND extends ~10 px above (-75..-5) so it's the only player attack that connects on a *jumping* opponent (none right now, but pairs with future opponent movement). Higher cooldown: 0.5 s vs 0.3. Damage 10 (slightly more than jab's 8). Bigger knockback: 480 px/s.

**Mechanically, here-and-now:** beats the opponent's `active` jab if you're already crouched -- because the uppercut arc starts low, rises through the jab fist's y=-50 plane, and your crouching hurtbox is still dropped 16 px so the jab itself whiffs. So: crouch (jab whiffs) -> immediately J (uppercut rises into the still-extended opponent fist) -> hit during opponent's `active`, NOT recovery. A new punish window: smaller, faster than the recovery counter.

**Reward.** Crouch becomes a verb, not a state. Two punish lines now exist -- (a) duck-then-stand-then-walk-then-jab (slow, big window via counter 1.5x), (b) duck-then-uppercut (fast, no walk-in needed, but only 10 dmg, smaller window). Trade is real: uppercut from neutral whiffs because reach is short; standing punch from neutral can't punish from crouch position.

**Risk / failure mode.** Power creep -- if uppercut is too easy, ignores the whole walk-in counter loop. Mitigation: shorter horizontal reach (~30 vs PUNCH_REACH=38), longer cooldown, locks crouch state for the full 0.2 s so you can't immediately stand up and walk away. Damage 10 < counter's 12.

**LOC.** ~25. New constants (UPPER_REACH, UPPER_DURATION, UPPER_DAMAGE), one branch in the punch-handler, one render branch in `drawStick` for the rising arm pose, separate hit-test arc.

**Composes with whiff-recovery (#2).** Uppercut whiff = 0.5 s of crouching exposed -- same lever, same rule.

---

## 5. Stamina meter -- aggression gate (Bushido Blade balance, For Honor stamina)

**Inspiration.** Bushido Blade stamina drain; For Honor's hard stamina-out punish.

**Trigger.** Each player punch (normal or uppercut or divepunch) drains stamina by a fixed amount (e.g. 25 / 35 / 30 of 100 max). Stamina regenerates at 30/s when not punching and not in `whiffLock`. If stamina < cost, punch is denied -- input rejected, brief grey flash on the stamina bar.

**Mechanic.** New player field `stamina: 100`. New constant `STAMINA_MAX = 100`, `STAMINA_REGEN = 30`, `STAMINA_PUNCH = 25`. Tick in update: `if (punchTimer<=0 && whiffLock<=0) stamina = min(STAMINA_MAX, stamina + STAMINA_REGEN*dt)`. Render: thin yellow bar under the player HP bar, drains hard on punch, refills smooth.

**Reward.** Closes the "hold J forever" loop entirely. Currently three normal punches in 2 s is allowed; with stamina, it's two and you wait. Forces the player to *pick* their punish window -- you can't both counter-punch the recovery AND throw a follow-up. Every aggressive verb has a real cost.

**Risk / failure mode.** Adds yet-another-meter on a 4-input game; clutter risk. Mitigation: render below HP bar, same width, no label -- visual noise is one additional thin strip. Also, with the existing 0.3s PUNCH_COOLDOWN, stamina has to be tuned so it's a *softer* gate than cooldown most of the time and only punishes sustained aggression (3+ punches in <3 s). Tune: regen 30/s + cost 25 = recovery in 0.83 s, slightly longer than punch cooldown -- so stamina depletes on chain, replenishes on patience.

**LOC.** ~22. Field, constants, regen tick, deny check, render of bar.

**Composes with all the above.** Divepunch costs more (35), normal less (25), uppercut middle (30) -- aggressive options self-rate by stamina cost. Pairs especially with feint (#3): if you blow stamina crouching+uppercutting on a feint, the next real jab is unanswered.

---

## Recommended pairings for iter-5 keystone

The strongest single keystone is **#1 Divepunch + #2 Whiff-recovery** together (~42 LOC). They're the same lever (player commitment) applied to the two open verbs -- ground punch and jump. Together they finally make jump useful AND punish ground spam, completing the symmetry the iter-4 keystone started. Crouch-uppercut (#4) is the next-best single pick if jump rehab is felt to be too speculative -- it's pure-ground and immediately shipping.

Pair-of-keystones idea: #1 + #4 (~55 LOC) gives the player two new attack verbs (air, low) to match the opponent's one new verb (jab). Saves #3 (feint) and #5 (stamina) for iter-6 once the player toolkit is symmetric.

Skip-list rationale:
- #3 feint requires the rhythm to be a bug first; right now there's only one combat rhythm so feinting is variance on a too-shallow base. Ship more verbs first.
- #5 stamina is a *gate* on verbs -- premature when the verbs themselves are still being added. Iter-6.
