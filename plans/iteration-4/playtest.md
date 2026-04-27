# Iteration 4 — Playtest Report

Read of `game.js` (373 LOC), `index.html`, `style.css`. All numeric claims below traced against the post-dt code.

---

## 1. dt feel parity

**60 Hz (dt = 1/60):**
- `WALK_SPEED * dt` = 192/60 = 3.2 px/frame. Pre-dt was 3.2. Match.
- `GRAVITY * dt` = 36 px/s² per frame; `vy/60` per frame for position. Equivalent to old `vy += 0.6; y += vy`.
- `pow(1 - VX_LERP, dt*60)` at dt=1/60: `pow(0.75, 1) = 0.75`, so `(1-0.75) = 0.25` — identical to old `VX_LERP * 1`.
- `pow(0.7, dt*60)` at dt=1/60: 0.7 exactly. Old knockback `*= 0.7`. Match.
- Punch/cooldown/buffer timers tick by `dt` per frame; at 60 Hz, 0.2/0.0167 = 12 frames, matches old `12`. Hitstop 0.0667/0.0167 = 4.0. Match.

**144 Hz (dt = 1/144 ≈ 0.00694):**
- Walk per frame: 192 * 0.00694 = 1.333 px; over 144 frames = 192 px — wall-clock identical.
- Jump arc: peak time 720/2160 = 0.333 s; total air 0.667 s. Same as 60 Hz wall-clock.
- VX lerp: `pow(0.75, 0.4167)` ≈ 0.886 → (1 - 0.886) = 0.114 per frame; 144 frames of `(1 - 0.114)^144 ≈ pow(0.886, 144) = pow(0.75, 60) ≈ pow(0.75, 60)` — matches one-second decay at 60 Hz. Math holds.
- Knockback: 360 px/s decay `pow(0.7, 0.4167)` ≈ 0.860 per frame. Over N frames at 144 Hz to reach <6: `0.860^N < 6/360`, N > 27.5 frames = 0.191 s. Same wall-clock as 60 Hz computation below. Match.

**Drift watch:** floating-point `pow()` is not bit-exact across rates, so 60 Hz vs 144 Hz will diverge by float epsilon over many seconds. Negligible for play, but determinism is nominally lost. The synthesis flagged this.

**Sub-3-px velocity zero (line 130):** `if (Math.abs(player.vx) < 3) player.vx = 0;`. At 60 Hz dt=1/60, target=0, current=192 → after one frame: 192*0.75 = 144. Decays geometrically. Reaches <3 after `log(3/192)/log(0.75) = 14.4` frames = 0.24 s. At 144 Hz dt=1/144, per-frame factor is 0.886, `log(3/192)/log(0.886) = 34.4` frames = 0.239 s. Wall-clock-equivalent. Good.

**One real micro-drift:** the `Math.abs(player.vx) < 3` cutoff is a fixed px/s threshold, not a dt-scaled epsilon. At higher refresh, the velocity passes through 3 px/s in mid-frame and gets snapped to 0; at 60 Hz it lands on 2.something. Sub-pixel cosmetic.

---

## 2. Hitstop pose fix

The fix at line 172 sets `player.punchTimer = PUNCH_DURATION * 0.4 = 0.08` on connect. Render samples `punchT = 1 - 0.08/0.2 = 0.6` → falls in the hold band `(0.55 ≤ punchT < 0.80)` (line 272), `off = PUNCH_REACH = 38`. Full extension drawn during freeze. Correct.

**Subtle bug, post-dt:** during the 0.0667 s hitstop, `punchTimer` is *not* decremented (early-return at line 122 skips line 152). So `punchTimer` is exactly 0.08 entering the live frame. The first live frame post-freeze: `punchTimer -= dt` → 0.08 - 0.0167 = 0.0633 → punchT = 1 - 0.0633/0.2 = 0.683. Still in hold band. Hold band ends at 0.80, retract 0.80→1.0 over `0.2 * 0.20 = 0.04 s` = 2.4 frames at 60 Hz. So the visible animation post-impact is: ~2 frames hold + ~2 frames retract = ~4 frames ≈ 67 ms. Brisk.

**Concrete new bug:** at very low frame rates (the dt clamp at `1/30`), one frame can consume 0.0333 s of the 0.08 punchTimer. Two such frames take it to 0.013 → punchT = 0.93 → retract band, off = 38*(1-0.65)=13.3. Visually fine. No flaw, just noting the timer is short post-fix.

**Punch animation read post-fix:** the windup→extend→hold→retract phases are pre-impact 0.20→0.55 (extend) and the hit-test is the *moment* the punch fires (line 158-174). But the hit-test fires at `punchTimer = PUNCH_DURATION` exactly (entry to the connect block sets it on line 161, hit-test runs on line 166 with `punchTimer = 0.2`, so `punchT = 1 - 1 = 0`). The fix overrides post-hit. Correct logic.

---

## 3. K.O. hitstop

