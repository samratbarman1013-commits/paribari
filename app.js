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
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme');
  const nx  = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nx);
  localStorage.setItem('paribari_theme', nx);
}
const themeBtnEl = $('#themeBtn');
if (themeBtnEl) themeBtnEl.onclick = toggleTheme;

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
  sb.auth.onAuthStateChange((evt) => {
    if (evt === 'SIGNED_OUT'){ me = null; showAuth(); }
  });
  (async () => {
    try{
      const { data: { session } } = await sb.auth.getSession();
      if (session) await afterLogin();
      else showAuth();
    }catch(e){ console.error(e); }
  })();
}

/* =============================== AUTH ================================= */
function showAuth(){ $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function showApp(){ $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$('#tabIn').onclick = ()=>{ $('#tabIn').classList.add('on'); $('#tabUp').classList.remove('on');
  $('#formIn').classList.remove('hidden'); $('#formUp').classList.add('hidden'); errEl('#authErr',''); errEl('#authOk',''); };
$('#tabUp').onclick = ()=>{ $('#tabUp').classList.add('on'); $('#tabIn').classList.remove('on');
  $('#formUp').classList.remove('hidden'); $('#formIn').classList.add('hidden'); errEl('#authErr',''); errEl('#authOk',''); };

$('#formIn').onsubmit = async (e) => {
  e.preventDefault(); errEl('#authErr',''); errEl('#authOk','');
  const email = $('#inEmail').value.trim(), pass = $('#inPass').value;
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in...';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) errEl('#authErr', error.message);
  else await afterLogin();
};

$('#formUp').onsubmit = async (e) => {
  e.preventDefault(); errEl('#authErr',''); errEl('#authOk','');
  const name = $('#upName').value.trim();
  const username = $('#upUser').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const email = $('#upEmail').value.trim(), pass = $('#upPass').value;
  if (!username) return errEl('#authErr','Please choose a username (letters, numbers, underscore).');
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating...';
  const { data, error } = await sb.auth.signUp({
    email, password: pass,
    options: { data: { username, name } }
  });
  btn.disabled = false; btn.textContent = 'Create account';
  if (error) return errEl('#authErr', error.message);
  if (data.session) { await afterLogin(); }
  else errEl('#authOk','Account created! Check your email to confirm, then sign in.');
};

async function afterLogin(){
  await loadMe();
  if (me){ showApp(); await boot(); }
  else { errEl('#authErr','Signed in, but your profile row is missing. Did you run supabase-schema.sql?'); }
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
  await Promise.all([ loadStories(), loadNotes(), loadFeed(), refreshBadges() ]);
  subscribeRealtime();
}

function paintAvatars(){
  ['#topAvatar','#navAvatar','#sideAvatar','#profPic','#editAvatar'].forEach(sel => {
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

/* ---------------- v2 helpers: linkify, carousel, post detail ---------- */
function linkify(text){
  return esc(text || '')
    .replace(/(^|\s)#([A-Za-z0-9_]+)/g, '$1<a href="#" data-tag="$2">#$2</a>')
    .replace(/(^|\s)@([A-Za-z0-9_]+)/g, '$1<a href="#" data-mention="$2">@$2</a>');
}

function mediaHTML(p){
  const media = (p.media && p.media.length) ? p.media : [{ url: p.image_url, media_type: 'image' }];
  if (media.length === 1){
    const m = media[0];
    return m.media_type === 'video'
      ? `<video src="${esc(m.url)}" playsinline loop muted controls></video>`
      : `<img src="${esc(m.url)}" alt="post" loading="lazy">`;
  }
  return `<div class="caro">
    ${media.map((m, i) => `<div class="slide ${i === 0 ? 'on' : ''}">${
      m.media_type === 'video'
        ? `<video src="${esc(m.url)}" playsinline loop muted controls></video>`
        : `<img src="${esc(m.url)}" alt="" loading="lazy">`
    }</div>`).join('')}
    <div class="dots">${media.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
    <span class="badge2">1/${media.length}</span>
    <button class="nav prev" data-caroprev>‹</button>
    <button class="nav next" data-caronext>›</button>
  </div>`;
}

function wireCarousels(scope){
  scope.querySelectorAll('.caro').forEach(caro => {
    const slides = Array.from(caro.querySelectorAll('.slide'));
    if (slides.length < 2) return;
    let idx = 0;
    const dots = Array.from(caro.querySelectorAll('.dots i'));
    const badge = caro.querySelector('.badge2');
    const show = (n) => {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('on', i === idx));
      dots.forEach((d, i) => d.classList.toggle('on', i === idx));
      if (badge) badge.textContent = (idx + 1) + '/' + slides.length;
    };
    const prev = caro.querySelector('[data-caroprev]');
    const next = caro.querySelector('[data-caronext]');
    if (prev) prev.onclick = (e) => { e.stopPropagation(); show(idx - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); show(idx + 1); };
  });
}

/* global click handler for #hashtags and @mentions */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tag]');
  if (t){ e.preventDefault(); openHashtag(t.dataset.tag); return; }
  const m = e.target.closest('[data-mention]');
  if (m){ e.preventDefault(); openMention(m.dataset.mention); return; }
});

/* ============================ POST DETAIL ============================= */
let currentPost = null;

async function openPost(postId){
  let p = feed.find(x => x.id === postId);
  if (!p){
    const { data } = await sb.from('posts')
      .select('id,user_id,image_url,caption,location,created_at, author:profiles(username,name,avatar_url), likes(user_id), comments(id), post_media(url,media_type,position)')
      .eq('id', postId).maybeSingle();
    if (!data) return toast('Post not found');
    p = { ...data,
      media: (data.post_media || []).slice().sort((a,b) => a.position - b.position).map(m => ({ url:m.url, media_type:m.media_type })),
      likeCount: (data.likes||[]).length, liked: (data.likes||[]).some(l => l.user_id === me.id),
      commentCount: (data.comments||[]).length, saved: mySaves.has(data.id) };
  }
  currentPost = p;
  const a = p.author || {};
  $('#pvMedia').innerHTML = mediaHTML(p);
  wireCarousels($('#pvMedia'));
  $('#pvHead').innerHTML = `<span data-uid="${p.user_id}" style="cursor:pointer">${avatarImg(a)}</span>
    <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600">${esc(a.username||'user')}</div>
    ${p.location ? `<div class="muted" style="font-size:11.5px">${esc(p.location)}</div>` : ''}</div>`;
  $('#pvHead').querySelector('[data-uid]').onclick = () => { closePost(); openUserModal(p.user_id); };
  $('#pvActions').innerHTML = `
    <div class="pacts">
      <button class="ibtn ${p.liked?'heart-on':''}" id="pvLike">${svgHeart(p.liked)}</button>
      <button class="ibtn" id="pvComment">${svgComment()}</button>
      <button class="ibtn" id="pvShare">${svgShare()}</button>
      <button class="ibtn save" id="pvSave" style="color:${p.saved?'var(--accent)':'inherit'}">${svgSave(p.saved)}</button>
    </div>
    <div class="plikes" id="pvLikes">${fmt(p.likeCount)} ${p.likeCount===1?'like':'likes'}</div>
    ${p.caption ? `<div class="pcap"><b>${esc(a.username||'user')}</b>${linkify(p.caption)}</div>` : ''}
    <div class="ptime">${esc(timeAgo(p.created_at))}</div>`;
  $('#pvLike').onclick = async () => {
    const on = !p.liked; p.liked = on; p.likeCount += on ? 1 : -1;
    $('#pvLike').classList.toggle('heart-on', on);
    $('#pvLike').innerHTML = svgHeart(on);
    $('#pvLikes').textContent = `${fmt(p.likeCount)} ${p.likeCount===1?'like':'likes'}`;
    if (on){ await sb.from('likes').insert({ post_id: p.id, user_id: me.id }); if (p.user_id !== me.id) await notify(p.user_id, 'like', p.id); }
    else { await sb.from('likes').delete().eq('post_id', p.id).eq('user_id', me.id); }
    loadFeed();
  };
  $('#pvSave').onclick = async () => {
    p.saved = !p.saved;
    $('#pvSave').innerHTML = svgSave(p.saved);
    $('#pvSave').style.color = p.saved ? 'var(--accent)' : 'inherit';
    if (p.saved){ mySaves.add(p.id); await sb.from('saves').insert({ post_id:p.id, user_id:me.id }); toast('Saved'); }
    else { mySaves.delete(p.id); await sb.from('saves').delete().eq('post_id',p.id).eq('user_id',me.id); toast('Removed from saved'); }
  };
  $('#pvShare').onclick = () => openShareSheet(p.id);
  $('#pvComment').onclick = () => $('#pvInput').focus();
  $('#pvInput').value = '';
  $('#postView').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  await renderPostComments();
}

function closePost(){
  $('#postView').classList.add('hidden');
  $('#pvMedia').innerHTML = ''; $('#pvComments').innerHTML = '';
  document.body.style.overflow = '';
}
$('#pvClose').onclick = closePost;
$('#postView').onclick = (e) => { if (e.target.id === 'postView') closePost(); };
$('#pvPost').onclick = async () => {
  const v = $('#pvInput').value.trim(); if (!v || !currentPost) return;
  $('#pvInput').value = '';
  const { error } = await sb.from('comments').insert({ post_id: currentPost.id, user_id: me.id, body: v });
  if (error) return toast(error.message);
  currentPost.commentCount++;
  if (currentPost.user_id !== me.id) await notify(currentPost.user_id, 'comment', currentPost.id);
  await renderPostComments();
};
$('#pvInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pvPost').click(); });

