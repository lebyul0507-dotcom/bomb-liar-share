const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PLAYERS = ["지니", "윤정", "수히", "아름", "정하"];
const ALLOWED_DURATIONS = [3, 5, 7];
const TURN_SECONDS = 30;
const WORDS = [
  "마라탕","김밥","떡볶이","삼겹살","초밥","치킨","피자","냉면","붕어빵","라면",
  "아이스크림","커피","샌드위치","햄버거","김치찌개","된장찌개","파스타","족발","회","카레",
  "놀이공원","편의점","찜질방","피부과","영화관","공항","헬스장","PC방","카페","노래방",
  "도서관","미용실","백화점","회사","학교","병원","한강","지하철","버스정류장","호텔",
  "에어팟","우산","칫솔","리모컨","고데기","보조배터리","노트북","키보드","마우스","텀블러",
  "향수","거울","지갑","볼펜","가위","스테이플러","헤드셋","충전기","안경","쿠션",
  "의사","선생님","경찰","승무원","유튜버","아이돌","배우","요리사","변호사","디자이너",
  "개발자","간호사","사진작가","택배기사","운동선수","기자","작가","미용사","바리스타","마케터",
  "회식","야근","퇴근","월급날","점심시간","회의","연차","출장","보고서","메신저",
  "복사기","회의실","사원증","엘리베이터","탕비실","출근","지각","휴가","인수인계","워크숍",
  "넷플릭스","유튜브","인스타그램","카카오톡","배달앱","택시","사진","셀카","여행","데이트",
  "캠핑","등산","수영","러닝","볼링","축구","야구","농구","게임","쇼핑"
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

function roomSnapshot(room) {
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
    turnSeconds: TURN_SECONDS,
    roundPlayers: room.roundPlayers || [],
    turnOrder: room.turnOrder || [],
    results: room.results || null
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", roomSnapshot(room));
}

function finishRound(room) {
  if (room.status !== "playing" && room.status !== "voting") return;
  const targets = room.roundPlayers || [];
  const counts = {};
  targets.forEach(name => { counts[name] = 0; });
  Object.values(room.votes).forEach(target => {
    if (Object.prototype.hasOwnProperty.call(counts, target)) counts[target] += 1;
  });
  const max = targets.length ? Math.max(...Object.values(counts)) : 0;
  const top = targets.filter(name => counts[name] === max);
  room.status = "result";
  room.results = {
    liar: room.liar,
    word: room.word,
    counts,
    top,
    caught: top.length === 1 && top[0] === room.liar
  };
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
      code,
      hostName: name,
      players: {},
      status: "lobby",
      round: 0,
      word: null,
      liar: null,
      startedAt: null,
      endsAt: null,
      durationMinutes: 5,
      roundPlayers: [],
      turnOrder: [],
      votes: {},
      results: null
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
    if (active.length < 3) {
      socket.emit("error:message", "최소 3명이 입장해야 시작할 수 있습니다.");
      return;
    }

    const requested = Number(durationMinutes);
    room.durationMinutes = ALLOWED_DURATIONS.includes(requested) ? requested : 5;
    room.roundPlayers = [...active];
    room.turnOrder = shuffle(active);
    room.round += 1;
    room.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    room.liar = active[Math.floor(Math.random() * active.length)];
    room.votes = {};
    room.results = null;
    room.status = "playing";
    room.startedAt = Date.now();
    room.endsAt = room.startedAt + room.durationMinutes * 60 * 1000;

    active.forEach(name => {
      const sid = room.players[name];
      const s = io.sockets.sockets.get(sid);
      if (!s) return;
      s.emit("role:reveal", {
        round: room.round,
        isLiar: name === room.liar,
        word: name === room.liar ? null : room.word
      });
    });

    broadcastRoom(room);
  });

  socket.on("game:voteNow", ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName || room.status !== "playing") return;
    room.status = "voting";
    room.endsAt = null;
    broadcastRoom(room);
  });

  socket.on("vote:submit", ({ code, target }, cb) => {
    const room = rooms.get(code);
    const voter = socket.data.name;
    if (!room || room.status !== "voting") return cb?.({ ok: false, error: "지금은 투표 시간이 아닙니다." });
    if (!room.roundPlayers.includes(voter) || !room.roundPlayers.includes(target)) {
      return cb?.({ ok: false, error: "이번 세션 참가자에게만 투표할 수 있습니다." });
    }
    if (room.votes[voter]) return cb?.({ ok: false, error: "이미 투표했습니다." });

    room.votes[voter] = target;
    cb?.({ ok: true });
    broadcastRoom(room);

    const eligibleVoters = room.roundPlayers.filter(name => !!room.players[name]);
    const completed = eligibleVoters.filter(name => !!room.votes[name]).length;
    if (completed >= eligibleVoters.length && eligibleVoters.length > 0) finishRound(room);
  });

  socket.on("game:revealVotes", ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.data.name !== room.hostName) return;
    if (room.status === "voting") finishRound(room);
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
    if (old) {
      old.emit("session:replaced");
      old.disconnect(true);
    }
  }

  room.players[name] = socket.id;
  socket.data.roomCode = room.code;
  socket.data.name = name;
  socket.join(room.code);
  cb?.({ ok: true, code: room.code, hostName: room.hostName, name });
  broadcastRoom(room);

  if (room.status === "playing" && room.roundPlayers.includes(name)) {
    socket.emit("role:reveal", {
      round: room.round,
      isLiar: name === room.liar,
      word: name === room.liar ? null : room.word
    });
  }
}

server.listen(PORT, () => console.log(`Team Sync Sheet running on http://localhost:${PORT}`));
