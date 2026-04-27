# Iteration 10 — Inspiration: Gravity Flip + 'ceiling' Surface

User direction (verbatim): *"I want for the gravity to change from time to time and the fight becomes upside down."*

The arena already has 3 surfaces (`floor` / `left` / `right`), a `SURFACE_GRAVITY` table, wall-stick + slide + wall-jump, and an opponent that climbs walls when cornered (`game.js:113-120`, `game.js:263-303`, `game.js:383-400`). Iter-10's job is to add a **4th surface** (`'ceiling'`) and a **gravity-flip event** that swaps which face is "down" so fighters fall upward and continue sparring on the new floor.

The shield rhythm continues across the flip; the flip itself is the mix-up. Below are 5 inspirations, each with a complete trigger / mechanic / reward / LOC sketch. Pick 2-3 in synthesis; the budget is **≤50 LOC**.

---

## #1 — VVVVVV: player-pressed flip (simplest, biggest verb-shift)

**Inspiration.** *VVVVVV* (Terry Cavanagh, 2010). Captain Viridian cannot jump — pressing the action key flips gravity. Each flip is a player-authored vertical traversal verb.

**Trigger.** Player input. Reuse `W` / `↑` while grounded as "flip" instead of jump (or bind to a dedicated key like `K` to keep jump intact). A small cooldown (~0.4s) prevents stutter-flip exploits. Both fighters flip globally — the world flips, not just the player.

**Mechanic.**
- Add a global `gravityDir` scalar in {+1, -1}. `+1` = down (current), `-1` = up.
- Extend `SURFACE_GRAVITY` with `ceiling: { gx: 0, gy: -1 }`.
- When flip fires: invert `gravityDir`, swap each fighter's `surface` only if they're on `floor`/`ceiling` (`floor` ↔ `ceiling`). Walls are untouched (the wall-run logic generalises — gravity now pulls toward whichever wall they cling to, unchanged).
- Floor / ceiling y-anchors: `FLOOR_Y = GROUND_Y` (existing), `CEILING_Y = 60`. After flip, `floor` fighters teleport into airborne state with new gravity sign; they fall *up* until they touch `CEILING_Y`, where the new "ground-touch" branch fires.
- Punch direction stays world-relative (`facing` still maps to +x/-x). Jump becomes "leap toward your current floor" — same `JUMP_VELOCITY` magnitude, sign multiplied by `-gravityDir`. Crouch still pulls toward your current floor.

**Reward.** Maximum agency. Player decides when to flip; flipping mid-chase to skip across the ceiling and punch a wall-stuck opponent from above is the new combo. Tension comes from the opponent's shield rhythm continuing — flip badly and you arrive on the ceiling face-to-face with `(+)`.

**Telegraph.** Almost free — the player initiated it. Add a 0.15s "world tilt" easing where the camera y-offset pre-shifts to sell the flip.

**LOC estimate.** ~28 LOC: 1 const + 1 surface entry + ~6 in jump handler + ~10 in airborne update (factor `gravityDir` into `vy += GRAVITY*dt` and the floor/ceiling touch branches) + ~6 for ceiling-touch detection on opponent + ~5 render rotation in `drawStickOnSurface` for ceiling (180° rotation).

---

## #2 — Megaman X4 Magma Dragoon: arena-driven periodic flip with telegraph

**Inspiration.** Magma Dragoon's stage and the "lava rises" set-pieces in Megaman X4 / Sonic CD where the *arena* changes on a fixed beat, not the player. Players adapt to the rhythm instead of authoring it.

**Trigger.** Periodic timer. `gravityFlipTimer` ticks down from `FLIP_INTERVAL = 8.0s`. At `<= 1.0s` remaining, telegraph fires (color shift, glyph countdown). At 0, flip executes; timer resets. Pause the timer during `roundPhase === 'intermission'` and `gameEndHold > 0`.

**Mechanic.** Same physics flip as #1 (global `gravityDir`, ceiling surface, swap on floor↔ceiling). The difference is **the arena owns the clock**, not the player. Both fighters are subject to the same rhythm, exactly like the existing shield rhythm — making the flip a *macro-rhythm* nested above the *micro-rhythm* (0.6s open / 1.4s closed shield).

**Telegraph.**
- Arena floor and ceiling glow / pulse (alpha sin) starting at 1.0s remaining.
- A small countdown glyph in the HUD center: `3...2...1...` last second.
- Optional: `drawGround` color goes from `#444` → `#aa6` last 0.5s (yellow warning).
- Camera shake spike of `~3` on flip (we already have `shake`).

**Reward.** Predictable mix-up. The player can plan: "the flip lands in 4s, I'll wall-jump just before so I land standing." Sparring becomes a layered timing puzzle — sync your punch attempts to both the shield rhythm and the flip rhythm. Tension comes from the **shield-flip interaction**: if the flip lands during the 0.6s open window, the player is briefly disoriented and may lose the swing.