/* ============================== FEED ================================== */
async function loadFeed(){
  $('#feed').innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('posts')
    .select('id,user_id,image_url,caption,location,created_at, author:profiles(username,name,avatar_url), likes(user_id), comments(id), post_media(url,media_type,position)')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error){ console.error(error); $('#feed').innerHTML = `<div class="empty">Couldn't load posts.<br>${esc(error.message)}</div>`; return; }
  feed = (data||[]).map(p => ({
    ...p,
    media: (p.post_media || []).slice().sort((a,b) => a.position - b.position).map(m => ({ url: m.url, media_type: m.media_type })),
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
    <div class="pimg" data-act="openpost">
      ${mediaHTML(p)}
      <div class="pop">${svgBigHeart()}</div>
    </div>
    <div class="pacts">
      <button class="ibtn ${p.liked?'heart-on':''}" data-act="like">${svgHeart(p.liked)}</button>
      <button class="ibtn" data-act="comment">${svgComment()}</button>
      <button class="ibtn" data-act="share">${svgShare()}</button>
      <button class="ibtn save" data-act="save" style="color:${p.saved?'var(--accent)':'inherit'}">${svgSave(p.saved)}</button>
    </div>
    <div class="plikes" data-role="likes">${fmt(p.likeCount)} ${p.likeCount===1?'like':'likes'}</div>
    ${p.caption ? `<div class="pcap"><b>${esc(a.username||'user')}</b>${linkify(p.caption)}</div>` : ''}
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
    wireCarousels(card);
    card.querySelectorAll('[data-act="openpost"]').forEach(el => el.onclick = (e) => {
      if (e.target.closest('.nav')) return;
      openPost(p.id);
    });
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
/* --------------------- comments (likes + replies) -------------------- */
let pendingReplyTo = null;

async function renderCommentsInto(container, postId){
  if (!container) return [];
  const { data, error } = await sb.from('comments')
    .select('id,body,created_at,user_id,parent_id, author:profiles(username,name,avatar_url), comment_likes(user_id)')
    .eq('post_id', postId).order('created_at', { ascending: true });
  if (error){ container.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return []; }
  const rows = data || [];
  const tops = rows.filter(c => !c.parent_id);
  const kids = rows.filter(c => c.parent_id);
  const itemHTML = (c, isReply) => {
    const likes = (c.comment_likes || []).length;
    const liked = (c.comment_likes || []).some(l => l.user_id === me.id);
    return `<div class="citem ${isReply ? 'creply' : ''}" data-cid="${c.id}">
      ${avatarImg(c.author, 'av')}
      <div class="cbody">
        <b>${esc((c.author||{}).username || 'user')}</b>${linkify(c.body)}
        <div class="cmeta">
          <span>${esc(timeAgo(c.created_at))}</span>
          ${likes ? `<span>${likes} ${likes === 1 ? 'like' : 'likes'}</span>` : ''}
          <button data-act="reply" data-cid="${c.id}" data-u="${esc((c.author||{}).username || '')}">Reply</button>
        </div>
      </div>
      <button class="cheart ${liked ? 'liked' : ''}" data-act="clike" data-cid="${c.id}">${svgHeart(liked)}</button>
    </div>`;
  };
  container.innerHTML = rows.length
    ? tops.map(c => itemHTML(c, false) + kids.filter(k => k.parent_id === c.id).map(k => itemHTML(k, true)).join('')).join('')
    : '<div class="empty">No comments yet. Be the first!</div>';
  container.querySelectorAll('[data-act="clike"]').forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    const on = !b.classList.contains('liked');
    b.classList.toggle('liked', on);
    b.innerHTML = svgHeart(on);
    if (on) await sb.from('comment_likes').insert({ comment_id: cid, user_id: me.id });
    else await sb.from('comment_likes').delete().eq('comment_id', cid).eq('user_id', me.id);
  });
  container.querySelectorAll('[data-act="reply"]').forEach(b => b.onclick = () => {
    const box = $('#postView').classList.contains('hidden') ? $('#mcInput') : $('#pvInput');
    if (box){ box.value = '@' + b.dataset.u + ' '; box.focus(); }
    pendingReplyTo = b.dataset.cid;
  });
  return rows;
}

async function renderPostComments(){
  if (!currentPost) return;
  const rows = await renderCommentsInto($('#pvComments'), currentPost.id);
  currentPost.commentCount = (rows || []).length;
}

async function postComment(postId, inputSel, listSel){
  const inp = $(inputSel);
  const v = (inp && inp.value.trim()) || '';
  if (!v) return;
  const parent = pendingReplyTo; pendingReplyTo = null;
  if (inp) inp.value = '';
  const { error } = await sb.from('comments').insert({ post_id: postId, user_id: me.id, body: v, parent_id: parent });
  if (error) return toast(error.message);
  const owner = (feed.find(x => x.id === postId) || {}).user_id;
  if (owner && owner !== me.id) await notify(owner, 'comment', postId);
  if (currentPost && currentPost.id === postId && !$('#postView').classList.contains('hidden')) await renderPostComments();
  else if (listSel) await renderCommentsInto($(listSel), postId);
  loadFeed();
  toast('Comment added');
}

async function openComments(postId){
  const body = $('#cModalBody');
  $('#cModal').classList.add('on');
  body.innerHTML = `<div id="cList" style="max-height:50vh;overflow:auto"></div>
    <div class="cbar" style="border:1px solid var(--border);border-radius:12px;margin-top:14px">
      <input id="mcInput" placeholder="Add a comment...">
      <button id="mcPost" class="on">Post</button>
    </div>`;
  await renderCommentsInto($('#cList'), postId);
  $('#mcPost').onclick = () => postComment(postId, '#mcInput', '#cList');
  $('#mcInput').addEventListener('keydown', e => { if (e.key === 'Enter') postComment(postId, '#mcInput', '#cList'); });
}

/* ============================ SEARCH / TAGS =========================== */
let searchTab = 'top', searchQuery = '', searchDebounce = null;

$$('#searchTabs button').forEach(b => b.onclick = () => {
  $$('#searchTabs button').forEach(x => x.classList.toggle('on', x === b));
  searchTab = b.dataset.stab;
  runSearch();
});
$('#exploreSearch').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 250);
});

function postTile(p){
  const first = (p.post_media || []).slice().sort((a,b) => a.position - b.position)[0] || { url: p.image_url, media_type: 'image' };
  const lc = (p.likes || []).length;
  return `<div class="cell" data-pid="${p.id}">
    ${first.media_type === 'video'
      ? `<video src="${esc(first.url)}" muted playsinline></video>`
      : `<img src="${esc(first.url)}" loading="lazy" alt="">`}
    <div class="ov"><span>♥ ${fmt(lc)}</span></div></div>`;
}
function personRows(people){
  if (!people.length) return '<div class="empty">No people found.</div>';
  return people.map(p => `<div class="person" data-uid="${p.id}" style="cursor:pointer">
      ${avatarImg(p)}<div class="meta"><div class="h">${esc(p.username)}</div>
      <div class="s">${esc(p.name || '')}</div></div></div>`).join('');
}

