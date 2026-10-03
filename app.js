/* =====================================================================
   PariBari — app logic (Supabase-backed)
   ===================================================================== */
'use strict';

/* ------------------------------- helpers ------------------------------ */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const CFG = window.PARIBARI_CONFIG || {};

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n){ n = Number(n)||0; return n>=1000 ? (n/1000).toFixed(n%1000>=100?1:0).replace(/\.0$/,'')+'k' : String(n); }
function timeAgo(iso){
  const d = (Date.now() - new Date(iso).getTime())/1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  if (d < 604800) return Math.floor(d/86400)+'d ago';
  return new Date(iso).toLocaleDateString();
}
function fallbackAvatar(name){
  const ch = (name||'?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f09433"/><stop offset="1" stop-color="#bc1888"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="50" font-size="44" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${esc(ch)}</text></svg>`;
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
}
function avatarOf(p){ return (p && p.avatar_url) ? p.avatar_url : fallbackAvatar(p && (p.username||p.name)); }
function avatarImg(p, cls){
  return `<img src="${avatarOf(p)}" alt="" ${cls?`class="${cls}"`:''} onerror="this.onerror=null;this.src='${fallbackAvatar(p && p.username)}'">`;
}

let toastT;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove('on'), 2200);
}
const errEl = (id,msg)=>{ const e=$(id); if(e) e.textContent = msg||''; };

/* ------------------------------- theme -------------------------------- */
(function initTheme(){
  const saved = localStorage.getItem('paribari_theme');
  const dark = saved ? saved==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
})();
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const nx  = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nx);
  localStorage.setItem('paribari_theme', nx);
};

/* ------------------------------- config ------------------------------- */
const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);

let sb = null;                 // supabase client
let me = null;                 // my profile row
let myFollowing = new Set();   // ids I follow
let mySaves = new Set();       // post ids I saved
let feed = [];                 // current feed posts
let realtimeCh = null;

function start(){
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  sb.auth.onAuthStateChange((evt, session) => {
    if (evt === 'SIGNED_OUT'){ me = null; showAuth(); }
    else if ((evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION') && session){ afterLogin(); }
  });
  afterLogin().catch(e => { console.error(e); showAuth(); });
}

/* =============================== AUTH ================================= */
function showAuth(){ $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function showApp(){ $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$('#tabEmail').onclick = ()=>{ $('#tabEmail').classList.add('on'); $('#tabGuest').classList.remove('on');
  $('#formEmail').classList.remove('hidden'); $('#guestPane').classList.add('hidden'); errEl('#authErr',''); errEl('#authOk',''); };
$('#tabGuest').onclick = ()=>{ $('#tabGuest').classList.add('on'); $('#tabEmail').classList.remove('on');
  $('#guestPane').classList.remove('hidden'); $('#formEmail').classList.add('hidden'); errEl('#authErr',''); errEl('#authOk',''); };

/* Passwordless: email a one-time login link */
$('#formEmail').onsubmit = async (e) => {
  e.preventDefault(); errEl('#authErr',''); errEl('#authOk','');
  const name = $('#emName').value.trim();
  const username = $('#emUser').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const email = $('#emEmail').value.trim();
  if (!username) return errEl('#authErr','Please choose a username (letters, numbers, underscore).');
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending...';
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { username, name },
      emailRedirectTo: location.origin + location.pathname
    }
  });
  btn.disabled = false; btn.textContent = 'Email me a login link';
  if (error) return errEl('#authErr', error.message);
  errEl('#authOk', 'Link sent! Open your email on this device and tap the link — you will be signed in automatically.');
};

/* Passwordless: instant guest account, no email at all */
$('#guestBtn').onclick = async () => {
  errEl('#authErr',''); errEl('#authOk','');
  const name = $('#gName').value.trim() || 'Guest';
  let username = $('#gUser').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  if (!username) username = 'guest' + Math.floor(1000 + Math.random()*9000);
  const btn = $('#guestBtn'); btn.disabled = true; btn.textContent = 'Signing in...';
  const { error } = await sb.auth.signInAnonymously({ options: { data: { username, name } } });
  btn.disabled = false; btn.textContent = 'Continue as guest';
  if (error) return errEl('#authErr', error.message);
  await afterLogin();
};

let entering = false;
async function afterLogin(){
  if (entering) return;
  entering = true;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if (!session){ me = null; showAuth(); return; }
    await loadMe();
    if (me){ showApp(); await boot(); }
    else { showAuth(); errEl('#authErr','Signed in, but your profile row is missing. Did you run supabase-schema.sql?'); }
  } finally { entering = false; }
}

