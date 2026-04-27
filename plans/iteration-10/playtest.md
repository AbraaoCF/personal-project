# Iteration 10 — Playtest Report (post wall-run)

Iter-9 ships the wall-run keystone. Tracing through `game.js` (currently 781 LOC) against the synthesis claims and constants. Canvas is `900x500`, so `W=900`, `H=500`, `GROUND_Y=420`, `ARENA_LEFT=24`, `ARENA_RIGHT=876`. Fighter clamps at `40` and `860` — usable arena width = **820 px**.

---

## 1. Wall-stick trigger — straight-up jump case

Trigger condition (`game.js:279`): `player.vy >= 0 && Math.abs(player.vx) >= WALL_STICK_VX_MIN(80)`.

- **Walk-jump (vx≈192):** mid-arc, `vx` lerps toward 0 only if `move===0`. While airborne, holding D keeps `targetVx=192`, so vx stays ≥80. Apex passed → `vy>=0` → first wall-edge frame triggers stick. ✓
- **Straight-up jump (vx≈0):** `Math.abs(vx) >= 80` fails. No stick. Player falls straight back down. ✓ Intent-gated as designed.
- **Subtle case — release D mid-air:** `player.vx` lerps toward 0 with `VX_LERP=0.25` per `dt*60` frames. From 192, after ~0.5s decay falls below 80. If the player jumps near a wall and releases input, they may arrive at the wall with `vx<80` and pass through — no stick, falls past wall edge to ground. **Probably OK as design** but worth noting: holding direction matters.
- **Sticking during dive:** dive sets `vx = DIVE_VX*facing = ±320`, `vy=540`. At wall x within ~50 px of arena edge, both gates pass → stick mid-dive. Synthesis flagged this; it persists. After stick, `player.diving` stays `true` (no reset in stick branch), and the divepunch hit-check at line 464 still runs. **Stick-and-stab works as documented.**

---

## 2. Wall-jump physics — wall-to-wall traversal

Wall-jump sets `vy=-720`, `vx=±360` (`game.js:246-256`).

- Apex time: `720/2160 = 0.333s`. Apex height above launch: `720²/(2·2160) = 120 px`.
- If launched from `y=GROUND_Y(420)`, total airtime to land = `2·0.333 = 0.667s`. Horizontal travel in airtime: `360·0.667 = 240 px`.
- Arena interior width 820 px, but practical fighter span = `860-40 = 820 px`. **One wall-jump covers ~29% of the gap.** Wall-to-wall in one bound is impossible. ✓ matches synthesis claim.
- **Feel assessment:** the player must arc back to floor, walk across, jump, then wall-stick. From left wall to right wall total: ~0.67s wall-jump arc back to the floor (lands ~240 px in), then ~620 px to walk at WALK_SPEED 192 = 3.2s, then jump. Round-trip wall-to-wall ≈ **~4 seconds**, almost all of it walking. This is a long lateral commute. With the opp climbing in 1.5s (item 3), the timing actually allows for a player to wall-jump _toward_ the opp's wall, drop to floor, walk, and re-jump — but the second jump is grounded, not wall-launched, so vx is only 192 vs the wall-jump's 360. Still reachable, just slow.
- **Practical observation:** the more useful wall-jump pattern is "stick to opp's same wall, slide-attack downward" rather than "cross-wall pursuit." The 240 px horizontal range is too short to cross.

---

## 3. Opponent corner-climb timing

Trigger at `opponent.x <= ARENA_LEFT+16+4 = 44` or `opponent.x >= ARENA_RIGHT-16-4 = 856` (`game.js:363, 367`). Sets `opp.surface = 'left'/'right'`, `opp.vy = -EVASION_SPEED = -130`.

Climb math: from `GROUND_Y=420` to `targetY=H*0.45=225`. Distance = 195 px. At 130 px/s → **1.5 s climb** (matches synthesis).

Player intercept feasibility from opposite wall:
- Player must (a) wall-stick on the FAR wall, (b) wall-jump, (c) reach opp's wall mid-arc, OR (d) walk-jump from floor and divepunch.
- (c) impossible — wall-jump only carries 240 px, opp is ~820 px away.
- (d) walk to mid-arena (~410 px from one wall) at 192 px/s = ~2.1s. Already too slow vs 1.5s climb.
- **Realistic intercept:** player chases the fleeing opp before opp reaches the wall. Once opp is climbing on far wall, intercept costs more than 1.5s. Player effectively has to wait for opp to drop back (drop trigger: `Math.abs(player.x - opp.x) > EVASION_RANGE*2 = 180` AND `!playerNearWall`).
- **Outcome:** opp's wall-perch is a soft "respite" — opp uses it to escape pressure. Player's counter is to STAY near opp's wall (within 180 px) which forces opp to hold position; then walk-jump into divepunch range.

