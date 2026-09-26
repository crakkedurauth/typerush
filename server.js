const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 100000
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const queue = new Map();
const timers = new Map();

const WORDS = `the of and a to in is you that it he was for on are as with his they I at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over quick brown fox jumps lazy dog typing battle speed focus race keyboard computer screen world light dark green blue red home open close new old small large good great right left high low fast slow every again because before after while where why work play learn win challenge practice player room public private`.split(/\s+/);

function cleanName(v) {
  const s = String(v || "Racer").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0,18);
  return s || "Racer";
}
function normalize(s={}) {
  return {
    mode:s.mode==="time" ? "time" : "words",
    words:Math.min(100,Math.max(10,Number(s.words)||30)),
    time:Math.min(180,Math.max(15,Number(s.time)||60)),
    punctuation:!!s.punctuation,
    capitalization:!!s.capitalization,
    numbers:!!s.numbers
  };
}
function sameSettings(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }

function makeText(s) {
  const count=s.mode==="words" ? s.words : Math.max(100,Math.ceil(s.time*5));
  const out=[];
  for(let i=0;i<count;i++){
    let w=WORDS[Math.floor(Math.random()*WORDS.length)];
    if(s.numbers && Math.random()<.16) w=String(Math.floor(Math.random()*900)+100);
    if(s.capitalization && Math.random()<.24) w=w[0].toUpperCase()+w.slice(1);
    if(s.punctuation && Math.random()<.18) w += [",",".","!","?",";"][Math.floor(Math.random()*5)];
    out.push(w);
  }
  return out.join(" ");
}

function createRoom(name, settings, visibility) {
  let c; do c=code(); while(rooms.has(c));
  const r={code:c,name:`${name}'s room`,settings,visibility,players:[],host:null,
    state:"lobby",text:"",textHash:"",startedAt:0,endsAt:0};
  rooms.set(c,r); return r;
}
function roomFor(id){for(const r of rooms.values())if(r.players.some(p=>p.id===id))return r;return null}
function publicRooms(){return [...rooms.values()].filter(r=>r.visibility==="public"&&r.state==="lobby"&&r.players.length<2).map(r=>({code:r.code,name:r.name,players:r.players.length,settings:r.settings}))}
function emitRooms(){io.emit("rooms:update",publicRooms())}
function serialize(r){return {code:r.code,name:r.name,visibility:r.visibility,settings:r.settings,players:r.players.map(p=>({id:p.id,name:p.name})),host:r.host,state:r.state}}

function cleanup(code){
  const r=rooms.get(code); if(!r)return;
  if(timers.has(code))clearTimeout(timers.get(code));
  timers.delete(code); rooms.delete(code); emitRooms();
}

function finish(r, reason) {
  if(!r || r.state==="finished")return;
  r.state="finished";
  if(timers.has(r.code))clearTimeout(timers.get(r.code));
  timers.delete(r.code);
  const now=Date.now();
  const results=r.players.map(p=>({
    id:p.id,name:p.name,index:p.index||0,
    elapsed:Math.max(.001,((p.finishAt||now)-r.startedAt)/1000),
    finished:!!p.finished
  }));
  let winnerId=null;
  if(r.settings.mode==="time"){
    const max=Math.max(...results.map(x=>x.index));
    const leaders=results.filter(x=>x.index===max);
    winnerId=leaders.length===1?leaders[0].id:null;
  } else {
    const done=results.filter(x=>x.finished).sort((a,b)=>a.elapsed-b.elapsed);
    winnerId=done.length?done[0].id:null;
  }
  io.to(r.code).emit("battle:finish",{winnerId,results,total:r.text.length,reason});
  setTimeout(()=>cleanup(r.code),15000);
}

function start(r){
  if(!r||r.players.length!==2||r.state!=="lobby")return;
  r.state="countdown"; r.text=makeText(r.settings);
  r.textHash=crypto.createHash("sha256").update(r.text).digest("hex");
  r.players.forEach(p=>Object.assign(p,{index:0,typed:"",finished:false,strikes:0,lastLen:0,lastAt:0,finishAt:0}));
  io.to(r.code).emit("room:update",serialize(r));
  io.to(r.code).emit("battle:prepare",{text:r.text,textHash:r.textHash,settings:r.settings});
  let n=3; io.to(r.code).emit("battle:countdown",n);
  const cd=setInterval(()=>{
    n--; io.to(r.code).emit("battle:countdown",n);
    if(n<=0){
      clearInterval(cd); r.state="racing"; r.startedAt=Date.now();
      r.endsAt=r.settings.mode==="time"?r.startedAt+r.settings.time*1000:0;
      io.to(r.code).emit("battle:start",{started:r.startedAt,endsAt:r.endsAt});
      if(r.settings.mode==="time"){
        const t=setTimeout(()=>finish(r,"time"),r.settings.time*1000+50);
        timers.set(r.code,t);
      }
    }
  },1000);
}

