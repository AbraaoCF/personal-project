# Iteration 3 — Inspiration & Gameplay Ideas

## Current state (1 sentence)
A 1v1 ASCII canvas spar where a stick player walks (eased), edge-trigger punches a stationary patroller across separated hit/contact zones with input-buffered, animated punches that trigger 4-frame hitstop and lerped hit-flash; jumping is a trap button and the opponent is still a punching bag.

## What shipped iter 1 + iter 2 (do not repeat)
- iter 1: edge-trigger punch (`PUNCH_REACH=38`, `tol=28`), eased `vx`, player HP, mirrored bars, contact damage with shove/cooldown, VICTORY/DEFEAT label.
- iter 2: `CONTACT_RANGE=10` (separated zones), 6-frame `punchBuffer`, 4-frame global `hitstop`, animated punch (`punchT` 4-phase ease), `flashColor()` lerp on hit.

## Already deferred (sharpen, don't repropose verbatim)
- whiff-recovery punish window — Street Fighter
- backstep dodge / double-tap-away — Punch-Out!!
- wall-pin stagger — SF corner
- jump-cancel divepunch — Divekick
- telegraphed opponent jab — Punch-Out!! (prereqs now met)
- frame-rate independence (dt) — *iter-3 hard commit; if synth takes it, gameplay budget shrinks*

## Design constraints for iter-3 picks
1. The opponent has zero offense beyond walking-into-you. **Telegraphed jab is the single biggest gameplay step the game still needs** — every other risk/reward verb is hollow until the opponent can *threaten*.
2. Jump is strictly negative-EV (no aerial attack, slower commit-to-punch, same vulnerable hitbox).
3. Wall-corner trap (player stuck in corner taking repeat contact ticks because patroller bounces back into them) is a real bug; a gameplay-side fix is fair game.
4. We're 3/15. Leave compounding room — don't burn the whole opponent-AI surface in one iteration.

## Proposals

### 1. Telegraphed opponent jab — inspired by Punch-Out!! (Glass Joe's read-the-tell loop)
- **Trigger.** When `Math.abs(player.x - opponent.x) < 110` and a new module-scope `opponent.jabCooldown` reaches 0, the opponent enters a **wind-up state**: `opponent.jabWindup = 24` frames. During wind-up, the opponent halts patrol, draws head as a flashing yellow `!` glyph (12-frame on/off using `flashColor()` already shipped), and at `jabWindup === 0` swings: `opponent.jabActive = 8` frames. The active hitbox is one tile in front of the opponent at head height.
- **Mechanic.** During `jabActive`, if the player's head-box overlaps the jab tip, deal `JAB_DAMAGE = 10` and apply `+8` knockback away. After active ends, opponent enters `jabRecovery = 30` frames where it cannot jab again, walks in place, and **takes +4 bonus damage from a player punch** (whiff-punish window flips: now it's the *opponent* that whiffed). Then `jabCooldown = 90` resumes.
- **Reward / risk.** First real two-way verb. Player must read the `!` tell and either backstep, duck (proposal 4), or counter-punch into the recovery for bonus damage. Composes with shipped hitstop (jab-on-player triggers existing `hitstop=4`) and `flashColor()` (reuse for the `!` blink). Single new opponent state machine, no AI search.
- **LOC.** ~30. Two new opponent fields (`jabWindup`, `jabActive`, `jabRecovery`, `jabCooldown` — bundle as `jabPhase` enum + one timer to halve), a 4-branch state advance in update, draw-side `!` glyph, hit test mirroring the player's. **Sharpens deferred idea by binding it concretely to existing `hitstop`/`flashColor` and adding a punish-the-recovery counter-loop the deferred note didn't specify.**

### 2. Crouch-duck (hold S) — inspired by Punch-Out!! / Smash (low-profile defensive verb)
- **Trigger.** Holding `S` / `↓` while grounded sets `player.crouching = true`. Player cannot walk while crouched (`vx` eases to 0). Releasing the key restores stance next frame.
- **Mechanic.** While crouched, the player's head-box drops by ~22 px (rendered as `o` head, no torso top, `_/\_` legs glyph). The opponent's incoming **jab (proposal 1) passes over** — its hitbox is at standing head height. The player's **own punch is disabled** while crouched (no fist test fires; `punchBuffer` still ticks down so a release-then-punch chain works cleanly via the existing buffer). Contact-damage range unchanged (legs still touch).
- **Reward / risk.** A read-and-react defensive verb that's only useful against the new jab — without it, crouch is just "no walk, no punch", which is fine. Pairs with the recovery-punish loop (proposal 1): duck the jab, stand up, punch the recovery for bonus damage. This is the iteration's keystone interaction.
- **LOC.** ~15. One new bool, one branch in walk, one in punch-fire gate, one in draw routine, one in jab hit test (skip if crouched).