**Bonus design knob.** Make the flip create a small "open window" — opponent's `stateTimer` resets to `SHIELD_OPEN` on flip. The flip is a free open frame for the player who lands cleanly. (Cost: ~2 LOC.)

**LOC estimate.** ~32 LOC: physics core (~22 LOC, same as #1 minus the player-input branch) + ~6 LOC timer/telegraph + ~4 LOC HUD countdown + the 2-LOC shield-reset bonus.

---

## #3 — Sonic Spinball / Sonic 1 loop-de-loops: hit-driven gravity meter

**Inspiration.** Sonic's loops and Spinball's bumpers — gravity changes are *earned*, not granted. The fighter "charges up" to a flip by performing well.

**Trigger.** Stateful meter. A `flipMeter` field (0..1) increments on combat events:
- Player lands a punch: +0.20.
- Player whiffs through opponent's open window without a hit: +0.05 (sparring credit for committing).
- Shield bounce: +0.10 (the bounce is the energy source).
- Meter caps at 1.0; when full, **flip auto-triggers** on next frame and meter resets.

**Mechanic.** Same physics flip as #1 / #2.

**Telegraph.** A meter bar — small horizontal pip beside the `(+)` shield icon, or a vertical fill on the canvas frame. As meter approaches 1.0, the world tints faintly (CSS hue-rotate? or canvas alpha overlay).

**Reward.** Earned drama. Players who land hits get rewarded with traversal flair. Skilled players see flips often (~one every 5 punches); flailing players see flips rarely. The meter doubles as a skill readout.

**Sparring impact.** Strong feedback loop — landing punches gives you flips, which give you new attack angles (ceiling drop), which let you land more punches. This may be too rewarding for skilled players; counterbalance by making the **opponent's shield window stay synced** so the flip alone doesn't break the rhythm.

**Cat/mouse interaction.** Opponent climbing left wall when meter fills → flip → opponent now hangs from ceiling near `ARENA_LEFT`. The wall-climbing logic generalises: cornered opponent climbs the (now-down-pointing) wall, which still works because `SURFACE_GRAVITY.left` is unchanged by the flip.

**LOC estimate.** ~38 LOC: physics core (~22) + meter field + 3-4 increment hooks in punch resolution branches (~6) + meter render (~6) + flip-trigger glue (~4).

---

## #4 — Gravity Rush: random-jittered interval ("the whim of gravity")

**Inspiration.** *Gravity Rush* (Bluepoint / SCE Japan) — Kat's gravity shifts are stylistically tied to environmental whim. Mechanically: a randomised interval feels organic, not metronomic.

**Trigger.** Random interval `FLIP_INTERVAL_MIN = 6.0s` to `FLIP_INTERVAL_MAX = 12.0s`. After each flip, sample `Math.random() * (max - min) + min`. The world is unpredictable but bounded.

**Mechanic.** Same physics flip as #2 (same telegraph, same physics). The only difference vs #2 is the timer source.

**Telegraph.** Critical here because the player can't count seconds. Use a **gravity glyph** somewhere on canvas (e.g. arrow `↓` near top center) that:
- Stays neutral most of the time.
- Begins pulsing at `< 1.5s` remaining (player learns the pulse means "soon").
- Flicks/inverts to `↑` on flip.

The pulse trains the player to feel an upcoming flip without a numeric countdown.

**Reward.** Sustained tension. Sparring never settles into a stale loop — the player must remain responsive. Unpredictability is the design value.

**Risk.** Random can feel unfair if a flip lands during a committed dive. Mitigation: give the player a **"flip resist" frame** during landing-lag and whiff-lock (skip the flip if either is active, defer it 0.3s).

**LOC estimate.** ~30 LOC: same core as #2 + ~3 LOC to randomise the timer + ~5 LOC for the gravity-glyph indicator − no HUD countdown to draw.

---

## #5 — Fall Guys "Hex-A-Gone" + Sonic Spinball loops: ceiling becomes the floor, slowly

**Inspiration.** *Fall Guys: Hex-A-Gone* tile-fall and *Sonic 1 / 2*'s loop-de-loops — the world rotates rather than instant-flips. A 0.4s "rotation" animation. Dramatic, never disorienting.

**Trigger.** Hybrid: periodic timer (#2) **but** flip animates instead of snapping.

**Mechanic.** All the physics from #2, but `gravityDir` lerps from +1 to -1 over `FLIP_DURATION = 0.4s`. During the lerp:
- Fighters' `vy` is suspended (or scaled by `(1 - flipProgress)`) — they float briefly.
- The whole canvas rotates 180° via a `ctx.rotate(Math.PI * flipProgress)` around the canvas center, drawn into the existing `ctx.save() / ctx.restore()` shake block (`game.js:677-678, 765`).
- Gravity sign starts taking effect at `flipProgress = 1.0`, so the world rotates into its new orientation and *then* fighters fall toward the new floor (which used to be the ceiling).

**Reward.** Pure spectacle. The flip becomes a cinematic interruption that's also a fair physics event — players see the rotation, can read where they'll land, and re-engage.

**Sparring impact.** During the 0.4s rotation, `state === 'shielding'` could be **forcibly opened** — a deliberate "the world flipped, both fighters got disoriented" beat. After flip, opponent's shield re-engages on `SHIELD_CLOSED`. This is the canonical "flip creates an open window" answer.

**Cat/mouse.** Opponent climbing wall mid-flip just keeps climbing — walls don't rotate, only the canvas does, so post-rotation the opponent visually moves but their `surface = 'left'` stays valid. Iter-12 polish can sync wall-climb direction to gravityDir if needed.

**LOC estimate.** ~42 LOC. Most expensive: ~22 physics + 8 ctx.rotate render + 4 timer + 4 telegraph + 4 shield-open glue. Within the 50-LOC cap but no slack for surprises.

---

## Comparative summary

| # | Inspiration | Trigger | Telegraph | Reward axis | LOC |
|---|---|---|---|---|---|
| 1 | VVVVVV | Player input | Camera tilt | Agency | ~28 |
| 2 | MMX Magma Dragoon | Periodic 8s | Countdown + arena pulse | Predictable rhythm | ~32 |
| 3 | Sonic Spinball | Hit-driven meter | Meter fill | Skill reward | ~38 |
| 4 | Gravity Rush | Random 6-12s | Pulse glyph | Sustained tension | ~30 |
| 5 | Fall Guys / Sonic loops | Periodic + animated | 0.4s canvas rotate | Spectacle | ~42 |

---

## Recommendation for synthesis

- **Pick #2 as the spine** (periodic 8s timer + telegraph). Predictability lets the player author counter-strategy; matches the existing rhythm-based design (shield rhythm, round timing).
- **Borrow the open-window trick from #5** (flip resets opponent's `stateTimer = SHIELD_OPEN`) — small LOC, big tension payoff.
- **Defer #1** (player-pressed) to iter-12+ as an unlock or alt-mode. Adding it now competes with the player's existing jump verb.
- **Defer #3** (meter) — the meter UI competes with the HP bar / shield indicator for HUD space; iter-13+ once we know if periodic feels too predictable.
- **Defer #5's animated rotation** — pure spectacle, costly LOC, no mechanical change. Iter-11/12 paint job once dynamic background ships.

Estimated synthesis budget: **~34 LOC** (#2 spine ~32 + #5 open-window ~2). Leaves ~16 LOC of slack for the unforeseen.

---

## Specific reconsiderations addressed

**Trigger.** Periodic (#2) is the synthesis pick; #4 random and #3 meter are runners-up. Player-pressed (#1) defers.

**Visual telegraph.** Multi-layer: (a) HUD countdown glyph last 1s, (b) arena floor/ceiling alpha pulse last 1s, (c) shake spike on flip. All cheap (~6 LOC together).

**Ceiling traversal.** `ceiling: { gx: 0, gy: -1 }` joins `SURFACE_GRAVITY`. Floor↔ceiling swap on flip; walls unaffected. Wall-run logic generalises: opponent climbing a wall during flip just stays on the wall — wall surfaces don't care which way "down" is, since we explicitly clamp `vy` via `WALL_SLIDE_VY` (`game.js:118`).

**Sparring impact.** Shield rhythm continues across the flip. Optional: opponent's `stateTimer = SHIELD_OPEN` on flip, creating a 0.6s "free swing" window for the player who lands cleanly. Cost: 2 LOC.

**Player verbs in inverted gravity.** Jump direction is `vy = JUMP_VELOCITY * -gravityDir`. Crouch unchanged (still pulls toward your current floor — physics handles it via `gravityDir`). Punch direction stays world-relative — `facing` continues to map ±x and the fist visual continues to extend horizontally. Render rotates the stick figure 180° when `surface === 'ceiling'` (one extra branch in `drawStickOnSurface` near `game.js:557-564`).

**Cat/mouse interaction.** Opponent climbing wall: unchanged, since wall surfaces are gravity-flip-immune. Opponent on floor when flip fires: snaps to `ceiling` surface, falls upward. The "cornered → climb wall" branch (`game.js:362-371`) still works post-flip — flee horizontally, hit wall, climb. Climbing direction stays `vy = -EVASION_SPEED` because climbing means "away from current floor," which is now upward in screen space when `gravityDir = -1`. Generalisation: `opponent.vy = -EVASION_SPEED * gravityDir` makes climb always head away from the active floor. ~1 LOC.
