// Contractors (freelance crew) and registered clients, plus the in-page PDF viewer.

// ---- PDF viewer: View button shows the report/receipt/invoice right in the page ----
// Pages are drawn with PDF.js (served from /vendor), so it also works on phones and in browsers without a PDF plugin.
const inlineUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'inline=1';
let pdfjsReady = null;
const loadPdfJs = () => pdfjsReady || (pdfjsReady = new Promise((resolve, reject) => {
  const sc = document.createElement('script');
  sc.src = '/vendor/pdf.min.js';
  sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; resolve(); };
  sc.onerror = () => { pdfjsReady = null; reject(new Error('viewer not available')); };
  document.head.appendChild(sc);
}));

async function viewPdf(url, title) {
  modal(`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 style="margin:0">${esc(title || 'Document')}</h3>
      <div class="acts"><a class="btn btn-red btn-sm" href="${esc(url)}">Download PDF</a><a class="btn btn-ghost btn-sm" target="_blank" href="${esc(inlineUrl(url))}">Open / Print</a><button class="btn btn-ghost btn-sm" data-close>Close</button></div></div>
    <div id="pdfbox" style="height:74vh;overflow:auto;background:#6b7280;border-radius:10px;margin-top:12px;padding:10px;text-align:center"><p style="color:#fff">Loading…</p></div>`);
  $('#ovc').classList.add('xl');
  const box = $('#pdfbox');
  try {
    await loadPdfJs();
    const doc = await window.pdfjsLib.getDocument({ url, withCredentials: true }).promise;
    box.innerHTML = '';
    const width = Math.min(box.clientWidth - 20, 820);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      c.style.cssText = `width:${width}px;height:${(width / base.width) * base.height}px;background:#fff;display:block;margin:0 auto 10px;box-shadow:0 2px 10px rgba(0,0,0,.4)`;
      box.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    box.innerHTML = `<p style="color:#fff">Could not show a preview here. Use <b>Download PDF</b> or <b>Open / Print</b>.</p>`;
  }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-viewpdf]');
  if (a) { e.preventDefault(); viewPdf(a.dataset.viewpdf, a.dataset.title); }
});