---

## 4. Hit while wall-stuck — divepunch from above

Player wall-jumps from left wall at `y=225` (assuming player matched opp height). vy=-720, vx=+360. Apex above launch: 120 px → apex y=105. Gravity descent. Divepunch hits when `fistY ∈ (opp.y-80, opp.y-20) = (145, 205)`, so `player.y ∈ (175, 235)` since `fistY = player.y - 30`.

- Player descends through y=175 quickly after apex.
- BUT: player has already moved right at 360 px/s while arcing. From left-wall x=40, in ~0.5s arc time, player.x ≈ 40 + 0.5·360 = 220 — nowhere near opp at x=856. So player is on left side of arena, opp is on right wall.
- **Hit-test x-gate fails:** `Math.abs(fistX - opp.x) < DIVE_HIT_TOL(28)`. fistX ≈ 220+30 = 250. opp.x = 860. `|250-860| = 610 ≫ 28`. No hit.
- The synthesis trace assumed launching "from left wall" but missed that the player's arc only covers 240 px horizontal, not the full ~820 px gap. The geometric window for cross-arena divepunch on a wall-stuck opp **does not exist with current constants.**
- **Workable pattern:** player wall-sticks on the SAME wall as opp (both on right wall, opp at y=225, player slides down or jumps from below). Or grounded-jump under opp + divepunch. Floor-launch ground jump: vy=-720 → apex y = GROUND_Y - 120 = 300. fistY = 300 - 30 = 270. Outside (145, 205). **Grounded jump can't reach divepunch band on a wall-perched opp** either — apex height is 120 px, opp is at y=225 (195 px above ground). Player apex doesn't reach.
- **Genuine bug / design gap:** player has no tool that hits the wall-stuck opp at y=225. Wall-jump arc is too short to cross; floor-jump apex is too low. The opp's wall climb is effectively invulnerable until they descend voluntarily.

---

## 5. Player wall-stuck attacks — facing/geometry

Punch `fistX = player.x + facing*PUNCH_REACH(38)` (`game.js:436`).

- Wall-jump sets `facing=1` when leaving left wall and `facing=-1` when leaving right wall (`game.js:248, 254`). This is set at jump-time, but during the stick itself, facing was last set by `move` input on the floor before the jump — could be stale.
- **Trace:** Player walks right (facing=1), jumps, sticks to right wall. Stick branch sets `vx=0` but doesn't touch facing. facing stays 1. Punching while stuck: `fistX = 860 + 1·38 = 898`. opp at 460. `|898-460|=438`. No hit. Punch fires "into the wall" / off-arena.
- Synthesis Change 6 already calls this out under "drawStick rotation": hit-test geometry stays in world-space. Wall-stuck punching is effectively defensive-only / decorative. Confirmed limitation, not a new bug.
- **Visual side:** drawStickOnSurface rotates +π/2 for left, -π/2 for right. With facing=1 and on right wall (rotated -π/2), the punch arm draws "downward" in screen-space. With facing flipped at wall-jump time, the rendered facing during stick depends on what last set it — pre-stick walk direction. So a player who walked right into right-wall renders facing 1 (rotated → arm points DOWN screen). Reads vaguely as "punch toward floor" — not crazy but not obviously right.

---

## 6. Cat/mouse closure timing

Player walk 192, opp flee 130. Closure rate 62 px/s. From EVASION_RANGE 90 to PUNCH_REACH 38 = 52 px to close → **0.84s** closure time. ✓

Shield rhythm: 0.6s open, 1.4s closed → 30% open windows. But the open phase also restarts after every successful hit (`opponent.stateTimer = SHIELD_CLOSED` post-hit, line 452). Per-hit cycle:
- chase 0.84s → wait for open window (avg 0.7s if ~random phase) → hit (instant) → opp goes 1.4s shielded.
- ~2.94s/hit, but during the 1.4s shielded window the opp is ALSO knocked back ~120 px (`opp.knockback = 360`, decays at ·0.7^(dt·60), ~0.3s effective travel ≈ 120 px). Player has to chase that distance again — adds ~0.6s.
- Effective: ~3.5s per hit. 13 hits to KO (100/8) = **~45s/round.** Synthesis estimate of 35s was optimistic; real is closer to 45s. Still better than iter-8's ~50s.
- BUT factor in the wall-climb stall: any time opp reaches a corner, opp climbs and is ungrabbable for ~3-4s (climb 1.5s + hold until drop trigger fires). Per round, this could happen 2–3 times, adding 6–10s. **Round duration ~50–55s.** Wall-run made the chase _harder_, not easier, given item 4's intercept gap.

---

## 7. Dive-bounce landing lag — verified

