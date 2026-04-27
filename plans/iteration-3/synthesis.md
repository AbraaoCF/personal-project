# Iteration 3 — Synthesis

Three changes this iteration. dt sweep ships as the iter-2 hard commit. The hitstop pose bug from iter-2 is fixed alongside, plus two cheap input/death-feel fixes and the wall-shove bug. Crouch + jab keystone is **deferred** to iter-4.

LOC budget: ~35 (dt) + ~3 (pose fix) + ~2 (input retain) + ~2 (K.O. hitstop) + ~10 (wall shove) = **~52 LOC**, comfortably under 80.

---

## Change 1 — Frame-rate-independent update (dt sweep)

### What
Convert `update()` from per-frame integer arithmetic to per-second floats, driven by `dt = min((now - prev)/1000, 1/30)` computed in `loop()`.

### Why
Iter-2 hard commit. Smoothness report §1: variable-dt + seconds units is correct for this codebase (single update, no determinism need). All other smoothness defects are easier to tune *with* dt in place.

### Where
`game.js`: `loop()` (~349), `update()` signature (113), constants block (55–68), all timer decrements, all velocity/gravity applications, knockback decay form, vx lerp form, hitFlash/punch render lerps (325, 330, 336).

### Spec

**Plumbing — `loop()`:**
```js
let prev = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 1/30);
  prev = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
```
Initialize `prev` *before* the first `loop()` call (do this at the bottom alongside `toMenu(); loop();`).

**Constants — replace lines 55–68:**
```js
const PUNCH_REACH = 38;             // unchanged (px)
const PUNCH_DURATION = 0.2;         // was 12 frames
const PUNCH_COOLDOWN = 0.3;         // was PUNCH_COOLDOWN_FRAMES = 18
const PUNCH_DAMAGE = 8;             // unchanged
const WALK_SPEED = 192;             // was 3.2 px/frame -> 192 px/s
const VX_LERP = 0.25;               // unchanged numeric, applied via pow form
const JUMP_VELOCITY = -720;         // was -12
const GRAVITY = 2160;               // was 0.6 px/frame^2
const OPPONENT_SPEED = 96;          // was 1.6
const CONTACT_DAMAGE = 4;           // unchanged
const CONTACT_COOLDOWN = 0.5;       // was CONTACT_COOLDOWN_FRAMES = 30
const CONTACT_RANGE = 10;           // unchanged (px)
const PUNCH_BUFFER = 0.1;           // was PUNCH_BUFFER_FRAMES = 6
const HITSTOP_DURATION = 0.0667;    // was HITSTOP_FRAMES = 4
const HIT_FLASH_DURATION = 0.1333;  // NEW — was hardcoded 8 frames
```

**`update(dt)` body — line-by-line conversions:**

