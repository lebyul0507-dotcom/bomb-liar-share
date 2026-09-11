const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYERS = ["지니", "윤정", "수히", "아름", "정하"];
const ROUND_COUNTS = { 3: 2, 5: 3, 7: 4 };
const MAX_MESSAGE_LENGTH = 120;

const WORD_PAIRS = [
  ["커피", "녹차"], ["떡볶이", "라볶이"], ["삼겹살", "목살"], ["초밥", "김밥"],
  ["치킨", "피자"], ["냉면", "막국수"], ["붕어빵", "호떡"], ["라면", "우동"],
  ["아이스크림", "빙수"], ["햄버거", "샌드위치"], ["김치찌개", "된장찌개"], ["파스타", "리조또"],
  ["족발", "보쌈"], ["마라탕", "훠궈"], ["카레", "짜장"], ["놀이공원", "워터파크"],
  ["편의점", "마트"], ["찜질방", "사우나"], ["피부과", "성형외과"], ["영화관", "공연장"],
  ["공항", "기차역"], ["헬스장", "필라테스"], ["PC방", "노래방"], ["카페", "베이커리"],
  ["도서관", "서점"], ["미용실", "네일샵"], ["백화점", "아울렛"], ["학교", "학원"],
  ["병원", "약국"], ["한강", "공원"], ["지하철", "버스"], ["호텔", "펜션"],
  ["에어팟", "헤드셋"], ["우산", "우비"], ["칫솔", "치실"], ["리모컨", "마우스"],
  ["고데기", "드라이기"], ["보조배터리", "충전기"], ["노트북", "태블릿"], ["키보드", "마우스"],
  ["텀블러", "물병"], ["향수", "디퓨저"], ["거울", "카메라"], ["지갑", "카드지갑"],
  ["볼펜", "샤프"], ["가위", "커터칼"], ["스테이플러", "클립"], ["안경", "렌즈"],
  ["의사", "간호사"], ["선생님", "강사"], ["경찰", "소방관"], ["승무원", "호텔리어"],
  ["유튜버", "스트리머"], ["아이돌", "배우"], ["요리사", "바리스타"], ["변호사", "검사"],
  ["디자이너", "마케터"], ["개발자", "기획자"], ["사진작가", "영상작가"], ["기자", "작가"],
  ["회식", "워크숍"], ["야근", "주말근무"], ["퇴근", "점심시간"], ["월급날", "보너스"],
  ["회의", "발표"], ["연차", "반차"], ["출장", "여행"], ["보고서", "기획서"],
  ["메신저", "이메일"], ["복사기", "프린터"], ["회의실", "휴게실"], ["사원증", "명함"],
  ["엘리베이터", "에스컬레이터"], ["탕비실", "구내식당"], ["출근", "등교"], ["지각", "결근"],
  ["넷플릭스", "유튜브"], ["인스타그램", "틱톡"], ["카카오톡", "문자"], ["배달앱", "쇼핑앱"],
  ["택시", "버스"], ["사진", "영상"], ["셀카", "증명사진"], ["캠핑", "글램핑"],
  ["등산", "러닝"], ["수영", "서핑"], ["볼링", "당구"], ["축구", "농구"],
  ["야구", "축구"], ["게임", "보드게임"], ["쇼핑", "장보기"], ["데이트", "소개팅"]
];

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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

function connectedNames(room) {
  return PLAYERS.filter(name => !!room.players[name]);
}

function pickWordPair() {
  const selected = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
  return Math.random() < 0.5
    ? { commonWord: selected[0], liarWord: selected[1] }
    : { commonWord: selected[1], liarWord: selected[0] };
}

function assignedKeyword(room, name) {
  return name === room.liar ? room.liarWord : room.commonWord;
}

function getTurnState(room, now = Date.now()) {
  if (room.status !== "playing" || !room.startedAt || !room.turnSeconds) {
    return { phase: "idle", currentSpeaker: null, turnIndex: -1, turnRemaining: 0, cycle: 0, cyclePosition: 0 };
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - room.startedAt) / 1000));
  const turnIndex = Math.floor(elapsedSeconds / room.turnSeconds);
  const playerCount = Math.max(1, room.baseOrder.length);
  if (turnIndex < room.turnOrder.length) {
    return {
      phase: "turns",
      currentSpeaker: room.turnOrder[turnIndex],
      turnIndex,
      turnRemaining: room.turnSeconds - (elapsedSeconds % room.turnSeconds),
      cycle: Math.floor(turnIndex / playerCount) + 1,
      cyclePosition: (turnIndex % playerCount) + 1
    };
  }
  return { phase: "final", currentSpeaker: null, turnIndex: room.turnOrder.length, turnRemaining: 0, cycle: room.roundCount, cyclePosition: playerCount };
}

