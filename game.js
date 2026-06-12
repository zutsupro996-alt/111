// ============================================================
//  像素机甲对战 - 支持联机对战
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const bottomHint = document.getElementById('bottomHint');

// ============================================================
//  常量
// ============================================================
const CANVAS_W = 800;
const CANVAS_H = 500;
const GROUND_Y = 420;
const MECHA_W = 36;
const MECHA_H = 52;
const MECHA_SPEED = 3;
const BULLET_SPEED = 7;
const BULLET_SIZE = 6;
const ATTACK_DAMAGE = 20;
const ATTACK_COOLDOWN = 35;
const BLOCK_DURATION = 40;
const BLOCK_REDUCTION = 0.8;
const MAX_HP = 100;

// ============================================================
//  键盘输入
// ============================================================
const Input = {
  keys: {},
  pressed: {},
  init() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter',
           'ControlLeft','ShiftLeft'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  },
  isDown(c) { return !!this.keys[c]; },
  wasPressed(c) { if (this.pressed[c]) { this.pressed[c] = false; return true; } return false; },
  update() { this.pressed = {}; }
};

// ============================================================
//  触屏输入 (单玩家)
// ============================================================
const TouchInput = {
  joystick: { active: false, dx: 0, dy: 0 },
  buttons: { attack: false, block: false, attackPressed: false, blockPressed: false },
  init() {
    const jsArea = document.getElementById('joystickMain');
    const jsThumb = document.getElementById('thumbMain');
    const btnA = document.getElementById('btnAttackMain');
    const btnB = document.getElementById('btnBlockMain');
    if (jsArea) this._setupJoystick(jsArea, jsThumb);
    if (btnA) this._setupButton(btnA, 'attack');
    if (btnB) this._setupButton(btnB, 'block');
  },
  _setupJoystick(area, thumb) {
    let activeTouchId = null;
    area.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (activeTouchId !== null) return;
      const t = e.changedTouches[0]; activeTouchId = t.identifier;
      this._updateJoystickPos(area, thumb, t);
      this.joystick.active = true;
    });
    area.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === activeTouchId) this._updateJoystickPos(area, thumb, t);
    });
    const reset = () => {
      activeTouchId = null; thumb.style.transform = 'translate(-50%, -50%)';
      this.joystick.active = false; this.joystick.dx = 0; this.joystick.dy = 0;
    };
    area.addEventListener('touchend', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === activeTouchId) reset(); });
    area.addEventListener('touchcancel', reset);
  },
  _updateJoystickPos(area, thumb, touch) {
    const rect = area.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx, dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy), maxR = 40;
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const norm = dist > 5 ? (dist > maxR ? 1 : dist / maxR) : 0;
    const nd = Math.sqrt(dx * dx + dy * dy) || 1;
    this.joystick.dx = (dx / nd) * norm;
    this.joystick.dy = (dy / nd) * norm;
  },
  _setupButton(btn, action) {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.buttons[action] = true; this.buttons[action + 'Pressed'] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); this.buttons[action] = false; });
    btn.addEventListener('touchcancel', () => { this.buttons[action] = false; });
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); this.buttons[action] = true; this.buttons[action + 'Pressed'] = true; });
    btn.addEventListener('mouseup', (e) => { e.preventDefault(); this.buttons[action] = false; });
    btn.addEventListener('mouseleave', () => { this.buttons[action] = false; });
  },
  getMoveX() { return this.joystick.dx; },
  getMoveY() { return this.joystick.dy; },
  isActive() { return this.joystick.active; },
  wasAttackPressed() { if (this.buttons.attackPressed) { this.buttons.attackPressed = false; return true; } return false; },
  wasBlockPressed() { if (this.buttons.blockPressed) { this.buttons.blockPressed = false; return true; } return false; }
};

