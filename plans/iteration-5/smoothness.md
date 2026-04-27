# Iteration 5 — Smoothness Review

## Ranking summary

Ranked by *visible jank per LOC*, weighted by composition with this iteration's likely gameplay verbs (divepunch, whiff-recovery):

| # | Item | LOC | Composes with new verbs? | Pick? |
|---|---|---|---|---|
| 1 | Opponent jab windup pose (wound-up arm) | ~5 | Strong — divepunch reads off telegraphs | YES |
| 2 | Active-state fist ease-in (0.04 s) | ~6 | Strong — same code path future opponent attacks reuse | YES |
| 3 | Player knockback as decaying channel | ~8 | Strong — divepunch landing & whiff-recovery both produce knockback events | YES |
| 4 | Subpixel render snap (Math.round on text x) | ~3 | Neutral — global polish | maybe (cheap, fold in if budget allows) |
| 5 | Patrol direction easing | ~5 | Weak — opponent already stops during attack states | DEFER |
| 6 | Walk leg-cycle animation | ~6 | Neutral | DEFER |
| 7 | Crouch transition easing | ~6 | Weak — binary read is *fine* for a hurtbox toggle | DEFER |

**Recommended budget: ~19 LOC** for picks 1–3. Leaves headroom for snap (3 LOC) if inspiration & playtest don't fully consume the cap.

