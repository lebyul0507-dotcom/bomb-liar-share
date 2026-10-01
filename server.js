const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { questionBank: TELEPATHY_QUESTION_BANK, allQuestions: TELEPATHY_ALL_QUESTIONS } = require('./telepathy-questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYERS = ['파랑새', '핫걸 지니', '아르미', '나애 정하', '벼리', '리하맘'];
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
    results: room.results || null,
    developerMode: !!room.developerMode
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

  socket.on('game:developerMode', ({ code, enabled }, cb) => {
    const room=rooms.get(String(code||'').toUpperCase());
    if(!room||socket.data.name!==room.hostName||room.status!=='lobby') return cb?.({ok:false,error:'대기실 방장만 변경할 수 있습니다.'});
    room.developerMode=!!enabled; broadcast(room); cb?.({ok:true});
  });

  socket.on('game:start', ({ code, durationMinutes }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName) return;

    const active = connected(room);
    if (active.length < (room.developerMode ? 1 : 3)) {
      socket.emit('error:message', room.developerMode ? '개발자 모드에서는 1명 이상이면 시작할 수 있습니다.' : '최소 3명이 입장해야 시작할 수 있습니다.');
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

  socket.on('game:stop', ({ code }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || socket.data.name !== room.hostName) return cb?.({ ok:false, error:'방장만 게임을 중단할 수 있습니다.' });
    Object.assign(room, {
      status: 'lobby',
      roundPlayers: [],
      baseOrder: [],
      turnOrder: [],
      turnIndex: 0,
      messages: [],
      votes: {},
      results: null,
      commonWord: null,
      liarWord: null,
      liar: null,
      startedAt: null,
      endsAt: null
    });
    broadcast(room);
    cb?.({ ok:true });
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


const relayRooms = new Map();

function relayCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (relayRooms.has(code) || rooms.has(code));
  return code;
}

function relayConnected(room) {
  return room.roundPlayers?.length
    ? room.roundPlayers.filter(name => room.players[name])
    : PLAYERS.filter(name => room.players[name]);
}

function relaySnapshot(room) {
  return {
    code: room.code,
    hostName: room.hostName,
    status: room.status,
    players: PLAYERS.map(name => ({ name, connected: !!room.players[name] })),
    roundPlayers: room.roundPlayers || [],
    order: room.order || [],
    submitted: room.submitted || [],
    result: room.status === 'result' ? room.result : null,
    serverNow: Date.now(),
    developerMode: !!room.developerMode
  };
}

function relayBroadcast(room) {
  io.to('relay:' + room.code).emit('relay:update', relaySnapshot(room));
}

function relayTaskFor(room, name) {
  const n = room.order.length;
  const i = room.order.indexOf(name);
  if (i < 0 || !n) return null;
  if (room.status === 'sentence') return { stage: 'sentence' };
  if (room.status === 'draw') {
    const starter = room.order[(i - 1 + n) % n];
    return { stage: 'draw', starter, sentence: room.sentences[starter] || '' };
  }
  if (room.status === 'guess') {
    const starter = room.order[(i - 2 + n) % n];
    const drawing = room.drawings[starter];
    return { stage: 'guess', starter, image: drawing?.data || '' };
  }
  return { stage: room.status };
}

function relaySendTasks(room) {
  relayConnected(room).forEach(name => {
    const sid = room.players[name];
    const client = io.sockets.sockets.get(sid);
    if (client) client.emit('relay:task', relayTaskFor(room, name));
  });
}

function relayMaybeAdvance(room) {
  const active = relayConnected(room);
  if (!active.length) return;

  if (room.status === 'sentence') {
    const done = active.every(name => room.sentences[name]);
    if (!done) return;
    room.status = 'draw';
    room.submitted = [];
    relayBroadcast(room);
    relaySendTasks(room);
    return;
  }

  if (room.status === 'draw') {
    const neededStarters = active.map(name => {
      const i = room.order.indexOf(name);
      return room.order[(i - 1 + room.order.length) % room.order.length];
    });
    const done = neededStarters.every(starter => room.drawings[starter]?.data);
    if (!done) return;
    room.status = 'guess';
    room.submitted = [];
    relayBroadcast(room);
    relaySendTasks(room);
    return;
  }

  if (room.status === 'guess') {
    const neededStarters = active.map(name => {
      const i = room.order.indexOf(name);
      return room.order[(i - 2 + room.order.length) % room.order.length];
    });
    const done = neededStarters.every(starter => room.guesses[starter]);
    if (!done) return;

    room.status = 'result';
    room.result = room.order.map(starter => ({
      starter,
      sentence: room.sentences[starter] || '(중도 이탈)',
      drawing: room.drawings[starter]?.data || '',
      artist: room.drawings[starter]?.artist || '-',
      guess: room.guesses[starter]?.text || '(중도 이탈)',
      guesser: room.guesses[starter]?.guesser || '-'
    }));
    room.submitted = [];
    relayBroadcast(room);
  }
}

io.on('connection', socket => {
  socket.on('relay:create', ({ name }, cb) => {
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: '등록된 참가자 이름이 아닙니다.' });
    const code = relayCode();
    const room = {
      code,
      hostName: name,
      players: {},
      status: 'lobby',
      roundPlayers: [],
      order: [],
      sentences: {},
      drawings: {},
      guesses: {},
      submitted: [],
      result: null
    };
    relayRooms.set(code, room);
    relayJoin(socket, room, name, cb);
  });

  socket.on('relay:join', ({ code, name }, cb) => {
    code = String(code || '').trim().toUpperCase();
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: '등록된 참가자 이름이 아닙니다.' });
    const room = relayRooms.get(code);
    if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다.' });
    relayJoin(socket, room, name, cb);
  });

  socket.on('relay:developerMode', ({ code, enabled }, cb) => {
    const room=relayRooms.get(String(code||'').toUpperCase());
    if(!room||socket.data.relayName!==room.hostName||room.status!=='lobby') return cb?.({ok:false,error:'대기실 담당자만 변경할 수 있습니다.'});
    room.developerMode=!!enabled; relayBroadcast(room); cb?.({ok:true});
  });

  socket.on('relay:start', ({ code }) => {
    const room = relayRooms.get(code);
    if (!room || socket.data.relayName !== room.hostName) return;
    const active = PLAYERS.filter(name => room.players[name]);
    if (active.length < (room.developerMode ? 1 : 3)) {
      socket.emit('relay:error', room.developerMode ? '개발자 모드에서는 1명 이상이면 시작할 수 있습니다.' : '최소 3명이 입장해야 시작할 수 있습니다.');
      return;
    }
    room.status = 'sentence';
    room.roundPlayers = [...active];
    room.order = shuffle(active);
    room.sentences = {};
    room.drawings = {};
    room.guesses = {};
    room.submitted = [];
    room.result = null;
    relayBroadcast(room);
    relaySendTasks(room);
  });

  socket.on('relay:sentence', ({ code, text }, cb) => {
    const room = relayRooms.get(String(code || '').toUpperCase());
    const name = socket.data.relayName;
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!room || room.status !== 'sentence' || !room.roundPlayers.includes(name)) return cb?.({ ok:false, error:'지금은 문장 작성 단계가 아닙니다.' });
    if (!clean) return cb?.({ ok:false, error:'문장을 입력하세요.' });
    if (clean.length > 80) return cb?.({ ok:false, error:'80자 이내로 입력하세요.' });
    if (room.sentences[name]) return cb?.({ ok:false, error:'이미 제출했습니다.' });
    room.sentences[name] = clean;
    room.submitted.push(name);
    cb?.({ ok:true });
    relayBroadcast(room);
    relayMaybeAdvance(room);
  });

  socket.on('relay:drawing', ({ code, image }, cb) => {
    const room = relayRooms.get(String(code || '').toUpperCase());
    const name = socket.data.relayName;
    if (!room || room.status !== 'draw' || !room.roundPlayers.includes(name)) return cb?.({ ok:false, error:'지금은 그림 단계가 아닙니다.' });
    if (typeof image !== 'string' || !image.startsWith('data:image/')) return cb?.({ ok:false, error:'그림 데이터가 올바르지 않습니다.' });
    if (image.length > 1800000) return cb?.({ ok:false, error:'그림 데이터가 너무 큽니다.' });
    const task = relayTaskFor(room, name);
    if (!task?.starter) return cb?.({ ok:false, error:'그림 대상을 찾을 수 없습니다.' });
    room.drawings[task.starter] = { artist:name, data:image };
    if (!room.submitted.includes(name)) room.submitted.push(name);
    cb?.({ ok:true });
    relayBroadcast(room);
    relayMaybeAdvance(room);
  });

  socket.on('relay:guess', ({ code, text }, cb) => {
    const room = relayRooms.get(String(code || '').toUpperCase());
    const name = socket.data.relayName;
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!room || room.status !== 'guess' || !room.roundPlayers.includes(name)) return cb?.({ ok:false, error:'지금은 해석 단계가 아닙니다.' });
    if (!clean) return cb?.({ ok:false, error:'그림을 보고 문장을 입력하세요.' });
    if (clean.length > 80) return cb?.({ ok:false, error:'80자 이내로 입력하세요.' });
    const task = relayTaskFor(room, name);
    if (!task?.starter) return cb?.({ ok:false, error:'그림 대상을 찾을 수 없습니다.' });
    room.guesses[task.starter] = { guesser:name, text:clean };
    if (!room.submitted.includes(name)) room.submitted.push(name);
    cb?.({ ok:true });
    relayBroadcast(room);
    relayMaybeAdvance(room);
  });

  socket.on('relay:stop', ({ code }, cb) => {
    const room = relayRooms.get(String(code || '').toUpperCase());
    if (!room || socket.data.relayName !== room.hostName) return cb?.({ ok:false, error:'방장만 게임을 중단할 수 있습니다.' });
    room.status = 'lobby';
    room.roundPlayers = [];
    room.order = [];
    room.sentences = {};
    room.drawings = {};
    room.guesses = {};
    room.submitted = [];
    room.result = null;
    relayBroadcast(room);
    cb?.({ ok:true });
  });

  socket.on('relay:restart', ({ code }) => {
    const room = relayRooms.get(code);
    if (!room || socket.data.relayName !== room.hostName) return;
    room.status = 'lobby';
    room.roundPlayers = [];
    room.order = [];
    room.sentences = {};
    room.drawings = {};
    room.guesses = {};
    room.submitted = [];
    room.result = null;
    relayBroadcast(room);
  });

  socket.on('disconnect', () => {
    const { relayCode: code, relayName: name } = socket.data || {};
    const room = relayRooms.get(code);
    if (!room || !name) return;
    if (room.players[name] === socket.id) delete room.players[name];
    if (name === room.hostName) {
      const remaining = PLAYERS.filter(n => room.players[n]);
      if (remaining.length) room.hostName = remaining[0];
    }
    relayBroadcast(room);
    relayMaybeAdvance(room);
  });
});

