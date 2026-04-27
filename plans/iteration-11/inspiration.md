# Iteration 11 — Inspiration: Dynamic Background

User direction (verbatim): *"Play with the background."*

The arena is right-side-up, upside-down, four-surface, and rhythmic — but the canvas behind it all is a flat `#1a1a1a` (`style.css:21`). Every dramatic event currently radiates outward into emptiness: gravity flips with no atmosphere, shield bounces with no echo, knockouts on a void. The background is the missing reverb.

Below: 5 inspirations grounded in classic 2D games, each scoped to compose with the existing event surface (gravity flip, camera shake, shield rhythm, hit events, wall-climb). All are canvas-2D primitives. Synthesis budget: **≤50 LOC**.

---

## #1 — Geometry Wars: dot grid that reacts to events

**Inspiration.** *Geometry Wars: Retro Evolved* (Bizarre Creations, 2003). A static dot grid bends, ripples, and flares around player actions — the empty space becomes a reactive instrument.

**Trigger.** Continuous (renders every frame). Modulated by: hit events (radial flare), gravity flip (wave sweep), camera shake (the grid already inherits because shake wraps the whole `ctx.translate` block at `game.js:762-763`).

**Mechanic.**
- Render a sparse dot grid every ~64 px before `drawWalls()` — `for (let y = 0; y < H; y += 64) for (let x = ...) ctx.fillRect(x-1, y-1, 2, 2)`.
- Dot alpha: base `0.10`, plus a per-dot pulse `0.05 * sin(now*0.001 + (x+y)*0.01)` for slow ambient breath.
- On hit (`hitstop > 0`): dots within ~120 px of the hit point flare to alpha 0.5 for 100 ms. Reuse `opponent.hitFlash` as the timer source — fade with `hitFlash / HIT_FLASH_DURATION`.
- On gravity flip: dot alpha briefly tints toward yellow (warning palette already used at `game.js:771` for the countdown).

**Reward.** Atmosphere + signal. The arena stops feeling like a stage and starts feeling like a *space*. Hit feedback gets a second readout layer beyond the existing red flash + camera shake. Composes natively with shake (the grid moves with the world).

**Composition with state.**
- Shield rhythm: ignored (avoid clutter — the `(+)` glyph already speaks).
- Gravity flip: dots desaturate to yellow during the 1 s warning pulse, sync with the countdown glyph at `game.js:768-777`.
- Wall-climb: ignored at this iteration (background stays world-aligned).

**LOC.** ~14. (Grid render ~6 + hit-flare branch ~5 + flip-tint ~3.)

---

## #2 — Super Hexagon / VVVVVV: gravity-direction palette wash

**Inspiration.** *Super Hexagon* (Cavanagh, 2012) and *VVVVVV* (Cavanagh, 2010). The palette itself is a state readout — Super Hexagon's hue rotates per stage, VVVVVV's rooms wash to a new color on entry. The background communicates *which world you're in*.

**Trigger.** Gravity direction (`gravityDir`). Continuous lerp; no per-frame cost beyond a single `fillRect` for the background tint.

**Mechanic.**
- Replace the canvas's `#1a1a1a` CSS background. Instead, fill the canvas with a state-driven RGB each frame: `bgR/bgG/bgB` lerp toward target each frame.
- Right-side-up palette: `(20, 22, 28)` — current cool dark.
- Inverted palette: `(28, 22, 20)` — slightly warmer dark, signalling "world flipped."
- Lerp: `bgR += (target - bgR) * (1 - Math.pow(1 - 0.04, dt * 60));` — ~1 s ease.
- Optional warning beat: during `flipTimer < 1`, target nudges 4-6 points toward yellow `(40, 36, 16)` then snaps to the new palette on flip.

**Reward.** Drama via persistence. The flip event is loud (countdown, shake, rotation), but the *aftermath* — the next 8 s — currently looks identical to the pre-flip arena. A palette wash makes the inverted state *feel* inverted long after the rotation finishes. Cheap, atmospheric, never disorienting.

**Composition with state.**
- Gravity flip: the canonical trigger.
- Camera shake: shake wraps the `translate`, but the `clearRect` + `fillRect` background runs *before* `ctx.save()` — so the bg is shake-immune (a stable horizon while everything else jitters). This is correct: the world shakes, the void doesn't.
- Hit events: ignored.
- Shield rhythm: ignored.
- Wall-climb: ignored.

**LOC.** ~10. (Two state floats + palette-target picker + lerp + fillRect.)

---

## #3 — Celeste: shield-rhythm pulse rings (atmosphere shift)

**Inspiration.** *Celeste* (Maddy Makes Games, 2018). Madeline's dash recharge pulses the screen edges, and Chapter intros bloom soft circles that radiate outward. The atmosphere *breathes* with the gameplay rhythm.

