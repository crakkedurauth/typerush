const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const queue = [];
const WORDS = `the of and a to in is you that it he was for on are as with his they I at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over quick brown fox jumps lazy dog typing battle speed focus race keyboard computer screen world light dark green blue red home open close new old small large good great right left high low fast slow every again because before after while where why work play learn win challenge practice player room public private`.split(/\s+/);

function makeText(settings) {
  const count = settings.mode === "words" ? settings.words : Math.max(80, Math.ceil(settings.time * 4.5));
  const out = [];
  for (let i = 0; i < count; i++) {
    let w = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (settings.numbers && Math.random() < .16) w = String(Math.floor(Math.random() * 900) + 100);
    if (settings.capitalization && Math.random() < .24) w = w[0].toUpperCase() + w.slice(1);
    if (settings.punctuation && Math.random() < .18) w += [",",".","!","?",";"][Math.floor(Math.random()*5)];
    out.push(w);
  }
  return out.join(" ");
}
function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function publicRooms() {
  return [...rooms.values()].filter(r => r.visibility === "public" && r.players.length < 2).map(r => ({
    code:r.code, name:r.name, players:r.players.length, settings:r.settings
  }));
}
function emitRooms(){ io.emit("rooms:update", publicRooms()); }

io.on("connection", socket => {
  socket.emit("rooms:update", publicRooms());
  socket.emit("online", io.engine.clientsCount);

  socket.on("setName", name => {
    socket.data.name = String(name || "Racer").slice(0,18);
    socket.emit("online", io.engine.clientsCount);
  });

  socket.on("quickMatch", settings => {
    const s = normalize(settings);
    const idx = queue.findIndex(x => sameSettings(x.settings, s));
    if (idx >= 0) {
      const other = queue.splice(idx,1)[0];
      const room = createRoom(other.socket.data.name || "Racer", s, false);
      room.players.push({id:socket.id,name:socket.data.name || "Racer"});
      room.host = other.socket.id;
      other.socket.join(room.code); socket.join(room.code);
      startRoom(room);
    } else queue.push({socket,settings:s});
  });

  socket.on("createRoom", ({settings, visibility, name}) => {
    const s = normalize(settings);
    const room = createRoom(name || socket.data.name || "Racer", s, visibility === "private");
    room.players.push({id:socket.id,name:socket.data.name || name || "Racer"});
    room.host = socket.id; socket.join(room.code);
    socket.emit("room:created", serializeRoom(room));
    emitRooms();
  });

  socket.on("joinRoom", code => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.players.length >= 2) return socket.emit("error:msg","That room is unavailable.");
    room.players.push({id:socket.id,name:socket.data.name || "Racer"});
    socket.join(room.code);
    io.to(room.code).emit("room:update", serializeRoom(room));
    if (room.players.length === 2) startRoom(room);
    emitRooms();
  });

  socket.on("startRoom", () => {
    const room = [...rooms.values()].find(r => r.host === socket.id);
    if (room && room.players.length === 2) startRoom(room);
  });

  socket.on("race:progress", ({index, typed, elapsed}) => {
    const room = [...rooms.values()].find(r => r.players.some(p=>p.id===socket.id));
    if (!room || room.state !== "racing") return;
    const p = room.players.find(p=>p.id===socket.id);
    p.index = index; p.typed = typed; p.elapsed = elapsed;
    socket.to(room.code).emit("race:opponent", {index, elapsed});
    const total = room.words.length;
    if (index >= total) finish(room, socket.id);
  });

  socket.on("disconnect", () => {
    for (let i=queue.length-1;i>=0;i--) if(queue[i].socket.id===socket.id) queue.splice(i,1);
    for (const [code,room] of rooms) {
      if (room.players.some(p=>p.id===socket.id)) {
        io.to(code).emit("error:msg","A player left the room.");
        rooms.delete(code); io.in(code).socketsLeave(code);
      }
    }
    emitRooms(); io.emit("online", io.engine.clientsCount);
  });
});

function normalize(s={}) {
  return {
    mode:s.mode==="time"?"time":"words",
    words:Math.min(100,Math.max(10,Number(s.words)||30)),
    time:Math.min(180,Math.max(15,Number(s.time)||60)),
    punctuation:!!s.punctuation, capitalization:!!s.capitalization, numbers:!!s.numbers
  };
}
function sameSettings(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
function createRoom(name, settings, privateRoom) {
  const r={code:code(),name:`${name}'s room`,visibility:privateRoom?"private":"public",settings,players:[],host:null,state:"lobby",words:[]};
  rooms.set(r.code,r); return r;
}
function serializeRoom(r){return {code:r.code,name:r.name,visibility:r.visibility,settings:r.settings,players:r.players.map(p=>({id:p.id,name:p.name})),host:r.host,state:r.state};}
function startRoom(r) {
  r.state="countdown"; r.words=makeText(r.settings).split(" ");
  io.to(r.code).emit("room:update", serializeRoom(r));
  io.to(r.code).emit("battle:prepare",{text:r.words.join(" "),settings:r.settings});
  let n=3; io.to(r.code).emit("battle:countdown",n);
  const timer=setInterval(()=>{n--;io.to(r.code).emit("battle:countdown",n);if(n<=0){clearInterval(timer);r.state="racing";r.started=Date.now();io.to(r.code).emit("battle:start",{started:r.started});}},1000);
  emitRooms();
}
function finish(r, winnerId) {
  if (r.state==="finished") return;
  r.state="finished";
  const results=r.players.map(p=>({id:p.id,name:p.name,index:p.index||0,elapsed:p.elapsed||0}));
  io.to(r.code).emit("battle:finish",{winnerId,results,total:r.words.length});
  setTimeout(()=>{rooms.delete(r.code);emitRooms()},15000);
}

server.listen(PORT,()=>console.log(`TypeRush running on http://localhost:${PORT}`));
