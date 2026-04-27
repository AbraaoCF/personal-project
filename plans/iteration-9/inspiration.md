# Iteration 9 — Inspiration: Wall-Run / 4-Surface Arena

The arena has four bounded surfaces — floor (`GROUND_Y`), ceiling (~`y=24`), left wall (`x=ARENA_LEFT`), right wall (`x=ARENA_RIGHT`). Fighters must traverse all four. They do **not** pass through; they cling, climb, run.

Each fighter gains a `surface` enum (`'floor' | 'left' | 'right' | 'ceiling'`). Gravity vector and the player's "right/left/up/down" verbs rotate with surface. This same enum is what iter-10 (gravity flip) needs — flipping = swap floor↔ceiling on a global level, fighters re-resolve which surface they're on.

Below: 5 inspirations ranked by fit to current code. The synthesis agent will pick 3–4 to ship under 50 LOC.

---

## 1 — Mega Man X wall-slide → wall-jump

**Inspiring game.** *Mega Man X* (1993). Touching a wall mid-air pins you; you slide down slowly; pressing jump again rockets you off the wall in a fixed arc.

**Trigger.** Player is airborne (`!onGround`), `vx` carries them into a side wall (`x` clamps against `ARENA_LEFT+16` or `ARENA_RIGHT-16`), and `vy >= 0` (descending or peak). Auto-stick: `surface = 'left'` or `'right'`. No input needed — collision *is* the trigger, like X.

**Mechanic.**
- While stuck: gravity rotates so it pulls *down the wall* (wall-relative `+y` axis). `vy` is clamped to a slow slide (e.g. `WALL_SLIDE_VY = 120`).
- Player's "left/right" inputs become "up/down the wall" — they can climb up against the slide, or accelerate the slide.
- Jump key (`W` / `↑`) launches off: `vx = -surfaceNormal * WALL_JUMP_VX` (e.g. 360), `vy = JUMP_VELOCITY` (existing), `surface = 'floor'` again. Fighter detaches.
- Reaching the floor (`y >= GROUND_Y`) auto-detaches.

**Reward.** Vertical mobility. Player corners the fleeing opponent: chase opponent into the wall, push off, land a divepunch on the way down. Wall-jumps zero out `whiffLock`, refreshing aerials.

**LOC.** ~18 (surface stick + slide physics + wall-jump).

---

## 2 — Super Meat Boy wall-climb (held)

**Inspiring game.** *Super Meat Boy* (2010). Hold direction *into* the wall to stick instead of slide; release to let go.

**Trigger.** Same as #1 (airborne contact), but with a held-input gate: `keys.has('a')` against the left wall (or `'d'` against the right) sets `surface = 'left'/'right'`. Releasing the held direction → fighter detaches and falls.

**Mechanic.**
- While held: `vy = 0`, fighter sits motionless on the wall — a perched sniper pose.
- Vertical input (`W/S`) crawls up/down the wall at ~half walk speed.
- Punch direction stays *horizontal in screen space* — when on the right wall, punch goes leftward (toward the arena center). The fist `x` offset becomes a `y` offset in wall-relative space; we normalize in render via the surface enum.

**Reward.** A hold-to-camp option. Lets the player wait out the opponent's `'shielding'` window from a wall perch, then jump-punch on the next `'open'`. Compare to #1: #1 is kinetic (slide-and-jump), #2 is patient (perch-and-pounce).

**LOC.** ~15 if combined with #1's stick logic (shared surface enum).

---

## 3 — VVVVVV gravity flip → 4-surface generalization

**Inspiring game.** *VVVVVV* (2010). Pressing one key flips gravity; the player falls upward until hitting the ceiling, which becomes a floor. *N++* extends this to all four surfaces with momentum-preserving wall-runs.

**Trigger.** Conceptual: this is the *abstraction* that unifies floor/wall/ceiling. We don't ship the flip key (that's iter-10) — but we ship the abstraction now. **Each fighter has `surface`**, and:
- `'floor'`: gravity = +y, walk axis = x, jump axis = -y. (Current behavior.)
- `'ceiling'`: gravity = -y, walk axis = x (but reversed input: A goes right in screen-space when upside down? See note), jump axis = +y.
- `'left'` wall: gravity = +x (pulls toward wall), walk axis = y, jump axis = -x.
- `'right'` wall: gravity = -x, walk axis = y, jump axis = +x.

**Mechanic.**
- Movement code transforms input → surface-relative axes via a 2x2 rotation table keyed on `surface`. ~6 lines of dispatch.
- A fighter "walks" along their current surface until they hit a corner, at which point they can transition (or fall off if they jumped).
- **Ceiling locomotion ("walk left while on ceiling")**: A/D map to *the same screen-space direction* as on the floor — so player intuition stays. The fighter renders upside-down (sprite flipped vertically). This is N++'s convention; VVVVVV inverts inputs, which feels worse for a beat-em-up.

**Reward.** Vocabulary unification. Once iter-10 gravity-flip ships, "ceiling" is just "floor with gravity flipped." Once iter-9 wall-run ships, "wall" is just "floor rotated 90°." The whole game generalizes to *the fighter is on **a** surface, walks **along** it, jumps **off** it*. This is the load-bearing abstraction for iter 10–15.

