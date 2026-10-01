const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');
const CATS = ['Wedding', 'Ruracio', 'Livestreaming', 'Burial'];
const MEDIA_CATS = ['Wedding', 'Ruracio', 'Birthday', 'Professional'];

async function A(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api/admin' + url, opt);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/login') { showLogin(); throw new Error('auth'); }
  if (!r.ok) { toast(data.error || 'Something went wrong'); throw new Error(data.error); }
  return data;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600); }
const waNum = (p) => { const d = String(p).replace(/\D/g, ''); return d.startsWith('0') ? '254' + d.slice(1) : d; };
const waUrl = (p, msg) => `https://wa.me/${waNum(p)}?text=${encodeURIComponent(msg || '')}`;
function modal(html) { $('#ovc').className = 'modal wide'; $('#ovc').innerHTML = html; $('#ov').classList.add('open'); }
function closeModal() { $('#ov').classList.remove('open'); }
$('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov' || e.target.matches('[data-close]')) closeModal(); });

// ---- auth ----
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#lf').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await A('POST', '/login', Object.fromEntries(new FormData(e.target))); $('#le').textContent = ''; start(); }
  catch (er) { $('#le').textContent = er.message === 'auth' ? '' : er.message; }
});
$('#logout').onclick = async () => { await A('POST', '/logout'); showLogin(); };
$('#menu').onclick = () => $('#side').classList.toggle('open');

const views = { dash, quotes, invoices, bookings, reminders, payables, contractors, clients, projects, reports, users, packages, media, blog, visitors, settings };
let ME = {};
let current = 'dash';
async function go(v) {
  current = v;
  document.querySelectorAll('.side .nav[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#side').classList.remove('open');
  $('#main').innerHTML = '<p>Loading…</p>';
  try { await views[v](); } catch (e) { if (e.message !== 'auth') $('#main').innerHTML = '<p>Could not load this page.</p>'; }
}
document.querySelectorAll('.side .nav[data-v]').forEach((b) => (b.onclick = () => go(b.dataset.v)));
async function start() {
  ME = await A('GET', '/me');
  document.querySelectorAll('[data-admin]').forEach((b) => b.classList.toggle('hidden', ME.role !== 'admin'));
  if (ME.role !== 'admin' && ['reports', 'users', 'contractors', 'clients'].includes(current)) current = 'dash';
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); go(current);
}
start().catch(() => showLogin());

const stat = (v, l, cls = '') => `<div class="card ${cls}"><b>${v}</b><span>${l}</span></div>`;

// ---- dashboard ----
async function dash() {
  const s = await A('GET', '/stats');
  const max = Math.max(1, ...s.days.map((d) => d.views));
  $('#main').innerHTML = `<h2>Dashboard</h2>
  <div class="cards">${stat(s.visitorsToday, 'Visitors today')}${stat(s.visitors30, 'Visitors (30 days)')}${stat(s.views30, 'Page views (30 days)')}
    ${stat(s.newQuotes, 'New quotes', 'r')}${stat(kes(s.unpaid), 'Unpaid invoices', 'r')}${stat(s.photos, 'Photos')}${stat(s.videos, 'Videos')}</div>
  <div class="panel"><h3>Page views, last 14 days</h3>
    <div class="bars" style="margin-bottom:26px">${s.days.map((d) => `<div style="height:${(d.views / max) * 100}%" title="${d.views} views, ${d.visitors} visitors"><i>${d.d.slice(5)}</i></div>`).join('') || '<span class="lead">No visits yet.</span>'}</div></div>
  <div class="panel" id="attn"></div>
  <div class="two">
    <div class="panel"><h3>Top pages</h3><table>${s.topPages.map((p) => `<tr><td>${esc(p.path)}</td><td>${p.views}</td></tr>`).join('') || '<tr><td>No data yet</td></tr>'}</table></div>
    <div class="panel"><h3>Devices &amp; sources</h3><table>${s.devices.map((p) => `<tr><td>${esc(p.device)}</td><td>${p.n} visitors</td></tr>`).join('')}
      ${s.referrers.map((p) => `<tr><td>${esc(p.referrer.slice(0, 40))}</td><td>${p.n}</td></tr>`).join('')}</table></div>
  </div>`;
  attention().catch(() => {});
}

