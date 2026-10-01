const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const pdf = require('../pdf');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';
// On Railway point UPLOADS_DIR at the mounted volume (e.g. /data/uploads) so files survive redeploys
const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// Recalculate an invoice's paid amount and status from its payment records
async function syncInvoice(id) {
  const inv = await db.one('SELECT amount, discount FROM invoices WHERE id=?', [id]);
  if (!inv) return null;
  const { s: paid } = await db.one('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?', [id]);
  const total = inv.amount - inv.discount;
  const status = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial';
  await db.q('UPDATE invoices SET paid=?, status=? WHERE id=?', [paid, status, id]);
  return status;
}

// ---- auth -------------------------------------------------------------
router.post('/login', wrap(async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const u = await db.one('SELECT * FROM users WHERE email=?', [String(email).toLowerCase().trim()]);
  if (!u || !u.active || !(await bcrypt.compare(String(password), u.password_hash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  await db.q('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
  const token = jwt.sign({ id: u.id }, SECRET(), { expiresIn: '7d' });
  res.cookie('smg_admin', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5, secure: req.secure });
  res.json({ name: u.name, email: u.email, role: u.role });
}));

router.post('/logout', (req, res) => { res.clearCookie('smg_admin'); res.json({ ok: true }); });

// signed-in user is re-read on every request so disabling an account takes effect at once
const auth = wrap(async (req, res, next) => {
  let id;
  try { id = jwt.verify(req.cookies.smg_admin || '', SECRET()).id; }
  catch (e) { return res.status(401).json({ error: 'Please sign in' }); }
  const u = await db.one('SELECT id, name, email, role, active FROM users WHERE id=?', [id]);
  if (!u || !u.active) return res.status(401).json({ error: 'Please sign in' });
  req.user = u;
  next();
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only an admin can do this' }));

router.get('/me', auth, (req, res) => res.json(req.user));
router.use(auth);

router.post('/password', wrap(async (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const u = await db.one('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!(await bcrypt.compare(String(current), u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  await db.q('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(String(next), 10), u.id]);
  res.json({ ok: true });
}));

// ---- dashboard + visitors --------------------------------------------
router.get('/stats', wrap(async (req, res) => {
  const one = async (sql) => Object.values((await db.one(sql)) || { n: 0 })[0];
  const days = await db.q(
    `SELECT DATE(created_at) d, COUNT(*) views, COUNT(DISTINCT visitor) visitors
     FROM visits WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(created_at) ORDER BY d`);
  res.json({
    visitorsToday: await one('SELECT COUNT(DISTINCT visitor) n FROM visits WHERE DATE(created_at)=CURDATE()'),
    visitors30: await one('SELECT COUNT(DISTINCT visitor) n FROM visits WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'),
    views30: await one('SELECT COUNT(*) n FROM visits WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'),
    newQuotes: await one("SELECT COUNT(*) n FROM quotes WHERE status='new'"),
    unpaid: await one("SELECT COALESCE(SUM(amount-discount-paid),0) n FROM invoices WHERE status<>'paid'"),
    photos: await one("SELECT COUNT(*) n FROM media WHERE type='image'"),
    videos: await one("SELECT COUNT(*) n FROM media WHERE type='video'"),
    days,
    topPages: await db.q(`SELECT path, COUNT(*) views FROM visits WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY path ORDER BY views DESC LIMIT 8`),
    devices: await db.q(`SELECT device, COUNT(DISTINCT visitor) n FROM visits WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY device`),
    referrers: await db.q(`SELECT referrer, COUNT(*) n FROM visits WHERE referrer<>'' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY referrer ORDER BY n DESC LIMIT 8`),
  });
}));

router.get('/visits', wrap(async (req, res) => {
  res.json(await db.q('SELECT id, visitor, path, referrer, device, ip, created_at FROM visits ORDER BY id DESC LIMIT 200'));
}));

// ---- settings ---------------------------------------------------------
router.get('/settings', wrap(async (req, res) => res.json(await db.getSettings())));
router.put('/settings', adminOnly, wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {}))
    await db.q('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k.slice(0, 60), String(v)]);
  res.json(await db.getSettings());
}));

