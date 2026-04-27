# Iteration 5 — Playtest Report

Traced from `game.js`, `index.html`, `style.css`. Numbers cross-checked against constants in §header. Iter 5 of 15 — be honest, things are improving but the core loop has new sharp edges.

---

## 1 — First jab encounter

**Spawn:** player.x = 250, opponent.x = 640, GROUND_Y = 420. dx = 390. Opponent patrols [480, 800], `patrolDir = -1` so it walks left at 96 px/s. Player walks right at 192 px/s.

**Closure rate:** 288 px/s while both move. Jab trigger condition: `dx < JAB_RANGE (80) && dx > CONTACT_RANGE (10)` and `opponent.state === 'idle'` and `stateTimer <= 0`. From spawn: 390 - 80 = 310 px to cross at 288 px/s = **1.08 s** until first windup.

**Trigger distance:** dx just below 80 px. The state flip happens on the frame `dx < 80`. The visual `!` glyph is drawn at `opponent.y - 78` immediately on the same frame.

**Reaction window:** JAB_WINDUP = 0.5 s. That is generous — human reactions are ~0.25 s, so the player has ~0.25 s of slack to press S. Good. But note: the `!` is small (16 px) and 78 px above the head — peripheral readability is mediocre. No color flash on the opponent during windup. A first-time player will likely eat the first jab.

**Crouch math (re-verified):** fistY = opponent.y - 50. bandHi(crouch) = player.y - 65 + 16 = player.y - 49. Same y for both → fistY (−50) vs bandHi (−49): `-50 > -49` is **false** → whiff. Confirmed.

**Punish window:** JAB_ACTIVE 0.12 s + JAB_RECOVERY 0.35 s = 0.47 s of stationary opponent after the player crouches. Counter-punch math: see §2.

---

## 2 — Counter-punch loop

**Geometry.** Player punch hits at fistX = player.x + facing * 38, tol 28. Hit when |fistX − opponent.x| < 28 ⇒ dx ∈ [10, 66] for facing=+1. Outside this range, punch whiffs.

**Where is the player when recovery starts?** They were crouching during windup+active = 0.62 s. Crouch zeroes vx (line 158). So the player is at the same x they crouched at — call it dx ≈ 80 (or a bit less if they were still moving when they pressed S; vx-lerp eats some distance, but conservatively dx ≈ 78–80).

**Walk-up.** Recovery starts. Player releases S (instant: just stop holding the key). Player walks forward. Need to close 80 − 66 = 14 px to enter punch reach. Time = 14 / 192 = **0.073 s**. Adding vx-lerp ramp (target 192, factor `1 − (1−0.25)^(dt*60)` per frame; reaches 80% in ~3 frames at 60 fps ≈ 0.05 s), call it 0.1 s of effective walk.

**Punch buffer.** PUNCH_BUFFER = 0.1 s, so pressing J slightly early still fires when cooldown clears. Fine — but punchCooldown is 0 here (no prior punch), so press fires immediately.

**Counter window math.** 0.35 s recovery − 0.10 s walk-up = **0.25 s of slack** to press J. Plenty for a deliberate input. The punch hit-test runs on the same frame J is processed. counter = (opponent.state === 'recovery') → true. Damage = round(8 × 1.5) = **12**. Knockback 540 px/s, hitstop 0.1 s.

**Crouched player standing back up.** There is *no* standup latency. `player.crouching = onGround && (S held)`. Release S, next frame `crouching = false`, `vx` is again writable. So the loop is clean: hold S during windup+active, release S the moment recovery starts, walk + punch. Works.

**Caveat.** If the player stays crouched out of caution past the active window, every frame of "crouched in recovery" eats 192 px/s of would-be travel. Crouching for the full 0.47 s instead of 0.12 s costs 0.35 × 192 = 67 px of approach — exactly the entire punish window. **Tight margin in practice if the player can't read the active→recovery transition.** There is no visual cue for state transition (the `====` fist disappears, but no recovery glyph). This is the iter-5 bug-of-feel.