// ---- contractors ----
async function contractors() {
  const { roles, items } = await A('GET', '/contractors');
  const owedAll = items.reduce((s, c) => s + Number(c.owed), 0);
  $('#main').innerHTML = `<h2>Contractors</h2>
  <p class="lead" style="margin-top:-8px">Freelance photographers, videographers, editors and other crew you hire. Give a contractor a job on a booking with the agreed fee and it becomes a bill you owe, paid in full or in parts.</p>
  <div class="cards">${stat(items.length, 'Contractors')}${stat(kes(items.reduce((s, c) => s + Number(c.fees), 0)), 'Fees agreed')}${stat(kes(items.reduce((s, c) => s + Number(c.paid), 0)), 'Paid')}${stat(kes(owedAll), 'Still owed to contractors', owedAll > 0 ? 'r' : '')}</div>
  <p><button class="btn btn-red" id="add">+ Add contractor</button>
    <a class="btn btn-ghost" data-viewpdf="/api/admin/reports/pdf?type=contractors" data-title="Contractors report" href="#">View contractors report</a>
    <a class="btn btn-ghost" data-viewpdf="/api/admin/reports/pdf?type=money-owed" data-title="Money owed report" href="#">View money owed</a></p>
  <div class="panel"><table><tr><th>Name</th><th>Role</th><th>Rate</th><th>Jobs</th><th>Fees</th><th>Paid</th><th>Owed</th><th>Status</th><th></th></tr>
  ${items.map((c) => `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.phone)}</small></td><td>${esc(c.role)}</td><td><small>${esc(c.rate)}</small></td><td>${c.jobs}</td><td>${kes(c.fees)}</td><td>${kes(c.paid)}</td>
    <td><b>${kes(c.owed)}</b></td><td><span class="pill ${c.active ? 'green' : ''}">${c.active ? 'Active' : 'Inactive'}</span></td>
    <td><div class="acts"><button class="btn btn-red" data-jobs="${c.id}">Jobs &amp; payments</button><button class="btn btn-ghost" data-edit="${c.id}">Edit</button>
    <a class="btn btn-ghost" href="#" data-viewpdf="/api/admin/contractors/${c.id}/statement" data-title="Statement: ${esc(c.name)}">Statement</a>
    ${c.phone ? `<a class="btn btn-ghost" target="_blank" href="${waUrl(c.phone, `Hello ${c.name}, this is Shepherd Media Group.`)}">WhatsApp</a>` : ''}
    <button class="btn btn-del" data-del="${c.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="9">No contractors yet. Add the photographers and videographers you work with.</td></tr>'}</table></div>`;

  const form = (c = {}) => {
    modal(`<h3>${c.id ? 'Edit' : 'New'} contractor</h3><form id="ef">
      ${fld('Full name', 'name', c.name, 'text', 'required')}<div class="row2">${sel('Role', 'role', roles, c.role || 'Photographer')}${fld('Phone / WhatsApp', 'phone', c.phone)}</div>
      ${fld('Email', 'email', c.email, 'email')}${fld('Usual rate (note only)', 'rate', c.rate, 'text', 'placeholder="e.g. KES 8,000 per event"')}${area('Notes (equipment, availability, M-Pesa number)', 'notes', c.notes, 3)}
      ${sel('Status', 'active', ['Active', 'Inactive'], c.active === 0 ? 'Inactive' : 'Active')}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    $('#ef').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = formData(ev.target); d.active = d.active === 'Active' ? '1' : '0';
      await A(c.id ? 'PUT' : 'POST', c.id ? `/contractors/${c.id}` : '/contractors', d); closeModal(); toast('Saved'); contractors();
    };
  };
  $('#add').onclick = () => form();
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(items.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this contractor?')) { await A('DELETE', `/contractors/${t.dataset.del}`); contractors(); }
    if (t.dataset.jobs) contractorJobs(t.dataset.jobs, contractors);
  };
}

async function contractorJobs(id, refresh) {
  const { contractor: c, jobs } = await A('GET', `/contractors/${id}`);
  const again = async () => { await refresh(); contractorJobs(id, refresh); };
  modal(`<h3>${esc(c.name)} <small class="lead">${esc(c.role)}</small></h3>
    <div class="cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">${stat(kes(c.fees), 'Fees agreed')}${stat(kes(c.paid), 'Paid')}${stat(kes(c.owed), 'Owed', c.owed > 0 ? 'r' : '')}</div>
    <table><tr><th>Job</th><th>Fee</th><th>Paid</th><th>Balance</th><th></th></tr>
    ${jobs.map((j) => `<tr><td>${esc(j.job)}<br><small>${esc(j.event_date || '')} ${esc(j.invoice_number || '')}</small></td><td>${kes(j.fee)}</td><td>${kes(j.paid)}</td><td><b>${kes(j.fee - j.paid)}</b></td>
      <td><div class="acts"><button class="btn btn-red btn-sm" data-pay="${j.payable_id}" data-title="${esc(j.job)}" data-fee="${j.fee}">${j.status === 'paid' ? 'Payments' : 'Pay'}</button>
      <button class="btn btn-ghost btn-sm" data-fee-edit="${j.id}">Edit fee</button><button class="btn btn-del btn-sm" data-rm="${j.id}">Remove</button></div></td></tr>`).join('') || '<tr><td colspan="5">No jobs yet.</td></tr>'}</table>
    <p style="margin-top:14px"><button class="btn btn-blue btn-sm" id="newjob">+ Give a job</button> <button class="btn btn-ghost btn-sm" data-close>Close</button></p>`);
  document.querySelectorAll('#ovc [data-pay]').forEach((b) => (b.onclick = () =>
    paymentsModal('payables', b.dataset.pay, `${c.name} · ${b.dataset.title}`, Number(b.dataset.fee), async () => { await refresh(); }).then(() => {})));
  document.querySelectorAll('#ovc [data-rm]').forEach((b) => (b.onclick = async () => { if (confirm('Remove this job?')) { await A('DELETE', `/assignments/${b.dataset.rm}`); again(); } }));
  document.querySelectorAll('#ovc [data-fee-edit]').forEach((b) => (b.onclick = async () => {
    const j = jobs.find((x) => x.id == b.dataset.feeEdit);
    const fee = prompt('Agreed fee (KES)', j.fee);
    if (fee === null) return;
    await A('PUT', `/assignments/${j.id}`, { fee, job: j.job, due_date: j.due_date }); toast('Fee updated'); again();
  }));
  $('#newjob').onclick = () => assignModal(c.id, again);
}

// Give a contractor a job, optionally on a booking
async function assignModal(contractorId, done, invoiceId) {
  const [{ items }, bk] = await Promise.all([A('GET', '/contractors'), A('GET', '/bookings')]);
  const active = items.filter((c) => c.active);
  const open = bk.filter((b) => b.booking.code !== 'completed');
  modal(`<h3>Give a job</h3><form id="af">
    <label>Contractor</label><select name="contractor_id" required>${active.map((c) => `<option value="${c.id}" ${c.id == contractorId ? 'selected' : ''}>${esc(c.name)} (${esc(c.role)})</option>`).join('')}</select>
    <label>Booking</label><select name="invoice_id" id="abk"><option value="">Not linked to a booking</option>${open.map((b) => `<option value="${b.id}" ${b.id == invoiceId ? 'selected' : ''}>${esc(b.number)} · ${esc(b.client_name)} · ${esc(b.event_date || 'date TBC')}</option>`).join('')}</select>
    ${fld('What they will do', 'job', '', 'text', 'placeholder="e.g. Second photographer, ceremony and reception"')}
    <div class="row2">${fld('Agreed fee (KES)', 'fee', '', 'number', 'step="any" min="1" required')}${fld('Pay by (optional)', 'due_date', '', 'date')}</div>
    <p class="lead" style="font-size:.85rem">This adds a bill under Payables. You can pay it in full or in parts.</p>
    <div style="margin-top:10px;display:flex;gap:10px"><button class="btn btn-red">Save job</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
  $('#af').onsubmit = async (e) => { e.preventDefault(); await A('POST', '/assignments', formData(e.target)); closeModal(); toast('Job added'); if (done) done(); };
}

// ---- registered clients ----
async function clients() {
  const rows = await A('GET', '/clients');
  $('#main').innerHTML = `<h2>Client accounts</h2>
  <p class="lead" style="margin-top:-8px">People who created an account on the website. They see their own quotations, invoices, receipts and project links. If a client forgets their password, edit the account and set a new one, then send it to them.</p>
  <div class="panel"><table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Quotes</th><th>Invoices</th><th>Joined</th><th>Last sign-in</th><th>Status</th><th></th></tr>
  ${rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${c.quotes}</td><td>${c.invoices}</td><td>${c.created_at.slice(0, 10)}</td><td>${esc(c.last_login || 'Never')}</td>
    <td><span class="pill ${c.active ? 'green' : ''}">${c.active ? 'Active' : 'Disabled'}</span></td>
    <td><div class="acts"><button class="btn btn-ghost" data-edit="${c.id}">Edit</button>${c.phone ? `<a class="btn btn-ghost" target="_blank" href="${waUrl(c.phone, `Hello ${c.name}, this is Shepherd Media Group.`)}">WhatsApp</a>` : ''}<button class="btn btn-del" data-del="${c.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="9">No client accounts yet.</td></tr>'}</table></div>`;
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.del && confirm('Delete this client account? Their quotations stay, but are no longer linked to an account.')) { await A('DELETE', `/clients/${t.dataset.del}`); clients(); }
    if (t.dataset.edit) {
      const c = rows.find((r) => r.id == t.dataset.edit);
      modal(`<h3>Edit client account</h3><form id="ef">
        ${fld('Name', 'name', c.name, 'text', 'required')}${fld('Email', 'email', c.email, 'email', 'required')}${fld('Phone', 'phone', c.phone)}
        ${sel('Status', 'active', ['Active', 'Disabled'], c.active ? 'Active' : 'Disabled')}
        ${fld('New password (leave empty to keep)', 'password', '', 'password')}
        <p class="lead" style="font-size:.85rem">Passwords need 8+ characters with a letter and a number. Setting a new password signs the client out everywhere.</p>
        <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
      $('#ef').onsubmit = async (ev) => {
        ev.preventDefault();
        const d = formData(ev.target); d.active = d.active === 'Active' ? '1' : '0';
        await A('PUT', `/clients/${c.id}`, d); closeModal(); toast('Saved'); clients();
      };
    }
  };
}