| Old (line) | New |
|---|---|
| `if (hitstop > 0) { hitstop--; ...` (119) | `if (hitstop > 0) { hitstop = Math.max(0, hitstop - dt); ...` |
| `player.vx += (targetVx - player.vx) * VX_LERP;` (129) | `player.vx += (targetVx - player.vx) * (1 - Math.pow(1 - VX_LERP, dt * 60));` |
| `if (Math.abs(player.vx) < 0.05) player.vx = 0;` (130) | `if (Math.abs(player.vx) < 3) player.vx = 0;` |
| `player.x += player.vx;` (131) | `player.x += player.vx * dt;` |
| `player.vy += GRAVITY;` (142) | `player.vy += GRAVITY * dt;` |
| `player.y += player.vy;` (143) | `player.y += player.vy * dt;` |
| `if (player.punchCooldown > 0) player.punchCooldown--;` (151) | `if (player.punchCooldown > 0) player.punchCooldown -= dt;` |
| `if (player.punchTimer > 0) player.punchTimer--;` (152) | `if (player.punchTimer > 0) player.punchTimer -= dt;` |
| `if (player.punchBuffer > 0) player.punchBuffer--;` (153) | `if (player.punchBuffer > 0) player.punchBuffer -= dt;` |
| `if (wantPunch) player.punchBuffer = PUNCH_BUFFER_FRAMES;` (156) | `if (wantPunch) player.punchBuffer = PUNCH_BUFFER;` |
| `if (player.punchBuffer > 0 && player.punchCooldown === 0) {` (158) | `if (player.punchBuffer > 0 && player.punchCooldown <= 0) {` |
| `player.punchTimer = PUNCH_DURATION;` (160) | unchanged literal, value now 0.2 |
| `player.punchCooldown = PUNCH_COOLDOWN_FRAMES;` (161) | `player.punchCooldown = PUNCH_COOLDOWN;` |
| `opponent.hitFlash = 8;` (168) | `opponent.hitFlash = HIT_FLASH_DURATION;` |
| `opponent.knockback = 6 * player.facing;` (169) | `opponent.knockback = 360 * player.facing;` |
| `hitstop = HITSTOP_FRAMES;` (171) | `hitstop = HITSTOP_DURATION;` |
| `if (opponent.hitFlash > 0) opponent.hitFlash--;` (175) | `if (opponent.hitFlash > 0) opponent.hitFlash -= dt;` |
| `Math.abs(opponent.knockback) > 0.1` (177) | `Math.abs(opponent.knockback) > 6` |
| `opponent.x += opponent.knockback;` (179) | `opponent.x += opponent.knockback * dt;` |
| `opponent.knockback *= 0.7;` (180) | `opponent.knockback *= Math.pow(0.7, dt * 60);` |
| `opponent.x += opponent.patrolDir * OPPONENT_SPEED;` (182) | `opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;` |
| `if (player.contactCooldown > 0) player.contactCooldown--;` (193) | `if (player.contactCooldown > 0) player.contactCooldown -= dt;` |
| `if (player.hitFlash > 0) player.hitFlash--;` (194) | `if (player.hitFlash > 0) player.hitFlash -= dt;` |
| `&& player.contactCooldown === 0 ...` (196) | `&& player.contactCooldown <= 0 ...` |
| `player.hitFlash = 8;` (198) | `player.hitFlash = HIT_FLASH_DURATION;` |
| `player.contactCooldown = CONTACT_COOLDOWN_FRAMES;` (199) | `player.contactCooldown = CONTACT_COOLDOWN;` |
| `player.vx = -6 * (...);` (200) | `player.vx = -360 * (...);` |
| `hitstop = HITSTOP_FRAMES;` (201) | `hitstop = HITSTOP_DURATION;` |

**Render side — `render()`:**

| Old (line) | New |
|---|---|
| `1 - player.punchTimer / PUNCH_DURATION` (325) | unchanged formula — both sides now seconds, ratio identical |
| `player.hitFlash / 8` (330) | `player.hitFlash / HIT_FLASH_DURATION` |
| `opponent.hitFlash / 8` (336) | `opponent.hitFlash / HIT_FLASH_DURATION` |

**Position clamps and hit-test geometry unchanged** (pixels stay pixels; `PUNCH_REACH`, `CONTACT_RANGE`, fistY band `> opponent.y - 65 && < opponent.y - 5`, `Math.abs(fistX - opponent.x) < 28` all stay).

### Edge cases
- **First-frame dt:** `prev` is set just before first `loop()` call → first dt is tiny but ≥ 0; clamp at `1/30` is sanity for tab-out catchup.
- **`player.x === ARENA_LEFT + 16` equality on line 134:** `Math.min/Math.max` returns its bound exactly, so equality holds after clamp regardless of dt. **Leave as-is.**
- **Hitstop early-return:** receives `dt` and decrements `hitstop -= dt`. Other timers correctly skipped by the early return. (This interacts with Change 2 below — the `keysPressed.clear()` removal lives there.)
- **Game-over on killing hit:** `resetMatch()` sets `hitstop = 0`, which is fine as a float zero.
- **Math.pow precision:** `Math.pow(0.7, dt*60)` at `dt=1/60` returns 0.7 to float precision — 60 Hz behavior is bit-equivalent (within float epsilon) to current.

