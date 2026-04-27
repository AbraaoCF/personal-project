# Iteration 3 — Playtest Report

Frame-by-frame trace against `game.js` post-iter-2. Numbers are honest; vibes are
tagged as such. Assume 60 Hz, ground combat, player on the left (facing=1) unless
stated. Reference: `game.js:55-68` for constants, `:158-173` for punch fire,
`:195-202` for contact, `:119-123` for hitstop, `:255-279` for punch render.

---

## 1. Hit-zone tuning — CONTACT_RANGE=10, punch tol=28

Trace, facing=1 so dx = opponent.x - player.x:
- Punch fires when `|fistX - op.x| < 28` with `fistX = player.x + 38`.
  → `|38 - dx| < 28` → dx ∈ (10, 66) lands a punch.
- Contact fires when `|dx| < 10` → dx ∈ [0, 10).

The seam at dx = 10 is now a strict no-op frame: punch test is `28 < 28` (false),
contact test is `10 < 10` (false). Honest.

But there's a **new asymmetry the synthesis got wrong.** It claimed dx=9 is a
"body-check, both fire". Trace it: `|38 - 9| = 29`, not `< 28` → punch
**misses**. So the dx ∈ [0, 10) band fires contact damage *only*, no punch
landing. The "over-commit punishment" is actually "you whiff your punch AND eat
contact damage". That's worse than iter-1's overlap, just in a different way:
the player who walks one pixel too far in loses 4 HP and gets nothing in return.

Walking-through-the-boundary edge case: with WALK_SPEED=3.2 and VX_LERP=0.25,
the player crosses dx=10→9→6→3 within ~2 frames of approach. Frame N at dx=12:
punch hits (`|38-12|=26 < 28`). Frame N+1 at dx=8: punch missed-window now,
contact triggers. If the player held J across both frames (re-pressing every
frame thanks to buffer), they could punch on frame N and eat contact on N+1 —
that's fine, intended. But if the player's first press lands *on* frame N+1
because of buffer, they get 4 dmg and no punch. Frustrating and invisible.

The contact range is also still **vertically unchecked** (`:196` only checks
`contactDx`). Player jumping straight over the opponent — legs at op.y while
torso clears — still eats 4 HP per 30 frames. Not new, but the iter-2 changes
didn't touch it, and it makes the jump tax compound (see §6).

Verdict: the seam is clean numerically; the **inner band (dx<10) is meaner
than designed**. Either widen the punch tolerance to 30 so the inner overlap
returns deliberately, or add a second "close jab" range for dx<10.

---

## 2. Buffered punch — 6 frames, mash test

`PUNCH_BUFFER_FRAMES=6`, `PUNCH_COOLDOWN_FRAMES=18`.

Single press 1–6 frames before cooldown clears: fires on the clear frame.
Honest forgiveness, ~100 ms. Feels right.

Mash three presses in 0.2 s (60 Hz: presses at frames 0, 6, 12):
- f0: fires, cooldown=18, buffer=0.
- f6: press → buffer=6. Cooldown=12. Buffer ticks 6→0 by f12; cooldown=6.
  **Press 2 is silently dropped** at f12.
- f12: press → buffer=6. Cooldown=6. Buffer ticks 6→0 by f18; cooldown=0
  on f18 — fires.
- f18 fire: cooldown=18 again.

Net: 3 presses, 2 fires. The second press evaporates. To actually land all 3,
the player has to time press 2 in the last 6 frames of cooldown (frames
12–17 post-fire). Mash-fast is *punished*, mash-rhythmically is rewarded —
but the player has no feedback that this is the rule. No "punch denied" sound
or visual.

Hold-J: `wantPunch = keysPressed.has('j')` — `keysPressed` is edge-only (cleared
each frame, only re-added on `keydown`). Holding J does not refire after the
first frame. Good — autofire is impossible.

