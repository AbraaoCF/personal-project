# Iteration 6 — Synthesis

**Selected (5 changes, ~62 LOC budgeted, under the 80 cap):**

1. **CRIT-FIX: separate opponent state machine from knockback gate** (~5 LOC)
2. **Divepunch — keystone air verb** (~30 LOC)
3. **Opponent feint — variance** (~18 LOC)
4. **Walk leg cycle** (~8 LOC, smoothness)
5. **Pulsing recovery `~` glyph** (~4 LOC, smoothness)

Off-balance lean (smoothness pick 3) deferred — divepunch will introduce a landing-lag pose that wants similar primitives, and we'd rather design lean once for both whiffLock and landingLag in iter-7. Rounds and pursuit deferred per orchestrator guidance.

---

## Change 1 — Stand-trade exploit fix (CRIT)

**What.** During opponent's `active` state, the jab hit-check must run regardless of whether `opponent.knockback` was just applied this same frame. Currently the entire opponent state-machine block is gated by `!knockbackActive`, so a player punch landing on the same frame as the opponent's active hit-check causes the active hit-check to be skipped (because the hit set `opponent.knockback`, which made `knockbackActive=true`).

**Why.** Playtest §7 (lines 93–97) — at dx=40 the player deals 8 damage and takes 0; ~13 stand-trades to KO with zero risk. This invalidates whiff-lock's design and crouch-counter's role as the safe play. Highest-priority fix.

**Where.** `game.js:258–312` — restructure the gate.

**Spec.**
- Move the hit-check resolution **out** of the `else` branch under `knockbackActive`. The state-machine ticking *and* the `active`-state hit-check run **every frame** while alive; only the **patrol movement** in the `idle` branch is suppressed during knockback (because the body is being shoved and shouldn't also walk).
- New shape:
  ```
  // ALWAYS: knockback decay if any
  const knockbackActive = Math.abs(opponent.knockback) > 6;
  if (knockbackActive) {
    opponent.x += opponent.knockback * dt;
    opponent.knockback *= Math.pow(0.7, dt * 60);
  } else {
    opponent.knockback = 0;
  }

  // ALWAYS: state machine ticks (timer, hit-check, transitions)
  if (opponent.stateTimer > 0) opponent.stateTimer = Math.max(0, opponent.stateTimer - dt);

  if (opponent.state === 'idle') {
    if (!knockbackActive) {
      // patrol movement — only when not being shoved
      opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
      // ... patrol bounds clamp ...
    }
    // trigger windup — runs even during knockback (rare to matter; opp is being shoved out of range)
    const dxToPlayer = Math.abs(player.x - opponent.x);
    if (dxToPlayer < JAB_RANGE && dxToPlayer > CONTACT_RANGE
        && opponent.stateTimer <= 0 && opponent.hp > 0 && player.hp > 0) {
      opponent.state = 'windup';
      opponent.stateTimer = JAB_WINDUP;
      opponent.jabHit = false;
    }
  } else if (opponent.state === 'windup') { ... }
  else if (opponent.state === 'active') {
    // hit-check ALWAYS runs in active, regardless of knockback
    if (!opponent.jabHit) { ... }
    if (opponent.stateTimer <= 0) { state = 'recovery'; ... }
  } else if (opponent.state === 'recovery') { ... }
  ```
- The order in `update()` is unchanged: player punch fires (line 205) first, possibly setting `opponent.knockback` and `opponent.state='idle'`. If the player's punch landed, the state was reset to `idle` so the active hit-check does not run anyway (it's no longer in the `active` branch). If the player's punch **whiffed** (or hit a non-active opponent), the active hit-check runs unimpeded. **The exploit was: whiff-the-state-reset by setting knockback during active without resetting state — which doesn't actually happen in the current code (player landing punch always sets `state='idle'`).** Re-tracing carefully: the exploit is `wantPunch` fires line 205, hits on line 236, `opponent.state='idle'` set on line 242, **and then** `knockbackActive=true` skips the *entire* state-machine block including the *post-hit* idle's patrol/trigger logic. Net: opponent's active hit-check this frame is skipped because the state is no longer `active`, not because of knockback gating. So the trade is: player landed → opponent state forced to idle → opponent's active branch never ran this frame.
- **Real fix:** the hit-check at line 287 must run **before** the player's punch is allowed to mutate `opponent.state`. Easiest implementation: move the opponent state-machine update to run **before** the player punch resolution (swap order).
- **Final spec:** restructure `update()` so the **opponent state machine block (current 258–312) runs before the player punch resolution (current 205–254)**. Pull only the patrol-suppression into the knockback branch as above; leave the rest untouched. This way:
  - Frame N, opponent in `active`: hit-check resolves first → if it lands, `player.knockbackVx` set, player takes damage, `opponent.jabHit=true`, state advances to recovery on its own timer. **Then** player punch resolves: if player presses J this frame, the punch lands on a `recovery` opponent → 1.5× counter. Trade is now mutual (opponent dealt 12, player deals 12) — **not** free.
  - At dx=40, the player can no longer punch through active without being touched.