### Test in head
- At 60 Hz (`dt = 1/60`), every conversion collapses: `WALK_SPEED * dt = 192/60 = 3.2`; `GRAVITY * dt = 36`; `vy += 36; y += vy/60` → equivalent to `vy += 0.6; y += vy`. Knockback `*= pow(0.7, 1) = 0.7`. VX lerp `* (1 - pow(0.75, 1)) = * 0.25`. All identical.
- At 144 Hz (`dt = 1/144`): jump arc duration = `2 * 720 / 2160 = 0.667 s` → same wall-clock as current 60 Hz (`2 * 12 / 0.6 = 40 frames = 0.667 s`). Punch duration 0.2 s = 28.8 frames at 144 Hz, vs 12 frames at 60 Hz — same clock time. Hitstop 0.0667 s = ~9.6 frames at 144 Hz, ~4 at 60. Correct.
- The walk + punch + flash test loop should look visually indistinguishable to a 60 Hz observer post-sweep.

---

## Change 2 — Hitstop pose, input retention, K.O. hitstop (bundled bug fixes)

### What
Three small fixes to the hitstop block: (a) make the punch animation visibly extended on the impact frame; (b) stop wiping queued inputs during freeze; (c) trigger hitstop on K.O. so the killing blow lands meatily.

### Why
Playtest §4 (CRITICAL): the impact-frame freeze captures the *windup* pose (`/|\` no arm) because `punchTimer = PUNCH_DURATION` is set immediately before the hit-test, so `punchT = 1 - 12/12 = 0`. Four freeze frames of "no arm + opponent flashing red" reads as a glitch.

Playtest §3 + §6.5: `keysPressed.clear()` inside the hitstop branch wipes any press that lands during the 67 ms freeze — including panicked-jump and follow-up J presses — silently.

Playtest §6.3: `if (hp <= 0) toGameOver()` fires the same frame as the killing punch; the `state` flip means the next frame's update early-returns *before* hitstop runs, so the killing blow has no impact pause. The most impactful moment is the most abrupt.

### Where
`game.js`: lines 119–122 (hitstop branch), 158–172 (punch fire/connect block), 196–202 (contact-damage block), 204–205 (game-over check).

### Spec

**(a) Hitstop pose fix.** In the punch fire block, after the hit-test sets `hitstop`, advance `punchTimer` so render on the impact frame samples mid-extension instead of windup-zero. Concretely, in the connect branch (was line 166–172):

```js
if (Math.abs(fistX - opponent.x) < 28 && fistY > opponent.y - 65 && fistY < opponent.y - 5) {
  opponent.hp = Math.max(0, opponent.hp - PUNCH_DAMAGE);
  opponent.hitFlash = HIT_FLASH_DURATION;
  opponent.knockback = 360 * player.facing;
  player.punchesLanded++;
  hitstop = HITSTOP_DURATION;
  player.punchTimer = PUNCH_DURATION * 0.4;  // <- NEW: jump to mid-hold pose for the freeze
}
```

Why 0.4: with `PUNCH_DURATION = 0.2 s`, this puts `punchTimer = 0.08`, so `punchT = 1 - 0.08/0.2 = 0.6` → render lands in the **hold band** (0.55 ≤ punchT < 0.80), `off = PUNCH_REACH = 38`, full extension drawn during the entire freeze. Post-freeze, the timer ticks down through hold → retract → 0 normally.

**(b) Input retention during hitstop.** Replace lines 119–122:

```js
if (hitstop > 0) {
  hitstop = Math.max(0, hitstop - dt);
  return;  // <- removed keysPressed.clear()
}
```

Buffered presses (W, J) accumulated during the 67 ms freeze now survive to the next live update. The buffer-decrement and edge-trigger semantics are preserved because `keysPressed.clear()` still runs at the end of `update()` after a *live* frame (line 207), so an input only persists across the freeze itself.

**(c) K.O. hitstop.** Replace lines 204–205:

```js
if (player.hp <= 0 || opponent.hp <= 0) {
  if (hitstop <= 0) hitstop = HITSTOP_DURATION * 2;  // double-freeze on K.O., ~133 ms
  if (hitstop <= 0) toGameOver();  // only flip state once freeze is consumed
}
```

Wait — that's wrong, `hitstop <= 0` can't both be a guard for setting *and* the trigger. Correct version:

```js
if ((player.hp <= 0 || opponent.hp <= 0) && state === STATE.PLAY) {
  if (hitstop > 0) {
    // a hit just landed this frame; let its hitstop play, then end on next 0-stop frame
  } else {
    toGameOver();
  }
}
```

Combined with the existing `hitstop = HITSTOP_DURATION` set on the killing punch (line 171) or contact (line 201), the killing frame freezes for 67 ms before `toGameOver()` fires on the next frame where hitstop has decayed to 0. Optional: bump the K.O. hitstop to `HITSTOP_DURATION * 2` for extra weight — set this *only* if hp went to 0 this frame. Concretely, adjust the punch connect:

```js
if (...) {
  ...
  hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
  player.punchTimer = PUNCH_DURATION * 0.4;
}
```

And mirror in the contact block:
```js
hitstop = player.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
```

### Edge cases
- **Double-hit same frame** (punch lands AND contact ticks): both write `hitstop`; whichever runs second wins. With one of them being a K.O., the K.O.-doubled value should win — order in `update()` is punch (158) then contact (196), so contact's write is last. Acceptable: contact reads `player.hp <= 0` correctly because the punch already mutated `opponent.hp`, not `player.hp`. Player K.O. via punch into contact: if punch K.O.s opponent and same frame contact hits player non-fatally, contact writes `HITSTOP_DURATION` (non-K.O.) and overwrites the `*2`. Rare; accept.
- **Buffered J during hitstop** now persists. Player who presses J during the 67 ms freeze gets a buffered punch on the next live frame — intended.
- **Punch animation post-freeze:** with `punchTimer` set to `0.08` on hit, after a 0.0667 s freeze (during which timer doesn't decrement), the timer is still 0.08; first live frame post-freeze sees punchT=0.6 (hold), then ticks down through retract over the next 4–5 frames. Total visible punch animation post-hit ≈ 80 ms, which is shorter than the original 200 ms windup-to-retract — that's *correct* because the windup already happened (it was the press-to-impact lag) and the freeze played the hold.

### Test in head
- Land a punch. Immediately on impact frame, render shows `====` extended fist + `|\` torso. Four freeze frames hold that pose. Post-freeze, the fist retracts over ~5 frames. **No more "frozen no-arm + flashing opponent" glitch.**
- Press J during a contact-damage hitstop. Live frame after the freeze: punch fires (buffered). Previously: nothing happened.
- Walk into the opponent until you K.O. them with a punch. Screen freezes for ~133 ms with extended fist on a flashing opponent → game-over screen. Previously: instant cut to game-over, no impact pause.

---

## Change 3 — Wall-shove pushback (corner-pin gameplay fix)

### What
When the player is pinned against a wall and contact damage triggers, shove the opponent away instead of (or in addition to) the player. Breaks the corner death-spiral.

### Why
Inspiration #4, playtest §6.1. The right-wall corral is a real frustration: opponent walks into pinned player every 30 frames, contact shove writes `player.vx = -360 px/s` *into* the wall (clamped same frame, no escape). LOC-cheap (10) and reuses shipped `opponent.knockback`.

### Where
`game.js`: contact-damage block, lines 196–202 (post-dt-sweep numbering).

### Spec

Replace the contact block with:

```js
const contactDx = Math.abs(player.x - opponent.x);
if (contactDx < CONTACT_RANGE && player.contactCooldown <= 0 && opponent.hp > 0) {
  player.hp = Math.max(0, player.hp - CONTACT_DAMAGE);
  player.hitFlash = HIT_FLASH_DURATION;
  player.contactCooldown = CONTACT_COOLDOWN;

  const pinnedLeft = player.x <= ARENA_LEFT + 16;
  const pinnedRight = player.x >= ARENA_RIGHT - 16;
  if (pinnedLeft || pinnedRight) {
    // shove opponent away instead of pinning player further into wall
    opponent.knockback = 360 * (opponent.x > player.x ? 1 : -1);
    player.vx = 0;
  } else {
    player.vx = -360 * (opponent.x > player.x ? 1 : -1);
  }
  hitstop = player.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
}
```

### Edge cases
- **Pinned-and-K.O. simultaneously:** opponent knockback fires, player still K.O.'d, hitstop doubled (per Change 2c). The post-K.O. shove is cosmetic (game-over fires next frame) — fine.
- **Knockback already active:** `opponent.knockback = 360 * sign(...)` overwrites. Acceptable; opponent was walking into player anyway.
- **Both walls clamp logic on line 134:** that line zeroes `player.vx` *if* clamp was hit. With `player.vx = 0` set explicitly in pinned branch above, no conflict.
- **Patrol resumes after shove:** `Math.abs(opponent.knockback) > 6` gates the patrol-vs-knockback branch (post-dt sweep). 360 px/s decays at `pow(0.7, dt*60)` — drops below 6 in ~`log(6/360) / (60 * log(0.7)) ≈ 0.19 s`. Opponent is shoved ~3 tiles away, then resumes patrol. Player gets ~190 ms of breathing room. Sufficient to walk out of the corner at 192 px/s (~36 px in that window).

### Test in head
- Walk player into the right wall. Wait. Opponent patrols left toward player, contact triggers at dx<10. Player takes 4 dmg, opponent flies left ~36 px, then ~120 ms later resumes patrol. Player can now step left and is no longer trapped.
- Mid-arena contact (player at x=400, opponent walks in from 410): `pinnedLeft || pinnedRight` is false → falls into else branch, behaves as before (`player.vx = -360`). No regression away from walls.

---

## Deferred

- **Crouch + telegraphed jab keystone (inspiration #1, #2, ~45 LOC).** This is the iteration's strongest *gameplay* candidate but doesn't fit alongside dt + bundled bug fixes inside the 80-LOC budget. With dt landing now, iter-4 can ship the keystone pair on a clean substrate (timers in seconds, hitstop pose correct so the jab's tell+freeze actually reads). Pairing the jab with crouch is non-negotiable per inspiration §composition; punting them together preserves that.
- **Aerial uppercut (inspiration #3).** Depends on jab existing to be the "second answer" — defer with the keystone.
- **Stamina meter (inspiration #5).** Best landed once new verbs exist to spend stamina on; iter-5+.
- **Inner-band free-damage zone (playtest §1).** Widening `tol` from 28 to 30 is a 1-LOC fix but changes a calibrated number; defer to a tuning iteration after gameplay verbs land so we tune it once.
- **Fast-mash silent press drop (playtest §2).** Felt-quality issue, no behavior bug. Defer until iter-4 along with a "punch denied" flash.
- **HP bar lerp, walk leg cycle, patrol-turn easing (smoothness §4 A/B/C).** Smoothness reviewer's own ranking: tackle after dt is verified. Leave for iter-4.
- **Player knockback decay channel (smoothness §4 D).** Currently `player.vx` is overwritten on contact; symmetric with opponent's knockback field would be cleaner. Bundles with the corner-pin fix conceptually but not LOC-wise this iteration.
- **Vertical contact check (playtest §1 footnote, §6.2 jump rehab).** Jump being strictly worse needs the airborne attack from inspiration #3 to actually fix; defer with the keystone.
