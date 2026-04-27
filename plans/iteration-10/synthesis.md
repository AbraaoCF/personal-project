# Iteration 10 — Synthesis (GRAVITY FLIP / 4-SURFACE ARENA)

Iter-9 shipped 3 surfaces (floor + walls), wall-stick, wall-jump, opp wall-climb. Playtest finds 3 wall-run bugs (10.2 / 10.3 / 10.7) plus a geometric reachability gap on the wall-perch. Iter-10's keystone is the **gravity flip + ceiling surface** (Magma Dragoon 8 s timer + Fall Guys flip-window trick) — the user's headline ask: *"the gravity changes from time to time and the fight becomes upside down."*

**Order of operations:** stabilise wall-run **first** (3 one-line bugs), reachability second (lower opp wall-perch), then layer the keystone on a clean base, then smoothness.

---

## Picks (8 changes, ~55 LOC)

| # | Change | LOC | Source |
|---|---|---|---|
| 1 | Wall-run stabilisation bundle (10.3 + 10.7 + 10.2) | ~5 | playtest §10 |
| 2 | Lower opp wall-perch target → reachable | ~1 | playtest §4 (option b) |
| 3 | Flip state + timer + trigger | ~12 | inspiration #2 |
| 4 | Flip physics generalisation | ~10 | inspiration #2 |
| 5 | Flip render & telegraph | ~10 | inspiration #2 |
| 6 | Subpixel render snap | ~4 | smoothness #1 |
| 7 | renderAngle ease on surface change | ~8 | smoothness #2 |
| 8 | Shake pulse on flip + dt-correct decay | ~5 | smoothness #3 |

---

## Change 1 — Wall-run stabilisation bundle

**What.** Three one-line fixes to the iter-9 wall-stick state.
**Why.** Playtest §10. Must land **before** gravity-flip layers more state on top.

**1a (10.3 walk-off-wall).** Tighten vx-update gate at line 219:
```js
if (!player.diving && player.surface === 'floor') {
```
Wall-stuck walking input is now suppressed; wall-jump still works (sets vx directly).

**1b (10.7 dive-stuck-on-wall).** Wall-stick floor-touch branch (lines 267-273) lacks the dive cleanup the airborne branch has. Replace with:
```js
if (player.y >= GROUND_Y) {
  player.y = GROUND_Y; player.vy = 0;
  player.surface = 'floor'; player.onGround = true; player.vx = 0;
  if (player.diving) {
    player.diving = false; player.landingLag = LANDING_LAG; player.diveHit = false;
  }
}
```

**1c (10.2 knockback drift).** Surface-aware knockback at lines 225-230:
```js
if (Math.abs(player.knockbackVx) > 6) {
  if (player.surface === 'floor') player.x += player.knockbackVx * dt;
  player.knockbackVx *= Math.pow(0.7, dt * 60);
} else {
  player.knockbackVx = 0;
}
```
Wall-stuck: knockbackVx decays but doesn't displace. Detach → resumes naturally.

**Test in head.** Wall-stuck on right wall, press A: vx-update skipped, x unchanged. Dive into wall sticks → slides down to GROUND_Y → diving cleared, landingLag paid. Wall-stuck with residual knockbackVx: decays to 0 in ~0.3 s without displacing.

**LOC.** ~5.

---

## Change 2 — Lower opp wall-perch target

**What.** `game.js:385` — `const targetY = H * 0.45;` → `const targetY = H * 0.6;` (= 300, was 225).

**Why.** Playtest §4 option b. At y=225, perch is unreachable: grounded jump apex = `JUMP_VELOCITY² / (2·GRAVITY) = 720²/4320 = 120 px` above ground; from GROUND_Y=420, apex y=300; divepunch hit-band (`fistY ∈ (opp.y - 80, opp.y - 20)`) at y=225 needs fistY ∈ (145, 205), unreachable. **At opp y=300:** divepunch band = (220, 280), apex fistY=270, in band for several frames. Climb time 0.92 s (was 1.5 s) — still a deliberate retreat.

**LOC.** ~1.

---

## Change 3 — Flip state + timer + trigger

**What.** Module `gravityDir` (1/-1) + `flipTimer`. Tick down each gameplay frame; on hitting 0, swap floor↔ceiling for grounded fighters, set both shields to `'open'` (Fall Guys window), pulse shake to 7, reset timer.

**Why.** Magma Dragoon spine + Fall Guys window. Predictable rhythm matches the existing shield rhythm.