**Test in head.**
- Player at dx=40 standing-punches during opp `active` frame: opp hit-check runs first → player.hp -= 12, opp goes to recovery → player punch lands → opp.hp -= 12 (counter 1.5×). Both lose ~12; trade is real.
- Player at dx=40 standing-punches during opp `windup`: opp windup ticks (no hit-check) → player punch lands → opp.hp -= 8, state = idle, knockback applied. No change from before.
- Player at dx=40 standing-punches during opp `recovery`: opp recovery ticks → player punch lands → 1.5× counter. No change from before.
- Knockback alone (no state mutation) no longer skips the state machine. Patrol suppression still happens (we moved that single line into a `!knockbackActive` guard).

**LOC.** ~5: reorder one block (cut/paste), add one `!knockbackActive` guard around patrol movement, remove the wrapping `else` branch around the state machine.

---

## Change 2 — Divepunch (keystone air verb)

**What.** While airborne and descending, J fires a downward-forward divepunch with its own active hit-band and a landing-lag penalty on whiff. Damage 9 (between 8 standing and 10 uppercut).

**Why.** Inspiration #1; three iterations of deferral; jump is currently a trap button that removes your only ranged tool for 0.667s. Divepunch turns jump into a commitment-with-payout.

**Where.** `game.js` — new constants block after line 93; new state fields on `player` (line 31–48); new branch in punch resolution (around line 209); new descent physics in jump branch (around line 186); new render branch in player draw (around line 471) and in `drawStick` (around line 393).

**Spec.**

**New constants** (insert after line 93):
```
const DIVE_VX = 320;                // px/s, forward boost
const DIVE_VY_BOOST = 540;          // px/s, downward kick
const DIVE_DAMAGE = 9;
const DIVE_HIT_TOL = 28;            // px
const DIVE_REACH = 30;              // px (forward fist offset)
const DIVE_FIST_DY = -30;           // fist y offset from player.y (head-height aim)
const LANDING_LAG = 0.4;            // s, on whiffed dive
```

**New player fields** (add to player literal at line 48):
```
diving: false,
landingLag: 0,
diveHit: false,            // resolved-this-dive flag, prevents double-hit per dive
```

Reset in `resetMatch` (line 108 area):
```
player.diving = false;
player.landingLag = 0;
player.diveHit = false;
```

**Trigger logic** (insert in punch-resolution block, near line 205, **before** the existing `if (player.punchBuffer > 0 && ...)` block — divepunch should fire on direct J press while airborne, not via the punchBuffer path which is intended for ground attacks):

```
// Divepunch: fires from descending air on direct J press, bypasses buffer
if ((keysPressed.has('j') || keysPressed.has(' '))
    && !player.onGround && player.vy >= 0
    && !player.diving && player.whiffLock <= 0) {
  player.diving = true;
  player.diveHit = false;
  player.vy = DIVE_VY_BOOST;
  player.vx = DIVE_VX * player.facing;     // hard-set, overrides input lerp this frame
  player.punchAttempts++;
  // Consume the J press so the buffer below doesn't also fire a standing punch when we land.
  keysPressed.delete('j');
  keysPressed.delete(' ');
}
```

**Landing-lag tick** (alongside the other timer decrements at lines 196–200):
```
if (player.landingLag > 0) player.landingLag -= dt;
```

