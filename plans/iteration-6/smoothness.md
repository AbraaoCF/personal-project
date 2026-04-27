# Iteration 6 — Smoothness Review

## Context recap

Iter-5 shipped: opponent windup pose (`/|>` / `<|\`), opponent active-fist cubic ease-in over first 0.04 s, and `player.knockbackVx` channel with `pow(0.7, dt*60)` decay. Iter-6 keystones likely: **divepunch (~30 LOC)** and **feint (~18 LOC)**. That's ~48 LOC of gameplay, leaving ~30 LOC headroom under an 80-cap if the iter holds shape. Smoothness budget: ≤25 LOC, picks chosen to **compose** with the new verbs rather than sit in their own corner.

## Ranking

| # | Item | LOC | Composes with divepunch / feint? | Pick? |
|---|---|---|---|---|
| 1 | Walk leg cycle (alt `/ \` ↔ `\ /`) | ~8 | **Strong** — divepunch puts player airborne more, returning to ground; static legs make every land read mushy. Also gives feint a reason to read footwork. | YES |
| 2 | Pulsing recovery `~` glyph | ~4 | **Strong** — feint shipping means the player needs to *quickly* parse "is this real or feint?" The recovery cue becoming a punish-window beacon (post-feint-resolution) is the critical clarity win. | YES |
| 3 | Off-balance lean during `whiffLock` | ~6 | **Medium** — divepunch will likely have its own air-whiff penalty; an existing off-balance pose pattern transfers directly. Also clarifies feint outcomes (player whiffs because they reacted to bait → lean tells them why). | YES |
| 4 | HP bar tail darker / stripier | ~3 | Neutral — global polish, no verb composition | maybe (slack only) |
| 5 | Subpixel render snap | ~3 | Neutral | DEFER (still cheap, but no verb leverage; iter-7) |
| 6 | Patrol direction easing | ~5 | Weak — opponent already stationary in attack states; feint will *add* a new stationary state | DEFER |
| 7 | Player knockback decay tuning | ~1 | Weak — current asymmetry (player 0.06 s halflife vs lerp 0.15 s) is by design after iter-5 channel split; the channel decays at the *opponent* rate so they match each other. Don't churn. | DEFER |
| 8 | Uppercut trail / chevrons | ~5 | Weak — uppercut shipped iter-5 and reads fine; spending budget here pulls from new-verb composition | DEFER |
| 9 | Crouch transition easing | — | Harmful (iter-5 verdict still stands: hurtbox desync) | NEVER |

**Recommended budget: ~18 LOC** for picks 1–3. Leaves 7 LOC for slack on the divepunch/feint specs (which always overflow) and optionally pick 4 if the iter comes in lean.

Rationale on pick 7 (the prompt's "knockback decay reads snappy" prompt): re-checked the math. After iter-5, `player.knockbackVx` and `opponent.knockback` use the *same* `pow(0.7, dt*60)` decay (game.js:168, 261). They are symmetric to each other. The lerp at line 163 governs **input vx**, which is a separate channel; comparing input-lerp halflife to knockback halflife is comparing apples to oranges now. The "snappy" read is real but it's the **shared** decay rate of both fighters, not an asymmetry — easing only the player would *re-introduce* asymmetry. Defer entirely; if it surfaces in playtest, tune both at once.

---

## Pick 1 — Walk leg cycle (alternating tripod)

**Where.** `game.js:376-423` (`drawStick`) — specifically the legs line at `game.js:421` (`ctx.fillText('/ \\', x, y - 10);`). Player x/vx live at `game.js:32, 163-165`; opponent x at `game.js:50-51` (no vx field — patrol moves x directly at line 266).

**Why it hurts now.** Figure glides. With **divepunch** shipping, the player will be airborne more frequently; every *return* to ground is a moment where the eye expects gait to resume. Static `/ \` legs make every landing read like a teleport. Walk cycle is the cheapest visual that reinforces "I am running across the ground" — and it's the same primitive that signals "post-divepunch I am moving again," which is a clarity win for the new airborne verb's recovery.

Composes with **feint** secondarily: feints in fighting games are usually *step* feints. If the opponent feint involves any visible motion (even a 4–6 px hop forward then retract), animated legs make the bait read as footwork instead of a glyph blink. If opponent feint is glyph-only this iter, walk-cycle still doesn't lose value — it's groundwork.

**Fix sketch (~8 LOC).**

Phase accumulator on the player only (opponent patrol is so slow ~96 px/s that gait is barely visible; spending LOC on opponent legs is low-ROI this iter — defer). Add to player literal at `game.js:48` (just before closing brace):
```
walkPhase: 0,
```

Reset in `resetMatch` at `game.js:108`: `player.walkPhase = 0;`

Advance in update — insert after `game.js:165` (`player.x += player.vx * dt;`):
```
player.walkPhase += Math.abs(player.vx) * dt;
```

In `drawStick` at `game.js:421`, swap the static legs for a phase-driven flip. Add `walkPhase = 0` to opts destructure at `game.js:377-380`. Replace line 421:
```
const stride = (walkPhase % 64) < 32 ? '/ \\' : '\\ /';
ctx.fillText(airborne ? '/ \\' : stride, x, y - 10);
```
(`airborne` keeps legs neutral mid-air — diving, jumping, post-divepunch arc all read as one frozen pose. Walk cycle is **ground-only**.)

Pass it from the player render call at `game.js:471-477`: add `walkPhase: player.walkPhase,`.

**Tuning.** 64-px stride period at 192 px/s = ~3 Hz cadence. That's brisk-but-readable; matches the 20px font cell so each stride aligns to one figure-width. If it feels twitchy in playtest, bump to 96 (2 Hz).

**Edge cases.**
- `whiffLock` zeroes `move` (game.js:161) but `vx` decays via lerp over ~0.15 s — phase keeps advancing during that window, which actually *helps* sell the off-balance follow-through (composes with pick 3).
- Crouch path at `game.js:386-391` returns early before reaching the legs line — crouch pose unaffected. Correct.
- Knockback channel adds to `player.x` but not `player.vx` (post-iter-5) — knockback slide currently reads as *not walking*, which is correct (player is being shoved, not stepping). If we wanted shove-foot-drag, we'd add `Math.abs(knockbackVx)` to the phase too — skip this iter.

**LOC.** ~8.

---

## Pick 2 — Pulsing recovery `~` glyph

**Where.** `game.js:514-520` (the recovery glyph render block, shipped iter-5 pick 4).

**Why it hurts now.** Static `~` in `#888` is *present* but visually low-attention by design. With **feint** shipping, the player's parsing problem inverts: they will be trained by feint to **doubt** every windup. The recovery state is the moment doubt should resolve — "the attack happened, the punish window is open *now*." A subtle pulse turns the glyph from a label into a beacon, which is exactly the role it needs to play once feints are introducing read-uncertainty upstream.

This is the highest-ROI single change in this iteration's smoothness budget. ~4 LOC, directly anchors the new gameplay verb's clarity.

**Fix sketch (~4 LOC).**

Replace the 5 lines at `game.js:514-520` with a sin-pulse on alpha (or scale — alpha is cheaper, no font swap):
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

Net delta: 1 added line (the `pulse` computation) + 1 changed line (`fillStyle`). ~4 LOC budget covers it conservatively (with the inline tuning probably landing at +2 net).

**Tuning.** `performance.now() / 90` → period ~565 ms, slightly slower than human pulse (~750 ms). Faster than that reads as panic, slower reads as ambient. The 0.65–1.0 alpha range keeps the glyph always-readable (no visibility gap on the dim frame).

**Edge cases.**
- Hitstop pauses update but **render still runs** (game.js:535-542, render is unconditional) — pulse continues during hitstop. Correct: even when the world freezes for 67 ms post-hit, the punish-window beacon keeps living. Reads as "the moment you can act."
- No frame-rate dependency: uses `performance.now()` directly, not dt-accumulated. Correct.
- Color choice: `rgb(200,200,200)` is slightly brighter than the existing `#888` peak — intentional. The pulse should out-attention the static cue it replaces.

**Composes with feint.** When the feint resolves to "no attack," the player needs to *not* see a recovery glyph (because nothing happened to recover from). Feint state will presumably skip the recovery state entirely → pulse never fires for feints → pulse becomes a reliable "yes, real attack just landed/whiffed, you may strike." Clean semantic separation. Worth coordinating with the feint spec: feint should transition `windup → idle` (not `windup → recovery`), so the recovery cue's meaning stays narrow.

**LOC.** ~4.

---

## Pick 3 — Off-balance lean during `whiffLock`

**Where.** `game.js:200` (whiffLock tick), `game.js:252` (`player.whiffLock = WHIFF_LOCK` set), and `drawStick` at `game.js:376-423` (figure pose).

**Why it hurts now.** `whiffLock` zeroes input (`move = 0` at line 161) so the figure correctly stops walking, but the *body* never reads as "off-balance." It just becomes a stationary `/|\` figure for 0.35 s — same pose as idle. Player who whiffed loses 350 ms of reaction-feedback: they don't *feel* the commit cost, they just feel input lag. This is the cleanest place to add a "you whiffed" body-language signal.

Composes with **feint**: when the player reacts to a feint with their own punch and that punch whiffs (because the opponent didn't actually attack, so there's nothing to hit if the player swung at the windup pose), the lean is the visual that connects "you got baited" to "you are now committed." Without the lean, getting feinted reads as "my punch button didn't work."

Composes with **divepunch**: divepunch will likely have its own air-whiff penalty (probably a longer lockout or a vulnerable landing). The same lean primitive — figure tilted forward over its base — drops in there as `airWhiffLock` posing. One pattern, two verbs, future-proof.

**Fix sketch (~6 LOC).**

Add `whiffLock = 0` (or a derived `whiffT`) to `drawStick` opts at `game.js:377-380`. Compute the lean offset and apply to head + arms (legs stay anchored, that's the "off-balance" read — feet planted, torso tipped over them).

Inside the non-crouch branch, before the existing head/arms `fillText` calls (line 393):
```
const leanOff = whiffLock > 0 ? facing * 4 * Math.min(1, whiffLock / 0.15) : 0;
```
Then offset the head + arms x by `leanOff`:
- Line 393: `ctx.fillText('O', x + leanOff, y - 50);`
- Line 415 / 418: arms `fillText` x becomes `x + leanOff`
- Legs at line 421: **unchanged** (anchored).

Pass from render call at `game.js:471-477`: `whiffLock: player.whiffLock,`.

**Tuning.** 4 px lean over the *first 0.15 s* of `whiffLock` (the early portion when commitment is freshest), then holds at full lean for the remainder. Anchored release: when `whiffLock` ticks from 0.15 → 0, the lean stays at max — figure springs back to upright on the *transition out*, which reads as "regained balance." If the snap-back feels too abrupt, switch to easing back over the last 0.05 s with `Math.min(1, whiffLock / 0.05)` instead of `0.15` — but the snap is probably fine and cheaper.

**Edge cases.**
- `whiffLock` only triggers on **standing** punch miss (game.js:252), and crouch path returns early in `drawStick` before reaching the lean code — crouch + uppercut whiff is currently lock-free per iter-5 spec, so no interaction.
- Punch animation overlap: if punch animation is mid-play when whiffLock fires, both run together (punchTimer continues to tick at line 197). Lean offsets the figure; punch animation already offsets the *fist* relative to the figure — they compose linearly. Eyeball-ok. If it reads as "whole figure shoved," reduce the lean to 3 px.
- Knockback channel adds to `player.x`: knockback shoves the whole figure (drawStick is called at the new x). Lean is *additive* to that. Whiff + immediate jab-counter = figure leans forward AND slides backward → reads as "leaning into the punch you just ate." Correct, accidental beauty.

**LOC.** ~6.

---

## LOC tally

| # | Pick | LOC |
|---|---|---|
| 1 | Walk leg cycle | ~8 |
| 2 | Pulsing recovery glyph | ~4 |
| 3 | Off-balance lean on whiffLock | ~6 |

**Total: ~18 LOC.** Under the 25 cap with ~7 LOC slack. Slack is real (not aspirational): the three picks are local, well-bounded, and the figures above are conservative.

If divepunch + feint come in lean and the orchestrator wants to fold a 4th pick, **HP bar tail darken** (`#8a4a4a` → `#5a2a2a`, with optional 1-LOC stripe pattern via `ctx.fillRect` tile) is the highest-ROI 3-LOC add — it's been on the table two iterations and the bar fill swap is mechanical.

---

## Deferred

- **Subpixel snap** — still cheap, still global, still uncomposed. Iter-7 with whatever's next. Not a regression risk to keep deferring.
- **Patrol direction easing** — feint will *add* opponent stationary states, further reducing the fraction of time the patrol-flip discontinuity is visible. ROI keeps shrinking. Drop from the list permanently if iter-7 still shows no leverage.
- **Player knockback decay tuning** — re-checked vs iter-5 channel split: player and opponent now share the `pow(0.7, dt*60)` decay. They are symmetric to each other; the lerp comparison the prompt cited is comparing input-channel lerp to knockback-channel decay, which are different physics. Don't churn the decay constant; revisit only if playtest flags asymmetry between fighters.
- **Uppercut trail / chevron swap** — uppercut is reading fine post-iter-5; visual budget better spent on the two new verbs' clarity.
- **HP bar tail darker** — slack candidate (see tally). Genuinely cheap if folded in, defer-able if budget tightens.
- **Crouch transition easing** — still actively harmful, per iter-5. Permanent skip.