function relayJoin(socket, room, name, cb) {
  const oldId = room.players[name];
  if (oldId && oldId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(oldId);
    if (oldSocket) oldSocket.disconnect(true);
  }
  room.players[name] = socket.id;
  socket.data.relayCode = room.code;
  socket.data.relayName = name;
  socket.join('relay:' + room.code);
  cb?.({ ok:true, code:room.code, hostName:room.hostName, name });
  relayBroadcast(room);
  if (room.status !== 'lobby' && room.roundPlayers.includes(name)) {
    socket.emit('relay:task', relayTaskFor(room, name));
  }
}


const crypto = require('crypto');
const telepathyRooms = new Map();
const TELEPATHY_BANK_LEGACY = {
  random:['야식 하면 떠오르는 음식','여름 하면 떠오르는 것','주말 하면 떠오르는 장소','빨간색 하면 떠오르는 것','비 오는 날 먹고 싶은 음식','여행 하면 떠오르는 나라','편의점 하면 떠오르는 음식','겨울 하면 떠오르는 음식','스트레스 받을 때 하고 싶은 것','카페 하면 떠오르는 메뉴','영화관 하면 떠오르는 간식','휴가 하면 떠오르는 것'],
  food:['야식 하면 떠오르는 음식','배달 음식 하면 떠오르는 메뉴','회식 하면 떠오르는 음식','편의점 하면 떠오르는 음식','겨울 하면 떠오르는 국물 음식','치킨 하면 떠오르는 브랜드','분식 하면 떠오르는 메뉴','카페 하면 떠오르는 메뉴','아침 하면 떠오르는 음식','술안주 하면 떠오르는 음식'],
  daily:['주말 하면 떠오르는 장소','아침에 가장 먼저 하는 것','잠 안 올 때 하는 것','휴가 하면 떠오르는 것','비 오는 날 하고 싶은 것','스트레스 받을 때 하고 싶은 것','집에 가면 가장 먼저 하는 것','택배 하면 떠오르는 것','퇴근 후 가장 하고 싶은 것'],
  company:['회사 하면 떠오르는 단어','퇴근하면 제일 먼저 하고 싶은 것','점심시간 하면 떠오르는 메뉴','회의 하면 떠오르는 단어','월요일 하면 떠오르는 것','야근 하면 떠오르는 음식','우리 팀에서 가장 많이 하는 말','사무실 간식 하면 떠오르는 것','출근하면 가장 먼저 하는 것','회사 근처 점심 하면 떠오르는 메뉴'],
  love:['데이트 하면 떠오르는 장소','연애 하면 떠오르는 계절','소개팅 하면 떠오르는 음식','고백 하면 떠오르는 장소','커플 하면 떠오르는 아이템','기념일 하면 떠오르는 선물'],
  balance:['평생 하나만 먹는다면 떠오르는 음식','무인도에 하나 가져간다면 떠오르는 물건','갑자기 100만원 생기면 가장 먼저 할 것','하루 쉬게 되면 가장 먼저 할 것']
};
function tpCode(){let c;do c=Math.random().toString(36).slice(2,6).toUpperCase();while(telepathyRooms.has(c));return c}
function tpNorm(v=''){return String(v).trim().toLowerCase().replace(/[\s!！?？.,，。~～·\-_]/g,'')}
function tpSettings(x={}){const count=Math.max(1,Math.min(10,Number(x.count)||5));const timer=[0,10,15,20].includes(Number(x.timer))?Number(x.timer):15;const category=['random','food','daily','company','love','balance','travel','taste','memory','content','imagination','custom'].includes(x.category)?x.category:'random';return{count,timer,category}}
function tpBuildDeck(category){
  const base=[...(category==='random'?TELEPATHY_ALL_QUESTIONS:(TELEPATHY_QUESTION_BANK[category]||TELEPATHY_ALL_QUESTIONS))];
  return shuffle(base);
}
function tpQuestions(room,s,custom=[]){
  if(s.category==='custom'){
    const q=custom.map(v=>String(v).trim()).filter(Boolean).slice(0,10);
    return (q.length?q:shuffle(TELEPATHY_ALL_QUESTIONS)).slice(0,s.count);
  }
  if(!room.questionDecks) room.questionDecks={};
  if(!room.recentQuestions) room.recentQuestions={};

  if(s.category==='random'){
    const recent=new Set(room.recentQuestions.random||[]);
    const categories=Object.keys(TELEPATHY_QUESTION_BANK);
    const picked=[];
    let guard=0;
    while(picked.length<s.count && guard<50){
      guard++;
      let added=0;
      for(const cat of shuffle(categories)){
        const pool=shuffle((TELEPATHY_QUESTION_BANK[cat]||[]).filter(q=>!recent.has(q)&&!picked.includes(q)));
        if(pool.length){
          picked.push(pool[0]);
          added++;
          if(picked.length>=s.count) break;
        }
      }
      if(!added){
        recent.clear();
      }
    }
    if(picked.length<s.count){
      for(const q of shuffle(TELEPATHY_ALL_QUESTIONS)){
        if(!picked.includes(q)) picked.push(q);
        if(picked.length>=s.count) break;
      }
    }
    room.recentQuestions.random=[...picked,...(room.recentQuestions.random||[])].filter((q,i,a)=>a.indexOf(q)===i).slice(0,200);
    return picked;
  }

  const key=s.category;
  let deck=room.questionDecks[key]||[];
  const recent=new Set(room.recentQuestions[key]||[]);
  if(deck.length<s.count){
    const existing=new Set(deck);
    for(const q of tpBuildDeck(key).filter(q=>!recent.has(q))){
      if(!existing.has(q)){deck.push(q);existing.add(q);}
    }
    if(deck.length<s.count){
      for(const q of tpBuildDeck(key)){
        if(!existing.has(q)){deck.push(q);existing.add(q);}
      }
    }
  }
  const picked=deck.splice(0,s.count);
  room.questionDecks[key]=deck;
  room.recentQuestions[key]=[...picked,...(room.recentQuestions[key]||[])].filter((q,i,a)=>a.indexOf(q)===i).slice(0,100);
  return picked;
}
function tpPublic(r){return{code:r.code,hostId:r.hostId,phase:r.phase,settings:r.settings,currentIndex:r.currentIndex,currentQuestion:r.questions[r.currentIndex]||null,totalQuestions:r.questions.length,players:r.players.map(p=>({id:p.id,name:p.name,score:p.score,connected:p.connected,submitted:!!r.answers[p.id],streak:p.streak})),roundResult:r.roundResult,history:r.history,final:r.final||null,developerMode:!!r.developerMode}}
function tpEmit(r){io.to('telepathy:'+r.code).emit('telepathy:update',tpPublic(r))}
function tpCalc(r){const active=r.players.filter(p=>r.answers[p.id]);const groups=new Map();for(const p of active){const a=r.answers[p.id].answer,k=tpNorm(a);if(!k)continue;if(!groups.has(k))groups.set(k,{display:a.trim(),playerIds:[]});groups.get(k).playerIds.push(p.id)}const matched=new Set();for(const g of groups.values())if(g.playerIds.length>=2)g.playerIds.forEach(id=>matched.add(id));r.players.forEach(p=>{if(matched.has(p.id)){p.score++;p.streak++}else if(r.answers[p.id])p.streak=0});const perfect=active.length>=2&&groups.size===1;if(perfect)r.perfectCount++;for(const g of groups.values())if(g.playerIds.length>=2)for(let i=0;i<g.playerIds.length;i++)for(let j=i+1;j<g.playerIds.length;j++){const k=[g.playerIds[i],g.playerIds[j]].sort().join('|');r.pairs[k]=(r.pairs[k]||0)+1}for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){const k=[active[i].id,active[j].id].sort().join('|');r.pairRounds[k]=(r.pairRounds[k]||0)+1}r.roundResult={groups:[...groups.values()].map(g=>({answer:g.display,playerIds:g.playerIds,matched:g.playerIds.length>=2})).sort((a,b)=>b.playerIds.length-a.playerIds.length),perfect,matchedIds:[...matched]};r.history.push({question:r.questions[r.currentIndex],...r.roundResult})}
function tpFinal(r){const ranking=[...r.players].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((p,i)=>({rank:i+1,id:p.id,name:p.name,score:p.score}));const compatibility=[];for(const [k,matches] of Object.entries(r.pairs)){const[a,b]=k.split('|'),total=r.pairRounds[k]||0,pa=r.players.find(p=>p.id===a),pb=r.players.find(p=>p.id===b);if(pa&&pb&&total)compatibility.push({a:{id:a,name:pa.name},b:{id:b,name:pb.name},matches,total,percent:Math.round(matches/total*100)})}compatibility.sort((a,b)=>b.percent-a.percent||b.matches-a.matches);return{ranking,compatibility,perfectCount:r.perfectCount}}
function tpReveal(r){if(r.phase!=='question')return;r.phase='reveal';tpCalc(r);tpEmit(r);io.to('telepathy:'+r.code).emit('telepathy:revealed',r.roundResult)}
io.on('connection',socket=>{
  socket.on('telepathy:create',({name},cb)=>{const code=tpCode(),playerId=crypto.randomUUID();const room={code,hostId:playerId,phase:'lobby',settings:{count:5,timer:15,category:'random'},questions:[],currentIndex:0,players:[{id:playerId,name:String(name||'방장').trim().slice(0,12),score:0,streak:0,connected:true,socketId:socket.id}],answers:{},roundResult:null,history:[],perfectCount:0,pairs:{},pairRounds:{},final:null,questionDecks:{},recentQuestions:{}};telepathyRooms.set(code,room);socket.join('telepathy:'+code);socket.data.telepathyCode=code;socket.data.telepathyPlayerId=playerId;cb?.({ok:true,code,playerId});tpEmit(room)});
  socket.on('telepathy:join',({code,name,playerId},cb)=>{const room=telepathyRooms.get(String(code||'').toUpperCase());if(!room)return cb?.({ok:false,error:'방을 찾을 수 없습니다.'});let p=playerId&&room.players.find(x=>x.id===playerId);if(p){p.connected=true;p.socketId=socket.id;if(name)p.name=String(name).trim().slice(0,12)}else{if(!['lobby','question'].includes(room.phase))return cb?.({ok:false,error:'현재 참가할 수 없는 단계입니다.'});p={id:crypto.randomUUID(),name:String(name||'플레이어').trim().slice(0,12),score:0,streak:0,connected:true,socketId:socket.id};room.players.push(p)}socket.join('telepathy:'+room.code);socket.data.telepathyCode=room.code;socket.data.telepathyPlayerId=p.id;cb?.({ok:true,code:room.code,playerId:p.id});tpEmit(room)});
  socket.on('telepathy:developerMode',({enabled},cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId||r.phase!=='lobby')return cb?.({ok:false,error:'대기실 방장만 변경할 수 있습니다.'});r.developerMode=!!enabled;tpEmit(r);cb?.({ok:true})});
  socket.on('telepathy:start',({settings,customQuestions=[]},cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId)return cb?.({ok:false,error:'방장만 시작할 수 있습니다.'});if(r.players.filter(p=>p.connected).length<(r.developerMode?1:2))return cb?.({ok:false,error:r.developerMode?'개발자 모드에서는 혼자 시작할 수 있습니다.':'최소 2명 이상 필요합니다.'});r.settings=tpSettings(settings);r.questions=tpQuestions(r,r.settings,customQuestions);r.currentIndex=0;r.phase='question';r.answers={};r.roundResult=null;r.history=[];r.perfectCount=0;r.pairs={};r.pairRounds={};r.final=null;r.players.forEach(p=>{p.score=0;p.streak=0});cb?.({ok:true});tpEmit(r);io.to('telepathy:'+r.code).emit('telepathy:round-start',{duration:r.settings.timer})});
  socket.on('telepathy:answer',({answer},cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode),pid=socket.data.telepathyPlayerId;if(!r||r.phase!=='question')return;if(!String(answer||'').trim())return cb?.({ok:false,error:'답을 입력해주세요.'});r.answers[pid]={answer:String(answer).trim().slice(0,30)};cb?.({ok:true});tpEmit(r);const active=r.players.filter(p=>p.connected);if(active.length>=(r.developerMode?1:2)&&active.every(p=>r.answers[p.id]))tpReveal(r)});
  socket.on('telepathy:reveal',(_,cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(r&&socket.data.telepathyPlayerId===r.hostId)tpReveal(r);cb?.({ok:true})});
  socket.on('telepathy:next',(_,cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId||r.phase!=='reveal')return;if(r.currentIndex>=r.questions.length-1){r.phase='finished';r.final=tpFinal(r);tpEmit(r);io.to('telepathy:'+r.code).emit('telepathy:finished',r.final);return cb?.({ok:true,finished:true})}r.currentIndex++;r.phase='question';r.answers={};r.roundResult=null;tpEmit(r);io.to('telepathy:'+r.code).emit('telepathy:round-start',{duration:r.settings.timer});cb?.({ok:true})});
  socket.on('telepathy:stop',(_,cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId)return cb?.({ok:false,error:'방장만 게임을 중단할 수 있습니다.'});r.phase='lobby';r.answers={};r.roundResult=null;r.currentIndex=0;r.final=null;r.questions=[];r.players.forEach(p=>{p.score=0;p.streak=0});tpEmit(r);cb?.({ok:true})});
  socket.on('telepathy:restart',(_,cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId)return;r.phase='lobby';r.answers={};r.roundResult=null;r.currentIndex=0;r.final=null;tpEmit(r);cb?.({ok:true})});
  socket.on('telepathy:kick',({playerId},cb)=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r||socket.data.telepathyPlayerId!==r.hostId)return;const p=r.players.find(x=>x.id===playerId);if(p&&p.id!==r.hostId){io.to(p.socketId).emit('telepathy:kicked');r.players=r.players.filter(x=>x.id!==playerId);tpEmit(r)}cb?.({ok:true})});
  socket.on('disconnect',()=>{const r=telepathyRooms.get(socket.data.telepathyCode);if(!r)return;const p=r.players.find(x=>x.id===socket.data.telepathyPlayerId);if(p&&p.socketId===socket.id){p.connected=false;p.socketId=null}if(r.hostId===socket.data.telepathyPlayerId){const n=r.players.find(x=>x.connected);if(n)r.hostId=n.id}tpEmit(r)})
});

