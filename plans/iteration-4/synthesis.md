# Iteration 4 — Synthesis

Combat is a 6.4 s walk-up-and-hold-J. Keystone (telegraphed jab + crouch) is the headline.

**Picks (5):**
1. Telegraphed opponent jab + player crouch (KEYSTONE) — ~45 LOC
2. Counter-punch bonus damage in opponent recovery — ~8 LOC
3. BUG: `opponent.hp > 0` guard on punch hit-test — 1 LOC (folded into Pick 2)
4. CHORE: Remove dead wall-shove branch — -5 LOC
5. HUD reposition + HP-bar damage-tail — ~12 LOC

**Total: ~60 LOC.** Under the 80-LOC cap. Single smoothness pick selected (HP tail composes with bigger jab damage). Patrol easing, subpixel snap, punch-deadzone fix deferred.

---

## 1 — KEYSTONE: Telegraphed opponent jab + player crouch

**What.** Opponent gains a four-state attack machine (idle → windup → active → recovery) that throws a readable jab in range; player gains a held crouch that drops their hurtbox so the jab whiffs over them.

**Why.** Inspiration #1. No mid-range threat = no rhythm. A 0.5 s telegraph + 0.12 s active forces the player to *react*. Crouch is the answer (jump can't connect — playtest 6.2). Converts "hold J" into "read tell, dodge, counter."

**Where.** `game.js`: constants after line 69; `opponent` literal 45–53; `player` literal 31–43; `resetMatch()` 71–85; `update(dt)` (new AI block replacing 182–190, crouch input after 134); `drawStick` 256–293; `render()` 328–357.

### Spec

**New constants** (add near line 69):
```
const JAB_RANGE = 80;            // px — distance from player at which opponent considers jab
const JAB_WINDUP = 0.5;          // s — telegraph duration (long, readable)
const JAB_ACTIVE = 0.12;         // s — active hit frames
const JAB_RECOVERY = 0.35;       // s — punish window after whiff (also after hit)
const JAB_COOLDOWN = 1.2;        // s — between attacks (idle phase after recovery)
const JAB_DAMAGE = 12;
const JAB_REACH = 32;            // px — opponent fist offset from opponent.x
const JAB_HIT_TOL = 28;          // px — |fistX - player.x| tolerance, mirrors player punch
const CROUCH_HURTBOX_DROP = 16;  // px — how much the player's hit band drops when crouching
```

**Opponent state fields** (add to `opponent` literal):
```
state: 'idle',        // 'idle' | 'windup' | 'active' | 'recovery'
stateTimer: 0,        // s remaining in current state (0 = idle, decrement only)
jabHit: false,        // set true once an active jab connects this swing (prevents multi-tick)
```

**Player field** (add to `player` literal): `crouching: false`.

**`resetMatch()` additions:**
```
opponent.state = 'idle';
opponent.stateTimer = 0;
opponent.jabHit = false;
player.crouching = false;
```

**Crouch input** — insert after line 134 (after the wall-clamp), before jump check:
```
player.crouching = player.onGround && (keys.has('s') || keys.has('arrowdown'));
if (player.crouching) {
  // Crouch zeroes horizontal velocity and forbids jump (commit cost)
  player.vx = 0;
}
```
Then gate the existing jump line 137 with `&& !player.crouching` so crouch suppresses jump. Crouch is a *state* (held), not an impulse — releasing the key returns to standing automatically.

**Opponent AI block** — replace `else` patrol branch (lines 182–190) with the state machine. Knockback branch (178–181) stays exclusive; getting punched cancels state to idle (handled in punch-connect, see below).

