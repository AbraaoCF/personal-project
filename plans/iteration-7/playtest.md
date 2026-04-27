# Iteration 7 — Playtest Report

Source code reviewed: `game.js` (660 LOC), `index.html`, `style.css`. Iteration 6 changes (state-machine reorder, divepunch, feint, walk cycle, pulsing recovery) all present and traced below with concrete numbers.

---

## 1. Stand-trade fix — VERIFIED

**Frame trace at dx=40, opp in `active`, player presses J:**

Update order is now (lines 251–376):
1. Opponent state machine block (lines 251–325): `active` branch (294–313) runs hit-check.
2. Player ground attack resolution (lines 327–376).

At dx=40 (player.x=600, opp.x=640), opp `active`:
- oppFacing = -1; oppFistX = 640 - 32 = 608. `|608 - 600| = 8 < 28` ✓
- oppFistY = opp.y - 50. Player not crouching → bandHi = player.y - 65, bandLo = player.y - 5. -50 ∈ (-65, -5) ✓
- **player.hp -= 12**, knockbackVx = -360, opponent.jabHit = true.
- stateTimer ticks; if it crosses 0 the same frame, transitions to `recovery`.

Then player punch (lines 352–375):
- fistX = 600 + 38 = 638; |638 - 640| = 2 < 28 ✓
- counter = `opponent.state === 'recovery'`. If active→recovery transitioned same frame, counter=true → 12 dmg. Otherwise non-counter → 8 dmg.
- **Mutual trade in all sub-cases.**

