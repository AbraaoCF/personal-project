# Iteration 10 — Smoothness Review

Iter-10 ships gravity flip + ceiling surface + 4-surface generalization (~50 LOC budget already big). Smoothness picks must therefore be cheap AND must compose with the gravity-flip work — anything that fights it (e.g. polishing the wall-stuck shield-glyph offset before the surface table rotates) is wasted. Picking 3 items, ~17 LOC total.

Wall-run shipped (`game.js:113-117` SURFACE_GRAVITY, `game.js:557-564` drawStickOnSurface, `game.js:687`/`game.js:709` call sites). Rotation now exists at draw time, which means shimmer-prone diagonal pixel paths exist — subpixel snap becomes more valuable than it was pre-iter-9.

---

## Picks (3 changes, ~17 LOC)

| # | Pick | LOC | Composes with iter-10? |
|---|---|---|---|
| 1 | Subpixel render snap at draw time | ~4 | Yes — new ceiling rotation paths benefit immediately |
| 2 | Stick-figure rotation easing on `surface` change | ~8 | Yes — gravity flip is a 180° rotation event |
| 3 | Camera shake pulse on gravity flip | ~5 | Yes — flip is the new feel-event |

Total ~17 LOC. Headroom for iter-10's ~50 LOC keystone.

Deferring:
- **Intermission overlay fade-in** — iter-10's flip will likely change round-start framing; revisit iter-11.
- **Knockback magnitude** — single-variable tuning, defer to a "tuning pass" iteration once the 4-surface combat geometry settles.
- **Shake decay dt-correction** — tiny fix but `render()` already changes for shake-on-flip (Pick 3). Bundle with Pick 3 only if cheap; otherwise iter-11. Treated as a free rider inside Pick 3 below.
- **Opponent drop-back from wall snap** — synthesis labelled this "paint-job, deferred" and the same reasoning still holds.
- **Wall-stuck shield indicator offset** — the `(+)` glyph at `game.js:728` is in world-space, wrong post-rotation. Iter-10 makes this *worse* (ceiling adds another wrong orientation). Tempting to fix now, but the right fix is to rotate the glyph through the same surface transform — and that's a render-architecture change ("draw all per-fighter UI inside drawStickOnSurface's rotated frame"), not a paint-job. Defer to a focused render-frame pass. Documented under Deferred.
- **Wall-stuck punch hit-test geometry** — synthesis flagged this as a known iter-9 limitation. It's NOT smoothness, it's combat correctness. Belongs in iter-10's keystone work, not in this review.

---

## Pick 1 — Subpixel render snap

**What.** Round draw-time coordinates to whole pixels at the two stick render call sites (and inside `drawStickOnSurface` after rotation). Prevents shimmer on wall-stuck and (iter-10) ceiling-stuck fighters where rotation interacts with sub-pixel `x`/`y` floats.

**Why.** Canvas with `image-rendering: pixelated` (`style.css:22`) plus rotated text glyphs is a textbook shimmer setup. On floor, `player.x` is float but glyphs render at fixed offsets so the eye filters it. After 90° rotation (and 180° in iter-10), every glyph's anti-aliased subpixel position becomes visible as the fighter slides. Rounding once at the transform anchor eliminates the entire shimmer surface area for free.

**Where.** `game.js:559-562` (`drawStickOnSurface`) and `game.js:566` (`drawStick` entry).

**Spec sketch.** Inside `drawStickOnSurface` change `ctx.translate(x, y)` to `ctx.translate(Math.round(x), Math.round(y))`. Inside the floor branch (`drawStick(x, y, opts)`) change to `drawStick(Math.round(x), Math.round(y), opts)`. Optionally also round inside `drawStick` itself for the punch-arc `off` value (`game.js:619`) — that's the only inner offset that drifts by subpixels. ~3-4 LOC.