async function runSearch(){
  const box = $('#searchResults');
  if (!searchQuery){
    box.innerHTML = '';
    $('#exploreGrid').classList.remove('hidden');
    $('#followSuggest').classList.remove('hidden');
    return;
  }
  $('#exploreGrid').classList.add('hidden');
  $('#followSuggest').classList.add('hidden');
  box.innerHTML = '<div class="spin"></div>';
  const q = searchQuery.replace(/^#/, '');

  if (searchTab === 'people'){
    const { data } = await sb.from('profiles').select('id,username,name,avatar_url')
      .or(`username.ilike.%${q}%,name.ilike.%${q}%`).limit(30);
    box.innerHTML = personRows((data || []).filter(p => p.id !== me.id));
    $$('#searchResults .person').forEach(el => el.onclick = () => openUserModal(el.dataset.uid));
    return;
  }

  const [{ data: profs }, { data: posts }] = await Promise.all([
    sb.from('profiles').select('id,username,name,avatar_url').ilike('username', `%${q}%`).limit(8),
    sb.from('posts').select('id,image_url,caption,user_id, post_media(url,media_type,position), likes(user_id)')
      .ilike('caption', `%${q}%`).limit(30)
  ]);
  const people = (profs || []).filter(p => p.id !== me.id);
  const list = posts || [];

  if (searchTab === 'tags'){
    box.innerHTML = list.length
      ? `<div class="tagrow" data-taggo="${esc(q)}"><div class="tav">#</div>
           <div class="tmeta"><div class="h">#${esc(q)}</div>
           <div class="s">${list.length} ${list.length === 1 ? 'post' : 'posts'}</div></div></div>`
      : '<div class="empty">No posts with that hashtag yet.</div>';
    box.querySelectorAll('[data-taggo]').forEach(el => el.onclick = () => openHashtag(el.dataset.taggo));
    return;
  }

  box.innerHTML = (people.length ? personRows(people) : '') +
    (list.length ? `<div class="grid" style="margin-top:14px">${list.map(postTile).join('')}</div>`
                 : (people.length ? '' : '<div class="empty">Nothing found.</div>'));
  $$('#searchResults .person').forEach(el => el.onclick = () => openUserModal(el.dataset.uid));
  $$('#searchResults .cell').forEach(el => el.onclick = () => openPost(el.dataset.pid));
}

async function openHashtag(tag){
  go('explore');
  $('#exploreSearch').value = '#' + tag;
  searchQuery = '#' + tag;
  searchTab = 'tags';
  $$('#searchTabs button').forEach(x => x.classList.toggle('on', x.dataset.stab === 'tags'));
  await runSearch();
}

async function openMention(username){
  const { data } = await sb.from('profiles').select('id,username,name,avatar_url').ilike('username', username).limit(1);
  if (data && data[0]) openUserModal(data[0].id);
  else toast('No user @' + username);
}

/* ============================ SHARE SHEET ============================= */
async function openShareSheet(postId){
  const body = $('#shareBody');
  body.innerHTML = '<div class="spin"></div>';
  $('#shareModal').classList.add('on');
  const { data } = await sb.from('profiles').select('id,username,name,avatar_url').limit(60);
  const people = (data || []).filter(p => p.id !== me.id);
  if (!people.length){ body.innerHTML = '<div class="empty">Follow someone first to share with them.</div>'; return; }
  body.innerHTML = people.map(p => `<div class="person" data-uid="${p.id}" style="cursor:pointer">
      ${avatarImg(p)}<div class="meta"><div class="h">${esc(p.username)}</div>
      <div class="s">${esc(p.name || '')}</div></div>
      <button class="btn primary" data-act="send">Send</button></div>`).join('');
  $$('#shareBody .person').forEach(el => el.onclick = (e) => {
    if (e.target.closest('button')) return;
    sendPost(el.dataset.uid, postId);
  });
  $$('#shareBody [data-act="send"]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    sendPost(b.closest('.person').dataset.uid, postId);
  });
}
async function sendPost(uid, postId){
  const { error } = await sb.from('messages').insert({ sender_id: me.id, receiver_id: uid, body: '', shared_post_id: postId });
  if (error) return toast(error.message);
  await notify(uid, 'message', null);
  closeAllModals();
  toast('Sent');
}

/* ============================= EXPLORE ================================ */
async function loadExplore(){
  loadSuggestions();
  $('#exploreGrid').innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('posts')
    .select('id,image_url,user_id, likes(user_id), comments(id), post_media(url,media_type,position)')
    .order('created_at', { ascending: false }).limit(90);
  if (error){ $('#exploreGrid').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const rows = data||[];
  if (!rows.length){ $('#exploreGrid').innerHTML = '<div class="empty">Nothing here yet.</div>'; return; }
  $('#exploreGrid').innerHTML = rows.map(p => {
    const lc = (p.likes||[]).length, cc = (p.comments||[]).length;
    const first = (p.post_media || []).slice().sort((a,b) => a.position - b.position)[0] || { url: p.image_url, media_type: 'image' };
    const isVid = first.media_type === 'video';
    return `<div class="cell" data-pid="${p.id}">
      ${isVid ? `<video src="${esc(first.url)}" muted playsinline></video>` : `<img src="${esc(first.url)}" loading="lazy" alt="">`}
      ${isVid ? '<span style="position:absolute;top:8px;right:8px;color:#fff;font-size:13px;text-shadow:0 1px 4px #000">▶</span>' : ''}
      <div class="ov"><span>♥ ${fmt(lc)}</span><span>💬 ${cc}</span></div></div>`;
  }).join('');
  $$('#exploreGrid .cell').forEach(c => c.onclick = () => openPost(c.dataset.pid));
}

/* ========================== WHO TO FOLLOW ============================ */
async function loadSuggestions(){
  const { data } = await sb.from('profiles').select('id,username,name,avatar_url').limit(40);
  const people = (data || []).filter(p => p.id !== me.id && !myFollowing.has(p.id)).slice(0, 12);
  const markup = people.length
    ? `<div class="suggest"><h4>Who to follow</h4><div class="suggest-row">${
        people.map(p => `<div class="sug" data-uid="${p.id}">
          ${avatarImg(p)}
          <div class="txt"><div class="u">${esc(p.username)}</div><div class="n">${esc(p.name || '')}</div></div>
          <button class="btn primary" data-act="follow" data-uid="${p.id}">Follow</button>
        </div>`).join('')}</div></div>`
    : '';
  const a = $('#followSuggest'); if (a) a.innerHTML = markup;
  const b = $('#railSuggest'); if (b) b.innerHTML = markup;
  $$('#followSuggest [data-act="follow"], #railSuggest [data-act="follow"]').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const uid = btn.dataset.uid;
    if (myFollowing.has(uid)) return;
    await sb.from('follows').insert({ follower_id: me.id, following_id: uid });
    myFollowing.add(uid);
    $$(`[data-act="follow"][data-uid="${uid}"]`).forEach(x => { x.textContent = 'Following'; x.classList.remove('primary'); });
    await notify(uid, 'follow', null);
    toast('Following');
  });
  $$('#followSuggest .sug, #railSuggest .sug').forEach(s => s.onclick = (e) => {
    if (!e.target.closest('button')) openUserModal(s.dataset.uid);
  });
}

