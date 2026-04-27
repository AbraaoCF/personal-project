(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const GROUND_Y = H - 80;

  const WALL_THICKNESS = 24;
  const ARENA_LEFT = WALL_THICKNESS;
  const ARENA_RIGHT = W - WALL_THICKNESS;

  const menu = document.getElementById('menu');
  const controlsScreen = document.getElementById('controls-screen');
  const gameOverScreen = document.getElementById('gameover');
  const hud = document.getElementById('hud');

  const STATE = { MENU: 'menu', PLAY: 'play', OVER: 'over' };
  let state = STATE.MENU;
  let hitstop = 0;
  let gameEndHold = 0;
  let shake = 0;
  let gravityDir = 1;
  let flipTimer = 0;  // initialised in resetRound; FLIP_COOLDOWN is below

  const ROUNDS_TO_WIN = 2;
  const INTERMISSION_DURATION = 1.5;
  let playerWins = 0;
  let opponentWins = 0;
  let roundNumber = 1;
  let roundPhase = 'fighting';
  let intermissionTimer = 0;

  const keys = new Set();
  const keysPressed = new Set();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!keys.has(k)) keysPressed.add(k);
    keys.add(k);
    if (e.key === 'Escape' && state === STATE.PLAY) toMenu();
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const player = {
    x: 250, y: GROUND_Y, vx: 0, vy: 0,
    onGround: true,
    facing: 1,
    surface: 'floor',
    renderAngle: 0,
    crouching: false,
    hp: 100, maxHp: 100,
    displayedHp: 100, damageTailHp: 100,
    hitFlash: 0,
    punchTimer: 0,
    punchCooldown: 0,
    punchBuffer: 0,
    uppercutTimer: 0,
    whiffLock: 0,
    knockbackVx: 0,
    diving: false,
    landingLag: 0,
    diveHit: false,
    walkPhase: 0,
    punchesLanded: 0,
    punchAttempts: 0,
  };

  const opponent = {
    x: 640, y: GROUND_Y, vy: 0,
    hp: 100, maxHp: 100,
    displayedHp: 100, damageTailHp: 100,
    hitFlash: 0,
    knockback: 0,
    patrolDir: -1,
    patrolMin: 480,
    patrolMax: 800,
    state: 'open',
    stateTimer: 0,
    surface: 'floor',
    renderAngle: 0,
    fleeVx: 0,
  };

  const PUNCH_REACH = 38;             // px
  const PUNCH_DURATION = 0.2;         // s
  const PUNCH_COOLDOWN = 0.3;         // s
  const PUNCH_DAMAGE = 8;
  const WALK_SPEED = 192;             // px/s
  const VX_LERP = 0.25;               // dimensionless, applied via pow form
  const JUMP_VELOCITY = -720;         // px/s
  const GRAVITY = 2160;               // px/s^2
  const OPPONENT_SPEED = 96;          // px/s
  const PUNCH_BUFFER = 0.1;           // s
  const HITSTOP_DURATION = 0.0667;    // s
  const HIT_FLASH_DURATION = 0.1333;  // s
  const UPPER_REACH = 30;             // px
  const UPPER_DURATION = 0.2;         // s
  const UPPER_COOLDOWN = 0.5;         // s
  const UPPER_DAMAGE = 10;
  const UPPER_HIT_TOL = 28;           // px
  const WHIFF_LOCK = 0.35;            // s
  const DIVE_VX = 320;                // px/s
  const DIVE_VY_BOOST = 540;          // px/s
  const DIVE_DAMAGE = 9;
  const DIVE_HIT_TOL = 28;            // px
  const DIVE_REACH = 30;              // px
  const DIVE_FIST_DY = -30;           // px from player.y
  const LANDING_LAG = 0.4;            // s
  // Sparring-mode opponent: shield rhythm + evasion (no attacks).
  const SHIELD_OPEN = 0.6;            // s — vulnerable window
  const SHIELD_CLOSED = 1.4;          // s — protected window
  const SHIELD_BOUNCE = 360;          // px/s — knockback when player hits the shield
  const EVASION_RANGE = 90;           // px — opponent flees when player closer than this
  const EVASION_SPEED = 130;          // px/s — opponent's flee speed
  // Surface enum scaffold. Each fighter clings to one face of the arena.
  // Iter-10 will add 'ceiling' and gravity flip. The table tells gravity
  // which way "down" pulls relative to a fighter's surface.
  const SURFACE_GRAVITY = {
    floor:   { gx: 0, gy: 1 },
    left:    { gx: -1, gy: 0.4 },
    right:   { gx: 1, gy: 0.4 },
    ceiling: { gx: 0, gy: -1 },
  };
  const WALL_SLIDE_VY = 120;          // px/s — terminal slide speed on a wall
  const WALL_JUMP_VX = 360;           // px/s — horizontal kick off a wall
  const WALL_STICK_VX_MIN = 80;       // px/s — minimum |vx| into wall to stick
  const FLIP_COOLDOWN = 8.0;          // s — how often gravity flips
  const CEIL_Y = 60;                  // px — y of the ceiling face

  function resetRound() {
    player.x = 250; player.y = GROUND_Y;
    player.vx = 0; player.vy = 0;
    player.onGround = true; player.facing = 1;
    player.surface = 'floor';
    player.crouching = false;
    player.hp = player.maxHp;
    player.displayedHp = player.maxHp; player.damageTailHp = player.maxHp;
    player.hitFlash = 0;
    player.punchTimer = 0; player.punchCooldown = 0;
    player.punchBuffer = 0;
    player.uppercutTimer = 0;
    player.whiffLock = 0;
    player.knockbackVx = 0;
    player.diving = false;
    player.landingLag = 0;
    player.diveHit = false;
    player.walkPhase = 0;
    hitstop = 0;
    gameEndHold = 0;
    shake = 0;
    gravityDir = 1;
    flipTimer = FLIP_COOLDOWN;
    player.renderAngle = 0;
    opponent.renderAngle = 0;
    opponent.hp = opponent.maxHp;
    opponent.displayedHp = opponent.maxHp; opponent.damageTailHp = opponent.maxHp;
    opponent.x = 640; opponent.y = GROUND_Y; opponent.vy = 0;
    opponent.hitFlash = 0; opponent.knockback = 0;
    opponent.patrolDir = -1;
    opponent.state = 'open';
    opponent.stateTimer = SHIELD_OPEN;
    opponent.surface = 'floor';
    opponent.fleeVx = 0;
  }

  function resetMatch() {
    resetRound();
    player.punchesLanded = 0;
    player.punchAttempts = 0;
    playerWins = 0;
    opponentWins = 0;
    roundNumber = 1;
    roundPhase = 'fighting';
    intermissionTimer = 0;
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function toMenu() {
    state = STATE.MENU;
    show(menu); hide(controlsScreen); hide(gameOverScreen);
    hud.textContent = '';
  }
  function startGame() {
    resetMatch();
    state = STATE.PLAY;
    hide(menu); hide(controlsScreen); hide(gameOverScreen);
  }
  function toGameOver() {
    state = STATE.OVER;
    const result = playerWins > opponentWins ? 'VICTORY' : 'DEFEAT';
    document.getElementById('gameover-stats').textContent =
      `${result} ${playerWins}-${opponentWins}  -  Punches thrown: ${player.punchAttempts}  (landed: ${player.punchesLanded})`;
    gameOverScreen.classList.add('fading-in');
    show(gameOverScreen);
    requestAnimationFrame(() => gameOverScreen.classList.remove('fading-in'));
  }

  document.getElementById('btn-start').onclick = startGame;
  document.getElementById('btn-controls').onclick = () => { hide(menu); show(controlsScreen); };
  document.getElementById('btn-back').onclick = () => { hide(controlsScreen); show(menu); };
  document.getElementById('btn-again').onclick = startGame;
  document.getElementById('btn-menu').onclick = toMenu;

  function update(dt) {
    if (state !== STATE.PLAY) {
      keysPressed.clear();
      return;
    }

    if (roundPhase === 'intermission') {
      intermissionTimer -= dt;
      if (intermissionTimer <= 0) {
        resetRound();
        roundPhase = 'fighting';
      }
      keysPressed.clear();
      return;
    }

    if (hitstop > 0) {
      hitstop = Math.max(0, hitstop - dt);
      return;
    }

    // Gravity flip: periodic timer; on flip, swap floor<->ceiling for grounded
    // fighters, open both shields (Fall Guys window), pulse camera shake.
    flipTimer -= dt;
    if (flipTimer <= 0 && gameEndHold <= 0) {
      gravityDir *= -1;
      flipTimer = FLIP_COOLDOWN;
      for (const f of [player, opponent]) {
        if (f.surface === 'floor' && f.onGround) {
          f.surface = 'ceiling'; f.y = CEIL_Y; f.vy = 0;
        } else if (f.surface === 'ceiling' && f.onGround) {
          f.surface = 'floor'; f.y = GROUND_Y; f.vy = 0;
        }
      }
      opponent.state = 'open';
      opponent.stateTimer = SHIELD_OPEN;
      shake = Math.max(shake, 7);
    }

    let move = 0;
    if (keys.has('a') || keys.has('arrowleft')) move -= 1;
    if (keys.has('d') || keys.has('arrowright')) move += 1;
    if (player.whiffLock > 0 || player.landingLag > 0 || player.diving) move = 0;
    if (!player.diving && player.surface === 'floor') {
      const targetVx = move * WALK_SPEED;
      player.vx += (targetVx - player.vx) * (1 - Math.pow(1 - VX_LERP, dt * 60));
      if (Math.abs(player.vx) < 3) player.vx = 0;
    }
    if (player.surface === 'floor' || player.surface === 'ceiling') {
      player.x += player.vx * dt;
    }
    if (Math.abs(player.knockbackVx) > 6) {
      if (player.surface === 'floor' || player.surface === 'ceiling') {
        player.x += player.knockbackVx * dt;
      }
      player.knockbackVx *= Math.pow(0.7, dt * 60);
    } else {
      player.knockbackVx = 0;
    }
    if (move !== 0) player.facing = move;
    if (player.surface === 'floor' || player.surface === 'ceiling') {
      player.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, player.x));
      if (player.x === ARENA_LEFT + 16 || player.x === ARENA_RIGHT - 16) player.vx = 0;
    }

    player.crouching = player.onGround
      && (player.surface === 'floor' || player.surface === 'ceiling')
      && player.whiffLock <= 0
      && player.landingLag <= 0
      && (keys.has('s') || keys.has('arrowdown') || player.uppercutTimer > 0);
    if (player.crouching) player.vx = 0;

    const wantJump = keysPressed.has('w') || keysPressed.has('arrowup');
    if (wantJump) {
      if (player.surface === 'left') {
        player.vy = JUMP_VELOCITY * gravityDir;
        player.vx = WALL_JUMP_VX;
        player.facing = 1;
        player.surface = 'floor';
        player.whiffLock = 0;
        player.onGround = false;
      } else if (player.surface === 'right') {
        player.vy = JUMP_VELOCITY * gravityDir;
        player.vx = -WALL_JUMP_VX;
        player.facing = -1;
        player.surface = 'floor';
        player.whiffLock = 0;
        player.onGround = false;
      } else if (player.onGround && !player.crouching && player.whiffLock <= 0 && player.landingLag <= 0) {
        // Jump direction follows gravity: when flipped, jump upward = -y direction
        // is replaced by +y direction (flying away from the new ceiling-floor).
        player.vy = JUMP_VELOCITY * gravityDir;
        player.onGround = false;
      }
    }

    const groundedY = gravityDir === 1 ? GROUND_Y : CEIL_Y;
    const groundedSurface = gravityDir === 1 ? 'floor' : 'ceiling';
    const onSurface = (y) => gravityDir === 1 ? y >= GROUND_Y : y <= CEIL_Y;

    if (player.surface === 'left' || player.surface === 'right') {
      // Wall-stuck: slow slide; gravity component along wall.
      player.vy += GRAVITY * 0.25 * gravityDir * dt;
      player.vy = Math.max(-WALL_SLIDE_VY, Math.min(WALL_SLIDE_VY, player.vy));
      player.y += player.vy * dt;
      if (player.y >= GROUND_Y && gravityDir === 1) {
        player.y = GROUND_Y; player.vy = 0;
        player.surface = 'floor'; player.onGround = true; player.vx = 0;
        if (player.diving) {
          player.diving = false; player.landingLag = LANDING_LAG; player.diveHit = false;
        }
      } else if (player.y <= CEIL_Y && gravityDir === -1) {
        player.y = CEIL_Y; player.vy = 0;
        player.surface = 'ceiling'; player.onGround = true; player.vx = 0;
        if (player.diving) {
          player.diving = false; player.landingLag = LANDING_LAG; player.diveHit = false;
        }
      }
      // Detach off the "top" of the wall (in gravity-relative terms): slide off the inactive face.
      if (gravityDir === 1 && player.y < CEIL_Y) player.surface = 'floor';
      if (gravityDir === -1 && player.y > GROUND_Y) player.surface = 'floor';
    } else if (!player.onGround) {
      player.vy += GRAVITY * gravityDir * dt;
      player.y += player.vy * dt;
      // Auto-stick on wall contact while airborne and moving into wall fast enough.
      if (player.vy * gravityDir >= 0 && Math.abs(player.vx) >= WALL_STICK_VX_MIN) {
        if (player.x <= ARENA_LEFT + 16 && player.vx < 0) {
          player.surface = 'left';
          player.x = ARENA_LEFT + 16;
          player.vx = 0;
          player.vy = Math.max(-WALL_SLIDE_VY * 0.5, Math.min(WALL_SLIDE_VY * 0.5, player.vy));
        } else if (player.x >= ARENA_RIGHT - 16 && player.vx > 0) {
          player.surface = 'right';
          player.x = ARENA_RIGHT - 16;
          player.vx = 0;
          player.vy = Math.max(-WALL_SLIDE_VY * 0.5, Math.min(WALL_SLIDE_VY * 0.5, player.vy));
        }
      }
      if (onSurface(player.y)) {
        player.y = groundedY;
        player.vy = 0;
        player.surface = groundedSurface;
        player.onGround = true;
        if (player.diving) {
          player.diving = false;
          player.vx = 0;
          player.landingLag = LANDING_LAG;
          player.diveHit = false;
        }
      }
    }

    player.walkPhase += Math.abs(player.vx) * dt;

    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (player.punchTimer > 0) player.punchTimer -= dt;
    if (player.punchBuffer > 0) player.punchBuffer -= dt;
    if (player.uppercutTimer > 0) player.uppercutTimer -= dt;
    if (player.whiffLock > 0) player.whiffLock -= dt;
    if (player.landingLag > 0) player.landingLag -= dt;

    // Divepunch: descending-toward-active-floor air J press, bypasses buffer.
    if ((keysPressed.has('j') || keysPressed.has(' '))
        && !player.onGround && player.vy * gravityDir >= 0
        && !player.diving && player.whiffLock <= 0) {
      player.diving = true;
      player.diveHit = false;
      player.vy = DIVE_VY_BOOST * gravityDir;
      player.vx = DIVE_VX * player.facing;
      player.punchAttempts++;
      keysPressed.delete('j');
      keysPressed.delete(' ');
    }

    const wantPunch = keysPressed.has('j') || keysPressed.has(' ');
    if (wantPunch && player.whiffLock <= 0 && !player.diving && player.landingLag <= 0) {
      player.punchBuffer = PUNCH_BUFFER;
    }

    // Opponent: shield rhythm + cat/mouse evasion. Sparring sim — opponent does not attack.
    if (opponent.hitFlash > 0) opponent.hitFlash -= dt;

    const knockbackActive = Math.abs(opponent.knockback) > 6;
    if (knockbackActive) {
      opponent.x += opponent.knockback * dt;
      opponent.knockback *= Math.pow(0.7, dt * 60);
    } else {
      opponent.knockback = 0;
    }

    if (opponent.stateTimer > 0) opponent.stateTimer = Math.max(0, opponent.stateTimer - dt);
    if (opponent.state === 'open' && opponent.stateTimer <= 0) {
      opponent.state = 'shielding';
      opponent.stateTimer = SHIELD_CLOSED;
    } else if (opponent.state === 'shielding' && opponent.stateTimer <= 0) {
      opponent.state = 'open';
      opponent.stateTimer = SHIELD_OPEN;
    }

    if (!knockbackActive && opponent.hp > 0 && player.hp > 0) {
      if (opponent.surface === 'floor' || opponent.surface === 'ceiling') {
        const dxToPlayer = player.x - opponent.x;
        const dist = Math.abs(dxToPlayer);
        if (dist < EVASION_RANGE) {
          // Cat/mouse: flee from the player with eased velocity.
          const targetVx = (dxToPlayer > 0 ? -1 : 1) * EVASION_SPEED;
          opponent.fleeVx += (targetVx - opponent.fleeVx) * (1 - Math.pow(1 - 0.18, dt * 60));
          opponent.x += opponent.fleeVx * dt;
          opponent.patrolDir = opponent.fleeVx < 0 ? -1 : 1;
          // Cornered? Climb the wall (away from current floor/ceiling).
          if (opponent.x <= ARENA_LEFT + 16 + 4) {
            opponent.surface = 'left';
            opponent.x = ARENA_LEFT + 16;
            opponent.vy = -EVASION_SPEED * gravityDir;
          } else if (opponent.x >= ARENA_RIGHT - 16 - 4) {
            opponent.surface = 'right';
            opponent.x = ARENA_RIGHT - 16;
            opponent.vy = -EVASION_SPEED * gravityDir;
          }
        } else {
          opponent.fleeVx = 0;
          opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
          if (opponent.x <= opponent.patrolMin) {
            opponent.x = opponent.patrolMin;
            opponent.patrolDir = 1;
          } else if (opponent.x >= opponent.patrolMax) {
            opponent.x = opponent.patrolMax;
            opponent.patrolDir = -1;
          }
        }
      } else {
        // Wall-stuck: climb to mid-height (offset from current floor), then hold.
        // When gravity normal (gravityDir=1) climb up to H*0.6 (300px from top).
        // When flipped (gravityDir=-1) climb down to H*0.4 from current ceiling.
        const targetY = gravityDir === 1 ? H * 0.6 : H * 0.4;
        const climbDir = gravityDir === 1 ? -1 : 1;  // sign of vy needed
        const reached = climbDir === -1 ? opponent.y <= targetY : opponent.y >= targetY;
        if (!reached) {
          opponent.y += (opponent.vy || climbDir * EVASION_SPEED) * dt;
        } else {
          opponent.y = targetY;
          opponent.vy = 0;
        }
        // If player isn't pressuring this wall and is far, drop back to active floor.
        const playerNearWall = (opponent.surface === 'left' && player.x < 200)
                            || (opponent.surface === 'right' && player.x > W - 200);
        if (!playerNearWall && Math.abs(player.x - opponent.x) > EVASION_RANGE * 2) {
          opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
          opponent.y = gravityDir === 1 ? GROUND_Y : CEIL_Y;
          opponent.vy = 0;
        }
      }
    }
    opponent.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, opponent.x));

    // Player ground attack resolution (after opponent active hit-check).
    if (player.punchBuffer > 0 && player.punchCooldown <= 0
        && player.whiffLock <= 0 && !player.diving && player.landingLag <= 0) {
      player.punchBuffer = 0;
      player.punchAttempts++;

      if (player.crouching) {
        player.uppercutTimer = UPPER_DURATION;
        player.punchCooldown = UPPER_COOLDOWN;
        const fistX = player.x + player.facing * UPPER_REACH;
        if (Math.abs(fistX - opponent.x) < UPPER_HIT_TOL && opponent.hp > 0) {
          if (opponent.state === 'shielding') {
            opponent.hitFlash = HIT_FLASH_DURATION;
            player.knockbackVx = -SHIELD_BOUNCE * player.facing;
            hitstop = HITSTOP_DURATION * 0.5;
          } else {
            opponent.hp = Math.max(0, opponent.hp - UPPER_DAMAGE);
            opponent.hitFlash = HIT_FLASH_DURATION;
            if (opponent.surface === 'left' || opponent.surface === 'right') {
              opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
              opponent.y = gravityDir === 1 ? GROUND_Y : CEIL_Y;
              opponent.vy = 0;
            }
            opponent.knockback = 480 * player.facing;
            opponent.state = 'shielding';
            opponent.stateTimer = SHIELD_CLOSED;
            player.punchesLanded++;
            hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
            player.uppercutTimer = UPPER_DURATION * 0.4;
          }
        }
      } else {
        player.punchTimer = PUNCH_DURATION;
        player.punchCooldown = PUNCH_COOLDOWN;
        const fistX = player.x + player.facing * PUNCH_REACH;
        const fistY = player.y - 50;
        let hit = false;
        if (Math.abs(fistX - opponent.x) < 28 && fistY > opponent.y - 65 && fistY < opponent.y - 5 && opponent.hp > 0) {
          if (opponent.state === 'shielding') {
            opponent.hitFlash = HIT_FLASH_DURATION;
            player.knockbackVx = -SHIELD_BOUNCE * player.facing;
            hitstop = HITSTOP_DURATION * 0.5;
          } else {
            opponent.hp = Math.max(0, opponent.hp - PUNCH_DAMAGE);
            opponent.hitFlash = HIT_FLASH_DURATION;
            if (opponent.surface === 'left' || opponent.surface === 'right') {
              opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
              opponent.y = gravityDir === 1 ? GROUND_Y : CEIL_Y;
              opponent.vy = 0;
            }
            opponent.knockback = 360 * player.facing;
            opponent.state = 'shielding';
            opponent.stateTimer = SHIELD_CLOSED;
            player.punchesLanded++;
            hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
            player.punchTimer = PUNCH_DURATION * 0.4;
          }
          hit = true;
        }
        if (!hit) player.whiffLock = WHIFF_LOCK;
      }
    }

    // Divepunch hit-check — runs every frame while diving.
    if (player.diving && !player.diveHit && opponent.hp > 0) {
      const fistX = player.x + player.facing * DIVE_REACH;
      const fistY = player.y + DIVE_FIST_DY;
      if (Math.abs(fistX - opponent.x) < DIVE_HIT_TOL
          && fistY > opponent.y - 80 && fistY < opponent.y - 20) {
        if (opponent.state === 'shielding') {
          opponent.hitFlash = HIT_FLASH_DURATION;
          player.knockbackVx = -SHIELD_BOUNCE * player.facing;
          player.vy = -300; // bounce off the shield mid-air
          hitstop = HITSTOP_DURATION * 0.5;
          player.diveHit = true;
        } else {
          opponent.hp = Math.max(0, opponent.hp - DIVE_DAMAGE);
          opponent.hitFlash = HIT_FLASH_DURATION;
          if (opponent.surface === 'left' || opponent.surface === 'right') {
            opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
            opponent.y = gravityDir === 1 ? GROUND_Y : CEIL_Y;
            opponent.vy = 0;
          }
          opponent.knockback = 420 * player.facing;
          opponent.state = 'shielding';
          opponent.stateTimer = SHIELD_CLOSED;
          player.punchesLanded++;
          player.diveHit = true;
          hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
        }
      }
    }

    if (player.hitFlash > 0) player.hitFlash -= dt;

    if (hitstop > 0) shake = Math.max(shake, (hitstop / HITSTOP_DURATION) * 4);

    const fastLerp = 1 - Math.pow(1 - 0.4, dt * 60);
    const slowLerp = 1 - Math.pow(1 - 0.06, dt * 60);
    player.displayedHp += (player.hp - player.displayedHp) * fastLerp;
    player.damageTailHp += (player.displayedHp - player.damageTailHp) * slowLerp;
    opponent.displayedHp += (opponent.hp - opponent.displayedHp) * fastLerp;
    opponent.damageTailHp += (opponent.displayedHp - opponent.damageTailHp) * slowLerp;

    if (roundPhase === 'fighting' && (player.hp <= 0 || opponent.hp <= 0) && hitstop <= 0) {
      if (gameEndHold === 0) gameEndHold = 0.5;
      gameEndHold -= dt;
      if (gameEndHold <= 0) {
        if (opponent.hp <= 0) playerWins++;
        else opponentWins++;
        if (playerWins >= ROUNDS_TO_WIN || opponentWins >= ROUNDS_TO_WIN) {
          toGameOver();
        } else {
          roundPhase = 'intermission';
          intermissionTimer = INTERMISSION_DURATION;
          roundNumber++;
        }
      }
    }

    // Render-angle ease toward each fighter's surface target (shortest arc).
    for (const f of [player, opponent]) {
      let delta = surfaceAngle(f.surface) - f.renderAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      f.renderAngle += delta * (1 - Math.pow(1 - 0.4, dt * 60));
    }

    // dt-correct shake decay.
    shake *= Math.pow(0.85, dt * 60);

    keysPressed.clear();
  }

  function drawWalls() {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, WALL_THICKNESS, H);
    ctx.fillRect(W - WALL_THICKNESS, 0, WALL_THICKNESS, H);

    ctx.fillStyle = '#555';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 12; y < H; y += 18) {
      ctx.fillText('|', WALL_THICKNESS / 2, y);
      ctx.fillText('|', W - WALL_THICKNESS / 2, y);
    }

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(WALL_THICKNESS, 0); ctx.lineTo(WALL_THICKNESS, H);
    ctx.moveTo(W - WALL_THICKNESS, 0); ctx.lineTo(W - WALL_THICKNESS, H);
    ctx.stroke();
  }

  function drawGround() {
    const flipPulse = flipTimer < 1 ? (0.5 + 0.5 * Math.sin(flipTimer * 30)) : 0;
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ARENA_LEFT, GROUND_Y + 4);
    ctx.lineTo(ARENA_RIGHT, GROUND_Y + 4);
    ctx.moveTo(ARENA_LEFT, CEIL_Y - 4);
    ctx.lineTo(ARENA_RIGHT, CEIL_Y - 4);
    ctx.stroke();
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const inactiveAlpha = 0.35 + 0.5 * flipPulse;
    ctx.fillStyle = gravityDir === 1 ? 'rgba(80, 80, 80, 1)' : `rgba(80, 80, 80, ${inactiveAlpha.toFixed(3)})`;
    for (let x = ARENA_LEFT; x < ARENA_RIGHT; x += 16) ctx.fillText('-', x, GROUND_Y + 18);
    ctx.fillStyle = gravityDir === -1 ? 'rgba(80, 80, 80, 1)' : `rgba(80, 80, 80, ${inactiveAlpha.toFixed(3)})`;
    for (let x = ARENA_LEFT; x < ARENA_RIGHT; x += 16) ctx.fillText('-', x, CEIL_Y - 6);
  }

  function surfaceAngle(s) {
    if (s === 'left') return Math.PI / 2;
    if (s === 'right') return -Math.PI / 2;
    if (s === 'ceiling') return Math.PI;
    return 0;
  }

  function drawStickOnSurface(x, y, surface, opts) {
    const angle = (opts && opts.renderAngle != null) ? opts.renderAngle : surfaceAngle(surface);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    drawStick(0, 0, opts);
    ctx.restore();
  }

  function drawStick(x, y, opts = {}) {
    const {
      facing = 1, punchT = -1, color = '#eee', airborne = false, crouch = false,
      diving = false, landingLag = 0, walkPhase = 0, whiffLock = 0,
    } = opts;
    ctx.fillStyle = color;
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (diving) {
      ctx.fillText(facing === 1 ? '\\O' : 'O/', x, y - 30);
      ctx.fillText(facing === 1 ? '>>' : '<<', x + facing * 14, y - 14);
      ctx.fillText('/ \\', x, y + 4);
      return;
    }
    if (landingLag > 0) {
      const landLean = -facing * 4 * Math.min(1, (LANDING_LAG - landingLag) / 0.15);
      ctx.fillText('_O_', x + landLean, y - 30);
      ctx.fillText('\\|/', x + landLean * 0.5, y - 12);
      ctx.fillText('/ \\', x, y + 4);
      return;
    }

    if (crouch) {
      ctx.fillText('_O_', x, y - 30);
      ctx.fillText('/|\\', x, y - 12);
      ctx.fillText('/ \\', x, y + 4);
      return;
    }

    const whiffLean = whiffLock > 0
      ? facing * 4 * Math.min(1, (WHIFF_LOCK - whiffLock) / 0.15)
      : 0;

    ctx.fillText('O', x + whiffLean, y - 50);

    if (punchT >= 0) {
      let off;
      if (punchT < 0.20) {
        off = -4 * (punchT / 0.20);
      } else if (punchT < 0.55) {
        const tt = (punchT - 0.20) / 0.35;
        off = -4 + (PUNCH_REACH + 4) * (1 - Math.pow(1 - tt, 3));
      } else if (punchT < 0.80) {
        off = PUNCH_REACH;
      } else {
        const tt = (punchT - 0.80) / 0.20;
        off = PUNCH_REACH * (1 - tt);
      }

      if (off > 0) {
        ctx.textAlign = facing === 1 ? 'left' : 'right';
        ctx.fillText('====', x + whiffLean + facing * (8 + off), y - 50);
        ctx.textAlign = 'center';
        ctx.fillText(facing === 1 ? '|\\' : '/|', x + whiffLean, y - 30);
      } else {
        ctx.fillText('/|\\', x + whiffLean, y - 30);
      }
    } else {
      ctx.fillText('/|\\', x + whiffLean, y - 30);
    }

    const stride = (walkPhase % 64) < 32 ? '/ \\' : '\\ /';
    ctx.fillText(airborne ? '/ \\' : stride, x, y - 10);
    if (airborne) ctx.fillText('~ ~', x, y + 6);
  }

  function flashColor(base, flash, k) {
    const kk = Math.max(0, Math.min(1, k));
    const r = Math.round(base[0] + (flash[0] - base[0]) * kk);
    const g = Math.round(base[1] + (flash[1] - base[1]) * kk);
    const b = Math.round(base[2] + (flash[2] - base[2]) * kk);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const FLASH_RGB = [0xff, 0x88, 0x88];
  const PLAYER_RGB = [0x9a, 0xd9, 0xff];
  const OPPONENT_RGB = [0xee, 0xee, 0xee];

  function drawHpBar(label, hp, maxHp, side, displayedHp, damageTailHp) {
    const w = 240, h = 14, y = 20;
    const x = side === 'left'
      ? WALL_THICKNESS + 12
      : W - WALL_THICKNESS - w - 12;
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, w, h);

    const tailPct = Math.max(0, Math.min(1, damageTailHp / maxHp));
    ctx.fillStyle = '#5a2a2a';
    if (side === 'left') ctx.fillRect(x + w - w * tailPct, y, w * tailPct, h);
    else ctx.fillRect(x, y, w * tailPct, h);

    const pct = Math.max(0, Math.min(1, displayedHp / maxHp));
    ctx.fillStyle = pct > 0.5 ? '#6cdc6c' : pct > 0.25 ? '#dccc6c' : '#dc6c6c';
    if (side === 'left') ctx.fillRect(x + w - w * pct, y, w * pct, h);
    else ctx.fillRect(x, y, w * pct, h);

    ctx.strokeStyle = '#666';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${label}  ${hp}/${maxHp}`, x, y - 4);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    ctx.save();
    ctx.translate(sx, sy);

    drawWalls();
    drawGround();

    if (flipTimer < 1 && roundPhase === 'fighting' && (state === STATE.PLAY || state === STATE.OVER)) {
      const a = 0.5 + 0.5 * Math.sin(flipTimer * 20);
      ctx.save();
      ctx.fillStyle = `rgba(220, 180, 80, ${a.toFixed(3)})`;
      ctx.font = 'bold 36px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(Math.ceil(flipTimer)), W / 2, 48);
      ctx.restore();
    }

    if (state === STATE.PLAY || state === STATE.OVER) {
      const playerPunchT = player.punchTimer > 0
        ? 1 - player.punchTimer / PUNCH_DURATION
        : -1;
      drawStickOnSurface(player.x, player.y, player.surface, {
        facing: player.facing,
        punchT: playerPunchT,
        color: flashColor(PLAYER_RGB, FLASH_RGB, player.hitFlash / HIT_FLASH_DURATION),
        airborne: !player.onGround,
        crouch: player.crouching,
        diving: player.diving,
        landingLag: player.landingLag,
        walkPhase: player.walkPhase,
        whiffLock: player.whiffLock,
        renderAngle: player.renderAngle,
      });

      if (player.uppercutTimer > 0) {
        const t = 1 - player.uppercutTimer / UPPER_DURATION;
        const arcY = player.y - 10 - 70 * t;
        ctx.fillStyle = flashColor(PLAYER_RGB, FLASH_RGB, player.hitFlash / HIT_FLASH_DURATION);
        ctx.font = 'bold 18px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('*', player.x + player.facing * 18, arcY);
      }

      drawStickOnSurface(opponent.x, opponent.y, opponent.surface, {
        facing: -1,
        color: flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION),
        renderAngle: opponent.renderAngle,
      });

      if (opponent.state === 'shielding') {
        const remaining = opponent.stateTimer;
        let alpha;
        if (remaining < 0.25) {
          // Urgency flicker in last 0.25s before drop.
          alpha = 0.5 + 0.5 * (Math.floor(performance.now() / 40) % 2);
        } else {
          // Slow breath while protected.
          alpha = 0.55 + 0.25 * Math.sin(performance.now() / 220);
        }
        ctx.fillStyle = `rgba(136, 204, 238, ${alpha.toFixed(3)})`;
        ctx.font = 'bold 18px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('(+)', opponent.x, opponent.y - 78);
      }

      drawHpBar('YOU', player.hp, player.maxHp, 'left',
                player.displayedHp, player.damageTailHp);
      drawHpBar('OPPONENT', opponent.hp, opponent.maxHp, 'right',
                opponent.displayedHp, opponent.damageTailHp);

      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText((playerWins >= 1 ? '*' : 'o') + ' ' + (playerWins >= 2 ? '*' : 'o'),
                   WALL_THICKNESS + 12, 12);
      ctx.textAlign = 'right';
      ctx.fillText((opponentWins >= 1 ? '*' : 'o') + ' ' + (opponentWins >= 2 ? '*' : 'o'),
                   W - WALL_THICKNESS - 12, 12);

      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('A/D walk   W/↑ jump   S/↓ crouch   J / SPACE punch   ESC menu', WALL_THICKNESS + 8, H - 16);

      if (roundPhase === 'intermission') {
        ctx.fillStyle = 'rgba(10, 10, 10, 0.7)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#eee';
        ctx.font = 'bold 32px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`ROUND ${roundNumber}`, W / 2, H / 2 - 20);
        ctx.font = 'bold 20px ui-monospace, monospace';
        ctx.fillText(`${playerWins} : ${opponentWins}`, W / 2, H / 2 + 16);
      }
    }

    ctx.restore();
  }

  let prev = performance.now();
  function loop() {
    const now = performance.now();
    const dt = Math.min((now - prev) / 1000, 1 / 30);
    prev = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  toMenu();
  prev = performance.now();
  loop();
})();
