const socket=io();
let name=localStorage.getItem("typerush-name")||"";
let settings={mode:"words",words:30,time:60,punctuation:false,capitalization:false,numbers:false};
let currentRoom=null,raceText="",startedAt=0,finished=false;
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const show=id=>{$$(".view").forEach(v=>v.classList.remove("active"));$("#"+id).classList.add("active")};
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)};
const avatar=n=>(n||"R").slice(0,1).toUpperCase();
const esc=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

function updateSetup(){
 $("#wordsValue").textContent=settings.words;$("#timeValue").textContent=settings.time+"s";
 $("#wordsField").classList.toggle("hidden",settings.mode!=="words");$("#timeField").classList.toggle("hidden",settings.mode!=="time");
 $("#settingSummary").innerHTML=`${settings.mode==="words"?settings.words+" words":settings.time+" seconds"}<br>${settings.punctuation?"Punctuation on":"Punctuation off"} · ${settings.capitalization?"Caps on":"Caps off"} · ${settings.numbers?"Numbers on":"Numbers off"}`;
}
function score(input){
 let correct=0;for(let i=0;i<input.length&&i<raceText.length;i++)if(input[i]===raceText[i])correct++;
 let prefix=0;while(prefix<input.length&&prefix<raceText.length&&input[prefix]===raceText[prefix])prefix++;
 return {correct,accuracy:input.length?correct/input.length:1,index:prefix};
}
function renderText(input){
 let out="";
 for(let i=0;i<raceText.length;i++){
  const c=esc(raceText[i]);
  if(i<input.length)out+=input[i]===raceText[i]?`<span class="correct">${c}</span>`:`<span class="wrong">${c}</span>`;
  else if(i===input.length)out+=`<span class="current">${c}</span>`;else out+=c;
 }
 return out;
}
function best(wpm){
 const old=Number(localStorage.getItem("typerush-best")||0);
 if(wpm>old)localStorage.setItem("typerush-best",wpm);
 $("#bestWpm").textContent=Math.max(old,wpm)||"—";
}

if(name)$("#nameModal").style.display="none";
$("#saveName").onclick=()=>{const n=$("#nameInput").value.trim();if(!n)return;name=n;localStorage.setItem("typerush-name",name);socket.emit("setName",name);$("#nameModal").style.display="none"};
$("#nameInput").onkeydown=e=>{if(e.key==="Enter")$("#saveName").click()};
socket.on("online",n=>$("#onlineCount").textContent=n);

$("#quickMatchBtn").onclick=()=>{socket.emit("quickMatch",settings);show("lobbyView");$("#lobbyTitle").textContent="Finding an opponent…";$("#roomCode").textContent="MATCH";$("#players").innerHTML=`<div class="player-card"><div class="avatar">${avatar(name)}</div><b>${esc(name)}</b></div><div class="vs">VS</div><div class="player-card"><div class="avatar alt">?</div><b>Searching…</b></div>`};
$("#createRoomBtn").onclick=()=>{show("setupView");$("#setupTitle").textContent="Create a room";$("#launchRoomBtn").textContent="Create room"};
$("#launchRoomBtn").onclick=()=>{const vis=document.querySelector("[data-visibility].active").dataset.visibility;socket.emit("createRoom",{settings,visibility:vis,name});show("lobbyView")};
$$("[data-mode]").forEach(b=>b.onclick=()=>{$$("[data-mode]").forEach(x=>x.classList.remove("active"));b.classList.add("active");settings.mode=b.dataset.mode;updateSetup()});
$$("[data-visibility]").forEach(b=>b.onclick=()=>{$$("[data-visibility]").forEach(x=>x.classList.remove("active"));b.classList.add("active")});
$("#wordsRange").oninput=e=>{settings.words=+e.target.value;updateSetup()};
$("#timeRange").oninput=e=>{settings.time=+e.target.value;updateSetup()};
["punctuation","capitalization","numbers"].forEach(k=>$("#"+k).onchange=e=>{settings[k]=e.target.checked;updateSetup()});
$$("[data-back]").forEach(x=>x.onclick=()=>show("homeView"));
$("#leaveLobby").onclick=()=>location.href=location.pathname;
$("#copyInvite").onclick=async()=>{if(currentRoom){await navigator.clipboard.writeText(location.origin+"/?room="+currentRoom.code);toast("Invite link copied")}};
$("#startBattleBtn").onclick=()=>socket.emit("startRoom");
$("#homeBtn").onclick=()=>{history.replaceState({},'',location.pathname);show("homeView")};
$("#rematchBtn").onclick=()=>{if(currentRoom){socket.emit("joinRoom",currentRoom.code);show("lobbyView")}};

