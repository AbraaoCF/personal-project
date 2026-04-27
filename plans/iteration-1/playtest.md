# Iteration 1 — Playtest Report

## Setup recap (numbers from code)
- Canvas 900x500, GROUND_Y = 420, walls 24px thick (arena: x in [24, 876]).
- Player spawn x=250, opponent spawn x=640. Initial gap = 390 px.
- WALK_SPEED = 3.2 px/frame; OPPONENT_SPEED = 1.6 px/frame. Player is exactly 2x faster.
- Opponent patrols x in [480, 800], starting patrolDir = -1 (walks LEFT first, i.e., toward player).
- Punch: PUNCH_REACH = 70, hitbox is |fistX - opponent.x| < 40 (so an 80-px-wide horizontal window centered on fist) and fistY in (opp.y-65, opp.y-5).
- fistY = player.y - 50. With player.y = GROUND_Y, fistY = GROUND_Y - 50, which sits squarely inside (GROUND_Y-65, GROUND_Y-5). On the ground, the vertical hit check is always true.
- PUNCH_DAMAGE = 8, HP = 100 -> exactly 13 hits to KO (12 do 96, 13th drops to 4 -> 0). PUNCH_COOLDOWN_FRAMES = 18 (0.3 s @ 60fps). Theoretical fastest KO = 13 * 18 = 234 frames = 3.9 s, plus the time to first contact.
- Knockback: starts at 6 * facing, decays *0.7 each frame, halts when |kb| < 0.1. Sequence: 6, 4.2, 2.94, 2.06, 1.44, 1.01, 0.71, 0.49, 0.35, 0.24, 0.17 -> total ~17.6 px pushed, over ~11 frames during which opponent does NOT patrol.
- Jump: JUMP_VELOCITY = -12, GRAVITY = 0.6. Air time = 40 frames; peak height = 120 px above ground. There is NO collision between player and opponent — they overlap freely.

## Scenario walkthroughs

### 1. Idle approach
Hold D from spawn. Player at 250 (3.2/f), opponent at 640 walking LEFT at 1.6/f. Closing speed 4.8/f. Hit window opens when opp.x - player.x is in [30, 110]. Starting gap is 390; gap shrinks past 110 at frame (390-110)/4.8 ≈ 58 frames (~1 s). The opponent is still walking toward the player at this moment (opponent only reaches patrolMin=480 at frame (640-480)/1.6 = 100). So the very first punch is a free, gift-wrapped hit. It feels like the game is throwing the opponent at you.

Patrol direction matters for exactly the first ~3 seconds and never again. After that, knockback + 2x speed advantage mean the player dictates spacing. Reach is dishonest in two directions at once: the visual fist sprite is `====` drawn 8 px out from the body, but the hitbox is 70 px out and 40 px wide, so the player connects from a noticeably empty-looking gap. Conversely, point-blank overlap (opp.x = player.x) actually MISSES because |0 - 70| = 70 > 40.

### 2. Patrol awareness
The opponent travels 1.6 px/frame; the player travels 3.2 px/frame. The opponent literally cannot escape — relative speed when fleeing is 1.6 px/f in the player's favor, and the patrol bounds (480-800) are a 320-px box the opponent can't leave. Worst case the opponent is at x=800 walking right; they hit the wall in 0 frames and reverse, and the player closes the entire 320-px patrol box in 100 frames (1.7 s).

When the opponent walks toward the player, closing speed is 4.8/f and the player just stands still and waits. There is no chasing dynamic; "patrol" is decorative. Combine with knockback: every hit shoves the opponent another 17 px in the direction the player is facing, often INTO the patrol wall, where the opponent then bounces along the wall for the rest of the fight.

### 3. Spam vs. timing
Spam wins outright. Cooldown 18 frames is also the only gating mechanism — there's no whiff penalty, no stamina, no counter. Holding J or SPACE is fine because the punch check uses `keys.has('j')` (held), not `keysPressed`, so the moment cooldown hits 0 the punch fires automatically. Strategy reduces to: walk until opponent is in your 80-px window, hold J, repeat after each knockback. Since knockback freezes patrol for ~11 frames and your cooldown is 18 frames, you walk forward ~22 px during the down-frames, comfortably keeping the opponent in range. Timing the patrol gives you nothing spam doesn't already give you. With perfect spacing, full KO is ~58 (approach) + 13*18 = ~292 frames = 4.9 s.

