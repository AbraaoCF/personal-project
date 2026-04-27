# Iteration 1 — Synthesis

Three changes selected: one foundational smoothness fix, one playtest fix, one gameplay seed. All within ~70 LOC total. Frame-rate independence is **deferred** with a justification at the bottom — taking it now would force every later iteration to rebalance its constants.

---

## Change A — Edge-trigger the punch + fix the dishonest hitbox

**What.** Replace held-fire punch with a fresh-press trigger, and shrink `PUNCH_REACH` from 70 to match the visible fist (~38), widening the vertical window slightly so head-height contact still works.

**Why.** Playtest §"Top frustrations" #2 and #6: the fist visibly draws at `x ± (8 + ~26 of '====')` but registers at `x ± 70` with 40px slop, so the player misses point-blank and connects at empty air. Smoothness #8 also flags `keys.has('j')` auto-firing every cooldown reset. Single edit kills two complaints and is a prerequisite for the animated punch in iteration 2.

**Where.** `game.js`:
- Constant block (line 50): `PUNCH_REACH`
- `update()` punch block (lines 129–143): change input gate; tweak hitbox math.

**Spec.**
- Change `const PUNCH_REACH = 70;` to `const PUNCH_REACH = 38;`. (Fist `====` at 20px font ≈ 32px wide drawn from `x + facing*8` outward; 38 puts the hitbox center at the visible fist tip.)
- Change `const wantPunch = keys.has('j') || keys.has(' ');` to `const wantPunch = keysPressed.has('j') || keysPressed.has(' ');`.
- In the hit test `Math.abs(fistX - opponent.x) < 40`: change tolerance from `40` to `28`. (Tighter window matches narrower reach; total horizontal hit window is now ~56px wide instead of 80px, still forgiving.)
- Leave vertical window `fistY > opponent.y - 65 && fistY < opponent.y - 5` untouched — it already works on the ground, and we are not touching jump this iteration.
- Do **not** alter `PUNCH_DAMAGE`, `PUNCH_COOLDOWN_FRAMES`, or `PUNCH_DURATION`. Balance stays so the change is felt-quality only.

**Test in head.** Read the diff: `wantPunch` now sources from `keysPressed`, so holding J after the first press does nothing until release+repress (no autofire). With `PUNCH_REACH=38` and tolerance `28`, the visible `====` glyph (drawn from `x + facing*8` to `x + facing*~40`) overlaps the opponent stick (`O` at center) precisely when a hit registers. Standing on the opponent (`Math.abs(0 - 38) = 38 > 28`) still misses, but visually walking up so the fist overlaps the body now connects.

---

## Change B — Velocity easing on the player

**What.** Lerp `player.vx` toward the target walk velocity instead of snapping, so direction changes and stops feel responsive but not rigid.

**Why.** Smoothness #2 (high impact). Four-line change, transforms felt locomotion immediately, doesn't depend on the deferred dt rewrite (still expressed per-frame), and won't conflict with a later dt pass since the lerp factor is dimensionless.

**Where.** `game.js` `update()` lines 103–107.

**Spec.**
- Replace:
  ```
  player.vx = move * WALK_SPEED;
  player.x += player.vx;
  ```
  with:
  ```
  const targetVx = move * WALK_SPEED;
  const VX_LERP = 0.25;          // ~90% of target in ~9 frames
  player.vx += (targetVx - player.vx) * VX_LERP;
  if (Math.abs(player.vx) < 0.05) player.vx = 0;   // dead-zone, prevents float drift
  player.x += player.vx;
  ```
- Keep `if (move !== 0) player.facing = move;` exactly as-is. Facing should still flip on input intent, not on velocity sign — otherwise punching while decelerating could face the wrong way.
- Wall clamp on line 109 stays unchanged. When clamped, also zero `player.vx` so easing doesn't accumulate against a wall:
  - After `player.x = Math.max(...)` add `if (player.x === ARENA_LEFT + 16 || player.x === ARENA_RIGHT - 16) player.vx = 0;`

**Test in head.** Diff shows `player.vx` is now stateful across frames. Tapping D for one frame produces ~0.8px of motion that decays over ~5 frames instead of a single 3.2px step. Holding D reaches steady 3.2 in ~9 frames. Releasing D coasts to a stop in ~9 frames. Reversing direction (D→A) no longer teleport-flips; the figure decelerates and reaccelerates through 0.

---

## Change C — Player HP + opponent contact damage (gameplay seed)

**What.** Give the player HP and a left-side HP bar, and have the opponent deal contact damage when its body overlaps the player's body. No new opponent attack state — just spatial pressure. Adds a lose condition.

**Why.** Inspiration §"Bottom line" of playtest: the game has no failure state, no opponent threat, no collision. This is the smallest possible move toward a real fight: the patrolling opponent already walks toward the player; making contact hurt instantly turns "patrol" from decoration into a soft pressure mechanic and unlocks ideas #1, #2, #5 from the inspiration report in later iterations. Punch knockback already exists, so contact damage gets natural negative feedback (you punch, they get pushed off, contact stops).

