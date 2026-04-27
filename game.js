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
    hp: 100, maxHp: 100,
    hitFlash: 0,
    contactCooldown: 0,
    punchTimer: 0,
    punchCooldown: 0,
    punchBuffer: 0,
    punchesLanded: 0,
    punchAttempts: 0,
  };

  const opponent = {
    x: 640, y: GROUND_Y,
    hp: 100, maxHp: 100,
    hitFlash: 0,
    knockback: 0,
    patrolDir: -1,
    patrolMin: 480,
    patrolMax: 800,
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
  const CONTACT_DAMAGE = 4;
  const CONTACT_COOLDOWN = 0.5;       // s
  const CONTACT_RANGE = 10;           // px
  const PUNCH_BUFFER = 0.1;           // s
  const HITSTOP_DURATION = 0.0667;    // s
  const HIT_FLASH_DURATION = 0.1333;  // s

  function resetMatch() {
    player.x = 250; player.y = GROUND_Y;
    player.vx = 0; player.vy = 0;
    player.onGround = true; player.facing = 1;
    player.hp = player.maxHp;
    player.hitFlash = 0; player.contactCooldown = 0;
    player.punchTimer = 0; player.punchCooldown = 0;
    player.punchBuffer = 0;
    player.punchesLanded = 0; player.punchAttempts = 0;
    hitstop = 0;
    opponent.hp = opponent.maxHp;
    opponent.x = 640;
    opponent.hitFlash = 0; opponent.knockback = 0;
    opponent.patrolDir = -1;
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
    const result = opponent.hp <= 0 ? 'VICTORY' : 'DEFEAT';
    document.getElementById('gameover-stats').textContent =
      `${result}  -  Punches thrown: ${player.punchAttempts}  (landed: ${player.punchesLanded})`;
    show(gameOverScreen);
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

    if (hitstop > 0) {
      hitstop = Math.max(0, hitstop - dt);
      return;
    }

    let move = 0;
    if (keys.has('a') || keys.has('arrowleft')) move -= 1;
    if (keys.has('d') || keys.has('arrowright')) move += 1;
    const targetVx = move * WALK_SPEED;
    player.vx += (targetVx - player.vx) * (1 - Math.pow(1 - VX_LERP, dt * 60));
    if (Math.abs(player.vx) < 3) player.vx = 0;
    player.x += player.vx * dt;
    if (move !== 0) player.facing = move;
    player.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, player.x));
    if (player.x === ARENA_LEFT + 16 || player.x === ARENA_RIGHT - 16) player.vx = 0;

    const wantJump = keysPressed.has('w') || keysPressed.has('arrowup');
    if (wantJump && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
    }
    if (!player.onGround) {
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
        player.onGround = true;
      }
    }

    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (player.punchTimer > 0) player.punchTimer -= dt;
    if (player.punchBuffer > 0) player.punchBuffer -= dt;

    const wantPunch = keysPressed.has('j') || keysPressed.has(' ');
    if (wantPunch) player.punchBuffer = PUNCH_BUFFER;

    if (player.punchBuffer > 0 && player.punchCooldown <= 0) {
      player.punchBuffer = 0;
      player.punchTimer = PUNCH_DURATION;
      player.punchCooldown = PUNCH_COOLDOWN;
      player.punchAttempts++;

      const fistX = player.x + player.facing * PUNCH_REACH;
      const fistY = player.y - 50;
      if (Math.abs(fistX - opponent.x) < 28 && fistY > opponent.y - 65 && fistY < opponent.y - 5) {
        opponent.hp = Math.max(0, opponent.hp - PUNCH_DAMAGE);
        opponent.hitFlash = HIT_FLASH_DURATION;
        opponent.knockback = 360 * player.facing;
        player.punchesLanded++;
        hitstop = opponent.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
        player.punchTimer = PUNCH_DURATION * 0.4;  // jump to mid-hold pose for the freeze
      }
    }

    if (opponent.hitFlash > 0) opponent.hitFlash -= dt;

    const knockbackActive = Math.abs(opponent.knockback) > 6;
    if (knockbackActive) {
      opponent.x += opponent.knockback * dt;
      opponent.knockback *= Math.pow(0.7, dt * 60);
    } else {
      opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
      if (opponent.x <= opponent.patrolMin) {
        opponent.x = opponent.patrolMin;
        opponent.patrolDir = 1;
      } else if (opponent.x >= opponent.patrolMax) {
        opponent.x = opponent.patrolMax;
        opponent.patrolDir = -1;
      }
    }
    opponent.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, opponent.x));

    if (player.contactCooldown > 0) player.contactCooldown -= dt;
    if (player.hitFlash > 0) player.hitFlash -= dt;
    const contactDx = Math.abs(player.x - opponent.x);
    if (contactDx < CONTACT_RANGE && player.contactCooldown <= 0 && opponent.hp > 0) {
      player.hp = Math.max(0, player.hp - CONTACT_DAMAGE);
      player.hitFlash = HIT_FLASH_DURATION;
      player.contactCooldown = CONTACT_COOLDOWN;

      const pinnedLeft = player.x <= ARENA_LEFT + 16;
      const pinnedRight = player.x >= ARENA_RIGHT - 16;
      if (pinnedLeft || pinnedRight) {
        opponent.knockback = 360 * (opponent.x > player.x ? 1 : -1);
        player.vx = 0;
      } else {
        player.vx = -360 * (opponent.x > player.x ? 1 : -1);
      }
      hitstop = player.hp <= 0 ? HITSTOP_DURATION * 2 : HITSTOP_DURATION;
    }

    if ((player.hp <= 0 || opponent.hp <= 0) && hitstop <= 0) {
      toGameOver();
    }

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
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ARENA_LEFT, GROUND_Y + 4);
    ctx.lineTo(ARENA_RIGHT, GROUND_Y + 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let x = ARENA_LEFT; x < ARENA_RIGHT; x += 16) ctx.fillText('-', x, GROUND_Y + 18);
  }

  function drawStick(x, y, opts = {}) {
    const { facing = 1, punchT = -1, color = '#eee', airborne = false } = opts;
    ctx.fillStyle = color;
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('O', x, y - 50);

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
        ctx.fillText('====', x + facing * (8 + off), y - 50);
        ctx.textAlign = 'center';
        ctx.fillText(facing === 1 ? '|\\' : '/|', x, y - 30);
      } else {
        ctx.fillText('/|\\', x, y - 30);
      }
    } else {
      ctx.fillText('/|\\', x, y - 30);
    }

    ctx.fillText('/ \\', x, y - 10);
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

  function drawHpBar(label, hp, maxHp, side) {
    const w = 240, h = 14, y = 20;
    const x = side === 'left'
      ? WALL_THICKNESS + 12
      : W - WALL_THICKNESS - w - 12;
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, w, h);
    const pct = hp / maxHp;
    ctx.fillStyle = pct > 0.5 ? '#6cdc6c' : pct > 0.25 ? '#dccc6c' : '#dc6c6c';
    if (side === 'left') {
      ctx.fillRect(x + w - w * pct, y, w * pct, h);
    } else {
      ctx.fillRect(x, y, w * pct, h);
    }
    ctx.strokeStyle = '#666';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${label}  ${hp}/${maxHp}`, x, y - 4);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawWalls();
    drawGround();

    if (state === STATE.PLAY || state === STATE.OVER) {
      const playerPunchT = player.punchTimer > 0
        ? 1 - player.punchTimer / PUNCH_DURATION
        : -1;
      drawStick(player.x, player.y, {
        facing: player.facing,
        punchT: playerPunchT,
        color: flashColor(PLAYER_RGB, FLASH_RGB, player.hitFlash / HIT_FLASH_DURATION),
        airborne: !player.onGround,
      });

      drawStick(opponent.x, opponent.y, {
        facing: -1,
        color: flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION),
      });

      drawHpBar('YOU', player.hp, player.maxHp, 'left');
      drawHpBar('OPPONENT', opponent.hp, opponent.maxHp, 'right');

      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('A/D walk   W/↑ jump   J / SPACE punch   ESC menu', WALL_THICKNESS + 8, 26);
    }
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