const flag = (v, dflt) => (v === undefined ? dflt : v === true || v === '1' || v === 'true' || v === 'on' || v === 1 ? 1 : 0);
const pkgFields = (b) => [
  String(b.category || 'Wedding').slice(0, 40), String(b.name || '').slice(0, 160), String(b.tagline || '').slice(0, 255),
  Number(b.price) || 0, String(b.features || ''), flag(b.popular, 0), flag(b.active, 1), Number(b.sort_order) || 0,
];
// ---- uploads (photos + videos) ---------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS, file.mimetype.startsWith('video/') ? 'videos' : 'images');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
  limits: { fileSize: 800 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

const unlinkUpload = (rel) => { if (rel) fs.unlink(path.join(UPLOADS, rel.replace(/^\/?uploads\//, '')), () => {}); };

router.get('/media', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = (await db.one('SELECT COUNT(*) n FROM media')).n;
  res.json({ total, items: await db.q('SELECT * FROM media ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]) });
}));
router.post('/media', upload.array('files', 100), wrap(async (req, res) => {
  const category = String(req.body.category || 'general').slice(0, 40);
  const title = String(req.body.title || '').slice(0, 190);
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Choose photos or videos (image/* or video/*)' });
  for (const f of req.files) {
    const isVideo = f.mimetype.startsWith('video/');
    await db.q('INSERT INTO media (type,category,title,file) VALUES (?,?,?,?)', [
      isVideo ? 'video' : 'image', category, title || path.parse(f.originalname).name.slice(0, 190),
      `/uploads/${isVideo ? 'videos' : 'images'}/${f.filename}`]);
  }
  res.json({ uploaded: req.files.length });
}));
router.put('/media/:id', wrap(async (req, res) => {
  await db.q('UPDATE media SET title=?, category=? WHERE id=?', [String(req.body.title || '').slice(0, 190), String(req.body.category || 'general').slice(0, 40), req.params.id]);
  res.json({ ok: true });
}));
router.delete('/media/:id', wrap(async (req, res) => {
  const m = await db.one('SELECT file FROM media WHERE id=?', [req.params.id]);
  if (m) { unlinkUpload(m.file); await db.q('DELETE FROM media WHERE id=?', [req.params.id]); }
  res.json({ ok: true });
}));


// ---- packages ---------------------------------------------------------
router.get('/packages', wrap(async (req, res) => res.json(await db.q('SELECT * FROM packages ORDER BY sort_order, id'))));
const knownCategory = (name) => db.one('SELECT id FROM package_categories WHERE name=?', [String(name || '')]);
router.post('/packages', upload.single('image'), wrap(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Name is required' });
  if (!(await knownCategory(req.body.category))) return res.status(400).json({ error: 'Choose a category (add one under Manage categories)' });
  const r = await db.q('INSERT INTO packages (category,name,tagline,price,features,popular,active,sort_order,image) VALUES (?,?,?,?,?,?,?,?,?)',
    [...pkgFields(req.body), req.file ? `/uploads/images/${req.file.filename}` : '']);
  res.json({ id: r.insertId });
}));
router.put('/packages/:id', upload.single('image'), wrap(async (req, res) => {
  const old = await db.one('SELECT image FROM packages WHERE id=?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  if (!(await knownCategory(req.body.category))) return res.status(400).json({ error: 'Choose a category (add one under Manage categories)' });
  let image = old.image;
  if (req.file) { unlinkUpload(old.image); image = `/uploads/images/${req.file.filename}`; }
  else if (req.body.remove_image === '1') { unlinkUpload(old.image); image = ''; }
  await db.q('UPDATE packages SET category=?,name=?,tagline=?,price=?,features=?,popular=?,active=?,sort_order=?,image=? WHERE id=?',
    [...pkgFields(req.body), image, req.params.id]);
  res.json({ ok: true });
}));
router.delete('/packages/:id', wrap(async (req, res) => {
  const p = await db.one('SELECT image FROM packages WHERE id=?', [req.params.id]);
  if (p) { unlinkUpload(p.image); await db.q('DELETE FROM packages WHERE id=?', [req.params.id]); }
  res.json({ ok: true });
}));

// ---- blog -------------------------------------------------------------
const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'post';
router.get('/posts', wrap(async (req, res) => res.json(await db.q('SELECT * FROM posts ORDER BY id DESC'))));
router.post('/posts', upload.single('cover'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.title) return res.status(400).json({ error: 'Title is required' });
  let slug = slugify(b.title);
  if (await db.one('SELECT id FROM posts WHERE slug=?', [slug])) slug += '-' + Date.now().toString(36);
  const r = await db.q('INSERT INTO posts (slug,title,excerpt,body,cover,published) VALUES (?,?,?,?,?,?)', [
    slug, b.title.slice(0, 255), String(b.excerpt || '').slice(0, 500), b.body || '',
    req.file ? `/uploads/images/${req.file.filename}` : '', b.published === '0' ? 0 : 1]);
  res.json({ id: r.insertId, slug });
}));
router.put('/posts/:id', upload.single('cover'), wrap(async (req, res) => {
  const b = req.body;
  const old = await db.one('SELECT cover FROM posts WHERE id=?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  let cover = old.cover;
  if (req.file) { unlinkUpload(old.cover); cover = `/uploads/images/${req.file.filename}`; }
  await db.q('UPDATE posts SET title=?, excerpt=?, body=?, cover=?, published=? WHERE id=?', [
    String(b.title || '').slice(0, 255), String(b.excerpt || '').slice(0, 500), b.body || '', cover, b.published === '0' ? 0 : 1, req.params.id]);
  res.json({ ok: true });
}));
router.delete('/posts/:id', wrap(async (req, res) => {
  const p = await db.one('SELECT cover FROM posts WHERE id=?', [req.params.id]);
  if (p) { unlinkUpload(p.cover); await db.q('DELETE FROM posts WHERE id=?', [req.params.id]); }
  res.json({ ok: true });
}));

// ---- quotes -> invoices ----------------------------------------------
router.get('/quotes', wrap(async (req, res) => res.json(await db.q('SELECT * FROM quotes ORDER BY id DESC LIMIT 300'))));
router.put('/quotes/:id', wrap(async (req, res) => {
  const b = req.body;
  await db.q(
    `UPDATE quotes SET client_name=?, phone=?, email=?, event_date=?, venue=?, package_name=?, items=?, price=?, discount=?, notes=?, status=? WHERE id=?`,
    [b.client_name, b.phone, b.email || '', b.event_date || '', b.venue || '', b.package_name, b.items || '', Number(b.price) || 0,
      Number(b.discount) || 0, b.notes || '', b.status || 'new', req.params.id]);
  res.json({ ok: true });
}));
router.delete('/quotes/:id', wrap(async (req, res) => {
  await db.q('DELETE FROM quotes WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));
router.get('/quotes/:id/pdf', wrap(async (req, res) => {
  const q = await db.one('SELECT * FROM quotes WHERE id=?', [req.params.id]);
  if (!q) return res.status(404).send('Not found');
  pdf.quote(res, q, await db.getSettings());
}));
router.post('/quotes/:id/invoice', wrap(async (req, res) => {
  const q = await db.one('SELECT * FROM quotes WHERE id=?', [req.params.id]);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (q.invoice_id) return res.json({ id: q.invoice_id, existing: true });
  const number = await db.nextNumber('invoices', 'SMG-INV');
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const r = await db.q(
    `INSERT INTO invoices (number, quote_id, client_name, phone, email, event_type, event_date, venue, package_name, items, amount, discount, due_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, q.id, q.client_name, q.phone, q.email, q.event_type, q.event_date, q.venue, q.package_name, q.items, q.price, q.discount, due, q.notes]);
  await db.q("UPDATE quotes SET invoice_id=?, status='invoiced' WHERE id=?", [r.insertId, q.id]);
  res.json({ id: r.insertId, number });
}));

router.get('/invoices', wrap(async (req, res) => res.json(await db.q('SELECT * FROM invoices ORDER BY id DESC LIMIT 300'))));
router.put('/invoices/:id', wrap(async (req, res) => {
  const b = req.body;
  await db.q('UPDATE invoices SET client_name=?, phone=?, email=?, event_date=?, venue=?, package_name=?, items=?, amount=?, discount=?, due_date=?, notes=? WHERE id=?',
    [b.client_name, b.phone || '', b.email || '', b.event_date || '', b.venue || '', b.package_name, b.items || '', Number(b.amount) || 0,
      Number(b.discount) || 0, b.due_date || '', b.notes || '', req.params.id]);
  res.json({ ok: true, status: await syncInvoice(req.params.id) });
}));
router.delete('/invoices/:id', adminOnly, wrap(async (req, res) => {
  await db.q('DELETE FROM payments WHERE invoice_id=?', [req.params.id]);
  await db.q("UPDATE quotes SET invoice_id=NULL, status='new' WHERE invoice_id=?", [req.params.id]);
  await db.q('DELETE FROM invoices WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));
router.get('/invoices/:id/pdf', wrap(async (req, res) => {
  const i = await db.one('SELECT * FROM invoices WHERE id=?', [req.params.id]);
  if (!i) return res.status(404).send('Not found');
  i.payments = await db.q('SELECT amount, method, reference, paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at, id', [i.id]);
  pdf.invoice(res, i, await db.getSettings());
}));

require('./business')(router, { wrap, adminOnly, syncInvoice, upload });

// multer errors -> JSON
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  next(err);
});

module.exports = router;
