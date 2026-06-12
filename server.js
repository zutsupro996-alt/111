// 像素机甲对战 - WebSocket 联机服务
// 支持 1v1 玩家配对、状态同步

const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// 玩家状态机
const WAITING = 'waiting';
const PLAYING = 'playing';

// 玩家集合
let players = [];
// 当前等待匹配的玩家
let waitingPlayer = null;

const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
  }[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if(error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const playerId = Date.now() + Math.random().toString(36).slice(2);
  const player = { id: playerId, ws, role: null, opponent: null, state: WAITING };
  players.push(player);

  console.log(`[connect] player ${playerId} connected. total: ${players.length}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(player, msg);
    } catch (e) {
      console.error(`[message] parse error:`, e);
    }
  });

  ws.on('close', () => {
    console.log(`[disconnect] player ${playerId} disconnected`);
    // 清理
    if (player.opponent) {
      const opponent = players.find(p => p.id === player.opponent);
      if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_left' }));
        opponent.state = WAITING;
        opponent.opponent = null;
      }
    }
    if (waitingPlayer && waitingPlayer.id === player.id) {
      waitingPlayer = null;
    }
    players = players.filter(p => p.id !== playerId);
  });

  // 发送欢迎
  ws.send(JSON.stringify({ type: 'welcome', playerId }));
});

function handleMessage(player, msg) {
  switch (msg.type) {
    case 'matchmaking':
      startMatchmaking(player);
      break;
    case 'game_state':
      // 转发对手状态
      if (player.opponent && player.state === PLAYING) {
        const opponent = players.find(p => p.id === player.opponent);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
          opponent.ws.send(JSON.stringify({
            type: 'opponent_state',
            mecha: msg.mecha,
            bullets: msg.bullets,
            hp: msg.hp
          }));
        }
      }
      break;
    case 'attack':
      // 转发攻击事件
      if (player.opponent && player.state === PLAYING) {
        const opponent = players.find(p => p.id === player.opponent);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
          opponent.ws.send(JSON.stringify({ type: 'opponent_attack', bullet: msg.bullet }));
        }
      }
      break;
    case 'damage':
      // 伤害事件
      if (player.opponent && player.state === PLAYING) {
        const opponent = players.find(p => p.id === player.opponent);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
          opponent.ws.send(JSON.stringify({ type: 'damage', hp: msg.hp }));
        }
      }
      break;
    case 'game_over':
      if (player.opponent && player.state === PLAYING) {
        const opponent = players.find(p => p.id === player.opponent);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
          opponent.ws.send(JSON.stringify({ type: 'game_over', winner: msg.winner }));
        }
      }
      break;
    case 'restart':
      if (player.opponent && player.state === WAITING) {
        const opponent = players.find(p => p.id === player.opponent);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
          opponent.ws.send(JSON.stringify({ type: 'restart' }));
        }
      }
      break;
    default:
      break;
  }
}

function startMatchmaking(player) {
  // 如果有等待玩家，配对
  if (waitingPlayer && waitingPlayer.id !== player.id) {
    // 配对成功
    player.role = 1;       // 玩家1 (蓝色)
    waitingPlayer.role = 2; // 玩家2 (红色)
    player.opponent = waitingPlayer.id;
    waitingPlayer.opponent = player.id;
    player.state = PLAYING;
    waitingPlayer.state = PLAYING;

    // 通知双方
    player.ws.send(JSON.stringify({
      type: 'matched',
      role: player.role,
      opponentId: waitingPlayer.id
    }));
    waitingPlayer.ws.send(JSON.stringify({
      type: 'matched',
      role: waitingPlayer.role,
      opponentId: player.id
    }));

    console.log(`[match] paired ${player.id} (P${player.role}) vs ${waitingPlayer.id} (P${waitingPlayer.role})`);
    waitingPlayer = null;
  } else {
    // 没有等待玩家，自己进入等待队列
    if (waitingPlayer) {
      // 踢掉之前的等待玩家（断开情况清理）
      if (waitingPlayer.ws.readyState !== WebSocket.OPEN) {
        waitingPlayer = null;
      }
    }
    waitingPlayer = player;
    player.state = WAITING;
    player.ws.send(JSON.stringify({ type: 'waiting' }));
    console.log(`[match] player ${player.id} waiting...`);
  }
}

server.listen(PORT, () => {
  console.log(`Pixel Mecha Online server running on http://localhost:${PORT}`);
  console.log(`- Open this URL in two browser tabs to test 1v1 online`);
});
