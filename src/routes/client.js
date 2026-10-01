// Client accounts: register, sign in, and a private area with their quotations, invoices, receipts and projects.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const pdf = require('../pdf');
const { secret: SECRET, pv, weakPassword, lock, limiter, bookingStatus, hashPassword, needsRehash } = require('../util');
const { receiptData } = require('../receipts');
const docs = require('../docs');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// a real hash to compare against when the account does not exist, so response time does not reveal which emails are registered
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const COOKIE = 'smg_client';
const authLimit = limiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many attempts. Please wait 15 minutes and try again.' });
const signupLimit = limiter({ windowMs: 60 * 60 * 1000, max: 8, message: 'Too many sign-ups from this connection. Please try again later.' });
const last9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function setSession(req, res, c) {
  const token = jwt.sign({ cid: c.id, pv: pv(c.password_hash), typ: 'client' }, SECRET(), { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', maxAge: 30 * 864e5, secure: req.secure });
}

// The signed-in client for a request, or null. Also used by the public quote form.
async function clientFromReq(req) {
  try {
    const t = jwt.verify((req.cookies || {})[COOKIE] || '', SECRET());
    if (t.typ !== 'client') return null;
    const c = await db.one('SELECT * FROM clients WHERE id=?', [t.cid]);
    return c && c.active && t.pv === pv(c.password_hash) ? c : null;
  } catch (e) { return null; }
}
const publicClient = (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone });

const auth = wrap(async (req, res, next) => {
  const c = await clientFromReq(req);
  if (!c) return res.status(401).json({ error: 'Please sign in' });
  req.client = c;
  next();
});

router.post('/register', signupLimit, wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 160);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 190);
  const phone = String(b.phone || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (last9(phone).length < 9) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  const weak = weakPassword(b.password);
  if (weak) return res.status(400).json({ error: weak });
  if (await db.one('SELECT id FROM clients WHERE email=?', [email]))
    return res.status(400).json({ error: 'An account with this email already exists. Try signing in.' });
  const hash = await hashPassword(b.password);
  const r = await db.q('INSERT INTO clients (name, email, phone, password_hash, last_login) VALUES (?,?,?,?,NOW())', [name, email, phone, hash]);
  const c = { id: r.insertId, name, email, phone, password_hash: hash };
  setSession(req, res, c);
  res.json(publicClient(c));
}));

router.post('/login', authLimit, wrap(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const key = 'client:' + email + '|' + req.ip;
  const locked = lock.check(key);
  if (locked) return res.status(429).json({ error: `Too many wrong passwords. Try again in ${locked} minute(s).` });
  const c = await db.one('SELECT * FROM clients WHERE email=?', [email]);
  const ok = await bcrypt.compare(String((req.body || {}).password || ''), c ? c.password_hash : DUMMY_HASH);
  if (!c || !c.active || !ok) { lock.fail(key); return res.status(401).json({ error: 'Wrong email or password.' }); }
  lock.ok(key);
  if (needsRehash(c.password_hash)) { c.password_hash = await hashPassword(req.body.password); await db.q('UPDATE clients SET password_hash=? WHERE id=?', [c.password_hash, c.id]); }
  await db.q('UPDATE clients SET last_login=NOW() WHERE id=?', [c.id]);
  setSession(req, res, c);
  res.json(publicClient(c));
}));

router.post('/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

// Used by every page to show "My account" / "Sign in". Never an error: null when signed out.
router.get('/me', wrap(async (req, res) => {
  const c = await clientFromReq(req);
  res.json(c ? publicClient(c) : null);
}));

router.use(auth);

router.put('/me', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 160);
  const phone = String(req.body.phone || '').trim().slice(0, 40);
  if (!name || last9(phone).length < 9) return res.status(400).json({ error: 'Enter your name and a valid phone number.' });
  await db.q('UPDATE clients SET name=?, phone=? WHERE id=?', [name, phone, req.client.id]);
  res.json({ ok: true });
}));

router.post('/password', wrap(async (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (!(await bcrypt.compare(String(current), req.client.password_hash))) return res.status(400).json({ error: 'Your current password is wrong.' });
  const weak = weakPassword(next);
  if (weak) return res.status(400).json({ error: weak });
  const hash = await hashPassword(next);
  await db.q('UPDATE clients SET password_hash=? WHERE id=?', [hash, req.client.id]);
  setSession(req, res, { ...req.client, password_hash: hash });
  res.json({ ok: true });
}));

