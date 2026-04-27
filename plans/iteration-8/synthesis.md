# Iteration 8 — Synthesis (DESIGN PIVOT)

The iter-8 reviewer reports were filed against the prior direction (heavy jab, adaptive opponent, animation richness). They are kept on disk for history but **superseded** by a user-issued direction change at iter-8: this game is a **sparring sim, not a combat sim**. Opponent does not punch back; defends with a shield. Gravity will flip periodically. Fighters will run on the walls (4-surface arena). Background will be dynamic. Cat/mouse chase dynamic.

Iter-8 ships the **foundational pivot**. The bigger mechanics (wall-run, gravity flip, dynamic bg) layer in iter 9–11.

---

## Pivot picks (5 changes, ~75 LOC)

1. **Strip opponent attacks** — remove jab/feint/counter-punch state machine, JAB_* and FEINT_* constants, recovery `~` cue, windup `!`, active `====`, feint `!/?` glyphs, `windup` and `windupFacing` poses in `drawStick`.
2. **Add opponent shield** — opponent toggles `'shielding'` ↔ `'open'` on a rhythm. Shielded hits deal 0 damage and bounce the player back. Open hits land normally.
3. **Add evasion** — opponent runs *away from* the player when in range, breaking line. Cat/mouse beat: player chases, opponent flees, occasionally drops shield to taunt.
4. **Remove counter-punch bonus** — `opponent.state === 'recovery'` no longer exists; counter logic in punch/uppercut/divepunch resolution becomes dead. Remove the bonus-damage branch entirely (single damage value per attack).
5. **Reset HUD** — remove the windup-color glyphs from render. Add a small SHIELD indicator over opponent's head when shielding (e.g. `[+]` or `(+)`).

---

## 1 — Strip opponent attacks

**What.** Remove all opponent-offensive state machine code paths.

**Why.** User pivot: this is a sparring sim. Opponent should not be capable of dealing damage.

**Where.** `game.js`:
- Remove constants: `JAB_RANGE`, `JAB_WINDUP`, `JAB_ACTIVE`, `JAB_RECOVERY`, `JAB_COOLDOWN`, `JAB_DAMAGE`, `JAB_REACH`, `JAB_HIT_TOL`, `CROUCH_HURTBOX_DROP`, `FEINT_CHANCE`, `FEINT_TRIGGER_RATIO`, `FEINT_DURATION`.
- Remove `opponent.feintRoll` field; rename `opponent.state` value set from `{idle, windup, active, recovery, feint}` to `{idle, shielding, open}` (see Change 2).
- Remove `opponent.jabHit` field.
- Remove the entire windup/active/recovery/feint state-machine branch in `update()`.
- Remove the `!`, `!?`, `~`, `====` render branches in `render()` for opponent state.
- Remove `windup`/`windupFacing` opts in `drawStick`.

**Spec.**

After Change 2 has defined the new constants and state names, the old state machine block (currently the four `if/else if` over `windup/active/recovery/feint`) is replaced by Change 2's shield rhythm.

The crouch-hurtbox-drop is no longer used (no opponent attack to dodge). Remove `CROUCH_HURTBOX_DROP` and the `drop` calculation. Crouch can stay as a pose / commitment for the uppercut launch — it has no defensive purpose now. Player crouching just zeroes vx and locks into uppercut.

The `'recovery'` state literal also disappears, so the counter-bonus in player punch / uppercut / divepunch resolution becomes dead — remove the `counter` branch (Change 4).

**Test in head.** Opponent walks the patrol band but never windups, never `!` glyph, never deals damage on contact (contact damage stays — see Change 3 for whether to keep). Player can walk up and punch without ever being threatened by an attack.

**LOC.** ~25 net (mostly deletions).

---

## 2 — Opponent shield (rhythm)

**What.** Opponent has two states that cycle on a rhythm: `'open'` (vulnerable, takes damage) and `'shielding'` (no damage, hits bounce player back). Plus existing `'idle'` for walking patrol.

**Why.** Sparring core. Player must time hits for `'open'` window. When opponent is `'shielding'`, the player needs to be fast / move differently.

**Where.** `game.js`: opponent state machine block (replaces the old jab/feint state machine).

**Spec.**

New constants:
```
const SHIELD_OPEN = 0.6;       // s — vulnerable window
const SHIELD_CLOSED = 1.4;     // s — protected window
const SHIELD_BOUNCE = 360;     // px/s knockback when player hits the shield
const EVASION_RANGE = 90;      // px — opponent flees when player closer than this
const EVASION_SPEED = 130;     // px/s — opponent's flee speed (faster than walk)
```