async function loadMe(){
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { me = null; return; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error){ console.error(error); me = null; return; }
  me = data || null;
}

/* ============================== BOOT ================================== */
async function boot(){
  if (!me) return;
  paintAvatars();
  await Promise.all([ loadFollowing(), loadSaves() ]);
  await Promise.all([ loadStories(), loadFeed(), refreshBadges() ]);
  subscribeRealtime();
}

function paintAvatars(){
  ['#topAvatar','#navAvatar','#profPic','#editAvatar'].forEach(sel => {
    const el = $(sel); if (el) el.src = avatarOf(me);
  });
}

async function loadFollowing(){
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', me.id);
  myFollowing = new Set((data||[]).map(r => r.following_id));
}
async function loadSaves(){
  const { data } = await sb.from('saves').select('post_id').eq('user_id', me.id);
  mySaves = new Set((data||[]).map(r => r.post_id));
}

/* ============================== FEED ================================== */
async function loadFeed(){
  $('#feed').innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('posts')
    .select('id,user_id,image_url,caption,location,created_at, author:profiles(username,name,avatar_url), likes(user_id), comments(id)')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error){ console.error(error); $('#feed').innerHTML = `<div class="empty">Couldn't load posts.<br>${esc(error.message)}</div>`; return; }
  feed = (data||[]).map(p => ({
    ...p,
    likeCount: (p.likes||[]).length,
    liked: (p.likes||[]).some(l => l.user_id === me.id),
    commentCount: (p.comments||[]).length,
    saved: mySaves.has(p.id)
  }));
  renderFeed();
}

function renderFeed(){
  if (!feed.length){ $('#feed').innerHTML = `<div class="empty">No posts yet.<br>Tap <b>+</b> to share the first one.</div>`; return; }
  $('#feed').innerHTML = feed.map((p,i) => postHTML(p,i)).join('');
  wirePosts();
}

function postHTML(p, i){
  const a = p.author || {};
  const mine = p.user_id === me.id;
  return `<article class="card" data-i="${i}">
    <div class="phead">
      <span data-act="openuser" data-uid="${p.user_id}" style="cursor:pointer">${avatarImg(a)}</span>
      <div style="flex:1;min-width:0">
        <div class="nm" data-act="openuser" data-uid="${p.user_id}">${esc(a.username||'user')}</div>
        ${p.location ? `<div class="loc">${esc(p.location)}</div>` : ''}
      </div>
      <button class="more" data-act="more">${mine?'🗑':'⋯'}</button>
    </div>
    <div class="pimg">
      <img src="${esc(p.image_url)}" alt="post" loading="lazy">
      <div class="pop">${svgBigHeart()}</div>
    </div>
    <div class="pacts">
      <button class="ibtn ${p.liked?'heart-on':''}" data-act="like">${svgHeart(p.liked)}</button>
      <button class="ibtn" data-act="comment">${svgComment()}</button>
      <button class="ibtn" data-act="share">${svgShare()}</button>
      <button class="ibtn save" data-act="save" style="color:${p.saved?'var(--accent)':'inherit'}">${svgSave(p.saved)}</button>
    </div>
    <div class="plikes" data-role="likes">${fmt(p.likeCount)} ${p.likeCount===1?'like':'likes'}</div>
    ${p.caption ? `<div class="pcap"><b>${esc(a.username||'user')}</b>${esc(p.caption)}</div>` : ''}
    <div class="pcomments" data-act="comment">${p.commentCount ? `View all ${p.commentCount} comments` : 'Add a comment'}</div>
    <div class="ptime">${esc(timeAgo(p.created_at))}</div>
    <div class="cbar">
      <input placeholder="Add a comment..." data-role="cinput">
      <button data-act="postc">Post</button>
    </div>
  </article>`;
}