// ============================================================
//  联机模块
// ============================================================
const Network = {
  ws: null,
  connected: false,
  matching: false,
  matched: false,
  opponentId: null,
  myRole: null, // 1 or 2
  opponent: { x: 0, y: 0, facingRight: false, hp: MAX_HP, isAttacking: false, isBlocking: false },
  syncTimer: 0,
  syncInterval: 3, // 每3帧发送一次状态
  pendingDamage: 0,
  pendingBullets: [],
  gameOver: false,

  connect() {
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || '3000';
    // WebSocket 连接到当前 host 的 3000 端口
    const wsUrl = `ws://${host}:${port}`;
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      return false;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.updateUI('connected', '已连接服务器');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.matched = false;
      this.matching = false;
      this.updateUI('disconnected', '连接断开');
    };

    this.ws.onerror = () => {
      this.updateUI('disconnected', '连接失败, 请刷新重试');
    };

    return true;
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        break;
      case 'waiting':
        this.matching = true;
        this.updateUI('waiting', '等待对手加入...');
        break;
      case 'matched':
        this.matched = true;
        this.matching = false;
        this.myRole = msg.role;
        this.opponentId = msg.opponentId;
        this.opponent.hp = MAX_HP;
        const roleText = this.myRole === 1 ? '蓝色机甲' : '红色机甲';
        this.updateUI('matched', `配对成功! 你操控${roleText}`);

        // 自动开始游戏
        setTimeout(() => {
          Game.startOnlineGame();
          document.getElementById('onlinePanel').classList.remove('visible');
        }, 1200);
        break;
      case 'opponent_state':
        // 接收对手状态
        if (msg.mecha) {
          this.opponent.x = msg.mecha.x;
          this.opponent.y = msg.mecha.y;
          this.opponent.facingRight = msg.mecha.facingRight;
          this.opponent.isAttacking = msg.mecha.isAttacking;
          this.opponent.isBlocking = msg.mecha.isBlocking;
          this.opponent.hp = msg.hp;
        }
        break;
      case 'opponent_attack':
        // 对手发射子弹
        if (msg.bullet) {
          this.pendingBullets.push(msg.bullet);
        }
        break;
      case 'damage':
        if (msg.hp !== undefined) {
          this.pendingDamage = msg.hp;
        }
        break;
      case 'game_over':
        this.gameOver = true;
        Game.onlineOpponentDead = true;
        Game.state = 'gameover';
        Game.winner = Game.myOnlineRole === 1 ? 'player1' : 'player2';
        Game.spawnDeathParticles(Game.mecha2P);
        bottomHint.classList.remove('hidden');
        bottomHint.textContent = '你赢了! 点击重新开始';
        break;
      case 'opponent_left':
        this.matched = false;
        this.updateUI('disconnected', '对手断开了连接');
        Game.state = 'idle';
        bottomHint.classList.remove('hidden');
        bottomHint.textContent = '对手离开了, 点击重新开始';
        break;
      case 'restart':
        Game.startOnlineGame();
        break;
    }
  },

  sendMyState(mecha) {
    if (!this.connected || !this.matched) return;
    this.syncTimer++;
    if (this.syncTimer % this.syncInterval !== 0) return;

    this.ws.send(JSON.stringify({
      type: 'game_state',
      mecha: {
        x: mecha.x, y: mecha.y,
        facingRight: mecha.facingRight,
        isAttacking: mecha.isAttacking,
        isBlocking: mecha.isBlocking
      },
      bullets: [],
      hp: mecha.hp
    }));
  },

  sendShoot(bullet) {
    if (!this.connected || !this.matched) return;
    this.ws.send(JSON.stringify({
      type: 'attack',
      bullet: { x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy, color: bullet.color }
    }));
  },

  sendDamage(hp) {
    if (!this.connected || !this.matched) return;
    this.ws.send(JSON.stringify({ type: 'damage', hp: hp }));
  },

  sendGameOver() {
    if (!this.connected || !this.matched) return;
    this.ws.send(JSON.stringify({ type: 'game_over', winner: this.myRole }));
  },

  sendRestart() {
    if (!this.connected || !this.matched) return;
    this.ws.send(JSON.stringify({ type: 'restart' }));
  },

  // 申请匹配
  startMatching() {
    if (!this.connected) {
      if (!this.connect()) {
        this.updateUI('disconnected', '无法连接服务器');
      }
    }
    this.ws.send(JSON.stringify({ type: 'matchmaking' }));
  },

  cancelMatching() {
    this.matching = false;
    if (this.ws) {
      this.ws.close();
    }
    this.updateUI('disconnected', '已取消匹配');
  },

  updateUI(statusClass, text) {
    const statusEl = document.getElementById('onlineStatus');
    const infoEl = document.getElementById('onlineInfo');
    const cancelBtn = document.getElementById('btnCancelMatch');

    statusEl.className = 'online-status';
    statusEl.textContent = text;

    if (statusClass === 'connected') {
      statusEl.classList.add('connected');
    } else if (statusClass === 'waiting' || statusClass === 'matched') {
      statusEl.classList.add('waiting');
      if (statusClass === 'matched') {
        infoEl.textContent = '对手已就绪!';
        infoEl.classList.add('matched');
      }
      cancelBtn.classList.add('visible');
    } else {
      cancelBtn.classList.remove('visible');
    }
  },

  reset() {
    this.opponent = { x: 0, y: 0, facingRight: false, hp: MAX_HP, isAttacking: false, isBlocking: false };
    this.pendingBullets = [];
    this.pendingDamage = 0;
    this.gameOver = false;
    this.syncTimer = 0;
  }
};