socket.on("rooms:update",rooms=>{
 $("#roomList").innerHTML=rooms.length?rooms.map(r=>`<div class="room"><div><div class="room-name">${esc(r.name)}</div><div class="room-meta">${r.settings.mode==="words"?r.settings.words+" words":r.settings.time+" sec"} · ${r.settings.punctuation?"punctuation":"no punctuation"} · ${r.settings.numbers?"numbers":"no numbers"}</div></div><span class="mini-label">${r.players}/2</span><button class="btn secondary small" onclick="joinRoom('${r.code}')">Join</button></div>`).join(""):`<div class="empty">No public rooms yet. Create one and be the first.</div>`;
});
window.joinRoom=c=>{socket.emit("joinRoom",c);show("lobbyView")};
socket.on("queue:waiting",()=>$("#lobbyStatus").textContent="Searching for an opponent with matching settings…");
socket.on("room:created",r=>{currentRoom=r;renderLobby(r);history.replaceState({},'',`/?room=${r.code}`)});
socket.on("room:update",r=>{currentRoom=r;renderLobby(r)});
function renderLobby(r){
 $("#roomCode").textContent=r.code;$("#lobbyTitle").textContent=r.players.length===2?"Opponent found!":"Waiting for opponent";
 let cards=r.players.map(p=>`<div class="player-card"><div class="avatar ${p.id===socket.id?"":"alt"}">${avatar(p.name)}</div><b>${esc(p.name)}${p.id===socket.id?" (you)":""}</b></div>`);
 if(r.players.length===1)cards.push(`<div class="vs">VS</div><div class="player-card"><div class="avatar alt">?</div><b>Waiting…</b></div>`);
 $("#players").innerHTML=cards.join(r.players.length===2?'<div class="vs">VS</div>':"");
 $("#lobbySettings").textContent=`${r.settings.mode==="words"?r.settings.words+" words":r.settings.time+" seconds"} · ${r.settings.punctuation?"punctuation":"no punctuation"} · ${r.settings.capitalization?"capitalization":"lowercase"} · ${r.settings.numbers?"numbers":"no numbers"}`;
 $("#startBattleBtn").classList.toggle("hidden",!(r.players.length===2&&r.host===socket.id));
}
socket.on("battle:prepare",d=>{raceText=d.text;settings=d.settings;$("#raceText").innerHTML=renderText("");$("#typingInput").value="";$("#typingInput").disabled=true;show("battleView")});
socket.on("battle:countdown",n=>$("#battleClock").textContent=n>0?n:"GO!");
socket.on("battle:start",d=>{startedAt=d.started;finished=false;$("#typingInput").disabled=false;$("#typingInput").focus();requestAnimationFrame(clock)});
socket.on("race:correction",d=>{
  // Keep the player's actual input visible. A typo is normal gameplay, not a ban-worthy event.
  // The server only corrects its authoritative progress.
  if(d.reason==="impossible-speed"||d.reason==="backward") toast("That progress update was rejected by the server.");
});
socket.on("race:opponent",d=>{$("#opFill").style.width=Math.min(100,(d.index||0)/raceText.length*100)+"%";$("#opProgress").textContent=Math.min(100,Math.round((d.index||0)/raceText.length*100))+"%"});
socket.on("battle:finish",data=>{
 finished=true;$("#typingInput").disabled=true;
 const me=data.results.find(x=>x.id===socket.id)||{index:0,elapsed:(Date.now()-startedAt)/1000};
 const op=data.results.find(x=>x.id!==socket.id)||{index:0,elapsed:me.elapsed};
 const s=score($("#typingInput").value),elapsed=Math.max(.1,me.elapsed||1),wpm=Math.round((s.correct/5)/(elapsed/60));
 best(wpm);
 $("#resultTitle").textContent=data.winnerId===socket.id?"You won!":data.winnerId===null?"It's a tie!":"Race finished";
 $("#resultSubtitle").textContent=data.reason==="disconnect"?"Your opponent disconnected.":data.reason==="time"?"Time's up.":"Race complete.";
 $("#resultWpm").textContent=wpm||0;$("#resultAccuracy").textContent=Math.round(s.accuracy*100)+"%";$("#resultTime").textContent=Math.round(elapsed)+"s";$("#resultChars").textContent=s.correct;
 const opw=Math.round(((op.index||0)/5)/(Math.max(.1,op.elapsed||elapsed)/60));
 $("#resultOpName").textContent=op.name||"Opponent";$("#resultOpWpm").textContent=(opw||0)+" WPM";$("#resultOpBar").style.width=Math.min(100,(op.index||0)/raceText.length*100)+"%";
 show("resultsView");
});
$("#typingInput").addEventListener("input",()=>{
 if(finished)return;
 const input=$("#typingInput").value,s=score(input);
 $("#raceText").innerHTML=renderText(input);$("#meFill").style.width=Math.min(100,s.index/raceText.length*100)+"%";$("#meProgress").textContent=Math.min(100,Math.round(s.index/raceText.length*100))+"%";
 const elapsed=Math.max(.001,(Date.now()-startedAt)/1000),wpm=Math.round((s.correct/5)/(elapsed/60));$("#liveWpm").textContent=(wpm||0)+" WPM";
 socket.emit("race:progress",{typed:input});
});
function clock(){
 if(finished)return;
 const e=(Date.now()-startedAt)/1000;
 $("#battleClock").textContent=settings.mode==="time"?Math.max(0,Math.ceil(settings.time-e))+"s":Math.floor(e)+"s";
 requestAnimationFrame(clock);
}
socket.on("error:msg",m=>{toast(m);setTimeout(()=>show("homeView"),700)});
$("#bestWpm").textContent=localStorage.getItem("typerush-best")||"—";
updateSetup();
const room=new URLSearchParams(location.search).get("room");if(room)setTimeout(()=>{socket.emit("joinRoom",room);show("lobbyView")},300);
