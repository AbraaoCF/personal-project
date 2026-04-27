# Iteration 1 — Smoothness Report

Scope: felt smoothness only — motion, animation, input, transitions. No balance, no features.

## Issues found (ranked by impact)

### 1. Frame-rate dependence of all motion — impact: high
- Where: `game.js:107` (`player.x += player.vx`), `game.js:117-118` (gravity/vy), `game.js:149-150` (knockback), `game.js:152` (patrol), `game.js:126-127`, `145` (timers/cooldowns measured in frames)
- Why it hurts smoothness: `requestAnimationFrame` fires at the display's refresh rate. On a 144Hz/165Hz monitor the player walks ~2.4–2.75x faster, jumps end almost instantly, knockback decays in a blink, and punch windows shrink — the entire game "feels" different and stutters when the browser briefly drops frames. Even on 60Hz, missed frames cause perceptible micro-jitter because position uses raw frame deltas.
- Proposed fix: Compute `dt` from the rAF timestamp (clamped to ~33ms) and scale every per-frame delta by `dt / (1000/60)` (or by seconds with rebalanced constants). Convert frame-counted timers (`punchTimer`, `punchCooldown`, `hitFlash`) to milliseconds or accumulated dt.

### 2. Instant horizontal velocity flips (no acceleration) — impact: high
- Where: `game.js:106` (`player.vx = move * WALK_SPEED`)
- Why it hurts smoothness: `vx` snaps to ±WALK_SPEED or 0 on a single frame. Direction reversals and stops feel rigid and "teleporty" — the single biggest felt-quality issue after framerate. Same applies to opponent patrol direction snapping at `game.js:155, 158`.
- Proposed fix: Lerp `player.vx` toward `move * WALK_SPEED` with a short time-constant (e.g., reach 90% in ~80ms). For the opponent, ease `patrolDir` through 0 over a few frames at turnaround instead of flipping the sign instantly.

### 3. Punch is a binary on/off pose — impact: high
- Where: `game.js:131` (`punchTimer = PUNCH_DURATION`), `game.js:213-220` (drawStick punching branch)
- Why it hurts smoothness: There's no wind-up, extension, or recovery — the arm pops to "====" for 12 frames and then snaps back. The hit register feels disconnected from the swing.
- Proposed fix: Drive the arm by a normalized progress `t = 1 - punchTimer/PUNCH_DURATION` and split into windup (0–0.25), extend (0.25–0.6), hold (0.6–0.8), retract (0.8–1.0); offset the fist X by an eased curve of that progress so the punch visibly travels.

### 4. Walking has no animation cycle — impact: medium
- Where: `game.js:222` (legs always drawn as `'/ \\'`)
- Why it hurts smoothness: The stick figure slides across the floor with no leg movement; motion reads as a translating sprite rather than a walking character, exaggerating perception of any other jitter.
- Proposed fix: Track a `walkPhase` accumulator that advances with `|vx| * dt`; alternate between two leg glyphs (e.g., `'/ \\'` and `'|\\'`/`'/|'`) when `move !== 0` and grounded. A small vertical bob (1–2px sine) on the head amplifies the effect cheaply.

### 5. HP bar snaps on damage — impact: medium
- Where: `game.js:231-233` (width directly from `opponent.hp / opponent.maxHp`)
- Why it hurts smoothness: The bar jumps 8% per hit with no damage tick or trailing "ghost" bar. Hits feel less impactful and the HUD reads as discrete data rather than a live state.
- Proposed fix: Keep a `displayedHp` field that lerps toward `hp` (e.g., 8x dt). Optionally draw a second, slower-decaying "ghost" bar in a duller color behind the live one for a classic damage-tick read.

### 6. Hit flash is binary — impact: medium
- Where: `game.js:255` (`oppColor = opponent.hitFlash > 0 ? '#ff8888' : '#eeeeee'`)
- Why it hurts smoothness: Color steps abruptly from red to white at the edge of the timer; combined with the binary punch, hits feel "flashy" rather than weighty.
- Proposed fix: Interpolate color (or alpha of a red overlay) by `hitFlash / 8`, fading out over the timer instead of cutting off. Pair with a brief ~2-frame screen-shake or a 1px opponent jolt for tactile feedback.

### 7. Patrol direction & wall clamps snap instantly — impact: low/medium
- Where: `game.js:153-159` (patrol flip), `game.js:109, 161` (clamp at walls)
- Why it hurts smoothness: At wall edges the X is hard-clamped: any residual velocity is silently swallowed, so the figure "sticks" to the wall mid-stride. Patrol turnarounds happen on one frame.
- Proposed fix: On wall contact, zero `vx` and (optionally) emit a tiny visual nudge; for patrol, ease the direction change over ~150ms (or pause briefly at endpoints) so the opponent doesn't reverse on a single frame.

### 8. `keysPressed` edge-detection is fine, but punch is held-fires — impact: low
- Where: `game.js:111` (jump uses `keysPressed`, correctly edge-triggered) vs. `game.js:129` (punch uses `keys.has`, fires every cooldown reset while held)
- Why it hurts smoothness: Not a smoothness defect per se, but holding J auto-punches at max cadence. Combined with the binary punch animation, this creates a strobe-like arm. Once punching is animated (#3), auto-fire will look worse.
- Proposed fix: Use `keysPressed.has('j') || keysPressed.has(' ')` for the trigger so each punch requires a fresh keypress; the continuous animation in #3 then plays cleanly to completion.

### 9. Text rendering inconsistency on the ground row — impact: low
- Where: `game.js:200` (`textBaseline = 'alphabetic'`) vs. all other draws using `'middle'` (`game.js:176, 209`)
- Why it hurts smoothness: Not flicker, but the ground dashes sit on a different baseline metric than every other glyph; on subpixel-snapped frames this can shimmer relative to the figure feet, especially with `image-rendering: pixelated` on the canvas.
- Proposed fix: Standardize on `textBaseline = 'middle'` for ground dashes too (and adjust the y by half the line height) so all glyph centers align to the same vertical math.

### 10. `image-rendering: pixelated` on subpixel positions — impact: low
- Where: `style.css:22`, combined with `player.x` being a float in `game.js:107, 118, 149, 152`
- Why it hurts smoothness: `pixelated` scaling combined with non-integer X positions can produce jittery edges on the stick glyphs as floats round inconsistently per frame.
- Proposed fix: Either drop `image-rendering: pixelated` (the canvas isn't being upscaled) or `Math.round` positions only at draw time (keep float state for physics). Drawing at integer coordinates removes a class of micro-shimmer.

## Quick wins for this iteration (top 2-3)

1. **Frame-rate independence (Issue #1).** The single highest-leverage fix: pass a clamped `dt` through `update`, scale all velocities/timers by it. Without this, every other smoothness improvement is undone on non-60Hz displays.
2. **Velocity easing on the player (Issue #2).** A 4-line lerp on `player.vx` instantly transforms the felt quality of locomotion from "rigid" to "responsive". Cheapest big win after dt.
3. **Animated punch with windup/extend/retract (Issue #3) plus interpolated hit-flash (Issue #6).** Together these make the core combat verb feel like an action instead of a toggle. Edge-trigger the punch (Issue #8) at the same time so the new animation is never interrupted mid-swing.
