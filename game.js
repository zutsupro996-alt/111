// ============================================================
//  像素机甲对战 - 联机版 (HTTP 轮询)
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const bottomHint = document.getElementById('bottomHint');

// ============================================================
//  常量
// ============================================================
const CANVAS_W = 800, CANVAS_H = 500, GROUND_Y = 420;
const MECHA_W = 36, MECHA_H = 52, MECHA_SPEED = 3;
const BULLET_SPEED = 7, BULLET_SIZE = 6;
const ATTACK_DAMAGE = 20, ATTACK_COOLDOWN = 35;
const BLOCK_DURATION = 40, BLOCK_REDUCTION = 0.8, MAX_HP = 100;

// ============================================================
//  键盘输入
// ============================================================
const Input = {
  keys: {}, pressed: {},
  init() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyJ','KeyK','Digit1','Digit2','Enter'].includes(e.code)) e.preventDefault();
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
    if (jsArea) this._setupJoystick(jsArea, jsThumb);
    const btnA = document.getElementById('btnAttackMain');
    const btnB = document.getElementById('btnBlockMain');
    if (btnA) this._setupButton(btnA, 'attack');
    if (btnB) this._setupButton(btnB, 'block');
  },
  _setupJoystick(area, thumb) {
    let activeTouchId = null;
    area.addEventListener('touchstart', (e) => {
      e.preventDefault(); if (activeTouchId !== null) return;
      const t = e.changedTouches[0]; activeTouchId = t.identifier;
      this._updateJoystickPos(area, thumb, t);
      this.joystick.active = true;
    });
    area.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === activeTouchId) this._updateJoystickPos(area, thumb, t);
    });
    const reset = () => { activeTouchId = null; thumb.style.transform = 'translate(-50%, -50%)';
      this.joystick.active = false; this.joystick.dx = 0; this.joystick.dy = 0; };
    area.addEventListener('touchend', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === activeTouchId) reset(); });
    area.addEventListener('touchcancel', reset);
  },
  _updateJoystickPos(area, thumb, touch) {
    const rect = area.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx, dy = touch.clientY - cy;
    const dist = Math.sqrt(dx*dx+dy*dy), maxR = 40;
    if (dist > maxR) { dx = (dx/dist)*maxR; dy = (dy/dist)*maxR; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const norm = dist > 5 ? (dist > maxR ? 1 : dist/maxR) : 0;
    const nd = Math.sqrt(dx*dx+dy*dy) || 1;
    this.joystick.dx = (dx/nd)*norm; this.joystick.dy = (dy/nd)*norm;
  },
  _setupButton(btn, action) {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.buttons[action] = true; this.buttons[action+'Pressed'] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); this.buttons[action] = false; });
    btn.addEventListener('touchcancel', () => { this.buttons[action] = false; });
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); this.buttons[action] = true; this.buttons[action+'Pressed'] = true; });
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
//  联机模块 (HTTP 轮询)
// ============================================================
const Network = {
  sessionId: null,      // 本机会话ID
  opponentSessionId: null,
  myRole: null,
  matched: false,
  matching: false,

  // 对手状态 (从服务器拉取)
  oppState: { mecha: { x:0,y:0,facingRight:false,isAttacking:false,isBlocking:false }, bullets: [], hp: MAX_HP, gameOver: false, winner: null, opponentDisconnected: false },

  // 本机需要上传的子弹(一次性, 已上传后清空)
  myBullets: [],

  _pendingSend: false,
  _pendingFetch: false,
  _oppStateDirty: false,

  async init() {
    // 恢复 sessionId
    this.sessionId = sessionStorage.getItem('mecha_session');
    if (!this.sessionId) {
      const res = await fetch('/api/session', { method: 'POST' });
      const d = await res.json();
      this.sessionId = d.sessionId;
      sessionStorage.setItem('mecha_session', this.sessionId);
    }
  },

  async startMatch() {
    this.matching = true;
    this.updateUI('waiting', '等待对手加入...');
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId })
    });
    const d = await res.json();
    if (d.status === 'matched') {
      this.matched = true;
      this.matching = false;
      this.myRole = d.role;
      const r = this.myRole === 1 ? '蓝色机甲' : '红色机甲';
      this.updateUI('matched', `配对成功! 你操控${r}`);
      setTimeout(() => {
        Game.startOnlineGame();
        document.getElementById('onlinePanel').classList.remove('visible');
      }, 1200);
    } else if (d.status === 'waiting') {
      // 轮询等待
      this.pollMatch();
    }
  },

  async pollMatch() {
    if (!this.matching) return;
    const res = await fetch(`/api/match-status?sessionId=${this.sessionId}`);
    const d = await res.json();
    if (d.status === 'matched') {
      this.matched = true;
      this.matching = false;
      this.myRole = d.role;
      const r = this.myRole === 1 ? '蓝色机甲' : '红色机甲';
      this.updateUI('matched', `配对成功! 你操控${r}`);
      setTimeout(() => {
        Game.startOnlineGame();
        document.getElementById('onlinePanel').classList.remove('visible');
      }, 1000);
    } else {
      setTimeout(() => this.pollMatch(), 1000);
    }
  },

  async cancelMatch() {
    this.matching = false;
    this.matched = false;
    await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId })
    });
    this.updateUI('disconnected', '已取消匹配');
  },

  // 上传我的状态 (非阻塞, 只发本地子弹)
  sendMyState(mecha, bullets) {
    if (!this.matched || this._pendingSend) return;
    this._pendingSend = true;
    // 只发送本地子弹 (排除 fromNetwork)
    const bs = bullets.filter(b => !b.fromNetwork).map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, color: b.color }));
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        mecha: { x: mecha.x, y: mecha.y, facingRight: mecha.facingRight, isAttacking: mecha.isAttacking, isBlocking: mecha.isBlocking },
        bullets: bs,
        hp: mecha.hp,
        gameOver: Game.state === 'gameover',
        winner: Game.winner
      })
    }).then(() => { this._pendingSend = false; })
      .catch(() => { this._pendingSend = false; });
  },

  // 拉取对手状态 (非阻塞)
  fetchOppState() {
    if (!this.matched || this._pendingFetch) return;
    this._pendingFetch = true;
    fetch(`/api/state?sessionId=${this.sessionId}`)
      .then(res => res.json())
      .then(d => {
        this._pendingFetch = false;
        if (!d.empty) {
          this.oppState = d;
          this._oppStateDirty = true;
        }
        if (d.opponentDisconnected) {
          this.matched = false;
          Game.state = 'idle';
          bottomHint.classList.remove('hidden');
          bottomHint.textContent = '对手离开了, 点击重新开始';
          this.updateUI('disconnected', '对手断开了连接');
        }
      })
      .catch(() => { this._pendingFetch = false; });
  },

  reset() {
    this.oppState = { mecha: { x:0,y:0,facingRight:false,isAttacking:false,isBlocking:false }, bullets: [], hp: MAX_HP, gameOver: false, winner: null, opponentDisconnected: false };
    this.myBullets = [];
    this._oppStateDirty = false;
    this._pendingSend = false;
    this._pendingFetch = false;
  },

  updateUI(statusClass, text) {
    const statusEl = document.getElementById('onlineStatus');
    const infoEl = document.getElementById('onlineInfo');
    const cancelBtn = document.getElementById('btnCancelMatch');
    if (!statusEl) return;
    statusEl.className = 'online-status';
    statusEl.textContent = text;
    if (statusClass === 'connected' || statusClass === 'matched') statusEl.classList.add('connected');
    else if (statusClass === 'waiting') statusEl.classList.add('waiting');
    if (statusClass === 'matched') { infoEl.textContent = '对手已就绪!'; infoEl.classList.add('matched'); }
    if (this.matching) cancelBtn.classList.add('visible');
    else cancelBtn.classList.remove('visible');
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
  draw(c) { const a = this.life/this.maxLife; c.globalAlpha = a; c.fillStyle = this.color; c.fillRect(Math.round(this.x), Math.round(this.y), Math.max(1,Math.round(this.size*a)), Math.max(1,Math.round(this.size*a))); c.globalAlpha = 1; }
  get dead() { return this.life <= 0; }
}