/* ===================== FOLLOWERS / FOLLOWING ========================= */
async function openFollowList(kind, userId){
  const uid = userId || me.id;
  $('#followTitle').textContent = kind === 'followers' ? 'Followers' : 'Following';
  const body = $('#followBody');
  body.innerHTML = '<div class="spin"></div>';
  $('#followModal').classList.add('on');
  let ids = [];
  if (kind === 'followers'){
    const { data } = await sb.from('follows').select('follower_id').eq('following_id', uid);
    ids = (data || []).map(r => r.follower_id);
  } else {
    const { data } = await sb.from('follows').select('following_id').eq('follower_id', uid);
    ids = (data || []).map(r => r.following_id);
  }
  if (!ids.length){ body.innerHTML = '<div class="empty">Nobody here yet.</div>'; return; }
  const { data: profs } = await sb.from('profiles').select('id,username,name,avatar_url').in('id', ids);
  body.innerHTML = (profs || []).map(p => `<div class="person" data-uid="${p.id}" style="cursor:pointer">
      ${avatarImg(p)}
      <div class="meta"><div class="h">${esc(p.username)}</div><div class="s">${esc(p.name || '')}</div></div>
      ${p.id !== me.id ? `<button class="btn ${myFollowing.has(p.id) ? '' : 'primary'}" data-act="f" data-uid="${p.id}">${myFollowing.has(p.id) ? 'Following' : 'Follow'}</button>` : ''}
    </div>`).join('');
  $$('#followBody .person').forEach(el => el.onclick = (e) => {
    if (!e.target.closest('button')) openUserModal(el.dataset.uid);
  });
  $$('#followBody [data-act="f"]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.dataset.uid;
    if (myFollowing.has(id)){
      await sb.from('follows').delete().eq('follower_id', me.id).eq('following_id', id);
      myFollowing.delete(id);
      b.textContent = 'Follow'; b.classList.add('primary');
    } else {
      await sb.from('follows').insert({ follower_id: me.id, following_id: id });
      myFollowing.add(id);
      b.textContent = 'Following'; b.classList.remove('primary');
      await notify(id, 'follow', null);
    }
  });
}
$$('[data-follow]').forEach(el => el.onclick = () => openFollowList(el.dataset.follow));

/* =============================== REELS =============================== */
let reels = [], reelObserver = null;

async function loadReels(){
  const feed = $('#reelsFeed');
  feed.innerHTML = '<div class="spin"></div>';
  const { data, error } = await sb.from('reels')
    .select('id,user_id,video_url,caption,created_at, author:profiles(username,name,avatar_url), reel_likes(user_id), reel_comments(id)')
    .order('created_at', { ascending: false }).limit(30);
  if (error){ feed.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  reels = (data || []).map(r => ({
    ...r,
    likeCount: (r.reel_likes || []).length,
    liked: (r.reel_likes || []).some(l => l.user_id === me.id),
    commentCount: (r.reel_comments || []).length
  }));
  renderReels();
}

function renderReels(){
  const feed = $('#reelsFeed');
  if (!reels.length){
    feed.innerHTML = '<div class="empty">No reels yet.<br>Tap <b>New reel</b> to post the first one.</div>';
    return;
  }
  feed.innerHTML = reels.map((r, i) => {
    const a = r.author || {};
    return `<div class="reel paused" data-i="${i}">
      <video src="${esc(r.video_url)}" loop playsinline preload="metadata" muted></video>
      <div class="rv-play">${svgPlay()}</div>
      <div class="rv-head">${avatarImg(a)}<div class="u">${esc(a.username || 'user')}</div></div>
      <div class="rv-side">
        <button data-act="like" class="${r.liked ? 'liked' : ''}">${svgHeart(r.liked)}<span data-role="lc">${fmt(r.likeCount)}</span></button>
        <button data-act="comment">${svgComment()}<span data-role="cc">${r.commentCount}</span></button>
      </div>
      ${r.caption ? `<div class="rv-cap"><b>${esc(a.username || 'user')}</b>${esc(r.caption)}</div>` : ''}
    </div>`;
  }).join('');
  wireReels();
}

function wireReels(){
  const els = $$('#reelsFeed .reel');
  els.forEach(el => {
    const r = reels[+el.dataset.i];
    const v = el.querySelector('video');
    el.onclick = (e) => {
      if (e.target.closest('[data-act]')) return;
      if (v.paused){ v.play().catch(() => {}); el.classList.remove('paused'); }
      else { v.pause(); el.classList.add('paused'); }
    };
    el.querySelector('[data-act="like"]').onclick = async (e) => {
      e.stopPropagation();
      const on = !r.liked;
      r.liked = on; r.likeCount += on ? 1 : -1;
      const b = el.querySelector('[data-act="like"]');
      b.classList.toggle('liked', on);
      b.innerHTML = svgHeart(on) + `<span data-role="lc">${fmt(r.likeCount)}</span>`;
      if (on){
        await sb.from('reel_likes').insert({ reel_id: r.id, user_id: me.id });
        if (r.user_id !== me.id) await notify(r.user_id, 'like', null);
      } else {
        await sb.from('reel_likes').delete().eq('reel_id', r.id).eq('user_id', me.id);
      }
    };
    el.querySelector('[data-act="comment"]').onclick = (e) => { e.stopPropagation(); openReelComments(r.id); };
  });
  if (reelObserver) reelObserver.disconnect();
  reelObserver = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      const v = en.target.querySelector('video');
      if (en.isIntersecting && en.intersectionRatio > 0.6){
        v.play().then(() => en.target.classList.remove('paused')).catch(() => {});
      } else {
        v.pause(); en.target.classList.add('paused');
      }
    });
  }, { threshold: [0, 0.6, 1] });
  els.forEach(el => reelObserver.observe(el));
}

