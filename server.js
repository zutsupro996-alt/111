// 像素机甲对战 - HTTP 轮询联机服务
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// 状态存储
const sessions = {};            // sessionId -> { state, opponentSessionId, role }
const matchQueue = [];          // 等待匹配的 sessionId

function createSession() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  sessions[id] = {
    state: { mecha: null, bullets: [], hp: 100 },
    opponentSessionId: null,
    role: null,
    lastSeen: Date.now()
  };
  return id;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 静态文件
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    let filePath = '.' + url.pathname;
    if (filePath === './') filePath = './index.html';
    const ext = String(path.extname(filePath)).toLowerCase();
    const ct = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png' }[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); }
      else { res.writeHead(200, { 'Content-Type': ct }); res.end(data); }
    });
    return;
  }

  // API 请求 body 解析
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(body); } catch (e) {}

    // 会话
    let sessionId = url.searchParams.get('sessionId') || data.sessionId;
    let session = sessions[sessionId];

    // 创建会话
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const id = createSession();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: id }));
      return;
    }

    if (!session) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid session' }));
      return;
    }
    session.lastSeen = Date.now();

    // 匹配
    if (url.pathname === '/api/match' && req.method === 'POST') {
      if (matchQueue.length > 0) {
        // 配对成功
        const opponentId = matchQueue.shift();
        const opponent = sessions[opponentId];
        session.role = 1;
        session.opponentSessionId = opponentId;
        opponent.role = 2;
        opponent.opponentSessionId = sessionId;
        // 通知双方
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'matched', role: 1 }));
        return;
      } else {
        matchQueue.push(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'waiting' }));
        return;
      }
    }

    // 检查匹配状态 (轮询)
    if (url.pathname === '/api/match-status' && req.method === 'GET') {
      if (session.opponentSessionId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'matched', role: session.role }));
      } else {
        // 检查是否还在队列中
        const inQueue = matchQueue.includes(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: inQueue ? 'waiting' : 'unknown' }));
      }
      return;
    }

    // 取消匹配
    if (url.pathname === '/api/cancel' && req.method === 'POST') {
      const idx = matchQueue.indexOf(sessionId);
      if (idx > -1) matchQueue.splice(idx, 1);
      if (session.opponentSessionId) {
        const opp = sessions[session.opponentSessionId];
        if (opp) { opp.opponentSessionId = null; }
        session.opponentSessionId = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cancelled' }));
      return;
    }

    // 上传我的状态
    if (url.pathname === '/api/state' && req.method === 'POST') {
      session.state = {
        mecha: data.mecha || session.state.mecha,
        bullets: data.bullets || [],
        hp: data.hp != null ? data.hp : session.state.hp,
        gameOver: data.gameOver || false,
        winner: data.winner || null
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 获取对手状态
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const oppId = session.opponentSessionId;
      const opponent = oppId ? sessions[oppId] : null;
      if (!opponent || !opponent.state.mecha) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          empty: true,
          opponentDisconnected: session.opponentSessionId && (!opponent || Date.now() - opponent.lastSeen > 10000)
        }));
        return;
      }
      // 检查对手是否超时
      const disconnected = Date.now() - opponent.lastSeen > 10000;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mecha: opponent.state.mecha,
        bullets: opponent.state.bullets,
        hp: opponent.state.hp,
        gameOver: opponent.state.gameOver,
        winner: opponent.state.winner,
        opponentDisconnected: disconnected
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

// 清理过期会话 (每30秒)
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of Object.entries(sessions)) {
    if (now - s.lastSeen > 60000) {
      delete sessions[id];
      const qi = matchQueue.indexOf(id);
      if (qi > -1) matchQueue.splice(qi, 1);
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});