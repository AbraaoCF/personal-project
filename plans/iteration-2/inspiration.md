# Iteration 2 — Inspiration & Gameplay Ideas

## Current state (1 sentence)
A 1v1 ASCII canvas sparring game where a stick player walks (eased), jumps, and edge-triggered head-punches a horizontally-patrolling opponent that now deals contact damage; both fighters have HP bars and the match ends in VICTORY/DEFEAT.

## What shipped (recap, do not repeat)
- Edge-triggered punch (`keysPressed`), honest fist hitbox (`PUNCH_REACH=38`, tolerance `28`)
- Velocity easing on player walk (`VX_LERP=0.25`)
- Player HP, mirrored HP bar, opponent contact damage with shove + cooldown
- VICTORY / DEFEAT label on the game-over screen

## Already deferred (do not propose verbatim)
- Frame-rate independence (dt sweep)
- Animated punch with windup / extend / retract phases
- Telegraphed opponent jab (Punch-Out!! tell)
- K.O. pause + fall animation

## Proposals

### 1. Whiff-Recovery Punish Window — inspired by Street Fighter (whiff-punish loop)
- **Trigger.** A punch press that does **not** satisfy the hit test enters a "recovery" state: `player.whiffTimer = 18` frames. While `whiffTimer > 0`, the player's `WALK_SPEED` is halved and a new punch press is ignored (already covered by `PUNCH_COOLDOWN_FRAMES`, but the *recovery slow* is what's new).
- **Mechanic.** During whiff recovery, contact damage from the opponent is doubled (`CONTACT_DAMAGE * 2`) and the hit-flash tints the player's torso `/X\` orange for the duration to read as "exposed." Connecting punches do **not** trigger recovery — only whiffs.
- **Reward / risk.** Punishes spam, rewards reads. The player who waited for the opponent to walk into reach gets a clean 8-dmg hit; the player who mashed at empty air takes ~doubled punishment until they can recover. This composes directly with the iteration-1 contact-damage system (no new opponent state required) and with the edge-trigger fix (whiffs are now intentional presses, not autofire artifacts).
- **Why it's low-hanging.** Adds one timer and one branch in `update()`. Visual is a torso glyph swap inside `drawStick()`. ~12–15 LOC.

### 2. Backstep Dodge — inspired by Punch-Out!! (Little Mac's back-tap)
- **Trigger.** Tapping the **away-from-opponent** direction (computed from `Math.sign(opponent.x - player.x)`) twice within 12 frames triggers a 10-frame backstep: `player.vx = -facing * 5.5`, `player.dodgeTimer = 10`.
- **Mechanic.** While `dodgeTimer > 0`, contact damage is fully ignored (i-frames), the player cannot punch, and the stick figure renders with a faint trailing `'` glyph at the previous x to read as motion. After dodge ends, normal `vx` easing resumes.
- **Reward / risk.** A defensive verb that costs offensive tempo. Spaces the player out of contact-damage range without the tank-and-trade of just walking away. Sets up future iteration ideas (telegraphed jab, throws) by giving the player a real "no" button. Does not introduce blocking — block is reserved as a separate future verb.
- **Why it's low-hanging.** Reuses the existing `keysPressed` plumbing for double-tap detection. One new timer, one new branch in the contact block. ~15–18 LOC.

### 3. Stagger on Wall-Pin — inspired by Street Fighter's corner pressure
- **Trigger.** A landed punch whose knockback would push the opponent **into a wall** (i.e., `opponent.x` clamps to `ARENA_LEFT+16` or `ARENA_RIGHT-16` *during* knockback resolution).
- **Mechanic.** Set `opponent.staggerTimer = 30`. While `staggerTimer > 0`: opponent does not patrol (already true during knockback, but extended), `opponent` renders with a wobbly head glyph alternating `o`/`O`/`Q` per 6 frames, and the next punch within the window deals `PUNCH_DAMAGE * 1.5` (rounded down to 12). Stagger does **not** stack — landing the bonus punch resets but does not re-extend.
- **Reward / risk.** Turns the existing patrol-bounce-against-wall behavior (already noted in the playtest as accidental and frustrating) into a deliberate offensive loop: pin to wall, cash in a heavy. Pairs perfectly with knockback (already shipped). Gives the player a reason to manage spacing rather than chase to dead center.
- **Why it's low-hanging.** A clamp-detection check inside the existing knockback-resolution block, plus a damage-multiplier branch in the punch hit test. ~12–18 LOC.

