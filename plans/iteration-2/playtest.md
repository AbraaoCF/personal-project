# Iteration 2 — Playtest Report

Read: `game.js` (305 LOC), `index.html`, `style.css`, `iteration-1/synthesis.md`.

All numbers below are traced from the actual constants. Frame = 1/60s.

---

## 1. Approach + first hit

**Closing distance.** Spawn: `player.x=250`, `opponent.x=640`. Opponent patrols 480..800 starting `patrolDir=-1`, so it walks *toward* the player at 1.6/frame. Closing rate while player holds D: 3.2 (steady) + 1.6 = 4.8/frame. Distance 390 → contact in ~81 frames (~1.35s). Feels brisk, fine.

**Easing.** With `VX_LERP=0.25`, vx ramps to 90% of target in ~9 frames; from a standing start D-tap, frame-by-frame vx is 0.8, 1.4, 1.85, 2.2, 2.45, 2.65, 2.8, 2.9, 2.97, 3.02. Total displacement over those 9 frames ≈ 21px, vs. 28.8px under the old hard-snap. That's ~7px lost on a sprint to first contact — a single frame of opponent patrol — so combat feel improves and approach time is essentially unchanged. Good trade.

**Honest hitbox.** With `PUNCH_REACH=38`, `tolerance=28`, the horizontal hit window is `dx ∈ [10, 66]` (player→opponent center). The visible `====` glyph is drawn from `x + facing*8` outward at 20px font (~32px wide), so it occupies roughly `x+8 .. x+40`. Hits register when the fist tip overlaps the opponent's `O` head — finally honest. The old 70/40 setup let you connect with empty air past the opponent. First hit now lands when the fist visibly touches; that's the win of iteration 1.

**Vertical** is `fistY > opponent.y - 65 && fistY < opponent.y - 5`. On the ground, `fistY = 420 - 50 = 370`, opponent window `(355, 415)`. Comfortable middle of the window — ground combat just works.

---

## 2. Trade-off (proximity vs. HP)

Punch-hit zone: `dx ∈ [10, 66]`. Contact-damage zone: `dx < 22`. **Overlap: `dx ∈ [10, 21]` — 12 px wide.** Clean punch zone (hit, no contact): `dx ∈ [22, 66]` — 44 px wide.

The clean zone is comfortable. A reasonable player parks at dx≈40, throws J, eats the 6×0.7-decay knockback (opponent flies ~19 px away), then steps back in. Each cycle: punch at dx=40, opponent kicked to dx≈59, you walk 19 px in ~6 frames, ready at 18-frame cooldown for the next. **The trade is interesting because contact damage *only* triggers if you mash forward into the opponent — punctual reach-distance play avoids it entirely.** Lopsided in the player's favor when played correctly.