async function attention() {
  const r = await A('GET', '/reminders');
  const el = $('#attn');
  if (!el) return;
  const n = r.payments.length + r.shoots.length;
  el.innerHTML = `<h3>Needs attention</h3><div class="cards" style="margin-bottom:8px">${stat(r.payments.length, 'Payments to chase', r.payments.length ? 'r' : '')}${stat(r.shoots.length, 'Shoots in 7 days')}${stat(r.inProgress.length, 'Jobs in progress')}</div>
    ${n ? `<p style="margin:0">${r.shoots.slice(0, 3).map((b) => `<span class="pill red">${esc(b.event_date)}</span> ${esc(b.client_name)} - ${esc(b.package_name)}`).join('<br>')}</p>` : ''}
    <p style="margin:10px 0 0"><button class="btn btn-red btn-sm" data-go="reminders">Open reminders</button> <button class="btn btn-ghost btn-sm" data-go="bookings">View bookings</button></p>`;
  el.onclick = (e) => { if (e.target.dataset.go) go(e.target.dataset.go); };
}

// ---- generic form builder ----
const fld = (label, name, val = '', type = 'text', extra = '') => `<label>${label}</label><input name="${name}" type="${type}" value="${esc(val)}" ${extra}>`;
const area = (label, name, val = '', rows = 5) => `<label>${label}</label><textarea name="${name}" rows="${rows}">${esc(val)}</textarea>`;
const sel = (label, name, opts, val) => `<label>${label}</label><select name="${name}">${opts.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const formData = (f) => Object.fromEntries(new FormData(f));

// ---- quotes ----
async function quotes() {
  const rows = await A('GET', '/quotes');
  $('#main').innerHTML = `<h2>Quotes</h2><div class="panel"><table>
  <tr><th>No.</th><th>Client</th><th>Package</th><th>Event</th><th>Total</th><th>Status</th><th></th></tr>
  ${rows.map((q) => `<tr>
    <td>${esc(q.number)}<br><small>${q.created_at.slice(0, 10)}</small></td>
    <td>${esc(q.client_name)}<br><small>${esc(q.phone)}</small></td>
    <td>${esc(q.package_name)}</td><td>${esc(q.event_type)}<br><small>${esc(q.event_date)}</small></td>
    <td>${kes(q.price - q.discount)}</td>
    <td><span class="pill ${q.status === 'new' ? 'red' : q.status === 'invoiced' ? 'green' : ''}">${esc(q.status)}</span></td>
    <td><div class="acts">
      <a class="btn btn-ghost" href="#" data-viewpdf="/api/admin/quotes/${q.id}/pdf" data-title="Quotation ${esc(q.number)}">View</a><a class="btn btn-ghost" href="/api/admin/quotes/${q.id}/pdf">PDF</a>
      <button class="btn btn-ghost" data-edit="${q.id}">Edit</button>
      <a class="btn btn-ghost" target="_blank" href="${waUrl(q.phone, `Hello ${q.client_name}, this is Shepherd Media Group regarding your quotation ${q.number}.`)}">WhatsApp</a>
      ${q.invoice_id ? `<button class="btn btn-blue" data-goinv>View invoice</button>` : `<button class="btn btn-red" data-inv="${q.id}">Make invoice</button>`}
      <button class="btn btn-del" data-del="${q.id}">Delete</button>
    </div></td></tr>`).join('') || '<tr><td colspan="7">No quotes yet. They appear here when clients request them on the website.</td></tr>'}
  </table></div>`;
  const byId = (id) => rows.find((r) => r.id == id);
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.goinv !== undefined) go('invoices');
    if (t.dataset.inv) { await A('POST', `/quotes/${t.dataset.inv}/invoice`); toast('Invoice created'); go('invoices'); }
    if (t.dataset.del && confirm('Delete this quote?')) { await A('DELETE', `/quotes/${t.dataset.del}`); quotes(); }
    if (t.dataset.edit) {
      const q = byId(t.dataset.edit);
      modal(`<h3>Edit ${esc(q.number)}</h3><form id="ef">
        ${fld('Client', 'client_name', q.client_name)}<div class="row2">${fld('Phone', 'phone', q.phone)}${fld('Email', 'email', q.email)}</div>
        <div class="row2">${fld('Event date', 'event_date', q.event_date, 'date')}${fld('Venue', 'venue', q.venue)}</div>
        ${fld('Package name', 'package_name', q.package_name)}${area('What is included (one per line)', 'items', q.items, 7)}
        <div class="row2">${fld('Price (KES)', 'price', q.price, 'number', 'step="any"')}${fld('Discount (KES)', 'discount', q.discount, 'number', 'step="any"')}</div>
        ${area('Notes', 'notes', q.notes, 2)}${sel('Status', 'status', ['new', 'sent', 'accepted', 'declined', 'invoiced'], q.status)}
        <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
      $('#ef').onsubmit = async (ev) => { ev.preventDefault(); await A('PUT', `/quotes/${q.id}`, formData(ev.target)); closeModal(); toast('Saved'); quotes(); };
    }
  };
}