### 3. Aerial uppercut on jump-punch — inspired by Street Fighter (Shoryuken) / Smash up-air
- **Trigger.** Pressing punch **while airborne** (`!player.onGround`). Different shape from the deferred Divekick proposal: this is an **upward-arcing** punch, not a downward dive. `player.uppercutting = true`, `punchTimer = PUNCH_DURATION`, fist drawn at `y - 70` (above head) sweeping forward, and `player.vy = -4` (extra rise to extend the airborne window by ~6 frames).
- **Mechanic.** Hit test fires at the elevated `fistY = player.y - 70` against the opponent's head box (`opponent.y - 65 .. -5`), so it only connects when the player is **below or level with** the opponent (i.e., during the jump's rise or apex). Damage `PUNCH_DAMAGE + 2` (10), and on connect adds **vertical** knockback to opponent's head visual (head glyph offsets up 6 px for 12 frames — pure cosmetic pop, no airborne opponent state needed yet). On whiff, no recovery penalty beyond the existing landing — jump is already a commit; don't double-tax it.
- **Reward / risk.** Rehabilitates the trap jump button into an **anti-jab** (proposal 1): jump over the incoming jab, uppercut into the opponent's head as the jab-recovery exposes them. Different from deferred Divekick (which would have been a downward dive into a stationary target — flatter risk/reward against a now-jabbing opponent). Composes with the new recovery-punish window from proposal 1, and is symmetric with crouch (proposal 2): **crouch-counter or jump-counter, pick one based on read**.
- **LOC.** ~20. One branch in punch-fire (airborne split), elevated fist-y in hit test, render-side fist offset, opponent head bounce.

### 4. Wall-shove pushback on player corner-pin — gameplay-side fix for the wall-corner trap
- **Trigger.** When `player.x` clamps against a wall (`ARENA_LEFT+16` or `ARENA_RIGHT-16`) **and** contact damage triggers in the same frame, instead of zeroing `player.vx`, apply a **perpendicular shove** that prioritizes pushing the opponent away rather than the player into the wall. Concretely: if player is wall-pinned and `contactDx < CONTACT_RANGE`, set `opponent.knockback = 10 * sign(opponent.x - player.x)` (shove opponent away) and skip the player's contact shove.
- **Mechanic.** Reuses shipped `opponent.knockback` field; no new state. The corner-pin loop (player against wall → opponent walks into player every 30 frames → no escape) becomes self-clearing: one tick of contact damage kicks the opponent back ~3 tiles, restoring escape room. Damage is still applied so the corner is still bad, just no longer a death-spiral.
- **Reward / risk.** Pure bug fix masquerading as a mechanic — Street Fighter's "corner reset" idea, but inverted (the *defender* gets the breathing room because the corner is already punishing). Keeps the corner as a tactical hazard without making it a literal trap-room. **Sharpens** the deferred wall-pin stagger by addressing its prerequisite bug first; iter-4+ can still layer offensive corner pressure on top.
- **LOC.** ~10. One branch in the existing contact-damage block.

### 5. Stamina meter — inspired by Bushido Blade / Sifu (commitment economy)
- **Trigger.** New `player.stamina = 100, maxStamina = 100`. Each punch attempt costs `STAMINA_PER_PUNCH = 18`. Each landed punch refunds `+8` (rewards accuracy). Stamina regenerates `+0.6/frame` while not punching and not crouched (proposal 2).
- **Mechanic.** If `stamina < STAMINA_PER_PUNCH`, the punch-fire gate refuses (the buffered press still expires harmlessly via existing buffer logic). Render a thin stamina sub-bar under the player's HP bar (yellow → red as it depletes). Drawing this is a 4-line addition reusing `drawHpBar`'s shape.
- **Reward / risk.** Caps the "spam buffered punches and let the wall pinball pin them" exploit currently latent in the game, **without** the deferred whiff-recovery's harsh slow-down. Stamina is softer: you can still mash, you just run dry and have to wait ~2 seconds. Makes the new jab/crouch/uppercut decisions matter (each costs the same currency). Foundational for iter-4+ heavy-attack or block ideas (different stamina costs).
- **LOC.** ~20. Two new fields, one regen tick, one gate in punch-fire, one render call, refund on hit.

## Composition notes
- **Keystone:** proposals 1 (jab) + 2 (crouch). Together they create the game's first read-and-react micro-loop. Shipping 1 without 2 leaves the player with only "walk away" as a defense, which makes the jab feel like RNG damage. Shipping 2 without 1 makes crouch a useless verb. **Pair them or neither.**
- **Rehab pair:** proposal 3 (uppercut) is the *second* anti-jab option, asymmetric with crouch. Synthesizer can ship 1+2 alone for the keystone, then add 3 if budget allows for the read-mixup.
- **Standalone:** proposal 4 (wall-shove fix) is independent of all others — drop in any time. Cheapest LOC.
- **Standalone (econ):** proposal 5 (stamina) is independent but **interacts** with everything: 3 should arguably cost more stamina, 1's recovery-punish counter is more valuable when stamina is low. Synthesizer can defer it to iter-4 once the new verbs from 1/2/3 are in.
- **dt budget:** if synth takes the dt sweep (~30–40 LOC per the iter-2 deferred note), the remaining budget realistically fits **1+2+4** (~55 LOC) and defers 3 and 5. That's still a complete iteration: opponent threat, player defense, bug fix.

## Recommendation tier (for synthesis)
- **Strongest single pick:** #1 telegraphed jab (the game stops being a punching-bag sim).
- **Required companion:** #2 crouch (turns #1 from RNG into a read).
- **Cheapest must-do:** #4 wall-shove fix (10 LOC, removes a real frustration).
- **Stretch if dt is light:** #3 uppercut (rehabs jump, second answer to jab).
- **Defer to iter-4:** #5 stamina (best landing pad once the new verbs exist to spend it on).
