# Iteration 6 — Playtest Report

Read of `game.js` (548 LOC), `index.html`, `style.css`, and iter-5 synthesis. All seven iter-5 changes are present in the source. Numbers below are traced from constants at lines 64–93 and the update loop at 147–338.

---

## 1. Crouch-uppercut effectiveness

**Geometry.** UPPER_REACH=30, UPPER_HIT_TOL=28. Max landing dx = 30+28-1 = **57**. JAB_RANGE trigger upper bound = 60. So in the band dx ∈ (57, 60], the opponent commits to a jab the player cannot punish with uppercut from current position — they must walk in.

**Trace at dx=58 (just inside trigger).** Opponent enters windup at dx=58. Player crouches: vx zeroed (line 179), hurtbox drops 16. Jab whiffs vs crouched player: oppFistY=opp.y-50, bandHi=player.y-65+16=player.y-49, oppFistY > bandHi is `-50 > -49` → false → no hit (correct). Player presses J during opponent's active or recovery. fistX = player.x + facing*30. |fistX − opp.x| = |30 − 58| = 28 — strict `<` at line 214, so **whiffs**. Player must walk 1+ px closer first. Walk 1 px at 192 px/s = 5 ms — trivial, but they can't move while crouching (line 179 zeroes vx). They have to release crouch, walk, re-crouch, J. That blows past the 0.35s recovery window.

**Trace at dx=50.** |30 − 50| = 20 < 28 → **hits**. Counter check: if opponent in `recovery`, dmg = round(10*1.5) = **15**. Standing-punch counter = 12. Uppercut wins on counter damage by 3.

**Verdict.** Uppercut is reliable when the opponent triggers from inside JAB_REACH proper (dx ≤ 57), which is most of the active band (10, 60). The dead zone (57, 60] is narrow (3 px), but it's exactly the band where the opponent jab also barely reaches (max landing dx 59) — so in that dead zone the player gets jabbed on stand-up if they don't crouch, and gets a whiffed uppercut if they do. Slightly hostile, but small and only matters if the opponent triggers exactly at the outer edge of the patrol-induced approach.

The bigger concern: **uppercut reach (30) < jab reach (32) < punch reach (38)**. The shortest-reach attack has the highest damage tier (15 counter > 12 jab > 12 punch counter). Fine on paper, but the player is forced into the closest range to use it, which is also where contact-damage (dx<10) bites. At dx=12 the uppercut connects (|30−12|=18<28) but the player is one walk-frame from the contact-damage trigger.

---

## 2. Whiff-lock punishment

**Trace.** Player at dx=80 (well outside both PUNCH_REACH=38 and JAB_RANGE=60). Player presses J. Standing-punch path. fistX = player.x + 38, |fistX − opp.x| = |38 − 80| = 42 — not less than 28 → miss → `whiffLock = 0.35` (line 252). For 0.35s: line 161 zeroes move input, line 182 blocks jump, line 203 blocks new punch buffer, line 205 blocks any pending fire.

**Opponent state during the whiff.** Player is at dx=80, outside JAB_RANGE=60, so opponent is patrolling. Opponent walks at OPPONENT_SPEED=96 px/s. In 0.35s, opp closes (or recedes) by 33.6 px. If patrolling toward player and player is locked still, dx drops from 80 to 46.4 — well inside JAB_RANGE. Opponent enters windup mid-lock. Windup is 0.5s, so the active frame fires ~0.15s **after** lock clears. Player has 0.5s to react from windup start, which started ~partway through the lock. Net: player sees `!` while still locked for ~part of the lock, then has the full remaining windup to crouch. Should not eat damage if reading the cue.

**Edge: opponent already in active when player whiffs at dx=80.** Can't — opponent only triggers active when dxToPlayer < 60. Whiffing at dx=80 means opponent is patrolling, not jabbing. So the worst case is the post-windup catch above, which is survivable.

**Edge: opponent on cooldown (post-recovery JAB_COOLDOWN=1.2s with the 0.5×/1.0× multiplier).** After a whiffed jab, opponent's idle stateTimer is `JAB_COOLDOWN * 0.5 = 0.6` if player landed standing (line 243) but only set after a hit. After a *missed* jab (no hit), opponent goes from active → recovery → idle with `stateTimer = JAB_COOLDOWN = 1.2` (line 309). Plenty of room to whiff and recover.