Rationale on the deferrals:
- **Patrol easing** (smoothness #1 from synthesis) lost most of its bite once the keystone shipped — opponent now spends real time stationary in windup/active/recovery, so the patrol→halt discontinuity is rarer and less jarring than it was at iter-3. Lower priority than telegraph clarity.
- **Walk leg cycle** is texture, not a smoothness defect — figure already moves, just statically. Bundle with a future pose pass.
- **Crouch transition easing** would actively hurt: crouch is a *hurtbox state* with a discrete physics meaning. Easing the visual without easing the hitbox introduces a desync window where the figure looks crouched but still gets hit (or vice-versa). Skip.

---

## Pick A — Opponent jab windup pose

**Where.** `game.js:427-446` (render block for opponent + windup `!` glyph + active `====` fist). The opponent currently always renders `/|\` arms via `drawStick` at line 427.

**Why it hurts.** The 0.5 s windup is the keystone's whole reason for existing — it's the read. Right now the only telegraph is a yellow `!` floating above an otherwise neutral pose. New eyes scanning the silhouette miss it; the body language doesn't say "loading a punch." This is the single highest-leverage clarity win on the table, and it directly improves divepunch reads next iter (the player needs to identify *which* opponent state is which from posture alone, not from glyphs).

**Fix sketch (~5 LOC).** Add a `windup` opt to `drawStick` that swaps the arms line. Pass it from render based on `opponent.state === 'windup'`.

```js
// drawStick opts (line 328): add windup = false, windupFacing = 1
// Inside the non-crouch arms branch (line 366):
if (windup) {
  // arm pulled back: facing-1 means windup faces +1 (wound up to the right? no — wound up to LEFT, ready to throw RIGHT)
  // Opponent's windupFacing matches its post-windup oppFacing (player.x < opponent.x ? -1 : 1).
  // For windupFacing = -1 (player to opponent's left): arm pulled back to the right → '/|>' style
  ctx.fillText(windupFacing === 1 ? '<|\\' : '/|>', x, y - 30);
} else {
  ctx.fillText('/|\\', x, y - 30);
}
```

In render (after line 427):
```js
const oppFacing = player.x < opponent.x ? -1 : 1;
drawStick(opponent.x, opponent.y, {
  facing: -1,
  color: flashColor(...),
  windup: opponent.state === 'windup',
  windupFacing: oppFacing,
});
```

Keep the `!` glyph — it stacks. Body says "loading," glyph says "danger."

**Composes with divepunch.** If divepunch lands as an in-air heavy with a windup of its own (player's), the same `windup` opts can be reused on the *player's* drawStick later. Cheap groundwork.

---

## Pick B — Active-state fist ease-in

**Where.** `game.js:439-446` (`opponent.state === 'active'` render block). The `====` fist is drawn at `opponent.x + oppFacing * (8 + JAB_REACH)` from frame 1 of the 0.12 s active window.

**Why it hurts.** The fist *snaps* in at full extension. Player punch already eases (`drawStick` lines 343-355 — cubic ease over the 0.20–0.55 fraction of `punchT`). Asymmetry between player and opponent attacks reads as opponent feeling "uglier." A short ease-in (~0.04 s, ~⅓ of active) gives the eye a "pop" frame without changing hit timing.

**Fix sketch (~6 LOC).** Use the existing `stateTimer` to compute progress. JAB_ACTIVE = 0.12, ease over first 0.04 s.

```js
if (opponent.state === 'active') {
  const oppFacing = player.x < opponent.x ? -1 : 1;
  const tIn = Math.min(1, (JAB_ACTIVE - opponent.stateTimer) / 0.04);
  const reach = JAB_REACH * (1 - Math.pow(1 - tIn, 3));   // cubic ease-out
  ctx.fillStyle = flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.textAlign = oppFacing === 1 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('====', opponent.x + oppFacing * (8 + reach), opponent.y - 50);
}
```

**Critical: hitbox stays at full reach.** The hit-test in `update` (line 240) keeps using `JAB_REACH` — only the *render* eases. Otherwise an early-active jab would whiff visually but connect, or vice versa. This decoupling is intentional and fine; the player reads hit timing from the `!` → snap-extend cadence, which is unchanged.

**Composes.** If iter-5 ships any new opponent attack (counter-jab, lunge), this same ease-in pattern drops into its render block.

---

## Pick C — Player knockback as decaying channel

**Where.** `game.js:248` (jab connect: `player.vx = -360 * oppFacing`) and `game.js:273` (contact-damage: `player.vx = -360 * sign`). Both then immediately get fought by the input-lerp at line 150 (`player.vx += (targetVx - player.vx) * (1 - Math.pow(1 - VX_LERP, dt * 60))`).

**Why it hurts.** Stomp it on `player.vx` and the very next frame the input lerp drags it back toward `targetVx` (which is 0 if no key, or `±WALK_SPEED` if the player was holding into the hit). Result: a hit "shoves" the player ~6 px before they're walking again. Reads as rubber-band, not impact. Also breaks dt-correctness: 360 px/s is a velocity but the lerp swallows it on a dt-dependent curve.

**Fix sketch (~8 LOC).** Add a `knockbackVx` channel on player that *adds* to position separately and decays exponentially, identical pattern to `opponent.knockback` (lines 209-212). Player input stays clean; knockback layers on top.

```js
// player literal (line 31): add knockbackVx: 0,
// resetMatch: player.knockbackVx = 0;

// Replace line 248: player.vx = -360 * oppFacing;
// With:           player.knockbackVx = -360 * oppFacing;

// Replace line 273: player.vx = -360 * (opponent.x > player.x ? 1 : -1);
// With:            player.knockbackVx = -360 * (opponent.x > player.x ? 1 : -1);

// After line 152 (player.x += player.vx * dt):
if (Math.abs(player.knockbackVx) > 6) {
  player.x += player.knockbackVx * dt;
  player.knockbackVx *= Math.pow(0.7, dt * 60);   // matches opponent decay constant
} else {
  player.knockbackVx = 0;
}
```

Then re-clamp `player.x` against arena bounds *after* the knockback add (the existing clamp on line 154 happens before). Easiest: move lines 154-155 to run after the knockback block. Or duplicate the clamp; +1 LOC either way.

**Net behavior.** Take a jab → travel ~120 px over ~0.3 s with a smooth decay, *while* player can still adjust direction (input vx unchanged). Way more "punched across the room" feel.

**Composes hard with new verbs.**
- **Divepunch.** Landing one will probably want to push the player slightly forward / opponent away — both directions are knockback events. Player having a real channel means we don't have to invent the same rig twice.
- **Whiff-recovery.** If the punish for whiffed punches is a stagger or counter-knockback, this channel is exactly the rig you want. Without it, the punish still has to be "freeze player input" which is fightier UX than "shove them."

Also brings player/opponent symmetry to the codebase — both now have `(x|knockbackVx)` channels with the same decay constant.

---

## LOC tally

- Pick A: ~5
- Pick B: ~6
- Pick C: ~8

**Total: ~19 LOC.** Under the 25-LOC smoothness budget, with ~6 LOC slack. If divepunch + whiff-recovery come in lean, fold in subpixel snap on text rendering (`Math.round(opponent.x)` / `Math.round(player.x)` at the four `drawStick`/fist `fillText` call sites) for ~3 more LOC.

## Deferred (with one-line justifications)

- **Patrol direction easing** — keystone's stationary attack states already provide rhythm; cost no longer worth it post-iter-4.
- **Walk leg cycle** — texture, not smoothness; bundle with a pose-pass iteration.
- **Crouch transition easing** — would desync the visual from the discrete hurtbox state and *introduce* a smoothness-of-feel bug. Don't.
- **Subpixel snap** — cheap and global; fold in only if budget permits at end of iter-5.
