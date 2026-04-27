# Iteration 2 — Smoothness Report

Scope: felt smoothness only — motion, animation, input, transitions. No balance, no features.

State entering iteration 2: player `vx` lerps with `VX_LERP=0.25` and a 0.05 dead-zone. Everything else (timers, gravity, knockback, opponent patrol, hit-flash, HP bar, punch pose) is unchanged from iteration 1.

## What still feels worst (ranked)

### 1. Frame-rate dependence of all motion — impact: HIGH (still the worst)
- Where: `game.js:118` (`player.x += player.vx`), `game.js:129-130` (gravity `vy += GRAVITY`, `y += vy`), `game.js:138-139` (punch timer/cooldown decrement), `game.js:157` (`hitFlash--`), `game.js:161-164` (knockback decay/patrol step), `game.js:175-176` (contact cooldown / hit-flash)
- Why it hurts smoothness: Even the iteration-1 lerp itself is frame-counted: at 144Hz, `VX_LERP=0.25` applies 2.4× more often per second, so acceleration time-constant *also* changes with refresh rate. Jump arcs end faster, knockback decays in a blink, punch windows shrink, and frame drops produce position jumps proportional to the gap. This is the meta-bug that quietly invalidates every other smoothness fix.
- Proposed fix: At the top of `loop()`, compute `dt = clamp(now - prev, 0, 33) / (1000/60)` and pass it to `update(dt)`. Multiply per-frame deltas (`player.x += player.vx * dt`, gravity, knockback) and decrement timers by `dt`. Replace the lerp with a dt-aware form: `vx += (target - vx) * (1 - Math.pow(1 - VX_LERP, dt))` so the *time*-constant is invariant. Keep the constant scale at dt=1 so existing tuning is unchanged on 60Hz.
- Scope estimate: ~30–40 LOC touched in one pass — tighter than the "60+ LOC" the iteration-1 note feared, because all timers live in one function and there are no arrays of entities to walk.

### 2. Punch is still a binary on/off pose — impact: HIGH
- Where: `game.js:142-144` (sets `punchTimer = PUNCH_DURATION`), `game.js:236-243` (drawStick punching branch toggles `'===='` for 12 frames then snaps off)
- Why it hurts smoothness: This is now the most visually jarring single thing on screen. With player vx eased, the rest of the figure glides — but the arm still teleports out and teleports back. There's no anticipation, no follow-through, and the hit registers at the moment the arm pops out, not when it visually arrives.
- Proposed fix: Compute progress `t = 1 - punchTimer/PUNCH_DURATION`, then offset the fist X by an eased curve — e.g., `windup` (t<0.25) pulls fist back ~4px, `extend` (0.25–0.55) drives fist out via easeOutCubic to full reach, `hold` (0.55–0.75) stays extended, `retract` (0.75–1.0) returns. Move the `'===='` glyph by that offset; the existing 12-frame duration is plenty.
- Note: also edge-trigger via `keysPressed` rather than `keys.has` at `game.js:141` so a held J doesn't auto-fire and clobber the new animation. (Two-character change, do it together.)