### 4. Jump usage
Jumping is *actively harmful*. The hitbox uses fistY = player.y - 50, but the opponent's vertical check is anchored at opp.y = GROUND_Y. The instant you leave the ground, fistY drops below GROUND_Y - 65 (the upper bound). At apex, fistY ≈ GROUND_Y - 176, far above the opponent's head box. You also can't change horizontal direction usefully mid-air (vx is recomputed each frame from input, so air control is fine, but you've added 40 frames of unpunchable airtime with zero benefit). The opponent has no projectiles, no attacks, and no vertical movement — there is nothing to jump over or dodge. Jumping is a strict downgrade with no upside.

### 5. K.O. moment
On the killing blow: opponent.hp goes to 0, hitFlash sets to 8, knockback sets to ±6, punchesLanded increments — and on the very next line `toGameOver()` is called, switching state to OVER. The render still draws both characters (state OVER renders the same as PLAY), but `update()` early-returns, so the hit flash is FROZEN at red mid-frame and knockback never plays. The screen instantly slaps a `K.O.` overlay over the canvas. There is no final hit zoom, no slow-mo, no opponent fall, no sound, no slight pause. It feels like the game crashed at the moment of victory.

The stats line ("Punches thrown: N (landed: M)") is also weak feedback: there's no accuracy %, no time, no rating, and no reason to care about the number because spamming gives a thrown count of ~13-25 with no penalty for whiffs.

### 6. Frustration points
See "Top frustrations" below.

## Top frustrations
1. **The opponent is target practice, not a sparring partner.** No attacks, no blocks, slower than the player, can't escape the patrol box, can't even enter the player's half of the arena (patrolMin=480 with player spawn at 250). The label "1v1 sparring" is a lie; this is a punching dummy on a treadmill. After 10 seconds the player has solved the entire game.
2. **Punch hitbox is invisible and counterintuitive.** The fist is drawn at x±8 but registers at x±70 with a 40-px tolerance. Players will throw punches that *visually connect* (overlapping the opponent) and miss, then throw punches at apparently empty air and hit. There is no visual indicator of the actual reach.
3. **Jump is a trap button.** It does nothing useful, breaks your own attacks (jumping punches always whiff vertically), and locks you out of the ground for 40 frames. A new player will press W, lose offensive tempo, and be confused why their punch missed. There's no reason to include the button until something requires it.
4. **K.O. has zero feedback.** Frame-perfect freeze, no animation of the opponent falling, no screen shake, no audio, no tally animation. The only "reward" is a static overlay with a count. Compare to even the simplest fighter, which plays a death animation.
5. **No collision between fighters.** The player can walk straight through the opponent. This breaks the fiction of a fight — there's no spatial pressure, no reason to worry about positioning, no way the opponent can crowd you.
6. **Punch input model is sloppy.** `keys.has('j')` (held) means tapping vs. holding J are identical; you can't choose to stop punching once you start holding the key, and the game auto-fires the moment cooldown ends. This kills any chance of rhythm play.
7. **The HP bar is the only stake.** No timer, no rounds, no player HP, no lose state. You literally cannot fail. A new player has no tension because death is impossible.
8. **The first hit is a freebie that sets a misleading tone.** Initial patrolDir = -1 means the opponent walks straight into your fist within ~1 second. The game teaches "spacing doesn't matter" in its very first interaction.

## What feels good (if anything)
- The hit flash (red, 8 frames) plus the knockback impulse is a tiny but readable feedback moment — you can tell when a hit lands without looking at the HP bar. It's the one piece of game-feel that's working.
- The HP bar color tiers (green > 50, yellow > 25, red <= 25) give a clean read on how close you are to KO.
- Movement is responsive — input-to-position is one frame, no acceleration/inertia getting in the way. For a stick-figure brawler that's the right call.
- The arena read is clear: walls, ground, two stick figures, HP bar. No visual noise, no UI clutter. The minimalist ASCII aesthetic is consistent.
- Punch animation (`====` for the arm, asymmetric body `|\` vs `/|`) is a small charming touch that conveys directionality.

## Bottom line
This is iteration 1 and it shows: the *systems* are wired up cleanly (state machine, input layer, render loop, hit detection scaffolding) but the *game* doesn't exist yet. Right now it is a 4-second click-through with no failure state, no opponent agency, and a useless jump button. The most urgent fixes before adding anything new: give the opponent any kind of threat (even "walk into player and deal contact damage"), add a player HP bar, make the punch hitbox match the visible fist, and put a half-second pause + animation on the K.O.