// ============================================================
//  实体类
// ============================================================
class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.life = life; this.maxLife = life;
    this.size = size || 3; this.gravity = 0.15;
  }
  update() { this.x += this.vx; this.y += this.vy; this.vy += this.gravity; this.life--; }
  draw(c) {
    const a = this.life / this.maxLife;
    c.globalAlpha = a;
    const s = Math.max(1, Math.round(this.size * a));
    c.fillStyle = this.color;
    c.fillRect(Math.round(this.x), Math.round(this.y), s, s);
    c.globalAlpha = 1;
  }
  get dead() { return this.life <= 0; }
}

class Bullet {
  constructor(x, y, vx, vy, color) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color;
    this.width = BULLET_SIZE; this.height = BULLET_SIZE;
    this.active = true; this.trail = [];
  }
  update() {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4) this.trail.shift();
    this.x += this.vx; this.y += this.vy;
    if (this.x < -20 || this.x > CANVAS_W + 20 || this.y < -20 || this.y > CANVAS_H + 20) this.active = false;
  }
  draw(c) {
    for (let i = 0; i < this.trail.length; i++) {
      c.globalAlpha = (i + 1) / this.trail.length * 0.5;
      c.fillStyle = this.color;
      c.fillRect(Math.round(this.trail[i].x - 2), Math.round(this.trail[i].y), 3, 3);
    }
    c.globalAlpha = 1;
    const bx = Math.round(this.x), by = Math.round(this.y);
    c.fillStyle = '#fff'; c.fillRect(bx, by, this.width, this.height);
    c.fillStyle = this.color; c.fillRect(bx + 1, by + 1, this.width - 2, this.height - 2);
    c.fillStyle = '#ffff88'; c.fillRect(bx + 2, by + 2, 2, 2);
  }
}

class Mecha {
  constructor(id, x, y, color, accentColor, lightColor, controls, facingRight) {
    this.id = id; this.x = x; this.y = y;
    this.width = MECHA_W; this.height = MECHA_H;
    this.color = color; this.accentColor = accentColor; this.lightColor = lightColor;
    this.controls = controls; this.facingRight = facingRight;
    this.playerId = id;
    this.hp = MAX_HP; this.maxHp = MAX_HP;
    this.speed = MECHA_SPEED;
    this.attackCooldown = 0; this.isAttacking = false;
    this.isBlocking = false; this.blockTimer = 0; this.blockCooldown = 0;
    this.animTimer = 0; this.hitFlash = 0;
    this.knockbackX = 0; this.knockbackY = 0;
    this.particles = [];
    this.isOnline = false;  // 是否在线对手
  }

  get centerX() { return this.x + this.width / 2; }
  get centerY() { return this.y + this.height / 2; }

  reset(x, y, facingRight) {
    this.x = x; this.y = y; this.hp = MAX_HP;
    this.facingRight = facingRight;
    this.isBlocking = false; this.blockTimer = 0; this.blockCooldown = 0;
    this.attackCooldown = 0; this.hitFlash = 0;
    this.knockbackX = 0; this.knockbackY = 0; this.particles = [];
    this.isOnline = false;
  }

  updateOnline(oppData) {
    // 用接收到的在线数据更新对手外观
    this.x = oppData.x; this.y = oppData.y;
    this.facingRight = oppData.facingRight;
    this.isAttacking = oppData.isAttacking;
    this.isBlocking = oppData.isBlocking;
    this.hp = oppData.hp;
  }

  update(bullets) {
    if (this.isOnline) return; // 在线对手不本地更新

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.blockCooldown > 0) this.blockCooldown--;
    if (this.hitFlash > 0) this.hitFlash--;

    if (this.knockbackX !== 0) {
      this.x += this.knockbackX; this.knockbackX *= 0.8;
      if (Math.abs(this.knockbackX) < 0.3) this.knockbackX = 0;
    }
    if (this.knockbackY !== 0) {
      this.y += this.knockbackY; this.knockbackY *= 0.8;
      if (Math.abs(this.knockbackY) < 0.3) this.knockbackY = 0;
    }

    if (this.isBlocking) { this.blockTimer--; if (this.blockTimer <= 0) this.isBlocking = false; }

    let moveX = 0, moveY = 0;
    if (TouchInput.isActive()) {
      moveX = TouchInput.getMoveX();
      moveY = TouchInput.getMoveY();
    } else {
      if (Input.isDown(this.controls.left)) moveX = -1;
      if (Input.isDown(this.controls.right)) moveX = 1;
      if (Input.isDown(this.controls.up)) moveY = -1;
      if (Input.isDown(this.controls.down)) moveY = 1;
    }
    if (moveX !== 0 && moveY !== 0) { const m = Math.sqrt(moveX*moveX+moveY*moveY); moveX/=m; moveY/=m; }

    this.x += moveX * this.speed; this.y += moveY * this.speed;
    if (moveX < 0) this.facingRight = false;
    if (moveX > 0) this.facingRight = true;
    if (this.x < 0) this.x = 0;
    if (this.x + this.width > CANVAS_W) this.x = CANVAS_W - this.width;
    if (this.y < 35) this.y = 35;
    if (this.y + this.height > GROUND_Y) this.y = GROUND_Y - this.height;