---

## 3 — Steady rhythm, K.O. count

**Cycle once stabilized:** windup 0.5 + active 0.12 + recovery 0.35 + idle JAB_COOLDOWN 1.2 = **2.17 s** between jabs (assuming idle gate runs full duration; opponent immediately re-triggers windup once `stateTimer <= 0` and dx < 80).

**Counter rhythm.** Counter sets `opponent.stateTimer = JAB_COOLDOWN * 1.0 = 1.2 s` after knockback decays. Knockback 540 px/s decays via `*= 0.7^(dt*60)`. After ~0.2 s the velocity is below 6 → knockback "ends" and the cooldown timer begins. So a counter delays the next jab by knockback-time + 1.2 s ≈ 1.4 s, plus the player has to chase because opponent slid back by ~⌊540 × ∫0.7^(60t) dt⌋ ≈ 130 px of knockback travel.

That's a problem. After every successful counter, the opponent is shoved 130 px out of jab range. Player must walk back in (130/192 = 0.68 s) before the next jab triggers. So the *real* counter cycle is:

- 0.5 windup + 0.12 active + ~0.10 react/walk + 0.07 punch-frame-in-range + 0.20 knockback slide + 0.68 chase + 1.2 cooldown ≈ **2.87 s per counter**, dealing 12 dmg.

**K.O. count, pure counters.** ceil(100 / 12) = **9 counters** = ~26 s of fight. Net pace is reasonable, not boring.

**Predictability.** The cycle is 100% deterministic — same windup duration, same recovery duration, same cooldown. No mix-up, no fake-out, no spacing variance. After 2 successful counters the player has memorized the timing. Iter 5 ships a *readable* AI but not yet an *interesting* one. **The game becomes dexterity-trivial by counter #3.**

**Chip on miss.** Missing a counter (whiffing the punch in recovery) costs nothing — opponent enters idle 0.6 s anyway (line 197: `JAB_COOLDOWN * 0.5` only on hit; on miss the recovery branch sets it to full 1.2 s when transitioning idle). Wait, re-read: line 260 sets `stateTimer = JAB_COOLDOWN` on idle entry from recovery. So whiffing the punch costs the player nothing — the opponent re-cycles in 1.2 s either way. **No punishment for greedy mashing during recovery beyond "you wasted your punch cooldown 0.3 s".** Mild.

---

## 4 — Crouch standstill math (max-distance trigger)

**Setup.** Player crouches at dx ≈ 80 (jab triggers exactly here). Player cannot move during windup+active (0.62 s). Player releases S at active→recovery; recovery is 0.35 s. **Walk window = 0.35 × 192 = 67.2 px.**

**Required closure to land counter:** dx must reach ≤ 66 (PUNCH_REACH 38 + JAB_HIT_TOL 28). Starting dx = 80, need to close 14 px. **67 px of walk window vs 14 px needed → 4.8× headroom.** Comfortable.

**Edge case — player crouches early at dx = 100.** Opponent does not trigger jab (dx > 80). Player wastes a crouch, opponent walks closer (96 px/s) then triggers at dx=80, by which time the player has held crouch ~0.2 s already. No harm beyond looking foolish.

**Edge case — player crouches at dx = 50 (e.g. mash-walked in too far).** dx < 80 triggers jab fine. fistX = opponent.x − 32 → |fistX − player.x| = |dx − 32| = 18 < 28 → **jab connects** even on a crouch-band check. Wait — the crouch hurtbox check still applies: bandHi = −49, fistY = −50, whiff. So crouch saves the player at any dx in [10, 80]. Good.

**Edge case — player crouches *during* active.** If S is pressed mid-active (ongoing jab swing), the next frame the band shifts and the existing fistY (-50) goes above bandHi (-49). But `opponent.jabHit` may already be true if it landed in the prior frame. If jab connected at dx=40 standing, jabHit=true for the rest of active — so subsequent crouch input cannot save you. As designed (consistent with one-hit-per-swing). Fine.

---

## 5 — Crouch + punch

