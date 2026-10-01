// Payments, payables, projects, reports and users. Mounted on the admin router (already signed-in).
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const { today, weakPassword, hashPassword } = require('../util');
const crypto2 = require('crypto');
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const num = (v) => Number(v) || 0;

module.exports = (router, { wrap, adminOnly, syncInvoice }) => {
  // ---- package categories ---------------------------------------------------
  const catName = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  router.get('/categories', wrap(async (req, res) => {
    res.json(await db.q(`SELECT c.id, c.name, c.sort_order, COUNT(p.id) packages
      FROM package_categories c LEFT JOIN packages p ON p.category = c.name GROUP BY c.id ORDER BY c.sort_order, c.id`));
  }));
  router.post('/categories', wrap(async (req, res) => {
    const name = catName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Enter a category name' });
    if (await db.one('SELECT id FROM package_categories WHERE name=?', [name])) return res.status(400).json({ error: 'That category already exists' });
    const { n } = await db.one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM package_categories');
    const r = await db.q('INSERT INTO package_categories (name, sort_order) VALUES (?,?)', [name, n]);
    res.json({ id: r.insertId, name });
  }));
  router.put('/categories/:id', wrap(async (req, res) => {
    const name = catName(req.body.name);
    const old = await db.one('SELECT name FROM package_categories WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Not found' });
    if (!name) return res.status(400).json({ error: 'Enter a category name' });
    if (await db.one('SELECT id FROM package_categories WHERE name=? AND id<>?', [name, req.params.id])) return res.status(400).json({ error: 'That category already exists' });
    await db.q('UPDATE package_categories SET name=?, sort_order=COALESCE(?, sort_order) WHERE id=?',
      [name, req.body.sort_order === undefined || req.body.sort_order === '' ? null : Number(req.body.sort_order) || 0, req.params.id]);
    await db.q('UPDATE packages SET category=? WHERE category=?', [name, old.name]);
    res.json({ ok: true });
  }));
  router.delete('/categories/:id', wrap(async (req, res) => {
    const c = await db.one('SELECT name FROM package_categories WHERE id=?', [req.params.id]);
    if (!c) return res.json({ ok: true });
    const { n } = await db.one('SELECT COUNT(*) n FROM packages WHERE category=?', [c.name]);
    if (n) return res.status(400).json({ error: `${n} package(s) still use "${c.name}". Move or delete them first.` });
    await db.q('DELETE FROM package_categories WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ---- invoice payments (partial payments) ------------------------------
  router.get('/invoices/:id/payments', wrap(async (req, res) => {
    res.json(await db.q('SELECT * FROM payments WHERE invoice_id=? ORDER BY paid_at DESC, id DESC', [req.params.id]));
  }));

  router.post('/invoices/:id/payments', wrap(async (req, res) => {
    const inv = await db.one('SELECT amount, discount, paid FROM invoices WHERE id=?', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const amount = num(req.body.amount);
    if (amount <= 0) return res.status(400).json({ error: 'Enter an amount greater than zero' });
    const balance = inv.amount - inv.discount - inv.paid;
    if (amount > balance + 0.005) return res.status(400).json({ error: `This is more than the balance (${balance.toLocaleString()})` });
    const receipt = await db.nextNumber('payments', 'SMG-R', 'receipt_number');
    const r = await db.q('INSERT INTO payments (invoice_id, amount, method, reference, note, paid_at, receipt_number, token) VALUES (?,?,?,?,?,?,?,?)', [
      req.params.id, amount, String(req.body.method || 'M-Pesa').slice(0, 30), String(req.body.reference || '').slice(0, 80),
      String(req.body.note || '').slice(0, 255), isDate(req.body.paid_at) ? req.body.paid_at : today(), receipt, crypto2.randomBytes(20).toString('hex')]);
    res.json({ ok: true, status: await syncInvoice(req.params.id), payment_id: r.insertId, receipt_number: receipt });
  }));

  router.delete('/payments/:id', adminOnly, wrap(async (req, res) => {
    const p = await db.one('SELECT invoice_id FROM payments WHERE id=?', [req.params.id]);
    if (p) { await db.q('DELETE FROM payments WHERE id=?', [req.params.id]); await syncInvoice(p.invoice_id); }
    res.json({ ok: true });
  }));

  // ---- payables (bills the business owes) ------------------------------
  async function syncPayable(id) {
    const p = await db.one('SELECT amount FROM payables WHERE id=?', [id]);
    if (!p) return;
    const { s: paid } = await db.one('SELECT COALESCE(SUM(amount),0) s FROM payable_payments WHERE payable_id=?', [id]);
    await db.q('UPDATE payables SET paid=?, status=? WHERE id=?', [paid, paid <= 0 ? 'unpaid' : paid >= p.amount ? 'paid' : 'partial', id]);
  }

  router.get('/payables', wrap(async (req, res) => res.json(await db.q('SELECT * FROM payables ORDER BY (status="paid"), due_date=\'\', due_date, id DESC LIMIT 500'))));

  const payableFields = (b) => [String(b.supplier || '').slice(0, 160), String(b.description || '').slice(0, 255),
    String(b.category || 'Other').slice(0, 40), num(b.amount), isDate(b.due_date) ? b.due_date : ''];

  router.post('/payables', wrap(async (req, res) => {
    if (!req.body.supplier || num(req.body.amount) <= 0) return res.status(400).json({ error: 'Supplier and an amount are required' });
    const r = await db.q('INSERT INTO payables (supplier, description, category, amount, due_date) VALUES (?,?,?,?,?)', payableFields(req.body));
    res.json({ id: r.insertId });
  }));
  router.put('/payables/:id', wrap(async (req, res) => {
    await db.q('UPDATE payables SET supplier=?, description=?, category=?, amount=?, due_date=? WHERE id=?', [...payableFields(req.body), req.params.id]);
    await syncPayable(req.params.id);
    res.json({ ok: true });
  }));
  router.delete('/payables/:id', adminOnly, wrap(async (req, res) => {
    await db.q('DELETE FROM assignments WHERE payable_id=?', [req.params.id]);
    await db.q('DELETE FROM payable_payments WHERE payable_id=?', [req.params.id]);
    await db.q('DELETE FROM payables WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));
  router.get('/payables/:id/payments', wrap(async (req, res) => {
    res.json(await db.q('SELECT * FROM payable_payments WHERE payable_id=? ORDER BY paid_at DESC, id DESC', [req.params.id]));
  }));
  router.post('/payables/:id/payments', wrap(async (req, res) => {
    const p = await db.one('SELECT amount, paid FROM payables WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const amount = num(req.body.amount);
    if (amount <= 0) return res.status(400).json({ error: 'Enter an amount greater than zero' });
    if (amount > p.amount - p.paid + 0.005) return res.status(400).json({ error: `This is more than the balance (${(p.amount - p.paid).toLocaleString()})` });
    await db.q('INSERT INTO payable_payments (payable_id, amount, method, reference, paid_at) VALUES (?,?,?,?,?)', [
      req.params.id, amount, String(req.body.method || 'M-Pesa').slice(0, 30), String(req.body.reference || '').slice(0, 80),
      isDate(req.body.paid_at) ? req.body.paid_at : today()]);
    await syncPayable(req.params.id);
    res.json({ ok: true });
  }));
  router.delete('/payable-payments/:id', adminOnly, wrap(async (req, res) => {
    const p = await db.one('SELECT payable_id FROM payable_payments WHERE id=?', [req.params.id]);
    if (p) { await db.q('DELETE FROM payable_payments WHERE id=?', [req.params.id]); await syncPayable(p.payable_id); }
    res.json({ ok: true });
  }));

  // ---- client project links ---------------------------------------------
  const cleanUrl = (u) => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
  router.get('/projects', wrap(async (req, res) => res.json(await db.q('SELECT * FROM projects ORDER BY id DESC LIMIT 500'))));
  router.post('/projects', wrap(async (req, res) => {
    const b = req.body;
    const url = cleanUrl(b.url);
    if (!b.client_name || !b.title || !url) return res.status(400).json({ error: 'Client, title and a valid link (starting with http) are required' });
    const r = await db.q('INSERT INTO projects (token, client_name, phone, quote_number, title, url, note) VALUES (?,?,?,?,?,?,?)', [
      crypto.randomBytes(12).toString('hex'), String(b.client_name).slice(0, 160), String(b.phone || '').slice(0, 40),
      String(b.quote_number || '').slice(0, 30), String(b.title).slice(0, 190), url, String(b.note || '').slice(0, 500)]);
    res.json({ id: r.insertId });
  }));
  router.put('/projects/:id', wrap(async (req, res) => {
    const b = req.body;
    const url = cleanUrl(b.url);
    if (!url) return res.status(400).json({ error: 'Enter a valid link starting with http' });
    await db.q('UPDATE projects SET client_name=?, phone=?, quote_number=?, title=?, url=?, note=? WHERE id=?', [
      String(b.client_name || '').slice(0, 160), String(b.phone || '').slice(0, 40), String(b.quote_number || '').slice(0, 30),
      String(b.title || '').slice(0, 190), url, String(b.note || '').slice(0, 500), req.params.id]);
    res.json({ ok: true });
  }));
  router.delete('/projects/:id', wrap(async (req, res) => {
    await db.q('DELETE FROM projects WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ---- users (admin only) -----------------------------------------------
  const ROLES = ['admin', 'staff'];
  router.get('/users', adminOnly, wrap(async (req, res) => {
    res.json(await db.q('SELECT id, name, email, phone, role, active, last_login, created_at FROM users ORDER BY id'));
  }));
  router.get('/users/:id', adminOnly, wrap(async (req, res) => {
    // the password hash is never sent out; only whether a password is set
    const u = await db.one('SELECT id, name, email, phone, role, active, last_login, created_at, LEFT(password_hash, 4) AS hash_kind FROM users WHERE id=?', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ ...u, password: 'Encrypted (bcrypt). It cannot be viewed by anyone.', hash_kind: undefined });
  }));
  router.post('/users', adminOnly, wrap(async (req, res) => {
    const b = req.body;
    const email = String(b.email || '').toLowerCase().trim();
    if (!b.name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required' });
    if (weakPassword(b.password)) return res.status(400).json({ error: weakPassword(b.password) });
    if (await db.one('SELECT id FROM users WHERE email=?', [email])) return res.status(400).json({ error: 'That email already has an account' });
    const r = await db.q('INSERT INTO users (email, name, phone, role, password_hash) VALUES (?,?,?,?,?)', [
      email, String(b.name).slice(0, 120), String(b.phone || '').slice(0, 40), ROLES.includes(b.role) ? b.role : 'staff', await hashPassword(b.password)]);
    res.json({ id: r.insertId });
  }));
  router.put('/users/:id', adminOnly, wrap(async (req, res) => {
    const b = req.body;
    const id = Number(req.params.id);
    const email = String(b.email || '').toLowerCase().trim();
    if (!b.name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required' });
    if (await db.one('SELECT id FROM users WHERE email=? AND id<>?', [email, id])) return res.status(400).json({ error: 'That email already has an account' });
    const role = ROLES.includes(b.role) ? b.role : 'staff';
    const active = b.active === false || b.active === '0' || b.active === 0 ? 0 : 1;
    if (id === req.user.id && (role !== 'admin' || !active)) return res.status(400).json({ error: 'You cannot remove your own admin access' });
    await db.q('UPDATE users SET name=?, email=?, phone=?, role=?, active=? WHERE id=?', [String(b.name).slice(0, 120), email, String(b.phone || '').slice(0, 40), role, active, id]);
    if (b.password) {
      if (weakPassword(b.password)) return res.status(400).json({ error: weakPassword(b.password) });
      await db.q('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(b.password), id]);
    }
    res.json({ ok: true });
  }));
  router.delete('/users/:id', adminOnly, wrap(async (req, res) => {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    await db.q('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ---- reports ------------------------------------------------------------
  const range = (req) => {
    const to = isDate(req.query.to) ? req.query.to : today();
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5);
    const from = isDate(req.query.from) ? req.query.from : d.toISOString().slice(0, 10);
    return [from, to];
  };

  async function buildSummary(from, to) {
    const first = async (sql, p) => Object.values((await db.one(sql, p)) || { n: 0 })[0] || 0;
    const invoiced = await first('SELECT COALESCE(SUM(amount-discount),0) FROM invoices WHERE DATE(created_at) BETWEEN ? AND ?', [from, to]);
    const collected = await first('SELECT COALESCE(SUM(amount),0) FROM payments WHERE paid_at BETWEEN ? AND ?', [from, to]);
    const expenses = await first('SELECT COALESCE(SUM(amount),0) FROM payable_payments WHERE paid_at BETWEEN ? AND ?', [from, to]);
    const receivable = await first("SELECT COALESCE(SUM(amount-discount-paid),0) FROM invoices WHERE status<>'paid'");
    const payable = await first("SELECT COALESCE(SUM(amount-paid),0) FROM payables WHERE status<>'paid'");
    const overdueRecv = await first("SELECT COALESCE(SUM(amount-discount-paid),0) FROM invoices WHERE status<>'paid' AND due_date<>'' AND due_date < ?", [today()]);
    const overduePay = await first("SELECT COALESCE(SUM(amount-paid),0) FROM payables WHERE status<>'paid' AND due_date<>'' AND due_date < ?", [today()]);

    const inM = await db.q("SELECT DATE_FORMAT(paid_at,'%Y-%m') m, SUM(amount) v FROM payments WHERE paid_at BETWEEN ? AND ? GROUP BY m", [from, to]);
    const outM = await db.q("SELECT DATE_FORMAT(paid_at,'%Y-%m') m, SUM(amount) v FROM payable_payments WHERE paid_at BETWEEN ? AND ? GROUP BY m", [from, to]);
    const invM = await db.q("SELECT DATE_FORMAT(created_at,'%Y-%m') m, SUM(amount-discount) v FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY m", [from, to]);
    const months = [...new Set([...inM, ...outM, ...invM].map((r) => r.m))].sort();
    const pick = (rows, m) => Number((rows.find((r) => r.m === m) || {}).v || 0);
    const byMonth = months.map((m) => ({ month: m, invoiced: pick(invM, m), collected: pick(inM, m), expenses: pick(outM, m) }));

    const byType = await db.q(
      `SELECT COALESCE(NULLIF(event_type,''),'Other') type, COUNT(*) invoices, SUM(amount-discount) invoiced, SUM(paid) collected
       FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY type ORDER BY invoiced DESC`, [from, to]);
    const topClients = await db.q(
      `SELECT client_name, COUNT(*) invoices, SUM(amount-discount) invoiced, SUM(paid) paid
       FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY client_name, phone ORDER BY invoiced DESC LIMIT 8`, [from, to]);
    const expByCat = await db.q(
      `SELECT p.category, SUM(pp.amount) total FROM payable_payments pp JOIN payables p ON p.id=pp.payable_id
       WHERE pp.paid_at BETWEEN ? AND ? GROUP BY p.category ORDER BY total DESC`, [from, to]);
    const quotes = await first('SELECT COUNT(*) FROM quotes WHERE DATE(created_at) BETWEEN ? AND ?', [from, to]);
    const quotesInvoiced = await first('SELECT COUNT(*) FROM quotes WHERE invoice_id IS NOT NULL AND DATE(created_at) BETWEEN ? AND ?', [from, to]);

    return { from, to, invoiced, collected, expenses, net: collected - expenses, receivable, payable, overdueRecv, overduePay,
      byMonth, byType, topClients, expByCat, quotes, quotesInvoiced };
  }
  router.get('/reports', adminOnly, wrap(async (req, res) => {
    const [from, to] = range(req);
    res.json(await buildSummary(from, to));
  }));
  require('./reports')(router, { wrap, adminOnly, buildSummary, range });
  require('./people')(router, { wrap, adminOnly });

  // cells starting with = + - @ are prefixed so Excel never runs a client-typed name as a formula
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  router.get('/reports/csv', adminOnly, wrap(async (req, res) => {
    const [from, to] = range(req);
    let head, rows;
    if (req.query.type === 'expenses') {
      head = ['Date', 'Supplier', 'Description', 'Category', 'Method', 'Reference', 'Amount'];
      rows = (await db.q(`SELECT pp.paid_at, p.supplier, p.description, p.category, pp.method, pp.reference, pp.amount
        FROM payable_payments pp JOIN payables p ON p.id=pp.payable_id WHERE pp.paid_at BETWEEN ? AND ? ORDER BY pp.paid_at`, [from, to])).map(Object.values);
    } else if (req.query.type === 'invoices') {
      head = ['Invoice', 'Date', 'Client', 'Phone', 'Package', 'Total', 'Paid', 'Balance', 'Status'];
      rows = (await db.q(`SELECT number, DATE(created_at), client_name, phone, package_name, amount-discount, paid, amount-discount-paid, status
        FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY id`, [from, to])).map(Object.values);
    } else {
      head = ['Date', 'Invoice', 'Client', 'Method', 'Reference', 'Amount'];
      rows = (await db.q(`SELECT pa.paid_at, i.number, i.client_name, pa.method, pa.reference, pa.amount
        FROM payments pa JOIN invoices i ON i.id=pa.invoice_id WHERE pa.paid_at BETWEEN ? AND ? ORDER BY pa.paid_at`, [from, to])).map(Object.values);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="smg-${req.query.type || 'payments'}-${from}-to-${to}.csv"`);
    res.send('﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }));
};