`game.js:296-301` (dive landing branch in airborne block):
```
if (player.diving) {
  player.diving = false;
  player.vx = 0;
  player.landingLag = LANDING_LAG;   // <-- always, no `if (!player.diveHit)` guard
  player.diveHit = false;
}
```
Synthesis Change 5a is shipped. Both successful dive and shield-bounce dive eventually land and pay LANDING_LAG=0.4s. ✓

**Subtlety:** the shield-bounce branch (line 472) sets `player.vy = -300` AND `player.diveHit = true` AND keeps `player.diving = true`. Player bounces upward, peaks at `300²/(2·2160) ≈ 21 px` above shield-hit point, falls back. `diveHit=true` prevents a second shield interaction during this bounce — but `diving` is still true through the bounce, so on the next descent, the divepunch hit-check at line 464 fires again with `!player.diveHit` failing because diveHit was set true. ✓ No double-hit.
- However: **diving stays true during the bounce-up phase**, which means `move = 0` is forced (line 218), and divepunch can't be re-fired (line 317 `!player.diving`). Player is locked in dive-state until landing. Slight feel cost on a whiffed dive-bounce, but correct.

---

## 8. No more contact damage

Searched for `CONTACT_DAMAGE`, `contactCooldown`, `contactDx` — **none present.** All removed. Player can stand inside opponent (e.g. while opp is shielded mid-knockback) without HP loss. ✓

---

## 9. Persisting issues

- **Pip overlap with HP bar label:** pips drawn at y=12 (line 740-744), HP label at y=20 with text baseline `alphabetic` (line 668), bar y=20 height 14. Label "YOU 100/100" sits at y≈18. Pips at y=12 with monospace 12px font. Pips render LEFT of bar at x=`WALL_THICKNESS+12=36`, label starts at same x=36. **Direct overlap on left side, vertical separation only ~6 px.** Same on right. Visible artifact persists.
- **Intermission overlay snap-in:** `roundPhase === 'intermission'` toggles full-rect fill (line 753) with no fade. Snap remains.
- **KO pose:** `hp<=0` doesn't change rendering — the dead fighter draws same pose with red flash decaying. Snap-to-static missing.
- **Knockback magnitude:** punch=360, upper=480, dive=420. Decay `*0.7^(dt·60)/frame`. Effective travel: ~120 px for punch, ~160 for upper. Still feels light per synthesis §9.

---

## 10. New bugs / edge cases from wall-run

### 10.1. whiffLock expiring on wall — OK
Wall-stuck branch doesn't check whiffLock. Wall-jump branch (`game.js:244-256`) is unconditional on `surface !== 'floor'` and explicitly clears whiffLock. So even if you stick mid-whiff-lock, you can wall-jump out immediately. ✓ Synthesis intent preserved.

