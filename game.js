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
    punchTimer: 0,
    punchCooldown: 0,
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

  const PUNCH_REACH = 70;
  const PUNCH_DURATION = 12;
  const PUNCH_COOLDOWN_FRAMES = 18;
  const PUNCH_DAMAGE = 8;
  const WALK_SPEED = 3.2;
  const JUMP_VELOCITY = -12;
  const GRAVITY = 0.6;
  const OPPONENT_SPEED = 1.6;

  function resetMatch() {
    player.x = 250; player.y = GROUND_Y;
    player.vx = 0; player.vy = 0;
    player.onGround = true; player.facing = 1;
    player.punchTimer = 0; player.punchCooldown = 0;
    player.punchesLanded = 0; player.punchAttempts = 0;
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
    document.getElementById('gameover-stats').textContent =
      `Punches thrown: ${player.punchAttempts}  (landed: ${player.punchesLanded})`;
    show(gameOverScreen);
  }

  document.getElementById('btn-start').onclick = startGame;
  document.getElementById('btn-controls').onclick = () => { hide(menu); show(controlsScreen); };
  document.getElementById('btn-back').onclick = () => { hide(controlsScreen); show(menu); };
  document.getElementById('btn-again').onclick = startGame;
  document.getElementById('btn-menu').onclick = toMenu;

  function update() {
    if (state !== STATE.PLAY) {
      keysPressed.clear();
      return;
    }

    let move = 0;
    if (keys.has('a') || keys.has('arrowleft')) move -= 1;
    if (keys.has('d') || keys.has('arrowright')) move += 1;
    player.vx = move * WALK_SPEED;
    player.x += player.vx;
    if (move !== 0) player.facing = move;
    player.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, player.x));

    const wantJump = keysPressed.has('w') || keysPressed.has('arrowup');
    if (wantJump && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
    }
    if (!player.onGround) {
      player.vy += GRAVITY;
      player.y += player.vy;
      if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
        player.onGround = true;
      }
    }

    if (player.punchCooldown > 0) player.punchCooldown--;
    if (player.punchTimer > 0) player.punchTimer--;

    const wantPunch = keys.has('j') || keys.has(' ');
    if (wantPunch && player.punchCooldown === 0) {
      player.punchTimer = PUNCH_DURATION;
      player.punchCooldown = PUNCH_COOLDOWN_FRAMES;
      player.punchAttempts++;

      const fistX = player.x + player.facing * PUNCH_REACH;
      const fistY = player.y - 50;
      if (Math.abs(fistX - opponent.x) < 40 && fistY > opponent.y - 65 && fistY < opponent.y - 5) {
        opponent.hp = Math.max(0, opponent.hp - PUNCH_DAMAGE);
        opponent.hitFlash = 8;
        opponent.knockback = 6 * player.facing;
        player.punchesLanded++;
      }
    }

    if (opponent.hitFlash > 0) opponent.hitFlash--;

    const knockbackActive = Math.abs(opponent.knockback) > 0.1;
    if (knockbackActive) {
      opponent.x += opponent.knockback;
      opponent.knockback *= 0.7;
    } else {
      opponent.x += opponent.patrolDir * OPPONENT_SPEED;
      if (opponent.x <= opponent.patrolMin) {
        opponent.x = opponent.patrolMin;
        opponent.patrolDir = 1;
      } else if (opponent.x >= opponent.patrolMax) {
        opponent.x = opponent.patrolMax;
        opponent.patrolDir = -1;
      }
    }
    opponent.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, opponent.x));

    if (opponent.hp <= 0) toGameOver();

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
    const { facing = 1, punching = false, color = '#eee', airborne = false } = opts;
    ctx.fillStyle = color;
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('O', x, y - 50);

    if (punching) {
      ctx.textAlign = facing === 1 ? 'left' : 'right';
      ctx.fillText('====', x + facing * 8, y - 50);
      ctx.textAlign = 'center';
      ctx.fillText(facing === 1 ? '|\\' : '/|', x, y - 30);
    } else {
      ctx.fillText('/|\\', x, y - 30);
    }

    ctx.fillText(airborne ? '/ \\' : '/ \\', x, y - 10);
    if (airborne) ctx.fillText('~ ~', x, y + 6);
  }

  function drawHpBar() {
    const w = 240, h = 14;
    const x = W - WALL_THICKNESS - w - 12, y = 20;
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, w, h);
    const pct = opponent.hp / opponent.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#6cdc6c' : pct > 0.25 ? '#dccc6c' : '#dc6c6c';
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = '#666';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`OPPONENT  ${opponent.hp}/${opponent.maxHp}`, x, y - 4);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawWalls();
    drawGround();

    if (state === STATE.PLAY || state === STATE.OVER) {
      drawStick(player.x, player.y, {
        facing: player.facing,
        punching: player.punchTimer > 0,
        color: '#9ad9ff',
        airborne: !player.onGround,
      });

      const oppColor = opponent.hitFlash > 0 ? '#ff8888' : '#eeeeee';
      drawStick(opponent.x, opponent.y, { facing: -1, color: oppColor });

      drawHpBar();

      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('A/D walk   W/↑ jump   J / SPACE punch   ESC menu', WALL_THICKNESS + 8, 26);
    }
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  toMenu();
  loop();
})();
