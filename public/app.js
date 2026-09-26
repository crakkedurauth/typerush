const socket=io();
const $=id=>document.getElementById(id);
let me=null,mode=null,currentSettings=null,matchId=null,text='',startedAt=0,battleStarted=false,localMistakes=0,inputLocked=false;
const screens=['mode','casual','ranked','rooms','queue','battle','result'];
function show(id){screens.forEach(x=>$(x)?.classList.toggle('hidden',x!==id));window.scrollTo({top:0,behavior:'smooth'});}
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('toast-show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('toast-show'),2600)}
function settings(){return{words:Math.max(10,Math.min(200,+$('words').value||30)),time:Math.max(10,Math.min(300,+$('time').value||60)),punctuation:$('punct').checked,capitals:$('caps').checked,numbers:$('nums').checked,mistakes:$('mistakes').value,mode:$('roomMode').value}}
function initials(name){return String(name||'G').slice(0,2).toUpperCase()}
function renderAccount(){
  const a=$('account');
  if(me)a.innerHTML=`<div class="account-chip"><span class="avatar">${initials(me.username)}</span><span>${me.username} · <b>${me.elo} ELO</b></span></div>`;
  else a.innerHTML='';
}
function loadRanked(){
  if(me){
    $('auth').innerHTML=`<div class="panel profile-card"><div class="profile-avatar">${initials(me.username)}</div><div><div class="profile-name">${me.username}</div><div class="elo">${me.elo} ELO · Ranked ready</div></div></div>`;
    $('rankedQueue').classList.remove('hidden');
  }else{
    $('rankedQueue').classList.add('hidden');
    $('auth').innerHTML=`<div class="panel"><div class="panel-heading"><div><h3>Enter the ranked ladder</h3><p>Create an account to save your rating and match history.</p></div><span class="panel-icon">◈</span></div><div class="auth-grid"><input class="auth-input" id="username" maxlength="20" placeholder="Username"><input class="auth-input" id="password" type="password" placeholder="Password · 8+ characters"></div><div class="auth-actions"><button id="login">Log in</button><button id="signup" class="primary">Create account</button></div><div class="auth-note">Casual play never requires an account.</div></div>`;
    $('login').onclick=auth('login');$('signup').onclick=auth('signup');
  }
}
function auth(type){return async()=>{
  const username=$('username').value.trim(),password=$('password').value;
  if(!username||!password)return toast('Enter your username and password.');
  try{
    const r=await fetch('/api/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const d=await r.json();if(!r.ok)return toast(d.error||'Something went wrong.');
    me=d.user;renderAccount();loadRanked();toast(type==='signup'?'Account created. Welcome to Ranked.':'Welcome back, '+me.username+'.');
  }catch(e){toast('Could not reach the server.');}
}}
function updateRaceType(){const isWords=$('roomMode').value==='words';$('wordsLabel').classList.toggle('hidden',!isWords);$('timeLabel').classList.toggle('hidden',isWords)}
function renderRooms(list){
  $('roomCount').textContent=list.length;
  $('roomList').innerHTML=list.length?list.map(r=>`<div class="room-item"><div><strong>ROOM ${r.code}</strong><small>${r.players}/2 players · ${r.settings.mode==='time'?r.settings.time+' seconds':r.settings.words+' words'} · ${r.settings.mistakes==='unlimited'?'Unlimited mistakes':r.settings.mistakes+' mistakes'}</small></div><button onclick="joinRoom('${r.code}')">Join →</button></div>`).join(''):'<div class="empty">No public rooms yet.<br>Create one and be the first to race.</div>';
}
function setBattleProgress(index){
  const pct=text.length?Math.min(100,index/text.length*100):0;
  $('progressBar').style.width=pct+'%';$('progressLabel').textContent=Math.round(pct)+'%';
}
function updateStats(v){
  let mistakes=0;for(let i=0;i<v.length;i++)if(v[i]!==text[i])mistakes++;
  localMistakes=mistakes;
  const elapsed=Math.max(.25,(Date.now()-startedAt)/60000);
  const wpm=Math.round((v.length/5)/elapsed);
  $('battleStats').textContent=`${wpm||0} WPM · ${mistakes} mistake${mistakes===1?'':'s'}`;
  const accuracy=v.length?Math.round((1-mistakes/v.length)*100):100;
  $('accuracy').textContent=accuracy+'%';
  setBattleProgress(v.length);
}
function queue(m){mode=m;show('queue');$('queueText').textContent=m==='ranked'?'Searching within your ELO range…':'Searching for another player…';currentSettings={...settings(),mode:m};socket.emit('queueJoin',{mode:m,settings:currentSettings})}
function beginBattle(d){
  matchId=d.matchId;text=d.text;currentSettings=d.settings;battleStarted=false;localMistakes=0;inputLocked=false;
  show('battle');$('battleMode').textContent=(currentSettings.mode||mode||'casual').toUpperCase();$('opp').textContent=d.opponent.username+' · '+d.opponent.elo+' ELO';$('oppMeta').textContent='Opponent';$('you').textContent=me?me.username:'Guest';$('youMeta').textContent=me?me.elo+' ELO':'Casual player';$('text').textContent=text;$('typing').value='';$('typing').disabled=true;$('typing').classList.remove('error');$('progressBar').style.width='0%';$('progressLabel').textContent='0%';$('accuracy').textContent='100%';
  let end=Date.now()+Math.max(0,(d.startsIn||3)*1000);clearInterval(beginBattle.timer);
  beginBattle.timer=setInterval(()=>{let n=Math.ceil((end-Date.now())/1000);$('countdown').textContent=n>0?n:'GO!';if(n<=0){clearInterval(beginBattle.timer)}},100);
}
document.querySelectorAll('.mode-card').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;show(mode);if(mode==='ranked')loadRanked()});
document.querySelectorAll('.back').forEach(b=>b.onclick=()=>show(b.dataset.back));
$('brandHome').onclick=()=>show('mode');
$('roomMenu').onclick=()=>{show('rooms');socket.emit('roomList')};
$('roomMode').onchange=updateRaceType;
$('casualQueue').onclick=()=>queue('casual');
$('rankedQueue').onclick=()=>queue('ranked');
$('cancelQueue').onclick=()=>{socket.emit('queueLeave');show(mode||'mode');toast('Matchmaking cancelled.')};
$('createRoom').onclick=()=>{currentSettings=settings();socket.emit('createRoom',{settings:currentSettings,privateRoom:$('private').value==='1'})};
$('again').onclick=()=>show('mode');

