const socket = io();
let name = localStorage.getItem("typerush-name") || "";
let settings = {mode:"words",words:30,time:60,punctuation:false,capitalization:false,numbers:false};
let currentRoom=null, raceText="", startedAt=0, finished=false, lastProgress=0;
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);

function show(id){$$(".view").forEach(v=>v.classList.remove("active"));$("#"+id).classList.add("active");}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
function avatar(n){return (n||"R").slice(0,1).toUpperCase()}
function syncSummary(){ $("#settingSummary").innerHTML=`${settings.mode==="words"?settings.words+" words":settings.time+" seconds"}<br>${settings.punctuation?"Punctuation on":"Punctuation off"} · ${settings.capitalization?"Caps on":"Caps off"} · ${settings.numbers?"Numbers on":"Numbers off"}`; }
function updateSetup(){ $("#wordsValue").textContent=settings.words;$("#timeValue").textContent=settings.time+"s";$("#wordsField").classList.toggle("hidden",settings.mode!=="words");$("#timeField").classList.toggle("hidden",settings.mode!=="time");syncSummary(); }

if(!name) $("#nameModal").style.display="grid"; else $("#nameModal").style.display="none";
$("#saveName").onclick=()=>{const n=$("#nameInput").value.trim();if(!n)return;name=n;localStorage.setItem("typerush-name",name);socket.emit("setName",name);$("#nameModal").style.display="none"};
$("#nameInput").onkeydown=e=>{if(e.key==="Enter")$("#saveName").click()};
socket.on("online",n=>$("#onlineCount").textContent=n);

$("#quickMatchBtn").onclick=()=>{socket.emit("quickMatch",settings);show("lobbyView");$("#lobbyTitle").textContent="Finding an opponent…";$("#players").innerHTML=`<div class="player-card"><div class="avatar">${avatar(name)}</div><b>${escapeHtml(name)}</b></div><div class="vs">VS</div><div class="player-card"><div class="avatar alt">?</div><b>Searching…</b></div>`;$("#roomCode").textContent="MATCH";};
$("#createRoomBtn").onclick=()=>{show("setupView");$("#setupTitle").textContent="Create a room";$("#launchRoomBtn").textContent="Create room"};
$("#launchRoomBtn").onclick=()=>{const vis=document.querySelector("[data-visibility].active").dataset.visibility;socket.emit("createRoom",{settings,visibility:vis,name});show("lobbyView")};
$$("[data-mode]").forEach(b=>b.onclick=()=>{$$("[data-mode]").forEach(x=>x.classList.remove("active"));b.classList.add("active");settings.mode=b.dataset.mode;updateSetup()});
$$("[data-visibility]").forEach(b=>b.onclick=()=>{$$("[data-visibility]").forEach(x=>x.classList.remove("active"));b.classList.add("active")});
$("#wordsRange").oninput=e=>{settings.words=+e.target.value;updateSetup()};
$("#timeRange").oninput=e=>{settings.time=+e.target.value;updateSetup()};
["punctuation","capitalization","numbers"].forEach(k=>$("#"+k).onchange=e=>{settings[k]=e.target.checked;updateSetup()});
document.querySelectorAll("[data-back]").forEach(x=>x.onclick=()=>show("homeView"));
$("#leaveLobby").onclick=()=>{location.reload()};
$("#refreshRooms").onclick=()=>socket.emit("rooms:update");
$("#copyInvite").onclick=async()=>{const url=location.origin+"/?room="+currentRoom.code;await navigator.clipboard.writeText(url);toast("Invite link copied")};
$("#startBattleBtn").onclick=()=>socket.emit("startRoom");
$("#homeBtn").onclick=()=>show("homeView");
$("#rematchBtn").onclick=()=>{if(currentRoom){socket.emit("joinRoom",currentRoom.code);show("lobbyView")}};