**Verdict.** Whiff-lock is appropriately punishing in isolation but **not actually a punish for the most common spam** — see §5. The 0.35s lock is calibrated to 0.5s windup, which gives the player a small reaction buffer. Fine.

---

## 3. JAB_RANGE=60 vs counter window

**Trace from dx=50 trigger.** Opponent enters windup at dx=50. Player crouches; jab whiffs. Opponent enters recovery. Player has 0.35s. To counter-punch standing: release S, walk forward, press J. PUNCH_REACH=38, max landing dx = 38+28-1 = 65. Already in range! Walk-up is **0 px** required. But player can't punch while crouching (uppercut fires instead). So player must release crouch *before* J. Or just press J while crouching → uppercut fires (|30−50|=20<28 → hits, 15 dmg counter). Both paths land.

**Trace from dx=59 (trigger edge).** Crouch, jab whiffs. Recovery starts. Stand and punch: |38−59|=21<28 → standing-punch counter (12 dmg). Or stay crouched, uppercut: |30−59|=29 ≥ 28 → **whiffs**, eats whiffLock... wait, line 252 only sets whiffLock on standing-punch miss; uppercut miss has no whiffLock (per spec). Uppercut just consumes UPPER_COOLDOWN=0.5s. Player can re-crouch and try again, but recovery is already 0.35s — the punish window is gone.

**Knockback effect on counter.** Counter counter-flow: opponent jab whiffs, no hit on player → no player knockback. Player position unchanged. So the dx at trigger ≈ dx at recovery start, modulo opponent movement. Opponent doesn't move during windup/active/recovery (line 258 only updates opp.x on knockback or idle patrol). Stable.

**Verdict.** The standing-punch counter is now the safer choice at the trigger edge (dx 50–59); uppercut is the higher-reward choice in the heart of the trigger band (dx 10–57). That's a real decision, which is what the design wants. **Good.**

---

## 4. Knockback channel feel

**Math.** Hit applies `knockbackVx = 360 * oppFacing`. Decay: per-frame `*= pow(0.7, dt*60)`. At 60 fps (dt=1/60), each frame multiplies by 0.7. Frames to reach 6: 0.7^n = 6/360 ≈ 0.0167 → n ≈ 11.5 frames ≈ **0.19 s** ✓.

**Total travel.** Sum of v*dt over the decay: `(360/60) * (1 + 0.7 + 0.49 + … )` ≈ 6 / 0.3 = **20 px**, not 38. The synthesis prompt overestimated. 20 px is a noticeable shove but small relative to JAB_RANGE=60.

**Plus input vx.** Player input lerped vx survives. If player held forward into the hit (toward opponent), net travel = 192*0.19 − 20 ≈ **+16 px** (toward opponent!). The knockback can be cancelled by held-forward input. Reads as "I got tagged but kept walking in" — soft. If player held away, net = −192*0.19 − 20 ≈ −56 px — reads as a clean shove.

**Verdict.** The 20 px shove is on the low end — readable but not impactful. With held-forward input it's neutralized entirely. Smoothness pick C delivered "no rubber-band" (the input lerp no longer eats it within one frame because vx and knockbackVx are separate channels), but the magnitude is so small that it reads more as "controller hiccup" than "I got hit." Suggest scaling knockback to 480–540 in iter-7, OR scaling decay base from 0.7 to 0.8 (slower, longer slide). The current value worked when knockback was being eaten by the lerp; now that it's a real channel, it deserves more weight.

---

## 5. Stagger / mash-J during whiffLock

**Trace.** Player presses J at frame N. Standing-punch fires, `punchCooldown = 0.3`. **If hits**: line 252 only sets whiffLock on miss path — landed punch, no whiffLock. Player presses J at frame N+1 → blocked by punchCooldown=0.3s. Punches gated by cooldown. **If misses**: `whiffLock = 0.35`. Player presses J at frame N+1 → line 203 blocks buffer, line 205 blocks fire. After 0.3s, punchCooldown expires but whiffLock still active for 0.05s more. Net: between hits, the gate is min(0.3, 0.35) = 0.3s on landed, and 0.35s on whiffed (whiffLock takes over for the last 50ms).

