const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYERS = ['지니', '윤정', '수히', '아름', '정하'];
const ROUND_COUNTS = { 3: 2, 5: 3, 7: 4 };
const DISCUSSION_SECONDS = 60;
const MAX_MESSAGE_LENGTH = 120;

// 라이어 키워드는 일반 키워드와 아예 다른 분야에서 뽑습니다.
// 예: 음식 vs 운동 / 장소 vs 물건 / 직업 vs 음식
const WORD_GROUPS = [
  ['커피','떡볶이','삼겹살','초밥','치킨','냉면','붕어빵','라면','아이스크림','햄버거','김치찌개','파스타','족발','마라탕','카레','김밥','된장찌개','샌드위치','피자','보쌈'],
  ['놀이공원','편의점','찜질방','피부과','영화관','공항','헬스장','PC방','카페','도서관','미용실','백화점','학교','병원','한강','호텔','노래방','회의실','탕비실','구내식당'],
  ['에어팟','우산','칫솔','고데기','보조배터리','노트북','키보드','마우스','텀블러','향수','지갑','볼펜','가위','안경','충전기','태블릿','헤드셋','사원증','프린터','명함'],
  ['의사','선생님','경찰','승무원','유튜버','아이돌','요리사','변호사','디자이너','개발자','사진작가','간호사','바리스타','마케터','기획자','기자','작가','배우','소방관','호텔리어'],
  ['캠핑','등산','수영','볼링','축구','농구','게임','데이트','러닝','서핑','당구','쇼핑','여행','소개팅','보드게임','야구','산책','노래','요리','사진'],
  ['회식','야근','회의','연차','출장','보고서','메신저','복사기','엘리베이터','출근','퇴근','월급날','반차','기획서','이메일','워크숍','점심시간','지각','인수인계','발표'],
  ['넷플릭스','유튜브','인스타그램','틱톡','카카오톡','배달앱','쇼핑앱','문자','웹툰','지도앱','검색','메일','영상','셀카','라이브방송','블로그','팟캐스트','스트리밍','게임방송','온라인쇼핑']
];