function wirePosts(){
  $$('#feed .card').forEach(card => {
    const p = feed[+card.dataset.i];
    const likeBtn = card.querySelector('[data-act="like"]');
    const saveBtn = card.querySelector('[data-act="save"]');
    const likesEl = card.querySelector('[data-role="likes"]');
    const pop = card.querySelector('.pop');

    async function toggleLike(){
      const on = !p.liked;
      p.liked = on; p.likeCount += on ? 1 : -1;
      likeBtn.classList.toggle('heart-on', on);
      likeBtn.innerHTML = svgHeart(on);
      likesEl.textContent = `${fmt(p.likeCount)} ${p.likeCount===1?'like':'likes'}`;
      if (on){ pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go'); }
      if (on){
        await sb.from('likes').insert({ post_id: p.id, user_id: me.id });
        if (p.user_id !== me.id) await notify(p.user_id, 'like', p.id);
      } else {
        await sb.from('likes').delete().eq('post_id', p.id).eq('user_id', me.id);
      }
    }
    likeBtn.onclick = toggleLike;
    card.querySelector('.pimg').addEventListener('dblclick', () => { if (!p.liked) toggleLike(); });

    saveBtn.onclick = async () => {
      p.saved = !p.saved;
      saveBtn.innerHTML = svgSave(p.saved);
      saveBtn.style.color = p.saved ? 'var(--accent)' : 'inherit';
      if (p.saved){ mySaves.add(p.id); await sb.from('saves').insert({ post_id: p.id, user_id: me.id }); toast('Saved'); }
      else { mySaves.delete(p.id); await sb.from('saves').delete().eq('post_id', p.id).eq('user_id', me.id); toast('Removed from saved'); }
    };

    card.querySelector('[data-act="share"]').onclick = async () => {
      const url = location.origin + location.pathname + '#post-' + p.id;
      try{
        if (navigator.share) await navigator.share({ title:'PariBari', text:'Check this post', url });
        else { await navigator.clipboard.writeText(url); toast('Link copied'); }
      }catch(_){}
    };

    card.querySelector('[data-act="more"]').onclick = async () => {
      if (p.user_id === me.id){
        if (!confirm('Delete this post?')) return;
        await sb.from('posts').delete().eq('id', p.id);
        feed = feed.filter(x => x.id !== p.id); renderFeed(); toast('Post deleted');
      } else {
        openUserModal(p.user_id);
      }
    };

    card.querySelectorAll('[data-act="openuser"]').forEach(el => el.onclick = () => openUserModal(p.user_id));
    card.querySelectorAll('[data-act="comment"]').forEach(el => el.onclick = () => openComments(p.id));

    const inp = card.querySelector('[data-role="cinput"]');
    const btn = card.querySelector('[data-act="postc"]');
    inp.oninput = () => btn.classList.toggle('on', inp.value.trim().length > 0);
    const add = async () => {
      const body = inp.value.trim(); if (!body) return;
      inp.value = ''; btn.classList.remove('on');
      const { error } = await sb.from('comments').insert({ post_id: p.id, user_id: me.id, body });
      if (error) return toast(error.message);
      p.commentCount++; card.querySelector('.pcomments').textContent = `View all ${p.commentCount} comments`;
      if (p.user_id !== me.id) await notify(p.user_id, 'comment', p.id);
      toast('Comment added');
    };
    btn.onclick = add;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  });
}

async function notify(user_id, type, post_id){
  await sb.from('notifications').insert({ user_id, actor_id: me.id, type, post_id: post_id || null });
}

/* ------------------------------ comments ------------------------------ */
async function openComments(postId){
  const body = $('#cModalBody');
  body.innerHTML = '<div class="spin"></div>';
  $('#cModal').classList.add('on');
  const { data, error } = await sb.from('comments')
    .select('id,body,created_at,user_id, author:profiles(username,name,avatar_url)')
    .eq('post_id', postId).order('created_at', { ascending: true });
  if (error){ body.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const listHTML = (rows) => rows.length
    ? rows.map(c => `<div class="row" style="padding:7px 0;align-items:flex-start;gap:10px">
        ${avatarImg(c.author)}
        <div style="flex:1"><b style="font-size:13.5px">${esc((c.author||{}).username||'user')}</b>
        <span style="font-size:13.5px">${esc(c.body)}</span>
        <div class="muted" style="font-size:11px">${esc(timeAgo(c.created_at))}</div></div>
      </div>`).join('')
    : '<div class="empty">No comments yet. Be the first!</div>';
  body.innerHTML = `<div style="max-height:44vh;overflow:auto">${listHTML(data||[])}</div>
    <div class="cbar" style="border:1px solid var(--border);border-radius:12px;margin-top:12px">
      <input id="mcInput" placeholder="Add a comment...">
      <button id="mcPost" class="on">Post</button>
    </div>`;
  const add = async () => {
    const v = $('#mcInput').value.trim(); if (!v) return;
    const { error } = await sb.from('comments').insert({ post_id: postId, user_id: me.id, body: v });
    if (error) return toast(error.message);
    $('#mcInput').value = '';
    const p = feed.find(x => x.id === postId);
    if (p){ p.commentCount++; }
    const { data: rows } = await sb.from('comments')
      .select('id,body,created_at,user_id, author:profiles(username,name,avatar_url)')
      .eq('post_id', postId).order('created_at', { ascending: true });
    body.querySelector('div').innerHTML = listHTML(rows||[]);
    const owner = (feed.find(x => x.id === postId) || {}).user_id;
    if (owner && owner !== me.id) await notify(owner, 'comment', postId);
    renderFeed();
    toast('Comment added');
  };
  $('#mcPost').onclick = add;
  $('#mcInput').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

/* ============================= EXPLORE ================================ */
async function loadExplore(){
  $('#exploreGrid').innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('posts')
    .select('id,image_url,user_id, likes(user_id), comments(id)')
    .order('created_at', { ascending: false }).limit(90);
  if (error){ $('#exploreGrid').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const rows = data||[];
  if (!rows.length){ $('#exploreGrid').innerHTML = '<div class="empty">Nothing here yet.</div>'; return; }
  $('#exploreGrid').innerHTML = rows.map(p => {
    const lc = (p.likes||[]).length, cc = (p.comments||[]).length;
    return `<div class="cell" data-uid="${p.user_id}"><img src="${esc(p.image_url)}" loading="lazy" alt="">
      <div class="ov"><span>♥ ${fmt(lc)}</span><span>💬 ${cc}</span></div></div>`;
  }).join('');
  $$('#exploreGrid .cell').forEach(c => c.onclick = () => openUserModal(c.dataset.uid));
}

/* ============================== STORIES =============================== */
async function loadStories(){
  const { data } = await sb.from('profiles').select('id,username,name,avatar_url').limit(20);
  const people = (data||[]).filter(p => p.id !== me.id).slice(0, 14);
  const cells = [`<div class="story" data-me="1">
      <div class="ring"><img src="${avatarOf(me)}" alt=""></div><small>Your story</small></div>`]
    .concat(people.map(p => `<div class="story" data-uid="${p.id}">
      <div class="ring"><img src="${avatarOf(p)}" alt=""></div><small>${esc(p.username)}</small></div>`));
  $('#stories').innerHTML = cells.join('');
  $$('#stories .story').forEach(el => el.onclick = () => {
    if (el.dataset.me) openCreate();
    else openUserModal(el.dataset.uid);
  });
}

/* ============================ CREATE POST ============================= */
let pendingBlob = null, camStream = null;

function openCreate(){ errEl('#createErr',''); $('#createModal').classList.add('on'); }
$('#newBtnTop').onclick = openCreate;
$('#newBtnNav').onclick = openCreate;
$$('[data-close]').forEach(b => b.onclick = () => { closeAllModals(); });
function closeAllModals(){
  $$('.modal').forEach(m => m.classList.remove('on'));
  stopCam();
}
$('#pickFile').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  pendingBlob = f; showPreview(URL.createObjectURL(f));
};

$('#pickCam').onclick = async () => {
  try{
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('#cam').srcObject = camStream;
    $('#camBox').classList.remove('hidden');
  }catch(err){ errEl('#createErr','Camera unavailable: '+err.message); }
};
function stopCam(){
  if (camStream){ camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  $('#camBox').classList.add('hidden');
}
$('#camCancel').onclick = stopCam;
$('#snapBtn').onclick = () => {
  const v = $('#cam');
  const c = document.createElement('canvas');
  c.width = v.videoWidth || 720; c.height = v.videoHeight || 720;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  c.toBlob(blob => { pendingBlob = blob; showPreview(URL.createObjectURL(blob)); stopCam(); }, 'image/jpeg', 0.9);
};
function showPreview(src){ $('#previewImg').src = src; $('#preview').classList.remove('hidden'); }

$('#shareBtn').onclick = async () => {
  errEl('#createErr','');
  if (!pendingBlob) return errEl('#createErr','Please choose or capture a photo first.');
  const btn = $('#shareBtn'); btn.disabled = true; btn.textContent = 'Uploading...';
  try{
    const path = `${me.id}/${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from('posts').upload(path, pendingBlob, { contentType: pendingBlob.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = sb.storage.from('posts').getPublicUrl(path);
    const { error } = await sb.from('posts').insert({
      user_id: me.id, image_url: publicUrl,
      caption: $('#capInput').value.trim(), location: $('#locInput').value.trim()
    });
    if (error) throw error;
    pendingBlob = null;
    $('#capInput').value = ''; $('#locInput').value = '';
    $('#preview').classList.add('hidden');
    closeAllModals(); go('home'); await loadFeed(); toast('Posted to PariBari 🎉');
  }catch(err){ errEl('#createErr', err.message); }
  btn.disabled = false; btn.textContent = 'Share';
};

/* ============================ USER MODAL ============================== */
async function openUserModal(uid){
  if (uid === me.id) return go('profile');
  const body = $('#userModalBody');
  body.innerHTML = '<div class="spin"></div>';
  $('#userModal').classList.add('on');
  const [{ data: p }, { data: posts }, { data: fCount }, { data: fwCount }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('posts').select('id,image_url').eq('user_id', uid).order('created_at',{ascending:false}).limit(9),
    sb.from('follows').select('follower_id').eq('following_id', uid),
    sb.from('follows').select('following_id').eq('follower_id', uid)
  ]);
  if (!p){ body.innerHTML = '<div class="empty">Profile not found.</div>'; return; }
  const following = myFollowing.has(uid);
  body.innerHTML = `
    <div class="row" style="gap:16px;align-items:center">
      <div class="prof" style="padding:0"><div class="pic" style="width:74px;height:74px">${avatarImg(p)}</div></div>
      <div style="flex:1">
        <h2 style="margin:0 0 4px;font-size:18px;font-weight:600">${esc(p.username)}</h2>
        <div class="muted" style="font-size:13px">${esc(p.name||'')}</div>
      </div>
    </div>
    <div class="stats" style="margin-top:14px">
      <div><b>${(posts||[]).length}</b> posts</div>
      <div><b>${fmt((fCount||[]).length)}</b> followers</div>
      <div><b>${fmt((fwCount||[]).length)}</b> following</div>
    </div>
    ${p.bio ? `<div class="bio" style="margin:8px 0 14px">${esc(p.bio)}</div>` : ''}
    <div class="row" style="gap:8px">
      <button class="btn ${following?'':'primary'}" id="followBtn" style="flex:1">${following?'Following':'Follow'}</button>
      <button class="btn" id="msgBtn" style="flex:1">Message</button>
    </div>
    <div class="grid" style="margin-top:16px">
      ${(posts||[]).map(x => `<div class="cell"><img src="${esc(x.image_url)}" loading="lazy" alt=""></div>`).join('')}
    </div>`;
  $('#followBtn').onclick = async () => {
    if (myFollowing.has(uid)){
      await sb.from('follows').delete().eq('follower_id', me.id).eq('following_id', uid);
      myFollowing.delete(uid);
      $('#followBtn').textContent = 'Follow'; $('#followBtn').classList.add('primary');
      toast('Unfollowed');
    } else {
      await sb.from('follows').insert({ follower_id: me.id, following_id: uid });
      myFollowing.add(uid);
      $('#followBtn').textContent = 'Following'; $('#followBtn').classList.remove('primary');
      await notify(uid, 'follow', null);
      toast('Following @'+p.username);
    }
  };
  $('#msgBtn').onclick = () => { closeAllModals(); openChat(uid); };
}

/* ================================ DMs ================================= */
let dmPeople = [], chatPeer = null, dmChannel = null;

async function loadDMs(){
  const view = $('#view-dms');
  if (chatPeer){ return; }              // keep an open chat on screen
  $('#dmChat').classList.add('hidden'); $('#dmList').classList.remove('hidden');
  $('#dmList').innerHTML = '<div class="spin"></div>';
  const { data: msgs } = await sb.from('messages')
    .select('sender_id,receiver_id,body,created_at')
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
    .order('created_at', { ascending: false }).limit(300);
  const seen = new Map();
  (msgs||[]).forEach(m => {
    const other = m.sender_id === me.id ? m.receiver_id : m.sender_id;
    if (!seen.has(other)) seen.set(other, m);
  });
  const ids = [...seen.keys()];
  let profMap = {};
  if (ids.length){
    const { data: profs } = await sb.from('profiles').select('id,username,name,avatar_url').in('id', ids);
    (profs||[]).forEach(p => profMap[p.id] = p);
  }
  dmPeople = ids.map(id => ({ profile: profMap[id] || {id, username:'user'}, last: seen.get(id) }));
  const listEl = $('#dmList');
  if (!dmPeople.length){
    listEl.innerHTML = '<div class="empty">No conversations yet.<br>Open someone\'s profile and tap <b>Message</b> to start one.</div>';
    return;
  }
  listEl.innerHTML = dmPeople.map((d,i) => `<div class="person" data-i="${i}" style="cursor:pointer">
      ${avatarImg(d.profile)}
      <div class="meta"><div class="h">${esc(d.profile.username)}</div>
      <div class="s">${esc(d.last.body)}</div></div>
      <div class="when muted" style="font-size:11.5px">${esc(timeAgo(d.last.created_at))}</div>
    </div>`).join('');
  $$('#dmList .person').forEach(el => el.onclick = () => openChat(dmPeople[+el.dataset.i].profile.id));
}

async function openChat(uid){
  chatPeer = uid;
  markDMsSeen(); refreshBadges();
  $('#dmList').classList.add('hidden'); $('#dmChat').classList.remove('hidden');
  const { data: p } = await sb.from('profiles').select('id,username,name,avatar_url').eq('id', uid).maybeSingle();
  chatPeerProfile = p || { id: uid, username:'user' };
  $('#dmChat').innerHTML = `
    <div class="chatwrap">
      <div class="chathead">
        <button class="ibtn" id="chatBack">←</button>
        ${avatarImg(chatPeerProfile)}
        <div><div style="font-size:14px;font-weight:600">${esc(chatPeerProfile.username)}</div></div>
      </div>
      <div class="chatbody" id="chatBody"></div>
      <div class="chatinput">
        <input id="chatMsg" placeholder="Message...">
        <button class="btn primary" id="chatSend">Send</button>
      </div>
    </div>`;
  $('#chatBack').onclick = () => { chatPeer = null; closeChatChannel(); loadDMs(); };
  await renderChat();
  $('#chatSend').onclick = sendChat;
  $('#chatMsg').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  openChatChannel();
}
let chatPeerProfile = null;

async function renderChat(){
  const { data, error } = await sb.from('messages')
    .select('id,sender_id,receiver_id,body,created_at')
    .or(`and(sender_id.eq.${me.id},receiver_id.eq.${chatPeer}),and(sender_id.eq.${chatPeer},receiver_id.eq.${me.id})`)
    .order('created_at', { ascending: true }).limit(500);
  const body = $('#chatBody');
  if (!body) return;
  if (error){ body.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  body.innerHTML = (data||[]).map(m =>
    `<div class="bub ${m.sender_id===me.id?'me':'them'}">${esc(m.body)}</div>`).join('')
    || '<div class="empty">Say hi 👋</div>';
  body.scrollTop = body.scrollHeight;
}

async function sendChat(){
  const inp = $('#chatMsg'); const v = inp.value.trim(); if (!v) return;
  inp.value = '';
  const { error } = await sb.from('messages').insert({ sender_id: me.id, receiver_id: chatPeer, body: v });
  if (error) return toast(error.message);
  await notify(chatPeer, 'message', null);
  await renderChat();
}

function openChatChannel(){
  closeChatChannel();
  dmChannel = sb.channel('chat-'+chatPeer+'-'+Date.now())
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const m = payload.new;
      if (!m) return;
      const pair = (m.sender_id===me.id && m.receiver_id===chatPeer) || (m.sender_id===chatPeer && m.receiver_id===me.id);
      if (pair && chatPeer) renderChat();
    }).subscribe();
}
function closeChatChannel(){ if (dmChannel){ sb.removeChannel(dmChannel); dmChannel = null; } }

/* =========================== NOTIFICATIONS ============================ */
async function loadNotifs(){
  const el = $('#notifList');
  el.innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('notifications')
    .select('id,type,post_id,read,created_at, actor:profiles!notifications_actor_id_fkey(username,name,avatar_url), post:posts(image_url)')
    .eq('user_id', me.id).order('created_at', { ascending:false }).limit(60);
  if (error){ el.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const rows = data||[];
  if (!rows.length){ el.innerHTML = '<div class="empty">No notifications yet.</div>'; return; }
  const verb = { like:'liked your post', comment:'commented on your post', follow:'started following you', message:'sent you a message' };
  el.innerHTML = rows.map(n => {
    const a = n.actor || {};
    return `<div class="notif ${n.read?'':'unread'}" data-uid="${a.id||''}" data-post="${n.post_id||''}">
      ${avatarImg(a)}
      <div class="t"><b>${esc(a.username||'someone')}</b> ${esc(verb[n.type]||n.type)}
        <div class="when">${esc(timeAgo(n.created_at))}</div></div>
      ${n.post && n.post.image_url ? `<img class="thumb" src="${esc(n.post.image_url)}" alt="">` : ''}
    </div>`;
  }).join('');
  $$('#notifList .notif').forEach(el2 => el2.onclick = () => {
    if (el2.dataset.uid) openUserModal(el2.dataset.uid);
  });
  await sb.from('notifications').update({ read: true }).eq('user_id', me.id).eq('read', false);
  refreshBadges();
}

function dmSeenAt(){ return Number(localStorage.getItem('paribari_dm_seen') || 0); }
function markDMsSeen(){ localStorage.setItem('paribari_dm_seen', String(Date.now())); }

async function refreshBadges(){
  const [{ count: nCount }, { count: mCount }] = await Promise.all([
    sb.from('notifications').select('*', { count:'exact', head:true }).eq('user_id', me.id).eq('read', false),
    sb.from('messages').select('*', { count:'exact', head:true })
      .eq('receiver_id', me.id).gt('created_at', new Date(dmSeenAt()).toISOString())
  ]);
  const nb = $('#notifBadge'), db = $('#dmBadge');
  if (nCount){ nb.textContent = fmt(nCount); nb.classList.remove('hidden'); } else nb.classList.add('hidden');
  if (mCount){ db.textContent = fmt(mCount); db.classList.remove('hidden'); } else db.classList.add('hidden');
}

/* ============================== PROFILE =============================== */
let profTab = 'posts';
async function loadProfile(){
  paintAvatars();
  $('#profName').textContent = '@' + me.username;
  $('#profBio').innerHTML = `<span class="nm">${esc(me.name||'')}</span>\n${esc(me.bio||'')}`;
  const [{ count: postsCount }, { data: fw }, { data: fwr }, gridQ] = await Promise.all([
    sb.from('posts').select('*', { count:'exact', head:true }).eq('user_id', me.id),
    sb.from('follows').select('following_id').eq('follower_id', me.id),
    sb.from('follows').select('follower_id').eq('following_id', me.id),
    profTab === 'saved'
      ? sb.from('saves').select('post_id, post:posts(id,image_url,likes(user_id))').eq('user_id', me.id).order('created_at',{ascending:false})
      : sb.from('posts').select('id,image_url,likes(user_id)').eq('user_id', me.id).order('created_at',{ascending:false})
  ]);
  $('#statPosts').textContent = postsCount || 0;
  $('#statFollowers').textContent = fmt((fwr||[]).length);
  $('#statFollowing').textContent = fmt((fw||[]).length);
  const items = profTab === 'saved'
    ? (gridQ.data||[]).map(r => r.post).filter(Boolean)
    : (gridQ.data||[]);
  const grid = $('#profGrid');
  if (!items.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${profTab==='saved'?'No saved posts yet.':'No posts yet.'}</div>`;
    return;
  }
  grid.innerHTML = items.map(p => {
    const lc = (p.likes||[]).length;
    return `<div class="cell" data-pid="${p.id}"><img src="${esc(p.image_url)}" loading="lazy" alt="">
      <div class="ov"><span>♥ ${fmt(lc)}</span></div></div>`;
  }).join('');
  $$('#profGrid .cell').forEach(c => c.onclick = () => openComments(c.dataset.pid));
}
$$('[data-ptab]').forEach(t => t.onclick = () => {
  profTab = t.dataset.ptab;
  $$('[data-ptab]').forEach(x => x.classList.toggle('on', x === t));
  loadProfile();
});

$('#editBioBtn').onclick = () => {
  $('#bioName').value = me.name||''; $('#bioUser').value = me.username||''; $('#bioText').value = me.bio||'';
  $('#editAvatar').src = avatarOf(me); errEl('#bioErr','');
  $('#bioModal').classList.add('on');
};
$('#changeAvatar').onclick = () => $('#avatarInput').click();
$('#avatarInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const path = `${me.id}/avatar.jpg`;
  const { error } = await sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type||'image/jpeg' });
  if (error) return errEl('#bioErr', error.message);
  const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
  const url = publicUrl + '?t=' + Date.now();
  const { error: e2 } = await sb.from('profiles').update({ avatar_url: url }).eq('id', me.id);
  if (e2) return errEl('#bioErr', e2.message);
  me.avatar_url = url; $('#editAvatar').src = url; paintAvatars(); toast('Photo updated');
};
$('#saveBio').onclick = async () => {
  errEl('#bioErr','');
  const username = $('#bioUser').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const { error } = await sb.from('profiles')
    .update({ name: $('#bioName').value.trim(), username, bio: $('#bioText').value })
    .eq('id', me.id);
  if (error) return errEl('#bioErr', error.message);
  Object.assign(me, { name: $('#bioName').value.trim(), username, bio: $('#bioText').value });
  closeAllModals(); loadProfile(); toast('Profile updated');
};
$('#logoutBtn').onclick = async () => {
  if (!confirm('Sign out of PariBari?')) return;
  closeChatChannel();
  await sb.auth.signOut();
  me = null; showAuth();
};

/* ============================== SEARCH ================================ */
$('#searchInput').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) return;
  const { data } = await sb.from('profiles').select('id,username,name,avatar_url')
    .ilike('username', `%${q}%`).limit(20);
  const rows = (data||[]).filter(p => p.id !== me.id);
  if (!rows.length) return toast('No people found for "'+q+'"');
  const body = $('#userModalBody');
  $('#userModal').classList.add('on');
  body.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:8px">Results for "${esc(q)}"</div>` +
    rows.map(p => `<div class="person" data-uid="${p.id}" style="cursor:pointer">
      ${avatarImg(p)}<div class="meta"><div class="h">${esc(p.username)}</div>
      <div class="s">${esc(p.name||'')}</div></div></div>`).join('');
  $$('#userModalBody .person').forEach(el => el.onclick = () => openUserModal(el.dataset.uid));
});