**Movement gating during dive** — divepunch overrides input `vx` for its duration. Modify line 161:
```
if (player.whiffLock > 0 || player.landingLag > 0 || player.diving) move = 0;
```
And after line 165 (`player.x += player.vx * dt;`), if `player.diving`, the lerp toward 0 should be skipped — easiest: don't lerp vx when diving. Replace lines 162–164 with:
```
if (!player.diving) {
  const targetVx = move * WALK_SPEED;
  player.vx += (targetVx - player.vx) * (1 - Math.pow(1 - VX_LERP, dt * 60));
  if (Math.abs(player.vx) < 3) player.vx = 0;
} // else: vx held at DIVE_VX from the trigger
```

**Crouch gating** — line 176, divepunch should not allow crouching mid-air anyway (only fires when `!onGround`). No change needed; crouch already requires `onGround`.

**Jump gating** — line 182 already requires `onGround`. Add `&& player.landingLag <= 0` so post-dive landing can't re-jump instantly:
```
if (wantJump && player.onGround && !player.crouching && player.whiffLock <= 0 && player.landingLag <= 0) { ... }
```

**Punch buffer gating** — line 203, prevent punchBuffer from being set while diving (the dive J press is consumed above, but tap a second J mid-dive shouldn't queue a ground punch for landing):
```
if (wantPunch && player.whiffLock <= 0 && !player.diving && player.landingLag <= 0) player.punchBuffer = PUNCH_BUFFER;
```

**Punch buffer fire gating** — line 205, similarly:
```
if (player.punchBuffer > 0 && player.punchCooldown <= 0 && player.whiffLock <= 0
    && !player.diving && player.landingLag <= 0) { ... }
```

**Active hit-check during dive** (insert after the punch-resolution block, before line 256 / `if (opponent.hitFlash > 0)`):
```
if (player.diving && !player.diveHit && opponent.hp > 0) {
  const fistX = player.x + player.facing * DIVE_REACH;
  const fistY = player.y + DIVE_FIST_DY;     // dive fist aimed at head height
  // Opponent head band roughly opp.y - 65 to opp.y - 30; fist enters from above.
  if (Math.abs(fistX - opponent.x) < DIVE_HIT_TOL
      && fistY > opponent.y - 80 && fistY < opponent.y - 20) {
    const counter = opponent.state === 'recovery' || opponent.state === 'windup';
    const dmg = counter ? Math.round(DIVE_DAMAGE * 1.3) : DIVE_DAMAGE;
    opponent.hp = Math.max(0, opponent.hp - dmg);
    opponent.hitFlash = HIT_FLASH_DURATION;
    opponent.knockback = 420 * player.facing;
    opponent.state = 'idle';
    opponent.stateTimer = JAB_COOLDOWN * (counter ? 1.0 : 0.5);
    opponent.jabHit = false;
    player.punchesLanded++;
    player.diveHit = true;
    hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2
            : (counter ? HITSTOP_DURATION * 1.5 : HITSTOP_DURATION);
  }
}
```
Counter-on-windup is intentional: dive's geometric purpose is to defeat windup vertically (inspiration §1). 1.3× (not 1.5×) because dive already trades 9 base damage for air-time commitment.

**Landing transition** — modify the existing landing block at lines 189–193:
```
if (player.y >= GROUND_Y) {
  player.y = GROUND_Y;
  player.vy = 0;
  player.onGround = true;
  if (player.diving) {
    player.diving = false;
    player.vx = 0;
    if (!player.diveHit) {
      player.landingLag = LANDING_LAG;       // whiffed dive — eat lag
    }
    player.diveHit = false;
  }
}
```

**Render — diving pose.** In `drawStick` opts (line 377–380), add `diving = false, landingLag = 0`. In the body, add a branch **before** the standing pose:
```
if (diving) {
  ctx.fillText(facing === 1 ? '\\O' : 'O/', x, y - 30);    // diagonal head+arm
  ctx.fillText(facing === 1 ? '>>' : '<<', x + facing * 14, y - 14); // forward fist
  ctx.fillText('/ \\', x, y + 4);                          // legs trail back
  return;
}
if (landingLag > 0) {
  ctx.fillText('_O_', x, y - 30);
  ctx.fillText('\\|/', x, y - 12);                        // slumped arms
  ctx.fillText('/ \\', x, y + 4);
  return;
}
```
(Slack: tweak glyphs in implementation if they don't render — `>>` and `<<` are safe ASCII.)

Pass `diving: player.diving, landingLag: player.landingLag` from the render call at line 471.

**Edge cases.**
- Player jumps and presses J immediately on press frame: `vy = JUMP_VELOCITY = -720` (rising, vy<0) → `vy >= 0` gate fails → no dive. ✓
- Player jumps, reaches apex (vy crosses 0 from below): next frame vy >= 0 → J fires dive. ✓ This is the earliest legal dive frame — full apex airtime committed.
- Player presses J on the way down without ever pressing J during ascent: same as above. ✓
- Player whiffs dive, lands, mashes J during landing lag: punch buffer gated. ✓
- Player dives directly into opponent (`dx → 0`): contact-damage check at line 318 still runs and may damage player. Acceptable cost — diving into the body costs both fighters.
- Dive vs active opponent jab: fist enters opponent's head band from above; jab band is `y-65 to y-5` — overlap exists at y-50 to y-65. If timed perfectly mid-active-frame, the dive can land on opponent's active and get a free hit while opp's hit-check (now resolved earlier per Change 1) may have already landed. Net: trade. Acceptable — dive vs active is supposed to be high-risk.
- Dive landing while opp.knockback active: landing physics runs unconditionally, fine.
- Two-frame J consumption: the dive code calls `keysPressed.delete('j')` so the same press doesn't also trigger the punchBuffer line below. **Critical** — without this, the player would dive AND queue a ground punch that fires on landing, double-eating the J.

**Test in head.**
- Walk forward to dx=80. Jump (W). Mid-arc press J: at apex, dive fires; `vx = 320 * facing`, `vy = 540`. Travels ~40 px forward and lands in ~0.5s. dx at land ≈ 40. Hit on the way: `fistX - opp.x` band centered at the descending arc, hits ~0.2s pre-landing.
- Walk to dx=40, jump straight up (no forward input — `facing` last set by walk-forward, so dive still goes forward 40 px → overshoots opponent → whiffs → 0.4s landing lag). Lesson: don't dive from on top of the opponent.
- Hold opposite walk direction during dive: facing flipped before press → dive goes wrong way. Slight tuning concern; mitigated by `facing` only updating when `move !== 0`, and `move = 0` while diving — so `facing` is locked for the duration of the dive. ✓

**LOC.** ~30 (constants 7 + state fields 3 + reset 3 + trigger 9 + landing 7 + hit-check 13 + gating tweaks 4 + render 8 = ~54 raw, but several are existing-line modifications; net delta ~30).

---

## Change 3 — Opponent feint (variance)

**What.** When opponent enters `windup`, 30% chance to convert to a `feint` state after 0.6×JAB_WINDUP that aborts to `idle` (not recovery) instead of going to `active`. No hitbox; flickers the windup pose.

**Why.** Inspiration #2; opponent loop is a 1.2s metronome. 30% feint forces the player to read each `!` rather than reflex-counter.

**Where.** `game.js` — opponent state machine block (lines 281–311). New state value `'feint'`. New constants near line 93.

**Spec.**

**New constants** (after line 93):
```
const FEINT_CHANCE = 0.30;
const FEINT_TRIGGER_RATIO = 0.6;   // fraction of JAB_WINDUP at which feint commits
const FEINT_DURATION = 0.4;        // s
```

**State extension.** `opponent.state` now takes one more value: `'feint'`. Initialize `opponent.feintRoll = false` in the player literal AND `resetMatch` — used to mark "this windup is a feint" once the roll fires (don't re-roll every frame).

Actually cleaner: roll **at** the windup transition (line 277), store on the opponent: `opponent.feintRoll = Math.random() < FEINT_CHANCE`. So the windup → feint transition is deterministic from that point.

Add field at line 62: `feintRoll: false,` and reset to false in `resetMatch`.

**Roll on windup entry.** Modify the windup transition block (around line 277):
```
opponent.state = 'windup';
opponent.stateTimer = JAB_WINDUP;
opponent.jabHit = false;
opponent.feintRoll = Math.random() < FEINT_CHANCE;
```

**Windup → feint transition.** Modify the windup block (line 281–285):
```
} else if (opponent.state === 'windup') {
  // Feint commits at FEINT_TRIGGER_RATIO of windup elapsed
  const elapsed = JAB_WINDUP - opponent.stateTimer;
  if (opponent.feintRoll && elapsed >= JAB_WINDUP * FEINT_TRIGGER_RATIO) {
    opponent.state = 'feint';
    opponent.stateTimer = FEINT_DURATION;
    opponent.feintRoll = false;
  } else if (opponent.stateTimer <= 0) {
    opponent.state = 'active';
    opponent.stateTimer = JAB_ACTIVE;
  }
}
```

**Feint state.** Add a new branch after recovery:
```
} else if (opponent.state === 'feint') {
  if (opponent.stateTimer <= 0) {
    opponent.state = 'idle';
    opponent.stateTimer = JAB_COOLDOWN;     // full cooldown — feint is a free read for the player
  }
}
```

**Render — flickering pose.** Add to the render block, after the existing `windup` branch (around line 503) and before the `active` branch:
```
if (opponent.state === 'feint') {
  // Dim, flickering windup pose. Glyph alternates every 0.1s.
  const flicker = Math.floor(performance.now() / 100) % 2 === 0;
  ctx.fillStyle = '#776';                 // grey-yellow, dimmed warning
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(flicker ? '!' : '?', opponent.x, opponent.y - 78);
}
```
This replaces the bright `!` during feint — the `windup`-state branch already only fires for `state === 'windup'`. The `?` glyph during the off-flicker frame is a subtle "is it real?" hint. (If too on-the-nose, drop the `?` and just dim the alpha — but starting with the more legible variant.)

**Pose during feint.** The opponent is also drawn via `drawStick` with `windup: opponent.state === 'windup'`. We want the feint to look like windup (so it baits), so add: `windup: opponent.state === 'windup' || opponent.state === 'feint'`. Update line 493 accordingly.

To keep the bait readable as fake, we already differentiate via the `!` → flickering `!`/`?` swap above. The body pose stays committed-looking — the `!` glyph is what changes.

**Edge cases.**
- Player crouches on `!`, sees flicker (feint), opponent goes back to idle: player still crouched. Player can stand up and walk away — opponent's next windup is on full JAB_COOLDOWN cycle. No punish-window opens. ✓
- Player counter-punches during feint expecting windup→active→recovery: player's punch fires while opponent is still in feint state. Counter check is `state === 'recovery'` → false → standard 8 damage, **but player still whiffs unless in range**. If in range, they hit feinting opponent for non-counter damage and shove them out of state to idle. Slightly punishing the feint, but not breaking it (the player paid PUNCH_COOLDOWN and is now exposed for the next opponent cycle). ✓
- Player whiffs panic-punch during feint: 0.35s whiffLock, opponent's next cycle starts on its own JAB_COOLDOWN — likely safely outside the lock. ✓ This is the intended cost of bad reads.
- Pulsing `~` (Change 5) does NOT fire during feint because feint transitions to `idle`, not `recovery`. Semantically clean.

**Test in head.**
- 30% feint rate. ~3 of 10 windups fake. Player who reflex-crouches eats no damage from real or fake (crouch is safe vs both). Player who counter-mash (stand-punch on `!`) commits early; gets baited 30% of the time → whiffLock during which the next real jab might land if cycle aligns. Decision: read flicker, hold ground.
- Trigger ratio 0.6: feint commits 0.3s into the 0.5s windup. Visually, player sees `!` for 0.3s then sees flicker — distinct enough to read.

**LOC.** ~18: constant 3, field 1, roll 1, windup branch 4, feint branch 5, render 7, pose flag 1 = 22 raw, several inline; net ~18.

---

## Change 4 — Walk leg cycle

**What.** Player legs alternate between `/ \` and `\ /` based on a phase accumulator advanced by `|vx|`. Mid-air pose is neutral.

**Why.** Smoothness pick 1. Returns from divepunch landing read as "I'm walking again" instead of teleport.

**Where.** `game.js:48` (player field), `game.js:108` (reset), `game.js:165` (advance), `game.js:421` (render), `game.js:471–477` (pass).

**Spec.**

Add `walkPhase: 0,` to the player literal at line 48.

Reset: `player.walkPhase = 0;` in `resetMatch`.

Advance — insert after line 165:
```
player.walkPhase += Math.abs(player.vx) * dt;
```

Add `walkPhase = 0` to `drawStick` opts destructure (line 377–380). Replace line 421:
```
const stride = (walkPhase % 64) < 32 ? '/ \\' : '\\ /';
ctx.fillText(airborne ? '/ \\' : stride, x, y - 10);
```

Pass `walkPhase: player.walkPhase` from line 471 render call.

**Edge cases.** Crouch path returns early before reaching legs; unaffected. Diving / landingLag pose draws its own legs and returns early; unaffected. Knockback advances `x` but not `vx`, so phase doesn't advance during pure knockback slide — reads as shoved, not stepping. ✓

**Test in head.** Walk at 192 px/s with stride period 64 → 3 Hz cadence. Visible. Stop walking → vx → 0 → phase frozen on whichever stride; reads as "stopped mid-step." ✓

**LOC.** ~8.

---

## Change 5 — Pulsing recovery `~` glyph

**What.** Replace static `~` with a sin-pulsed alpha glyph during opponent's recovery state.

**Why.** Smoothness pick 2. With feint introducing read-uncertainty, the recovery beacon needs to assert "the punish window is now open."

**Where.** `game.js:514–520`.

**Spec.** Replace the block with:
```
if (opponent.state === 'recovery') {
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 90);
  ctx.fillStyle = `rgba(200, 200, 200, ${pulse.toFixed(3)})`;
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('~', opponent.x, opponent.y - 78);
}
```

**Edge cases.** Hitstop pauses update but render runs unconditionally — pulse continues during hitstop, which is correct (the punish window beacon stays alive across the freeze). No frame-rate dependency (uses `performance.now()`). Feint transitions to `idle`, not `recovery`, so the pulse never fires for fakes — clean semantic separation.

**Test in head.** Period 565ms, alpha range 0.65–1.0. Always readable, attention-grabbing.

**LOC.** ~4.

---

## Total LOC

| # | Change | LOC |
|---|---|---|
| 1 | CRIT-FIX: state-machine reorder | ~5 |
| 2 | Divepunch | ~30 |
| 3 | Feint | ~18 |
| 4 | Walk leg cycle | ~8 |
| 5 | Pulsing recovery `~` | ~4 |
| | **Total** | **~65** |

Under the 80 cap with ~15 LOC of slack for inevitable inline tuning and edge-case fixes during implementation.

---

## Implementation order

1. **CRIT-FIX first.** It's a structural reorder (move opp state-machine block above player punch block, narrow knockback gate to patrol-only). Land + verify the dx=40 trade is now mutual before adding any new verbs on top.
2. **Divepunch.** Largest change; needs space to debug the rising-jump gate, the `keysPressed.delete` consume, and the landing-lag pose. Test: jump → mid-arc J fires dive; jump → press-J-on-rise does nothing; whiffed dive → 0.4s lag.
3. **Feint.** State machine extension. Test by setting `FEINT_CHANCE = 1.0` temporarily and confirming every windup feints; then restore to 0.30.
4. **Walk leg cycle.** Pure render. Test: walk visibly steps; mid-air legs static; landing resumes stride.
5. **Pulsing `~`.** Pure render. Visual confirmation only.

---

## Deferred

- **Rounds (best-of-3).** Structural change competing with divepunch tuning risk. Ship after divepunch settles. Iter-7 candidate.
- **Pursuit.** Per orchestrator, pursuit at JAB_RANGE=60 forces engagement and competes with the keystone read. Defer indefinitely or reconsider only if matches feel evasive after iter-6.
- **Crouch animation richness (chamber pose, knee bob, dust).** ~22 LOC of pure render polish. No verb-composition leverage in iter-6; better as a slack-filler in a quieter iteration.
- **Off-balance lean during whiffLock.** Was smoothness pick 3. Deferred so we can co-design the lean primitive with divepunch's `landingLag` pose in iter-7 — the same primitive serves both, but cleaner to design once both verbs are in.
- **Knockback magnitude bump (20px → ~30–40px).** Playtest §4. Standalone tuning; defer to iter-7. Bumping while introducing dive (which adds another knockback consumer at 420 px/s) risks compounding feel changes.
- **HP bar tail darken.** Smoothness pick 4 (slack-tier). Skip; budget is tight after divepunch + feint.
- **Subpixel render snap, patrol direction easing, uppercut chevrons, player knockback decay tuning, crouch transition easing.** Per smoothness review's deferral list — none compose with iter-6's verbs.
- **S+J vs J+S timing race documentation.** Playtest §7 edge. Subtlety, not a bug. Surface in controls screen in a future polish iteration.
- **Match length (15s perfect-play).** Will be addressed naturally by rounds (iter-7+) — best-of-3 triples effective match time.