**Watch.** Don't round `player.x` in the simulation — only at draw time. Simulation must stay float for smooth motion across frames; rounding the *displayed* position keeps the underlying physics intact while removing shimmer. The whiff/landingLag micro-leans (`game.js:583`, `game.js:598`) are already integer-derived so they're fine.

**Composes with iter-10?** Yes — ceiling render path will go through the same `drawStickOnSurface` helper. Doing this now means iter-10's ceiling stick figure is shimmer-free on day 1.

**LOC.** ~4.

---

## Pick 2 — Stick rotation ease on surface change

**What.** Track each fighter's *rendered* rotation as a separate float that lerps toward the surface-target rotation over ~0.1s, instead of snapping `0 → ±π/2 → ±π` instantly when `surface` changes.

**Why.** `drawStickOnSurface` (`game.js:557-564`) is currently a binary rotation (0 or ±90°). Iter-10's gravity flip is a 180° instantaneous rotation — by far the most jarring possible change. Even at high framerate, snapping 180° in one frame reads as a teleport, not a flip. A 100ms ease (~6 frames @60fps) reads as a deliberate flip animation. This is the cheapest possible "this game has juice" win on the iter-10 keystone.

**Where.** New per-fighter field `renderAngle`; updated in `update()` after the surface block; consumed by `drawStickOnSurface`.

**Spec sketch.**
- Add `player.renderAngle = 0;` and `opponent.renderAngle = 0;` to inits and `resetRound`.
- Add a small helper `surfaceAngle(s)` returning the target radians: `floor → 0`, `left → π/2`, `right → -π/2`, `ceiling → π` (iter-10).
- After the surface-update block in `update(dt)`, lerp: `f.renderAngle += (surfaceAngle(f.surface) - f.renderAngle) * (1 - Math.pow(1 - 0.4, dt * 60));` for each fighter. (Reuses existing `fastLerp` formula style at `game.js:495`.)
- Change `drawStickOnSurface(x, y, surface, opts)` signature to take an `angle` param, or read `f.renderAngle` from caller. Use `ctx.rotate(angle)` instead of the binary branch.
- Floor short-circuit at `game.js:558` (`if (surface === 'floor') { drawStick(...); return; }`) must go: it's actively wrong during the ease (`renderAngle ≠ 0` even when `surface === 'floor'`, mid-transition).

**Watch.**
- Shortest-path interpolation: lerping `0 → π` and `π → 0` is fine, but `-π/2 → π` should rotate through `π/2`, not the other way. Wrap with `((target - current + π) mod 2π) - π` to pick the short arc. ~2 extra lines but critical — without it, a left-wall → ceiling flip rotates the wrong way through the floor and reads weird.
- Hit-tests still use `surface`, not `renderAngle`. So during the 100ms ease, fighter is "on ceiling" logically while still visually rotating — punches hit/miss based on logical state. Acceptable: 100ms < typical reaction window.
- The `airborne` / `crouch` branches in `drawStick` won't visually conflict — they're stick-frame variations rendered inside the rotated transform.

**Composes with iter-10?** This pick exists *for* iter-10. Without it, gravity flip is a teleport.

**LOC.** ~8 (field + reset + helper + lerp line + signature change + short-arc wrap).

---

## Pick 3 — Camera shake pulse on gravity flip (+ free dt-correction)