async function openReelComments(reelId){
  const body = $('#cModalBody');
  body.innerHTML = '<div class="spin"></div>';
  $('#cModal').classList.add('on');
  const { data, error } = await sb.from('reel_comments')
    .select('id,body,created_at,user_id, author:profiles(username,name,avatar_url)')
    .eq('reel_id', reelId).order('created_at', { ascending: true });
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
      <input id="rcInput" placeholder="Add a comment...">
      <button id="rcPost" class="on">Post</button>
    </div>`;
  const add = async () => {
    const v = $('#rcInput').value.trim(); if (!v) return;
    const { error: e2 } = await sb.from('reel_comments').insert({ reel_id: reelId, user_id: me.id, body: v });
    if (e2) return toast(e2.message);
    $('#rcInput').value = '';
    const r = reels.find(x => x.id === reelId);
    if (r){ r.commentCount++; const c = document.querySelector('#reelsFeed .reel[data-i="' + reels.indexOf(r) + '"] [data-role="cc"]'); if (c) c.textContent = r.commentCount; }
    const { data: rows } = await sb.from('reel_comments')
      .select('id,body,created_at,user_id, author:profiles(username,name,avatar_url)')
      .eq('reel_id', reelId).order('created_at', { ascending: true });
    body.querySelector('div').innerHTML = listHTML(rows || []);
    toast('Comment added');
  };
  $('#rcPost').onclick = add;
  $('#rcInput').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

/* ---- reel composer ---- */
let reelBlob = null;
$('#newReelBtn').onclick = () => { errEl('#reelErr',''); $('#reelModal').classList.add('on'); };
$('#reelDrop').onclick = () => $('#reelInput').click();
$('#reelInput').onchange = (e) => { const f = e.target.files[0]; if (f) reelBlob = f; };
$('#reelShare').onclick = async () => {
  errEl('#reelErr','');
  if (!reelBlob) return errEl('#reelErr','Please choose a video first.');
  const btn = $('#reelShare'); btn.disabled = true; btn.textContent = 'Uploading...';
  try{
    const path = `${me.id}/${Date.now()}.mp4`;
    const { error: ue } = await sb.storage.from('reels').upload(path, reelBlob, { contentType: reelBlob.type || 'video/mp4' });
    if (ue) throw ue;
    const { data: { publicUrl } } = sb.storage.from('reels').getPublicUrl(path);
    const { error } = await sb.from('reels').insert({ user_id: me.id, video_url: publicUrl, caption: $('#reelCaption').value.trim() });
    if (error) throw error;
    reelBlob = null; $('#reelCaption').value = '';
    closeAllModals(); await loadReels(); toast('Reel posted');
  }catch(err){ errEl('#reelErr', err.message); }
  btn.disabled = false; btn.textContent = 'Share reel';
};

/* ============================== STORIES =============================== */
let storyGroups = [];                 // [{ profile, stories:[...] }]
let svGroup = 0, svIndex = 0, svTimer = null;

async function loadStories(){
  const { data, error } = await sb.from('stories')
    .select('id,user_id,media_url,media_type,caption,created_at,expires_at, author:profiles(username,name,avatar_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  const rows = error ? [] : (data || []);

  const byUser = new Map();
  rows.forEach(s => {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, { profile: s.author || { username: 'user' }, stories: [] });
    byUser.get(s.user_id).stories.push(s);
  });
  storyGroups = [];
  if (byUser.has(me.id)){ storyGroups.push(byUser.get(me.id)); byUser.delete(me.id); }
  byUser.forEach(g => storyGroups.push(g));

  let seen = new Set();
  const { data: views } = await sb.from('story_views').select('story_id').eq('viewer_id', me.id);
  (views || []).forEach(v => seen.add(v.story_id));

  const bar = [`<div class="story" data-me="1">
      <div class="ring"><img src="${avatarOf(me)}" alt=""></div><small>Your story</small></div>`];
  storyGroups.forEach((g, i) => {
    if (g.profile.id === me.id) return;
    const allSeen = g.stories.every(s => seen.has(s.id));
    bar.push(`<div class="story" data-g="${i}">
      <div class="ring ${allSeen ? 'seen' : ''}"><img src="${avatarOf(g.profile)}" alt=""></div>
      <small>${esc(g.profile.username || 'user')}</small></div>`);
  });
  $('#stories').innerHTML = bar.join('');
  $$('#stories .story').forEach(el => el.onclick = () => {
    if (el.dataset.me){
      const mine = storyGroups.findIndex(g => g.profile.id === me.id);
      if (mine >= 0) openStoryViewer(mine, 0); else openStoryComposer();
      return;
    }
    openStoryViewer(+el.dataset.g, 0);
  });
}

function openStoryViewer(gi, si){
  svGroup = gi; svIndex = si;
  $('#storyViewer').classList.remove('hidden');
  renderStory();
}

function renderStory(){
  const g = storyGroups[svGroup];
  if (!g) return closeStoryViewer();
  const s = g.stories[svIndex];
  if (!s) return closeStoryViewer();
  const mine = g.profile.id === me.id;

  $('#svAvatar').src = avatarOf(g.profile);
  $('#svName').textContent = g.profile.username || 'user';
  $('#svTime').textContent = timeAgo(s.created_at);

  $('#svStage').innerHTML = s.media_type === 'video'
    ? `<video src="${esc(s.media_url)}" autoplay playsinline></video>`
    : `<img src="${esc(s.media_url)}" alt="">`;

  const isReal = !String(s.id).startsWith('hl-');
  $('#svCaption').innerHTML = esc(s.caption || '') +
    (mine && isReal
      ? `<div class="sv-actions"><button class="btn" id="svDelete">Delete</button><button class="btn" id="svHighlight">Add to highlight</button></div>`
      : '');
  if (mine && isReal){
    const del = $('#svDelete');
    if (del) del.onclick = async () => {
      await sb.from('stories').delete().eq('id', s.id);
      closeStoryViewer(); toast('Story deleted');
    };
    const hl = $('#svHighlight');
    if (hl) hl.onclick = openHighlightComposer;
  }
  const rb = $('#svReplyBar');
  if (rb) rb.style.display = mine ? 'none' : 'flex';

  $('#svBars').innerHTML = g.stories.map((_, i) =>
    `<i class="${i < svIndex ? 'done' : ''} ${i === svIndex ? 'active' : ''}"><span></span></i>`).join('');

  if (isReal) sb.from('story_views').upsert({ story_id: s.id, viewer_id: me.id }).then(() => {});

  clearTimeout(svTimer);
  svTimer = setTimeout(storyNext, s.media_type === 'video' ? 8000 : 5000);
}

function storyNext(){
  const g = storyGroups[svGroup];
  if (!g) return closeStoryViewer();
  if (svIndex < g.stories.length - 1){ svIndex++; renderStory(); }
  else if (svGroup < storyGroups.length - 1){ svGroup++; svIndex = 0; renderStory(); }
  else closeStoryViewer();
}
function storyPrev(){
  if (svIndex > 0){ svIndex--; renderStory(); }
  else if (svGroup > 0){ svGroup--; svIndex = storyGroups[svGroup].stories.length - 1; renderStory(); }
  else renderStory();
}
function closeStoryViewer(){
  clearTimeout(svTimer);
  $('#storyViewer').classList.add('hidden');
  $('#svStage').innerHTML = '';
  loadStories();
}
$('#svClose').onclick = closeStoryViewer;
$('#svNext').onclick = storyNext;
$('#svPrev').onclick = storyPrev;
$('#svReplySend').onclick = async () => {
  const inp = $('#svReply');
  const v = inp.value.trim(); if (!v) return;
  const g = storyGroups[svGroup]; if (!g) return;
  const owner = g.profile.id;
  if (owner === me.id) return toast('That is your own story');
  inp.value = '';
  const { error } = await sb.from('messages').insert({ sender_id: me.id, receiver_id: owner, body: 'Replied to your story: ' + v });
  if (error) return toast(error.message);
  await notify(owner, 'message', null);
  toast('Reply sent');
};
$('#svReply').addEventListener('keydown', e => { if (e.key === 'Enter') $('#svReplySend').click(); });

/* ---- story composer ---- */
let storyBlob = null, storyKind = 'image';
function openStoryComposer(){
  errEl('#storyErr',''); storyBlob = null;
  $('#storyPreview').classList.add('hidden'); $('#storyPreview').innerHTML = '';
  $('#storyModal').classList.add('on');
}
$('#storyDrop').onclick = () => $('#storyInput').click();
$('#storyInput').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  storyBlob = f; storyKind = (f.type || '').startsWith('video') ? 'video' : 'image';
  const url = URL.createObjectURL(f);
  $('#storyPreview').innerHTML = storyKind === 'video'
    ? `<video src="${url}" autoplay muted loop playsinline></video>`
    : `<img src="${url}" alt="">`;
  $('#storyPreview').classList.remove('hidden');
};
$('#storyShare').onclick = async () => {
  errEl('#storyErr','');
  if (!storyBlob) return errEl('#storyErr','Please choose a photo or video first.');
  const btn = $('#storyShare'); btn.disabled = true; btn.textContent = 'Uploading...';
  try{
    const path = `${me.id}/${Date.now()}.${storyKind === 'video' ? 'mp4' : 'jpg'}`;
    const { error: ue } = await sb.storage.from('stories').upload(path, storyBlob, { contentType: storyBlob.type || 'image/jpeg' });
    if (ue) throw ue;
    const { data: { publicUrl } } = sb.storage.from('stories').getPublicUrl(path);
    const { error } = await sb.from('stories').insert({
      user_id: me.id, media_url: publicUrl, media_type: storyKind, caption: $('#storyCaption').value.trim()
    });
    if (error) throw error;
    storyBlob = null; $('#storyCaption').value = '';
    $('#storyPreview').classList.add('hidden'); $('#storyPreview').innerHTML = '';
    closeAllModals(); await loadStories(); toast('Added to your story');
  }catch(err){ errEl('#storyErr', err.message); }
  btn.disabled = false; btn.textContent = 'Share to story';
};

/* ============================ CREATE POST ============================= */
let pendingFiles = [], camStream = null;

function openCreate(){ errEl('#createErr',''); $('#createModal').classList.add('on'); }
const nbTop = $('#newBtnTop'); if (nbTop) nbTop.onclick = openCreate;
const nbNav = $('#newBtnNav'); if (nbNav) nbNav.onclick = openCreate;
$$('[data-close]').forEach(b => b.onclick = () => { closeAllModals(); });
function closeAllModals(){
  $$('.modal').forEach(m => m.classList.remove('on'));
  stopCam();
}
$('#pickFile').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => {
  pendingFiles = Array.from(e.target.files || []);
  renderPreview();
};

function renderPreview(){
  const box = $('#preview');
  if (!pendingFiles.length){ box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<div style="display:flex;gap:8px;overflow-x:auto">${pendingFiles.map(f => {
    const url = URL.createObjectURL(f);
    const isVid = (f.type || '').startsWith('video');
    return `<div style="flex:0 0 auto;width:110px;height:110px;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--soft)">${
      isVid ? `<video src="${url}" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>`
            : `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`
    }</div>`;
  }).join('')}</div>
  <div class="muted" style="font-size:12px;margin-top:8px">${pendingFiles.length} item${pendingFiles.length > 1 ? 's' : ''} selected${pendingFiles.length > 1 ? ' — this will be a carousel' : ''}</div>`;
}

