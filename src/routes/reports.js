// Receipts, bookings, reminders and A4 report downloads. Mounted from business.js.
const db = require('../db');
const docs = require('../docs');
const { receiptData } = require('../receipts');
const crew = require('../crew');
const { today, bookingStatus } = require('../util');

const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const d10 = (v) => String(v || '').slice(0, 10);

// Every invoice is a confirmed booking. Delivered = a project link was added for the invoice or its quote.
async function loadBookings() {
  const rows = await db.q(`
    SELECT i.*, q.number AS quote_no,
      (SELECT COUNT(*) FROM projects p WHERE p.quote_number <> '' AND (p.quote_number = i.number OR p.quote_number = q.number)) AS delivered_n,
      (SELECT COALESCE(SUM(p.views),0) FROM projects p WHERE p.quote_number <> '' AND (p.quote_number = i.number OR p.quote_number = q.number)) AS views
    FROM invoices i LEFT JOIN quotes q ON q.id = i.quote_id ORDER BY i.id DESC`);
  const crewRows = await db.q('SELECT a.invoice_id, c.name, a.role FROM assignments a JOIN contractors c ON c.id=a.contractor_id WHERE a.invoice_id IS NOT NULL');
  return rows.map((i) => {
    const status = bookingStatus({ event_date: i.event_date, completed: !!i.completed_at, delivered: i.delivered_n > 0 });
    const total = i.amount - i.discount;
    return { ...i, total, balance: total - i.paid, delivered: i.delivered_n > 0, viewed: i.views > 0, booking: status, crew: crewRows.filter((c) => c.invoice_id === i.id).map((c) => ({ name: c.name, role: c.role })) };
  });
}

const order = (a, b) => {
  const rank = { in_progress: 0, booked: 1, completed: 2 };
  if (a.booking.code !== b.booking.code) return rank[a.booking.code] - rank[b.booking.code];
  return String(a.event_date || '9999').localeCompare(String(b.event_date || '9999'));
};