**Where.** New constants near line 110; module state near `let shake = 0;`; trigger at top of `update(dt)` after early-returns; reset in `resetRound`.

**Spec.**

Constants (after line 120):
```js
const FLIP_COOLDOWN = 8.0;
const CEIL_Y = 60;
SURFACE_GRAVITY.ceiling = { gx: 0, gy: -1 };
```

Module state (near `let shake = 0;`):
```js
let gravityDir = 1;
let flipTimer = FLIP_COOLDOWN;
```

`resetRound` (after `shake = 0;` at line 142):
```js
gravityDir = 1;
flipTimer = FLIP_COOLDOWN;
```

Trigger (in `update(dt)` after the hitstop early-return at line 213):
```js
flipTimer -= dt;
if (flipTimer <= 0 && gameEndHold <= 0) {
  gravityDir *= -1;
  flipTimer = FLIP_COOLDOWN;
  for (const f of [player, opponent]) {
    if (f.surface === 'floor' && f.onGround) {
      f.surface = 'ceiling'; f.y = CEIL_Y; f.vy = 0;
    } else if (f.surface === 'ceiling' && f.onGround) {
      f.surface = 'floor'; f.y = GROUND_Y; f.vy = 0;
    }
    // walls untouched: gravity-flip-immune.
  }
  opponent.state = 'open';
  opponent.stateTimer = SHIELD_OPEN;
  shake = Math.max(shake, 7);
}
```

**Edge cases.**
- Mid-air fighter (`onGround=false`) keeps `surface='floor'`; Change 4's gravity sign carries them to the new floor naturally — no teleport.
- Wall-stuck fighter: untouched. Wall slide-direction follows `gravityDir` (Change 4).
- Intermission / hitstop: existing early-returns prevent timer ticking. ✓
- `gameEndHold` guard: don't fire flip during KO freeze.
- Cross-round: `resetRound` snaps `gravityDir=1`, `flipTimer=FLIP_COOLDOWN`. Each round starts right-side-up.

**LOC.** ~12.

---

## Change 4 — Flip physics generalisation

**What.** Make airborne / wall-slide / floor-touch / opp-climb direction depend on `gravityDir`.

**Why.** Without this, `gravityDir=-1` only teleports fighters to the ceiling — they'd fall back. We need true inversion.

**Spec.**

**4a.** Player jumps (lines 246, 252, 258, 3 sites): `vy = JUMP_VELOCITY` → `vy = JUMP_VELOCITY * gravityDir`.

**4b.** Player airborne gravity (line 276): `vy += GRAVITY * dt` → `vy += GRAVITY * gravityDir * dt`.

**4c.** Player wall-slide (line 265): replace `vy = Math.min(vy + GRAVITY*0.25*dt, WALL_SLIDE_VY)` with two lines — `vy += GRAVITY * 0.25 * gravityDir * dt;` then `vy = Math.max(-WALL_SLIDE_VY, Math.min(WALL_SLIDE_VY, vy));`.

**4d.** Player floor/ceiling touch (lines 267 and 292). Generalise both branches via:
```js
const onSurface = gravityDir === 1 ? player.y >= GROUND_Y : player.y <= CEIL_Y;
const surfaceY = gravityDir === 1 ? GROUND_Y : CEIL_Y;
const surfaceName = gravityDir === 1 ? 'floor' : 'ceiling';
if (onSurface) {
  player.y = surfaceY; player.vy = 0;
  player.surface = surfaceName; player.onGround = true;
  // (dive cleanup as in Change 1b)
}
```
Wall-detach-off-top (line 274): replace with `if (gravityDir === 1 && player.y < CEIL_Y) player.surface = 'floor'; else if (gravityDir === -1 && player.y > GROUND_Y) player.surface = 'ceiling';`.

**4e.** Opp climb (lines 366, 370, 2 sites): `vy = -EVASION_SPEED` → `vy = -EVASION_SPEED * gravityDir`. "Away from active floor."

**4f.** Opp drop-back (line 397): `opp.y = GROUND_Y` → `opp.y = gravityDir === 1 ? GROUND_Y : CEIL_Y`.

**4g.** Punch-knockback opp surface reset (lines 422-424, 447-449, divepunch). Was `opp.surface !== 'floor'` (now wrongly catches ceiling). Replace condition with `opp.surface === 'left' || opp.surface === 'right'`, and write the floor/ceiling-aware target as in 4d.

**4h.** Dive vy (around line 318): `vy = 540` → `vy = 540 * gravityDir`. Dive heads toward active floor.