$('#pickCam').onclick = async () => {
  try{
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('#cam').srcObject = camStream;
    $('#camBox').classList.remove('hidden');
  }catch(err){ errEl('#createErr','Camera unavailable: ' + err.message); }
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
  c.toBlob(blob => {
    pendingFiles = [new File([blob], 'camera.jpg', { type: 'image/jpeg' })];
    renderPreview(); stopCam();
  }, 'image/jpeg', 0.9);
};

$('#shareBtn').onclick = async () => {
  errEl('#createErr','');
  if (!pendingFiles.length) return errEl('#createErr','Please choose a photo or video first.');
  const btn = $('#shareBtn'); btn.disabled = true; btn.textContent = 'Uploading...';
  try{
    const caption = $('#capInput').value.trim();
    const location = $('#locInput').value.trim();
    const { data: post, error } = await sb.from('posts')
      .insert({ user_id: me.id, image_url: '', caption, location }).select().single();
    if (error) throw error;
    const mediaRows = [];
    for (let i = 0; i < pendingFiles.length; i++){
      const f = pendingFiles[i];
      const isVid = (f.type || '').startsWith('video');
      const path = `${me.id}/${post.id}-${i}.${isVid ? 'mp4' : 'jpg'}`;
      const { error: ue } = await sb.storage.from('posts').upload(path, f, { contentType: f.type || 'image/jpeg' });
      if (ue) throw ue;
      const { data: { publicUrl } } = sb.storage.from('posts').getPublicUrl(path);
      mediaRows.push({ post_id: post.id, position: i, url: publicUrl, media_type: isVid ? 'video' : 'image' });
    }
    const { error: e2 } = await sb.from('post_media').insert(mediaRows);
    if (e2) throw e2;
    await sb.from('posts').update({ image_url: mediaRows[0].url }).eq('id', post.id);
    pendingFiles = [];
    $('#capInput').value = ''; $('#locInput').value = '';
    $('#preview').classList.add('hidden'); $('#preview').innerHTML = '';
    closeAllModals(); go('home'); await loadFeed(); toast('Posted to PariBari');
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
      <div data-fl="followers" data-uid="${uid}" style="cursor:pointer"><b>${fmt((fCount||[]).length)}</b> followers</div>
      <div data-fl="following" data-uid="${uid}" style="cursor:pointer"><b>${fmt((fwCount||[]).length)}</b> following</div>
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
  $$('#userModalBody [data-fl]').forEach(el => el.onclick = (e) => {
    e.stopPropagation(); openFollowList(el.dataset.fl, el.dataset.uid);
  });
}

/* ================================ DMs ================================= */
let dmPeople = [], chatPeer = null, dmChannel = null;

async function loadDMs(){
  const view = $('#view-dms');
  if (chatPeer){ return; }              // keep an open chat on screen
  $('#dmChat').classList.add('hidden'); $('#dmList').classList.remove('hidden');
  $('#dmList').innerHTML = '<div class="spin"></div>';
  const { data: msgs } = await sb.from('messages')
    .select('sender_id,receiver_id,body,created_at,read_at,media_url')
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
    .order('created_at', { ascending: false }).limit(300);
  const seen = new Map();
  const unread = new Map();
  (msgs||[]).forEach(m => {
    const other = m.sender_id === me.id ? m.receiver_id : m.sender_id;
    if (!seen.has(other)) seen.set(other, m);
    if (m.receiver_id === me.id && !m.read_at) unread.set(other, (unread.get(other) || 0) + 1);
  });
  const ids = [...seen.keys()];
  let profMap = {};
  if (ids.length){
    const { data: profs } = await sb.from('profiles').select('id,username,name,avatar_url').in('id', ids);
    (profs||[]).forEach(p => profMap[p.id] = p);
  }
  dmPeople = ids.map(id => ({ profile: profMap[id] || {id, username:'user'}, last: seen.get(id), unread: unread.get(id) || 0 }));
  const listEl = $('#dmList');
  if (!dmPeople.length){
    listEl.innerHTML = '<div class="empty">No conversations yet.<br>Open someone\'s profile and tap <b>Message</b> to start one.</div>';
    return;
  }
  listEl.innerHTML = dmPeople.map((d,i) => `<div class="person" data-i="${i}" style="cursor:pointer">
      ${avatarImg(d.profile)}
      <div class="meta"><div class="h">${esc(d.profile.username)}</div>
      <div class="s">${esc(d.last.body || (d.last.media_url ? 'Photo' : ''))}</div></div>
      ${d.unread ? `<span style="min-width:18px;height:18px;border-radius:9px;background:var(--heart);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px">${d.unread}</span>` : ''}
      <div class="when muted" style="font-size:11.5px">${esc(timeAgo(d.last.created_at))}</div>
    </div>`).join('');
  $$('#dmList .person').forEach(el => el.onclick = () => openChat(dmPeople[+el.dataset.i].profile.id));
}

async function openChat(uid){
  chatPeer = uid;
  chatReplyTo = null;
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
      <div class="typing" id="typing"></div>
      <div id="replyBar" class="hidden" style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid var(--border);font-size:12.5px;color:var(--muted)"></div>
      <div class="chatinput">
        <button class="ibtn" id="chatPhoto" title="Send a photo">${svgImage()}</button>
        <input id="chatMsg" placeholder="Message...">
        <button class="btn primary" id="chatSend">Send</button>
      </div>
      <input type="file" id="chatFile" accept="image/*" hidden />
    </div>`;
  $('#chatBack').onclick = () => { chatPeer = null; closeChatChannel(); loadDMs(); };
  await markChatRead();
  await renderChat();
  $('#chatSend').onclick = sendChat;
  $('#chatMsg').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  $('#chatMsg').addEventListener('input', pingTyping);
  $('#chatPhoto').onclick = () => $('#chatFile').click();
  $('#chatFile').onchange = sendChatPhoto;
  openChatChannel();
}

let chatReplyTo = null, typingSentAt = 0, typingTimer = null;
function pingTyping(){
  if (!dmChannel) return;
  const now = Date.now();
  if (now - typingSentAt < 2000) return;
  typingSentAt = now;
  dmChannel.send({ type: 'broadcast', event: 'typing', payload: { from: me.id } }).catch(() => {});
}
function setReplyBar(){
  const bar = $('#replyBar'); if (!bar) return;
  if (!chatReplyTo){ bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Replying to: ${esc(chatReplyTo.body || 'message')}</span>
    <button class="btn" style="padding:3px 10px;font-size:12px" id="replyCancel">Cancel</button>`;
  const c = $('#replyCancel');
  if (c) c.onclick = () => { chatReplyTo = null; setReplyBar(); };
}

async function markChatRead(){
  if (!chatPeer) return;
  await sb.from('messages').update({ read_at: new Date().toISOString() })
    .eq('sender_id', chatPeer).eq('receiver_id', me.id).is('read_at', null);
  refreshBadges();
}
let chatPeerProfile = null;

async function renderChat(){
  const { data, error } = await sb.from('messages')
    .select('id,sender_id,receiver_id,body,created_at,read_at,media_url,media_type,reply_to,shared_post_id, shared:posts(image_url), message_reactions(emoji,user_id)')
    .or(`and(sender_id.eq.${me.id},receiver_id.eq.${chatPeer}),and(sender_id.eq.${chatPeer},receiver_id.eq.${me.id})`)
    .order('created_at', { ascending: true }).limit(500);
  const body = $('#chatBody');
  if (!body) return;
  if (error){ body.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const rows = data || [];
  const byId = {};
  rows.forEach(m => { byId[m.id] = m; });
  body.innerHTML = rows.map(m => {
    const mine = m.sender_id === me.id;
    const media = m.media_url ? `<img class="media" src="${esc(m.media_url)}" alt="">` : '';
    const shared = (m.shared && m.shared.image_url)
      ? `<div class="sharecard"><img src="${esc(m.shared.image_url)}" alt=""></div>` : '';
    const quoted = m.reply_to && byId[m.reply_to]
      ? `<div class="replyquote">${esc((byId[m.reply_to].body || 'photo').slice(0, 70))}</div>` : '';
    const reacts = m.message_reactions || [];
    const reactPill = reacts.length ? `<span class="msgreact">${esc(reacts[0].emoji)}${reacts.length > 1 ? ' ' + reacts.length : ''}</span>` : '';
    const ticks = mine ? `<span class="ticks ${m.read_at ? 'seen' : ''}">${m.read_at ? '✓✓' : '✓'}</span>` : '';
    const txt = m.body ? esc(m.body) : '';
    return `<div class="msgrow ${mine ? 'me' : 'them'}">
      <button class="rbtn" data-reply="${m.id}" data-body="${esc((m.body || 'photo').slice(0, 60))}" title="Reply">↩</button>
      <div class="bub ${mine ? 'me' : 'them'}" data-mid="${m.id}">${quoted}${shared}${media}${txt}${ticks}${reactPill}</div>
    </div>`;
  }).join('') || '<div class="empty">Say hi 👋</div>';

  body.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => {
    chatReplyTo = { id: b.dataset.reply, body: b.dataset.body };
    setReplyBar();
    const inp = $('#chatMsg'); if (inp) inp.focus();
  });
  body.querySelectorAll('.bub[data-mid]').forEach(b => {
    b.ondblclick = () => toggleReaction(b.dataset.mid);
  });
  body.scrollTop = body.scrollHeight;
}

async function toggleReaction(mid){
  const { data } = await sb.from('message_reactions').select('emoji').eq('message_id', mid).eq('user_id', me.id);
  if (data && data.length){
    await sb.from('message_reactions').delete().eq('message_id', mid).eq('user_id', me.id);
  } else {
    await sb.from('message_reactions').insert({ message_id: mid, user_id: me.id, emoji: '❤️' });
  }
  renderChat();
}

async function sendChat(){
  const inp = $('#chatMsg'); const v = inp.value.trim(); if (!v) return;
  inp.value = '';
  const reply = chatReplyTo ? chatReplyTo.id : null;
  chatReplyTo = null; setReplyBar();
  const { error } = await sb.from('messages').insert({ sender_id: me.id, receiver_id: chatPeer, body: v, reply_to: reply });
  if (error) return toast(error.message);
  await notify(chatPeer, 'message', null);
  await renderChat();
}

async function sendChatPhoto(e){
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  toast('Uploading photo...');
  const path = `${me.id}/${Date.now()}.jpg`;
  const { error: ue } = await sb.storage.from('chat').upload(path, f, { contentType: f.type || 'image/jpeg' });
  if (ue) return toast(ue.message);
  const { data: { publicUrl } } = sb.storage.from('chat').getPublicUrl(path);
  const { error } = await sb.from('messages').insert({
    sender_id: me.id, receiver_id: chatPeer, body: '', media_url: publicUrl, media_type: 'image'
  });
  if (error) return toast(error.message);
  await notify(chatPeer, 'message', null);
  await renderChat();
}

function openChatChannel(){
  closeChatChannel();
  const key = 'chat-' + [me.id, chatPeer].sort().join('-');
  dmChannel = sb.channel(key, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, (msg) => {
      if (msg.payload && msg.payload.from === chatPeer){
        const el = $('#typing');
        if (el) el.textContent = 'typing…';
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { const e2 = $('#typing'); if (e2) e2.textContent = ''; }, 2500);
      }
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const m = payload.new;
      if (!m) return;
      const pair = (m.sender_id === me.id && m.receiver_id === chatPeer) || (m.sender_id === chatPeer && m.receiver_id === me.id);
      if (pair && chatPeer) renderChat();
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'message_reactions' }, () => {
      if (chatPeer) renderChat();
    })
    .subscribe();
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

async function refreshBadges(){
  const [{ count: nCount }, { count: mCount }] = await Promise.all([
    sb.from('notifications').select('*', { count:'exact', head:true }).eq('user_id', me.id).eq('read', false),
    sb.from('messages').select('*', { count:'exact', head:true }).eq('receiver_id', me.id).is('read_at', null)
  ]);
  const nb = $('#notifBadge'), db = $('#dmBadge');
  if (nCount){ nb.textContent = fmt(nCount); nb.classList.remove('hidden'); } else nb.classList.add('hidden');
  if (mCount){ db.textContent = fmt(mCount); db.classList.remove('hidden'); } else db.classList.add('hidden');
  const nbs = $('#notifBadgeSide'), dbs = $('#dmBadgeSide');
  if (nbs){ if (nCount){ nbs.textContent = fmt(nCount); nbs.classList.remove('hidden'); } else nbs.classList.add('hidden'); }
  if (dbs){ if (mCount){ dbs.textContent = fmt(mCount); dbs.classList.remove('hidden'); } else dbs.classList.add('hidden'); }
}

/* ============================== PROFILE =============================== */
let profTab = 'posts';
function emptyMsg(t){
  return t === 'saved' ? 'No saved posts yet.' : t === 'reels' ? 'No reels yet.' :
         t === 'tagged' ? 'No tagged posts yet.' : 'No posts yet. Tap + to share your first one.';
}
async function loadProfile(){
  if (!me) return;
  paintAvatars();
  $('#profName').textContent = '@' + me.username;
  $('#profBio').innerHTML = `<span class="nm">${esc(me.name||'')}</span>\n${esc(me.bio||'')}`;
  const uid = me.id;
  const uname = me.username;
  const [{ count: postsCount }, { data: fw }, { data: fwr }] = await Promise.all([
    sb.from('posts').select('*', { count:'exact', head:true }).eq('user_id', uid),
    sb.from('follows').select('following_id').eq('follower_id', uid),
    sb.from('follows').select('follower_id').eq('following_id', uid)
  ]);
  $('#statPosts').textContent = postsCount || 0;
  $('#statFollowers').textContent = fmt((fwr||[]).length);
  $('#statFollowing').textContent = fmt((fw||[]).length);

  loadHighlights(uid);

  let items = [];
  if (profTab === 'saved'){
    const { data } = await sb.from('saves')
      .select('post_id, post:posts(id,image_url,post_media(url,media_type,position),likes(user_id))')
      .eq('user_id', uid).order('created_at', { ascending: false });
    items = (data||[]).map(r => r.post).filter(Boolean);
  } else if (profTab === 'reels'){
    const { data } = await sb.from('reels').select('id,video_url').eq('user_id', uid).order('created_at', { ascending: false });
    items = (data||[]).map(r => ({ id: r.id, image_url: r.video_url, _reel: true }));
  } else if (profTab === 'tagged'){
    const { data } = await sb.from('posts')
      .select('id,image_url,post_media(url,media_type,position),likes(user_id)')
      .neq('user_id', uid).ilike('caption', '%@' + uname + '%')
      .order('created_at', { ascending: false }).limit(60);
    items = data || [];
  } else {
    const { data } = await sb.from('posts')
      .select('id,image_url,post_media(url,media_type,position),likes(user_id)')
      .eq('user_id', uid).order('created_at', { ascending: false });
    items = data || [];
  }

  const grid = $('#profGrid');
  if (!items.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${emptyMsg(profTab)}</div>`;
    return;
  }
  grid.innerHTML = items.map(p => {
    const first = (p.post_media || []).slice().sort((a,b) => a.position - b.position)[0] || { url: p.image_url, media_type: 'image' };
    const lc = (p.likes||[]).length;
    const isVid = first.media_type === 'video' || p._reel;
    return `<div class="cell" data-pid="${p.id}" data-reel="${p._reel ? 1 : 0}">
      ${isVid ? `<video src="${esc(first.url)}" muted playsinline></video>` : `<img src="${esc(first.url)}" loading="lazy" alt="">`}
      ${isVid ? '<span style="position:absolute;top:8px;right:8px;color:#fff;font-size:13px;text-shadow:0 1px 4px #000">▶</span>' : ''}
      <div class="ov">${isVid ? '<span>▶</span>' : `<span>♥ ${fmt(lc)}</span>`}</div></div>`;
  }).join('');
  $$('#profGrid .cell').forEach(c => c.onclick = () => {
    if (c.dataset.reel === '1') go('reels');
    else openPost(c.dataset.pid);
  });
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
/* (search now lives in the Explore tab — see runSearch above) */

/* ============================ NAVIGATION ============================== */
let currentView = 'home';
function go(v){
  currentView = v;
  $$('.view').forEach(x => x.classList.remove('on'));
  $('#view-'+v).classList.add('on');
  $$('nav.bottom .ibtn[data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === v));
  $$('#sidebar .snav[data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === v));
  window.scrollTo({ top:0, behavior:'smooth' });
  if (v === 'explore') loadExplore();
  if (v === 'profile') loadProfile();
  if (v === 'reels') loadReels();
  if (v === 'settings') loadSettings();
  if (v === 'dms'){ loadDMs(); refreshBadges(); }
  if (v === 'notifs') loadNotifs();
  if (v !== 'dms'){ chatPeer = null; closeChatChannel(); }
  if (v !== 'reels'){ $$('#reelsFeed video').forEach(x => x.pause()); }
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
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages', filter:`sender_id=eq.${me.id}` }, () => {
      if (chatPeer) renderChat();
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'stories' }, () => { loadStories(); })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'reels' }, () => {
      if (currentView === 'reels') loadReels();
    })
    .subscribe();
}

/* ============================= HIGHLIGHTS ============================= */
let myHighlights = [];

async function loadHighlights(uid){
  const el = $('#highlightsRow');
  if (!me || !el) return;
  const user = uid || me.id;
  const { data } = await sb.from('highlights')
    .select('id,title,cover_url,created_at, highlight_items(id,media_url,media_type,caption,position)')
    .eq('user_id', user).order('created_at', { ascending: false });
  myHighlights = data || [];
  let html = `<div class="hl new" id="hlNew"><div class="ring"><img src="${avatarOf(me)}" alt=""></div><small>New</small></div>`;
  html += myHighlights.map(h => {
    const items = (h.highlight_items || []).slice().sort((a,b) => a.position - b.position);
    const cover = h.cover_url || (items[0] && items[0].media_url) || avatarOf(me);
    return `<div class="hl" data-hl="${h.id}"><div class="ring"><img src="${esc(cover)}" alt=""></div><small>${esc(h.title)}</small></div>`;
  }).join('');
  el.innerHTML = html;
  const n = $('#hlNew'); if (n) n.onclick = openHighlightComposer;
  $$('#highlightsRow [data-hl]').forEach(x => x.onclick = () => openHighlight(x.dataset.hl));
}

function openHighlight(id){
  const h = myHighlights.find(x => x.id === id); if (!h) return;
  const items = (h.highlight_items || []).slice().sort((a,b) => a.position - b.position);
  if (!items.length) return toast('This highlight is empty');
  storyGroups = [{ profile: { ...me }, stories: items.map(i => ({
    id: 'hl-' + i.id, media_url: i.media_url, media_type: i.media_type, caption: i.caption,
    created_at: h.created_at, _hl: true
  })) }];
  openStoryViewer(0, 0);
}

function openHighlightComposer(){ errEl('#hlErr',''); $('#hlTitle').value = ''; $('#hlModal').classList.add('on'); }
$('#hlSave').onclick = async () => {
  errEl('#hlErr','');
  const title = $('#hlTitle').value.trim();
  if (!title) return errEl('#hlErr','Please give the highlight a name.');
  const { data: mine } = await sb.from('stories').select('media_url,media_type,caption,created_at')
    .eq('user_id', me.id).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
  if (!mine || !mine.length) return errEl('#hlErr','Post a story first — highlights are built from your stories.');
  const { data: h, error } = await sb.from('highlights')
    .insert({ user_id: me.id, title, cover_url: mine[0].media_url }).select().single();
  if (error) return errEl('#hlErr', error.message);
  const items = mine.map((s, i) => ({ highlight_id: h.id, media_url: s.media_url, media_type: s.media_type, caption: s.caption, position: i }));
  const { error: e2 } = await sb.from('highlight_items').insert(items);
  if (e2) return errEl('#hlErr', e2.message);
  closeAllModals(); await loadHighlights(); toast('Highlight created');
};

/* =============================== NOTES ================================ */
let notesCache = [];

async function loadNotes(){
  const el = $('#notesBar'); if (!el || !me) return;
  const { data } = await sb.from('notes')
    .select('user_id,body,created_at,expires_at, author:profiles(username,name,avatar_url)')
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(30);
  notesCache = data || [];
  const mine = notesCache.find(n => n.user_id === me.id);
  let html = `<div class="note mine" id="noteMine"><div class="bub2">${mine ? esc(mine.body) : '＋ Note'}</div><small>Your note</small></div>`;
  html += notesCache.filter(n => n.user_id !== me.id).map(n => `<div class="note" data-uid="${n.user_id}">
      <div class="bub2">${esc(n.body)}</div><small>${esc((n.author||{}).username || 'user')}</small></div>`).join('');
  el.innerHTML = html;
  const nm = $('#noteMine'); if (nm) nm.onclick = () => openNoteComposer(mine);
  $$('#notesBar .note[data-uid]').forEach(x => x.onclick = () => openUserModal(x.dataset.uid));
}

function openNoteComposer(mine){
  errEl('#noteErr','');
  $('#noteInput').value = mine ? mine.body : '';
  $('#noteModal').classList.add('on');
}
$('#noteSave').onclick = async () => {
  errEl('#noteErr','');
  const body = $('#noteInput').value.trim();
  if (!body){
    await sb.from('notes').delete().eq('user_id', me.id);
    closeAllModals(); await loadNotes(); toast('Note removed'); return;
  }
  const now = new Date();
  const { error } = await sb.from('notes').upsert({
    user_id: me.id, body, created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400e3).toISOString()
  });
  if (error) return errEl('#noteErr', error.message);
  closeAllModals(); await loadNotes(); toast('Note shared');
};
$('#newNoteBtn').onclick = () => openNoteComposer(notesCache.find(n => n.user_id === me.id));

/* ============================== SETTINGS ============================== */
async function loadSettings(){
  if (!me) return;
  $('#setAccount').textContent = '@' + me.username + (me.name ? ' · ' + me.name : '');
  $('#setBackend').textContent = (CFG.SUPABASE_URL || '').replace('https://', '') || 'not configured';
  const [{ count: pc }, { data: fwr }] = await Promise.all([
    sb.from('posts').select('*', { count:'exact', head:true }).eq('user_id', me.id),
    sb.from('follows').select('follower_id').eq('following_id', me.id)
  ]);
  $('#setStats').textContent = `${pc || 0} posts · ${fmt((fwr||[]).length)} followers`;
}
$('#themeBtn2').onclick = toggleTheme;
$('#logoutBtn2').onclick = () => { const b = $('#logoutBtn'); if (b) b.click(); };
$('#editFromSettings').onclick = () => { const b = $('#editBioBtn'); if (b) b.click(); };
$('#newBtnSide').onclick = () => openCreate();

/* ============================== ICONS ================================= */
function svgHeart(f){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.9"><path d="M12 21s-7.5-4.7-9.6-9.2C.9 8.4 2.7 5 6.2 5c2 0 3.3 1.1 4 2.2.6-1.1 2-2.2 4-2.2 3.5 0 5.3 3.4 3.8 6.8C19.5 16.3 12 21 12 21Z"/></svg>`; }
function svgComment(){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/></svg>`; }
function svgShare(){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>`; }
function svgSave(f){ return `<svg width="24" height="24" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.9"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>`; }
function svgBigHeart(){ return `<svg width="96" height="96" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.7-9.6-9.2C.9 8.4 2.7 5 6.2 5c2 0 3.3 1.1 4 2.2.6-1.1 2-2.2 4-2.2 3.5 0 5.3 3.4 3.8 6.8C19.5 16.3 12 21 12 21Z"/></svg>`; }
function svgPlay(){ return `<svg width="68" height="68" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`; }
function svgImage(){ return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`; }

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