socket.on('connect',()=>socket.emit('identify'));
socket.on('identified',u=>{me=u;renderAccount()});
socket.on('roomCreated',d=>{show('rooms');toast(d.private?'Private room created · Code '+d.code:'Public room '+d.code+' created');socket.emit('roomList')});
socket.on('roomList',renderRooms);
socket.on('roomState',d=>toast(`Room ${d.code} · ${d.players}/2 players`));
window.joinRoom=code=>{socket.emit('joinRoom',{code});toast('Joining room '+code+'…')};
socket.on('errorMsg',m=>{toast(m);if($('queue')&&!$('queue').classList.contains('hidden'))show(mode||'mode')});
socket.on('matchFound',beginBattle);
socket.on('battleStart',d=>{startedAt=d.startAt;const wait=Math.max(0,d.startAt-Date.now());setTimeout(()=>{$('typing').disabled=false;$('typing').focus();battleStarted=true;toast('GO — type!')},wait)});

$('typing').addEventListener('input',()=>{
  if(!battleStarted||inputLocked)return;
  const v=$('typing').value;
  let valid=true;for(let i=0;i<v.length;i++)if(v[i]!==text[i]){valid=false;break}
  if(!valid){inputLocked=true;$('typing').value=v.slice(0,-1);localMistakes++;updateStats($('typing').value);setTimeout(()=>inputLocked=false,25);return}
  updateStats(v);socket.emit('progress',{matchId,index:v.length,mistakes:localMistakes});
});
socket.on('opponentProgress',d=>{
  if(d.socketId!==socket.id){$('oppMeta').textContent=`${Math.round(d.index/text.length*100)}% · ${d.mistakes} mistakes`}
});
socket.on('battleEnd',d=>{
  battleStarted=false;$('typing').disabled=true;show('result');
  const win=d.winner===socket.id;
  $('resultIcon').textContent=win?'✦':'×';$('resultTitle').textContent=win?'Victory!':'Defeat';
  $('resultText').textContent=d.reason==='mistakes'?'The mistake limit was exceeded.':win?'You finished first.':'Your opponent finished first.';
  $('resultMeta').innerHTML=mode==='ranked'&&me?`<strong>${me.username}</strong> · current rating ${me.elo} ELO`:'Casual battle complete';
});
setTimeout(()=>{$('main').classList.remove('hidden')},1950);