class Bullet {
  constructor(x, y, vx, vy, color) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.width = BULLET_SIZE; this.height = BULLET_SIZE;
    this.active = true; this.trail = [];
    this.fromNetwork = false; // 标记是否来自网络
  }
  update() {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4) this.trail.shift();
    this.x += this.vx; this.y += this.vy;
    if (this.x < -20 || this.x > CANVAS_W+20 || this.y < -20 || this.y > CANVAS_H+20) this.active = false;
  }
  draw(c) {
    for (let i = 0; i < this.trail.length; i++) {
      c.globalAlpha = (i+1)/this.trail.length*0.5;
      c.fillStyle = this.color;
      c.fillRect(Math.round(this.trail[i].x-2), Math.round(this.trail[i].y), 3, 3);
    }
    c.globalAlpha = 1;
    const bx = Math.round(this.x), by = Math.round(this.y);
    c.fillStyle = '#fff'; c.fillRect(bx, by, this.width, this.height);
    c.fillStyle = this.color; c.fillRect(bx+1, by+1, this.width-2, this.height-2);
    c.fillStyle = '#ffff88'; c.fillRect(bx+2, by+2, 2, 2);
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
    this.isOnline = false;
  }

  get centerX() { return this.x + this.width/2; }
  get centerY() { return this.y + this.height/2; }

  reset(x, y, fr) {
    this.x = x; this.y = y; this.hp = MAX_HP; this.facingRight = fr;
    this.isBlocking = false; this.blockTimer = 0; this.blockCooldown = 0;
    this.attackCooldown = 0; this.hitFlash = 0;
    this.knockbackX = 0; this.knockbackY = 0; this.particles = []; this.isOnline = false;
  }

  updateOnline(d) {
    this.x = d.x; this.y = d.y;
    this.facingRight = d.facingRight;
    this.isAttacking = d.isAttacking;
    this.isBlocking = d.isBlocking;
    this.hp = d.hp;
  }

  update(bullets) {
    if (this.isOnline) return;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.blockCooldown > 0) this.blockCooldown--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.knockbackX !== 0) { this.x += this.knockbackX; this.knockbackX *= 0.8; if (Math.abs(this.knockbackX) < 0.3) this.knockbackX = 0; }
    if (this.knockbackY !== 0) { this.y += this.knockbackY; this.knockbackY *= 0.8; if (Math.abs(this.knockbackY) < 0.3) this.knockbackY = 0; }
    if (this.isBlocking) { this.blockTimer--; if (this.blockTimer <= 0) this.isBlocking = false; }

    let mx = 0, my = 0;
    if (TouchInput.isActive()) { mx = TouchInput.getMoveX(); my = TouchInput.getMoveY(); }
    else {
      if (Input.isDown(this.controls.left)) mx = -1;
      if (Input.isDown(this.controls.right)) mx = 1;
      if (Input.isDown(this.controls.up)) my = -1;
      if (Input.isDown(this.controls.down)) my = 1;
    }
    if (mx !== 0 && my !== 0) { const m = Math.sqrt(mx*mx+my*my); mx/=m; my/=m; }
    this.x += mx*this.speed; this.y += my*this.speed;
    if (mx < 0) this.facingRight = false; if (mx > 0) this.facingRight = true;
    if (this.x < 0) this.x = 0;
    if (this.x+this.width > CANVAS_W) this.x = CANVAS_W-this.width;
    if (this.y < 35) this.y = 35;
    if (this.y+this.height > GROUND_Y) this.y = GROUND_Y-this.height;

    if (mx !== 0 || my !== 0) {
      this.animTimer++;
      if (this.animTimer % 3 === 0) this.particles.push(new Particle(this.x+this.width/2+(Math.random()-0.5)*10, this.y+this.height, (Math.random()-0.5)*1.5, -(Math.random()*1.5+0.5), this.lightColor, 12, 2));
    } else { this.animTimer = 0; }

    const ta = TouchInput.wasAttackPressed(), ka = Input.wasPressed(this.controls.attack);
    if ((ta || ka) && this.attackCooldown <= 0) {
      this.shoot(bullets);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.isAttacking = true;
      setTimeout(() => { this.isAttacking = false; }, 100);
    }

    const tb = TouchInput.wasBlockPressed(), kb = Input.wasPressed(this.controls.block);
    if ((tb || kb) && this.blockCooldown <= 0 && !this.isBlocking) {
      this.isBlocking = true; this.blockTimer = BLOCK_DURATION;
    }

    for (let i = this.particles.length-1; i >= 0; i--) { this.particles[i].update(); if (this.particles[i].dead) this.particles.splice(i,1); }
  }

  shoot(bullets) {
    const dir = this.facingRight ? 1 : -1;
    const bx = this.facingRight ? this.x+this.width : this.x-BULLET_SIZE;
    const by = this.y+this.height*0.35;
    bullets.push(new Bullet(bx, by, BULLET_SPEED*dir, 0, this.lightColor));
    for (let i = 0; i < 6; i++) this.particles.push(new Particle(bx+(this.facingRight?0:BULLET_SIZE), by+BULLET_SIZE/2, (Math.random()-0.5)*3+dir*2, (Math.random()-0.5)*3, '#ffff88', 8, 2));
  }

  takeDamage(amount, sx, sy) {
    if (this.isBlocking) {
      amount = Math.ceil(amount*(1-BLOCK_REDUCTION));
      for (let i=0;i<8;i++) this.particles.push(new Particle(this.centerX,this.centerY,(Math.random()-0.5)*4,(Math.random()-0.5)*4,'#ffffff',15,2));
    }
    this.hp -= amount; if (this.hp<0) this.hp=0; this.hitFlash=8;
    const dx=this.centerX-sx,dy=this.centerY-sy,dist=Math.sqrt(dx*dx+dy*dy)||1;
    this.knockbackX=(dx/dist)*6; this.knockbackY=(dy/dist)*3;
    for (let i=0;i<8;i++) this.particles.push(new Particle(this.centerX+(Math.random()-0.5)*20,this.centerY+(Math.random()-0.5)*20,(Math.random()-0.5)*5,(Math.random()-0.5)*5,'#ff8800',15,3));
  }

  draw(c) {
    if (this.hp <= 0 && this.isOnline) return;
    const flip = this.facingRight ? 1 : -1;
    const cx = Math.round(this.x), cy = Math.round(this.y);
    c.save(); c.translate(cx+this.width/2, cy); c.scale(flip, 1);
    for (const p of this.particles) p.draw(c);
    const w=this.width,h=this.height;
    if (this.hitFlash>0 && this.hitFlash%2===0) c.globalAlpha=0.5;
    c.fillStyle=this.color; c.fillRect(Math.round(-w/2+2),Math.round(h-14),Math.round(w/2-4),14); c.fillRect(Math.round(0),Math.round(h-14),Math.round(w/2-4),14);
    c.fillStyle=this.accentColor; c.fillRect(Math.round(-w/2+2),Math.round(h-16),Math.round(w/2),4);
    c.fillStyle=this.color; c.fillRect(Math.round(-w/2+2),Math.round(h*0.3),Math.round(w-4),Math.round(h*0.45));
    c.fillStyle=this.accentColor; c.fillRect(Math.round(-w/2+4),Math.round(h*0.32),Math.round(w-8),Math.round(h*0.08)); c.fillRect(Math.round(-w/2+4),Math.round(h*0.55),Math.round(w-8),Math.round(h*0.06));
    c.fillStyle=this.lightColor; c.fillRect(Math.round(-w/4),Math.round(h*0.42),Math.round(w/2),Math.round(h*0.08));
    c.fillStyle=this.color; c.fillRect(Math.round(-w/4),Math.round(0),Math.round(w/2),Math.round(h*0.28));
    c.fillStyle=this.lightColor; c.fillRect(Math.round(-w/4+3),Math.round(4),Math.round(w/2-6),Math.round(h*0.18));
    c.fillStyle=this.accentColor; c.fillRect(Math.round(0),Math.round(-4),2,6); c.fillRect(Math.round(-w/2-2),Math.round(h*0.28),Math.round(w/4+4),Math.round(h*0.12)); c.fillRect(Math.round(w/4-2),Math.round(h*0.28),Math.round(w/4+4),Math.round(h*0.12));
    c.fillStyle=this.color; c.fillRect(Math.round(w/4),Math.round(h*0.38),Math.round(w/4),Math.round(h*0.38)); c.fillRect(Math.round(-w/2),Math.round(h*0.38),Math.round(w/4),Math.round(h*0.38));
    c.fillStyle=this.accentColor; c.fillRect(Math.round(w/4),Math.round(h*0.72),Math.round(w/3),Math.round(h*0.1));
    if (this.isAttacking) { c.fillStyle='#ffff00'; c.fillRect(Math.round(w/2+2),Math.round(h*0.35),8,4); c.fillStyle='#ffffff'; c.fillRect(Math.round(w/2+4),Math.round(h*0.36),4,2); }
    if (this.isBlocking) { c.strokeStyle=this.lightColor; c.lineWidth=2; c.globalAlpha=0.5+Math.sin(Date.now()*0.01)*0.2; c.beginPath(); c.arc(0,h*0.45,w*0.8,0,Math.PI*2); c.stroke(); c.globalAlpha=1; }
    c.globalAlpha=1; c.restore();
    if (!this.isOnline) { c.fillStyle='#fff'; c.font='8px "Press Start 2P"'; c.textAlign='center'; c.fillText(this.id===1?'P1':'P2', cx+this.width/2, cy-10); }
    else { c.fillStyle='#ff5252'; c.font='8px "Press Start 2P"'; c.textAlign='center'; c.fillText('对手', cx+this.width/2, cy-10); }
  }
}