`HITSTOP_DURATION * 2 = 0.1334 s` ≈ 8 frames at 60 Hz, ~19 at 144 Hz. 133 ms reads as a clear "thunk" — comparable to a fighting-game super-flash but shorter. Should feel weighty, not laggy. The `hitFlash` on the dying body lasts `HIT_FLASH_DURATION = 0.1333` s — exactly the same window — so the freeze-and-flash end together cleanly, then `toGameOver()` fires next frame (line 213).

**Contact-damage K.O. is essentially unreachable in normal play.** The synthesis claims "12.5s to KO" but that assumes contact ticks every CONTACT_COOLDOWN = 0.5 s. With opponent patrolling 480→800 at 96 px/s (period 6.67 s, 2 passthroughs per cycle), a stationary player at x in [480,800] gets hit ≤2× per 6.67 s, i.e. once every 3.33 s on average. 25 hits = ~83 s. To get 12.5 s you have to *follow* the opponent and absorb pushback (`player.vx = -360`) repeatedly — basically suicide-mash into them. So K.O.-by-contact-hitstop is a curiosity, not a designed beat. The doubled freeze still works correctly there; it just rarely triggers.

---

## 4. Wall-shove (right corner)

Math: `opponent.knockback = 360 * sign`. `Math.abs(knockback) > 6` gate. Frames at 60 Hz to drop below 6: `log(6/360)/log(0.7) ≈ 11.47` → 11–12 frames = ~0.191 s. Distance the opponent travels: per-frame add is `knockback/60`, geometric series sum 360/60 * (1 + 0.7 + ... + 0.7^10) = 6 * 3.273 ≈ **19.6 px**. The synthesis quoted "~36 px" — that was the *player walk distance* during the same window (192 px/s × 0.191 s = 36.7 px), not the shove. Real shove is ~20 px.

**Worse bug — wall-shove never triggers in normal play.**
- Opponent's `patrolMin = 480, patrolMax = 800`. Right wall pin requires `player.x ≥ ARENA_RIGHT - 16 = 876 - 16 = 860`. (`ARENA_RIGHT = W - WALL_THICKNESS = 900 - 24 = 876`.)
- For contact (`|player.x - opponent.x| < 10`) at player.x ≥ 860, opponent.x must be ≥ 850. Patrol caps opponent.x at 800. Opponent only reaches ≥850 if previously knocked-back — which only happens by being punched. But by the time the player is punching from the right wall, fights are nearly over.
- Left wall: `ARENA_LEFT + 16 = 40`. Pinning here requires opponent.x ≤ 50, but patrolMin=480. Impossible without knockback.
- **Neither corner is reachable in standard play.** The wall-shove fix solves a problem that the patrol bounds already prevent.
- The only way to trigger the pin: walk to a wall, then *punch* to knockback opponent toward you (knockback direction is `360 * player.facing`, which sends opponent *away*, not toward) — also doesn't help.
- A player who pins themselves at the right wall (x=860) and waits — opponent stops at 800, dx=60, no contact. Player is safe but bored.

**Verdict:** Change 3 from iter-3 is currently dead code in practice. It's a correct fix for a corner case the AI's patrol can't reach. (It will start mattering once the opponent gets aggression — iter-5+.)

---

## 5. Combat shape — typical fight trace

Player spawns at x=250, opponent at x=640. Opponent patrols left toward 480.

- 0.0 s: Player walks right at 192 px/s. Opponent walks left at 96 px/s. Closing speed 288 px/s.
- Initial gap 640 - 250 = 390 px. Closes to punch range (~50 px gap, accounting for fistX) in (390-50)/288 ≈ 1.18 s.
- 1.18 s: First punch lands. Player.x ~480, opponent.x ~528, dx=48 → fistX = 480+38 = 518, |518-528|=10 → punch hits (10 ≤ 27 < 28, technically a near-miss; let me re-trace). Better trace: punch hits when 10 < dx < 66. Easy to land mid-arena.
- Each connect: opponent flies 360 px/s × 0.191 s ≈ 19.6 px right (sign = player.facing = 1). Player must close ~20 px before next punch. Punch cooldown = 0.3 s. Player closes 20 px in 20/192 = 0.104 s. Total per-punch cycle: 0.3 s cooldown + ~0.1 s walk = ~0.4 s.
- 13 punches × 0.4 s = 5.2 s. Plus initial ~1.2 s closing time.
- **Total fight: ~6.4 s.**

**Tension: zero.** Opponent has no offense. Player walks up, holds J every 0.3 s, watches HP bar drain. The hitstop on connect adds ~67 ms × 13 punches = 0.87 s of total freeze time (consumed inside the 6.4 s figure if I count right; or appended if not). The K.O. freeze adds 133 ms. Stats screen shows "Punches: 13 (landed: 13)" — boring.

The ONLY way to take damage: deliberately stand inside the opponent (dx<10) where punches miss. So "skilled" play takes 0 damage. "Unskilled" play takes 1–2 hits before the player figures out spacing.

