const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (u, opt) => fetch('/api/public' + u, opt).then((r) => r.json());
const kes = (n) => 'KES ' + Number(n).toLocaleString('en-KE');
let S = {};

// visitor tracking (one beacon per page view)
fetch('/api/public/track', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: location.pathname, referrer: document.referrer }),
}).catch(() => {});

function waLink(text) { return `https://wa.me/${S.whatsapp || '254796335184'}?text=${encodeURIComponent(text || 'Hello Shepherd Media Group, I would like to enquire about your services.')}`; }

async function loadSettings() {
  S = await api('/settings');
  document.querySelectorAll('[data-s]').forEach((el) => { el.textContent = S[el.dataset.s] || ''; });
  document.querySelectorAll('[data-wa]').forEach((el) => { el.href = waLink(el.dataset.wa || undefined); });
  document.querySelectorAll('[data-tel]').forEach((el) => { el.href = 'tel:' + S.phone; });
}

function bindShell() {
  $('.burger')?.addEventListener('click', () => $('nav.main').classList.toggle('open'));
  document.querySelectorAll('nav.main a').forEach((a) => a.addEventListener('click', () => $('nav.main').classList.remove('open')));
}

// ---- packages + quote ----
let packages = [];
let cat = '';
function renderPackages() {
  const cats = [...new Set(packages.map((p) => p.category))];
  if (!cat) cat = cats[0];
  $('#tabs').innerHTML = cats.map((c) => `<button class="tab ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  $('#pkgs').innerHTML = packages.filter((p) => p.category === cat).map((p) => `
    <div class="pkg ${p.popular ? 'pop' : ''}">
      ${p.popular ? '<span class="pop-tag">Most popular</span>' : ''}
      <h3>${esc(p.name)}</h3><div class="tag">${esc(p.tagline)}</div>
      <div class="price">${kes(p.price)}</div>
      <ul>${p.features.split('\n').filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <button class="btn btn-red" data-q="${p.id}">Get my quote</button>
    </div>`).join('') || '<div class="empty">No packages in this category yet.</div>';
}
function openQuote(id) {
  const p = packages.find((x) => x.id == id);
  $('#qForm').style.display = ''; $('#qDone').style.display = 'none'; $('#qErr').textContent = '';
  $('#qPkg').innerHTML = packages.map((x) => `<option value="${x.id}" ${x.id == id ? 'selected' : ''}>${esc(x.category)} - ${esc(x.name)} (${kes(x.price)})</option>`).join('');
  $('#quoteModal').classList.add('open');
}
async function submitQuote(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('#qErr').textContent = '';
  const body = Object.fromEntries(new FormData(f));
  const r = await api('/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  btn.disabled = false;
  if (r.error) { $('#qErr').textContent = r.error; return; }
  f.style.display = 'none'; $('#qDone').style.display = '';
  $('#qNum').textContent = r.number;
  $('#qDl').href = r.download;
  $('#qWa').href = waLink(`Hello Shepherd Media Group, I have requested quotation ${r.number}. I would like to discuss it.`);
  f.reset();
}

// ---- gallery ----
function lightbox(src) { $('#lightbox img').src = src; $('#lightbox').classList.add('open'); }
const gItem = (m) => `<div class="g" data-src="${esc(m.file)}"><img loading="lazy" src="${esc(m.file)}" alt="${esc(m.title)}"><button class="like" data-like="${m.id}">♥ ${m.likes}</button></div>`;
async function loadGallery() {
  const [picks, gal, vids] = await Promise.all([api('/picks'), api('/gallery'), api('/videos')]);
  $('#picks').innerHTML = picks.day ? `
    <div class="pick" data-src="${esc(picks.day.file)}"><span class="lbl">Photo of the day</span><img src="${esc(picks.day.file)}" alt=""></div>
    <div class="pick m" data-src="${esc(picks.month.file)}"><span class="lbl">Photo of the month</span><img src="${esc(picks.month.file)}" alt=""></div>` : '';
  $('#best').innerHTML = picks.best.length ? picks.best.map(gItem).join('') : '<div class="empty">Best memories appear here as photos are added and liked.</div>';
  $('#bestWrap').style.display = picks.best.length ? '' : 'none';
  $('#gal').innerHTML = gal.length ? gal.map(gItem).join('') : '<div class="empty">Gallery coming soon.</div>';
  $('#vids').innerHTML = vids.length ? vids.map((v) => `<div><video controls preload="metadata" src="${esc(v.file)}#t=0.5"></video><h4>${esc(v.title)}</h4></div>`).join('') : '';
  $('#videoWrap').style.display = vids.length ? '' : 'none';
}

async function loadPosts(limit) {
  const posts = await api('/posts');
  const el = $('#posts');
  if (!el) return;
  el.innerHTML = posts.slice(0, limit || 99).map((p) => `
    <a class="post" href="/blog/${esc(p.slug)}">
      ${p.cover ? `<img src="${esc(p.cover)}" alt="">` : '<img alt="">'}
      <div class="in"><small>${esc(p.created_at.slice(0, 10))}</small><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></div>
    </a>`).join('') || '<div class="empty">No stories yet. Check back soon.</div>';
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches('.tab')) { cat = t.dataset.c; renderPackages(); }
  else if (t.matches('[data-q]')) openQuote(t.dataset.q);
  else if (t.matches('[data-close]') || t.classList.contains('overlay')) t.closest('.overlay').classList.remove('open');
  else if (t.matches('[data-like]')) {
    e.stopPropagation();
    const id = t.dataset.like;
    if (localStorage.getItem('liked' + id)) return;
    api(`/media/${id}/like`, { method: 'POST' }).then((r) => { if (r.likes != null) { t.textContent = '♥ ' + r.likes; localStorage.setItem('liked' + id, 1); } });
  } else {
    const g = t.closest('[data-src]');
    if (g) lightbox(g.dataset.src);
  }
});

async function initHome() {
  packages = await api('/packages');
  renderPackages();
  $('#qForm').addEventListener('submit', submitQuote);
  loadGallery(); loadPosts(3);
}

window.addEventListener('DOMContentLoaded', async () => {
  bindShell();
  await loadSettings();
  if ($('#pkgs')) initHome();
  else if ($('#posts')) loadPosts();
});