**4i.** Wall-stick auto-trigger gate (line 279): `vy >= 0` → `vy * gravityDir >= 0`.

**Test in head.** gravityDir=1: identical behaviour. Flip → gravityDir=-1: jump vy=+720 (falls into arena), gravity decelerates, fighter rises back to ceiling. Wall-slide direction reverses. Opp climbs *down* relative to screen (away from new ceiling-floor). ✓

**LOC.** ~10.

---

## Change 5 — Flip render & telegraph

**What.** (a) Mirrored ceiling dash row + alpha pulse on inactive face during last 1 s, (b) HUD countdown glyph last 1 s, (c) ceiling rotation via `renderAngle` (folded into Change 7).

**Why.** Inspiration #2 telegraph layer.

**Where.** `drawGround` (lines 543-555); `render()` after `drawGround()` call.

**5a. Modified `drawGround`:**
```js
function drawGround() {
  const flipPulse = flipTimer < 1 ? (0.5 + 0.5 * Math.sin(flipTimer * 30)) : 0;
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ARENA_LEFT, GROUND_Y + 4); ctx.lineTo(ARENA_RIGHT, GROUND_Y + 4);
  ctx.moveTo(ARENA_LEFT, CEIL_Y - 4);   ctx.lineTo(ARENA_RIGHT, CEIL_Y - 4);
  ctx.stroke();
  ctx.font = '14px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const inactiveAlpha = 0.35 + 0.5 * flipPulse;
  ctx.fillStyle = gravityDir === 1 ? 'rgba(80,80,80,1)' : `rgba(80,80,80,${inactiveAlpha})`;
  for (let x = ARENA_LEFT; x < ARENA_RIGHT; x += 16) ctx.fillText('-', x, GROUND_Y + 18);
  ctx.fillStyle = gravityDir === -1 ? 'rgba(80,80,80,1)' : `rgba(80,80,80,${inactiveAlpha})`;
  for (let x = ARENA_LEFT; x < ARENA_RIGHT; x += 16) ctx.fillText('-', x, CEIL_Y - 6);
}
```
Inactive face pulses last 1 s — telegraphs "this becomes the active floor."

**5b. HUD countdown** (in `render()` after `drawGround()`):
```js
if (flipTimer < 1 && roundPhase === 'fighting') {
  ctx.save();
  ctx.fillStyle = `rgba(220,180,80,${0.5 + 0.5 * Math.sin(flipTimer * 20)})`;
  ctx.font = 'bold 36px ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(String(Math.ceil(flipTimer)), W / 2, 48);
  ctx.restore();
}
```