module.exports = (router, { wrap, adminOnly, buildSummary, range }) => {
  // ---- receipts -------------------------------------------------------
  router.get('/payments/:id/receipt', wrap(async (req, res) => {
    const pay = await db.one('SELECT * FROM payments WHERE id=?', [req.params.id]);
    if (!pay) return res.status(404).send('Not found');
    docs.receipt(res, await receiptData(pay), await db.getSettings(), req.query.inline === '1');
  }));

  // ---- bookings -------------------------------------------------------
  router.get('/bookings', wrap(async (req, res) => {
    res.json((await loadBookings()).sort(order));
  }));
  router.post('/invoices/:id/complete', wrap(async (req, res) => {
    await db.q('UPDATE invoices SET completed_at=NOW() WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));
  router.post('/invoices/:id/reopen', wrap(async (req, res) => {
    await db.q('UPDATE invoices SET completed_at=NULL WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ---- reminders ------------------------------------------------------
  router.get('/reminders', wrap(async (req, res) => {
    const t = today();
    const soon = today(3);
    const week = today(7);
    const all = await loadBookings();
    const payments = all.filter((b) => b.balance > 0.005 && b.due_date && b.due_date <= soon)
      .map((b) => ({ ...b, overdue: b.due_date < t })).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const shoots = all.filter((b) => b.booking.code === 'booked' && b.event_date && b.event_date >= t && b.event_date <= week)
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    const inProgress = all.filter((b) => b.booking.code === 'in_progress');
    res.json({ today: t, payments, shoots, inProgress });
  }));
  router.post('/invoices/:id/reminded', wrap(async (req, res) => {
    const col = req.body.type === 'event' ? 'event_reminded_at' : 'last_reminded_at';
    await db.q(`UPDATE invoices SET ${col}=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  }));

  // ---- A4 PDF reports -------------------------------------------------
  const TYPES = {
    summary: 'Business summary', sales: 'Sales and payments received', expenses: 'Expenses paid', invoices: 'Invoices',
    outstanding: 'Outstanding invoices', payables: 'Payables', 'pending-bookings': 'Pending bookings', 'money-owed': 'Money owed', contractors: 'Contractors',
  };

  async function build(type, from, to) {
    const t = today();
    const span = `${from} to ${to}`;
    if (type === 'summary') {
      const r = await buildSummary(from, to);
      return {
        title: 'Business summary report', subtitle: `Period: ${span}`,
        summary: [['Invoiced (sales)', kes(r.invoiced)], ['Money received', kes(r.collected)], ['Expenses paid', kes(r.expenses)], ['Net cash', kes(r.net)],
          ['Clients owe you', kes(r.receivable)], ['You owe suppliers', kes(r.payable)], ['Overdue from clients', kes(r.overdueRecv)], ['Quotes to invoices', `${r.quotesInvoiced} of ${r.quotes}`]],
        sections: [
          { title: 'By month', columns: [{ h: 'Month', w: 2 }, { h: 'Invoiced', w: 3, money: 1 }, { h: 'Received', w: 3, money: 1 }, { h: 'Expenses', w: 3, money: 1 }],
            rows: r.byMonth.map((m) => [m.month, m.invoiced, m.collected, m.expenses]),
            total: ['Total', r.byMonth.reduce((a, m) => a + m.invoiced, 0), r.byMonth.reduce((a, m) => a + m.collected, 0), r.byMonth.reduce((a, m) => a + m.expenses, 0)] },
          { title: 'Sales by service', columns: [{ h: 'Service', w: 3 }, { h: 'Invoices', w: 1, align: 'right' }, { h: 'Invoiced', w: 3, money: 1 }, { h: 'Received', w: 3, money: 1 }],
            rows: r.byType.map((x) => [x.type, x.invoices, x.invoiced, x.collected]) },
          { title: 'Top clients', columns: [{ h: 'Client', w: 4 }, { h: 'Invoices', w: 1, align: 'right' }, { h: 'Invoiced', w: 3, money: 1 }, { h: 'Paid', w: 3, money: 1 }],
            rows: r.topClients.map((x) => [x.client_name, x.invoices, x.invoiced, x.paid]) },
          { title: 'Expenses by category', columns: [{ h: 'Category', w: 5 }, { h: 'Paid', w: 3, money: 1 }], rows: r.expByCat.map((x) => [x.category, x.total]) },
        ],
      };
    }
    if (type === 'sales') {
      const rows = await db.q(`SELECT pa.paid_at, pa.receipt_number, i.number, i.client_name, pa.method, pa.reference, pa.amount
        FROM payments pa JOIN invoices i ON i.id=pa.invoice_id WHERE pa.paid_at BETWEEN ? AND ? ORDER BY pa.paid_at, pa.id`, [from, to]);
      const total = rows.reduce((a, r) => a + Number(r.amount), 0);
      return { title: 'Sales and payments received', subtitle: `Period: ${span}`, summary: [['Payments received', kes(total)], ['Number of payments', String(rows.length)]],
        sections: [{ title: 'Payments', columns: [{ h: 'Date', w: 2 }, { h: 'Receipt', w: 2.9 }, { h: 'Invoice', w: 3 }, { h: 'Client', w: 3.4 }, { h: 'Method', w: 2 }, { h: 'Reference', w: 2.2 }, { h: 'Amount', w: 2.2, money: 1 }],
          rows: rows.map((r) => [d10(r.paid_at), r.receipt_number, r.number, r.client_name, r.method, r.reference, r.amount]),
          total: ['', '', '', '', '', 'Total', total] }] };
    }
    if (type === 'expenses') {
      const rows = await db.q(`SELECT pp.paid_at, p.supplier, p.description, p.category, pp.method, pp.reference, pp.amount
        FROM payable_payments pp JOIN payables p ON p.id=pp.payable_id WHERE pp.paid_at BETWEEN ? AND ? ORDER BY pp.paid_at, pp.id`, [from, to]);
      const total = rows.reduce((a, r) => a + Number(r.amount), 0);
      return { title: 'Expenses paid', subtitle: `Period: ${span}`, summary: [['Expenses paid', kes(total)], ['Number of payments', String(rows.length)]],
        sections: [{ title: 'Payments made', columns: [{ h: 'Date', w: 2 }, { h: 'Supplier', w: 3 }, { h: 'For', w: 3.4 }, { h: 'Category', w: 2.4 }, { h: 'Method', w: 2 }, { h: 'Reference', w: 2.2 }, { h: 'Amount', w: 2.2, money: 1 }],
          rows: rows.map((r) => [d10(r.paid_at), r.supplier, r.description, r.category, r.method, r.reference, r.amount]), total: ['', '', '', '', '', 'Total', total] }] };
    }
    if (type === 'invoices') {
      const rows = await db.q(`SELECT number, created_at, client_name, package_name, amount-discount AS total, paid, amount-discount-paid AS balance, status
        FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY id`, [from, to]);
      const sum = (k) => rows.reduce((a, r) => a + Number(r[k]), 0);
      return { title: 'Invoices report', subtitle: `Period: ${span}`, summary: [['Invoiced', kes(sum('total'))], ['Received', kes(sum('paid'))], ['Balance', kes(sum('balance'))], ['Invoices', String(rows.length)]],
        sections: [{ title: 'Invoices', columns: [{ h: 'Invoice', w: 3 }, { h: 'Date', w: 2.2 }, { h: 'Client', w: 3 }, { h: 'Package', w: 3.2 }, { h: 'Total', w: 2.2, money: 1 }, { h: 'Paid', w: 2.2, money: 1 }, { h: 'Balance', w: 2.2, money: 1 }, { h: 'Status', w: 1.6 }],
          rows: rows.map((r) => [r.number, d10(r.created_at), r.client_name, r.package_name, r.total, r.paid, r.balance, r.status]), total: ['', '', '', 'Total', sum('total'), sum('paid'), sum('balance'), ''] }] };
    }
    if (type === 'outstanding') {
      const rows = await db.q(`SELECT number, client_name, phone, due_date, amount-discount AS total, paid, amount-discount-paid AS balance FROM invoices
        WHERE status<>'paid' AND amount-discount-paid > 0 ORDER BY (due_date=''), due_date, id`);
      const bal = rows.reduce((a, r) => a + Number(r.balance), 0);
      const late = rows.filter((r) => r.due_date && r.due_date < t).reduce((a, r) => a + Number(r.balance), 0);
      return { title: 'Outstanding invoices', subtitle: `As at ${t}`, summary: [['Total owed to you', kes(bal)], ['Overdue', kes(late)], ['Open invoices', String(rows.length)]],
        sections: [{ title: 'Invoices not fully paid', columns: [{ h: 'Invoice', w: 3 }, { h: 'Client', w: 3 }, { h: 'Phone', w: 2.6 }, { h: 'Due', w: 2.2 }, { h: 'Total', w: 2.2, money: 1 }, { h: 'Paid', w: 2.2, money: 1 }, { h: 'Balance', w: 2.2, money: 1 }],
          rows: rows.map((r) => [r.number, r.client_name, r.phone, r.due_date ? (r.due_date < t ? r.due_date + ' (overdue)' : r.due_date) : '-', r.total, r.paid, r.balance]), total: ['', '', '', 'Total', null, null, bal], empty: 'No outstanding invoices.' }] };
    }
    if (type === 'payables') {
      const rows = await db.q("SELECT supplier, description, category, due_date, amount, paid, amount-paid AS balance FROM payables WHERE status<>'paid' ORDER BY (due_date=''), due_date, id");
      const bal = rows.reduce((a, r) => a + Number(r.balance), 0);
      return { title: 'Payables report', subtitle: `Bills still to be paid, as at ${t}`, summary: [['You owe', kes(bal)], ['Open bills', String(rows.length)]],
        sections: [{ title: 'Open bills', columns: [{ h: 'Supplier', w: 3 }, { h: 'For', w: 3.4 }, { h: 'Category', w: 2.4 }, { h: 'Due', w: 2.2 }, { h: 'Amount', w: 2.2, money: 1 }, { h: 'Paid', w: 2.2, money: 1 }, { h: 'Balance', w: 2.2, money: 1 }],
          rows: rows.map((r) => [r.supplier, r.description, r.category, r.due_date ? (r.due_date < t ? r.due_date + ' (overdue)' : r.due_date) : '-', r.amount, r.paid, r.balance]), total: ['', '', '', 'Total', null, null, bal], empty: 'No open bills.' }] };
    }
    if (type === 'money-owed') {
      // who owes us, and who we owe (contractors separately from other suppliers)
      const clients = await db.q(`SELECT number, client_name, phone, due_date, amount-discount-paid AS balance FROM invoices
        WHERE status<>'paid' AND amount-discount-paid > 0 ORDER BY (due_date=''), due_date, id`);
      const owedClients = clients.reduce((a, r) => a + Number(r.balance), 0);
      const lateClients = clients.filter((r) => r.due_date && r.due_date < t).reduce((a, r) => a + Number(r.balance), 0);
      const ctors = (await crew.contractorTotals()).filter((c) => c.owed > 0.005);
      const owedCtors = ctors.reduce((a, c) => a + Number(c.owed), 0);
      const others = await db.q(`SELECT p.supplier, p.description, p.category, p.due_date, p.amount-p.paid AS balance FROM payables p
        WHERE p.status<>'paid' AND p.id NOT IN (SELECT payable_id FROM assignments WHERE payable_id IS NOT NULL) ORDER BY (p.due_date=''), p.due_date, p.id`);
      const owedOthers = others.reduce((a, r) => a + Number(r.balance), 0);
      const due = (d) => (d ? (d < t ? d + ' (overdue)' : d) : '-');
      return { title: 'Money owed report', subtitle: `Who owes you and who you owe, as at ${t}`,
        summary: [['Clients owe you', kes(owedClients)], ['of which overdue', kes(lateClients)], ['You owe contractors', kes(owedCtors)], ['You owe other suppliers', kes(owedOthers)],
          ['Total you owe', kes(owedCtors + owedOthers)], ['Net position', kes(owedClients - owedCtors - owedOthers)]],
        sections: [
          { title: 'Money owed to you by clients', columns: [{ h: 'Invoice', w: 3 }, { h: 'Client', w: 3.4 }, { h: 'Phone', w: 2.6 }, { h: 'Due', w: 2.6 }, { h: 'Balance', w: 2.4, money: 1 }],
            rows: clients.map((r) => [r.number, r.client_name, r.phone, due(r.due_date), r.balance]), total: ['', '', '', 'Total', owedClients], empty: 'No client owes you anything.' },
          { title: 'Money you owe contractors', columns: [{ h: 'Contractor', w: 3.4 }, { h: 'Role', w: 2.6 }, { h: 'Jobs', w: 1, align: 'right' }, { h: 'Fees', w: 2.4, money: 1 }, { h: 'Paid', w: 2.4, money: 1 }, { h: 'Owed', w: 2.4, money: 1 }],
            rows: ctors.map((c) => [c.name, c.role, c.jobs, c.fees, c.paid, c.owed]), total: ['', '', '', '', 'Total', owedCtors], empty: 'You owe no contractor anything.' },
          { title: 'Money you owe other suppliers', columns: [{ h: 'Supplier', w: 3 }, { h: 'For', w: 3.6 }, { h: 'Category', w: 2.4 }, { h: 'Due', w: 2.6 }, { h: 'Balance', w: 2.4, money: 1 }],
            rows: others.map((r) => [r.supplier, r.description, r.category, due(r.due_date), r.balance]), total: ['', '', '', 'Total', owedOthers], empty: 'No other bills are open.' },
        ] };
    }
    if (type === 'contractors') {
      const list = await crew.contractorTotals();
      const jobs = await crew.assignmentRows();
      const sum = (k) => list.reduce((a, c) => a + Number(c[k]), 0);
      return { title: 'Contractors report', subtitle: `Freelance crew, jobs and payments, as at ${t}`,
        summary: [['Contractors', String(list.length)], ['Fees agreed', kes(sum('fees'))], ['Paid', kes(sum('paid'))], ['Still owed', kes(sum('owed'))]],
        sections: [
          { title: 'Summary by contractor', columns: [{ h: 'Contractor', w: 3.4 }, { h: 'Role', w: 2.6 }, { h: 'Phone', w: 2.4 }, { h: 'Jobs', w: 1, align: 'right' }, { h: 'Fees', w: 2.2, money: 1 }, { h: 'Paid', w: 2.2, money: 1 }, { h: 'Owed', w: 2.2, money: 1 }],
            rows: list.map((c) => [c.name, c.role, c.phone, c.jobs, c.fees, c.paid, c.owed]), total: ['', '', '', 'Total', sum('fees'), sum('paid'), sum('owed')], empty: 'No contractors yet.' },
          { title: 'All jobs', columns: [{ h: 'Date', w: 2.2 }, { h: 'Contractor', w: 2.8 }, { h: 'Job', w: 4 }, { h: 'Fee', w: 2, money: 1 }, { h: 'Paid', w: 2, money: 1 }, { h: 'Balance', w: 2, money: 1 }],
            rows: jobs.map((j) => [j.event_date || '-', j.contractor, j.job, j.fee, j.paid, j.fee - j.paid]), empty: 'No jobs yet.' },
        ] };
    }
    if (type === 'pending-bookings') {
      const pending = (await loadBookings()).filter((b) => b.booking.code !== 'completed').sort(order);
      const booked = pending.filter((b) => b.booking.code === 'booked').length;
      const bal = pending.reduce((a, b) => a + b.balance, 0);
      return { title: 'Pending bookings report', subtitle: `Jobs not yet completed, as at ${t}`,
        summary: [['Pending bookings', String(pending.length)], ['Booked (shoot ahead)', String(booked)], ['In progress', String(pending.length - booked)], ['Balance still due', kes(bal)]],
        sections: [{ title: 'Pending bookings', columns: [{ h: 'Status', w: 2.6 }, { h: 'Event date', w: 2.2 }, { h: 'Client', w: 3 }, { h: 'Service / package', w: 3 }, { h: 'Venue', w: 2.2 }, { h: 'Invoice', w: 3 }, { h: 'Balance', w: 2.2, money: 1 }],
          rows: pending.map((b) => [b.booking.code === 'booked' ? 'Booked' + (b.booking.in ? ' (' + b.booking.in + ')' : '') : 'In progress', b.event_date || 'TBC', b.client_name + (b.phone ? '\n' + b.phone : ''), b.package_name, b.venue, b.number, b.balance]),
          total: ['', '', '', '', '', 'Total', bal], empty: 'No pending bookings.' }] };
    }
    return null;
  }

  router.get('/reports/pdf', adminOnly, wrap(async (req, res) => {
    const type = String(req.query.type || 'summary');
    const [from, to] = range(req);
    const rep = await build(type, from, to);
    if (!rep) return res.status(400).send('Unknown report');
    rep.filename = `SMG-${type}-${from}-to-${to}`;
    docs.report(res, rep, await db.getSettings(), req.query.inline === '1');
  }));

  // staff may print the pending bookings list too (no money totals beyond balances they already see on invoices)
  router.get('/bookings/pdf', wrap(async (req, res) => {
    const rep = await build('pending-bookings', today(), today());
    rep.filename = `SMG-pending-bookings-${today()}`;
    docs.report(res, rep, await db.getSettings(), req.query.inline === '1');
  }));

  router.get('/reports/types', adminOnly, (req, res) => res.json(TYPES));
};