### 10.2. Knockback during wall-stick — REAL BUG
`player.knockbackVx` is decayed and applied at lines 225-230 BEFORE the surface clamp at 232. The clamp at 232 only runs if `surface === 'floor'` (line 232). So:
- Player wall-stuck on left wall (x=40, surface='left'). Takes shield-bounce: `knockbackVx = -SHIELD_BOUNCE * facing`. If facing=1, knockbackVx = -360 (pushes left, into wall — fine, clamp would block but clamp doesn't run).
- Wait — shield-bounce sets `player.knockbackVx = -SHIELD_BOUNCE * player.facing`. From left-wall stuck, post-wall-jump facing=1. After landing/whatever this is post-attack. While wall-stuck though, the player isn't punching (no punch system on walls per item 5). So this triggers only after wall-jump → during airborne arc → if shield-bounce happens in dive.
- **More direct case:** player on left wall (surface='left', x=40). knockbackVx still has residual from PREVIOUS frame's hit (e.g. just before sticking). Decaying knockbackVx of, say, +200 (push right, away from wall). Line 226: `player.x += knockbackVx * dt`. x becomes 40 + 200·dt ≈ 43. Line 232 surface check: `surface==='left'`, clamp skipped. **Player drifts RIGHT off the left wall while still flagged surface='left'.** Stick branch then continues sliding down (vy clamped) at x=43 (no longer on wall). Visual/logical desync.
- **Severity:** moderate. The drift only lasts as long as knockbackVx > 6 (~5–10 frames). Player teleports up to ~30 px inland of the wall while sliding. Wall-jump from this state still works (surface flag carries). Mostly cosmetic but could push player into "stuck mid-air" until they detach.

### 10.3. Walking off the wall — confirmed NO
While wall-stuck: line 218 `if (player.diving) move=0` — but wall-stuck isn't diving. `move` from input still gets through to line 220 `targetVx = move * WALK_SPEED`, which lerps `player.vx`. **Wait — re-read:** lines 219-223 only run `if (!player.diving)`. So vx DOES update even when wall-stuck. Then line 224 `player.x += player.vx * dt`. **Player walking input WHILE wall-stuck moves them off the wall horizontally!**
- Example: stuck on right wall x=860, player presses A. vx lerps to -192. x=860 + (-192)·dt drifts left. Surface clamp at 232 skipped (surface='right'). Player drifts inland while flagged stuck. Same desync as 10.2.
- **The synthesis claim "walking input is ignored (no `move` applied to vx; vx is held at 0 via wall-stick branch)" is WRONG.** The stick branch only zeros vx _on entry_ (line 283/288), not every frame. Subsequent frames let `move` rebuild vx.
- **Severity:** real bug. Player can walk off the wall and float in air with surface still flagged. Combined with 10.2, the wall-stick state has no horizontal lock.

### 10.4. Opp climbing past target
`opp.y > targetY` → ascend; else snap to target and zero vy. With `opp.vy = -130` and `dt ≈ 1/60 = 0.0167s`, per-frame Δy = -2.17 px. Overshoot at most 2 px. The else-branch snaps cleanly. ✓ No oscillation.

### 10.5. Opp drop-to-floor snap
Drop trigger (`game.js:393-399`): `!playerNearWall && |player.x - opp.x| > 180`. Sets `opp.y = GROUND_Y` instantly. **Visual jank confirmed.** From y=225 to y=420 in one frame — opp teleports down 195 px. Synthesis flagged for polish; persists.

### 10.6. Opp can be cornered while wall-stuck on opposite wall
`opp.surface !== 'floor'` skips evasion logic entirely. If opp is wall-stuck on right and player walks across, opp doesn't react until drop trigger fires. Then opp drops to floor at x=860 with player nearby — within EVASION_RANGE → opp re-flees right → re-corners → re-climbs. **Loop possible** if player parks just outside `playerNearWall` boundary (x=W-200=700). At x=700, opp at right wall, `|700-860|=160 < 180` so drop trigger fails (the AND requires `>180`). Opp holds. Player at x=700 to opp at x=860: 160 px. Move closer to push opp into permanent wall-perch. Stalemate region exists at `playerNearWall=true` boundary.

### 10.7. Dive-stuck on wall — `landingLag` not paid
Synthesis §1 edge note: dive can stick to wall mid-flight. If it does, `surface='left'/'right'`, `diving=true`, `vx=0`. Wall-slide branch triggers (line 263). Floor-touch landing branch at line 267-273 fires when `y >= GROUND_Y`: sets `surface='floor'`, `vx=0`, `onGround=true`. **But does NOT clear `player.diving` or apply landingLag.** Compare to the airborne-floor-touch branch at 296-301 which does both.
- **Result:** diving fighter who wall-stuck then slid to ground is stuck with `diving=true` permanently, no landingLag. They can keep moving (but `move=0` if `diving`), can't re-dive (line 317 `!player.diving`). **Stuck in dive-state forever.** Real bug.

### 10.8. Wall-stick during whiffLock
Wall-stick auto-trigger (line 279) doesn't check whiffLock. Whiff-locked airborne fighter can stick. Then wall-jump clears whiffLock (line 250/256). **Effectively, wall-stick is a whiff-recovery escape.** Synthesis intentionally allows; deferred to polish if exploitable. Confirmed allowed.

### 10.9. Punch attempt counter inflation
Dive sets `punchAttempts++` even if the dive sticks to a wall and never resolves. End-of-game stats show inflated attempts vs. landed. Minor.

---

## Triage for iter-10

**Must fix (correctness):**
- 10.3 walking-off-wall — vx update should be gated on `surface === 'floor'`.
- 10.7 dive-stuck-on-wall — wall-slide-to-ground branch must clear `diving` and apply `landingLag`.
- 10.2 knockback-through-wall — apply surface-aware clamp to `player.x` after knockback, or zero knockbackVx component into the wall on stick entry.
- Item 4: player has no tool to hit a wall-stuck opp. Either (a) raise wall-jump arc, (b) raise grounded-jump apex, (c) lower opp's targetY, or (d) make wall-stuck opp interruptible by punch hit-check that uses surface-aware geometry. Without a fix, the wall-perch is an exploit-shaped escape.

**Should fix (feel):**
- 10.5 opp drop snap — interpolate over ~0.2s.
- Item 6 round duration — wall-perch stalls add 6–10s. Pair with item 4 fix.

**Polish / persisting:**
- Pip/HP label overlap (§9), intermission fade (§9), KO pose (§9), knockback tuning (§9), shield indicator anchor when wall-stuck (Change 6 deferred).

**Lower priority:**
- 10.1, 10.4, 10.6 (stalemate boundary), 10.8, 10.9.

Iter-10 keystone (per synthesis "deferred"): ceiling surface + gravity flip. Prerequisite cleanup above is heavy; consider an iter-10a stabilization pass before adding ceiling.