**What.** When gravity flips (iter-10's new event), pulse `shake` by ~6-8px for ~0.15s. Bundle the shake-decay dt-correction at the same site since both edits are in `render()` lines 674.

**Why.** Gravity flip is the iter-10 keystone feel-event. Currently `shake` only triggers on hitstop (`game.js:493`). A 180° world rotation with no kinaesthetic cue feels like a bug, not a mechanic. A short shake pulse is the universal "the world just changed" signal — Celeste, Downwell, every flip-gravity game does this. Cost: a single line at the flip site (which iter-10 will write anyway) plus an entry in the shake-source table.

The dt-correction free rider: `shake *= 0.85` (`game.js:674`) is a per-frame multiplier — frame-rate dependent. At 144Hz the shake decays 2.4x faster than at 60Hz. Replacement `shake *= Math.pow(0.85, dt * 60)` matches the existing pattern at `game.js:227`, `game.js:338`. Critical now because (a) shake will fire more often (flip event), and (b) the existing ad-hoc pattern is documented in the synthesis as "fix when the translate block is rewritten" — that's now.

**Where.**
- `game.js:674` — fix the decay.
- Iter-10's gravity flip handler (wherever the flip is triggered) — `shake = Math.max(shake, 8);` or similar one-liner.

**Spec sketch.**
- Replace `shake *= 0.85;` with `shake *= Math.pow(0.85, dt * 60);`. Note: `render()` doesn't currently take `dt`. Either pass it (preferred — minimal signature change), or hoist the decay into `update()` (cleaner, since shake is sim-state, not render-state). Hoisting is the right call: move `shake *= …` to the end of `update(dt)` before `keysPressed.clear()`.
- At iter-10's flip-gravity site, `shake = Math.max(shake, 7);` — uses the same `Math.max` pattern as hitstop (`game.js:493`) so concurrent flip+hit doesn't double-apply.

**Watch.**
- Shake pulse during round intermission would feel dissonant. Iter-10's flip handler should already gate on `roundPhase === 'fighting'`; if not, gate the shake assignment too.
- Don't shake during the very first flip after `resetRound` — `resetRound` should set `player.surface = 'floor'` synchronously, no flip event fires. Verify in iter-10 that `resetRound` doesn't trip the flip path.

**Composes with iter-10?** Yes — directly on the flip event.

**LOC.** ~5 (1 LOC dt-fix + 1 LOC hoist + 1 LOC flip-site shake + 2 LOC for the gating verification once flip-site code lands).

---

## Total LOC tally

| # | Pick | LOC |
|---|---|---|
| 1 | Subpixel render snap | ~4 |
| 2 | Stick rotation ease | ~8 |
| 3 | Shake pulse on flip + dt-correction | ~5 |
| **Total** | | **~17** |

Within the ≤25 LOC cap.

---

## Implementation order (orchestrator note)

1. **Pick 1** first — pure render-only edit, no sim coupling. Verified by walking on floor (no visual change) and wall-sticking (no shimmer).
2. **Pick 3 dt-correction half** before iter-10 keystone — it's a 1-LOC fix and unblocks the shake-on-flip half.
3. **Iter-10 keystone (gravity flip + ceiling)** — the big middle.
4. **Pick 2** alongside the keystone — `renderAngle` field is most naturally added when the surface state machine is being extended for ceiling.
5. **Pick 3 shake-on-flip** at the very end of iter-10 — single line where the flip is triggered.

---

## Deferred (iter-11+)

- **Intermission overlay fade-in** — symmetry with match-end fade. ~6 LOC. Bundled with iter-11 round-start polish if iter-10 introduces a flip-settle flourish.
- **Knockback magnitude tuning** — wait one playtest with the full 4-surface arena before changing the value. May feel different post-flip.
- **Wall/ceiling-stuck shield indicator orientation** — `(+)` at `game.js:728` is world-space; needs to render inside the rotated transform. Architectural fix (per-fighter UI through `drawStickOnSurface` frame), not a one-liner.
- **Opponent drop-back from wall snap** — `opponent.y = GROUND_Y` instant snap (`game.js:398`, `game.js:423`, etc.). Smoothing wants a brief lerp via a new `opponent.targetY` or a 0.1s "falling-from-wall" mini-state. Paint-job, defer.
- **Wall-stuck punch hit-test geometry** — combat-correctness, not smoothness. Belongs in iter-10's keystone if there's slack; otherwise iter-11 keystone.
- **Squash-and-stretch on flip apex** — additional juice on top of Pick 2's rotation ease. Iter-12+ polish.
