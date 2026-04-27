# Iteration 4 — Smoothness Review

Substrate now: dt sweep landed (timers in seconds, knockback decays via `pow(0.7, dt*60)`, vx lerp via `pow(1 - VX_LERP, dt*60)`); hitstop captures the mid-extension pose; K.O. freezes; wall clamp zeros vx; corner-pin shoves opponent away.

Inspiration reviewer is expected to propose **crouch + telegraphed jab (~45 LOC)** this iteration. To leave that the keystone budget, smoothness work this iteration must stay **≤25 LOC**. Picks below come in at **~22 LOC**.

The dt substrate makes per-second easing trivially correct, so the highest-leverage smoothness wins are the ones that (a) compose with the upcoming jab telegraph (benefit from a calm-looking opponent and stable pose anchor) and (b) remove the two most legible "snap" artefacts left in the game: integer HP jumps and instant patrol flips.

---

## Recommended picks (ranked)

### Pick 1 — HP bar damage-tail lerp (HIGHEST LEVERAGE) — ~10 LOC

**Issue.** `game.js:316–318` draws the HP fill directly from the integer `hp`. On a punch landing 8 dmg, the green bar steps an entire ~20-px chunk in one frame. With hitstop now correctly freezing the *pose* on impact, the eye is drawn straight at the bar, and the snap is more visible than before. Killing blows are worst — 92→0 vanishes in one frame after a 133 ms freeze.

**Why it hurts.** The bar is the only diegetic readout of damage magnitude; right now it carries zero of the impact signal. Hitstop + flash + knockback all emphasize the moment, then the bar instantly resolves the consequence. Adding a draining "tail" makes damage *legible as a quantity* — the player sees "I took 8" not "I took some".

**Composes with jab.** Telegraphed jab will land bigger single hits (likely 14–16 dmg vs the current 8). A snap-to-int bar at jab damage levels will look broken; lerp is already needed for the keystone to feel right.

**Fix sketch.**
1. Add fields on both `player` and `opponent` in their object literals (`game.js:31–43`, `45–53`):
   - `displayedHp: 100`  — value the bar visually anchors at (lags behind `hp`)
   - `damageTailHp: 100` — older value, drains slower (the "ghost" tail)
2. In `update(dt)`, after all damage has been applied (right before `keysPressed.clear()` at `game.js:217`), advance both fields with framerate-independent lerps:
   - `displayedHp` snaps fast: `displayedHp += (hp - displayedHp) * (1 - pow(1 - 0.4, dt*60))`
   - `damageTailHp` drains slow: `damageTailHp += (displayedHp - damageTailHp) * (1 - pow(1 - 0.06, dt*60))`
   - Apply for both `player` and `opponent`.
3. Pass `displayedHp` and `damageTailHp` into `drawHpBar` (`game.js:306`); draw the tail first in a desaturated tint (e.g. `#8a4a4a`) sized to `damageTailHp / maxHp`, then the live fill on top sized to `displayedHp / maxHp`. Keep the integer-hp text label (`${hp}/${maxHp}`) — players still want the exact number.
4. Reset both `displayedHp` and `damageTailHp` to `maxHp` in `resetMatch()` (`game.js:71–85`).

**Edge cases.**
- Hitstop pauses `update` early-return at `game.js:120–123` — bar correctly does not drain during the freeze, so the tail "starts" the moment play resumes. That's the right feel: freeze, then drain.
- `displayedHp` is a float; the rendered text still reads the int `hp`. No rounding artefacts.
- K.O. — the killing-blow tail drains from full to zero across ~1 s after hitstop ends, but `toGameOver()` fires the same frame `hitstop` reaches 0 (per iter-3 Change 2c). The tail is invisible by then. Fine — game-over screen replaces the bar; we don't need the drain there.

**LOC budget.** 4 field inits + 4 lerp lines (2 chars × 2 lerps) + 2 signature/draw changes in `drawHpBar` + 2 reset lines ≈ **10 LOC**.

---

### Pick 2 — Patrol direction easing — ~5 LOC

**Issue.** `game.js:182–190` writes `opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt` and flips `patrolDir` instantly at the boundary clamps. The opponent reverses with a 1-frame velocity inversion — visually a pop, not a turn.

**Why it hurts.** The opponent is on screen continuously. Every patrol cycle (currently ~3.3 s) ends with two visible pops. With a planned crouch + telegraphed jab arriving, the player's eye will be reading the opponent for *intent*; instantaneous direction flips make the opponent look mechanical and undercut any future telegraphs. The fix gives the opponent a visible "decide-and-turn" beat.

**Composes with jab.** A telegraphed jab needs the opponent to read as a *thinking entity*. Inertia at turnaround is the cheapest possible win on that axis — same reason fighting-game AI walks through a brief stutter at range edges.

**Fix sketch.**
1. Add `vx: 0` to the `opponent` object literal (`game.js:45–53`).
2. In the patrol branch (`game.js:183–190`), replace the direct position write with a target-velocity lerp:
   - Compute `targetVx = OPPONENT_SPEED * patrolDir`
   - `opponent.vx += (targetVx - opponent.vx) * (1 - pow(1 - 0.18, dt*60))` — slightly slower than the player's `VX_LERP = 0.25` so the turn reads as deliberate, not twitchy
   - `opponent.x += opponent.vx * dt`
   - Boundary checks unchanged: still set `patrolDir = ±1` at `patrolMin`/`patrolMax`. **Do not** zero `opponent.vx` on flip — that's the whole point; let it decelerate through zero naturally.
3. Reset `opponent.vx = 0` in `resetMatch()`.