Pre-iter-6 exploit (player punch first sets opp.state='idle' → opp's active branch never runs) is closed. The player can no longer eat 0 damage on a dx=40 stand-trade.

---

## 2. Divepunch — physics & geometry

Constants: `JUMP_VELOCITY=-720`, `GRAVITY=2160`, `DIVE_VY_BOOST=540`, `DIVE_VX=320`, `DIVE_FIST_DY=-30`, hit band `(opp.y-80, opp.y-20)`.

**Jump arc.** Apex at t = 720/2160 = **0.333s**. Apex height = (-720)(0.333) + (1080)(0.333²) = **-120 px** (above GROUND_Y).

**Earliest legal dive.** Trigger gate: `!onGround && vy >= 0` (line 235). vy crosses 0 at the apex frame. So earliest dive press fires there. On press, vy becomes 540 (replacement, not added — line 239 `player.vy = DIVE_VY_BOOST`). Note: synthesis claims "boost adds", but the code **replaces** vy with 540. Since at apex vy≈0, the result is the same; for an early-descent dive (vy already positive), the dive could *slow* descent if vy > 540, but practically vy gains only ~9 px/s per frame at 60 fps so this is irrelevant.

**Dive descent from apex.** Solve `120 = 540t + 1080t²`. t² + 0.5t − 0.111 = 0 → t ≈ **0.167s**. Forward travel = 320 × 0.167 = **~53 px**.

**Hit-band entry.** Fist y = player.y − 30. Hits when player.y ∈ (opp.y − 50, opp.y + 10), i.e., within 50 px of GROUND_Y. From apex (y = G−120), descend 70 px → solve `70 = 540t + 1080t²` → t ≈ **0.105s**. Hit window: t ∈ [0.105s, 0.167s] = **~62 ms wide**. Horizontal travel during window: ~20 px (out of 53 px total).

So a dive is committed for ~105 ms before the fist is even threatening, and only the last ~60 ms can land. Tight but the dive's `DIVE_HIT_TOL=28` and band 60 px tall make it forgiving once you're in.

---

## 3. Divepunch counter on windup — geometric verification

Opp body head at y−50; jab band (used by *opponent's* fist on player) is `(player.y−65, player.y−5)`. The dive-vs-opp check uses **(opp.y−80, opp.y−20)** — different band; this is the dive's own hit-band into the opp.

At any descent moment with player.y in (opp.y−50, opp.y+10), fistY in (opp.y−80, opp.y−20). Counter = `opp.state === 'recovery' || opp.state === 'windup'` (line 384) → 1.3× → ceil(11.7) = 12 dmg.

**Geometric purpose ("defeat windup vertically") confirmed.** Opp windup poses extend the arm forward at chest height (~y−50). Dive enters from above into the head/upper-chest band before opp's active fist exits at oppFistX=opp.x−32. As long as the player is roughly above the opp during the window, the dive lands first.

**Dive vs `active` opp** is NOT a counter (excluded from the OR). Mutual hit possible: opp's active hit-check ran first that frame; dive may then deal 9 to a state that hasn't yet transitioned to recovery. Acceptable risk-budget — dive over an active jab is supposed to trade.

---

## 4. Feint reads — distinguishability

**Real jab timeline:** windup 0–0.5s → active 0.5–0.62s → recovery 0.62–0.97s.

**Feint timeline:** windup 0–0.3s → feint 0.3–0.7s (no hit) → idle (cooldown 1.2s). Feint commits at 0.6 × 0.5 = **0.3s**.

**Visual distinction at 0.3s mark.** Bright orange `!` (`#ffcc66`, render 600–606) vs dim grey-yellow `!`/`?` flicker every 100 ms (`#776`, render 625–632). Color & alpha differ — distinguishable but not loud.

**Read budget.** Player reaction floor ~0.25s. Feint commit at 0.3s; player has roughly 0.5 − 0.3 = **0.2s** of pre-active ambiguity remaining if real, or has the entire 0.4s feint window if fake. Counter-mash players who fire on first sight of `!` will whiff into the feint 30% of the time and eat 0.35s whiffLock — putting them inside the next jab cycle if dx stays < 60.

**Verdict on tightness.** Hardcore reads need to wait until ≥ 0.3s before committing. That leaves only ~150 ms of safe-counter window (0.3s flicker-discrimination + 0.25s reaction + ~0.15s of jab travel before the active hits). It's fair but **not generous**. Could be eased by widening the visual gap (e.g., keeping the bright orange but shifting the *glyph* to a sustained `?`), but the current implementation rewards careful play, which is the design goal.

---

## 5. Walk leg cycle visibility

`walkPhase += |vx| * dt` (line 224); stride flips at `phase % 64 < 32`. At WALK_SPEED=192, period = 64/192 = **0.333s** = **3 Hz**.

- Mid-air: drawStick passes `airborne=true` → uses fixed `'/ \\'` (line 521) — phase frozen visually.
- Diving / landingLag: branches return early (lines 472–490) before stride code — also unaffected.
- Knockback: only `x` shifts; `vx` not advanced → phase static during knockback slide. Reads as "shoved" not "walking." ✓

3 Hz is comfortably above flicker fusion threshold. Confirmed visible.

---

## 6. Pulsing recovery `~`

`pulse = 0.65 + 0.35 * sin(performance.now() / 90)` (line 618). Period = 2π × 90 ms = **~565 ms**. Alpha range 0.30–1.00 (sin spans −1 to +1, so 0.65 ± 0.35 = 0.30 to 1.00, **not** 0.65–1.0 as the orchestrator's brief states — minor doc drift).

Recovery duration is 0.35s — about **0.62 of a pulse period**. Player sees roughly half a sine swing during the punish window, enough to notice the alpha modulation without seeing a complete cycle. The pulse keeps running across hitstop because render is unguarded, which is correct (the punish-window beacon stays alive across freezes).

---

## 7. Whiff-lock / landing-lag interaction with contact damage

Contact damage block (lines 402–409) has **no `whiffLock` or `landingLag` gate**: if `dx < CONTACT_RANGE=10` and `contactCooldown <= 0`, player loses 4 hp and `contactCooldown = 0.5s`.

So a player who whiffs a dive on top of the opponent, lands at dx ≈ 0, and sits in 0.4s landingLag will eat **at most one contact tick** (4 hp) during that lag — not repeated, because contactCooldown=0.5 > LANDING_LAG=0.4. Plus the opponent's idle/windup may then also fire during the lag.

**Fairness verdict.** Yes — one 4 hp contact tap on a self-inflicted bad dive is mild. The bigger penalty is being immobile in jab range while opp's next windup primes. Coherent with the design goal that dive is a commitment.

**Edge:** there is no whiffLock penalty on a successful dive (lines 215–220: if `diveHit` is true, no landingLag and no whiffLock set). After a dive HIT, player.vx is zeroed but punch/jump/walk are immediately available. This enables an aggressive **dive→ground-punch on recovering opp** combo: dive (ceil(9*1.3)=12) + immediate counter-punch (ceil(8*1.5)=12) = **24 hp**. Strong but balanced — earned through a successful air read.

---

## 8. Persisting issues / KO math / match length

**Opp → player KO:** JAB_DAMAGE 12, player 100 hp → **9 jabs to KO**. With CONTACT_DAMAGE=4 occasionally adding ~4 per close encounter.

**Player → opp KO** (counter, all 1.3–1.5×):
- Punch counter: 12 → **9 hits** to 100 hp.
- Uppercut counter: 15 → **7 hits**.
- Dive counter: 12 → **9 hits**.
- Mixed perfect-play: ~**7–9 counters**.

**Match length perfect-play.** Each opp full-jab cycle = 0.97s active+recovery + 1.2s cooldown ≈ 2.17s; with 30% feint (0.7s) blended in: weighted mean ≈ 0.7×2.17 + 0.3×(0.7+1.2) = 2.09s per opp cycle. 7 counter punishes = ~**14.6s match**. Still tight; rounds (deferred) will scale it up. Per orchestrator brief, this is ~doubled from iter-5's ~7s baseline — meaningful improvement.

**Missed verbs.** None for the iter-6 budget. The player kit is now: walk, jump, crouch, jab, uppercut (crouch+J), divepunch (air-J descending). Opponent kit: patrol, jab, feint. Symmetric enough for the design phase.

**Balance flags.**
- Stand-trade now 12-for-12 — neutral mathematically; counter is the safe play.
- Crouch counter remains the lowest-risk option vs real jab (no input window pressure).
- Dive's success state has zero recovery penalty; this might over-reward dive once spacing is solved. Watch in iter-8.

---

## 9. NEW BUGS introduced by iter 6

### 9a. Crouch during landingLag is a free dodge

`player.crouching` requires `whiffLock <= 0` (line 199) but **NOT** `landingLag <= 0`. So during the 0.4s landingLag from a whiffed dive, holding S sets `crouching=true`. drawStick's landingLag branch (lines 478–483) returns *before* the crouch branch (485), so visually still slumped, but the **opponent's jab band uses `player.crouching` to add CROUCH_HURTBOX_DROP=16** (line 299). Net effect: a player held in S during landingLag dodges jabs as if crouched, even though the visible pose is the lag pose. Mild — opp typically has its own state cooldown and wouldn't be jabbing right now anyway, but a coincident windup would whiff over a "lagged" target. **Recommend gating crouch by `landingLag <= 0` next iter.**

### 9b. Divepunch into wall — graceful, no exploit

If player dives toward a wall: vx held at 320*facing until `player.x` clamps at ARENA_LEFT+16 or ARENA_RIGHT-16, then vx=0 (line 196). vy continues; player slides down the wall. landing block fires; landingLag applied if no hit. No state corruption, no double-trigger. ✓

### 9c. Walking phase advances during dive (cosmetic)

`walkPhase += |vx| * dt` (line 224) runs unconditionally; during dive vx=320 → phase advances ~107 units across a typical dive. drawStick's `diving` branch returns before the stride render, so this is invisible. On landing, the leg pose snaps to whatever phase landed on. **Cosmetic only.**

### 9d. Feint roll on KO punch — no bug

Player KO punch sets `opponent.state='idle'` and `stateTimer = JAB_COOLDOWN*1.0` but doesn't clear `opponent.feintRoll`. The idle re-trigger gate at line 277 requires `opponent.hp > 0` → never re-enters windup → feintRoll never consulted. ✓

### 9e. Successful dive → instant ground punch (intended-but-strong)

After dive HIT (line 215–220), no whiffLock or landingLag is applied. Player can stand-punch on the very next frame. Combined with opp going to recovery (via dive's `state='idle'`/`stateTimer=JAB_COOLDOWN*1.0` — wait, dive sets opp to **idle** on hit, not recovery), the next stand-punch checks `opp.state === 'recovery'` → false → 8 dmg (no counter). So actual followup is 12 + 8 = 20 dmg, not 24 as I estimated above. Still a strong combo but the counter chain is *broken* by the dive setting state to idle. **Note for orchestrator:** if dive is supposed to leave opp counter-punishable, change dive's post-hit state to `'recovery'` with a short timer.

### 9f. `DIVE_VY_BOOST=540` replaces vy, doesn't add (synthesis says "boost added")

Line 239: `player.vy = DIVE_VY_BOOST`. Synthesis Change 2 spec said "DIVE_VY_BOOST added to vy means descent accelerates." Implementation **replaces**. Functionally equivalent at apex (vy≈0); diverges if dive triggers off-apex. With realistic frames (~16 ms), vy at apex is in [0, ~35], so net effect is < 7% off — not visible. Doc/spec mismatch, not a bug.

### 9g. Pulse alpha range mismatch

Brief states alpha 0.65–1.0; code (`0.65 + 0.35 * sin(...)`) gives 0.30–1.00. Doc drift, harmless.

---

## Summary

- **Iter-6 critical fix lands.** Stand-trade trace mutual at dx=40. ✓
- **Divepunch is geometrically sound** with a tight ~62 ms hit window from a 0.167 s descent. Counter-on-windup vertically defeats jab. Dive HIT gives no penalty → strong but earned.
- **Feint adds real read pressure** with ~0.2 s of distinguishability budget; tight but fair.
- **Walk cycle (3 Hz) and pulsing `~` (565 ms)** both visible and frame-rate-independent.
- **Bugs:** one minor (crouch during landingLag = invisible jab dodge, 9a); one design choice flag (dive HIT sets opp idle, breaking counter combo, 9e); rest are cosmetic / spec drift.

Recommended iter-8 priorities: gate crouch by landingLag (9a fix); decide whether dive should leave opp in `recovery` for 1-bar counter combo extension (9e tuning); ship rounds / best-of-3 to amortize matches.