**Edge cases.** No overlap with HP labels at y=20 (countdown at y=48). Pulse freezes during intermission (timer doesn't tick). Countdown invisible when flipTimer ≥ 1.

**LOC.** ~10.

---

## Change 6 — Subpixel render snap

**What.** `Math.round(x)`, `Math.round(y)` at the rotation anchor in `drawStickOnSurface`. Optionally `Math.round(off)` in punch-arc at line 619.

**Why.** smoothness #1. Wall-rotation + ceiling-180° rotation paths shimmer at sub-pixel positions on a `image-rendering: pixelated` canvas.

**Watch.** Don't round `player.x` / `player.y` in sim — only at draw-time transform.

**LOC.** ~4. (Folded into Change 7's drawStickOnSurface body — counted separately for budget tracking.)

---

## Change 7 — renderAngle ease on surface change

**What.** Per-fighter `renderAngle` float that lerps toward surface-target angle. `drawStickOnSurface` rotates by it.

**Why.** smoothness #2. Critical for gravity flip — instant 180° rotation reads as a teleport. ~6 frames of ease (~100 ms) reads as a flip.

**Spec.**

Per-fighter init: `player.renderAngle = 0;` and `opponent.renderAngle = 0;` (init + `resetRound`).

Helper near `drawStickOnSurface`:
```js
function surfaceAngle(s) {
  if (s === 'left') return Math.PI / 2;
  if (s === 'right') return -Math.PI / 2;
  if (s === 'ceiling') return Math.PI;
  return 0;
}
```

In `update(dt)` at the very end (before `keysPressed.clear()`):
```js
for (const f of [player, opponent]) {
  let delta = surfaceAngle(f.surface) - f.renderAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  f.renderAngle += delta * (1 - Math.pow(1 - 0.4, dt * 60));
}
```

Replace `drawStickOnSurface` body (folds in Change 6 snap):
```js
function drawStickOnSurface(x, y, surface, opts) {
  const angle = (opts && opts.renderAngle != null) ? opts.renderAngle : surfaceAngle(surface);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  drawStick(0, 0, opts);
  ctx.restore();
}
```

Call sites (lines 687, 709) pass `renderAngle: f.renderAngle` in opts.

**Watch.**
- Shortest-arc wrap pins delta to [-π, π] — lerp `-π/2 → π` rotates the short way through `+π/2`, not through 0/-π.
- Hit-tests still use logical `surface`; visual lags by ≤ 6 frames. Acceptable.
- Floor-on-floor short-circuit removed. `ctx.rotate(0)` is a no-op; perf negligible.

**Test in head.** Flip: surface floor→ceiling, renderAngle 0→π in ~6 frames at 0.4 lerp factor (per-frame 40% decay). Reads as a flip animation. Wall-stick floor→left: 0→π/2, eases over ~6 frames. ✓

**LOC.** ~8.

---

## Change 8 — Shake pulse on flip + dt-correct decay

**What.** (a) `shake = Math.max(shake, 7);` on flip (already in Change 3 trigger). (b) Replace `shake *= 0.85;` at line 674 with `shake *= Math.pow(0.85, dt * 60);` and hoist into `update(dt)` tail.

**Why.** smoothness #3. Silent flip is a bug, not a mechanic. dt-correction free-rider: existing decay is frame-rate dependent.

**Spec.**
- Delete `shake *= 0.85;` at line 674.
- In `update(dt)` near the renderAngle lerp: `shake *= Math.pow(0.85, dt * 60);`.
- Flip-site shake already specced in Change 3.

**Watch.** Don't double-apply: trigger writes shake=7, decay tick runs at end of same frame → shake≈5.95 by render. Visible pulse ~150 ms.

**LOC.** ~5.

---

## Total LOC tally

| # | Change | LOC |
|---|---|---|
| 1 | Wall-run stabilisation | ~5 |
| 2 | Lower opp wall-perch | ~1 |
| 3 | Flip state + trigger | ~12 |
| 4 | Flip physics generalisation | ~10 |
| 5 | Flip render & telegraph | ~10 |
| 6 | Subpixel snap | ~4 |
| 7 | renderAngle ease | ~8 |
| 8 | Shake pulse + dt-correction | ~5 |
| **Total** | | **~55** |

Under 80-LOC cap with 25 LOC slack.

---

## Implementation order

1. **Change 1** — stabilisation. Validate floor-only play still works.
2. **Change 2** — opp targetY. Divepunch reaches climbing opp.
3. **Change 6 + Change 8 dt-fix** — render polish locked in before keystone.
4. **Change 3** — flip state + trigger (timer ticks, surface teleports; fighters don't yet fall correctly — expected partial state).
5. **Change 4** — physics generalisation. Game truly inverts.
6. **Change 7** — renderAngle ease. Flip reads as animation, not teleport.
7. **Change 5** — telegraph (countdown + pulse + ceiling dashes).
8. **Change 8 flip-site shake** — already in Change 3 trigger.

Smoke-test after step 5: 3-round match, ~6 flips per 50 s round. Both fighters survive flips, shield rhythm continues, ceiling combat symmetric.

---

## Deferred (iter-11+)

- **Wall/ceiling-stuck punch hit-test geometry** — punches still fire in world-x; rotate hit-test through `surfaceAngle` (now also covers ceiling).
- **Wall/ceiling-stuck shield indicator** — `(+)` glyph in world-space; architectural fix (per-fighter UI inside rotated frame).
- **Opp drop-back from wall snap** — instant `y = GROUND_Y/CEIL_Y`; lerp via `targetY`. Paint-job.
- **Pip / HP label overlap, KO pose, intermission fade** — playtest §9 persisting; bundle with round-start polish.
- **Animated arena rotation** (#5) — current flip rotates figures only; arena snaps. Iter-12+.
- **Random / meter-driven flip variants** (#3, #4); **player-pressed flip** (#1) — defer until periodic rhythm proves stale.
- **Squash-and-stretch on flip apex** — pair with renderAngle ease.
- **Ceiling-side wall-perch retune** — `H*0.6` is floor-side tuned; ceiling-side may want `H*0.4`. Wait one playtest.
- **Knockback magnitude tuning** — revisit after a flip-aware match.
- **Wall-stick during whiffLock**, **cat/mouse fakes**, **punch-attempt inflation on wall-stuck dive** — low priority.