**Edge cases.**
- Knockback branch (`game.js:179–181`) is exclusive (`if (knockbackActive) ... else ...`). Knockback still writes position directly via `opponent.knockback`, untouched. When knockback decays below 6 and patrol resumes, `opponent.vx` may be stale (it last held the patrol value pre-knockback) — that's fine, it lerps toward the new target naturally. Optional 1-LOC hardening: `opponent.vx = 0` in the moment knockback ends, but not necessary.
- Corner-pin shove (`game.js:205`) writes `opponent.knockback`, so this stays clean.
- Opponent overshooting `patrolMax`/`patrolMin` is bounded — the existing `opponent.x = patrolMax` clamp on the same frame the dir flips means the inertia decays toward the *new* direction; max overshoot is one frame's worth of vx (≤1.6 px at 60 Hz), well within the ARENA clamp at `game.js:192`.

**LOC budget.** 1 field init + 3 patrol-branch lines + 1 reset = **5 LOC**.

---

### Pick 3 — Subpixel render snap (`Math.round`) — ~3 LOC

**Issue.** `style.css:22` sets `image-rendering: pixelated` on the canvas. Combined with float positions (`player.x`, `opponent.x`) now written every frame from `vx * dt` (e.g. 192/144 = 1.333 px/frame at 144 Hz), the `fillText` glyphs sample on subpixel boundaries and shimmer when displayed through a pixelated upscale on hi-DPI / non-1:1 displays.

**Why it hurts.** Stick figures are 3-character glyphs; the shimmer is most visible on the head `O` and the legs `/ \`. It's a low-grade "the renderer is buzzing" feel that is invisible at 60 Hz integer math but becomes obvious post-dt sweep on high-refresh monitors.

**Composes with jab.** The jab's telegraph windup will hold the opponent stationary for ~200–300 ms; that hold *should* be rock-steady. Subpixel jitter during a hold is exactly when shimmer is most visible.

**Fix sketch.**
1. In `drawStick` (`game.js:256`), at the top of the function: `x = Math.round(x); y = Math.round(y);` — one line, two assignments.
2. Optional companion in `drawHpBar` (`game.js:306–326`): the bar coords are already integers, so no change needed.
3. **Do not** snap in the simulation; keep `player.x` / `opponent.x` as floats so velocity is preserved frame-to-frame. Snap only at the render boundary.

**Edge cases.**
- The fist-extension offset `off` in `drawStick` (`game.js:266–277`) is computed *after* the snap, then added to the snapped x. It's still float, but it's drawn in a single `fillText` so subpixel position only affects that glyph for one frame; the head/torso/legs are now stable. Acceptable. Alternative: snap `off` too (`Math.round(facing * (8 + off))`) — adds 1 LOC if the punch fist still shimmers in playtest, defer otherwise.
- Hit-test still uses unsnapped `player.x` / `opponent.x` — collision math stays smooth, only render snaps. Correct separation.
- Contact-cooldown distance check `Math.abs(player.x - opponent.x) < CONTACT_RANGE` (`game.js:196`) sees float positions; unchanged.

**LOC budget.** 1 line in `drawStick` (snap both at once with `, ` separator counts as 1 effective line) + 1 line of breathing room. **~2–3 LOC.**

---

## Total budget

10 + 5 + 3 = **~18–22 LOC**. Leaves the inspiration reviewer the full ~45 LOC for crouch + jab and still under a comfortable iter-4 cap of ~70 LOC total.

---

## Deferred (and why)

- **Walk leg cycle (`/ \` ↔ `\ /` every 0.2 s).** Tempting and visible (~8 LOC). Defer because: (a) the keystone introduces a **crouch** pose that will require its own pose-table refactor in `drawStick`; bundling leg-cycle then is cheaper and avoids touching `drawStick` twice; (b) on its own, a leg cycle without arm swing reads as "rocking in place" and may look worse than the static `/ \`. Best to land it together with crouch as part of one pose pass in iter-5.
- **Player knockback channel (`player.knockbackVx`).** ~10 LOC, real win, but corner-pin shove (iter-3 Change 3) already routes the worst case (wall-trapped contact) through `opponent.knockback` instead. Mid-arena contact still does `player.vx = -360` — a real pop, but it lasts ~3 frames before the VX_LERP curve reasserts. Defer until iter-5: once jab + crouch land, contact damage will be relatively rarer (player can crouch under contact band), reducing exposure. Re-evaluate then.
- **Wall clamp velocity zero swallowing.** Already addressed in iter-3 (`game.js:134` zeros `player.vx` after clamp). Closed.
- **Damage-number floaters / hit sparks.** Out of scope for smoothness; that's juice. Defer to a dedicated polish iteration after gameplay verbs settle.

---

## Test in head — combined picks

- Land an 8-dmg punch on opponent at full HP. Hitstop holds the extended-fist pose for 67 ms with the opponent flashing red. Live frames resume: opponent's HP integer drops to 92 instantly, the bright fill bar lerps from 100→92 over ~150 ms, and a desaturated red tail lingers behind it, draining 100→92 over ~1 s. The tail is the visible "you took 8".
- Watch the opponent patrol unmolested. Opponent reaches `patrolMax = 800`, slows visibly over ~120 ms instead of snapping, reverses, accelerates back. Reads as deliberate. No corner pop.
- On a 144 Hz display, hold position; the head `O` and legs `/ \` no longer shimmer. Move with `D`; figure translates smoothly because simulation x is still float, only render is snapped.
- K.O. blow: hitstop doubles to 133 ms, pose holds, opponent flashes, then game-over screen takes over. The HP-tail drain is invisible (game-over overlays the canvas) — acceptable; the freeze + flash already carry the K.O. weight.
