# Iteration 5 — Synthesis

Budget: 80 LOC. Selected total ~62 LOC across 7 changes.

Selection logic. Crouch+punch exploit MUST go this iteration (playtest §5: dominant strategy invalidates the keystone). Take the **uppercut** route (inspiration #4) over the bare gate — it preserves crouch as a verb instead of nerfing it, and pairs cleanly with whiff-recovery. Pair it with player whiff-recovery (inspiration #2) so the new offensive verb has the same commitment cost as the opponent's jab. Add the 1-LOC `JAB_RANGE` tuning fix from playtest §6, the 5-LOC active→recovery visual cue from playtest §2 caveat, and all three smoothness picks (~19 LOC). Skip divepunch — uppercut already eats the gameplay budget, and ground-game symmetry is the higher-leverage win this iter. Jump rehab deferred to iter-6.

---

## 1. Block standing punch while crouching, replace with crouch-uppercut

**What.** When `player.crouching && player.onGround`, the J input fires a distinct uppercut attack with its own arc, reach, damage, cooldown, and pose — not the standing punch.

**Why.** Playtest §5 (CRITICAL): crouch+J fires the standing punch invisibly with full standing reach — dominant strategy. Inspiration #4: making it a real verb instead of gating it preserves crouch's offensive identity and adds a second punish line (fast/short/low-damage) alongside the existing recovery counter (slow/long/high-damage).

**Where.** `game.js` lines 179–205 (punch input/buffer block); add new constants near line 84; `drawStick` at line 327 (new pose branch); `resetMatch` at line 86.

**Spec.**

New constants (after line 84):
```
const UPPER_REACH = 30;          // px — shorter horizontal than PUNCH_REACH 38
const UPPER_DURATION = 0.2;      // s — same active window as standing punch
const UPPER_COOLDOWN = 0.5;      // s — vs PUNCH_COOLDOWN 0.3
const UPPER_DAMAGE = 10;         // vs PUNCH_DAMAGE 8, vs counter 12
const UPPER_HIT_TOL = 28;        // same X tolerance as standing
const UPPER_BAND_HI = -75;       // arc reaches 10 px above standing band hi (-65)
const UPPER_BAND_LO = -5;        // bottom of standing band
```

New player field (line 31 literal): `uppercutTimer: 0`. Reset to 0 in `resetMatch`.

Tick `uppercutTimer` alongside `punchTimer` (line 176): `if (player.uppercutTimer > 0) player.uppercutTimer -= dt;`

Modify the punch-fire block (line 182). When `punchBuffer > 0 && punchCooldown <= 0`:

- Branch on `player.crouching`. If crouching:
  - Set `player.uppercutTimer = UPPER_DURATION`.
  - Set `player.punchCooldown = UPPER_COOLDOWN` (re-using same cooldown channel — no need for a separate uppercutCooldown).
  - `punchAttempts++` (still counts as an attempt for HUD stats).
  - Hit-test: `fistX = player.x + player.facing * UPPER_REACH; fistY = player.y - 50` (centerline used only for clarity — actual band check uses UPPER_BAND_HI/LO around opponent.y).
  - Check: `Math.abs(fistX - opponent.x) < UPPER_HIT_TOL && opponent.y + UPPER_BAND_HI < player.y - 50 + 1 && opponent.y + UPPER_BAND_LO > player.y - 50 - 1 && opponent.hp > 0`. Simpler form: just test `Math.abs(fistX - opponent.x) < UPPER_HIT_TOL && opponent.hp > 0` — the uppercut arc covers the entire opponent vertical span by design (low rising to above head), so X-only check is correct.
  - On hit: damage `UPPER_DAMAGE` (10). Counter check still applies (`opponent.state === 'recovery'` → `Math.round(UPPER_DAMAGE * 1.5)` = 15). Knockback `(counter ? 540 : 480) * facing`. Set `opponent.hitFlash`, `opponent.state = 'idle'`, `opponent.stateTimer = JAB_COOLDOWN * (counter ? 1.0 : 0.5)`, `opponent.jabHit = false`, `punchesLanded++`, hitstop as before. **Set `player.uppercutTimer = UPPER_DURATION * 0.4` on hit** to mirror line 203's punchTimer truncation.
  - **Crouch lock during uppercut.** While `uppercutTimer > 0`, force `player.crouching` to remain true even if S is released. Implement by adjusting line 157 to `player.crouching = player.onGround && (keys.has('s') || keys.has('arrowdown') || player.uppercutTimer > 0);`. This prevents standing-up cancellation and is the inspiration #4 commitment cost.
- Else (not crouching): existing standing-punch path unchanged.

**Edge cases.**
- Player presses J while standing, then crouches mid-`punchTimer`: punchTimer continues, crouching becomes true, but no second punch fires (cooldown). Render shows crouch pose immediately — standing-punch fist-extension animation is dropped this frame. Acceptable visual; the active hit-frame already passed or didn't.
- Player presses J at the exact frame they crouch (S and J same frame): order in `update` is crouch-set (line 157) before punch-fire (line 182), so uppercut wins. Correct.
- Punch buffer carries crouch state at fire time: if J pressed while standing then S held while buffered, fires as uppercut. Acceptable — the input the player committed is "J + crouching at fire time."
- Opponent in recovery overlapping crouching player: counter applies to uppercut (15 dmg). Within design intent — the iter-4 counter rule is universal.

**Test in head.** Player at dx=80, opponent windup `!`. Crouch S. Jab whiffs (hurtbox drop). Press J. Uppercut fires: fistX = player.x + 30, |fistX − opponent.x| = |30 − 80| = 50 > 28 → **whiff**. Correct: short reach means crouch-then-uppercut from neutral doesn't connect; player must walk in first or be already close. At dx=40 + crouch + J: |30 − 40| = 10 < 28 → connects, opponent in `active` (still in jab), 10 dmg. New punish window: smaller, faster, no walk-in, but only 10 dmg vs counter's 12. Designed trade.

**LOC.** ~25.

---

## 2. Player whiff-recovery on standing punch

**What.** A standing-punch attempt that does not register a hit incurs `whiffLock = 0.35 s`, during which movement input, jump, crouch transitions, and further punch buffering are ignored.

**Why.** Inspiration #2 + playtest §3 ("Chip on miss" / no penalty for greedy mash). Closes the symmetry the iter-4 keystone opened: opponent commits 0.35 s on a missed jab; player should commit comparably on a missed punch. Pairs naturally with the new uppercut as the third attack-with-cost (jab, punch, uppercut all now have whiff penalties — uppercut's penalty is the longer cooldown + crouch lock; punch's is whiffLock).

**Where.** `game.js` line 31 (player field), line 86 (`resetMatch`), lines 146–152 (movement), 157–158 (crouch), 161 (jump), 175–185 (punch tick + buffer + fire).

**Spec.**

New constant near line 84: `const WHIFF_LOCK = 0.35;`

New player field: `whiffLock: 0`. Reset to 0 in `resetMatch`.

Tick alongside other timers (after line 177): `if (player.whiffLock > 0) player.whiffLock -= dt;`

Input gates while `whiffLock > 0`:
- Movement (after line 149, before vx lerp): `if (player.whiffLock > 0) move = 0;` (sets targetVx to 0).
- Jump (line 161): add `&& player.whiffLock <= 0` to the `wantJump` guard.
- Crouch (line 157): add `&& player.whiffLock <= 0` so a *new* crouch press during whiffLock is ignored. (If S was held continuously from before whiffLock, it stays. Acceptable — the lock is on transitions, not held state. But: if uppercut is the attack that whiffed, see edge case below.)
- Punch buffer (line 180): `if (wantPunch && player.whiffLock <= 0) player.punchBuffer = PUNCH_BUFFER;` — and gate fire as well: line 182 condition becomes `player.punchBuffer > 0 && player.punchCooldown <= 0 && player.whiffLock <= 0`.

Set `whiffLock` on miss. Inside the punch-fire block, after the hit-test conditional: if the hit-test was `false`, set `player.whiffLock = WHIFF_LOCK`. **Apply to standing punch only this iter.** Uppercut already has its longer cooldown + crouch lock as its commitment; double-stacking whiffLock on uppercut would over-punish the new verb in its first ship. Inspiration #4 explicitly composes uppercut with whiffLock; defer for iter-6 tuning.

**Edge cases.**
- whiffLock active, player still has standing-punch animation playing (`punchTimer > 0`): correct — the arm finishes its return arc during the lock, reading as "off-balance follow-through." No additional render needed; existing punch animation already covers ~0.2 s, lock covers ~0.35 s. Optional polish: extend retract phase by 0.15 s (skip this iter, it's render-only and the asymmetry is fine).
- Hit during whiffLock from opponent jab: hit lands normally (hurtbox unchanged). The lock prevents *output*, not invulnerability. Intentional — playtest §3 wanted the "you walked in, threw early, you eat 12" scenario.
- Player holds movement key throughout: `move = 0` zeroes targetVx; vx lerp slows player to 0 over ~0.15 s. Reads as a brief stagger.
- Player chains standing punch → standing punch where the first whiffs: second punch is blocked until lock clears (0.35 s). Existing PUNCH_COOLDOWN is 0.3 s, so this adds ~50 ms of additional gating past the existing cooldown. Per inspiration #2.

**Test in head.** Player at dx=100 (out of jab range, out of punch reach), mashes J. First press fires: fistX = player.x + 38, |fistX − opponent.x| = |38 − 100| = 62 > 28 → whiff. `whiffLock = 0.35`. Subsequent J presses for 0.35 s: rejected by punchBuffer gate. Player input zeroed, player drifts to vx=0, can't crouch into jab. If opponent's jab windup is mid-flight, player eats 12 dmg. Correct symmetry.

**LOC.** ~12.

---

## 3. Shrink JAB_RANGE to 60

**What.** Change `const JAB_RANGE = 80;` → `const JAB_RANGE = 60;`.

**Why.** Playtest §6 (critical bug): trigger band (60, 80) is a 20-px sweet spot where opponent commits to a jab that geometrically cannot land (JAB_REACH=32, JAB_HIT_TOL=28 → max landing dx is 60). Free-counter cheese without crouching. Shrinking trigger to 60 makes opponent only commit when it can actually hit — keeps JAB_REACH/JAB_HIT_TOL geometry consistent.

**Where.** `game.js` line 76.

**Spec.** One-line constant change. No other code touches needed — line 226 (`dxToPlayer < JAB_RANGE`) reads from the constant.

**Edge cases.**
- Crouch math (playtest §1): crouch was triggered at dx ≈ 80; now triggers at dx ≈ 60. Player still has 0.5 s windup to react. Walk-up to punch range: starts dx=60, needs dx ≤ 66 → already in range, walk-up is **0 px**. Counter window grows: 0.35 s recovery − 0 walk = full 0.35 s slack. Slightly easier than iter-4. Acceptable — the keystone counter is supposed to feel reliable; the playtest's 4.8× headroom number was already comfortable, this brings it to ∞×.
- Closure-rate-to-trigger: player walks in at 192 px/s (closure 288), opponent triggers at dx=60 instead of dx=80. Time-to-first-jab grows by 20/288 ≈ 0.07 s. Trivial.
- Bait loop closed: player can no longer dance at dx ∈ (60, 80) for free counters. Must enter actual jab range to bait, where the jab will land if they don't crouch.

**Test in head.** Trigger at dx=59. oppFistX = opponent.x − 32. |fistX − player.x| = |opponent.x − 32 − (opponent.x − 59)| = 27 < 28 → **lands** (if standing). Geometry now self-consistent.

**LOC.** 1.

---

## 4. Active→recovery visual cue on opponent

**What.** When `opponent.state === 'recovery'`, draw a small dim-grey glyph near the opponent (e.g. `~` at `opponent.y - 78` in `#888`) for the duration of recovery — a passive "punishable now" tell.

**Why.** Playtest §2 caveat: there is no visual cue for active→recovery transition, and crouching past active eats 192 px/s × extra time = the entire counter window. Players who can't read the transition lose the punish. 5 LOC quality-of-life that directly tightens the keystone loop.

**Where.** `game.js` after line 446, before the HP bars at 448.

**Spec.**

```
if (opponent.state === 'recovery') {
  ctx.fillStyle = '#888';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('~', opponent.x, opponent.y - 78);
}
```

**Edge cases.**
- Recovery glyph collides with windup `!` slot: they are mutually exclusive states, never drawn same frame.
- Color: `#888` chosen as the "inactive/safe" tone (contrasts with windup's `#ffcc66` warning yellow). Reads as "danger has passed."
- Glyph choice: `~` is short, low-attention, signals "drained/wavering." If the orchestrator finds it ambiguous, swap for a faded `.` or even reuse the windup `!` in dim grey — but a different glyph is preferred to avoid semantic confusion with the windup tell.

**Test in head.** Opponent finishes active, enters recovery. The active fist `====` disappears (no longer in active branch), the dim `~` appears above head for 0.35 s. Player sees "now's the time" without the abstract gap. Counter-press window remains the same; readability improves.

**LOC.** ~5.

---

## 5. Smoothness A — opponent jab windup pose

**What.** Add `windup` and `windupFacing` opts to `drawStick`. When the opponent is in `windup`, replace `/|\` arms with a wound-up pose (`/|>` or `<|\` based on facing).

**Why.** Smoothness pick A (~5 LOC). Body language reinforces the `!` glyph. Highest-leverage clarity win on the table per the smoothness report.

**Where.** `game.js` line 327 (drawStick signature/body) and line 427 (opponent render call).

**Spec.**

In `drawStick` opts (line 328): add `windup = false, windupFacing = 1`.

In the non-crouch arms branch (replace line 363 / line 366 fallback `/|\`):
```
if (windup) {
  ctx.fillText(windupFacing === 1 ? '<|\\' : '/|>', x, y - 30);
} else {
  ctx.fillText('/|\\', x, y - 30);
}
```
This branch executes when `punchT < 0` (no punch animation) OR when `punchT >= 0 && off <= 0` (pre-extension frames). Note: the existing `punchT >= 0 && off > 0` branch overwrites the arms anyway — windup never overlaps a punch animation since the opponent doesn't punch with `drawStick`'s punchT machinery (its fist is rendered as a separate `====` in the active branch). Safe.

At the opponent render call (line 427):
```
const oppFacing = player.x < opponent.x ? -1 : 1;
drawStick(opponent.x, opponent.y, {
  facing: -1,
  color: flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION),
  windup: opponent.state === 'windup',
  windupFacing: oppFacing,
});
```

**Edge cases.**
- `oppFacing` calculation matches the one at line 440 (active block). Hoist to a single variable above the drawStick call so both blocks share it (saves 1 LOC). Optional refactor.
- Windup glyph readability: `/|>` and `<|\` must be visually distinct from `/|\`. They are.

**Test in head.** Opponent enters windup, body pose flips to wound-up. After 0.5 s, transitions to active — pose is overridden by active branch (separate `====` render plus default arms drawn by drawStick with `windup = false`). Smooth.

**LOC.** ~5.

---

## 6. Smoothness B — active-state fist ease-in

**What.** Cubic ease-out on the opponent's `====` fist X-offset over the first ~0.04 s of active. Hitbox unchanged — render-only.

**Why.** Smoothness pick B (~6 LOC). Player punch already eases; opponent jab snaps. Asymmetry reads as opponent feeling cruder. Reuses the same eased cadence the player attacks already use.

**Where.** `game.js` lines 439–446 (opponent active render block).

**Spec.**

```
if (opponent.state === 'active') {
  const oppFacing = player.x < opponent.x ? -1 : 1;
  const tIn = Math.min(1, (JAB_ACTIVE - opponent.stateTimer) / 0.04);
  const reach = JAB_REACH * (1 - Math.pow(1 - tIn, 3));
  ctx.fillStyle = flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.textAlign = oppFacing === 1 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('====', opponent.x + oppFacing * (8 + reach), opponent.y - 50);
}
```

**Edge cases.**
- **Hitbox decoupling.** Hit-test in update (line 240) keeps using full `JAB_REACH`. This means the very first frame of active connects on hurtbox while the visual fist is at ~0 px reach. Smoothness report explicitly sanctions this; player reads timing from the `!` → snap-extend cadence, not pixel-perfect fist contact. Unchanged compared to current snap behavior.
- 0.04 s = 33% of JAB_ACTIVE. Cubic ease-out reaches 87% by t=0.5 of the ease window (0.02 s), full by 0.04 s.

**Test in head.** stateTimer starts at 0.12, `tIn = 0` → reach=0. After 0.02 s (stateTimer=0.10), `tIn = 0.5`, reach=`32*(1-0.125)`=28. After 0.04 s, `tIn = 1`, reach=32. Pop frame transformed into a 40-ms pull. Readable.

**LOC.** ~6.

---

## 7. Smoothness C — player knockback as decaying channel

**What.** Add `player.knockbackVx`. Hits to the player set this channel instead of stomping `player.vx`. Channel decays at the same rate as `opponent.knockback`. Player input remains responsive throughout.

**Why.** Smoothness pick C (~8 LOC). Current behavior (lines 248, 273): hit shoves vx, input lerp drags it back next frame → ~6 px shove, reads as rubber-band. With a channel: ~120 px decaying slide, reads as impact.

**Where.** `game.js` line 31 (player literal), line 86 (`resetMatch`), lines 152–155 (movement clamp), line 248 (jab hit), line 273 (contact hit).

**Spec.**

Add to player literal: `knockbackVx: 0`. Reset in `resetMatch`.

Replace line 248: `player.vx = -360 * oppFacing;` → `player.knockbackVx = -360 * oppFacing;`

Replace line 273: `player.vx = -360 * (opponent.x > player.x ? 1 : -1);` → `player.knockbackVx = -360 * (opponent.x > player.x ? 1 : -1);`

After line 152 (`player.x += player.vx * dt;`), insert before clamp at 154:
```
if (Math.abs(player.knockbackVx) > 6) {
  player.x += player.knockbackVx * dt;
  player.knockbackVx *= Math.pow(0.7, dt * 60);
} else {
  player.knockbackVx = 0;
}
```

The clamp on line 154 already runs after this insert, so wall clamping is preserved.

**Edge cases.**
- Player holds direction *into* the hit: input vx is e.g. +192, knockback is −360. Net travel is `(192 + (−360 decaying)) * dt`. Player can recover and re-approach during the slide — feels less "gotcha," more "hit and reposition."
- Wall corner: knockback shoves player into wall, clamp stops position, knockbackVx continues to decay (doesn't zero on wall hit). Acceptable — visually the player "slumps" against the wall instead of the wall reflecting them.
- Composes with whiffLock (#2): player whiffed punch, then opponent jab hits during whiffLock. Knockback applies normally (hurtbox unchanged), shove pushes player while their input is already locked. Correct stack — eats their commitment.
- Composes with crouch-uppercut: counter-uppercut takes a hit on the player while crouching? The crouch hurtbox drop saves them in most cases. If hit anyway, knockback applies and crouch state holds (uppercut crouch-lock based on `uppercutTimer`, separate channel). Acceptable.

**Test in head.** Player at dx=40 standing, opponent jab connects, oppFacing=−1, knockbackVx = −360 * −1 = +360. **Wait — that's wrong direction.** Re-check existing line 248: `player.vx = -360 * oppFacing`. If player is to opponent's left, oppFacing = −1, so vx = -360 * -1 = +360. Player gets pushed right (toward opponent)? No — let me re-trace. Player at x=200, opponent at x=240, oppFacing = (player.x < opponent.x ? -1 : 1) = -1. The opponent's fist swings to its left (−1). The player should be knocked left (away from opponent), which is negative x direction. vx should be negative. But `-360 * oppFacing = -360 * -1 = +360`. That pushes right, *toward* opponent. **The existing code has a sign bug** — but: it's been live since iter-4 and was never flagged in playtest §2 because the input lerp eats it within one frame (the rubber-band the smoothness report describes). With the new knockback channel, the bug becomes visible. **Fix the sign while we're here:** use `+360 * oppFacing` instead of `-360 * oppFacing` — oppFacing=−1 (player left of opponent) → knockback −360 (pushes player further left, away from opponent). Confirm against the contact-damage line 273 which uses `-360 * (opponent.x > player.x ? 1 : -1)`: opponent right of player → +1 → knockback −360 (pushes player left, away). That sign is correct. So the jab line is the buggy one. **Spec correction: line 248 replacement uses `+360 * oppFacing`, line 273 keeps `-360 * (sign)`.** Both result in "push player away from opponent" with knockback strength 360 px/s.

**LOC.** ~8 (plus the sign fix is a swap, no LOC delta).

---

## LOC tally

| # | Change | LOC |
|---|---|---|
| 1 | Crouch-uppercut | ~25 |
| 2 | Player whiff-recovery | ~12 |
| 3 | JAB_RANGE → 60 | 1 |
| 4 | Recovery visual cue | ~5 |
| 5 | Smoothness A — windup pose | ~5 |
| 6 | Smoothness B — active fist ease-in | ~6 |
| 7 | Smoothness C — player knockback channel | ~8 |

**Total ~62 LOC**, under the 80 cap with ~18 LOC slack. Slack absorbs implementation overhead (resetMatch lines, helper hoists, the sign-fix in #7 which is technically a bonus).

---

## Deferred

- **Divepunch (inspiration #1, ~30 LOC).** Jump rehab is the next big keystone but doesn't fit alongside crouch-uppercut this iter — two new attack verbs in one iteration is a tuning nightmare. Iter-6 candidate, especially good once whiff-recovery is on the books to anchor its `airWhiffRecovery` cousin.
- **Opponent feint (inspiration #3, ~18 LOC).** Inspiration explicitly notes feint is variance on a too-shallow base. With uppercut shipping, the player toolkit grows to two punish lines (fast/short + slow/long); feint becomes more meaningful in iter-6 once the player has options to mix between.
- **Stamina (inspiration #5, ~22 LOC).** Premature gate; let the verbs settle first. Iter-7 if uppercut + future divepunch feel spammy in playtest.
- **Whiff-recovery on uppercut.** Inspiration #4 composes naturally with #2 but stacking whiffLock on the new verb's first ship over-punishes. Crouch-uppercut already commits via UPPER_COOLDOWN 0.5 s and crouch-lock during the active window. Add whiffLock to uppercut in iter-6 if playtest shows it's being whiffed risk-free.
- **Subpixel snap on text (smoothness #4, ~3 LOC).** Cheap polish; fold in if iter-5 implementation comes in under budget. Otherwise iter-6.
- **Patrol direction easing, walk leg cycle, crouch transition easing.** Per smoothness report deferral notes — low ROI now or actively harmful (crouch easing).
- **dx=10 dead zone, vestigial CONTACT subsystem (playtest §7).** Cosmetic / cleanup. Iter-6 housekeeping pass.
- **Sign-fix on jab knockback.** Folded into smoothness #7 spec since it became visible only with the new channel.