**Where.** `game.js`:
- `player` object (lines 30–38): add HP fields.
- `resetMatch()` (line 59): reset HP.
- `update()` end (around line 162, before `if (opponent.hp <= 0)`): add contact check + lose check.
- `drawHpBar()` (lines 226–240): draw a mirrored player bar on the left.
- `toGameOver()` (line 84): include result in the stats line.

**Spec.**
- Add to `player` literal: `hp: 100, maxHp: 100, hitFlash: 0, contactCooldown: 0,`.
- In `resetMatch()`: `player.hp = player.maxHp; player.hitFlash = 0; player.contactCooldown = 0;`.
- New constant near other constants: `const CONTACT_DAMAGE = 4; const CONTACT_COOLDOWN_FRAMES = 30;`.
- In `update()`, after the patrol/knockback block and before `if (opponent.hp <= 0)`:
  ```
  if (player.contactCooldown > 0) player.contactCooldown--;
  if (player.hitFlash > 0) player.hitFlash--;
  const dx = Math.abs(player.x - opponent.x);
  if (dx < 22 && player.contactCooldown === 0 && opponent.hp > 0) {
      player.hp = Math.max(0, player.hp - CONTACT_DAMAGE);
      player.hitFlash = 8;
      player.contactCooldown = CONTACT_COOLDOWN_FRAMES;
      // shove player away so contact breaks
      player.vx = -6 * (opponent.x > player.x ? 1 : -1);
  }
  if (player.hp <= 0) toGameOver();
  ```
  Place this **before** the existing `if (opponent.hp <= 0) toGameOver();` so opponent-KO still wins the tie.
- Generalize `drawHpBar()` to accept `(label, hp, maxHp, side)` where `side === 'left'` anchors at `WALL_THICKNESS + 12` and `side === 'right'` keeps the existing right-side anchor. Call it twice in `render()`:
  - `drawHpBar('YOU', player.hp, player.maxHp, 'left')`
  - `drawHpBar('OPPONENT', opponent.hp, opponent.maxHp, 'right')`
- Tint the player stick on hit: in `render()` change `color: '#9ad9ff'` to `color: player.hitFlash > 0 ? '#ff8888' : '#9ad9ff'`.
- In `toGameOver()`, prefix the stats string with the result:
  ```
  const result = opponent.hp <= 0 ? 'VICTORY' : 'DEFEAT';
  document.getElementById('gameover-stats').textContent =
      `${result}  -  Punches thrown: ${player.punchAttempts}  (landed: ${player.punchesLanded})`;
  ```
- Edge cases:
  - Knockback already moves opponent away on a successful punch, naturally breaking contact — no extra logic needed.
  - The `player.vx = -6 * ...` shove rides on top of Change B's lerp (target is still input-driven); the impulse decays out via the lerp toward the input target, no special-case code required.
  - `dx < 22` chosen because each stick figure's torso is `/|\` at 20px font ≈ 18px wide; 22 is "shoulders touching."
  - Keep CONTACT_DAMAGE=4 (25 contacts to KO at 0.5s/contact = 12.5s of pure overlap). Player-KO is achievable but requires the player to ignore the opponent for ~12s. Iteration 1 should not be brutally hard.

**Test in head.** Diff shows `player.hp`/`player.maxHp` defined and reset, two HP bar calls in `render()`, and a contact block before the win check. Walking into the opponent and standing still: player tints red every 30 frames, HP bar drains in 4-pt ticks, eventually `toGameOver()` fires with `DEFEAT`. Punching the opponent normally: knockback shoves them, dx exceeds 22, contact damage stops. K.O.-ing the opponent first still shows `VICTORY`.

---

## Deferred

- **Frame-rate independence (smoothness #1).** Highest single-issue impact, but converting every velocity, gravity, knockback, cooldown, and timer to dt-scaled units is a 60+ LOC sweeping change that touches nearly every constant and would force re-tuning of every value the playtest reasoned about. Better as iteration 2 once we know which constants survive iteration 1's rebalancing. Risk-managed by keeping new constants (`VX_LERP`, `CONTACT_COOLDOWN_FRAMES`) small and easily-rescaled.
- **Animated punch with windup/extend/retract (smoothness #3).** Wants the edge-trigger fix from Change A as a foundation; once a punch is one-press-one-swing, animating across `t = punchTimer/PUNCH_DURATION` is a natural iteration 2 follow-up.
- **Telegraphed opponent jab (inspiration #1).** The marquee gameplay change, but it depends on player HP existing (Change C ships that) and benefits from animated punches/wind-ups (deferred above). Slot for iteration 3 once both prerequisites land.
- **K.O. pause + animation (playtest §K.O.).** Real fix, but requires a new state (or a freeze timer) and risks adding the "unfinished state" the orchestrator warned about. Park until we have a polish pass.