### 4. Jump Cancel into Diving Punch — inspired by Divekick
- **Trigger.** Pressing punch **while airborne** (`!player.onGround`) fires a diving punch instead of a normal punch: `player.vy = 9` (slammed down) and `fistY = player.y - 25` (waist-height fist) for the duration of `punchTimer`.
- **Mechanic.** The dive-punch hitbox tests at the lower `fistY`, so it only connects on opponents whose head box overlaps that band — i.e., **after** the player has dropped enough altitude. Damage is `PUNCH_DAMAGE + 4` (12) on hit. On miss, the player still slams to ground and incurs a 10-frame landing-recovery (cannot punch or move).
- **Reward / risk.** Solves Frustration #3 from the iteration-1 playtest ("jump is a trap button") by giving jumping a real offensive purpose. It's high-commitment (whiff = grounded recovery + contact-damage exposure), high-reward (50% bonus damage), and naturally pairs with proposal #2's backstep — jump-in vs. backstep becomes a tiny rock-paper-scissors layer.
- **Why it's low-hanging.** Branches inside the existing punch block on `player.onGround`. Reuses the existing `punchTimer` and animation. One new constant for the dive `vy`, one for landing-recovery. ~18–22 LOC.

### 5. Hitstop Freeze on Connect — inspired by Street Fighter / Smash Bros. (universal hit-pause)
- **Trigger.** Any punch that lands (player on opponent, or future opponent on player) sets a global `hitstop = 4` frame counter.
- **Mechanic.** While `hitstop > 0`, decrement `hitstop` and **early-return from `update()` before any movement, knockback, patrol, or timer advancement** — but render still runs, so the hit-flash holds for 4 frames at the exact moment of impact. After hitstop expires, all timers (`punchTimer`, `hitFlash`, `knockback`, `contactCooldown`) resume.
- **Reward / risk.** Pure game-feel. Every fighter from Street Fighter to Smash uses 2–6 frame hit-pause to make connects feel weighty. Currently a connect is silent in time — the opponent flashes red but the world keeps moving. With hitstop, the impact reads as a *hit* rather than a *tick*. Composes with everything (existing punch, future telegraphed jab, contact damage) because it's a global pause.
- **Why it's low-hanging.** Single global counter, one early-return at the top of `update()`. Set the counter on punch-connect and (future-proof) on opponent-attack-connect. ~6–10 LOC.

## Composition notes
- Proposals **1, 2, 3, 5** are independent and stack cleanly — pick any subset.
- Proposal **4** (dive-punch) wants **5** (hitstop) for full impact; dive-connect with no hit-pause feels limp.
- Proposals **1** (whiff recovery) and **2** (backstep) together create the first real risk/reward read in the game: commit to a punch or commit to a dodge, but not both.
- None of the five depend on the deferred dt sweep; all are expressed in frame-counted constants matching iteration-1's idiom.
- None require new opponent AI states beyond what's already in place — that's the right tier for iteration 3+ once the player toolkit is fleshed out.

## Recommendation tier (for the synthesis step)
**Strongest pick:** #5 hitstop (smallest LOC, biggest felt-quality win, foundational for every future hit). \
**Best gameplay-depth pick:** #1 whiff recovery (turns the existing edge-trigger punch into a real commitment). \
**Best fix-existing-frustration pick:** #4 dive-punch (rehabilitates the trap jump button from playtest #3).
