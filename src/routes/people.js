// Contractors, their jobs and payments, and registered client accounts (admin only). Mounted from business.js.
const bcrypt = require('bcryptjs');
const db = require('../db');
const docs = require('../docs');
const crew = require('../crew');
const { weakPassword } = require('../util');

const num = (v) => Number(v) || 0;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const ROLES = ['Photographer', 'Videographer', 'Editor', 'Drone pilot', 'Live-stream technician', 'Assistant', 'Other'];

module.exports = (router, { wrap, adminOnly }) => {
  // ---- contractors -----------------------------------------------------
  router.get('/contractors', adminOnly, wrap(async (req, res) => res.json({ roles: ROLES, items: await crew.contractorTotals() })));

  const fields = (b) => [String(b.name || '').trim().slice(0, 160), ROLES.includes(b.role) ? b.role : 'Other', String(b.phone || '').slice(0, 40),
    String(b.email || '').slice(0, 190), String(b.rate || '').slice(0, 120), String(b.notes || '').slice(0, 500), b.active === false || b.active === '0' || b.active === 0 ? 0 : 1];

  router.post('/contractors', adminOnly, wrap(async (req, res) => {
    if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Enter the contractor\'s name' });
    const r = await db.q('INSERT INTO contractors (name, role, phone, email, rate, notes, active) VALUES (?,?,?,?,?,?,?)', fields(req.body));
    res.json({ id: r.insertId });
  }));
  router.put('/contractors/:id', adminOnly, wrap(async (req, res) => {
    if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Enter the contractor\'s name' });
    await db.q('UPDATE contractors SET name=?, role=?, phone=?, email=?, rate=?, notes=?, active=? WHERE id=?', [...fields(req.body), req.params.id]);
    // keep the supplier name on their bills in step with a rename
    await db.q('UPDATE payables p JOIN assignments a ON a.payable_id=p.id SET p.supplier=? WHERE a.contractor_id=?', [String(req.body.name).trim().slice(0, 160), req.params.id]);
    res.json({ ok: true });
  }));
  router.delete('/contractors/:id', adminOnly, wrap(async (req, res) => {
    const { n } = await db.one('SELECT COUNT(*) n FROM assignments WHERE contractor_id=?', [req.params.id]);
    if (n) return res.status(400).json({ error: 'This contractor has jobs on record. Mark them inactive instead of deleting.' });
    await db.q('DELETE FROM contractors WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  router.get('/contractors/:id', adminOnly, wrap(async (req, res) => {
    const [c] = await crew.contractorTotals('WHERE c.id=?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json({ contractor: c, jobs: await crew.assignmentRows('WHERE a.contractor_id=?', [req.params.id]) });
  }));

  // ---- jobs (assignments) ---------------------------------------------------
  router.get('/assignments', adminOnly, wrap(async (req, res) => {
    res.json(await crew.assignmentRows(req.query.invoice_id ? 'WHERE a.invoice_id=?' : '', req.query.invoice_id ? [req.query.invoice_id] : []));
  }));

  router.post('/assignments', adminOnly, wrap(async (req, res) => {
    const b = req.body;
    const c = await db.one('SELECT * FROM contractors WHERE id=? AND active=1', [b.contractor_id]);
    if (!c) return res.status(400).json({ error: 'Choose an active contractor' });
    const fee = num(b.fee);
    if (fee <= 0) return res.status(400).json({ error: 'Enter the agreed fee' });
    let inv = null;
    if (b.invoice_id) {
      inv = await db.one('SELECT id, number, client_name, event_type, event_date FROM invoices WHERE id=?', [b.invoice_id]);
      if (!inv) return res.status(400).json({ error: 'Booking not found' });
    }
    const job = String(b.job || '').trim().slice(0, 255) || (inv ? `${inv.event_type || 'Event'} for ${inv.client_name}` : 'Job');
    const due = isDate(b.due_date) ? b.due_date : '';
    // the bill we owe the contractor; payments to it are recorded like any other payable
    const bill = await db.q('INSERT INTO payables (supplier, description, category, amount, due_date) VALUES (?,?,?,?,?)', [
      c.name, `${inv ? inv.number + ' · ' : ''}${job}`.slice(0, 255), 'Staff / freelancers', fee, due]);
    const r = await db.q('INSERT INTO assignments (contractor_id, invoice_id, job, role, event_date, payable_id) VALUES (?,?,?,?,?,?)', [
      c.id, inv ? inv.id : null, job, String(b.role || c.role).slice(0, 40), inv ? inv.event_date : '', bill.insertId]);
    res.json({ id: r.insertId, payable_id: bill.insertId });
  }));

  router.put('/assignments/:id', adminOnly, wrap(async (req, res) => {
    const a = await db.one('SELECT a.*, p.paid FROM assignments a LEFT JOIN payables p ON p.id=a.payable_id WHERE a.id=?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const fee = num(req.body.fee);
    if (fee <= 0) return res.status(400).json({ error: 'Enter the agreed fee' });
    if (fee < a.paid) return res.status(400).json({ error: `Already paid ${a.paid.toLocaleString()}; the fee cannot be lower than that.` });
    const job = String(req.body.job || a.job).slice(0, 255);
    await db.q('UPDATE assignments SET job=? WHERE id=?', [job, a.id]);
    await db.q('UPDATE payables SET amount=?, due_date=?, status=? WHERE id=?', [fee, isDate(req.body.due_date) ? req.body.due_date : '', a.paid <= 0 ? 'unpaid' : a.paid >= fee ? 'paid' : 'partial', a.payable_id]);
    res.json({ ok: true });
  }));

  router.delete('/assignments/:id', adminOnly, wrap(async (req, res) => {
    const a = await db.one('SELECT a.id, a.payable_id, p.paid FROM assignments a LEFT JOIN payables p ON p.id=a.payable_id WHERE a.id=?', [req.params.id]);
    if (!a) return res.json({ ok: true });
    if (a.paid > 0) return res.status(400).json({ error: 'Payments were already made on this job, so it cannot be removed.' });
    await db.q('DELETE FROM payables WHERE id=?', [a.payable_id]);
    await db.q('DELETE FROM assignments WHERE id=?', [a.id]);
    res.json({ ok: true });
  }));

  // ---- statement of account (A4) for one contractor ---------------------------
  router.get('/contractors/:id/statement', adminOnly, wrap(async (req, res) => {
    const [c] = await crew.contractorTotals('WHERE c.id=?', [req.params.id]);
    if (!c) return res.status(404).send('Not found');
    const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
    const jobs = await crew.assignmentRows('WHERE a.contractor_id=?', [c.id]);
    const pays = await db.q(`SELECT pp.paid_at, pp.method, pp.reference, pp.amount, p.description
      FROM payable_payments pp JOIN payables p ON p.id=pp.payable_id JOIN assignments a ON a.payable_id=p.id
      WHERE a.contractor_id=? ORDER BY pp.paid_at, pp.id`, [c.id]);
    docs.report(res, {
      filename: `SMG-statement-${c.name.replace(/[^A-Za-z0-9]+/g, '-')}`,
      title: `Contractor statement: ${c.name}`, subtitle: `${c.role}${c.phone ? ' · ' + c.phone : ''}`,
      summary: [['Jobs', String(c.jobs)], ['Fees agreed', kes(c.fees)], ['Paid so far', kes(c.paid)], ['Balance owed', kes(c.owed)]],
      sections: [
        { title: 'Jobs', columns: [{ h: 'Event date', w: 2.2 }, { h: 'Job', w: 5 }, { h: 'Client', w: 3 }, { h: 'Fee', w: 2.2, money: 1 }, { h: 'Paid', w: 2.2, money: 1 }, { h: 'Balance', w: 2.2, money: 1 }],
          rows: jobs.map((j) => [j.event_date || '-', j.job, j.client_name || '', j.fee, j.paid, j.fee - j.paid]), total: ['', '', 'Total', c.fees, c.paid, c.owed], empty: 'No jobs yet.' },
        { title: 'Payments made to this contractor', columns: [{ h: 'Date', w: 2.2 }, { h: 'For', w: 5 }, { h: 'Method', w: 2.2 }, { h: 'Reference', w: 2.4 }, { h: 'Amount', w: 2.4, money: 1 }],
          rows: pays.map((p) => [String(p.paid_at).slice(0, 10), p.description, p.method, p.reference, p.amount]), total: ['', '', '', 'Total', c.paid], empty: 'No payments yet.' },
      ],
    }, await db.getSettings(), req.query.inline === '1');
  }));

  // ---- client accounts (admin only) -----------------------------------------
  router.get('/clients', adminOnly, wrap(async (req, res) => {
    res.json(await db.q(`SELECT c.id, c.name, c.email, c.phone, c.active, c.last_login, c.created_at,
      (SELECT COUNT(*) FROM quotes q WHERE q.client_id=c.id) AS quotes,
      (SELECT COUNT(*) FROM invoices i JOIN quotes q ON q.id=i.quote_id WHERE q.client_id=c.id) AS invoices
      FROM clients c ORDER BY c.id DESC LIMIT 500`));
  }));
  router.put('/clients/:id', adminOnly, wrap(async (req, res) => {
    const b = req.body;
    const email = String(b.email || '').trim().toLowerCase();
    if (!b.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required' });
    if (await db.one('SELECT id FROM clients WHERE email=? AND id<>?', [email, req.params.id])) return res.status(400).json({ error: 'That email already has an account' });
    await db.q('UPDATE clients SET name=?, email=?, phone=?, active=? WHERE id=?', [String(b.name).slice(0, 160), email, String(b.phone || '').slice(0, 40),
      b.active === false || b.active === '0' || b.active === 0 ? 0 : 1, req.params.id]);
    if (b.password) {
      const weak = weakPassword(b.password);
      if (weak) return res.status(400).json({ error: weak });
      await db.q('UPDATE clients SET password_hash=? WHERE id=?', [await bcrypt.hash(String(b.password), 10), req.params.id]);
    }
    res.json({ ok: true });
  }));
  router.delete('/clients/:id', adminOnly, wrap(async (req, res) => {
    await db.q('UPDATE quotes SET client_id=NULL WHERE client_id=?', [req.params.id]);
    await db.q('DELETE FROM clients WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));
};