const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function connected(room) {
  return PLAYERS.filter(name => room.players[name]);
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function words() {
  const commonGroupIndex = Math.floor(Math.random() * WORD_GROUPS.length);
  let liarGroupIndex;
  do {
    liarGroupIndex = Math.floor(Math.random() * WORD_GROUPS.length);
  } while (liarGroupIndex === commonGroupIndex);

  return {
    common: pickOne(WORD_GROUPS[commonGroupIndex]),
    liar: pickOne(WORD_GROUPS[liarGroupIndex])
  };
}

function keyword(room, name) {
  return name === room.liar ? room.liarWord : room.commonWord;
}

function meta(room) {
  const playerCount = Math.max(1, room.baseOrder.length);
  const index = Math.min(room.turnIndex || 0, room.turnOrder.length);
  return {
    turnIndex: index,
    currentSpeaker: index < room.turnOrder.length ? room.turnOrder[index] : null,
    cycle: index < room.turnOrder.length ? Math.floor(index / playerCount) + 1 : room.roundCount,
    cyclePosition: index < room.turnOrder.length ? (index % playerCount) + 1 : playerCount
  };
}

function snapshot(room) {
  const m = meta(room);
  return {
    code: room.code,
    hostName: room.hostName,
    players: PLAYERS.map(name => ({
      name,
      connected: !!room.players[name],
      voted: !!room.votes[name]
    })),
    status: room.status,
    round: room.round,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    durationMinutes: room.durationMinutes,
    roundCount: room.roundCount,
    discussionSeconds: DISCUSSION_SECONDS,
    roundPlayers: room.roundPlayers || [],
    baseOrder: room.baseOrder || [],
    turnOrder: room.turnOrder || [],
    turnIndex: m.turnIndex,
    currentSpeaker: m.currentSpeaker,
    cycle: m.cycle,
    cyclePosition: m.cyclePosition,
    messages: room.messages || [],
    serverNow: Date.now(),
    results: room.results || null
  };
}

function broadcast(room) {
  io.to(room.code).emit('room:update', snapshot(room));
}

function startDiscussion(room) {
  if (room.status !== 'playing') return;
  room.status = 'discussion';
  room.endsAt = Date.now() + DISCUSSION_SECONDS * 1000;
  broadcast(room);
}

function startVoting(room) {
  if (!['playing', 'discussion'].includes(room.status)) return;
  room.status = 'voting';
  room.endsAt = null;
  broadcast(room);
  io.to(room.code).emit('timer:ended');
}

function finish(room) {
  if (room.status !== 'voting') return;
  const counts = {};
  room.roundPlayers.forEach(name => { counts[name] = 0; });
  Object.values(room.votes).forEach(name => {
    if (name in counts) counts[name] += 1;
  });
  const max = Math.max(...Object.values(counts));
  const top = room.roundPlayers.filter(name => counts[name] === max);
  room.status = 'result';
  room.results = {
    liar: room.liar,
    commonWord: room.commonWord,
    liarWord: room.liarWord,
    counts,
    top,
    caught: top.length === 1 && top[0] === room.liar
  };
  room.endsAt = null;
  broadcast(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === 'playing' && room.endsAt && now >= room.endsAt) {
      startDiscussion(room);
    } else if (room.status === 'discussion' && room.endsAt && now >= room.endsAt) {
      startVoting(room);
    }
  }
}, 250);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', socket => {
  socket.on('room:create', ({ name }, cb) => {
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: '등록된 참가자 이름이 아닙니다.' });
    const code = makeCode();
    const room = {
      code,
      hostName: name,
      players: {},
      status: 'lobby',
      round: 0,
      commonWord: null,
      liarWord: null,
      liar: null,
      startedAt: null,
      endsAt: null,
      durationMinutes: 5,
      roundCount: 3,
      roundPlayers: [],
      baseOrder: [],
      turnOrder: [],
      turnIndex: 0,
      messages: [],
      messageSeq: 0,
      votes: {},
      results: null
    };
    rooms.set(code, room);
    join(socket, room, name, cb);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    code = String(code || '').trim().toUpperCase();
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: '등록된 참가자 이름이 아닙니다.' });
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다.' });
    join(socket, room, name, cb);
  });

  socket.on('game:start', ({ code, durationMinutes }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName) return;

    const active = connected(room);
    if (active.length < 3) {
      socket.emit('error:message', '최소 3명이 입장해야 시작할 수 있습니다.');
      return;
    }

    const requested = Number(durationMinutes);
    const duration = ROUND_COUNTS[requested] ? requested : 5;
    const roundCount = ROUND_COUNTS[duration];
    const selectedWords = words();
    const baseOrder = shuffle(active);

    Object.assign(room, {
      durationMinutes: duration,
      roundCount,
      roundPlayers: [...active],
      baseOrder,
      turnOrder: Array.from({ length: roundCount }, () => baseOrder).flat(),
      turnIndex: 0,
      round: room.round + 1,
      commonWord: selectedWords.common,
      liarWord: selectedWords.liar,
      liar: active[Math.floor(Math.random() * active.length)],
      messages: [],
      messageSeq: 0,
      votes: {},
      results: null,
      status: 'playing',
      startedAt: Date.now()
    });

    room.endsAt = room.startedAt + duration * 60 * 1000;

    active.forEach(name => {
      const client = io.sockets.sockets.get(room.players[name]);
      if (!client) return;
      client.emit('keyword:reveal', {
        round: room.round,
        keyword: keyword(room, name),
        isLiar: name === room.liar
      });
      if (name === room.liar) {
        client.emit('error:message', '당신은 라이어입니다. 완전히 다른 키워드를 들키지 않게 설명하세요.');
      }
    });

    broadcast(room);
  });

  socket.on('message:send', ({ code, text }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const name = socket.data.name;

    if (!room || !['playing', 'discussion'].includes(room.status)) {
      return cb?.({ ok: false, error: '현재 작성 가능한 세션이 아닙니다.' });
    }
    if (!room.roundPlayers.includes(name)) {
      return cb?.({ ok: false, error: '이번 세션 참가자가 아닙니다.' });
    }

    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!clean) return cb?.({ ok: false, error: '설명을 입력하세요.' });
    if (clean.length > MAX_MESSAGE_LENGTH) {
      return cb?.({ ok: false, error: `${MAX_MESSAGE_LENGTH}자 이내로 입력하세요.` });
    }

    const myKeyword = keyword(room, name);
    if (myKeyword && clean.replace(/\s/g, '').includes(myKeyword.replace(/\s/g, ''))) {
      return cb?.({ ok: false, error: '자기 키워드 자체는 설명란에 입력할 수 없습니다.' });
    }

    if (room.status === 'playing') {
      const m = meta(room);
      if (m.currentSpeaker !== name) {
        return cb?.({ ok: false, error: `지금은 ${m.currentSpeaker} 님의 작성 차례입니다.` });
      }

      room.messages.push({
        id: ++room.messageSeq,
        name,
        text: clean,
        at: Date.now(),
        turnIndex: m.turnIndex,
        cycle: m.cycle,
        phase: 'turn'
      });
      room.turnIndex += 1;
      cb?.({ ok: true });

      if (room.turnIndex >= room.turnOrder.length) startDiscussion(room);
      else broadcast(room);
      return;
    }

    room.messages.push({
      id: ++room.messageSeq,
      name,
      text: clean,
      at: Date.now(),
      turnIndex: null,
      cycle: null,
      phase: 'discussion'
    });
    cb?.({ ok: true });
    broadcast(room);
  });

  socket.on('game:voteNow', ({ code }) => {
    const room = rooms.get(code);
    if (room && socket.data.name === room.hostName) startVoting(room);
  });

  socket.on('vote:submit', ({ code, target }, cb) => {
    const room = rooms.get(code);
    const voter = socket.data.name;
    if (!room || room.status !== 'voting') return cb?.({ ok: false, error: '지금은 투표 시간이 아닙니다.' });
    if (!room.roundPlayers.includes(voter) || !room.roundPlayers.includes(target)) {
      return cb?.({ ok: false, error: '이번 세션 참가자에게만 투표할 수 있습니다.' });
    }
    if (room.votes[voter]) return cb?.({ ok: false, error: '이미 투표했습니다.' });

    room.votes[voter] = target;
    cb?.({ ok: true });
    broadcast(room);

    const eligible = room.roundPlayers.filter(name => room.players[name]);
    if (eligible.length && eligible.filter(name => room.votes[name]).length >= eligible.length) finish(room);
  });

  socket.on('game:revealVotes', ({ code }) => {
    const room = rooms.get(code);
    if (room && socket.data.name === room.hostName) finish(room);
  });

  socket.on('disconnect', () => {
    const { roomCode, name } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || !name) return;

    if (room.players[name] === socket.id) delete room.players[name];

    if (name === room.hostName) {
      const remaining = connected(room);
      if (remaining.length) room.hostName = remaining[0];
    }

    if (room.status === 'playing') {
      while (room.turnIndex < room.turnOrder.length && !room.players[room.turnOrder[room.turnIndex]]) {
        room.turnIndex += 1;
      }
      if (room.turnIndex >= room.turnOrder.length) {
        startDiscussion(room);
        return;
      }
    }

    broadcast(room);
  });
});

function join(socket, room, name, cb) {
  const oldId = room.players[name];
  if (oldId && oldId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(oldId);
    if (oldSocket) {
      oldSocket.emit('session:replaced');
      oldSocket.disconnect(true);
    }
  }

  room.players[name] = socket.id;
  socket.data.roomCode = room.code;
  socket.data.name = name;
  socket.join(room.code);
  cb?.({ ok: true, code: room.code, hostName: room.hostName, name });
  broadcast(room);

  if (['playing', 'discussion'].includes(room.status) && room.roundPlayers.includes(name)) {
    socket.emit('keyword:reveal', {
      round: room.round,
      keyword: keyword(room, name),
      isLiar: name === room.liar
    });
    if (name === room.liar) {
      socket.emit('error:message', '당신은 라이어입니다. 완전히 다른 키워드를 들키지 않게 설명하세요.');
    }
  }
}

server.listen(PORT, () => console.log(`Weekly Coordination Sheet running on http://localhost:${PORT}`));