### 3. Hit-flash is still binary — impact: MEDIUM-HIGH
- Where: `game.js:157` (`hitFlash--`), `game.js:280` (`color: player.hitFlash > 0 ? '#ff8888' : '#9ad9ff'`), `game.js:284` (opponent equivalent)
- Why it hurts smoothness: Color cuts from red to base on a single frame. Combined with the binary punch, the hit moment is two simultaneous step functions — the impact reads as flicker, not weight.
- Proposed fix: Interpolate by `hitFlash / 8`: lerp each RGB channel from base toward `#ff8888` by that fraction so the flash fades out over 8 frames (or the dt-equivalent after fix #1). Trivial — one helper, two call sites.

### 4. HP bar still snaps on damage — impact: MEDIUM
- Where: `game.js:256-262` (`pct = hp / maxHp`, `fillRect` with current value)
- Why it hurts smoothness: 8% jumps per hit with no settle. The HUD reads as a number changing rather than a creature taking damage.
- Proposed fix: Add `displayedHp` on player and opponent, lerp toward `hp` each tick (`displayedHp += (hp - displayedHp) * 0.15 * dt`). Draw the bar from `displayedHp`. Optional but cheap: draw a second, slower-decaying ghost bar (`ghostHp` with lerp factor ~0.04) in `#aa3333` behind the live one for damage-tick read.

### 5. Walking still has no leg-cycle — impact: MEDIUM
- Where: `game.js:245` (`'/ \\'` always), `game.js:227-247` (drawStick has no walk-phase parameter)
- Why it hurts smoothness: With vx now eased, the figure glides smoothly — which makes the static legs read as a sliding ice-puck. The improvement from iteration 1 paradoxically makes this worse.
- Proposed fix: Accumulate `walkPhase += |vx| * 0.15 * dt` while grounded; alternate two leg glyphs based on `Math.floor(walkPhase) % 2`. Add a 1px vertical bob on the head (`y - 50 - (walkPhase%1 < 0.5 ? 0 : 1)`). ~6 LOC.

### 6. Opponent patrol direction flips instantly — impact: MEDIUM
- Where: `game.js:165-171` (`patrolDir = 1` / `patrolDir = -1` on boundary contact)
- Why it hurts smoothness: At each endpoint the opponent's velocity step-functions from -1.6 to +1.6 in one frame. Visible zig.
- Proposed fix: Replace discrete `patrolDir` with a `patrolTarget` (-1 or +1 boundary), and lerp a continuous `opponent.vx` toward `OPPONENT_SPEED * sign(patrolTarget - x)` with a slow time-constant. Or simpler: at boundary, set a `turnTimer = 12` during which `OPPONENT_SPEED` is scaled by `(turnTimer/12 - 0.5) * 2` so it eases through zero.

### 7. Wall clamps swallow vx mid-stride — impact: LOW
- Where: `game.js:120-121` (player), `game.js:173` (opponent)
- Why it hurts smoothness: When the player walks into a wall, `player.x` is hard-clamped and `vx` zeroed only via the equality check. The lerped vx still has momentum, so on contact the figure stops dead while the lerp continues fighting toward target — there's a beat where the figure is stationary but pushing.
- Proposed fix: When clamped, also force `targetVx = 0` for that axis (or zero `vx` and let lerp restart cleanly). Minor but visible against an otherwise smooth walk.

### 8. Contact knockback writes directly to `player.vx` — impact: LOW
- Where: `game.js:182` (`player.vx = -6 * ...`)
- Why it hurts smoothness: This bypasses the lerp introduced in iteration 1: contact damage instantly snaps player vx to ±6 — a step the player's own input no longer takes. The player feels "punched" by a teleport, not by a force.
- Proposed fix: Add a separate `player.knockbackVx` that decays each frame (like the opponent's), and add it to `player.x` alongside the lerped `vx`. Symmetric with how the opponent already works.

### 9. Subpixel rendering with `image-rendering: pixelated` — impact: LOW
- Where: `style.css:22`, floating-point positions at `game.js:118, 130, 161, 164`
- Why it hurts smoothness: Carried over from iteration 1; not flagged as a quick win then and still isn't. With easing now active, fractional positions update every frame, so any rasterization quirk shows more often.
- Proposed fix: `Math.round(x)` only at the draw site in `drawStick` (keep state as float). Or drop `pixelated` since the canvas isn't upscaled.

## Quick wins for iteration 2 (pick these)

1. **Frame-rate independence (Issue #1).** It's been deferred once; defer it again and every smoothness change in this iteration is conditional on the user's monitor. The scope is *not* 60+ LOC if you keep it tight: one `dt` plumbed through `update`, multiplications on five lines, decrements on four timers, and the dt-aware lerp form. Do this first; everything else builds on it.

2. **Animated punch with eased fist offset + edge-triggered fire (Issues #2 + #8 from iter-1).** This is now the loudest visual defect on screen. Reuse the existing 12-frame timer as a normalized `t`, drive a fist-X offset by an eased curve, and switch the trigger to `keysPressed`. Together: ~15 LOC, transforms the core combat verb.

3. **Interpolated hit-flash + lerped HP bar (Issues #3 + #4).** Bundle these — they share the "discrete state changing on contact" failure mode and together they make the *moment of impact* feel continuous. ~10 LOC for both: one color-lerp helper, one `displayedHp` field per fighter.

Honestly: if dt has to slip again, do #2 and #3. The arm popping in/out is now what a player notices first.