function validate(r,p,typed){
  if(typeof typed!=="string")return {error:"invalid-input",index:p.index||0};
  const now=Date.now();
  if(now<r.startedAt-1500)return {error:"early",index:p.index||0};
  if(r.settings.mode==="time"&&now>r.endsAt+1000)return {error:"late",index:p.index||0};

  // A normal typo is NOT a cheating violation and must never end the race.
  // The authoritative score is the longest correct prefix of the submitted text.
  let correctPrefix=0;
  const max=Math.min(typed.length,r.text.length);
  while(correctPrefix<max && typed[correctPrefix]===r.text[correctPrefix])correctPrefix++;

  // Never allow a client to reduce its server-known progress.
  if(correctPrefix<(p.index||0)){
    return {error:"backward",index:p.index||0};
  }

  const delta=correctPrefix-(p.index||0);
  const elapsed=Math.max(1,now-(p.lastAt||r.startedAt));
  const cps=delta/(elapsed/1000);

  // Only an implausible *correct-prefix* jump is suspicious.
  if(delta>80&&cps>45)return {error:"impossible-speed",index:p.index||0};

  p.index=correctPrefix;
  p.typed=typed.slice(0,correctPrefix);
  p.lastLen=typed.length;
  p.lastAt=now;
  return {error:null,index:correctPrefix};
}

io.on("connection",socket=>{
  socket.emit("rooms:update",publicRooms());
  socket.emit("online",io.engine.clientsCount);

  socket.on("setName",n=>socket.data.name=cleanName(n));

  socket.on("quickMatch",raw=>{
    const s=normalize(raw);
    const hit=[...queue.entries()].find(([id,v])=>id!==socket.id&&sameSettings(v,s));
    if(!hit){queue.set(socket.id,s);socket.emit("queue:waiting");return;}
    const [id]=hit;queue.delete(id);
    const other=io.sockets.sockets.get(id);
    if(!other)return socket.emit("error:msg","Matchmaking timed out. Try again.");
    const r=createRoom(cleanName(other.data.name),s,"private");
    r.players.push({id:other.id,name:cleanName(other.data.name)});
    r.players.push({id:socket.id,name:cleanName(socket.data.name)});
    r.host=other.id;other.join(r.code);socket.join(r.code);
    io.to(r.code).emit("room:update",serialize(r));start(r);
  });

  socket.on("createRoom",({settings,visibility,name}={})=>{
    const r=createRoom(cleanName(name||socket.data.name),normalize(settings),visibility==="private"?"private":"public");
    r.players.push({id:socket.id,name:cleanName(socket.data.name||name)});
    r.host=socket.id;socket.join(r.code);
    socket.emit("room:created",serialize(r));emitRooms();
  });

  socket.on("joinRoom",raw=>{
    const c=String(raw||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    const r=rooms.get(c);
    if(!r||r.state!=="lobby"||r.players.length>=2)return socket.emit("error:msg","That room is unavailable.");
    if(roomFor(socket.id))return socket.emit("error:msg","You are already in a room.");
    r.players.push({id:socket.id,name:cleanName(socket.data.name)});
    socket.join(r.code);io.to(r.code).emit("room:update",serialize(r));emitRooms();
    if(r.players.length===2)start(r);
  });

  socket.on("startRoom",()=>{
    const r=roomFor(socket.id);
    if(r&&r.host===socket.id&&r.players.length===2&&r.state==="lobby")start(r);
  });

  socket.on("race:progress",({typed=""}={})=>{
    const r=roomFor(socket.id);if(!r||r.state!=="racing")return;
    const p=r.players.find(x=>x.id===socket.id);
    const result=validate(r,p,typed);

    // Ordinary typing mistakes are harmless. They do not count as anti-cheat strikes.
    // The player simply keeps typing; their authoritative progress is the correct prefix.
    if(result.error){
      if(result.error==="backward" || result.error==="impossible-speed"){
        p.strikes=(p.strikes||0)+1;
        if(p.strikes>=5){
          socket.emit("error:msg","Suspicious race data was detected. The race has been stopped.");
          finish(r,"invalid-input");
          return;
        }
      }
      socket.emit("race:correction",{typed:p.typed||"",reason:result.error,index:p.index||0});
      return;
    }

    socket.to(r.code).emit("race:opponent",{index:p.index});
    if(p.index>=r.text.length){
      p.finished=true;
      p.finishAt=Date.now();
      if(r.settings.mode==="words")finish(r,"complete");
    }
  });

  socket.on("disconnect",()=>{
    queue.delete(socket.id);
    const r=roomFor(socket.id);
    if(r){
      if(r.state==="racing"||r.state==="countdown"){io.to(r.code).emit("error:msg","Your opponent disconnected.");finish(r,"disconnect")}
      else cleanup(r.code);
    }
    emitRooms();io.emit("online",io.engine.clientsCount);
  });
});

setInterval(()=>{
  for(const id of queue.keys())if(!io.sockets.sockets.get(id))queue.delete(id);
  for(const [c,r] of rooms)if(r.state==="racing"&&r.settings.mode==="time"&&Date.now()>=r.endsAt)finish(r,"time");
},5000);

server.listen(PORT,()=>console.log(`TypeRush running on port ${PORT}`));