    if (moveX !== 0 || moveY !== 0) {
      this.animTimer++;
      if (this.animTimer % 3 === 0) {
        this.particles.push(new Particle(this.x + this.width / 2 + (Math.random() - 0.5) * 10,
          this.y + this.height, (Math.random()-0.5)*1.5, -(Math.random()*1.5+0.5), this.lightColor, 12, 2));
      }
    } else { this.animTimer = 0; }

    const ta = TouchInput.wasAttackPressed();
    const ka = Input.wasPressed(this.controls.attack);
    if ((ta || ka) && this.attackCooldown <= 0) {
      this.shoot(bullets);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.isAttacking = true;
      setTimeout(() => { this.isAttacking = false; }, 100);
    }

    const tb = TouchInput.wasBlockPressed();
    const kb = Input.wasPressed(this.controls.block);
    if ((tb || kb) && this.blockCooldown <= 0 && !this.isBlocking) {
      this.isBlocking = true;
      this.blockTimer = BLOCK_DURATION;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].dead) this.particles.splice(i, 1);
    }
  }

  shoot(bullets) {
    const dir = this.facingRight ? 1 : -1;
    const bx = this.facingRight ? this.x + this.width : this.x - BULLET_SIZE;
    const by = this.y + this.height * 0.35;
    const b = new Bullet(bx, by, BULLET_SPEED * dir, 0, this.lightColor);
    bullets.push(b);
    for (let i = 0; i < 6; i++) {
      this.particles.push(new Particle(
        bx + (this.facingRight ? 0 : BULLET_SIZE), by + BULLET_SIZE / 2,
        (Math.random()-0.5)*3 + dir*2, (Math.random()-0.5)*3, '#ffff88', 8, 2));
    }
    return b;
  }

  takeDamage(amount, sourceX, sourceY) {
    if (this.isBlocking) {
      amount = Math.ceil(amount * (1 - BLOCK_REDUCTION));
      for (let i = 0; i < 8; i++) {
        this.particles.push(new Particle(this.centerX, this.centerY,
          (Math.random()-0.5)*4, (Math.random()-0.5)*4, '#ffffff', 15, 2));
      }
    }
    this.hp -= amount;
    if (this.hp < 0) this.hp = 0;
    this.hitFlash = 8;
    const dx = this.centerX - sourceX, dy = this.centerY - sourceY;
    const dist = Math.sqrt(dx*dx+dy*dy) || 1;
    this.knockbackX = (dx/dist)*6; this.knockbackY = (dy/dist)*3;
    for (let i = 0; i < 8; i++) {
      this.particles.push(new Particle(
        this.centerX + (Math.random()-0.5)*20, this.centerY + (Math.random()-0.5)*20,
        (Math.random()-0.5)*5, (Math.random()-0.5)*5, '#ff8800', 15, 3));
    }
  }

  draw(c) {
    if (this.hp <= 0 && this.isOnline) return; // 在线对手死亡不绘制
    const flip = this.facingRight ? 1 : -1;
    const cx = Math.round(this.x), cy = Math.round(this.y);
    c.save();
    c.translate(cx + this.width / 2, cy);
    c.scale(flip, 1);

    for (const p of this.particles) p.draw(c);

    const w = this.width, h = this.height;
    if (this.hitFlash > 0 && this.hitFlash % 2 === 0) c.globalAlpha = 0.5;

    c.fillStyle = this.color;
    c.fillRect(Math.round(-w/2+2), Math.round(h-14), Math.round(w/2-4), 14);
    c.fillRect(Math.round(0), Math.round(h-14), Math.round(w/2-4), 14);
    c.fillStyle = this.accentColor;
    c.fillRect(Math.round(-w/2+2), Math.round(h-16), Math.round(w/2), 4);
    c.fillStyle = this.color;
    c.fillRect(Math.round(-w/2+2), Math.round(h*0.3), Math.round(w-4), Math.round(h*0.45));
    c.fillStyle = this.accentColor;
    c.fillRect(Math.round(-w/2+4), Math.round(h*0.32), Math.round(w-8), Math.round(h*0.08));
    c.fillRect(Math.round(-w/2+4), Math.round(h*0.55), Math.round(w-8), Math.round(h*0.06));
    c.fillStyle = this.lightColor;
    c.fillRect(Math.round(-w/4), Math.round(h*0.42), Math.round(w/2), Math.round(h*0.08));
    c.fillStyle = this.color;
    c.fillRect(Math.round(-w/4), Math.round(0), Math.round(w/2), Math.round(h*0.28));
    c.fillStyle = this.lightColor;
    c.fillRect(Math.round(-w/4+3), Math.round(4), Math.round(w/2-6), Math.round(h*0.18));
    c.fillStyle = this.accentColor;
    c.fillRect(Math.round(0), Math.round(-4), 2, 6);
    c.fillStyle = this.accentColor;
    c.fillRect(Math.round(-w/2-2), Math.round(h*0.28), Math.round(w/4+4), Math.round(h*0.12));
    c.fillRect(Math.round(w/4-2), Math.round(h*0.28), Math.round(w/4+4), Math.round(h*0.12));
    c.fillStyle = this.color;
    c.fillRect(Math.round(w/4), Math.round(h*0.38), Math.round(w/4), Math.round(h*0.38));
    c.fillRect(Math.round(-w/2), Math.round(h*0.38), Math.round(w/4), Math.round(h*0.38));
    c.fillStyle = this.accentColor;
    c.fillRect(Math.round(w/4), Math.round(h*0.72), Math.round(w/3), Math.round(h*0.1));

    if (this.isAttacking) {
      c.fillStyle = '#ffff00'; c.fillRect(Math.round(w/2+2), Math.round(h*0.35), 8, 4);
      c.fillStyle = '#ffffff'; c.fillRect(Math.round(w/2+4), Math.round(h*0.36), 4, 2);
    }
    if (this.isBlocking) {
      c.strokeStyle = this.lightColor; c.lineWidth = 2;
      c.globalAlpha = 0.5 + Math.sin(Date.now()*0.01)*0.2;
      c.beginPath(); c.arc(0, h*0.45, w*0.8, 0, Math.PI*2); c.stroke();
      c.globalAlpha = 1;
    }
    c.globalAlpha = 1;
    c.restore();

    if (!this.isOnline) {
      c.fillStyle = '#fff'; c.font = '8px "Press Start 2P"'; c.textAlign = 'center';
      c.fillText(this.id === 1 ? 'P1' : 'P2', cx + this.width / 2, cy - 10);
    } else {
      c.fillStyle = '#ff5252'; c.font = '8px "Press Start 2P"'; c.textAlign = 'center';
      c.fillText('对手', cx + this.width / 2, cy - 10);
    }
  }
}