socket.on("rooms:update",rooms=>{
  $("#roomList").innerHTML=rooms.length?rooms.map(r=>`<div class="room"><div><div class="room-name">${escapeHtml(r.name)}</div><div class="room-meta">${r.settings.mode==="words"?r.settings.words+" words":r.settings.time+" sec"} · ${r.settings.punctuation?"punctuation":"no punctuation"} · ${r.settings.numbers?"numbers":"no numbers"}</div></div><span class="mini-label">${r.players}/2</span><button class="btn secondary small" onclick="joinRoom('${r.code}')">Join</button></div>`).join(""):`<div class="empty">No public rooms yet. Create one and be the first.</div>`;
});
window.joinRoom=code=>{socket.emit("joinRoom",code);show("lobbyView")};
socket.on("room:created",r=>{currentRoom=r;renderLobby(r);history.replaceState({},'',`/?room=${r.code}`)});
socket.on("room:update",r=>{currentRoom=r;renderLobby(r)});
function renderLobby(r){
 $("#roomCode").textContent=r.code;
 $("#lobbyTitle").textContent=r.players.length>=2?"Opponent found!":"Waiting for opponent";
 $("#players").innerHTML=`${r.players.map(p=>`<div class="player-card"><div class="avatar ${p.id===socket.id?'':'alt'}">${avatar(p.name)}</div><b>${escapeHtml(p.name)}${p.id===socket.id?" (you)":""}</b></div>`).join('<div class="vs">VS</div>')}`;
 if(r.players.length===1) $("#players").innerHTML+=`<div class="vs">VS</div><div class="player-card"><div class="avatar alt">?</div><b>Waiting…</b></div>`;
 $("#lobbySettings").textContent=`${r.settings.mode==="words"?r.settings.words+" words":r.settings.time+" seconds"} · ${r.settings.punctuation?"punctuation":"no punctuation"} · ${r.settings.capitalization?"capitalization":"lowercase"} · ${r.settings.numbers?"numbers":"no numbers"}`;
 $("#startBattleBtn").classList.toggle("hidden",!(r.players.length===2 && r.host===socket.id));
}
socket.on("battle:prepare",d=>{raceText=d.text;$("#raceText").innerHTML=renderText("");$("#typingInput").value="";$("#typingInput").disabled=true;show("battleView")});
socket.on("battle:countdown",n=>{if(n>0){$("#battleClock").textContent=n;$("#typingHint").textContent="Get ready…"}else{$("#battleClock").textContent="GO!";$("#typingHint").textContent="Type the highlighted text."}});
socket.on("battle:start",d=>{startedAt=Date.now();finished=false;$("#typingInput").disabled=false;$("#typingInput").focus();requestAnimationFrame(tickClock)});
socket.on("race:opponent",d=>{const total=raceText.length;$("#opFill").style.width=Math.min(100,(d.index/total)*100)+"%";$("#opProgress").textContent=Math.min(100,Math.round(d.index/total*100))+"%"});
socket.on("battle:finish",data=>{finished=true;const me=data.results.find(x=>x.id===socket.id)||{};const op=data.results.find(x=>x.id!==socket.id)||{};const elapsed=me.elapsed||((Date.now()-startedAt)/1000);const typed=$("#typingInput").value;const correct=scoreText(typed,raceText);const wpm=Math.round((correct.chars/5)/(elapsed/60));$("#resultTitle").textContent=data.winnerId===socket.id?"You won!":"Race finished";$("#resultSubtitle").textContent=data.winnerId===socket.id?"Great race.":"Nice run — race again whenever you're ready.";$("#resultWpm").textContent=wpm||0;$("#resultAccuracy").textContent=Math.round(correct.accuracy*100)+"%";$("#resultTime").textContent=Math.round(elapsed)+"s";$("#resultChars").textContent=correct.chars;$("#resultOpName").textContent=op.name||"Opponent";const opw=Math.round(((op.index||0)/5)/((op.elapsed||elapsed)/60));$("#resultOpWpm").textContent=(opw||0)+" WPM";$("#resultOpBar").style.width=Math.min(100,(op.index||0)/raceText.length*100)+"%";show("resultsView")});
socket.on("error:msg",msg=>{toast(msg);show("homeView")});

$("#typingInput").addEventListener("input",()=>{
 if(finished)return;
 const val=$("#typingInput").value;const s=scoreText(val,raceText);lastProgress=s.index;
 $("#raceText").innerHTML=renderText(val);$("#meFill").style.width=Math.min(100,s.index/raceText.length*100)+"%";$("#meProgress").textContent=Math.min(100,Math.round(s.index/raceText.length*100))+"%";
 const elapsed=(Date.now()-startedAt)/1000;const wpm=Math.round((s.chars/5)/(elapsed/60));$("#liveWpm").textContent=(wpm||0)+" WPM";
 socket.emit("race:progress",{index:s.index,typed:val,elapsed});
 if(settings.mode==="time" && elapsed>=settings.time){$("#typingInput").disabled=true;socket.emit("race:progress",{index:raceText.length,typed:val,elapsed})}
});
function scoreText(input,target){let i=0,correct=0;for(;i<input.length && i<target.length;i++){if(input[i]===target[i])correct++;}return{index:i,chars:correct,accuracy:input.length?correct/input.length:1}}
function renderText(input){let out="";for(let i=0;i<raceText.length;i++){let c=escapeHtml(raceText[i]);if(i<input.length)c=i< input.length && input[i]===raceText[i]?`<span class="correct">${c}</span>`:`<span class="wrong">${c}</span>`;else if(i===input.length)c=`<span class="current">${c}</span>`;out+=c}return out}
function tickClock(){if(finished||!startedAt)return;const e=(Date.now()-startedAt)/1000;$("#battleClock").textContent=settings.mode==="time"?Math.max(0,Math.ceil(settings.time-e))+"s":Math.floor(e)+"s";requestAnimationFrame(tickClock)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function scoreLocalBest(wpm){const old=Number(localStorage.getItem("typerush-best")||0);if(wpm>old){localStorage.setItem("typerush-best",wpm);$("#bestWpm").textContent=wpm}else $("#bestWpm").textContent=old||"—"}
$("#bestWpm").textContent=localStorage.getItem("typerush-best")||"—";
updateSetup();
const roomFromUrl=new URLSearchParams(location.search).get("room");if(roomFromUrl){setTimeout(()=>{socket.emit("joinRoom",roomFromUrl.toUpperCase());show("lobbyView")},300)}
