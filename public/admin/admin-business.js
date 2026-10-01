// Invoices & payments, payables, client projects, reports and users (back office views)
const METHODS = ['M-Pesa', 'Cash', 'Bank transfer', 'Cheque', 'Card', 'Other'];
const today = (off = 0) => new Date(Date.now() + off * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const receiptLink = (p) => `${location.origin}/api/public/receipts/${p.token}/pdf`;
const payRows = (list, delPath, ctx) => list.length ? `<table><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th>Receipt</th><th></th></tr>${list.map((p) =>
  `<tr><td>${esc(String(p.paid_at).slice(0, 10))}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td><td>${kes(p.amount)}</td>
   <td>${ctx ? `<small>${esc(p.receipt_number || '')}</small><div class="acts"><a class="btn btn-ghost btn-sm" href="#" data-viewpdf="/api/admin/payments/${p.id}/receipt" data-title="Receipt ${esc(p.receipt_number || '')}">View</a>
     <a class="btn btn-ghost btn-sm" href="/api/admin/payments/${p.id}/receipt">Download</a>
     <a class="btn btn-ghost btn-sm" target="_blank" href="/api/admin/payments/${p.id}/receipt?inline=1">Print</a>
     <a class="btn btn-ghost btn-sm" target="_blank" href="${waUrl(ctx.phone, `Hello ${ctx.client}, thank you for your payment of ${kes(p.amount)}. Your receipt ${p.receipt_number}: ${receiptLink(p)}  - Shepherd Media Group`)}">Send to client</a></div>` : ''}</td>
   <td>${ME.role === 'admin' ? `<button class="btn btn-del btn-sm" data-undo="${p.id}" data-path="${delPath}">Undo</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="lead" style="margin:6px 0">No payments yet.</p>';

async function paymentsModal(kind, id, title, total, refresh, ctx) {
  // kind: 'invoices' (money in, with receipts) or 'payables' (money out)
  const list = await A('GET', `/${kind}/${id}/payments`);
  const paid = list.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(total - paid, 0);
  const again = async () => { await refresh(); paymentsModal(kind, id, title, total, refresh, ctx); };
  modal(`<h3>${esc(title)}</h3>
    <div class="cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">${stat(kes(total), 'Total')}${stat(kes(paid), kind === 'invoices' ? 'Received' : 'Paid')}${stat(kes(balance), 'Balance', 'r')}</div>
    ${payRows(list, kind === 'invoices' ? 'payments' : 'payable-payments', kind === 'invoices' ? ctx : null)}
    ${balance > 0 ? `<h3 style="margin-top:16px;font-size:1.05rem">Record a ${kind === 'invoices' ? 'payment received' : 'payment made'}</h3><form id="pf">
      <div class="row2">${fld('Amount (KES)', 'amount', balance, 'number', 'step="any" min="1" required')}${fld('Date', 'paid_at', today(), 'date')}</div>
      <div class="row2">${sel('Method', 'method', METHODS, 'M-Pesa')}${fld('Reference (e.g. M-Pesa code)', 'reference')}</div>
      <p class="lead" style="font-size:.85rem;margin:6px 0">Part payment is fine: enter less than the balance and the rest stays open.${kind === 'invoices' ? ' A receipt is created for every payment.' : ''}</p>
      <div style="display:flex;gap:10px"><button class="btn btn-red">Save payment</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></form>`
      : '<p><span class="pill green">Fully settled</span> <button class="btn btn-ghost btn-sm" data-close>Close</button></p>'}`);
  const f = $('#pf');
  if (f) f.onsubmit = async (e) => { e.preventDefault(); await A('POST', `/${kind}/${id}/payments`, formData(f)); toast(kind === 'invoices' ? 'Payment saved. Receipt is ready below.' : 'Payment saved'); again(); };
  document.querySelectorAll('#ovc [data-undo]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this payment record? Its receipt will stop working.')) return;
    await A('DELETE', `/${b.dataset.path}/${b.dataset.undo}`); toast('Removed'); again();
  }));
}

async function invoices() {
  const rows = await A('GET', '/invoices');
  const late = (i) => i.status !== 'paid' && i.due_date && i.due_date < today();
  $('#main').innerHTML = `<h2>Invoices &amp; payments</h2><div class="panel"><table>
  <tr><th>No.</th><th>Client</th><th>Package</th><th>Total</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th></th></tr>
  ${rows.map((i) => { const bal = i.amount - i.discount - i.paid; return `<tr class="${late(i) ? 'od' : ''}">
    <td>${esc(i.number)}<br><small>${i.created_at.slice(0, 10)}</small></td><td>${esc(i.client_name)}<br><small>${esc(i.phone)}</small></td>
    <td>${esc(i.package_name)}</td><td>${kes(i.amount - i.discount)}</td><td>${kes(i.paid)}</td><td><b>${kes(bal)}</b></td><td>${esc(i.due_date)}${late(i) ? '<br><small style="color:var(--red)">overdue</small>' : ''}</td>
    <td><span class="pill ${i.status === 'paid' ? 'green' : i.status === 'partial' ? '' : 'red'}">${esc(i.status)}</span></td>
    <td><div class="acts"><button class="btn btn-red" data-pay="${i.id}">${i.status === 'paid' ? 'Payments & receipts' : 'Add payment'}</button>
      <a class="btn btn-ghost" href="#" data-viewpdf="/api/admin/invoices/${i.id}/pdf" data-title="Invoice ${esc(i.number)}">View</a><a class="btn btn-ghost" href="/api/admin/invoices/${i.id}/pdf">PDF</a>
      <button class="btn btn-ghost" data-edit="${i.id}">Edit</button>
      <a class="btn btn-ghost" target="_blank" href="${waUrl(i.phone, `Hello ${i.client_name}, invoice ${i.number}: total ${kes(i.amount - i.discount)}, paid ${kes(i.paid)}, balance ${kes(bal)}. Thank you. Shepherd Media Group.`)}">WhatsApp</a>
      ${ME.role === 'admin' ? `<button class="btn btn-del" data-del="${i.id}">Delete</button>` : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="9">No invoices yet. Open a quote and press "Make invoice".</td></tr>'}
  </table></div>`;
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.del && confirm('Delete this invoice and its payment records? The quote becomes editable again.')) { await A('DELETE', `/invoices/${t.dataset.del}`); invoices(); }
    if (t.dataset.pay) {
      const i = rows.find((r) => r.id == t.dataset.pay);
      paymentsModal('invoices', i.id, `${i.number} · ${i.client_name}`, i.amount - i.discount, () => invoices(), { phone: i.phone, client: i.client_name });
    }
    if (t.dataset.edit) {
      const i = rows.find((r) => r.id == t.dataset.edit);
      modal(`<h3>Edit ${esc(i.number)}</h3><form id="ef">
        ${fld('Client', 'client_name', i.client_name)}<div class="row2">${fld('Phone', 'phone', i.phone)}${fld('Email', 'email', i.email)}</div>
        <div class="row2">${fld('Event date', 'event_date', i.event_date, 'date')}${fld('Venue', 'venue', i.venue)}</div>
        ${fld('Package name', 'package_name', i.package_name)}${area('What is included (one per line)', 'items', i.items, 6)}
        <div class="row2">${fld('Amount (KES)', 'amount', i.amount, 'number', 'step="any"')}${fld('Discount (KES)', 'discount', i.discount, 'number', 'step="any"')}</div>
        ${fld('Due date', 'due_date', i.due_date, 'date')}${area('Notes', 'notes', i.notes, 2)}
        <p class="lead" style="font-size:.85rem">Payments are recorded with the "Add payment" button, so the paid amount and status always match the payment records.</p>
        <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
      $('#ef').onsubmit = async (ev) => { ev.preventDefault(); await A('PUT', `/invoices/${i.id}`, formData(ev.target)); closeModal(); toast('Saved'); invoices(); };
    }
  };
}

// ---- payables ----
const PAY_CATS = ['Equipment', 'Staff / freelancers', 'Transport', 'Rent & utilities', 'Software & internet', 'Marketing', 'Other'];
async function payables() {
  const rows = await A('GET', '/payables');
  const open = rows.filter((p) => p.status !== 'paid').reduce((s, p) => s + (p.amount - p.paid), 0);
  const late = (p) => p.status !== 'paid' && p.due_date && p.due_date < today();
  const overdue = rows.filter(late).reduce((s, p) => s + (p.amount - p.paid), 0);
  $('#main').innerHTML = `<h2>Payables</h2>
  <div class="cards">${stat(kes(open), 'Owed to suppliers', 'r')}${stat(kes(overdue), 'Overdue')}${stat(rows.filter((p) => p.status !== 'paid').length, 'Open bills')}</div>
  <p><button class="btn btn-red" id="add">+ Add bill</button></p>
  <div class="panel"><table><tr><th>Supplier</th><th>For</th><th>Category</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th></th></tr>
  ${rows.map((p) => `<tr class="${late(p) ? 'od' : ''}"><td>${esc(p.supplier)}</td><td>${esc(p.description)}</td><td>${esc(p.category)}</td><td>${kes(p.amount)}</td><td>${kes(p.paid)}</td><td><b>${kes(p.amount - p.paid)}</b></td>
    <td>${esc(p.due_date)}${late(p) ? '<br><small style="color:var(--red)">overdue</small>' : ''}</td>
    <td><span class="pill ${p.status === 'paid' ? 'green' : p.status === 'partial' ? '' : 'red'}">${esc(p.status)}</span></td>
    <td><div class="acts"><button class="btn btn-red" data-pay="${p.id}">${p.status === 'paid' ? 'Payments' : 'Pay'}</button><button class="btn btn-ghost" data-edit="${p.id}">Edit</button>
    ${ME.role === 'admin' ? `<button class="btn btn-del" data-del="${p.id}">Delete</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9">No bills recorded. Add what the business owes: equipment, freelancers, transport, rent.</td></tr>'}</table></div>`;
  const form = (p = {}) => {
    modal(`<h3>${p.id ? 'Edit' : 'New'} bill</h3><form id="ef">
      ${fld('Supplier / who is owed', 'supplier', p.supplier, 'text', 'required')}${fld('What it is for', 'description', p.description)}
      <div class="row2">${sel('Category', 'category', PAY_CATS, p.category)}${fld('Amount (KES)', 'amount', p.amount ?? '', 'number', 'step="any" min="1" required')}</div>
      ${fld('Due date', 'due_date', p.due_date, 'date')}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    $('#ef').onsubmit = async (ev) => { ev.preventDefault(); await A(p.id ? 'PUT' : 'POST', p.id ? `/payables/${p.id}` : '/payables', formData(ev.target)); closeModal(); toast('Saved'); payables(); };
  };
  $('#add').onclick = () => form();
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(rows.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this bill and its payments?')) { await A('DELETE', `/payables/${t.dataset.del}`); payables(); }
    if (t.dataset.pay) {
      const p = rows.find((r) => r.id == t.dataset.pay);
      paymentsModal('payables', p.id, `${p.supplier} · ${p.description || p.category}`, p.amount, () => payables());
    }
  };
}

// ---- client projects ----
async function projects() {
  const rows = await A('GET', '/projects');
  const link = (p) => `${location.origin}/project.html?t=${p.token}`;
  $('#main').innerHTML = `<h2>Client projects</h2>
  <p class="lead" style="margin-top:-8px">Add the link to a client's finished photos or videos (Google Drive, Dropbox, YouTube, etc.). Clients find it on the website under "My project" using their reference number and phone, or you can send them the direct link.</p>
  <p><button class="btn btn-red" id="add">+ Add project link</button></p>
  <p class="lead" style="font-size:.88rem">Adding a link marks that booking as <b>Completed</b>.</p>
  <div class="panel"><table><tr><th>Client</th><th>Project</th><th>Link</th><th>Added</th><th></th></tr>
  ${rows.map((p) => `<tr><td>${esc(p.client_name)}<br><small>${esc(p.phone)} ${esc(p.quote_number)}</small></td><td>${esc(p.title)}<br><small>${esc(p.note)}</small></td>
    <td><a href="${esc(p.url)}" target="_blank" rel="noopener">Open ↗</a><br>${p.views ? `<span class="pill green">Viewed by client (${p.views})</span>` : '<span class="pill">Not viewed yet</span>'}</td><td>${p.created_at.slice(0, 10)}</td>
    <td><div class="acts"><button class="btn btn-ghost" data-copy="${p.id}">Copy client link</button>
    ${p.phone ? `<a class="btn btn-ghost" target="_blank" href="${waUrl(p.phone, `Hello ${p.client_name}, your ${p.title} is ready: ${link(p)}  - Shepherd Media Group`)}">Send on WhatsApp</a>` : ''}
    <button class="btn btn-ghost" data-edit="${p.id}">Edit</button><button class="btn btn-del" data-del="${p.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="5">No project links yet.</td></tr>'}</table></div>`;
  const quotesP = Promise.all([A('GET', '/invoices'), A('GET', '/quotes')]).then(([inv, qs]) => [...inv.map((i) => ({ number: i.number, client_name: i.client_name, phone: i.phone, package_name: i.package_name, tag: 'booking' })), ...qs.filter((q) => !q.invoice_id).map((q) => ({ number: q.number, client_name: q.client_name, phone: q.phone, package_name: q.package_name, tag: 'quote' }))]);
  const form = async (p = {}, pre = null) => {
    const qs = await quotesP;
    modal(`<h3>${p.id ? 'Edit' : 'New'} project link</h3><form id="ef">
      ${p.id ? '' : `<label>Pick a client from quotes (optional)</label><select id="pick"><option value="">-- choose --</option>${qs.map((q, n) => `<option value="${n}">${esc(q.number)} · ${esc(q.client_name)} (${q.tag})</option>`).join('')}</select>`}
      ${fld('Client name', 'client_name', p.client_name, 'text', 'required')}<div class="row2">${fld('Client phone', 'phone', p.phone)}${fld('Quote / invoice number', 'quote_number', p.quote_number)}</div>
      ${fld('Project title', 'title', p.title, 'text', 'required placeholder="e.g. Wedding photos - Jane & Peter"')}
      ${fld('Link (https://...)', 'url', p.url, 'url', 'required placeholder="https://drive.google.com/..."')}${area('Message to the client (optional)', 'note', p.note, 2)}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    if (pre) { const f = $('#ef'); f.client_name.value = pre.client_name; f.phone.value = pre.phone || ''; f.quote_number.value = pre.number; f.title.value = `${pre.package_name} - ${pre.client_name}`; }
    const pick = $('#pick');
    if (pick) pick.onchange = () => { const q = qs[pick.value]; if (q) { const f = $('#ef'); f.client_name.value = q.client_name; f.phone.value = q.phone; f.quote_number.value = q.number; f.title.value = f.title.value || `${q.package_name} - ${q.client_name}`; } };
    $('#ef').onsubmit = async (ev) => { ev.preventDefault(); await A(p.id ? 'PUT' : 'POST', p.id ? `/projects/${p.id}` : '/projects', formData(ev.target)); closeModal(); toast('Saved'); projects(); };
  };
  $('#add').onclick = () => form();
  if (window.__prefillProject) { const pre = window.__prefillProject; window.__prefillProject = null; form({}, pre); }
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(rows.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this project link?')) { await A('DELETE', `/projects/${t.dataset.del}`); projects(); }
    if (t.dataset.copy) { const p = rows.find((r) => r.id == t.dataset.copy); try { await navigator.clipboard.writeText(link(p)); toast('Link copied'); } catch (er) { prompt('Copy this link', link(p)); } }
  };
}

// ---- reports ----
let rep = { from: '', to: '' };
async function reports() {
  const q = rep.from ? `?from=${rep.from}&to=${rep.to}` : '';
  const r = await A('GET', '/reports' + q);
  rep = { from: r.from, to: r.to };
  const max = Math.max(1, ...r.byMonth.map((m) => Math.max(m.invoiced, m.collected, m.expenses)));
  const csv = (type) => `/api/admin/reports/csv?type=${type}&from=${r.from}&to=${r.to}`;
  const pdf = (type, inline) => `/api/admin/reports/pdf?type=${type}&from=${r.from}&to=${r.to}${inline ? '&inline=1' : ''}`;
  $('#main').innerHTML = `<h2>Business reports</h2>
  <div class="panel"><form id="rf" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
    <div><label>From</label><input type="date" name="from" value="${r.from}"></div><div><label>To</label><input type="date" name="to" value="${r.to}"></div>
    <button class="btn btn-blue">Update</button>
    <span style="flex:1"></span>
    </form></div>
  <div class="panel"><h3>A4 reports</h3><p class="lead" style="margin-top:0">Every report downloads as an A4 PDF. "Print" opens the same PDF so you can print it straight from the browser.</p>
    <table>${[['summary', 'Business summary', 'Sales, money received, expenses, net cash, by month, service and client', 1],
      ['sales', 'Sales & payments received', 'Every payment received in the period, with receipt numbers', 'payments'],
      ['invoices', 'Invoices', 'All invoices raised in the period with paid and balance', 'invoices'],
      ['outstanding', 'Outstanding invoices', 'Who still owes you, with overdue marked (as at today)', 0],
      ['pending-bookings', 'Pending bookings', 'Booked and in-progress jobs not yet completed (as at today)', 0],
      ['expenses', 'Expenses paid', 'Every payment made to suppliers in the period', 'expenses'],
      ['payables', 'Payables', 'Open bills you still owe (as at today)', 0],
      ['money-owed', 'Money owed', 'Who owes you (clients) and who you owe (contractors and suppliers), with net position', 0],
      ['contractors', 'Contractors', 'Freelance crew: jobs, fees agreed, paid and still owed', 0]].map(([t, name, desc, c]) => `<tr><td><b>${name}</b><br><small>${desc}</small></td>
      <td><div class="acts" style="justify-content:flex-end"><a class="btn btn-blue" href="#" data-viewpdf="${pdf(t)}" data-title="${name}">View</a><a class="btn btn-red" href="${pdf(t)}">Download PDF</a><a class="btn btn-ghost" target="_blank" href="${pdf(t, 1)}">Print</a>${typeof c === 'string' ? `<a class="btn btn-ghost" href="${csv(c)}">CSV</a>` : ''}</div></td></tr>`).join('')}</table></div>
  <div class="cards">${stat(kes(r.invoiced), 'Invoiced (sales)')}${stat(kes(r.collected), 'Money received')}${stat(kes(r.expenses), 'Expenses paid')}${stat(kes(r.net), 'Net cash', r.net < 0 ? 'r' : '')}</div>
  <div class="cards">${stat(kes(r.receivable), 'Clients still owe you', 'r')}${stat(kes(r.overdueRecv), 'of which overdue')}${stat(kes(r.payable), 'You owe suppliers', 'r')}${stat(kes(r.overduePay), 'of which overdue')}${stat(`${r.quotesInvoiced}/${r.quotes}`, 'Quotes turned into invoices')}</div>
  <div class="panel"><h3>By month</h3><p class="legend lead" style="margin:0"><span style="background:var(--blue)"></span>Invoiced<span style="background:#2fa866"></span>Received<span style="background:var(--red)"></span>Expenses</p>
    <div class="bars2" style="margin-top:14px">${r.byMonth.map((m) => `<div class="m" title="${m.month}: invoiced ${kes(m.invoiced)}, received ${kes(m.collected)}, expenses ${kes(m.expenses)}">
      <b style="height:${(m.invoiced / max) * 100}%;background:var(--blue)"></b><b style="height:${(m.collected / max) * 100}%;background:#2fa866"></b><b style="height:${(m.expenses / max) * 100}%;background:var(--red)"></b><i>${m.month.slice(2)}</i></div>`).join('') || '<span class="lead">No activity in this period.</span>'}</div></div>
  <div class="two">
    <div class="panel"><h3>Sales by service</h3><table><tr><th>Service</th><th>Invoices</th><th>Invoiced</th><th>Received</th></tr>${r.byType.map((t) => `<tr><td>${esc(t.type)}</td><td>${t.invoices}</td><td>${kes(t.invoiced)}</td><td>${kes(t.collected)}</td></tr>`).join('') || '<tr><td colspan="4">No data</td></tr>'}</table></div>
    <div class="panel"><h3>Top clients</h3><table><tr><th>Client</th><th>Invoiced</th><th>Paid</th></tr>${r.topClients.map((t) => `<tr><td>${esc(t.client_name)}</td><td>${kes(t.invoiced)}</td><td>${kes(t.paid)}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>'}</table></div>
  </div>
  <div class="panel"><h3>Expenses by category</h3><table>${r.expByCat.map((t) => `<tr><td>${esc(t.category)}</td><td>${kes(t.total)}</td></tr>`).join('') || '<tr><td>No expenses paid in this period</td></tr>'}</table></div>`;
  $('#rf').onsubmit = (e) => { e.preventDefault(); rep = formData(e.target); reports(); };
}

// ---- users ----
async function users() {
  const rows = await A('GET', '/users');
  $('#main').innerHTML = `<h2>Users</h2>
  <p class="lead" style="margin-top:-8px"><b>Admin</b> can do everything. <b>Staff</b> can handle quotes, invoices, payments, bills, gallery, blog and client projects, but cannot see reports, manage users or change company settings.</p>
  <p><button class="btn btn-red" id="add">+ Add user</button></p>
  <div class="panel"><table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Created</th><th></th></tr>
  ${rows.map((u) => `<tr><td>${esc(u.name)}${u.id === ME.id ? ' <small>(you)</small>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td>
    <td><span class="pill ${u.role === 'admin' ? 'red' : ''}">${esc(u.role)}</span></td><td><span class="pill ${u.active ? 'green' : ''}">${u.active ? 'Active' : 'Disabled'}</span></td>
    <td>${esc(u.last_login || 'Never')}</td><td>${u.created_at.slice(0, 10)}</td>
    <td><div class="acts"><button class="btn btn-ghost" data-edit="${u.id}">Edit</button>${u.id === ME.id ? '' : `<button class="btn btn-del" data-del="${u.id}">Delete</button>`}</div></td></tr>`).join('')}</table></div>`;
  const form = (u = {}) => {
    modal(`<h3>${u.id ? 'Edit' : 'New'} user</h3><form id="ef">
      ${fld('Full name', 'name', u.name, 'text', 'required')}${fld('Email (used to sign in)', 'email', u.email, 'email', 'required')}${fld('Phone', 'phone', u.phone)}
      <div class="row2">${sel('Role', 'role', ['staff', 'admin'], u.role || 'staff')}${sel('Status', 'active', ['Active', 'Disabled'], u.active === 0 ? 'Disabled' : 'Active')}</div>
      ${fld(u.id ? 'New password (leave empty to keep)' : 'Password (8+ characters, with a letter and a number)', 'password', '', 'password', u.id ? '' : 'required')}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    $('#ef').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = formData(ev.target); d.active = d.active === 'Active' ? '1' : '0';
      await A(u.id ? 'PUT' : 'POST', u.id ? `/users/${u.id}` : '/users', d); closeModal(); toast('Saved'); users();
    };
  };
  $('#add').onclick = () => form();
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.edit) form(rows.find((r) => r.id == t.dataset.edit));
    if (t.dataset.del && confirm('Delete this user?')) { await A('DELETE', `/users/${t.dataset.del}`); users(); }
  };
}

// ---- bookings ----
const bookingPill = (b) => {
  const st = b.booking;
  if (st.code === 'completed') return `<span class="pill green">Completed</span>`;
  if (st.code === 'in_progress') return `<span class="pill">In progress</span>`;
  return `<span class="pill red">Booked${st.date ? ' · ' + esc(st.date) : ''}</span>${st.in ? `<br><small>${esc(st.in)}</small>` : ''}`;
};
const deliveryPill = (b) => b.delivered ? (b.viewed ? '<span class="pill green">Sent · viewed by client</span>' : '<span class="pill">Sent · not viewed yet</span>') : '<small>Not sent</small>';
let bookingFilter = 'pending';

async function bookings() {
  const all = await A('GET', '/bookings');
  const rows = bookingFilter === 'all' ? all : bookingFilter === 'pending' ? all.filter((b) => b.booking.code !== 'completed') : all.filter((b) => b.booking.code === bookingFilter);
  const count = (c) => all.filter((b) => (c === 'pending' ? b.booking.code !== 'completed' : c === 'all' ? true : b.booking.code === c)).length;
  const tabs = [['pending', 'Pending'], ['booked', 'Booked'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['all', 'All']];
  $('#main').innerHTML = `<h2>Bookings</h2>
  <p class="lead" style="margin-top:-8px"><b>Booked</b> shows the shoot date until the event day. After that the job is <b>In progress</b> until you send the project link, which marks it <b>Completed</b>.</p>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${bookingFilter === k ? 'on' : ''}" data-f="${k}">${l} (${count(k)})</button>`).join('')}
    <span style="flex:1"></span><a class="btn btn-blue btn-sm" href="#" data-viewpdf="/api/admin/bookings/pdf" data-title="Pending bookings">View pending bookings</a><a class="btn btn-ghost btn-sm" href="/api/admin/bookings/pdf">Download PDF</a><a class="btn btn-ghost btn-sm" target="_blank" href="/api/admin/bookings/pdf?inline=1">Print</a></div>
  <div class="panel"><table><tr><th>Status</th><th>Client</th><th>Event</th><th>Package</th><th>Invoice</th><th>Crew</th><th>Balance</th><th>Project link</th><th></th></tr>
  ${rows.map((b) => `<tr><td>${bookingPill(b)}</td><td>${esc(b.client_name)}<br><small>${esc(b.phone)}</small></td>
    <td>${esc(b.event_type)}<br><small>${esc(b.event_date || 'Date to be confirmed')}${b.venue ? ' · ' + esc(b.venue) : ''}</small></td><td>${esc(b.package_name)}</td>
    <td>${esc(b.number)}</td><td>${b.crew.map((c) => `<small>${esc(c.name)}<br>(${esc(c.role)})</small>`).join('<br>') || '<small>-</small>'}</td><td>${b.balance > 0.005 ? `<b>${kes(b.balance)}</b>` : '<span class="pill green">Paid</span>'}</td><td>${deliveryPill(b)}</td>
    <td><div class="acts">${b.delivered ? '' : `<button class="btn btn-red" data-send="${b.id}">Send project link</button>`}
      ${b.booking.code === 'completed' && !b.delivered ? `<button class="btn btn-ghost" data-reopen="${b.id}">Reopen</button>` : ''}
      ${b.booking.code !== 'completed' ? `<button class="btn btn-ghost" data-done="${b.id}">Mark completed</button>` : ''}
      ${ME.role === 'admin' ? `<button class="btn btn-ghost" data-crew="${b.id}">Assign crew</button>` : ''}
      <a class="btn btn-ghost" target="_blank" data-remind="${b.id}" data-type="event" href="${waUrl(b.phone, eventMsg(b))}">Remind</a></div></td></tr>`).join('') || '<tr><td colspan="9">Nothing here.</td></tr>'}
  </table></div>`;
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.f) { bookingFilter = t.dataset.f; bookings(); }
    if (t.dataset.done) { await A('POST', `/invoices/${t.dataset.done}/complete`); toast('Marked completed'); bookings(); }
    if (t.dataset.reopen) { await A('POST', `/invoices/${t.dataset.reopen}/reopen`); toast('Reopened'); bookings(); }
    if (t.dataset.crew) assignModal(null, () => bookings(), t.dataset.crew);
    if (t.dataset.send) { const b = all.find((x) => x.id == t.dataset.send); window.__prefillProject = { client_name: b.client_name, phone: b.phone, number: b.number, package_name: b.package_name }; go('projects'); }
    if (t.dataset.remind) A('POST', `/invoices/${t.dataset.remind}/reminded`, { type: t.dataset.type });
  };
}

const eventMsg = (b) => b.booking.code === 'booked' && b.event_date
  ? `Hello ${b.client_name}, a friendly reminder from Shepherd Media Group: your ${b.package_name} is booked for ${b.event_date}${b.venue ? ' at ' + b.venue : ''}. ${b.balance > 0.005 ? `Balance due: ${kes(b.balance)}. ` : ''}We look forward to capturing your day!`
  : `Hello ${b.client_name}, this is Shepherd Media Group about your ${b.package_name}. We are working on it and will share it with you soon.`;
const payMsg = (b) => `Hello ${b.client_name}, a friendly reminder from Shepherd Media Group: invoice ${b.number} has a balance of ${kes(b.balance)}${b.due_date ? ' due on ' + b.due_date : ''}. Thank you.`;

// ---- reminders ----
async function reminders() {
  const r = await A('GET', '/reminders');
  const when = (v) => (v ? `Last reminded ${esc(String(v).slice(0, 16))}` : 'Not reminded yet');
  $('#main').innerHTML = `<h2>Reminders</h2>
  <p class="lead" style="margin-top:-8px">Press <b>Send reminder</b> to open WhatsApp with the message ready, then press send there. The date of the last reminder is saved here so you don't remind twice by mistake.</p>
  <div class="panel"><h3>Payments to chase <span class="pill red">${r.payments.length}</span></h3><p class="lead" style="margin-top:0;font-size:.88rem">Unpaid balances that are overdue or due within 3 days.</p>
    <table>${r.payments.map((b) => `<tr class="${b.overdue ? 'od' : ''}"><td>${esc(b.client_name)}<br><small>${esc(b.phone)}</small></td><td>${esc(b.number)}</td>
      <td><b>${kes(b.balance)}</b><br><small>${b.overdue ? 'overdue since ' : 'due '}${esc(b.due_date)}</small></td><td><small>${when(b.last_reminded_at)}</small></td>
      <td><a class="btn btn-red btn-sm" target="_blank" data-remind="${b.id}" data-type="payment" href="${waUrl(b.phone, payMsg(b))}">Send reminder</a>
      <button class="btn btn-ghost btn-sm" data-pay="${b.id}">Add payment</button></td></tr>`).join('') || '<tr><td>Nothing to chase right now.</td></tr>'}</table></div>
  <div class="panel"><h3>Shoots in the next 7 days <span class="pill red">${r.shoots.length}</span></h3>
    <table>${r.shoots.map((b) => `<tr><td>${esc(b.client_name)}<br><small>${esc(b.phone)}</small></td><td>${esc(b.package_name)}</td><td><b>${esc(b.event_date)}</b><br><small>${esc(b.booking.in)}${b.venue ? ' · ' + esc(b.venue) : ''}</small></td>
      <td><small>${when(b.event_reminded_at)}</small></td><td><a class="btn btn-red btn-sm" target="_blank" data-remind="${b.id}" data-type="event" href="${waUrl(b.phone, eventMsg(b))}">Remind client</a></td></tr>`).join('') || '<tr><td>No shoots coming up this week.</td></tr>'}</table></div>
  <div class="panel"><h3>In progress, waiting to be delivered <span class="pill">${r.inProgress.length}</span></h3>
    <table>${r.inProgress.map((b) => `<tr><td>${esc(b.client_name)}<br><small>${esc(b.phone)}</small></td><td>${esc(b.package_name)}</td><td>${esc(b.event_date || '')}</td>
      <td><button class="btn btn-red btn-sm" data-send="${b.id}">Send project link</button></td></tr>`).join('') || '<tr><td>Nothing waiting.</td></tr>'}</table></div>`;
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.remind) { await A('POST', `/invoices/${t.dataset.remind}/reminded`, { type: t.dataset.type }); setTimeout(reminders, 600); }
    if (t.dataset.send) { const b = r.inProgress.find((x) => x.id == t.dataset.send); window.__prefillProject = { client_name: b.client_name, phone: b.phone, number: b.number, package_name: b.package_name }; go('projects'); }
    if (t.dataset.pay) { const b = r.payments.find((x) => x.id == t.dataset.pay); paymentsModal('invoices', b.id, `${b.number} · ${b.client_name}`, b.total, () => reminders(), { phone: b.phone, client: b.client_name }); }
  };
}