function setupTruthGame(io){
  const crypto=require('crypto');
  const {questionBank,categories}=require('./truth-questions');
  const rooms=new Map();
  const uid=()=>crypto.randomUUID();
  const norm=(v='')=>String(v).trim().toLowerCase().replace(/[\s!！?？.,，。~～·_\-()（）'"\x60]/g,'');
  function code(){let c;do c=Math.random().toString(36).slice(2,6).toUpperCase();while(rooms.has(c));return c}
  function shuffleTruth(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
  function playerPublic(p,room){return{id:p.id,name:p.name,score:p.score,connected:p.connected,submitted:!!room.fakeAnswers[p.id],voted:!!room.votes[p.id],correctStreak:p.correctStreak,lieStreak:p.lieStreak}}
  function roomPublic(room){const item=room.questions[room.index];return{code:room.code,hostId:room.hostId,phase:room.phase,settings:room.settings,index:room.index,total:room.questions.length,currentQuestion:item?.q||null,players:room.players.map(p=>playerPublic(p,room)),options:room.phase==='vote'?room.options.map(o=>({id:o.id,text:o.text})):[],result:room.phase==='result'?room.result:null,final:room.phase==='finished'?room.final:null}}
  function emitRoom(room){io.to('truth:'+room.code).emit('truth:room:update',roomPublic(room))}
  function sanitize(s={}){return{count:Math.max(1,Math.min(10,+s.count||5)),fakeTimer:[0,20,30,45].includes(+s.fakeTimer)?+s.fakeTimer:30,voteTimer:[0,10,15,20].includes(+s.voteTimer)?+s.voteTimer:15,category:categories[s.category]?s.category:'random'}}
  function buildQuestions(settings){const base=settings.category==='random'?questionBank:questionBank.filter(x=>x.c===settings.category);return shuffleTruth(base).slice(0,Math.min(settings.count,base.length))}
  function active(room){return room.players.filter(p=>p.connected)}
  function clearPhaseTimer(room){if(room.timer){clearTimeout(room.timer);room.timer=null}}
  function phaseTimer(room,seconds,fn){clearPhaseTimer(room);if(seconds>0)room.timer=setTimeout(()=>{const x=rooms.get(room.code);if(x)fn(x)},seconds*1000+500)}
  function startFake(room){room.phase='fake';room.fakeAnswers={};room.votes={};room.options=[];room.result=null;emitRoom(room);io.to('truth:'+room.code).emit('truth:phase:start',{phase:'fake',duration:room.settings.fakeTimer});phaseTimer(room,room.settings.fakeTimer,startVote)}
  function startVote(room){if(room.phase!=='fake')return;clearPhaseTimer(room);const q=room.questions[room.index];const fakes=Object.entries(room.fakeAnswers).map(([authorId,v])=>({id:uid(),text:v.text,authorId,isTruth:false}));room.options=shuffleTruth([{id:uid(),text:q.a,authorId:null,isTruth:true},...fakes]);room.phase='vote';room.votes={};emitRoom(room);io.to('truth:'+room.code).emit('truth:phase:start',{phase:'vote',duration:room.settings.voteTimer});phaseTimer(room,room.settings.voteTimer,reveal)}
  function reveal(room){if(room.phase!=='vote')return;clearPhaseTimer(room);const q=room.questions[room.index];const voteCount={};for(const oid of Object.values(room.votes))voteCount[oid]=(voteCount[oid]||0)+1;const scoreEvents=[];let correctCount=0;
    for(const p of room.players){const oid=room.votes[p.id];if(!oid)continue;const o=room.options.find(x=>x.id===oid);if(!o)continue;if(o.isTruth){p.score+=2;p.correctTotal++;p.correctStreak++;correctCount++;scoreEvents.push({playerId:p.id,points:2,type:'correct'})}else{p.correctStreak=0;p.fooledTimes++;const owner=room.players.find(x=>x.id===o.authorId);if(owner&&owner.id!==p.id){owner.score+=1;owner.fooledTotal++;owner.lieStreak++;scoreEvents.push({playerId:owner.id,points:1,type:'fooled',victimId:p.id})}}}
    const authorsWhoFooled=new Set(scoreEvents.filter(e=>e.type==='fooled').map(e=>e.playerId));room.players.forEach(p=>{if(!authorsWhoFooled.has(p.id))p.lieStreak=0});
    const optionResults=room.options.map(o=>({id:o.id,text:o.text,isTruth:o.isTruth,authorId:o.authorId,authorName:o.authorId?room.players.find(p=>p.id===o.authorId)?.name||'':null,voters:room.players.filter(p=>room.votes[p.id]===o.id).map(p=>({id:p.id,name:p.name})),votes:voteCount[o.id]||0})).sort((a,b)=>b.votes-a.votes);
    const fakeSorted=optionResults.filter(o=>!o.isTruth).sort((a,b)=>b.votes-a.votes),bestFake=fakeSorted[0]?.votes>0?fakeSorted[0]:null;
    room.result={question:q.q,answer:q.a,options:optionResults,scoreEvents,correctCount,allFooled:active(room).length>0&&correctCount===0,allCorrect:active(room).length>0&&correctCount===active(room).filter(p=>room.votes[p.id]).length&&active(room).every(p=>room.votes[p.id]),bestFake};room.phase='result';room.history.push(room.result);emitRoom(room);io.to('truth:'+room.code).emit('truth:round:revealed')
  }
  function finish(room){const ranking=[...room.players].sort((a,b)=>b.score-a.score||b.fooledTotal-a.fooledTotal).map((p,i)=>({rank:i+1,id:p.id,name:p.name,score:p.score,correctTotal:p.correctTotal,fooledTotal:p.fooledTotal,fooledTimes:p.fooledTimes}));const byCorrect=[...room.players].sort((a,b)=>b.correctTotal-a.correctTotal)[0],byLie=[...room.players].sort((a,b)=>b.fooledTotal-a.fooledTotal)[0],byCaught=[...room.players].sort((a,b)=>b.fooledTimes-a.fooledTimes)[0];let best=null;for(const h of room.history){const f=h.bestFake;if(f&&(!best||f.votes>best.votes))best={text:f.text,votes:f.votes,authorName:f.authorName}}room.final={ranking,awards:{brain:byCorrect?{name:byCorrect.name,value:byCorrect.correctTotal}:null,liar:byLie?{name:byLie.name,value:byLie.fooledTotal}:null,fish:byCaught?{name:byCaught.name,value:byCaught.fooledTimes}:null,bestFake:best}};room.phase='finished';emitRoom(room);io.to('truth:'+room.code).emit('truth:game:finished',room.final)}
  io.on('connection',socket=>{
    socket.on('truth:room:create',({name},cb)=>{const room={code:code(),hostId:null,phase:'lobby',settings:{count:5,fakeTimer:30,voteTimer:15,category:'random'},questions:[],index:0,players:[],fakeAnswers:{},votes:{},options:[],result:null,history:[],final:null,timer:null};const p={id:uid(),name:String(name||'방장').trim().slice(0,12),score:0,connected:true,socketId:socket.id,correctTotal:0,fooledTotal:0,fooledTimes:0,correctStreak:0,lieStreak:0};room.hostId=p.id;room.players.push(p);rooms.set(room.code,room);socket.join('truth:'+room.code);socket.data.truthCode=room.code;socket.data.truthPlayerId=p.id;cb?.({ok:true,code:room.code,playerId:p.id});emitRoom(room)});
    socket.on('truth:room:join',({code:raw,name,playerId},cb)=>{const room=rooms.get(String(raw||'').toUpperCase());if(!room)return cb?.({ok:false,error:'방을 찾을 수 없습니다.'});let p=playerId&&room.players.find(x=>x.id===playerId);if(p){p.connected=true;p.socketId=socket.id;if(name)p.name=String(name).trim().slice(0,12)}else{if(room.phase!=='lobby')return cb?.({ok:false,error:'게임 시작 후에는 새로 참가할 수 없습니다.'});p={id:uid(),name:String(name||'플레이어').trim().slice(0,12),score:0,connected:true,socketId:socket.id,correctTotal:0,fooledTotal:0,fooledTimes:0,correctStreak:0,lieStreak:0};room.players.push(p)}socket.join('truth:'+room.code);socket.data.truthCode=room.code;socket.data.truthPlayerId=p.id;cb?.({ok:true,code:room.code,playerId:p.id});emitRoom(room)});
    socket.on('truth:game:start',({settings},cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId)return cb?.({ok:false,error:'방장만 시작할 수 있습니다.'});if(active(room).length<3)return cb?.({ok:false,error:'최소 3명 이상 필요합니다.'});room.settings=sanitize(settings);room.questions=buildQuestions(room.settings);room.index=0;room.history=[];room.final=null;room.players.forEach(p=>Object.assign(p,{score:0,correctTotal:0,fooledTotal:0,fooledTimes:0,correctStreak:0,lieStreak:0}));startFake(room);cb?.({ok:true})});
    socket.on('truth:fake:submit',({text},cb)=>{const room=rooms.get(socket.data?.truthCode),pid=socket.data?.truthPlayerId;if(!room||room.phase!=='fake')return cb?.({ok:false,error:'가짜 답 작성 시간이 아닙니다.'});const v=String(text||'').trim().slice(0,30);if(v.length<2)return cb?.({ok:false,error:'가짜 답은 2자 이상 입력해주세요.'});const q=room.questions[room.index];if(norm(v)===norm(q.a))return cb?.({ok:false,error:'진짜 정답과 같은 답은 사용할 수 없습니다.'});if(Object.entries(room.fakeAnswers).some(([id,x])=>id!==pid&&norm(x.text)===norm(v)))return cb?.({ok:false,error:'다른 참가자가 이미 같은 답을 냈습니다. 다른 답을 써주세요.'});room.fakeAnswers[pid]={text:v};cb?.({ok:true});emitRoom(room);if(active(room).length>=3&&active(room).every(p=>room.fakeAnswers[p.id]))startVote(room)});
    socket.on('truth:vote:submit',({optionId},cb)=>{const room=rooms.get(socket.data?.truthCode),pid=socket.data?.truthPlayerId;if(!room||room.phase!=='vote')return cb?.({ok:false,error:'투표 시간이 아닙니다.'});const o=room.options.find(x=>x.id===optionId);if(!o)return cb?.({ok:false,error:'선택지를 찾을 수 없습니다.'});if(o.authorId===pid)return cb?.({ok:false,error:'내가 만든 가짜 답에는 투표할 수 없습니다.'});room.votes[pid]=optionId;cb?.({ok:true});emitRoom(room);if(active(room).length>=3&&active(room).every(p=>room.votes[p.id]))reveal(room)});
    socket.on('truth:phase:force',(_,cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId)return;if(room.phase==='fake')startVote(room);else if(room.phase==='vote')reveal(room);cb?.({ok:true})});
    socket.on('truth:round:next',(_,cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId||room.phase!=='result')return;if(room.index>=room.questions.length-1){finish(room);return cb?.({ok:true,finished:true})}room.index++;startFake(room);cb?.({ok:true})});
    socket.on('truth:game:stop',(_,cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId)return cb?.({ok:false,error:'방장만 게임을 중단할 수 있습니다.'});clearPhaseTimer(room);room.phase='lobby';room.index=0;room.questions=[];room.fakeAnswers={};room.votes={};room.options=[];room.result=null;room.final=null;room.history=[];room.players.forEach(p=>Object.assign(p,{score:0,correctTotal:0,fooledTotal:0,fooledTimes:0,correctStreak:0,lieStreak:0}));emitRoom(room);cb?.({ok:true})});
    socket.on('truth:game:restart',(_,cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId)return;clearPhaseTimer(room);room.phase='lobby';room.index=0;room.questions=[];room.fakeAnswers={};room.votes={};room.options=[];room.result=null;room.final=null;emitRoom(room);cb?.({ok:true})});
    socket.on('truth:room:kick',({playerId},cb)=>{const room=rooms.get(socket.data?.truthCode);if(!room||room.hostId!==socket.data.truthPlayerId)return;const p=room.players.find(x=>x.id===playerId);if(p&&p.id!==room.hostId){io.to(p.socketId).emit('truth:room:kicked');room.players=room.players.filter(x=>x.id!==playerId);delete room.fakeAnswers[playerId];delete room.votes[playerId];emitRoom(room)}cb?.({ok:true})});
    socket.on('disconnect',()=>{const room=rooms.get(socket.data?.truthCode);if(!room)return;const p=room.players.find(x=>x.id===socket.data.truthPlayerId);if(p){p.connected=false;p.socketId=null}if(room.hostId===socket.data.truthPlayerId){const next=room.players.find(x=>x.connected);if(next)room.hostId=next.id}emitRoom(room);if(!room.players.some(x=>x.connected)){clearPhaseTimer(room);setTimeout(()=>{const x=rooms.get(room.code);if(x&&!x.players.some(p=>p.connected))rooms.delete(room.code)},30*60*1000)}})
  });
}
setupTruthGame(io);

server.listen(PORT, () => console.log(`Weekly Coordination Sheet running on http://localhost:${PORT}`));