**Trace.** Player holds S, presses J. `player.crouching = true`. The punch input/buffer code (lines 179–205) does not check `crouching`. So:

1. `wantPunch` true → `punchBuffer = 0.1`.
2. Next condition: `punchBuffer > 0 && punchCooldown <= 0` → fires.
3. fistX = player.x + facing * 38. fistY = **player.y − 50**.
4. Hit-test: `Math.abs(fistX - opponent.x) < 28 && fistY > opponent.y - 65 && fistY < opponent.y - 5` → standard standing band.
5. If opponent in range, **damage applied**.

But `drawStick` early-returns on `crouch: true` (line 338) without drawing any punch animation. **The fist is invisible but lethal.** This is a real bug:
- A player can mash J while crouching the jab and damage the opponent during the active window itself, no recovery wait, no risk.
- Visual: just the crouch sprite. Audio/visual feedback: only the opponent's hitFlash and HP bar. The player has no idea their own stick threw a punch.

**Severity.** Damage path works (dmg goes through, counter detection works, hitstop works). Geometry: at dx=40 and crouching, fistX from player = 40+38 = +78 from player.x = opponent.x + 38 (since opponent at dx=40 right of player) — wait re-trace: player.x=200, opponent.x=240, dx=40. fistX = 200 + 1*38 = 238. |238 - 240| = 2 < 28 → connects. Yes.

**This invalidates the "commit cost" intent of crouch.** The synthesis (§5 line 167) explicitly notes this is intentional — "Odd but not broken" — but in practice it lets the player skip the entire dodge→stand→walk→punch loop and just hold S+J. Crouch becomes a dominant strategy: hurtbox down + free punches.

**Recommend:** either gate punch on `!player.crouching`, or render a crouch-punch pose so at least it's visible. Probably the former — crouch should be a defensive commitment.

---

## 6 — Jab self-defeat at max range

**Trace.** Opponent triggers windup at dx = 80 − ε. During windup (0.5 s), opponent stationary; player can move. **Case A: player stops or retreats.** dx remains ≈ 80 or grows.