```
} else {
  // Tick state timer
  if (opponent.stateTimer > 0) opponent.stateTimer = Math.max(0, opponent.stateTimer - dt);

  if (opponent.state === 'idle') {
    // Patrol
    opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
    if (opponent.x <= opponent.patrolMin) { opponent.x = opponent.patrolMin; opponent.patrolDir = 1; }
    else if (opponent.x >= opponent.patrolMax) { opponent.x = opponent.patrolMax; opponent.patrolDir = -1; }
    // Trigger jab if in range and cooldown elapsed
    const dx = Math.abs(player.x - opponent.x);
    if (dx < JAB_RANGE && dx > CONTACT_RANGE && opponent.stateTimer <= 0 && opponent.hp > 0 && player.hp > 0) {
      opponent.state = 'windup';
      opponent.stateTimer = JAB_WINDUP;
      opponent.jabHit = false;
    }
  } else if (opponent.state === 'windup') {
    // Stationary during telegraph
    if (opponent.stateTimer <= 0) {
      opponent.state = 'active';
      opponent.stateTimer = JAB_ACTIVE;
    }
  } else if (opponent.state === 'active') {
    // Stationary; hit-test each frame.
    // Player hurtbox: y-65 .. y-5 (matches player punch band). Crouch shifts band DOWN by 16 → y-49 .. y+11.
    // Opponent's fist at y-50 (same as player). Crouched: -50 < -49 → fist ABOVE new band → whiffs. Correct.
    if (!opponent.jabHit) {
      const oppFacing = player.x < opponent.x ? -1 : 1;
      const fistX = opponent.x + oppFacing * JAB_REACH;
      const fistY = opponent.y - 50;
      const bandHi = player.y - 65 + (player.crouching ? CROUCH_HURTBOX_DROP : 0);
      const bandLo = player.y - 5  + (player.crouching ? CROUCH_HURTBOX_DROP : 0);
      if (Math.abs(fistX - player.x) < JAB_HIT_TOL && fistY > bandHi && fistY < bandLo) {
        player.hp = Math.max(0, player.hp - JAB_DAMAGE);
        player.hitFlash = HIT_FLASH_DURATION;
        player.vx = -360 * oppFacing;  // knockback away from opponent
        hitstop = player.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
        opponent.jabHit = true;
      }
    }
    if (opponent.stateTimer <= 0) {
      opponent.state = 'recovery';
      opponent.stateTimer = JAB_RECOVERY;
    }
  } else if (opponent.state === 'recovery') {
    // Stationary, vulnerable — see Pick 2 for counter-punch bonus
    if (opponent.stateTimer <= 0) {
      opponent.state = 'idle';
      opponent.stateTimer = JAB_COOLDOWN;  // gate before next jab considered
    }
  }
}
```

**Knockback interrupts state.** In the punch-connect block (line 169) where we write `opponent.knockback`, also write:
```
opponent.state = 'idle';
opponent.stateTimer = JAB_COOLDOWN * 0.5;
opponent.jabHit = false;
```
Getting punched cancels any in-flight jab.

**Render — opponent telegraph and fist:**

In `render()` after the existing opponent `drawStick` call (line 344), add:
```
if (opponent.state === 'windup') {
  ctx.fillStyle = '#ffcc66';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('!', opponent.x, opponent.y - 78);
}
if (opponent.state === 'active') {
  const oppFacing = player.x < opponent.x ? -1 : 1;
  ctx.fillStyle = flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.textAlign = oppFacing === 1 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('====', opponent.x + oppFacing * (8 + JAB_REACH), opponent.y - 50);
}
```

Also pass `crouch: player.crouching` into the player's `drawStick` opts.

**`drawStick` crouch pose** — add `crouch = false` to opts destructuring. After font setup, if crouch is true, render compressed pose and return early:
```
if (crouch) {
  ctx.fillText('_O_', x, y - 30);
  ctx.fillText('/|\\', x, y - 12);
  ctx.fillText('/ \\', x, y + 4);
  return;
}
```

**Composes with hitstop.** During `hitstop > 0` the early-return at line 122 freezes the whole update, so opponent state timers do not advance. A player punch landing during opponent windup resets `opponent.state = 'idle'` in the connect block — windup is cancelled, not paused. K.O. hitstop: state irrelevant, `toGameOver()` fires when freeze ends.

**Composes with jump.** Existing jump at line 137 must gate on `&& !player.crouching`.

**Composes with crouch + punch.** Player can crouch-punch (fist still at y-50, in the standard band). Odd but not broken; not gating, since crouch is purely hurtbox/movement.