But: a careless or panicking player who holds D + spams J ends up at dx<22 constantly, eats 4 dmg/0.5s (8 dmg/sec), and dies in ~12.5s while still landing punches. The punishment for sloppy play exists. Good shape; mostly the *floor* of the trade is too generous (see frustration #1).

---

## 3. Patrol exploitation

**Chasing.** Opponent at 1.6/frame, player at ~3.2 cruise → relative 1.6/frame. After landing a punch, knockback geometric series sums to `6/(1-0.7) = 20 px` (effective ~19.4 finite). Opponent then resumes patrol (direction unchanged). Player chases at +1.6/frame relative; closes the 19 px gap in ~12 frames. Punch cooldown is 18 frames. **Cooldown gates re-hit, not chase distance.** You will pretty much always be in punch range when cooldown ends. That's fine — the cooldown becomes the rhythm, not the geometry.

**Knockback contact-break feel.** Player shove of `vx = -6` then lerps back toward held input (3.2). Frame-by-frame vx: -6, -3.7, -1.5, 0.4, 1.5, 2.2, 2.6, 2.85, 3.0. Net displacement during recovery ≈ -6.4 px before turning around. Combined with opponent shove (+19.4), player ends up ~25 px farther after a clean contact-and-punch — well outside dx<22, so contact-cooldown's 30 frames is mostly redundant; you naturally separate.

**Jitter risk.** If you hold D *into* a contact, you spend ~9 frames with negative vx fighting the input, then ~7 frames re-accelerating. That's 16 frames (~0.27s) of "I pressed forward, why am I going backward?" The lerp masks it as a cushioned bounce rather than a teleport, so it reads as physics rather than a bug. Acceptable, but visible — anyone watching their own stick figure will notice the rubber-band.

---

## 4. Spam vs. timing

`keysPressed` is an edge set cleared each frame; J held down = exactly **one** punch attempt total until release. With `PUNCH_COOLDOWN_FRAMES=18` (0.3s), the *physical* spam ceiling is ~3.3 punches/sec assuming finger speed ≥ that.

**Better.** Iteration 1's autofire-on-cooldown-reset (`keys.has('j')`) silently consumed J presses and made the 18-frame cooldown meaningless to a held key. Now each press costs a press. `punchAttempts` in the K.O. screen finally measures a player decision instead of how long they leaned on the J key.

**Lag.** No input-buffering. If you press J at frame N while `punchCooldown=1`, the press is consumed by `keysPressed.clear()` at end of frame N and lost. Next frame the cooldown is 0 but you're not pressing. To get back-to-back punches you must press *exactly* at the cooldown boundary — pressing slightly early throws away the input. **This is the new "feels laggy" failure mode.** Most players will subconsciously pre-press, and lose ~1/3 of their attempted punches to this. A 3-frame buffer (store J-press intent, fire when cooldown hits 0) would erase the issue without re-introducing autofire.

---

## 5. Jump usage

`JUMP_VELOCITY=-12`, `GRAVITY=0.6` → apex in 20 frames, airtime 40 frames. Player.y trajectory: 420 → 222 (apex, peak −198 px) → 420.

Vertical hit window requires `fistY ∈ (355, 415)`, i.e. `player.y ∈ (405, 465)`. **Player.y is in this window only during the first/last ~3 frames of the jump arc** (the bottom ~15 px of vertical travel). For 34 of 40 airborne frames, your fist is too high to land anything.

So jumping over the opponent: technically possible (you'd be at y≈222 when passing), but you can't punch them while doing it. Jumping in place to dodge contact damage: useless because opponent's contact zone is `dx < 22` regardless of player.y — there's no Y component on contact, so you eat the same 4 dmg mid-air.

**More useless than iteration 0.** Now jumping costs you HP because you can't fight back during the airtime, and the opponent walks freely under you while you're unhittable in both directions. The skill `/|\` posture even draws a useless `~ ~` water trail underneath, mocking the move. Iteration 2's jump is a punishment button.

A jump-as-positioning fix would be tiny: either widen the vertical window to include apex height, or make jumping pass *through* the opponent (overlap immunity), turning W into a crossover/escape tool. Today, neither.

---

## 6. Loss feel

Pure-overlap death: 25 contact ticks × 30 frames = 750 frames = **12.5 seconds** of standing in dx<22. In practice that's not the loss path, because the player's `vx=-6` shove + lerp keeps creating separation, so a player who is *trying* to fight rarely camps inside the contact zone. Real losses come from corner-trapping (player against a wall, opponent shoves them, vx clamps to 0 at `ARENA_LEFT+16`, then they can't separate) or AFK.

**The 4-dmg ticks are too small to feel.** A single contact loses 4% HP and barely registers in the bar; the red flash (8 frames) is briefer than reaction time. A panicking player won't notice they're dying until the bar hits ~30%. Contrast with the 8-dmg punch landing on the opponent: same hitFlash duration but the player *causes* it, so it feels meatier. The player's death is a slow leak, not a punch in the face.

**12.5 s to die** is also weirdly long given a typical match probably ends in ~6 s of effective fighting (12.5 punches × 0.3s + chase). Death-by-overlap is essentially unreachable for a competent player; it exists as a "you stopped playing" timer rather than a real failure threat.

---

## 7. K.O. feedback

`if (player.hp <= 0) toGameOver()` and the same for opponent — both fire **on the same frame** as the killing hit. The DOM overlay snaps in over the canvas; `state` flips to OVER; render still runs and draws the final frame underneath. **Identical to iteration 0: instant freeze with a banner.**

Two HP bars makes it slightly worse, because now the player can see *both* bars in their final state, which highlights how arbitrarily the moment was chosen — there's no last-blow camera, no slump animation, no fade. The opponent draws as `/|\` (standing) with HP `0/100` next to it. The visual lies: the corpse is upright.

`gameover-stats` now reads "VICTORY  -  Punches thrown: N (landed: M)" — the new VICTORY/DEFEAT prefix is a real improvement, gives the screen a verdict. But the freeze is still the freeze.

---

## 8. Frustration points

1. **Hit-zone/contact-zone overlap (dx 10..21) punishes the closest punches.** A player who walks the fist *into* the opponent's body still scores a punch but pays 4 HP for it. Geometrically the inner 12 px of the 56-px hit window is a tax-zone. This is a balance accident, not a design choice — iteration 1 set tolerance=28 and contact dx<22 independently. Either widen contact to dx<10 (so it only triggers when the player is *behind* the punchable zone), or shrink hit-window inner edge to dx≥22.

2. **No input buffer for punch presses near the cooldown boundary.** Pressing J while `punchCooldown=1` discards the input (next frame `keysPressed` is cleared, cooldown is 0 but no key in the set). Expert play requires pressing *on* frame 0 of cooldown-clear. A 3–5 frame buffer (store last-press-frame, fire if `cooldown==0 && now - lastPressFrame < 4`) would fix this without re-introducing autofire from iteration 0.

3. **Jumping is now strictly worse than iteration 0.** Vertical hit window `fistY ∈ (355, 415)` excludes player.y < 405, which is 34 of 40 airborne frames. Jumping over the opponent is impossible-to-attack, jumping in place is contact-vulnerable (no Y check on contact), and air-recovery has no i-frames. The W key is a self-disable button. Either let air-punches register at apex, or grant brief contact-immunity while `!onGround`.

4. **Wall-corner trap.** Player hits `ARENA_RIGHT - 16 = 860`; opponent patrols up to 800 then knocks player back with `vx=-6`. But if the player is at the *left* wall (x=40) with opponent at x≈60, the `-6` shove drives them *into* the wall (player.vx=-6 because opponent.x>player.x, so shove is `-6 * 1 = -6`); next frame, x clamps to 40 and `vx=0`. Player now stuck against wall, opponent still in dx<22 → next contact in 30 frames. Walls become death zones.

5. **Contact damage too small to read.** 4 HP/30 frames is sub-threshold feedback: the bar moves 1.6% per tick, the red flash is 0.13 s, and the player's brain rounds it to "I'm fine." Either bigger ticks (8 dmg every 45 frames = same DPS, more thumpy) or longer hitFlash + a knockback shake on the player camera/text.

6. **K.O. is still a record-scratch.** Same instant overlay as iteration 0; now with two bars to inspect mid-stand. No body collapses, no slow-mo, no "FINISH" pause. The new VICTORY/DEFEAT label helps the readout but not the moment.

---

## Summary

Iteration 1's three changes all do what they claim. Honest hitbox is a real fairness win. Easing is felt-quality only and almost free. Player HP + contact damage promotes the patrol from decoration to soft pressure. **But the seams between the changes leak**: contact zone overlaps inner punch range, jump becomes net-negative, edge-trigger eats inputs at boundaries, walls become traps. None of these existed in iteration 0 because there was no contact damage, no edge-trigger, and no jump-relevant geometry. Each is a 1–3 line fix; iteration 2 should clean them up before introducing the telegraphed opponent jab.