**Trigger.** Shield rhythm transitions — when `opponent.state` flips `'shielding'` → `'open'` (`game.js:399-402`), spawn a single pulse ring centered on the opponent.

**Mechanic.**
- Single `pulse` object: `{ x, y, t, dur }`. Spawn on shield-drop. Render: `ctx.strokeStyle = rgba(136,204,238, alpha)`, `ctx.arc(x, y, radius, 0, 2π)`, `ctx.stroke()`.
- `radius = 30 + 200 * (1 - t/dur)` — expands outward.
- `alpha = (1 - t/dur) * 0.4` — fades.
- `dur = 0.6` s. Single in-flight pulse at a time (overwrite on next drop). No allocation per frame.
- Render *before* the fighters but *after* `drawWalls()` / `drawGround()` so the ring sits on the playfield.

**Reward.** Tension. The shield's drop is currently signalled only by the `(+)` disappearing — easy to miss mid-action. A single radiating ring gives the open window its own breath. Trains the player's eye to the rhythm. Cheap drama.

**Composition with state.**
- Shield rhythm: the canonical trigger.
- Gravity flip: when flip fires (`game.js:228-242`), the trigger also opens both shields — that re-spawns a ring naturally, layering the flip event with a fresh pulse.
- Camera shake: the ring is drawn inside the shake block — it shakes with the world. ✓
- Hit events: ignored (the existing red flash already speaks).
- Wall-climb: ring spawns at `opponent.x/opponent.y` regardless of surface, which means a ring radiating from a ceiling-stuck or wall-stuck opponent reads as expected (atmospheric, surface-aware-by-default).

**LOC.** ~12. (Pulse field + spawn-on-transition hook + render block.)

---

## #4 — Fez: parallax dot field with subtle drift

**Inspiration.** *Fez* (Polytron, 2012). Rotating layers of slow-drifting backdrop motes that read as depth without ever upstaging the foreground.

**Trigger.** Continuous. Modulated faintly by `gravityDir` (drift direction inverts) and by camera shake (motes inherit the translate naturally).

**Mechanic.**
- Allocate ~24 motes once at module init: `{ x, y, vx, vy, alpha }`. `x/y` random over canvas, `vx` ~6-12 px/s in random direction, `vy` similar. `alpha` ~0.05-0.15 randomized.
- Each frame: `mote.x += mote.vx * dt * gravityDir; mote.y += mote.vy * dt;` (gravity flip subtly inverts horizontal drift — the world *feels* differently oriented). Wrap on canvas edges.
- Render before walls: `ctx.fillStyle = rgba(180, 180, 200, alpha)`, `ctx.fillRect(x, y, 1, 1)` — single-pixel motes.

**Reward.** Atmosphere. Pure ambient layer — never demands attention but makes the void feel inhabited. No event-driven spikes; this is the *room tone*, the constant under the louder beats. Pairs especially well with #2 (palette wash) — palette is the room color, motes are the dust in it.

**Composition with state.**
- Gravity flip: drift direction inverts. Subtle but the kind of detail a returning player notices.
- Camera shake: motes drawn inside the shake block, inherit naturally.
- Hit events: ignored.
- Shield rhythm: ignored.
- Wall-climb: ignored.

**Risk.** 24 motes × 60 fps × `fillRect` = trivial perf, but allocations during play would be sloppy — pre-allocate once, never `push`/`pop`. Use a fixed-size array.

**LOC.** ~14. (Init array + per-frame update loop with wrap + render loop.)

---

## #5 — Sonic Spinball / Donkey Kong Country horizon line: wall-climb glow

**Inspiration.** *Sonic Spinball* (Sega, 1993) and *Donkey Kong Country* mine-cart stages — a single colored gradient band hugs the active surface, signalling "this is where the action is" with light alone.

**Trigger.** Opponent surface state — when `opponent.surface === 'left'` or `'right'`, a faint vertical glow tints the corresponding wall column. Pure render hook on existing state.

**Mechanic.**
- After `drawWalls()`, check `opponent.surface`. If `'left'`, paint a vertical gradient column from `WALL_THICKNESS` outward to `WALL_THICKNESS + 80`, alpha lerping from 0.15 at the wall to 0 at the column edge. Mirror for `'right'`.
- Color: warm desaturated red `rgba(180, 100, 80, alpha)` — signals "danger climbed up here."
- Tween in/out: a `wallGlow` float per side, lerps to 1 when opponent is on that wall, 0 otherwise. ~0.3 s ease.
- Optionally also tint `ARENA_LEFT`/`ARENA_RIGHT` wall fills (`game.js:595-597`) toward the warm color via the same lerp.