/* ============================ NAVIGATION ============================== */
let currentView = 'home';
function go(v){
  currentView = v;
  $$('.view').forEach(x => x.classList.remove('on'));
  $('#view-'+v).classList.add('on');
  $$('nav.bottom .ibtn[data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === v));
  window.scrollTo({ top:0, behavior:'smooth' });
  if (v === 'explore') loadExplore();
  if (v === 'profile') loadProfile();
  if (v === 'dms'){ markDMsSeen(); loadDMs(); refreshBadges(); }
  if (v === 'notifs') loadNotifs();
  if (v !== 'dms'){ chatPeer = null; closeChatChannel(); }
}
$$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));

/* ============================= REALTIME =============================== */
function subscribeRealtime(){
  if (realtimeCh) sb.removeChannel(realtimeCh);
  realtimeCh = sb.channel('paribari-'+me.id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${me.id}` }, () => {
      refreshBadges();
      if (currentView === 'notifs') loadNotifs();
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`receiver_id=eq.${me.id}` }, payload => {
      refreshBadges();
      if (chatPeer && payload.new && payload.new.sender_id === chatPeer) renderChat();
      else if (currentView === 'dms') loadDMs();
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'posts' }, () => {
      if (currentView === 'home') loadFeed();
      if (currentView === 'explore') loadExplore();
    })
    .subscribe();
}

/* ============================== ICONS ================================= */
function svgHeart(f){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.9"><path d="M12 21s-7.5-4.7-9.6-9.2C.9 8.4 2.7 5 6.2 5c2 0 3.3 1.1 4 2.2.6-1.1 2-2.2 4-2.2 3.5 0 5.3 3.4 3.8 6.8C19.5 16.3 12 21 12 21Z"/></svg>`; }
function svgComment(){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/></svg>`; }
function svgShare(){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>`; }
function svgSave(f){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.9"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>`; }
function svgBigHeart(){ return `<svg width="96" height="96" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.7-9.6-9.2C.9 8.4 2.7 5 6.2 5c2 0 3.3 1.1 4 2.2.6-1.1 2-2.2 4-2.2 3.5 0 5.3 3.4 3.8 6.8C19.5 16.3 12 21 12 21Z"/></svg>`; }

/* ============================== PWA =================================== */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').classList.remove('hidden'); });
$('#installBtn').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null;
  $('#installBtn').classList.add('hidden');
};
if ('serviceWorker' in navigator){ window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{})); }

/* ============================ ENTRYPOINT ============================== */
/* Runs last, after every declaration above is initialised. */
if (!configured){ $('#setup').classList.remove('hidden'); }
else { start(); }