// ---- packages ----
let PKG_CATS = [];
async function packages() {
  const [rows, catRows] = await Promise.all([A('GET', '/packages'), A('GET', '/categories')]);
  PKG_CATS = catRows.map((c) => c.name);
  $('#main').innerHTML = `<h2>Packages</h2><p><button class="btn btn-red" id="add">+ Add package</button> <button class="btn btn-ghost" id="cats">Manage categories</button></p><div class="panel"><table>
  <tr><th></th><th>Category</th><th>Name</th><th>Price</th><th>Shown</th><th></th></tr>
  ${rows.map((p) => `<tr><td>${p.image ? `<img src="${esc(p.image)}" alt="" style="width:54px;height:40px;object-fit:cover;border-radius:6px">` : ''}</td><td>${esc(p.category)}</td><td>${esc(p.name)} ${p.popular ? '<span class="pill red">popular</span>' : ''}</td><td>${kes(p.price)}</td>
    <td>${p.active ? 'Yes' : 'Hidden'}</td>
    <td><div class="acts"><button class="btn btn-ghost" data-edit="${p.id}">Edit</button><button class="btn btn-del" data-del="${p.id}">Delete</button></div></td></tr>`).join('')}
  </table></div>`;
  const form = (p = {}) => {
    modal(`<h3>${p.id ? 'Edit' : 'New'} package</h3><form id="ef">
      ${sel('Category', 'category', PKG_CATS, p.category)}${fld('Name', 'name', p.name, 'text', 'required')}${fld('Tagline', 'tagline', p.tagline)}
      ${fld('Price (KES)', 'price', p.price ?? 0, 'number', 'step="any" required')}${area('What is included (one item per line)', 'features', p.features, 8)}
      <label>Package image ${p.image ? '(leave empty to keep current)' : ''}</label>
      ${p.image ? `<img src="${esc(p.image)}" alt="" style="width:100%;max-height:140px;object-fit:cover;border-radius:10px;margin-bottom:6px"><label style="font-weight:400"><input type="checkbox" name="remove_image" value="1" style="width:auto"> Remove current image</label>` : ''}
      <input type="file" name="image" accept="image/*">
      <div class="row2">${fld('Sort order', 'sort_order', p.sort_order ?? 0, 'number')}
      <div><label>Options</label><label style="font-weight:400"><input type="checkbox" name="popular" style="width:auto" ${p.popular ? 'checked' : ''}> Mark as most popular</label>
      <label style="font-weight:400"><input type="checkbox" name="active" style="width:auto" ${p.active !== 0 ? 'checked' : ''}> Show on website</label></div></div>
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    $('#ef').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = new FormData(ev.target);
      d.set('popular', ev.target.popular.checked ? '1' : '0'); d.set('active', ev.target.active.checked ? '1' : '0');
      if (!d.get('image').size) d.delete('image');
      await A(p.id ? 'PUT' : 'POST', p.id ? `/packages/${p.id}` : '/packages', d); closeModal(); toast('Saved'); packages();
    };
  };
  $('#cats').onclick = () => categoriesModal(catRows);
  $('#add').onclick = () => form();
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(rows.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this package?')) { await A('DELETE', `/packages/${t.dataset.del}`); packages(); }
  };
}

// ---- gallery + videos ----
const MEDIA_PAGE = 60;
const thumbHtml = (m) => `<div class="thumb" data-id="${m.id}">
    ${m.type === 'video' ? `<video src="${esc(m.file)}#t=0.5" preload="metadata"></video>` : `<img loading="lazy" src="${esc(m.file)}" alt="">`}
    <div><b>${esc(m.title)}</b><br><small>${esc(m.category)} · ♥ ${m.likes} · 👁 ${m.views}</small><div class="acts" style="margin-top:6px">
      <button class="btn btn-ghost" data-ren="${m.id}">Rename</button><button class="btn btn-del" data-del="${m.id}">Delete</button></div></div></div>`;

// Uploads go up in small batches, so there is no limit on how many photos can be added at once.
function uploadBatch(fd, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/media');
    xhr.upload.onprogress = (p) => onProgress(p.loaded);
    xhr.onload = () => { let r = {}; try { r = JSON.parse(xhr.responseText); } catch (e) {} xhr.status === 200 ? resolve(r) : reject(new Error(r.error || 'Upload failed')); };
    xhr.onerror = () => reject(new Error('Connection lost'));
    xhr.send(fd);
  });
}

async function media() {
  let items = [];
  let total = 0;
  const load = async () => { const r = await A('GET', `/media?limit=${MEDIA_PAGE}&offset=${items.length}`); total = r.total; items = items.concat(r.items); };
  await load();
  const draw = () => {
    $('#lib').innerHTML = items.map(thumbHtml).join('') || '<p>Nothing uploaded yet.</p>';
    $('#libTitle').textContent = `Library (${total})`;
    $('#more').style.display = items.length < total ? '' : 'none';
  };
  $('#main').innerHTML = `<h2>Gallery &amp; videos</h2>
  <div class="panel"><h3>Upload</h3><form id="uf">
    <div class="row2"><div><label>Category</label><select name="category">${MEDIA_CATS.map((c) => `<option>${c}</option>`).join('')}</select></div>${fld('Title (optional)', 'title')}</div>
    <label>Photos or videos (add as many as you like)</label>
    <div id="drop" style="border:2px dashed var(--line);border-radius:12px;padding:22px;text-align:center;background:var(--blue-soft)">
      <p style="margin:0 0 8px"><b>Drag and drop</b> photos and videos here, or</p>
      <input type="file" id="files" accept="image/*,video/*" multiple style="max-width:340px">
      <p id="picked" class="lead" style="margin:8px 0 0;font-size:.9rem">No files chosen</p></div>
    <p class="lead" style="margin:6px 0 0;font-size:.85rem">Large selections are sent a few at a time. Keep this page open until it says Done. The website picks Photo of the day, Photo of the month and Best memories from your photos automatically.</p>
    <p><button class="btn btn-red" id="ub">Upload</button> <span id="up"></span></p>
    <div id="bar" class="hidden" style="height:8px;background:var(--line);border-radius:6px;overflow:hidden"><div id="barin" style="height:100%;width:0;background:var(--red);transition:.2s"></div></div></form></div>
  <div class="panel"><h3 id="libTitle"></h3><div class="thumbs" id="lib"></div>
    <p style="text-align:center"><button class="btn btn-ghost" id="more">Show more</button></p></div>`;
  draw();
  const input = $('#files');
  const showPicked = () => { const n = input.files.length; $('#picked').textContent = n ? `${n} file(s) chosen (${(Array.from(input.files).reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MB)` : 'No files chosen'; };
  input.onchange = showPicked;
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = 'var(--red)'; }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = ''; }));
  drop.addEventListener('drop', (e) => { const dt = new DataTransfer(); Array.from(e.dataTransfer.files).filter((f) => /^(image|video)\//.test(f.type)).forEach((f) => dt.items.add(f)); input.files = dt.files; showPicked(); });

  $('#uf').onsubmit = async (e) => {
    e.preventDefault();
    const files = Array.from(input.files);
    if (!files.length) return toast('Choose some photos or videos first');
    const category = e.target.category.value;
    const title = e.target.title.value;
    const BATCH = 8;
    const skipped = [];
    const grand = files.reduce((s, f) => s + f.size, 0) || 1;
    let doneBytes = 0, uploaded = 0;
    $('#ub').disabled = true; $('#bar').classList.remove('hidden');
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const part = files.slice(i, i + BATCH);
        const partBytes = part.reduce((s, f) => s + f.size, 0);
        const fd = new FormData();
        fd.append('category', category); fd.append('title', title);
        part.forEach((f) => fd.append('files', f));
        const resp = await uploadBatch(fd, (loaded) => {
          $('#barin').style.width = Math.min(100, ((doneBytes + Math.min(loaded, partBytes)) / grand) * 100) + '%';
          $('#up').textContent = `${uploaded + part.length > files.length ? files.length : Math.min(i + BATCH, files.length)} of ${files.length}`;
        });
        doneBytes += partBytes; uploaded += resp.uploaded;
        skipped.push(...(resp.skipped || []));
      }
      toast(skipped.length ? `${uploaded} uploaded. Skipped (use JPG/PNG/MP4): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '...' : ''}` : `${uploaded} uploaded`);
      media();
    } catch (er) {
      toast(`${er.message}. ${uploaded} of ${files.length} were uploaded.`);
      $('#ub').disabled = false;
      if (uploaded) media();
    }
  };
  $('#more').onclick = async () => { await load(); draw(); };
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.del && confirm('Delete this file?')) { await A('DELETE', `/media/${t.dataset.del}`); items = items.filter((m) => m.id != t.dataset.del); total--; draw(); }
    if (t.dataset.ren) {
      const m = items.find((r) => r.id == t.dataset.ren);
      const title = prompt('Title', m.title);
      if (title === null) return;
      const category = prompt('Category (' + MEDIA_CATS.join(', ') + ')', m.category) || m.category;
      await A('PUT', `/media/${m.id}`, { title, category }); Object.assign(m, { title, category }); draw();
    }
  };
}

// ---- blog ----
async function blog() {
  const rows = await A('GET', '/posts');
  $('#main').innerHTML = `<h2>Blog</h2><p><button class="btn btn-red" id="add">+ New post</button></p><div class="panel"><table>
  <tr><th>Title</th><th>Date</th><th>Status</th><th></th></tr>
  ${rows.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.created_at.slice(0, 10)}</td><td><span class="pill ${p.published ? 'green' : ''}">${p.published ? 'Published' : 'Draft'}</span></td>
    <td><div class="acts"><a class="btn btn-ghost" target="_blank" href="/blog/${esc(p.slug)}">View</a><button class="btn btn-ghost" data-edit="${p.id}">Edit</button><button class="btn btn-del" data-del="${p.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="4">No posts yet.</td></tr>'}
  </table></div>`;
  const form = (p = {}) => {
    modal(`<h3>${p.id ? 'Edit' : 'New'} post</h3><form id="ef">
      ${fld('Title', 'title', p.title, 'text', 'required')}${fld('Short summary', 'excerpt', p.excerpt)}${area('Story (blank line = new paragraph)', 'body', p.body, 10)}
      <label>Cover photo ${p.cover ? '(leave empty to keep current)' : ''}</label><input type="file" name="cover" accept="image/*">
      ${sel('Status', 'published', ['Published', 'Draft'], p.published === 0 ? 'Draft' : 'Published')}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    $('#ef').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      fd.set('published', fd.get('published') === 'Draft' ? '0' : '1');
      if (!fd.get('cover').size) fd.delete('cover');
      await A(p.id ? 'PUT' : 'POST', p.id ? `/posts/${p.id}` : '/posts', fd); closeModal(); toast('Saved'); blog();
    };
  };
  $('#add').onclick = () => form();
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(rows.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this post?')) { await A('DELETE', `/posts/${t.dataset.del}`); blog(); }
  };
}

// ---- visitors ----
async function visitors() {
  const rows = await A('GET', '/visits');
  $('#main').innerHTML = `<h2>Visitors</h2><div class="panel"><p class="lead" style="margin-top:0">Latest 200 page views. Visitor IDs are anonymous hashes.</p><table>
  <tr><th>When</th><th>Visitor</th><th>Page</th><th>Came from</th><th>Device</th><th>IP</th></tr>
  ${rows.map((v) => `<tr><td>${v.created_at}</td><td>${esc(v.visitor.slice(0, 8))}</td><td>${esc(v.path)}</td><td>${esc(v.referrer.slice(0, 40))}</td><td>${esc(v.device)}</td><td>${esc(v.ip)}</td></tr>`).join('') || '<tr><td colspan="6">No visits yet.</td></tr>'}</table></div>`;
}

// ---- settings ----
async function settings() {
  const s = await A('GET', '/settings');
  const labels = { company_name: 'Company name', tagline: 'Tagline', phone: 'Phone (shown on site and documents)', whatsapp: 'WhatsApp number (international, no +)', email: 'Email', address: 'Address', ceo_name: 'CEO name', ceo_title: 'CEO title' };
  $('#main').innerHTML = `<h2>Settings</h2><div class="two"><div class="panel"><h3>Company details</h3><form id="sf">
    ${Object.entries(labels).map(([k, l]) => fld(l, k, s[k])).join('')}
    ${area('About text (home page)', 'about', s.about, 4)}${area('Quotation terms (printed on quotes)', 'quote_terms', s.quote_terms, 3)}${area('Payment details (printed on invoices)', 'payment_details', s.payment_details, 3)}
    <p><button class="btn btn-red">Save settings</button></p></form></div>
    <div class="panel"><h3>Change password</h3><form id="pf">${fld('Current password', 'current', '', 'password', 'required')}${fld('New password (8+ characters)', 'next', '', 'password', 'required')}
    <p><button class="btn btn-blue">Update password</button></p></form></div></div>`;
  $('#sf').onsubmit = async (e) => { e.preventDefault(); await A('PUT', '/settings', formData(e.target)); toast('Settings saved'); };
  $('#pf').onsubmit = async (e) => { e.preventDefault(); await A('POST', '/password', formData(e.target)); e.target.reset(); toast('Password updated'); };
}

async function categoriesModal(list) {
  modal(`<h3>Package categories</h3>
    <p class="lead" style="margin-top:0">These become the tabs on the Packages section of the website. Renaming a category updates its packages.</p>
    <table>${list.map((c) => `<tr><td>${esc(c.name)}<br><small>${c.packages} package(s)</small></td>
      <td><div class="acts" style="justify-content:flex-end"><button class="btn btn-ghost" data-ren="${c.id}">Rename</button><button class="btn btn-del" data-delc="${c.id}">Delete</button></div></td></tr>`).join('')}</table>
    <form id="cf" style="display:flex;gap:10px;margin-top:14px"><input name="name" placeholder="New category, e.g. Birthday" required><button class="btn btn-red">Add</button></form>
    <p style="margin-top:12px"><button class="btn btn-ghost" data-close>Done</button></p>`);
  const reload = async () => { await packages(); categoriesModal(await A('GET', '/categories')); };
  $('#cf').onsubmit = async (e) => { e.preventDefault(); await A('POST', '/categories', formData(e.target)); toast('Category added'); reload(); };
  document.querySelectorAll('#ovc [data-ren]').forEach((b) => (b.onclick = async () => {
    const c = list.find((x) => x.id == b.dataset.ren);
    const name = prompt('New name', c.name);
    if (!name || name === c.name) return;
    await A('PUT', `/categories/${c.id}`, { name }); toast('Renamed'); reload();
  }));
  document.querySelectorAll('#ovc [data-delc]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this category?')) return;
    await A('DELETE', `/categories/${b.dataset.delc}`); toast('Deleted'); reload();
  }));
}