Replace `opponent.state` initial value to `'open'` (or `'shielding'`, doesn't matter — `stateTimer` drives the cycle).

Replace the entire windup/active/recovery/feint block with:
```js
if (opponent.stateTimer > 0) opponent.stateTimer = Math.max(0, opponent.stateTimer - dt);

if (opponent.state === 'open') {
  if (opponent.stateTimer <= 0) {
    opponent.state = 'shielding';
    opponent.stateTimer = SHIELD_CLOSED;
  }
} else if (opponent.state === 'shielding') {
  if (opponent.stateTimer <= 0) {
    opponent.state = 'open';
    opponent.stateTimer = SHIELD_OPEN;
  }
}
```

The opponent always cycles between open (0.6s) and shielding (1.4s), regardless of patrol state.

**Hit interaction**: in player's punch / uppercut / divepunch hit-test, after the geometric hit check passes, branch on opponent state:
- If `state === 'shielding'`: bounce. Set `player.knockbackVx = -SHIELD_BOUNCE * facing`, set hitstop to a smaller value (e.g. `HITSTOP_DURATION * 0.5`), set `opponent.hitFlash = HIT_FLASH_DURATION` briefly (visual feedback). **Do NOT** decrement `opponent.hp`. Do NOT increment `punchesLanded`.
- If `state === 'open'`: normal hit. Damage as usual. Set `opponent.hitFlash`, knockback, hitstop, increment `punchesLanded`. Set `opponent.state = 'shielding'` after a hit (you broke through, opponent shields up to recover) and `opponent.stateTimer = SHIELD_CLOSED`.

**Render.** Add a shield glyph over opponent's head when shielding:
```js
if (opponent.state === 'shielding') {
  ctx.fillStyle = '#88ccee';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('(+)', opponent.x, opponent.y - 78);
}
```

**LOC.** ~25.

---

## 3 — Evasion (cat/mouse)

**What.** When the player is within `EVASION_RANGE`, the opponent runs *away* from the player at `EVASION_SPEED` (faster than its patrol speed). Replaces or augments the patrol step.

**Why.** Sparring dynamic — cat hunting a rat. The opponent should not stand still and wait to be punched. Combined with shielding, the player must close gaps and time the open window.

**Where.** `game.js`: opponent idle/movement block (now simplified after Change 1).

**Spec.**

In `update()`, after the shield state machine ticks, the opponent's horizontal movement:
```js
if (!knockbackActive) {
  const dxToPlayer = player.x - opponent.x;
  const dist = Math.abs(dxToPlayer);
  if (dist < EVASION_RANGE && opponent.hp > 0 && player.hp > 0) {
    // Cat-and-mouse: flee from player
    const fleeDir = dxToPlayer > 0 ? -1 : 1;
    opponent.x += fleeDir * EVASION_SPEED * dt;
    opponent.patrolDir = fleeDir;  // sync for any visual cue
  } else {
    // Default patrol
    opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
    if (opponent.x <= opponent.patrolMin) {
      opponent.x = opponent.patrolMin;
      opponent.patrolDir = 1;
    } else if (opponent.x >= opponent.patrolMax) {
      opponent.x = opponent.patrolMax;
      opponent.patrolDir = -1;
    }
  }
}
```

The patrolMin/patrolMax bounds still clamp; with EVASION_RANGE=90 and patrolMax=800, the opponent backs into the wall when player closes from the right — exactly what we want for "trapped against the wall, must commit to open frames" tension.

**LOC.** ~10.

---

## 4 — Remove counter-punch bonus

**What.** Drop the `counter = opponent.state === 'recovery'` branch from all three player attack resolutions (punch, uppercut, divepunch).

**Why.** `'recovery'` no longer exists. Code is dead. Single damage value per attack — sparring is about timing the *open* window, not a recovery punish.

**Where.** Three branches in `update()`:
- Standing punch hit-resolution
- Uppercut hit-resolution
- Divepunch hit-resolution

**Spec.**

Replace each `const counter = ...; const dmg = counter ? ... : ...; const knockback = (counter ? 540 : 360) * facing;` block with the non-counter values:
- Punch: 8 dmg, 360 knockback, normal hitstop.
- Uppercut: 10 dmg, 480 knockback, normal hitstop.
- Divepunch: 9 dmg, 420 knockback, normal hitstop.

KO hitstop doubling (`opponent.hp <= 0 ? *2 : *1`) is preserved.

**LOC.** ~10 (deletions, simplifications).

---

## 5 — Render cleanup

**What.** Remove obsolete render blocks (windup, active, recovery, feint glyphs and poses). Add the shield indicator from Change 2.

**Why.** No more attack states to telegraph.

**Where.** `render()` — the four `if (opponent.state === 'windup' / 'active' / 'recovery' / 'feint')` blocks.

**Spec.** Delete those four blocks. Add the shield indicator from Change 2. The opponent's `drawStick` call no longer passes `windup` or `windupFacing`.

**LOC.** ~5 (net negative; deletions + new shield render).

---

## Total LOC

| # | Change | LOC |
|---|---|---|
| 1 | Strip opponent attacks | ~25 (mostly deletions) |
| 2 | Shield rhythm | ~25 |
| 3 | Evasion | ~10 |
| 4 | Remove counter-punch | ~10 (deletions) |
| 5 | Render cleanup | ~5 (deletions + shield glyph) |
| **Total** | | **~75 LOC** |

---

## Deferred (queued for iter 9–15)

- **Wall-run / 4-surface arena (iter 9):** fighters can stick to and run on the side walls and ceiling. Likely uses surface-relative gravity and a "current surface" enum on each fighter. Largest mechanical change in the queue.
- **Gravity flip (iter 10):** every N seconds (or triggered by a meter), gravity inverts. Fighters fall up, ceiling becomes floor. Composes with wall-run if shipped first (the "current surface" enum is already there).
- **Dynamic background (iter 11):** parallax dots or color washes, palette shifts during gravity flips, pulse with hits. Pure render.
- **Cat/mouse polish (iter 12+):** opponent strategy refinements — fake openings, retreat-during-shield, wall-stick when cornered.
- **Tuning iterations (iter 13–15):** pacing the shield rhythm, evasion thresholds, gravity flip cadence.

The previous iter-8 inspiration agent's heavy-jab proposal, adaptive opponent, and crouch chamber pose are now **discarded** — they presumed a combat-sim direction that's been superseded. Their reports remain on disk in `plans/iteration-8/` for history.