function roomSnapshot(room) {
  const turnState = getTurnState(room);
  return {
    code: room.code,
    hostName: room.hostName,
    players: PLAYERS.map(name => ({ name, connected: !!room.players[name], voted: !!room.votes[name] })),
    status: room.status,
    round: room.round,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    durationMinutes: room.durationMinutes,
    roundCount: room.roundCount,
    turnSeconds: room.turnSeconds,
    roundPlayers: room.roundPlayers || [],
    baseOrder: room.baseOrder || [],
    turnOrder: room.turnOrder || [],
    messages: room.messages || [],
    currentSpeaker: turnState.currentSpeaker,
    phase: turnState.phase,
    cycle: turnState.cycle,
    cyclePosition: turnState.cyclePosition,
    serverNow: Date.now(),
    results: room.results || null
  };
}

function broadcastRoom(room) { io.to(room.code).emit("room:update", roomSnapshot(room)); }

function finishRound(room) {
  if (room.status !== "playing" && room.status !== "voting") return;
  const targets = room.roundPlayers || [];
  const counts = {};
  targets.forEach(name => { counts[name] = 0; });
  Object.values(room.votes).forEach(target => { if (Object.prototype.hasOwnProperty.call(counts, target)) counts[target] += 1; });
  const max = targets.length ? Math.max(...Object.values(counts)) : 0;
  const top = targets.filter(name => counts[name] === max);
  room.status = "result";
  room.results = { liar: room.liar, commonWord: room.commonWord, liarWord: room.liarWord, counts, top, caught: top.length === 1 && top[0] === room.liar };
  room.endsAt = null;
  broadcastRoom(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === "playing" && room.endsAt && now >= room.endsAt) {
      room.status = "voting";
      room.endsAt = null;
      broadcastRoom(room);
      io.to(room.code).emit("timer:ended");
    }
  }
}, 500);

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", socket => {
  socket.on("room:create", ({ name }, cb) => {
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: "등록된 참가자 이름이 아닙니다." });
    const code = makeRoomCode();
    const room = {
      code, hostName: name, players: {}, status: "lobby", round: 0,
      commonWord: null, liarWord: null, liar: null, startedAt: null, endsAt: null,
      durationMinutes: 5, roundCount: 3, turnSeconds: 20,
      roundPlayers: [], baseOrder: [], turnOrder: [], messages: [], messageSeq: 0, votes: {}, results: null
    };
    rooms.set(code, room);
    joinRoom(socket, room, name, cb);
  });

  socket.on("room:join", ({ code, name }, cb) => {
    code = String(code || "").trim().toUpperCase();
    if (!PLAYERS.includes(name)) return cb?.({ ok: false, error: "등록된 참가자 이름이 아닙니다." });
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "방을 찾을 수 없습니다." });
    joinRoom(socket, room, name, cb);
  });

  socket.on("game:start", ({ code, durationMinutes }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName) return;
    const active = connectedNames(room);
    if (active.length < 3) return socket.emit("error:message", "최소 3명이 입장해야 시작할 수 있습니다.");

    const requested = Number(durationMinutes);
    const duration = ROUND_COUNTS[requested] ? requested : 5;
    const roundCount = ROUND_COUNTS[duration];
    const words = pickWordPair();
    const baseOrder = shuffle(active);
    const turnOrder = Array.from({ length: roundCount }, () => baseOrder).flat();
    const turnSeconds = Math.max(5, Math.floor((duration * 60) / turnOrder.length));

    room.durationMinutes = duration;
    room.roundCount = roundCount;
    room.turnSeconds = turnSeconds;
    room.roundPlayers = [...active];
    room.baseOrder = baseOrder;
    room.turnOrder = turnOrder;
    room.round += 1;
    room.commonWord = words.commonWord;
    room.liarWord = words.liarWord;
    room.liar = active[Math.floor(Math.random() * active.length)];
    room.messages = [];
    room.messageSeq = 0;
    room.votes = {};
    room.results = null;
    room.status = "playing";
    room.startedAt = Date.now();
    room.endsAt = room.startedAt + duration * 60 * 1000;

    active.forEach(name => {
      const s = io.sockets.sockets.get(room.players[name]);
      if (s) s.emit("keyword:reveal", { round: room.round, keyword: assignedKeyword(room, name) });
    });
    broadcastRoom(room);
  });

  socket.on("message:send", ({ code, text }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const name = socket.data.name;
    if (!room || room.status !== "playing") return cb?.({ ok: false, error: "현재 작성 가능한 세션이 아닙니다." });
    if (!room.roundPlayers.includes(name)) return cb?.({ ok: false, error: "이번 세션 참가자가 아닙니다." });

    const clean = String(text || "").trim().replace(/\s+/g, " ");
    if (!clean) return cb?.({ ok: false, error: "설명을 입력하세요." });
    if (clean.length > MAX_MESSAGE_LENGTH) return cb?.({ ok: false, error: `${MAX_MESSAGE_LENGTH}자 이내로 입력하세요.` });

    const turnState = getTurnState(room);
    if (turnState.phase !== "turns") return cb?.({ ok: false, error: "설명 회전이 종료되었습니다. 투표를 준비해주세요." });
    if (turnState.currentSpeaker !== name) return cb?.({ ok: false, error: `지금은 ${turnState.currentSpeaker} 님의 작성 차례입니다.` });
    if (room.messages.some(m => m.turnIndex === turnState.turnIndex)) return cb?.({ ok: false, error: "이번 차례의 설명은 이미 등록했습니다." });

    const keyword = assignedKeyword(room, name);
    if (keyword && clean.replace(/\s/g, "").includes(keyword.replace(/\s/g, ""))) return cb?.({ ok: false, error: "자기 키워드 자체는 설명란에 입력할 수 없습니다." });

    room.messageSeq += 1;
    room.messages.push({ id: room.messageSeq, name, text: clean, at: Date.now(), turnIndex: turnState.turnIndex, cycle: turnState.cycle });
    cb?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on("game:voteNow", ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName || room.status !== "playing") return;
    room.status = "voting"; room.endsAt = null; broadcastRoom(room);
  });

  socket.on("vote:submit", ({ code, target }, cb) => {
    const room = rooms.get(code); const voter = socket.data.name;
    if (!room || room.status !== "voting") return cb?.({ ok: false, error: "지금은 투표 시간이 아닙니다." });
    if (!room.roundPlayers.includes(voter) || !room.roundPlayers.includes(target)) return cb?.({ ok: false, error: "이번 세션 참가자에게만 투표할 수 있습니다." });
    if (room.votes[voter]) return cb?.({ ok: false, error: "이미 투표했습니다." });
    room.votes[voter] = target;
    cb?.({ ok: true });
    broadcastRoom(room);
    const eligible = room.roundPlayers.filter(name => !!room.players[name]);
    if (eligible.filter(name => !!room.votes[name]).length >= eligible.length && eligible.length) finishRound(room);
  });

  socket.on("game:revealVotes", ({ code }) => {
    const room = rooms.get(code);
    if (room && socket.data.name === room.hostName && room.status === "voting") finishRound(room);
  });

  socket.on("disconnect", () => {
    const { roomCode, name } = socket.data || {};
    if (!roomCode || !name) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players[name] === socket.id) delete room.players[name];
    if (name === room.hostName) {
      const remaining = connectedNames(room);
      if (remaining.length) room.hostName = remaining[0];
    }
    broadcastRoom(room);
  });
});

function joinRoom(socket, room, name, cb) {
  const oldId = room.players[name];
  if (oldId && oldId !== socket.id) {
    const old = io.sockets.sockets.get(oldId);
    if (old) { old.emit("session:replaced"); old.disconnect(true); }
  }
  room.players[name] = socket.id;
  socket.data.roomCode = room.code;
  socket.data.name = name;
  socket.join(room.code);
  cb?.({ ok: true, code: room.code, hostName: room.hostName, name });
  broadcastRoom(room);
  if (room.status === "playing" && room.roundPlayers.includes(name)) socket.emit("keyword:reveal", { round: room.round, keyword: assignedKeyword(room, name) });
}

server.listen(PORT, () => console.log(`Weekly Coordination Sheet running on http://localhost:${PORT}`));