**Edge cases.**
- Jab range uses `dx > CONTACT_RANGE` so opponent doesn't jab while contact damage handles overlap.
- `player.hp > 0` / `opponent.hp > 0` guards on jab trigger prevent corpse-jabs.
- Windup/active/recovery freeze movement, so no patrol overshoot.
- Jab triggerable at player.x ∈ [400, 560] (JAB_RANGE=80 around opponent's patrol band) — well clear of walls.

### Test in head

- Closing at dx=80, opponent windups; `!` glyph above head, 0.5 s.
- Player presses S → crouch pose. Opponent active, fist `====` draws. Math: fistY = opponent.y - 50; bandHi (with crouch +16) = player.y - 49. fistY = -50 vs bandHi = -49 (relative): `fistY > bandHi` false. Whiff. Recovery 0.35 s opens.
- No-crouch case: bandHi = -65, bandLo = -5; fistY = -50 inside band. If |fistX - player.x| < 28 → hit lands (12 dmg, hitstop, knockback).
- Punch during windup: connect block resets `opponent.state = 'idle'`, glyph clears, fist never extends. Clean.

LOC: ~9 constants + ~3 opp fields + ~2 player/reset + ~5 crouch input + ~30 AI block + ~10 render + ~5 pose ≈ **~45 LOC**.

---

## 2 — Counter-punch bonus in opponent recovery

**What.** Punch landing while opponent is in `recovery` state deals 1.5× damage and stronger knockback.

**Why.** Inspiration #2. Closes the bait→dodge→punish loop opened by Pick 1. Without it, ducking a jab has no payoff — the punish window is real estate the player has earned.

**Where.** `game.js` lines 166–173 (the punch-connect block).

**Spec.** Modify the connect block:
```
if (Math.abs(fistX - opponent.x) < 28 && fistY > opponent.y - 65 && fistY < opponent.y - 5 && opponent.hp > 0) {
  const counter = opponent.state === 'recovery';
  const dmg = counter ? PUNCH_DAMAGE * 1.5 : PUNCH_DAMAGE;  // 12 vs 8
  opponent.hp = Math.max(0, opponent.hp - dmg);
  opponent.hitFlash = HIT_FLASH_DURATION;
  opponent.knockback = (counter ? 540 : 360) * player.facing;
  opponent.state = 'idle';
  opponent.stateTimer = JAB_COOLDOWN * (counter ? 1.0 : 0.5);
  opponent.jabHit = false;
  player.punchesLanded++;
  hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : (counter ? HITSTOP_DURATION * 1.5 : HITSTOP_DURATION);
  player.punchTimer = PUNCH_DURATION * 0.4;
}
```

(The `opponent.hp > 0` guard at the head of the conditional is Pick 3 — folded in here; see next.)

**Test in head.** Player ducks jab → opponent enters recovery (0.35 s window). Player stands, walks forward into PUNCH_REACH, punches. Connect block fires, `counter = true`, deal 12, knockback 540 px/s, hitstop 100 ms (vs normal 67 ms). Felt as a heavier hit. K.O.: 8 normal punches or 9 mixed; or e.g. 6 counters + a normal — fight ends in ~5 jab cycles instead of 13 mashes.

LOC: ~8.

---

## 3 — BUG FIX: `opponent.hp > 0` guard on punch hit-test

**What.** Add `&& opponent.hp > 0` to the punch connect-block conditional.

**Why.** Playtest 6.3 / §7 — without this, mashing J during the K.O. hitstop replays the punch on the dead opponent, re-extending hitstop and inflating `punchesLanded`. Asymmetric with the contact-damage path which already has the guard (line 197).

**Where.** `game.js` line 166. Folded into Pick 2's block above.

**Spec.** Already in Pick 2's modified conditional. 1 effective LOC.

**Test in head.** Punch K.O.s opponent. hp = 0. Player mashes J during the 133 ms hitstop. Buffer survives the freeze (iter-3). First live frame: connect block evaluates, but `opponent.hp > 0` is false, body skipped. `punchAttempts` still increments (intended — they tried), but `punchesLanded` does not, and hitstop is not re-extended. `toGameOver()` fires correctly on the next frame.

---

## 4 — Remove dead wall-shove branch

**What.** Delete the `pinnedLeft || pinnedRight` branch in the contact-damage block (lines 202–209); keep only the mid-arena `player.vx = -360 * sign` path.

**Why.** Playtest §4 / 6.4 — patrol bounds (480..800) vs pin thresholds (40, 860) physically prevent the pin condition. Dead code.

**Justification (chose deletion over widening patrolMax).** Widening patrolMax to ~840 would expose the dx<10 contact range right next to the right wall, degenerating into a wall trap with no escape. The keystone's jab now provides real opponent threat — the wall-shove was the wrong fix. Deletion is net-negative LOC. If iter-5 adds chase AI, re-add then.

**Where.** `game.js` lines 202–209. Replace with:
```
player.vx = -360 * (opponent.x > player.x ? 1 : -1);
```
Net: -5 LOC.

**Test in head.** Walk into opponent mid-arena. Contact fires, player.vx = -360 away, hitstop, flash. Identical to before in every reachable state.

---

## 5 — HUD reposition + HP bar damage-tail

**What.** (a) Move HUD control-hint text below the HP bars. (b) Add a desaturated "tail" fill behind the live HP fill that drains slowly, so damage events read as quantities.

**Why.** Playtest 6.6 — current hint text at y=26 collides with HP bar at y=20–34. 1-LOC fix. Smoothness pick 1 — bar currently snaps; with Pick 2 dealing 12 dmg per counter, snaps are larger and uglier. Tail makes damage legible.

**Where.** `game.js` lines 306–326 (`drawHpBar`), 31–43 / 45–53 (object literals), 71–85 (`resetMatch`), 217 (end of update), 355 (HUD text).

### Spec

**Add fields** to both `player` and `opponent` literals:
```
displayedHp: 100,
damageTailHp: 100,
```

**`resetMatch()` additions:**
```
player.displayedHp = player.maxHp;
player.damageTailHp = player.maxHp;
opponent.displayedHp = opponent.maxHp;
opponent.damageTailHp = opponent.maxHp;
```

**Lerp update** — insert just before `keysPressed.clear()` at line 217:
```
const fast = 1 - Math.pow(1 - 0.4, dt * 60);
const slow = 1 - Math.pow(1 - 0.06, dt * 60);
player.displayedHp += (player.hp - player.displayedHp) * fast;
player.damageTailHp += (player.displayedHp - player.damageTailHp) * slow;
opponent.displayedHp += (opponent.hp - opponent.displayedHp) * fast;
opponent.damageTailHp += (opponent.displayedHp - opponent.damageTailHp) * slow;
```

**`drawHpBar` signature & body** — add two params after `hp`:
```
function drawHpBar(label, hp, maxHp, side, displayedHp, damageTailHp) {
  const w = 240, h = 14, y = 20;
  const x = side === 'left' ? WALL_THICKNESS + 12 : W - WALL_THICKNESS - w - 12;
  ctx.fillStyle = '#333';
  ctx.fillRect(x, y, w, h);
  // Tail (desaturated)
  ctx.fillStyle = '#8a4a4a';
  const tailPct = Math.max(0, Math.min(1, damageTailHp / maxHp));
  if (side === 'left') ctx.fillRect(x + w - w * tailPct, y, w * tailPct, h);
  else ctx.fillRect(x, y, w * tailPct, h);
  // Live fill
  const pct = Math.max(0, Math.min(1, displayedHp / maxHp));
  ctx.fillStyle = pct > 0.5 ? '#6cdc6c' : pct > 0.25 ? '#dccc6c' : '#dc6c6c';
  if (side === 'left') ctx.fillRect(x + w - w * pct, y, w * pct, h);
  else ctx.fillRect(x, y, w * pct, h);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#ccc';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${label}  ${hp}/${maxHp}`, x, y - 4);
}
```
Update call sites (lines 349–350) to pass the extra args.

**HUD text reposition** — change line 355 from `y = 26` to `y = H - 16`:
```
ctx.fillText('A/D walk   W/↑ jump   S/↓ crouch   J / SPACE punch   ESC menu', WALL_THICKNESS + 8, H - 16);
```
(Also adds the new crouch hint inline.)

### Test in head

- 8 dmg punch lands. Hitstop ends; `displayedHp` lerps 100→92 over ~5 frames; `damageTailHp` over ~50 frames. Eye reads "I took ~8" via the desaturated tail.
- Counter-punch (12 dmg): bigger gap, bigger tail.
- HUD now at y = H - 16 (≈524); HP bar at y=20-34 — no overlap.
- K.O.: tail drain hidden behind game-over overlay. Fine.

LOC: 4 fields + 4 reset + 6 lerp + ~4 net in drawHpBar + 1 HUD line + 2 call-sites ≈ **~12 LOC**.

---

## Total LOC

Pick 1 (~45) + Pick 2 (~8, includes Pick 3 guard) + Pick 4 (-5) + Pick 5 (~12) ≈ **~60 LOC.** Under 80-LOC cap. Headroom: if Pick 1's AI lands long, drop HP-tail and keep just HUD reposition (1 LOC).

---

## Deferred

- **Patrol direction easing (smoothness #2, ~5 LOC).** Keystone now holds opponent stationary during windup/active/recovery — already a "thinking" beat. Lower leverage post-keystone. Iter-5.
- **Subpixel render snap (smoothness #3, ~3 LOC).** Cosmetic; budget tight. Iter-5.
- **Aerial divepunch (inspiration #3, ~25 LOC).** Three-way RPS; needs keystone shipped first. Iter-5.
- **Player whiff recovery (inspiration #4, ~15 LOC).** Pick 1 already creates indirect panic-mash punishment (mash → punch cooldown mid-recovery when opponent's active fires). Reassess after iter-4 playtest.
- **Stamina (inspiration #5, ~20 LOC).** Best after more verbs land. Iter-5/6.
- **Punch deadzone fix (28→30, 1 LOC, playtest 6.1).** Keystone changes punch frequency profile; re-evaluate after playtest.
- **No-feedback denied-punch (playtest 6.5), walk leg cycle, player knockback channel.** All cosmetic/texture; bundle with future pose pass or polish iteration.