**Verdict.** The synthesis claim is correct: whiffLock effectively only matters for missed punches because PUNCH_COOLDOWN was already 0.3s and the difference is 50ms. The lock's *real* effect is **disabling movement and crouch during the lock**, not blocking the next punch. The "you whiffed and now you can't dodge the incoming jab" scenario is the actual cost. 50ms of extra punch-gating is invisible.

Mash-J at distance: each whiff burns 0.35s of mobility lockout. Over 2s of mashing at dx=80, player whiffs ~6 times, locked nearly the entire 2s. That's the intended discouragement.

---

## 6. Persisting issues

**Jump still useless.** Line 182: `if (wantJump && player.onGround && !player.crouching && player.whiffLock <= 0)`. Jump fires; player rises with vy=-720, gravity 2160 → time to apex = 720/2160 = 0.333s, total airtime ~0.667s, peak height = 720²/(2*2160) = 120 px. **No air attack exists.** Jump cannot punch (line 205 fires standing-punch, but the hit-test at line 236 uses `player.y - 50` for fistY — at apex player.y is GROUND_Y - 120, so fistY = GROUND_Y - 170, way above the band check `fistY > opp.y - 65 && fistY < opp.y - 5`. **Jumping disables your punch entirely.** Jump is worse than useless: it removes your only ranged tool for 0.667s. **Critical hole.** Iter-5 explicitly deferred divepunch. Now in iter-6, jump remains a trap button.

**Determinism.** Opponent is fully deterministic: triggers when dxToPlayer < 60 ∧ stateTimer ≤ 0 ∧ alive. No feint, no variance, no positional randomness. Player who masters one approach pattern (walk to dx=55, crouch on `!`, uppercut on recovery) wins every match by ~7 reps.

**KO math.** Opponent: 100 HP. Uppercut counter (15) × 7 = 105 → **7 counters to KO**. At opponent jab cycle = 0.5 windup + 0.12 active + 0.35 recovery + 1.2 cooldown = **2.17 s/cycle**. 7 cycles = **15.2 s** to KO. Standing counter (12) × 9 = 108 → 9 cycles = 19.5 s. Player: same opponent jab cycle hits player for 12 once per 2.17s if undodged → 9 hits = 19.5 s. With perfect crouching, opponent's hit rate → 0, player wins in ~15s. With zero crouching, both KO simultaneously around 19s. Decision: crouch.

**Match feels short.** 15s perfect-play KO is faster than a single boxing round. With 0.0667s hitstop, hits feel snappy but the rounds end before a rhythm forms.

---

## 7. Edge cases

**Uppercut buffered while crouching, then crouch released before fire.** Press S+J at frame N. Line 203: `wantPunch && whiffLock<=0` → punchBuffer=0.1. Line 205 fires next frame (or this frame if cooldown ≤ 0). At fire time, line 209 checks `player.crouching`. Line 176 sets `player.crouching = onGround && whiffLock<=0 && (S held || arrowdown || uppercutTimer>0)`. If S released between press and fire, crouching=false → **standing punch fires**, not uppercut. The buffer carries the J intent but not the crouch state. Per the iter-5 spec note: "the input the player committed is J + crouching at fire time." Acceptable, but a little surprising — fast tap of S+J might fire either depending on which key released first.

**Punch buffered while standing, then crouching before fire.** Press J at frame N (no S). Line 203: punchBuffer=0.1. Player presses S at frame N+1 before cooldown clears — line 176 sets crouching=true. Fire frame: line 209 sees crouching=true → **uppercut fires**. Same input-committed-at-fire-time rule. Slightly punishing if player intended a standing punch and tapped S accidentally; less common than the S+J case.

**Sign-fix on jab knockback.** Line 297: `player.knockbackVx = 360 * oppFacing;`. Player at x=200, opp at x=240. oppFacing = (200<240 ? -1 : 1) = -1. knockbackVx = 360 * -1 = **-360** → pushes player toward x<200, **away from opponent**. ✓ Correct sign now. Confirmed against contact-damage line 322: `player.knockbackVx = -360 * (opponent.x > player.x ? 1 : -1)`. Opp right of player → +1 → knockbackVx = -360 → pushes player left, away. Same outcome by different formula. Both correct.

**Uppercut while in whiffLock.** Line 176: `player.crouching` requires `whiffLock <= 0`. So if the player was crouching (uppercut active) and then whiffLock is set... wait, uppercut doesn't set whiffLock. Standing punch does. Can a standing-punch whiff happen while uppercutTimer>0? No — line 209 branches on crouching, and whiffLock is only set in the `else` (standing) branch. The whiffLock and uppercut paths are disjoint. ✓

**uppercutTimer keeps crouch alive after S release.** Line 176 includes `|| player.uppercutTimer > 0`. UPPER_DURATION=0.2s. If S released the frame after J, crouch persists for ~0.2s — the uppercut animation completes in crouch pose. ✓ As specified.

**Punch hits opponent during active jab.** Player at dx=40, opponent in active. Player standing-punches. Line 236: |38−40|=2<28, fistY=player.y-50, opp.y=GROUND_Y same as player.y, so band: -50 > -65 ✓, -50 < -5 ✓ → hit. Counter check: `opponent.state === 'recovery'` → false → standard PUNCH_DAMAGE=8 (not counter). Player took the trade: 12 damage to player from active jab landing same frame? Race condition: order in update is **player punch fires before opponent active hit-check** (line 205 vs line 287). So player's punch resets opp.state='idle' (line 242) before opp's jabHit check runs. **Player wins the trade**, no jab damage. Subtle but exploitable — player can dx=40 stand-trade through the active frame and never get hit. This is the "trade" exploit hole that should be flagged.

Actually re-reading: opp's active branch runs only if `!knockbackActive`. Player punch sets knockback (`opponent.knockback = 360 * facing`), so `knockbackActive` becomes true → opp's hit-check is skipped this frame. Confirmed: stand-trading at dx=40 always favors the player. **Free trade exploit.** Deals 8 damage, takes 0. This is more exploitable than crouch-counter.

**8 dmg × 13 = 104 dmg → 13 stand-trades to KO.** At PUNCH_COOLDOWN=0.3s rate, plus walk-in time, each trade loop ~1.5s (walk to 40, J, knockback pushes opp 20px so dx≈60, walk back in). 13 × 1.5 = ~20s. **Same KO speed as the counter strategy with zero risk.** Crouch-counter is the "right" play but stand-trade is the dominant strategy. **Critical for iter-7.**

---

## 8. Crouch transition

**Trace.** Player walking right (vx=192). Press S. Line 176: crouching=true. Line 179: `if (player.crouching) player.vx = 0;` — vx zeroed instantly, no lerp. Visual: drawStick crouch branch (line 386) draws `_O_ /|\ / \` instead of standing pose. Pose change is single-frame.

**Read.** vx hard-stop reads as a controller cut. Visual is a clear duck (head text drops from y-50 to y-30, plus the new arms position). The pose swap reads as the duck because of the visual delta; the velocity hard-stop is hidden by the immediate pose change. **Reads as "duck."** ✓

But: after release of S at the end of crouch (assuming uppercutTimer=0), player.vx=0 still, and walking input lerps from 0 → 192 over the lerp window. Time to reach 95% of target via `pow(1-0.25, dt*60)`: per-frame factor 0.75, n where 0.75^n = 0.05 → n ≈ 10 frames ≈ 167ms. Acceptable un-crouch acceleration.

---

## Summary

**Working well.** Crouch-uppercut geometry holds (in core trigger band), counter window is generous, JAB_RANGE=60 fixes the iter-4 cheese, knockback sign is correct, recovery `~` cue is readable.

**Working poorly.**
- **Stand-trade exploit at dx=40** — player's punch interrupts opponent's active hit-check via knockback flag. Free 8 dmg × 13 KO. Highest priority for iter-7.
- **Knockback magnitude (20px travel) is too small** — channel works, but the impact reads weak. Bump to 480–540 or slow decay.
- **Jump is still a trap button** — divepunch deferred again leaves the W key actively harmful (removes your punch for 0.667s). Iter-7 must address.
- **Match length (~15s perfect-play)** is too short for rhythm to develop.
- **Determinism** unchanged. Feint/variance still deferred.

**Edge case to flag.** S+J vs J+S timing decides standing vs uppercut based on which key wins the fire-frame race. Not a bug, but a subtlety the controls screen doesn't communicate.

**Iter 6 of 15.** Significant progress on ground game (crouch is now a real verb, not a hurtbox), but the new attack created a new dominant strategy (stand-trade) by side-effect. The jump rehabilitation must come next — three more iterations of "we'll do divepunch next" is wasting the budget.