**LOC.** ~12 for the rotation table + axis dispatch (assumes #1 and/or #2 ship the surface enum).

---

## 4 — Celeste corner-grab → ceiling traversal

**Inspiring game.** *Celeste* (2018). Reaching the top of a wall lets you grab the corner and pull onto the next surface.

**Trigger.** Fighter is wall-stuck (`surface = 'left'` or `'right'`), climbs to `y < 40` (near top of wall), and presses jump — they "wrap" onto the ceiling: `surface = 'ceiling'`, `y` snaps to ~24, `x` keeps moving inward.

**Mechanic.**
- On ceiling: fighter renders upside-down (`drawStick` gets a `flipY` opt — ~5 LOC of `ctx.scale(1, -1)` around the existing draw).
- Walk axis: A/D move along ceiling. Jump axis: drop down (`vy` becomes `+JUMP_VELOCITY/2`, `surface = 'floor'`, falls under gravity normally).
- A fighter can also walk off the edge of the ceiling at `x = ARENA_LEFT+16` and re-stick to the left wall — full clockwise traversal of the arena.

**Reward.** True 4-surface traversal. The ceiling is reachable, defendable, attackable. Player can drop divepunch *down* onto the opponent from directly above. Cat/mouse opponent can flee onto the ceiling — but it traps itself in a corner there.

**LOC.** ~14 (corner-wrap transition + ceiling clamp + drawStick flipY).

---

## 5 — N++ wall-run momentum (held jump along wall)

**Inspiring game.** *N++* (2015). Run into a wall while holding jump → you run *up* the wall for a short burst before gravity reasserts.

**Trigger.** Player is grounded, holding jump (`W` / `↑`), running at full `WALL_SPEED` into a side wall.

**Mechanic.**
- On wall contact, convert horizontal momentum to vertical: `vy = -|vx| * 0.8`, `vx = 0`, `surface = 'left'/'right'`.
- The fighter slides *up* the wall (existing wall-stick from #1, but with negative initial `vy`).
- Apex: `vy` decays to 0 via wall-relative gravity, then becomes positive (slide down). Player can jump off at the apex for max height.

**Reward.** A skill expression — players who time A→W→wall combo get higher launches than a flat jump (peak ≈ JUMP_VELOCITY + WALL_SPEED conversion, roughly 50% more height). Lets the player surprise-attack the ceiling-fleeing opponent.

**LOC.** ~6 if #1 (wall-stick) is already shipped — just the momentum-to-vy conversion line and a held-jump check.

---

## Cat/mouse opponent on 4 surfaces

The opponent currently flees horizontally within `EVASION_RANGE`. Spec extension:

- Add `opponent.surface` (default `'floor'`).
- Evasion: when player closes within range, if the opponent is at `patrolMin/Max` (cornered horizontally), it **wall-sticks** onto the adjacent wall and starts climbing. `opponent.surface = 'left'` or `'right'`, `vy_relative = -EVASION_SPEED`.
- On the wall, the opponent climbs to ~mid-height and resumes shield-rhythm patrol (`patrolMin = 100, patrolMax = H - 100` along the wall's y-axis).
- If the player wall-jumps onto the same wall, the opponent corner-wraps onto the ceiling (Celeste-style).
- This gives the player a real chase: floor-only opponents are trivial to corner; 4-surface opponents force the player to track them through wraps.

**LOC.** ~10 (extend the evasion branch with a surface-transition check at corners).

---

## Surface enum spec (load-bearing)

Add to player and opponent:
```
surface: 'floor' | 'left' | 'right' | 'ceiling'  // default 'floor'
```

Helper (~6 LOC):
```js
const SURFACE_AXES = {
  floor:   { walk:[1,0], jump:[0,-1], gravityDir:[0,1] },
  ceiling: { walk:[1,0], jump:[0,1],  gravityDir:[0,-1] },
  left:    { walk:[0,1], jump:[1,0],  gravityDir:[-1,0] }, // gravity pulls into wall (sticks)
  right:   { walk:[0,1], jump:[-1,0], gravityDir:[1,0] },
};
```

This table is what iter-10 (gravity flip) reads from to know which way is "down." It's also what the render layer uses to decide stick-figure rotation/flip.

---

## Player verb re-expression cheatsheet

| Verb | Floor | Left wall | Right wall | Ceiling |
|---|---|---|---|---|
| Walk A/D | x ± WALK_SPEED | y ± WALK_SPEED (A=up, D=down per N++ convention) | y ± WALK_SPEED (A=down, D=up) | x ± WALK_SPEED (mirrored sprite) |
| Jump W | vy = JUMP_VELOCITY | vx = +JUMP_VELOCITY (push off into arena) | vx = -JUMP_VELOCITY | vy = -JUMP_VELOCITY (drop) |
| Crouch S | crouch pose | press into wall (alt: detach) | same | crouch pose (upside-down) |
| Punch J | fist along facing | fist toward arena center | fist toward arena center | fist along facing |
| Divepunch | air J descending | airborne diagonal from wall | mirror | airborne descending = upward in world! |

The facing direction becomes "along the surface's walk axis" — the surface enum normalizes everything.

---

## LOC budget summary (≤50 total)

| # | Mechanic | LOC | Priority |
|---|---|---|---|
| Surface enum + axes table | scaffolding | ~8 | required |
| 1 — Mega Man X wall-slide + jump | core verb | ~18 | recommend |
| 2 — Meat Boy hold-stick | alt verb | ~6 (additive on #1) | optional |
| 4 — Celeste corner-wrap → ceiling | 4th surface | ~14 | recommend |
| 5 — N++ wall-run momentum | flair | ~4 (additive) | optional |
| Cat/mouse opponent surface | AI | ~10 | recommend |
| 3 — Gravity flip abstraction | (deferred to iter-10) | 0 | covered by enum |

**Recommended ship: enum scaffold + #1 + #4 + cat/mouse extension ≈ 50 LOC.** Defer #2/#5 to iter-12+ polish. #3's abstraction lands "for free" via the surface enum.

The 50-LOC ceiling is tight; the synthesis agent should consider cutting #4 if cat/mouse blows the budget — wall-stick + wall-jump on side walls alone is already a compelling iter-9 with the ceiling as a deferred iter-10 deliverable that rides on the gravity-flip change.