But there's a **buffer-during-hitstop edge case.** Hitstop's early return
(`:119`) clears `keysPressed` and skips the buffer decrement. So a press just
before a hit freezes is preserved across all 4 freeze frames as buffer=6 (if
buffer was set on the hit frame's update before the freeze took). On the
post-freeze frame, buffer still ≥ 2, cooldown ticks normally — buffered press
fires when cooldown allows. This is actually *correct*, but presses *during*
the freeze are wiped. See §3.

Verdict: 6 is fine for forgiveness. The silent drop on fast mashing is the
real problem. Either lengthen buffer (8–10 frames so any press in the last
half of cooldown sticks) or — better — show the player when a press was
dropped (flash the cooldown bar, even just for one frame).

---

## 3. Hitstop felt-quality — 4 frames

`HITSTOP_FRAMES=4` ≈ 67 ms. In the right ballpark for fighting games (Smash
uses 4–8, Skullgirls 6–12). 4 is on the low end but readable.

**Input loss is real and underexamined.** From `:119-123`:

```
if (hitstop > 0) { hitstop--; keysPressed.clear(); return; }
```

A press during the 4 frozen frames hits `keysPressed`, then is wiped on the
next early-return. The player's "react to the hit, jump back" press is eaten
if it falls inside the freeze. 4 frames is short enough that most players
won't notice — but a panicked-jump after eating a contact tick *will*
sometimes vanish. Reproducer: stand at dx=11, opponent walks into you at
op.x decreasing by 1.6/frame, dx hits 9 → contact + hitstop. Player presses
W on freeze frame 1 — lost. Player presses W on freeze frame 5 (post-freeze)
— jumps. The window for "lost W" is 4/60 = 67 ms; humans definitely produce
presses inside that.

This also breaks the buffered-punch promise asymmetrically: a punch press
*before* hitstop is preserved, but a press *during* hitstop is gone. Players
will see "I pressed J right when I got hit and nothing happened".

**Hitflash and punchTimer freeze correctly.** `:175` (opponent.hitFlash--) and
`:152` (player.punchTimer--) are below the early return. So during the 4
freeze frames, hitFlash holds at 8 (full red), punchTimer holds at whatever
value triggered. Good.

**Double-hit same frame:** trace fire path — punch fires at `:158`, sets
hitstop=4. Then on `:196` contact also fires (if dx<10), sets hitstop=4
again. No stacking, single freeze. Correct.

Verdict: the freeze duration is fine; the input-clear is too aggressive.
Drop `keysPressed.clear()` from the hitstop branch so presses queue up to
post-freeze, OR keep it and at least preserve `punchBuffer` (already done
implicitly) and `wantJump` (currently lost). Jump inputs during hitstop are
the loudest miss.

---

## 4. Animated punch — easeOutCubic + hold + hitstop

The curve from `:255-279` looks correct in isolation. The bug is **when the
hit registers vs. when the arm is visibly out.**

Trace fire frame (let's call it F0):
- `:151-153`: timer decrements ran first. punchTimer was 0, stays 0 here.
- `:158`: buffer>0, cooldown==0 → fire. Set `punchTimer = 12`.
- `:166`: hit detected, set `hitstop = 4`.
- Render F0: `punchT = 1 - 12/12 = 0`. Off = `-4 * 0 = 0`, condition `off > 0`
  is false → draw default `/|\` torso, **no `'===='` glyph.**

So on the impact frame, the player isn't visibly punching. Then hitstop kicks
in for frames F1–F4. Update early-returns; punchTimer stays at 12; render
sees punchT = 0 every frame. **Four frames of frozen no-arm pose with the
opponent flashing red.** That reads as "the opponent got hit by nothing."

Post-freeze frames render at punchT = 1/12, 2/12, ... 11/12. Windup
band (t<0.20) covers timer=12..10. Arm first becomes visible (off>0) at
timer=9 (t=0.25), where off ≈ 11.6 px. Full extension (off≈38) at timer=5
(t≈0.583, hold band). So **the arm is hidden for the first 7 render frames
post-hit** — 117 ms of latency between damage and visual.

The contact moment is supposed to land in the hold band, per the synthesis.
**It's actually at windup-start** because hitstop fires on the same frame the
timer is set, before any decrement. The freeze captures the wrong pose.

**punchTimer-hits-0 edge case:** last frame with arm visible is timer=1,
t=0.917, retract tt=0.583, off = 38·(1-0.583) ≈ 15.8. Next frame timer=0,
condition `playerPunchT = -1`, draws `/|\`. Visible pop of ~16 px from
horizontal arm to vertical torso. Minor compared to the hitstop bug above.

Verdict: **the hitstop pose is broken.** Fix by either initializing
punchTimer to a smaller value (e.g. 7) so first render lands mid-extend, or
reordering the timer decrement after the fire block. Until then, the
easeOutCubic and hold pose are mostly invisible — the player sees flash +
freeze + delayed-arm-flop.

---

## 5. Combat loop — is the dance interesting?

Marginally. Better than iter-1, still very legible.

Honest-hit-window: rewards walk-up-and-jab at dx ≈ 30, which is most of the
punch band. With WALK_SPEED 3.2 and OPPONENT_SPEED 1.6, the player closes the
gap at 4.8 px/frame on opponent approach, 1.6 px/frame on retreat. To hit-and-
fade: punch at dx=30 (`fistX-op.x = 38-30 = 8`, hits), retreat at vx=-3.2 →
dx grows by 4.8/frame on opponent-approach phase, 1.6 only when chasing. Stay
out of dx<10 and the player loses ~0 HP.

Math: 100 HP / 8 dmg per punch = 12.5 punches to KO. Cooldown 18 frames =
0.3 s. Best case 12.5 · 0.3 = 3.75 s of pure punch chain. With opponent
movement and re-aim, realistic 5–7 s per match.

Player damage: opponent contact only triggers at dx<10, cooldown 30 frames.
A reckless player eats 4 HP per 30 frames = ~13 ticks to KO over ~6.5 s of
sustained body-checking. The patrol opponent doesn't seek, so contact damage
only happens if the player walks into it. **The opponent is still passive
furniture.** No threat means no dance.

The "interesting" parts are still all on the player's side: punch timing,
buffer-respecting mash rhythm, dx-band awareness. The opponent contributes
two patterns: pacing left-right and being knocked back. No commitment, no
opening, no telegraph. This is the persisting blocker — combat depth scales
with opponent behavior, and iter-2 didn't touch the opponent.

Verdict: the dance has *form* now. It does not yet have a partner.

---

## 6. Persisting frustrations

1. **Wall corral on the right.** Player at x=782 (dx=18 from op at 800),
   punches, knocks op to x=806 → patrol clamps to 800, flips dir. Player
   re-approaches at 3.2/frame, op retreats at 1.6/frame; player closes the
   1.6 px/frame gap and lands the next punch at cooldown clear. Op cannot
   escape. Same-as-iter-1 lawnmower. Synthesis deferred this; still a real
   issue.

2. **Jump is still strictly worse.** fistY > op.y-65 needs `player.y > GROUND_Y
   - 15`. Jump apex 120 px above ground (`v²/2g = 144/1.2`). So during the
   ~26-frame jump arc, the player is in punch-vertical-window for only the
   first ~3 frames going up and last ~3 coming down. Plus contact damage has
   no vertical check, so airborne player at op.y=GROUND_Y-100, op.x=player.x,
   still eats 4 HP. Jump = lose punch ability + keep eating contact. Avoid it.

3. **K.O. is still instant.** `:204-205`: `if (player.hp <= 0) toGameOver()`
   fires immediately on the same frame as the killing hit, before hitstop's
   freeze gets a chance to play (next frame's update sees state=OVER and
   early-returns at `:114`). The killing blow has no impact pause — exactly
   the moment that should feel meatiest is the most abrupt. Also, no death
   animation, no slow-fade. Match goes from full-tilt to overlay screen in
   one frame. Synthesis acknowledged this; still nothing here.

4. **Inner band (dx<10) is a free-damage zone.** As traced in §1: dx ∈ [0, 10)
   gives the opponent contact damage and no punch landing. Either widen punch
   tol slightly (28→30) so the inner band re-overlaps, or add a close-range
   jab that fires instead.

5. **Hitstop input loss for jump/punch presses during freeze.** §3: 67 ms
   window where reactions are silently eaten. Easy fix (drop `keysPressed.clear()`
   from the hitstop branch); high felt-quality return.

6. **Hitstop pose freezes windup, not impact.** §4: the 4-frame freeze shows
   `/|\` (no arm) and a flashing opponent. Reads as a glitch. Probably the
   single loudest visual defect in the build right now.

7. **No "miss" feedback.** When the buffer drops a too-early press (§2), or
   when the player whiffs at dx=68 (just out of range), there's nothing in
   the render to confirm the input was registered. New players will think
   the keyboard is dropping inputs.

8. **Opponent has no agency.** §5. Patrols, gets hit, gets knocked, resumes.
   No attack telegraph means the player can't read or counter — they can only
   manage their own dx-band and cooldown. No combat partner, no game.

Pick at most three of these for iter-3. My ordering, by ratio of felt-impact
to LOC: **(6) hitstop pose**, **(5) hitstop input retention**, **(3) K.O.
hitstop / death animation**. (8) is the largest win available but is a
multi-iteration commitment — defer until the foundation is honest.