// Everything that belongs to this client
router.get('/overview', wrap(async (req, res) => {
  const quotes = await db.q('SELECT id, number, token, package_name, event_type, event_date, venue, price, discount, status, invoice_id, created_at FROM quotes WHERE client_id=? ORDER BY id DESC', [req.client.id]);
  const invoices = await db.q(`SELECT i.* FROM invoices i JOIN quotes q ON q.id=i.quote_id WHERE q.client_id=? ORDER BY i.id DESC`, [req.client.id]);
  const numbers = [...quotes.map((q) => q.number), ...invoices.map((i) => i.number)];
  const projects = numbers.length ? await db.q('SELECT id, title, url, note, quote_number, created_at FROM projects WHERE quote_number IN (?) ORDER BY id DESC', [numbers]) : [];
  const out = [];
  for (const i of invoices) {
    const q = quotes.find((x) => x.id === i.quote_id);
    const mine = projects.filter((p) => p.quote_number === i.number || (q && p.quote_number === q.number));
    const total = i.amount - i.discount;
    out.push({
      id: i.id, number: i.number, package_name: i.package_name, event_type: i.event_type, event_date: i.event_date, venue: i.venue,
      total, paid: i.paid, balance: Math.max(total - i.paid, 0), status: i.status, due_date: i.due_date,
      booking: bookingStatus({ event_date: i.event_date, completed: !!i.completed_at, delivered: mine.length > 0 }),
      payments: await db.q('SELECT id, amount, method, reference, paid_at, receipt_number FROM payments WHERE invoice_id=? ORDER BY paid_at, id', [i.id]),
      projects: mine,
    });
  }
  // every receipt on the account, newest first (this is the "My receipts" list)
  const receipts = await db.q(`SELECT pa.id, pa.receipt_number, pa.amount, pa.method, pa.reference, pa.paid_at, pa.created_at, i.number AS invoice_number, i.package_name
    FROM payments pa JOIN invoices i ON i.id=pa.invoice_id JOIN quotes q ON q.id=i.quote_id
    WHERE q.client_id=? ORDER BY pa.paid_at DESC, pa.id DESC`, [req.client.id]);
  res.json({ client: publicClient(req.client), quotes, invoices: out, receipts });
}));

// Download a receipt. Only works for payments on this client's own invoices.
router.get('/receipts/:id/pdf', wrap(async (req, res) => {
  const pay = await db.one(`SELECT pa.* FROM payments pa JOIN invoices i ON i.id=pa.invoice_id JOIN quotes q ON q.id=i.quote_id
    WHERE pa.id=? AND q.client_id=?`, [req.params.id, req.client.id]);
  if (!pay) return res.status(404).send('Not found');
  docs.receipt(res, await receiptData(pay), await db.getSettings(), req.query.inline === '1');
}));

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
  const inv = await db.one('SELECT i.* FROM invoices i JOIN quotes q ON q.id=i.quote_id WHERE i.id=? AND q.client_id=?', [req.params.id, req.client.id]);
  if (!inv) return res.status(404).send('Not found');
  inv.payments = await db.q('SELECT amount, method, reference, paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at, id', [inv.id]);
  pdf.invoice(res, inv, await db.getSettings());
}));

// count a view when the client opens a project link from their account
router.post('/projects/:id/viewed', wrap(async (req, res) => {
  const p = await db.one(`SELECT p.id FROM projects p WHERE p.id=? AND (
      p.quote_number IN (SELECT number FROM quotes WHERE client_id=?)
      OR p.quote_number IN (SELECT i.number FROM invoices i JOIN quotes q ON q.id=i.quote_id WHERE q.client_id=?))`, [req.params.id, req.client.id, req.client.id]);
  if (p) await db.q('UPDATE projects SET views=views+1, first_viewed_at=COALESCE(first_viewed_at, NOW()) WHERE id=?', [p.id]);
  res.json({ ok: true });
}));

// Add an earlier quotation or invoice to this account. Needs the reference number AND the phone number used on it.
router.post('/claim', limiterClaim(), wrap(async (req, res) => {
  const ref = String(req.body.reference || '').trim().toUpperCase();
  const phone = last9(req.body.phone);
  if (!ref || phone.length < 9) return res.status(400).json({ error: 'Enter the reference number and the phone number used.' });
  let q = await db.one('SELECT * FROM quotes WHERE number=?', [ref]);
  if (!q) q = await db.one('SELECT q.* FROM quotes q JOIN invoices i ON i.quote_id=q.id WHERE i.number=?', [ref]);
  if (!q || last9(q.phone) !== phone) return res.status(404).json({ error: 'We could not match that reference and phone number.' });
  if (q.client_id && q.client_id !== req.client.id) return res.status(400).json({ error: 'That quotation already belongs to another account. Please contact us.' });
  await db.q('UPDATE quotes SET client_id=? WHERE id=?', [req.client.id, q.id]);
  res.json({ ok: true, number: q.number });
}));
function limiterClaim() { return limiter({ windowMs: 15 * 60 * 1000, max: 15 }); }

module.exports = router;
module.exports.clientFromReq = clientFromReq;
