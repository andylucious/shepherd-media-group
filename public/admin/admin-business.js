// Invoices & payments, payables, client projects, reports and users (back office views)
const METHODS = ['M-Pesa', 'Cash', 'Bank transfer', 'Cheque', 'Card', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);
const payRows = (list, delPath) => list.length ? `<table><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th></th></tr>${list.map((p) =>
  `<tr><td>${esc(String(p.paid_at).slice(0, 10))}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td><td>${kes(p.amount)}</td>
   <td>${ME.role === 'admin' ? `<button class="btn btn-del btn-sm" data-undo="${p.id}" data-path="${delPath}">Undo</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="lead" style="margin:6px 0">No payments yet.</p>';

async function paymentsModal(kind, id, title, total, onChange) {
  // kind: 'invoices' (money in) or 'payables' (money out)
  const list = await A('GET', `/${kind}/${id}/payments`);
  const paid = list.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(total - paid, 0);
  modal(`<h3>${esc(title)}</h3>
    <div class="cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">${stat(kes(total), 'Total')}${stat(kes(paid), kind === 'invoices' ? 'Received' : 'Paid')}${stat(kes(balance), 'Balance', 'r')}</div>
    ${payRows(list, kind === 'invoices' ? 'payments' : 'payable-payments')}
    ${balance > 0 ? `<h3 style="margin-top:16px;font-size:1.05rem">Record a ${kind === 'invoices' ? 'payment received' : 'payment made'}</h3><form id="pf">
      <div class="row2">${fld('Amount (KES)', 'amount', balance, 'number', 'step="any" min="1" required')}${fld('Date', 'paid_at', today(), 'date')}</div>
      <div class="row2">${sel('Method', 'method', METHODS, 'M-Pesa')}${fld('Reference (e.g. M-Pesa code)', 'reference')}</div>
      <p class="lead" style="font-size:.85rem;margin:6px 0">Part payment is fine: enter less than the balance and the rest stays open.</p>
      <div style="display:flex;gap:10px"><button class="btn btn-red">Save payment</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></form>`
      : '<p><span class="pill green">Fully settled</span> <button class="btn btn-ghost btn-sm" data-close>Close</button></p>'}`);
  const f = $('#pf');
  if (f) f.onsubmit = async (e) => { e.preventDefault(); await A('POST', `/${kind}/${id}/payments`, formData(f)); toast('Payment saved'); onChange(); };
  document.querySelectorAll('#ovc [data-undo]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this payment record?')) return;
    await A('DELETE', `/${b.dataset.path}/${b.dataset.undo}`); toast('Removed'); onChange();
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
    <td><div class="acts"><button class="btn btn-red" data-pay="${i.id}">${i.status === 'paid' ? 'Payments' : 'Add payment'}</button>
      <a class="btn btn-ghost" href="/api/admin/invoices/${i.id}/pdf">PDF</a>
      <button class="btn btn-ghost" data-edit="${i.id}">Edit</button>
      <a class="btn btn-ghost" target="_blank" href="${waUrl(i.phone, `Hello ${i.client_name}, invoice ${i.number}: total ${kes(i.amount - i.discount)}, paid ${kes(i.paid)}, balance ${kes(bal)}. Thank you. Shepherd Media Group.`)}">WhatsApp</a>
      ${ME.role === 'admin' ? `<button class="btn btn-del" data-del="${i.id}">Delete</button>` : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="9">No invoices yet. Open a quote and press "Make invoice".</td></tr>'}
  </table></div>`;
  $('#main').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.del && confirm('Delete this invoice and its payment records? The quote becomes editable again.')) { await A('DELETE', `/invoices/${t.dataset.del}`); invoices(); }
    if (t.dataset.pay) {
      const i = rows.find((r) => r.id == t.dataset.pay);
      paymentsModal('invoices', i.id, `${i.number} · ${i.client_name}`, i.amount - i.discount, () => { closeModal(); invoices(); });
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
      paymentsModal('payables', p.id, `${p.supplier} · ${p.description || p.category}`, p.amount, () => { closeModal(); payables(); });
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
  <div class="panel"><table><tr><th>Client</th><th>Project</th><th>Link</th><th>Added</th><th></th></tr>
  ${rows.map((p) => `<tr><td>${esc(p.client_name)}<br><small>${esc(p.phone)} ${esc(p.quote_number)}</small></td><td>${esc(p.title)}<br><small>${esc(p.note)}</small></td>
    <td><a href="${esc(p.url)}" target="_blank" rel="noopener">Open ↗</a></td><td>${p.created_at.slice(0, 10)}</td>
    <td><div class="acts"><button class="btn btn-ghost" data-copy="${p.id}">Copy client link</button>
    ${p.phone ? `<a class="btn btn-ghost" target="_blank" href="${waUrl(p.phone, `Hello ${p.client_name}, your ${p.title} is ready: ${link(p)}  - Shepherd Media Group`)}">Send on WhatsApp</a>` : ''}
    <button class="btn btn-ghost" data-edit="${p.id}">Edit</button><button class="btn btn-del" data-del="${p.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="5">No project links yet.</td></tr>'}</table></div>`;
  const quotesP = A('GET', '/quotes');
  const form = async (p = {}) => {
    const qs = await quotesP;
    modal(`<h3>${p.id ? 'Edit' : 'New'} project link</h3><form id="ef">
      ${p.id ? '' : `<label>Pick a client from quotes (optional)</label><select id="pick"><option value="">-- choose --</option>${qs.map((q) => `<option value="${q.id}">${esc(q.number)} · ${esc(q.client_name)}</option>`).join('')}</select>`}
      ${fld('Client name', 'client_name', p.client_name, 'text', 'required')}<div class="row2">${fld('Client phone', 'phone', p.phone)}${fld('Quote / invoice number', 'quote_number', p.quote_number)}</div>
      ${fld('Project title', 'title', p.title, 'text', 'required placeholder="e.g. Wedding photos - Jane & Peter"')}
      ${fld('Link (https://...)', 'url', p.url, 'url', 'required placeholder="https://drive.google.com/..."')}${area('Message to the client (optional)', 'note', p.note, 2)}
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-red">Save</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
    const pick = $('#pick');
    if (pick) pick.onchange = () => { const q = qs.find((x) => x.id == pick.value); if (q) { const f = $('#ef'); f.client_name.value = q.client_name; f.phone.value = q.phone; f.quote_number.value = q.number; f.title.value = f.title.value || `${q.package_name} - ${q.client_name}`; } };
    $('#ef').onsubmit = async (ev) => { ev.preventDefault(); await A(p.id ? 'PUT' : 'POST', p.id ? `/projects/${p.id}` : '/projects', formData(ev.target)); closeModal(); toast('Saved'); projects(); };
  };
  $('#add').onclick = () => form();
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
  $('#main').innerHTML = `<h2>Business reports</h2>
  <div class="panel"><form id="rf" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
    <div><label>From</label><input type="date" name="from" value="${r.from}"></div><div><label>To</label><input type="date" name="to" value="${r.to}"></div>
    <button class="btn btn-blue">Update</button>
    <span style="flex:1"></span>
    <a class="btn btn-ghost" href="${csv('payments')}">Download sales (CSV)</a><a class="btn btn-ghost" href="${csv('invoices')}">Invoices (CSV)</a><a class="btn btn-ghost" href="${csv('expenses')}">Expenses (CSV)</a>
    <button type="button" class="btn btn-ghost" onclick="window.print()">Print</button></form></div>
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
      ${fld(u.id ? 'New password (leave empty to keep)' : 'Password (8+ characters)', 'password', '', 'password', u.id ? '' : 'required')}
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