This iteration delivers smoothness fixes. It does not produce a fight.

---

## 6. Frustration points (specific, post-dt numbers)

**6.1 Punch deadzone at exact dx=10.** `Math.abs(fistX - opponent.x) < 28` with fistX = x+38 gives a punch fail at dx ∈ [0,10] (fist overshoots: |38-dx| ≥ 28). Contact range fires at dx<10. So at dx ∈ {10}, neither happens. Float-precision narrow, but the *adjoining* ranges feel off: at dx=9 you eat contact damage AND your punches whiff (fist too long). Mashing punch while pressed against opponent does nothing visible — player thinks the game ate their input. This was flagged in iter-3 §"Defer" — it's still here. Suggested fix is widening tol from 28 to 30 (1 LOC), still deferred.

**6.2 Jump still misses.** `JUMP_VELOCITY=-720, GRAVITY=2160` → peak 120 px above ground at t=0.333 s. Punch hit-band requires `fistY > opponent.y - 65 && < opponent.y - 5` and fistY = player.y - 50. At peak: fistY = (GROUND_Y - 120) - 50 = GROUND_Y - 170. The valid band is GROUND_Y-65 to GROUND_Y-5. **Jumping puts your fist 105 px above the opponent's hit band.** Punching airborne literally cannot connect. Jumping is strictly bad. Air arc is 0.667 s of being unable to do anything useful. Same as iter-3.

**6.3 No `opponent.hp > 0` guard on punch hit-test.** Lines 166-173: punch connect mutates `opponent.hp`, `hitFlash`, `knockback`, `hitstop`, `punchesLanded` with no check that opponent is alive. Combined with iter-3 Change 2b (input retention through hitstop), this is exploitable: press J during the K.O. hitstop → buffer survives → first live frame post-freeze, punch fires, hit-test passes (opponent still on screen, no hp guard), `hitstop = HITSTOP_DURATION*2` *again* (line 171, since opponent.hp <= 0 still), `punchesLanded++` again. The death freeze can be extended by mashing during it. `punchesLanded` over-counts. Rare in casual play, but a real bookkeeping bug introduced by the iter-3 input-retention change. The contact-damage block has the guard (`opponent.hp > 0`, line 197). Asymmetric.

**6.4 Wall-shove unreachable.** Section 4 above. Iter-3 spent ~10 LOC on a corner-pin fix for corners that the patrol bounds (`patrolMin=480, patrolMax=800` vs pin thresholds 40 / 860) physically prevent. Real LOC; zero in-game effect. Won't matter until opponent AI reaches walls.

**6.5 No "punch denied" feedback.** Press J during cooldown → silently buffered if within 0.1 s of cooldown end, silently dropped otherwise. No flash, no animation. Player mashing at 5 Hz (200 ms intervals) within a 300 ms cooldown sees one of every two presses do nothing. Same complaint as iter-3, still deferred.

**6.6 HUD shows controls overlapping HP bar.** Line 355 draws control hint text at `(WALL_THICKNESS+8, 26)` — the YOU HP bar is at `x=WALL_THICKNESS+12, y=20, w=240, h=14` so y range 20–34. Hint text at y=26 lands inside the HP bar. Visual collision. Cosmetic but ugly.

**6.7 Sub-pixel snap inconsistency.** `Math.abs(player.vx) < 3` zeroes vx; opponent has no equivalent. Opponent during knockback decay slips past 6 px/s threshold and freezes its position lerp; before that, opponent.x integrates a sub-pixel velocity. Cosmetic; rendering rounds anyway via canvas font.

---

## 7. Persisting issues from iter-3

- **Jump useless:** YES, unchanged. Section 6.2. Needs aerial attack (deferred to keystone).
- **Mash silently drops:** YES, unchanged. Section 6.5.
- **K.O. by punch interactions with hitstop double-bookkeeping:** YES, NEW. Section 6.3. The iter-3 input-retention change opened this. Adding `opponent.hp > 0` to the punch hit-test (1 LOC) closes it.
- **Punch dx deadzone:** YES, unchanged. Section 6.1.
- **Wall-shove dead code:** NEW observation. Section 6.4.

---

## Bottom line

Iter-3 landed dt cleanly; math is solid at 60 and 144 Hz. The hitstop pose fix works. K.O. hitstop reads correctly for punches. But:
1. Combat is still a 6 s walk-up-and-hold-J because opponent has no offense.
2. The iter-3 wall-shove ships into a pin condition that can't occur naturally.
3. The iter-3 input-retention change introduced a new K.O.-mash exploit.

For iter-5: the keystone (telegraphed jab, crouch) is overdue — three smoothness iterations in a row without new verbs. Also: 1-LOC `opponent.hp > 0` guard on the punch hit-test, 1-LOC tol bump 28→30, 2-LOC HUD text reposition. Cheap fixes that would otherwise compound into ugly numbers.