// ============================================================
//  游戏主控制器
// ============================================================
const Game = {
  state: 'idle', mode: 'local', myOnlineRole: null,
  mecha1: null, mecha2: null, mechaMy: null, mecha2P: null,
  bullets: [], particles: [], bgStars: [],
  frameCount: 0, winner: null, shakeAmount: 0,
  syncFrame: 0,

  async init() {
    Input.init(); TouchInput.init();
    await Network.init();

    for (let i = 0; i < 60; i++) this.bgStars.push({ x:Math.random()*CANVAS_W, y:Math.random()*CANVAS_H, size:Math.random()*2+1, twinkle:Math.random()*Math.PI*2 });

    this.mecha1 = new Mecha(1,100,GROUND_Y-MECHA_H,'#2979ff','#1565c0','#82b1ff',{up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',attack:'KeyJ',block:'KeyK'},true);
    this.mecha2 = new Mecha(2,CANVAS_W-100-MECHA_W,GROUND_Y-MECHA_H,'#ff1744','#b71c1c','#ff8a80',{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',attack:'Digit1',block:'Digit2'},false);

    window.addEventListener('keydown', (e) => { if (e.code==='Enter' && this.state==='idle') this.startLocalGame(); if (e.code==='Enter' && this.state==='gameover') this.restartLocal(); });
    canvas.addEventListener('click', (e) => { e.stopPropagation(); if (this.state==='idle') this.startLocalGame(); if (this.state==='gameover') { if (this.mode==='online') this.restartOnline(); else this.restartLocal(); } });
    canvas.addEventListener('touchstart', (e) => { if (e.touches.length>1) e.preventDefault(); }, {passive:false});

    this.setupOnlinePanel();
    this.loop();
  },

  setupOnlinePanel() {
    const panel = document.getElementById('onlinePanel');
    const btnJoin = document.getElementById('btnJoinMatch');
    const btnCancel = document.getElementById('btnCancelMatch');
    const btnClose = document.getElementById('btnClosePanel');
    const titleBar = document.querySelector('.title-bar');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'online-toggle-btn'; toggleBtn.textContent = '联机';
    toggleBtn.addEventListener('click', () => { if (this.state==='playing') return; panel.classList.add('visible'); });
    titleBar.appendChild(toggleBtn);
    this._onlineToggleBtn = toggleBtn;
    btnJoin.addEventListener('click', () => Network.startMatch());
    btnCancel.addEventListener('click', () => Network.cancelMatch());
    btnClose.addEventListener('click', () => panel.classList.remove('visible'));
  },

  startLocalGame() {
    this.mode = 'local'; this.state = 'playing';
    this.bullets = []; this.particles = []; this.frameCount = 0;
    this.winner = null; this.shakeAmount = 0; this.syncFrame = 0;
    this.mecha1.reset(100, GROUND_Y-MECHA_H, true); this.mecha1.isOnline = false;
    this.mecha2.reset(CANVAS_W-100-MECHA_W, GROUND_Y-MECHA_H, false); this.mecha2.isOnline = false;
    bottomHint.classList.add('hidden'); this._onlineToggleBtn.style.display = 'block';
  },

  startOnlineGame() {
    this.mode = 'online'; this.myOnlineRole = Network.myRole;
    this.state = 'playing'; this.bullets = []; this.particles = [];
    this.frameCount = 0; this.winner = null; this.shakeAmount = 0; this.syncFrame = 0;
    Network.reset();

    if (this.myOnlineRole === 1) {
      this.mechaMy = this.mecha1; this.mechaMy.reset(100, GROUND_Y-MECHA_H, true); this.mechaMy.isOnline = false; this.mechaMy.playerId = 1;
      this.mecha2P = this.mecha2; this.mecha2P.reset(CANVAS_W-100-MECHA_W, GROUND_Y-MECHA_H, false); this.mecha2P.isOnline = true; this.mecha2P.playerId = 2;
    } else {
      this.mechaMy = this.mecha2; this.mechaMy.reset(CANVAS_W-100-MECHA_W, GROUND_Y-MECHA_H, false); this.mechaMy.isOnline = false; this.mechaMy.playerId = 2;
      this.mecha2P = this.mecha1; this.mecha2P.reset(100, GROUND_Y-MECHA_H, true); this.mecha2P.isOnline = true; this.mecha2P.playerId = 1;
    }
    bottomHint.classList.add('hidden'); this._onlineToggleBtn.style.display = 'none';
  },

  restartLocal() { this.startLocalGame(); },
  restartOnline() { this.startOnlineGame(); },

  loop() { this.update(); this.render(); Input.update(); requestAnimationFrame(() => this.loop()); },

  update() {
    if (this.state !== 'playing') return;
    this.frameCount++; this.syncFrame++;
    if (this.shakeAmount > 0) { this.shakeAmount *= 0.85; if (this.shakeAmount < 0.1) this.shakeAmount = 0; }

    if (this.mode === 'local') {
      this.mecha1.update(this.bullets);
      this.mecha2.update(this.bullets);
    } else {
      this.mechaMy.update(this.bullets);

      // 每帧发送我的状态 (非阻塞)
      Network.sendMyState(this.mechaMy, this.bullets);
      // 每2帧拉取对手状态 (非阻塞)
      if (this.syncFrame >= 2) {
        this.syncFrame = 0;
        Network.fetchOppState();
      }

      // 更新对手位置
      this.mecha2P.updateOnline(Network.oppState.mecha);

      // 仅当收到新对手数据时才更新对手子弹
      if (Network._oppStateDirty) {
        Network._oppStateDirty = false;
        this.bullets = this.bullets.filter(b => !b.fromNetwork);
        for (const bd of Network.oppState.bullets) {
          const b = new Bullet(bd.x, bd.y, bd.vx, bd.vy, bd.color);
          b.fromNetwork = true;
          this.bullets.push(b);
        }
      }

      // 处理对手游戏结束
      if (Network.oppState.gameOver && this.state === 'playing') {
        this.state = 'gameover';
        this.winner = this.myOnlineRole === 1 ? 'player1' : 'player2';
        this.spawnDeathParticles(this.mecha2P);
        bottomHint.classList.remove('hidden');
        bottomHint.textContent = '你赢了! 点击重新开始';
      }
      if (Network.oppState.opponentDisconnected) {
        this.state = 'idle';
        bottomHint.classList.remove('hidden');
        bottomHint.textContent = '对手离开了';
        return;
      }
    }

    // 更新所有子弹
    for (let i = this.bullets.length-1; i >= 0; i--) { this.bullets[i].update(); if (!this.bullets[i].active) this.bullets.splice(i,1); }

    // 碰撞检测
    if (this.mode === 'local') this.checkLocalBulletCollisions();
    else this.checkOnlineBulletCollisions();

    // 粒子
    for (let i = this.particles.length-1; i >= 0; i--) { this.particles[i].update(); if (this.particles[i].dead) this.particles.splice(i,1); }

    this.checkGameOver();
  },

  checkLocalBulletCollisions() {
    for (let i = this.bullets.length-1; i >= 0; i--) {
      const b = this.bullets[i]; if (!b.active) continue;
      const target = b.vx > 0 ? this.mecha2 : this.mecha1;
      if (this.aabb(b, target)) { target.takeDamage(ATTACK_DAMAGE, b.x, b.y); this.bullets.splice(i,1); this.shakeAmount=4; for (let j=0;j<6;j++) this.particles.push(new Particle(b.x,b.y,(Math.random()-0.5)*4,(Math.random()-0.5)*4,'#ffaa00',10,3)); }
    }
  },

  checkOnlineBulletCollisions() {
    // 检测对手子弹是否击中我 (自己扣自己HP, 上报给服务器)
    for (let i = this.bullets.length-1; i >= 0; i--) {
      const b = this.bullets[i]; if (!b.active || !b.fromNetwork) continue;
      if (this.aabb(b, this.mechaMy)) {
        this.mechaMy.takeDamage(ATTACK_DAMAGE, b.x, b.y);
        this.bullets.splice(i,1); this.shakeAmount=4;
        for (let j=0;j<6;j++) this.particles.push(new Particle(b.x,b.y,(Math.random()-0.5)*4,(Math.random()-0.5)*4,'#ffaa00',10,3));
      }
    }
    // 检测我的子弹是否击中对手 (仅移除子弹+特效, 对手自己扣HP)
    for (let i = this.bullets.length-1; i >= 0; i--) {
      const b = this.bullets[i]; if (!b.active || b.fromNetwork) continue;
      if (this.aabb(b, this.mecha2P)) {
        this.bullets.splice(i,1); this.shakeAmount=4;
        for (let j=0;j<6;j++) this.particles.push(new Particle(b.x,b.y,(Math.random()-0.5)*4,(Math.random()-0.5)*4,'#ffaa00',10,3));
      }
    }
  },

  aabb(a, b) { return a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y; },

  checkGameOver() {
    if (this.mode === 'local') {
      if (this.mecha1.hp <= 0) { this.state='gameover'; this.winner='player2'; this.spawnDeathParticles(this.mecha1); bottomHint.classList.remove('hidden'); bottomHint.textContent='点击重新开始'; }
      else if (this.mecha2.hp <= 0) { this.state='gameover'; this.winner='player1'; this.spawnDeathParticles(this.mecha2); bottomHint.classList.remove('hidden'); bottomHint.textContent='点击重新开始'; }
    } else {
      if (this.mechaMy.hp <= 0) { this.state='gameover'; this.winner=this.myOnlineRole===1?'player2':'player1'; this.spawnDeathParticles(this.mechaMy); bottomHint.classList.remove('hidden'); bottomHint.textContent='你输了! 点击重新开始'; }
      else if (Network.oppState.hp <= 0 && !Network.oppState.gameOver) {
        Network.oppState.gameOver = true;
        this.state = 'gameover';
        this.winner = this.myOnlineRole === 1 ? 'player1' : 'player2';
        this.spawnDeathParticles(this.mecha2P);
        bottomHint.classList.remove('hidden');
        bottomHint.textContent = '你赢了! 点击重新开始';
      }
    }
  },

  spawnDeathParticles(mecha) { for (let i=0;i<30;i++) this.particles.push(new Particle(mecha.centerX,mecha.centerY,(Math.random()-0.5)*8,(Math.random()-0.5)*8-2,mecha.lightColor,30+Math.random()*20,2+Math.random()*3)); this.shakeAmount=10; },

  render() {
    ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
    let sx=0,sy=0; if (this.shakeAmount>0) { sx=(Math.random()-0.5)*this.shakeAmount*2; sy=(Math.random()-0.5)*this.shakeAmount*2; }
    ctx.save(); ctx.translate(sx,sy);
    this.drawBg(); this.drawGround();
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
    if (this.state === 'idle') this.drawIdle();
    else if (this.state === 'gameover') this.drawGameOver();
  },

  drawHPBars() {
    const bw=180,bh=14,by=14;
    let m1,m2,l1,l2,c1,c2;
    if (this.mode==='online' && this.mechaMy && this.mecha2P) {
      if (this.myOnlineRole===1) { m1=this.mechaMy; m2=this.mecha2P; l1='你(P1)'; l2='对手'; }
      else { m1=this.mecha2P; m2=this.mechaMy; l1='对手'; l2='你(P2)'; }
      c1='#4ade80'; c2='#f87171';
    } else { m1=this.mecha1; m2=this.mecha2; l1='P1'; l2='P2'; c1='#4ade80'; c2='#f87171'; }
    if (m1) this._drawBar(20,by,bw,bh,m1,l1,'#4fc3f7',c1);
    if (m2) this._drawBar(CANVAS_W-20-bw,by,bw,bh,m2,l2,'#ff5252',c2);
    ctx.textAlign='start';
  },
  _drawBar(x,y,w,h,m,label,lc,bc) {
    if (!m) return; const r=Math.max(0,m.hp/m.maxHp);
    ctx.fillStyle='#333'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle=bc; ctx.fillRect(x,y,Math.round(w*r),h);
    ctx.strokeStyle='#666'; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=lc; ctx.font='8px "Press Start 2P"'; ctx.textAlign=x<CANVAS_W/2?'left':'right';
    ctx.fillText(label, x<CANVAS_W/2?x:x+w, y-4);
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.fillText(Math.max(0,m.hp)+'/'+m.maxHp, x+w/2, y+h-3);
  },

  drawBg() {
    const g=ctx.createLinearGradient(0,0,0,CANVAS_H); g.addColorStop(0,'#0a0a1a'); g.addColorStop(0.5,'#111133'); g.addColorStop(1,'#1a1a2e');
    ctx.fillStyle=g; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
    for (const s of this.bgStars) { const tw=Math.sin(this.frameCount*0.02+s.twinkle)*0.5+0.5; ctx.fillStyle=`rgba(255,255,255,${0.3+tw*0.5})`; ctx.fillRect(Math.round(s.x),Math.round(s.y),Math.round(s.size),Math.round(s.size)); }
    ctx.fillStyle='#1a1a33';
    [{x:30,w:40,h:80},{x:90,w:30,h:120},{x:140,w:50,h:60},{x:600,w:35,h:100},{x:650,w:45,h:70},{x:710,w:30,h:90}].forEach(b=>{ctx.fillRect(b.x,GROUND_Y-b.h,b.w,b.h);ctx.fillStyle='#ffeb3b33';for(let wy=GROUND_Y-b.h+10;wy<GROUND_Y-10;wy+=20)for(let wx=b.x+6;wx<b.x+b.w-6;wx+=12)if(Math.sin(this.frameCount*0.03+wx*wy)>0)ctx.fillRect(wx,wy,6,10);ctx.fillStyle='#1a1a33';});
  },

  drawGround() { ctx.fillStyle='#2d2d44'; ctx.fillRect(0,GROUND_Y,CANVAS_W,CANVAS_H-GROUND_Y); ctx.fillStyle='#3d3d55'; ctx.fillRect(0,GROUND_Y,CANVAS_W,2); ctx.strokeStyle='#3d3d55'; ctx.lineWidth=1; for(let x=40;x<CANVAS_W;x+=40){ctx.beginPath();ctx.moveTo(x,GROUND_Y+4);ctx.lineTo(x,CANVAS_H);ctx.stroke();} for(let y=GROUND_Y+20;y<CANVAS_H;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CANVAS_W,y);ctx.stroke();} },

  drawIdle() {
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
    ctx.fillStyle='#ffeb3b'; ctx.font='28px "Press Start 2P"'; ctx.textAlign='center'; ctx.fillText('像素机甲对战',CANVAS_W/2,CANVAS_H/2-45);
    ctx.fillStyle='#aaa'; ctx.font='10px "Press Start 2P"'; ctx.fillText('PIXEL MECHA FIGHTER',CANVAS_W/2,CANVAS_H/2-15);
    this.drawMini(CANVAS_W/2-70,CANVAS_H/2+15,'#2979ff','#82b1ff',true);
    this.drawMini(CANVAS_W/2+70,CANVAS_H/2+15,'#ff1744','#ff8a80',false);
    if (Math.sin(this.frameCount*0.05)>0) { ctx.fillStyle='#fff'; ctx.font='12px "Press Start 2P"'; ctx.fillText(window.innerWidth<768?'点击屏幕开始':'按 ENTER 开始',CANVAS_W/2,CANVAS_H/2+60); }
    ctx.textAlign='start';
  },

  drawMini(x,y,c,l,fr) { const s=1.5,f=fr?1:-1; ctx.save(); ctx.translate(x,y); ctx.scale(f*s,s); ctx.fillStyle=c; ctx.fillRect(-6,-12,8,24); ctx.fillStyle=l; ctx.fillRect(-3,-8,4,6); ctx.fillStyle=c; ctx.fillRect(-8,-10,4,8); ctx.fillRect(4,-10,4,8); ctx.fillRect(-6,-14,4,4); ctx.fillRect(2,-14,4,4); ctx.restore(); },

  drawGameOver() {
    ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); ctx.textAlign='center';
    if (this.mode==='online') {
      const iW = this.winner===(this.myOnlineRole===1?'player1':'player2');
      ctx.fillStyle=iW?'#4ade80':'#f87171'; ctx.font='32px "Press Start 2P"'; ctx.fillText(iW?'胜利!':'失败!',CANVAS_W/2,CANVAS_H/2-20);
      ctx.fillStyle='#ffeb3b'; ctx.font='14px "Press Start 2P"'; ctx.fillText(iW?'你击败了对手':'被对手击败了',CANVAS_W/2,CANVAS_H/2+15);
    } else {
      ctx.fillStyle='#ffeb3b'; ctx.font='32px "Press Start 2P"'; ctx.fillText(this.winner==='player1'?'玩家1 胜利!':'玩家2 胜利!',CANVAS_W/2,CANVAS_H/2-30);
      ctx.fillStyle=this.winner==='player1'?'#4fc3f7':'#ff5252'; ctx.font='16px "Press Start 2P"'; ctx.fillText(this.winner==='player1'?'蓝色机甲':'红色机甲',CANVAS_W/2,CANVAS_H/2+10);
    }
    if (Math.sin(this.frameCount*0.05)>0) { ctx.fillStyle='#fff'; ctx.font='10px "Press Start 2P"'; ctx.fillText('点击重新开始',CANVAS_W/2,CANVAS_H/2+55); }
    ctx.textAlign='start';
  }
};

Game.init();