**Reward.** Signal + drama. The "cornered opponent climbs wall" moment (iter-9 keystone) currently reads only via the rotated stick figure. A glow makes the cornered state legible across the whole arena — even a player chasing across the floor feels the wall *waking up*. Composes with the existing geometric vocabulary (lines, fills) and the existing color palette (warm = hit/hurt, cool = shield).

**Composition with state.**
- Wall-climb: the canonical trigger. Both walls glow independently (so a flipping cornered opponent that climbs left, then right, has both lerps tracking).
- Gravity flip: ignored — the wall stays the wall regardless of gravity.
- Hit events: ignored.
- Shield rhythm: ignored.
- Camera shake: column drawn inside the shake block, inherits.

**LOC.** ~14. (Two lerp floats + per-frame update + linear-gradient strokes per side.)

---

## Comparative summary

| # | Inspiration | Trigger | Mechanic | Reward axis | LOC |
|---|---|---|---|---|---|
| 1 | Geometry Wars | Hit events + flip | Reactive dot grid | Atmosphere + signal | ~14 |
| 2 | Super Hexagon / VVVVVV | Gravity flip | Palette wash (lerp) | Drama / persistence | ~10 |
| 3 | Celeste | Shield drop | Pulse ring | Tension / rhythm | ~12 |
| 4 | Fez | Continuous | Parallax mote drift | Room tone / ambient | ~14 |
| 5 | Sonic Spinball / DKC | Wall-climb | Wall-side glow column | Signal / drama | ~14 |

---

## Recommendation for synthesis

The strongest *layered* result composes #2 (palette wash, persistent state) with #4 (parallax motes, ambient texture) — together they're a complete "background" without competing with foreground signal. Add #3 (shield pulse ring) as the rhythm reverb — it gives the most under-served event (shield drop) its own visual language. Total: ~36 LOC, leaves ~14 LOC of slack.

- **Pick #2 spine.** Persistent palette state is the cheapest dramatic upgrade — every frame after a flip looks different from before. Leans into the existing flip event without adding a new beat.
- **Pick #4 ambient.** Parallax motes give the void texture without claiming attention. Inverts horizontal drift on flip — a small wink that rewards observation. Composes cleanly with #2.
- **Pick #3 reverb.** A single pulse ring per shield-drop teaches the rhythm and rewards reading the `(+)` cycle. The flip event already opens shields, so flip and pulse co-arrive naturally.
- **Defer #1 (Geometry Wars grid)** — closest to overlapping with #4's mote field; redundant if #4 ships. Reconsider iter-12+ as a *replacement* for #4 if hit-event signal proves under-served.
- **Defer #5 (wall glow)** — the wall-climb event is already well-signalled by the rotated stick figure. Revisit if iter-12 playtest finds the cornered state under-read.

Estimated synthesis budget: **~36 LOC** (#2 ~10 + #4 ~14 + #3 ~12).

---

## Specific reconsiderations addressed

**Compose with gravity flip.** #2's palette wash is the canonical answer — slow lerp toward an inverted-warm target on flip. The existing yellow countdown glyph (`game.js:768-777`) sells the *event*; the palette wash sells the *aftermath*. #4's mote-drift inversion is the secondary, subtle signal.

**Compose with camera shake.** All five proposals draw inside the existing `ctx.save() / translate(sx, sy) / restore()` block — they inherit shake naturally. Exception: #2's palette fillRect is drawn *before* `ctx.save()`, so the world shakes against a stable horizon. That asymmetry is intentional and correct.

**Compose with shield rhythm.** #3 is the canonical answer — pulse ring on shield-drop. The trigger hook is a single state-transition site already in `update` at `game.js:399-402`.

**Compose with hit events.** #1's localised dot-flare is the most direct answer. Deferred only because #4 already pays the "ambient layer" cost; double-dipping is wasteful. If iter-12 playtest finds hit feedback under-read despite red flash + shake, promote #1.

**Compose with cornered wall-climb.** #5 is the targeted answer. Deferred for budget; the cornered moment is already legible via the rotated stick.

**Performance.** All proposals use canvas-2D primitives — `fillRect`, `stroke`, `arc`. No images, no per-frame allocations. Mote field is fixed-size, pre-allocated. Pulse ring is a single object. Palette is two floats. Rough budget: ~20 extra `fillRect` calls + 1 `arc` + 1 background fill per frame = sub-millisecond on any modern device.

**Aesthetic.** Every proposal stays inside the existing visual vocabulary: thin strokes (`#444` ground/wall lines at `game.js:618-625`), monospace glyphs for telegraphs, two- or three-character ASCII figures. Palette extensions stay within the established cool/warm/yellow/blue micro-palette — no new colors introduced beyond a single warm-dark shift and a single shield-blue ring (already used at `game.js:822`).