At active: oppFacing = −1 (player to opponent's left). oppFistX = opponent.x − 32. Player at opponent.x − 80 → |fistX − player.x| = |opponent.x − 32 − (opponent.x − 80)| = **|48| = 48**.

JAB_HIT_TOL = 28. 48 > 28 → **whiff, no crouch needed.** Confirmed.

**Range that lands without crouch:** |dx − 32| < 28 → dx ∈ (4, 60). Combined with trigger requiring dx > 10: **lands at dx ∈ (10, 60).** Trigger at dx ∈ (60, 80) is a guaranteed self-whiff if the player doesn't close.

**Implication.** A player who walks in to ~78 px and stops triggers a free 0.5 + 0.12 + 0.35 = 0.97 s vulnerability window with no risk. They can walk forward 14 px during recovery to land a non-counter punch (8 dmg) — actually a *counter* if they catch recovery (12 dmg). Probably the strongest legitimate strategy in the build.

**Even worse:** the trigger band (60, 80) is a 20-px sweet spot. WALK_SPEED 192 px/s — player can dance in/out of this band trivially. **Bait → free counter loop, no crouch required.**

**Fix:** raise JAB_HIT_TOL to ~50 so jab covers the full trigger range, OR shrink JAB_RANGE to 60 so trigger only happens when jab can actually reach. Latter is cleaner.

---

## 7 — Persisting issues

**Jump.** Still useless. Jump arc: vy = -720, gravity 2160 → apex at 720/2160 = 0.333 s, peak height 720²/(2·2160) = 120 px. Total air time 0.667 s. During flight, player is airborne → they cannot crouch. Punch still uses fistY = player.y − 50, so a punch at apex is at GROUND_Y − 170. Opponent band is opponent.y − 5 to opponent.y − 65 = GROUND_Y − 65 to GROUND_Y − 5. fistY − 170 < bandHi − 65 → **above band, whiff**. Air punch literally cannot connect. Synthesis 4 §6.2 already noted this; iter 4 didn't fix it. Jump is a key with no purpose. (Actually worse: jumping into jab range = guaranteed jab hit, since airborne hurtbox is identical to standing.)

**CONTACT_RANGE / PUNCH gap.** dx ∈ [0, 10] is contact (4 dmg, 0.5 s cooldown). dx ∈ [10, 66] is punch range. Gap closed via `dx > CONTACT_RANGE` jab guard — when player overlaps to dx<10, jab does not trigger. But **contact damage still hits the player (4 dmg every 0.5 s)**, and the opponent does NOT jab. So bumrushing past jab range into contact gives the player free 4-dmg-per-0.5-s ticks against them in exchange for unfettered punching at dx=10–dx=actually-wait. At dx<10 the player is too close for their own punch (PUNCH_REACH 38 but the band is centered at fistX = player.x + 38; dx=5 → fistX is 43 from opponent on the wrong side, |43| > 28, whiff). So bumrushing dx<10 = *both* players whiff their jabs/punches and the player just bleeds 8 dmg/s. Bad trade.

**At dx exactly 10:** jab guard requires `dx > 10` → no jab. Contact requires `dx < 10` → no contact. Player punch needs |dx − 38| < 28 → dx ∈ (10, 66) → at dx=10 is borderline (uses `<` so 10 not included; |10-38|=28, `28 < 28` false → no hit). **dx = 10 is a complete dead zone**, no damage in either direction. Floating-point flicker decides outcomes. Minor but annoying.

**Mash-during-K.O.** Pick 3 added `opponent.hp > 0` to the punch hit-test. Verified line 190: `opponent.hp > 0` in conditional. Works. Buffered Js post-K.O. still increment `punchAttempts` (intended) but not `punchesLanded`, and don't re-extend hitstop. Fixed.

**Wall corners.** Player clamp [40, 860], opponent patrol [480, 800]. Player can be pinned between left wall and approaching opponent if they walk left into the wall. Opponent patrolMin = 480, so opponent can't get closer than 480. Player at left wall = 40. dx = 440 — way out of jab range. **Wall corners are now functionally just spawn space, irrelevant to combat.** OK outcome — corners aren't trap, but also aren't tactical. Synthesis 4 chose deletion of the dead wall-shove branch over expanding patrolMax; that decision still holds.

**Contact damage frequency.** Pre-iter-4, walking into the opponent dealt contact damage. Now the opponent jabs at dx<80 long before contact. **Contact damage path is reachable only by:**
1. Bumrushing during the 1.2-s idle cooldown (dx < 10 before opponent re-triggers).
2. Catching the opponent in active/recovery (movement frozen) and walking through them.
3. Knockback shoving the opponent into the player after a hit.

Rare. Most players will never see contact damage in iter-5. CONTACT system is now vestigial — consider removing in iter 6 if no plan resurfaces it.

---

## Summary verdict (iter 5 of 15)

**What works.**
- Crouch dodge math is clean (1-px hurtbox shift, but it's the right 1 px).
- 0.5 s telegraph is humane; 0.12 s active is punishing-but-fair.
- Counter-punch payoff (12 dmg, heavier knockback, longer hitstop) is felt.

**What's broken.**
- **Crouch + punch is a dominant strategy** (§5). Hold S+spam J.
- **Jab self-whiffs at dx ∈ (60, 80)** (§6). Free-counter cheese.
- Jump still has no purpose (§7).
- AI is fully deterministic — two counters and the player has solved the game (§3).
- No visual cue for active→recovery transition (§2 caveat).
- dx=10 dead zone (§7), CONTACT subsystem is vestigial (§7).

**Top priority for iter 6:** gate punch on `!crouching` AND fix the jab range/tol mismatch. These two together restore the bait-counter loop's intended commitment cost.

**Second priority:** add some form of mix-up — variable windup (0.4–0.7 s), or a second attack option (low/grab) — so the player can't memorize the rhythm in 3 cycles. Without this the game peaks here.
