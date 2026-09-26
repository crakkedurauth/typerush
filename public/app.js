const socket = io({ transports: ['websocket', 'polling'] });
const $ = id => document.getElementById(id);
const screens = ['mode','casual','ranked','rooms','queue','battle','result'];
let me = null, mode = null, currentSettings = null, matchId = null, roomCode = null, text = '', startedAt = 0, battleStarted = false, localMistakes = 0, inputLocked = false, battleKind = 'match';

function show(id) { screens.forEach(x => $(x)?.classList.toggle('hidden', x !== id)); window.scrollTo({top:0, behavior:'smooth'}); }
function toast(message) { const t=$('toast'); t.textContent=message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.classList.remove('show'),2600); }
function initials(name){ return String(name||'G').slice(0,2).toUpperCase(); }
function getSettings(){ return { words:Math.max(10,Math.min(200,+$('words').value||30)), time:Math.max(10,Math.min(300,+$('time').value||60)), punctuation:$('punct').checked, capitals:$('caps').checked, numbers:$('nums').checked, mistakes:$('mistakes').value, mode:$('roomMode').value }; }
function renderAccount(){ $('account').innerHTML = me ? `<div class="account-chip"><span class="avatar">${initials(me.username)}</span><span>${me.username} · <b>${me.elo} ELO</b></span></div>` : '<span class="guest-chip">Guest</span>'; }
async function loadMe(){ try{ const r=await fetch('/api/me'); const d=await r.json(); if(d.user){me=d.user; renderAccount();} }catch{} }
function loadRanked(){
  if(me){ $('auth').innerHTML=`<div class="panel profile-card"><div class="profile-avatar">${initials(me.username)}</div><div><div class="profile-name">${me.username}</div><div class="elo">${me.elo} ELO · Ranked ready</div></div></div>`; $('rankedQueue').classList.remove('hidden'); }
  else { $('rankedQueue').classList.add('hidden'); $('auth').innerHTML=`<div class="panel"><div class="panel-heading"><div><h3>Enter the ranked ladder</h3><p>Create an account to save your rating and match history.</p></div><span class="panel-icon">◈</span></div><div class="auth-grid"><input class="auth-input" id="username" maxlength="20" placeholder="Username"><input class="auth-input" id="password" type="password" placeholder="Password · 8+ characters"></div><div class="auth-actions"><button id="login">Log in</button><button id="signup" class="primary">Create account</button></div><div class="auth-note">Casual play never requires an account.</div></div>`; $('login').onclick=auth('login'); $('signup').onclick=auth('signup'); }
}
function auth(type){ return async()=>{ const username=$('username').value.trim(), password=$('password').value; if(!username||!password)return toast('Enter your username and password.'); try{ const r=await fetch('/api/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}); const d=await r.json(); if(!r.ok)return toast(d.error||'Something went wrong.'); me=d.user; renderAccount(); loadRanked(); socket.emit('identify'); toast(type==='signup'?'Account created. Welcome to Ranked.':'Welcome back, '+me.username+'.'); }catch{toast('Could not reach the server.');} }; }
function updateRaceType(){ const isWords=$('roomMode').value==='words'; $('wordsLabel').classList.toggle('hidden',!isWords); $('timeLabel').classList.toggle('hidden',isWords); }
function renderRooms(list){ $('roomCount').textContent=list.length; $('roomList').innerHTML=list.length?list.map(r=>`<div class="room-item"><div><strong>ROOM ${r.code}</strong><small>${r.players}/2 · ${r.settings.mode==='time'?r.settings.time+' sec':r.settings.words+' words'} · ${r.settings.mistakes==='unlimited'?'Unlimited mistakes':r.settings.mistakes+' mistakes'}</small></div><button onclick="joinRoom('${r.code}')">Join →</button></div>`).join(''):'<div class="empty">No public rooms yet.<br>Create one and be the first to race.</div>'; }
function updateStats(v){ let mistakes=0; for(let i=0;i<v.length;i++) if(v[i]!==text[i]) mistakes++; localMistakes=Math.max(localMistakes,mistakes); const elapsed=Math.max(.25,(Date.now()-startedAt)/60000); const wpm=Math.round((v.length/5)/elapsed); $('battleStats').textContent=`${wpm||0} WPM · ${localMistakes} mistake${localMistakes===1?'':'s'}`; $('accuracy').textContent=(v.length?Math.max(0,Math.round((1-localMistakes/v.length)*100)):100)+'%'; $('progressBar').style.width=(text.length?Math.min(100,v.length/text.length*100):0)+'%'; $('progressLabel').textContent=Math.round(text.length?Math.min(100,v.length/text.length*100):0)+'%'; }
function queue(modeName){ mode=modeName; show('queue'); $('queueText').textContent=modeName==='ranked'?'Searching within your ELO range…':'Searching for another player…'; currentSettings={...getSettings(),mode:modeName==='ranked'?'words':getSettings().mode}; socket.emit('queueJoin',{mode:modeName,settings:currentSettings}); }
function prepareBattle(d, kind='match'){
  battleKind=kind; matchId=d.matchId||null; roomCode=d.code||null; text=d.text; currentSettings=d.settings; battleStarted=false; localMistakes=0; inputLocked=false; show('battle');
  $('battleMode').textContent=(kind==='room'?'CASUAL ROOM':(currentSettings.mode==='time'?'TIME':'WORDS')).toUpperCase(); $('opp').textContent=d.opponent?.username||'Opponent'; $('oppMeta').textContent=d.opponent?.elo?d.opponent.elo+' ELO':'Ready'; $('you').textContent=me?me.username:'Guest'; $('youMeta').textContent=me?me.elo+' ELO':'Casual player'; $('text').textContent=text; $('typing').value=''; $('typing').disabled=true; $('progressBar').style.width='0%'; $('progressLabel').textContent='0%'; $('accuracy').textContent='100%'; $('battleStats').textContent='0 WPM · 0 mistakes';
  const end=Date.now()+3000; clearInterval(prepareBattle.timer); prepareBattle.timer=setInterval(()=>{const n=Math.ceil((end-Date.now())/1000); $('countdown').textContent=n>0?n:'GO!'; if(n<=0)clearInterval(prepareBattle.timer);},80);
}
function finishUI(d){ battleStarted=false; $('typing').disabled=true; show('result'); const win=d.winner===socket.id; $('resultIcon').textContent=win?'✦':(d.winner===null?'≈':'×'); $('resultTitle').textContent=win?'Victory!':(d.winner===null?'Draw':'Defeat'); $('resultText').textContent=d.reason==='mistakes'?'The mistake limit was exceeded.':d.reason==='time'?'Time expired.':d.reason==='time-draw'?'Time expired with an equal score.':win?'You finished first.':'Your opponent finished first.'; if(d.eloChange&&me){ const delta=win?d.eloChange.winner:d.eloChange.loser; me.elo=win?d.eloChange.winnerElo:d.eloChange.loserElo; $('resultMeta').innerHTML=`<strong>${me.username}</strong> · ${me.elo} ELO <span class="elo-change">${delta>=0?'+':''}${delta}</span>`; renderAccount(); } else $('resultMeta').textContent=mode==='ranked'&&me?`${me.username} · ${me.elo} ELO`:'Casual battle complete'; }

document.querySelectorAll('.mode-card').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;show(mode);if(mode==='ranked')loadRanked();});
document.querySelectorAll('.back').forEach(b=>b.onclick=()=>show(b.dataset.back));
$('brandHome').onclick=()=>show('mode'); $('roomMenu').onclick=()=>{show('rooms');socket.emit('roomList');}; $('roomMode').onchange=updateRaceType; $('casualQueue').onclick=()=>queue('casual'); $('rankedQueue').onclick=()=>queue('ranked'); $('cancelQueue').onclick=()=>{socket.emit('queueLeave');show(mode||'mode');toast('Matchmaking cancelled.');};
$('createRoom').onclick=()=>{currentSettings=getSettings();socket.emit('createRoom',{settings:currentSettings,privateRoom:$('private').value==='1'});};
$('joinRoomBtn').onclick=()=>{const c=$('joinCode').value.trim().toUpperCase(); if(!c)return toast('Enter a room code.'); socket.emit('joinRoom',{code:c});};
$('startRoom').onclick=()=>{if(roomCode)socket.emit('startRoom',{code:roomCode});};
$('again').onclick=()=>show('mode');

socket.on('connect',()=>socket.emit('identify'));
socket.on('guestReady',u=>{if(!me)renderAccount();});
socket.on('identified',u=>{me=u;renderAccount();});
socket.on('roomCreated',d=>{roomCode=d.code;$('lobbyCode').textContent='ROOM '+d.code;$('lobbyStatus').textContent=d.private?'Private · share the code or invite link':'Public · waiting for another player';$('roomLobby').classList.remove('hidden');$('startRoom').classList.add('hidden');toast(d.private?'Private room created · '+d.code:'Public room '+d.code+' created');socket.emit('roomList');});
socket.on('roomList',renderRooms);
socket.on('roomState',d=>{roomCode=d.code;$('lobbyCode').textContent='ROOM '+d.code;$('lobbyStatus').textContent=`${d.players}/2 players`; $('roomLobby').classList.remove('hidden'); if(d.host===socket.id && d.players>=2)$('startRoom').classList.remove('hidden'); else $('startRoom').classList.add('hidden'); toast(`Room ${d.code} · ${d.players}/2 players`);});
window.joinRoom=code=>{roomCode=code;socket.emit('joinRoom',{code});};
socket.on('errorMsg',m=>{toast(m);if(!$('queue').classList.contains('hidden'))show(mode||'mode');});
socket.on('matchFound',d=>prepareBattle(d,'match'));
socket.on('roomBattle',d=>prepareBattle({...d,matchId:null,opponent:{username:'Room opponent'}},'room'));
socket.on('battleStart',d=>{startedAt=d.startAt;const wait=Math.max(0,d.startAt-Date.now());setTimeout(()=>{$('typing').disabled=false;$('typing').focus();battleStarted=true;toast('GO — type!');},wait);});
$('typing').addEventListener('input',()=>{if(!battleStarted||inputLocked)return;const v=$('typing').value;if(v!==text.slice(0,v.length)){inputLocked=true;$('typing').value=v.slice(0,-1);localMistakes++;updateStats($('typing').value);setTimeout(()=>inputLocked=false,20);return;} updateStats(v); if(battleKind==='room')socket.emit('roomProgress',{code:roomCode,value:v,mistakes:localMistakes}); else socket.emit('progress',{matchId,index:v.length,value:v,mistakes:localMistakes});});
socket.on('opponentProgress',d=>{if(d.socketId!==socket.id)$('oppMeta').textContent=`${Math.round(d.index/text.length*100)}% · ${d.mistakes} mistakes`;});
socket.on('roomOpponentProgress',d=>{if(d.socketId!==socket.id)$('oppMeta').textContent=`${Math.round(d.index/text.length*100)}% · ${d.mistakes} mistakes`;});
socket.on('battleEnd',finishUI);
loadMe(); updateRaceType(); renderAccount();
setTimeout(()=>{$('main').classList.remove('hidden');},1950);


/* TypeRush auth reliability patch */
(() => {
  const apiJSON = async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', ...(options.headers || {})},
      ...options
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  function showAuthMessage(message, ok=false) {
    let el = document.querySelector('#authMessage');
    if (!el) {
      el = document.createElement('div');
      el.id = 'authMessage';
      el.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:10px;font-size:13px;';
      const target = document.querySelector('#authPanel') || document.querySelector('#rankedPanel') || document.body;
      target.appendChild(el);
    }
    el.textContent = message;
    el.style.background = ok ? 'rgba(80,220,150,.12)' : 'rgba(255,90,110,.12)';
    el.style.border = ok ? '1px solid rgba(80,220,150,.28)' : '1px solid rgba(255,90,110,.28)';
  }

  document.addEventListener('click', async (event) => {
    const loginBtn = event.target.closest('[data-auth-action="login"], #loginBtn, #loginButton');
    const signupBtn = event.target.closest('[data-auth-action="signup"], #signupBtn, #signupButton');
    if (!loginBtn && !signupBtn) return;

    event.preventDefault();
    const mode = signupBtn ? 'signup' : 'login';
    const username = (document.querySelector('#authUsername, #username, input[name="username"]')?.value || '').trim();
    const password = document.querySelector('#authPassword, #password, input[name="password"]')?.value || '';

    if (!username || !password) {
      showAuthMessage('Enter a username and password.');
      return;
    }

    const btn = signupBtn || loginBtn;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';

    try {
      const data = await apiJSON(`/api/${mode}`, {
        method:'POST',
        body: JSON.stringify({username, password})
      });
      showAuthMessage(mode === 'signup' ? 'Account created — you are signed in.' : 'Signed in successfully.', true);
      window.dispatchEvent(new CustomEvent('typerush-auth-success', {detail:data.user}));
      if (typeof window.loadRanked === 'function') await window.loadRanked();
    } catch (err) {
      showAuthMessage(err.message || 'Unable to complete authentication.');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('#authUsername, #authPassword, #username, #password, input[name="username"], input[name="password"]');
    if (!input) return;
    const panel = input.closest('form, #authPanel, #rankedPanel') || document;
    const btn = panel.querySelector('[data-auth-action="login"], [data-auth-action="signup"], #loginBtn, #loginButton, #signupBtn, #signupButton');
    if (btn && !btn.disabled) btn.click();
  });
})();