// ============================================================
//  游戏主控制器
// ============================================================
const Game = {
  state: 'idle',
  mode: 'local', // 'local' | 'online'
  myOnlineRole: null,
  mecha1: null,
  mecha2: null,
  mechaMy: null,     // 在线模式下本地机甲
  mecha2P: null,     // 在线模式下对手机甲(远程)
  bullets: [],
  particles: [],
  bgStars: [],
  frameCount: 0,
  winner: null,
  shakeAmount: 0,
  onlineOpponentDead: false,

  init() {
    Input.init();
    TouchInput.init();

    for (let i = 0; i < 60; i++) {
      this.bgStars.push({ x: Math.random()*CANVAS_W, y: Math.random()*CANVAS_H,
        size: Math.random()*2+1, twinkle: Math.random()*Math.PI*2 });
    }

    this.mecha1 = new Mecha(1, 100, GROUND_Y - MECHA_H, '#2979ff', '#1565c0', '#82b1ff',
      { up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',attack:'Space',block:'ShiftLeft' }, true);
    this.mecha2 = new Mecha(2, CANVAS_W - 100 - MECHA_W, GROUND_Y - MECHA_H, '#ff1744', '#b71c1c', '#ff8a80',
      { up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',attack:'Enter',block:'ControlLeft' }, false);

    // 键盘
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.state === 'idle') this.startLocalGame();
      if (e.code === 'Enter' && this.state === 'gameover') this.restartLocal();
    });

    // 触摸画布
    canvas.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === 'idle') this.startLocalGame();
      if (this.state === 'gameover') {
        if (this.mode === 'online') this.restartOnline();
        else this.restartLocal();
      }
    });
    canvas.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

    // 联机面板按钮
    this.setupOnlinePanel();

    this.loop();
  },

  setupOnlinePanel() {
    const panel = document.getElementById('onlinePanel');
    const btnJoin = document.getElementById('btnJoinMatch');
    const btnCancel = document.getElementById('btnCancelMatch');
    const btnClose = document.getElementById('btnClosePanel');

    // 添加联机切换按钮到标题栏
    const titleBar = document.querySelector('.title-bar');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'online-toggle-btn';
    toggleBtn.textContent = '联机';
    toggleBtn.addEventListener('click', () => {
      if (this.state === 'playing') return;
      panel.classList.add('visible');
    });
    titleBar.appendChild(toggleBtn);

    // 从游戏内按钮打开
    this._onlineToggleBtn = toggleBtn;

    btnJoin.addEventListener('click', () => {
      Network.startMatching();
    });
    btnCancel.addEventListener('click', () => {
      Network.cancelMatching();
    });
    btnClose.addEventListener('click', () => {
      panel.classList.remove('visible');
    });
  },

  startLocalGame() {
    this.mode = 'local';
    this.state = 'playing';
    this.bullets = [];
    this.particles = [];
    this.frameCount = 0;
    this.winner = null;
    this.shakeAmount = 0;
    this.mecha1.reset(100, GROUND_Y - MECHA_H, true);
    this.mecha2.reset(CANVAS_W - 100 - MECHA_W, GROUND_Y - MECHA_H, false);
    this.mecha1.isOnline = false;
    this.mecha2.isOnline = false;
    bottomHint.classList.add('hidden');
    this._onlineToggleBtn.style.display = 'block';
  },

  startOnlineGame() {
    this.mode = 'online';
    this.myOnlineRole = Network.myRole;
    this.state = 'playing';
    this.bullets = [];
    this.particles = [];
    this.frameCount = 0;
    this.winner = null;
    this.shakeAmount = 0;
    this.onlineOpponentDead = false;
    Network.reset();

    if (this.myOnlineRole === 1) {
      // 我是蓝色机甲 (P1)
      this.mechaMy = this.mecha1;
      this.mechaMy.reset(100, GROUND_Y - MECHA_H, true);
      this.mechaMy.isOnline = false;
      this.mechaMy.playerId = 1;

      this.mecha2P = this.mecha2;
      this.mecha2P.reset(CANVAS_W - 100 - MECHA_W, GROUND_Y - MECHA_H, false);
      this.mecha2P.isOnline = true;
      this.mecha2P.playerId = 2;
    } else {
      // 我是红色机甲 (P2)
      this.mechaMy = this.mecha2;
      this.mechaMy.reset(CANVAS_W - 100 - MECHA_W, GROUND_Y - MECHA_H, false);
      this.mechaMy.isOnline = false;
      this.mechaMy.playerId = 2;

      this.mecha2P = this.mecha1;
      this.mecha2P.reset(100, GROUND_Y - MECHA_H, true);
      this.mecha2P.isOnline = true;
      this.mecha2P.playerId = 1;
    }
    bottomHint.classList.add('hidden');
    this._onlineToggleBtn.style.display = 'none';
  },

  restartLocal() { this.startLocalGame(); },

  restartOnline() {
    Network.sendRestart();
    this.startOnlineGame();
  },

  loop() {
    this.update();
    this.render();
    Input.update();
    requestAnimationFrame(() => this.loop());
  },

  update() {
    if (this.state !== 'playing') return;
    this.frameCount++;

    if (this.shakeAmount > 0) {
      this.shakeAmount *= 0.85;
      if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    }

    if (this.mode === 'local') {
      this.mecha1.update(this.bullets);
      this.mecha2.update(this.bullets);
    } else {
      // 在线模式
      this.mechaMy.update(this.bullets);
      // 同步对手状态
      this.mecha2P.updateOnline(Network.opponent);

      // 发送自己状态
      Network.sendMyState(this.mechaMy);

      // 处理对手子弹
      for (const bd of Network.pendingBullets) {
        const b = new Bullet(bd.x, bd.y, bd.vx, bd.vy, bd.color);
        this.bullets.push(b);
      }
      Network.pendingBullets = [];

      // 处理对手伤害
      if (Network.pendingDamage > 0) {
        this.mechaMy.hp = Network.pendingDamage;
        this.mechaMy.hitFlash = 8;
        Network.pendingDamage = 0;
      }

      // 碰撞检测：我的子弹 vs 在线对手
      this.checkOnlineBulletCollisions();
    }

    // 更新子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      this.bullets[i].update();
      if (!this.bullets[i].active) this.bullets.splice(i, 1);
    }

    if (this.mode === 'local') this.checkLocalBulletCollisions();

    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].dead) this.particles.splice(i, 1);
    }

    this.checkGameOver();
  },

  checkLocalBulletCollisions() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.active) continue;
      const target = b.vx > 0 ? this.mecha2 : this.mecha1;
      if (this.aabbCollision(b, target)) {
        target.takeDamage(ATTACK_DAMAGE, b.x, b.y);
        this.bullets.splice(i, 1);
        this.shakeAmount = 4;
        for (let j = 0; j < 6; j++) {
          this.particles.push(new Particle(b.x, b.y, (Math.random()-0.5)*4, (Math.random()-0.5)*4, '#ffaa00', 10, 3));
        }
      }
    }
  },

  checkOnlineBulletCollisions() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.active) continue;
      // 只检测本地发出的子弹 (我的子弹) 是否打到对手
      const isMyBullet = this.myOnlineRole === 1 ? b.vx > 0 : b.vx < 0;
      if (!isMyBullet) continue;

      if (this.aabbCollision(b, this.mecha2P)) {
        this.mecha2P.takeDamage(ATTACK_DAMAGE, b.x, b.y);
        Network.sendDamage(this.mecha2P.hp);
        this.bullets.splice(i, 1);
        this.shakeAmount = 4;
        for (let j = 0; j < 6; j++) {
          this.particles.push(new Particle(b.x, b.y, (Math.random()-0.5)*4, (Math.random()-0.5)*4, '#ffaa00', 10, 3));
        }
        if (this.mecha2P.hp <= 0) {
          Network.sendGameOver();
        }
      }
    }
  },

  aabbCollision(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  },

  checkGameOver() {
    let over = false;
    if (this.mode === 'local') {
      if (this.mecha1.hp <= 0) { this.state = 'gameover'; this.winner = 'player2'; this.spawnDeathParticles(this.mecha1); over = true; }
      else if (this.mecha2.hp <= 0) { this.state = 'gameover'; this.winner = 'player1'; this.spawnDeathParticles(this.mecha2); over = true; }
    } else {
      if (this.mechaMy.hp <= 0) {
        this.state = 'gameover';
        this.winner = this.myOnlineRole === 1 ? 'player2' : 'player1';
        this.spawnDeathParticles(this.mechaMy);
        over = true;
      }
    }
    if (over) {
      bottomHint.classList.remove('hidden');
      if (this.mode === 'local') {
        bottomHint.textContent = '点击屏幕重新开始';
      } else {
        bottomHint.textContent = this.winner === (this.myOnlineRole === 1 ? 'player1' : 'player2') ? '你赢了! 点击重新开始' : '你输了! 点击重新开始';
      }
    }
  },

  spawnDeathParticles(mecha) {
    for (let i = 0; i < 30; i++) {
      this.particles.push(new Particle(mecha.centerX, mecha.centerY,
        (Math.random()-0.5)*8, (Math.random()-0.5)*8-2, mecha.lightColor, 30+Math.random()*20, 2+Math.random()*3));
    }
    this.shakeAmount = 10;
  },

  render() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    let sx = 0, sy = 0;
    if (this.shakeAmount > 0) { sx = (Math.random()-0.5)*this.shakeAmount*2; sy = (Math.random()-0.5)*this.shakeAmount*2; }

    ctx.save(); ctx.translate(sx, sy);
    this.drawBackground(); this.drawGround();
    for (const p of this.particles) p.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    ctx.restore();

    if (this.mode === 'local') {
      if (this.mecha1.hp > 0) this.mecha1.draw(ctx);
      if (this.mecha2.hp > 0) this.mecha2.draw(ctx);
    } else if (this.mode === 'online' && this.mechaMy && this.mecha2P) {
      if (this.mechaMy.hp > 0) this.mechaMy.draw(ctx);
      if (this.mecha2P.hp > 0) this.mecha2P.draw(ctx);
    }

    this.drawHPBars();
    if (this.state === 'idle') this.drawIdleScreen();
    else if (this.state === 'gameover') this.drawGameOverScreen();
  },

  drawHPBars() {
    const barW = 180, barH = 14, barY = 14, p1X = 20, p2X = CANVAS_W - 20 - barW;
    let m1, m2, label1, label2, color1, color2;

    if (this.mode === 'online' && this.mechaMy && this.mecha2P) {
      if (this.myOnlineRole === 1) {
        m1 = this.mechaMy; m2 = this.mecha2P; label1 = '你(P1)'; label2 = '对手';
      } else {
        m1 = this.mecha2P; m2 = this.mechaMy; label1 = '对手'; label2 = '你(P2)';
      }
      color1 = '#4ade80'; color2 = '#f87171';
    } else {
      m1 = this.mecha1; m2 = this.mecha2; label1 = 'P1'; label2 = 'P2';
      color1 = '#4ade80'; color2 = '#f87171';
    }

    this._drawHPBar(p1X, barY, barW, barH, m1, label1, '#4fc3f7', color1);
    this._drawHPBar(p2X, barY, barW, barH, m2, label2, '#ff5252', color2);
    ctx.textAlign = 'start';
  },

  _drawHPBar(x, y, w, h, mecha, label, labelColor, barColor) {
    if (!mecha) return;
    const r = Math.max(0, mecha.hp / mecha.maxHp);
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = barColor; ctx.fillRect(x, y, Math.round(w * r), h);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = labelColor; ctx.font = '8px "Press Start 2P"';
    ctx.textAlign = x < CANVAS_W/2 ? 'left' : 'right';
    ctx.fillText(label, x < CANVAS_W/2 ? x : x+w, y - 4);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(Math.max(0, mecha.hp) + '/' + mecha.maxHp, x + w/2, y + h - 3);
  },

  drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#0a0a1a'); g.addColorStop(0.5, '#111133'); g.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const s of this.bgStars) {
      const tw = Math.sin(this.frameCount*0.02 + s.twinkle)*0.5+0.5;
      ctx.fillStyle = `rgba(255,255,255,${0.3+tw*0.5})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.size), Math.round(s.size));
    }
    ctx.fillStyle = '#1a1a33';
    const blds = [
      { x:30,w:40,h:80 },{ x:90,w:30,h:120 },{ x:140,w:50,h:60 },
      { x:600,w:35,h:100 },{ x:650,w:45,h:70 },{ x:710,w:30,h:90 }
    ];
    for (const b of blds) {
      ctx.fillRect(b.x, GROUND_Y-b.h, b.w, b.h);
      ctx.fillStyle = '#ffeb3b33';
      for (let wy = GROUND_Y-b.h+10; wy < GROUND_Y-10; wy += 20)
        for (let wx = b.x+6; wx < b.x+b.w-6; wx += 12)
          if (Math.sin(this.frameCount*0.03+wx*wy) > 0) ctx.fillRect(wx, wy, 6, 10);
      ctx.fillStyle = '#1a1a33';
    }
  },

  drawGround() {
    ctx.fillStyle = '#2d2d44'; ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    ctx.fillStyle = '#3d3d55'; ctx.fillRect(0, GROUND_Y, CANVAS_W, 2);
    ctx.strokeStyle = '#3d3d55'; ctx.lineWidth = 1;
    for (let x = 40; x < CANVAS_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y+4); ctx.lineTo(x, CANVAS_H); ctx.stroke(); }
    for (let y = GROUND_Y+20; y < CANVAS_H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke(); }
  },

  drawIdleScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffeb3b'; ctx.font = '28px "Press Start 2P"'; ctx.textAlign = 'center';
    ctx.fillText('像素机甲对战', CANVAS_W/2, CANVAS_H/2 - 45);
    ctx.fillStyle = '#aaa'; ctx.font = '10px "Press Start 2P"';
    ctx.fillText('PIXEL MECHA FIGHTER', CANVAS_W/2, CANVAS_H/2 - 15);
    this.drawMiniMecha(CANVAS_W/2-70, CANVAS_H/2+15, '#2979ff', '#82b1ff', true);
    this.drawMiniMecha(CANVAS_W/2+70, CANVAS_H/2+15, '#ff1744', '#ff8a80', false);
    if (Math.sin(this.frameCount*0.05) > 0) {
      ctx.fillStyle = '#fff'; ctx.font = '12px "Press Start 2P"';
      ctx.fillText(window.innerWidth < 768 ? '点击屏幕开始' : '按 ENTER 开始', CANVAS_W/2, CANVAS_H/2 + 60);
    }
    ctx.textAlign = 'start';
  },

  drawMiniMecha(x, y, color, light, facingRight) {
    const s = 1.5, flip = facingRight ? 1 : -1;
    ctx.save(); ctx.translate(x, y); ctx.scale(flip*s, s);
    ctx.fillStyle = color; ctx.fillRect(-6, -12, 8, 24);
    ctx.fillStyle = light; ctx.fillRect(-3, -8, 4, 6);
    ctx.fillStyle = color; ctx.fillRect(-8, -10, 4, 8); ctx.fillRect(4, -10, 4, 8);
    ctx.fillRect(-6, -14, 4, 4); ctx.fillRect(2, -14, 4, 4);
    ctx.restore();
  },

  drawGameOverScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';

    if (this.mode === 'online') {
      const iWon = this.winner === (this.myOnlineRole === 1 ? 'player1' : 'player2');
      ctx.fillStyle = iWon ? '#4ade80' : '#f87171';
      ctx.font = '32px "Press Start 2P"';
      ctx.fillText(iWon ? '胜利!' : '失败!', CANVAS_W/2, CANVAS_H/2 - 20);
      ctx.fillStyle = '#ffeb3b';
      ctx.font = '14px "Press Start 2P"';
      ctx.fillText(iWon ? '你击败了对手' : '被对手击败了', CANVAS_W/2, CANVAS_H/2 + 15);
    } else {
      ctx.fillStyle = '#ffeb3b'; ctx.font = '32px "Press Start 2P"';
      ctx.fillText(this.winner === 'player1' ? '玩家1 胜利!' : '玩家2 胜利!', CANVAS_W/2, CANVAS_H/2 - 30);
      const wc = this.winner === 'player1' ? '#4fc3f7' : '#ff5252';
      ctx.fillStyle = wc; ctx.font = '16px "Press Start 2P"';
      ctx.fillText(this.winner === 'player1' ? '蓝色机甲' : '红色机甲', CANVAS_W/2, CANVAS_H/2 + 10);
    }

    if (Math.sin(this.frameCount*0.05) > 0) {
      ctx.fillStyle = '#fff'; ctx.font = '10px "Press Start 2P"';
      ctx.fillText('点击屏幕重新开始', CANVAS_W/2, CANVAS_H/2 + 55);
    }
    ctx.textAlign = 'start';
  }
};

Game.init();