const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const pdf = require('../pdf');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- visitor tracking -------------------------------------------------
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget/i;
router.post('/track', wrap(async (req, res) => {
  const ua = req.get('user-agent') || '';
  if (BOT.test(ua)) return res.json({ ok: true });
  const path = String(req.body.path || '/').slice(0, 250);
  if (path.startsWith('/admin')) return res.json({ ok: true });
  // visitor id = hash of ip + ua (no raw cookies, no tracking across sites)
  const ip = req.ip || '';
  const visitor = crypto.createHash('sha1').update(ip + ua).digest('hex').slice(0, 16);
  const device = /mobile|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  await db.q('INSERT INTO visits (visitor, path, referrer, device, ip) VALUES (?,?,?,?,?)', [
    visitor, path, String(req.body.referrer || '').slice(0, 250), device, ip.slice(0, 60),
  ]);
  res.json({ ok: true });
}));

// ---- content ----------------------------------------------------------
router.get('/settings', wrap(async (req, res) => {
  const s = await db.getSettings();
  delete s.quote_terms; delete s.payment_details;
  res.json(s);
}));

router.get('/packages', wrap(async (req, res) => {
  res.json(await db.q('SELECT * FROM packages WHERE active=1 ORDER BY sort_order, id'));
}));

router.get('/gallery', wrap(async (req, res) => {
  const params = [];
  let where = "type='image'";
  if (req.query.category) { where += ' AND category=?'; params.push(req.query.category); }
  res.json(await db.q(`SELECT * FROM media WHERE ${where} ORDER BY id DESC LIMIT 200`, params));
}));

router.get('/videos', wrap(async (req, res) => {
  res.json(await db.q("SELECT * FROM media WHERE type='video' ORDER BY id DESC LIMIT 50"));
}));

router.post('/media/:id/like', wrap(async (req, res) => {
  await db.q('UPDATE media SET likes=likes+1 WHERE id=?', [req.params.id]);
  const m = await db.one('SELECT id, likes FROM media WHERE id=?', [req.params.id]);
  res.json(m || {});
}));

router.post('/media/:id/view', wrap(async (req, res) => {
  await db.q('UPDATE media SET views=views+1 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

// Automatic picks. Day / month choices are deterministic (same for every visitor that
// day/month, change automatically); best memories are ranked by likes and views.
function seededIndex(seed, n) {
  const h = crypto.createHash('md5').update(seed).digest();
  return h.readUInt32BE(0) % n;
}
router.get('/picks', wrap(async (req, res) => {
  const images = await db.q("SELECT * FROM media WHERE type='image' ORDER BY id");
  if (!images.length) return res.json({ day: null, month: null, best: [] });
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const day = images[seededIndex('day-' + dayKey, images.length)];
  // month pick avoids repeating the day pick when there is a choice
  let pool = images.filter((i) => i.id !== day.id);
  if (!pool.length) pool = images;
  const month = pool[seededIndex('month-' + monthKey, pool.length)];
  const best = [...images]
    .sort((a, b) => (b.likes * 5 + b.views) - (a.likes * 5 + a.views) || b.id - a.id)
    .slice(0, 6);
  res.json({ day, month, best });
}));

router.get('/posts', wrap(async (req, res) => {
  res.json(await db.q('SELECT id, slug, title, excerpt, cover, created_at FROM posts WHERE published=1 ORDER BY id DESC LIMIT 50'));
}));
router.get('/posts/:slug', wrap(async (req, res) => {
  const p = await db.one('SELECT * FROM posts WHERE slug=? AND published=1', [req.params.slug]);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  res.json(p);
}));

// ---- quotes -----------------------------------------------------------
router.post('/quotes', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.client_name || '').trim();
  const phone = String(b.phone || '').trim();
  if (!name || phone.length < 7) return res.status(400).json({ error: 'Please enter your name and a valid phone number.' });
  const pkg = await db.one('SELECT * FROM packages WHERE id=? AND active=1', [b.package_id]);
  if (!pkg) return res.status(400).json({ error: 'Please choose a package.' });

  const number = await db.nextNumber('quotes', 'SMG-Q');
  const token = crypto.randomBytes(24).toString('hex');
  const r = await db.q(
    `INSERT INTO quotes (number, token, client_name, phone, email, event_type, event_date, venue, package_id, package_name, items, price, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, token, name.slice(0, 160), phone.slice(0, 40), String(b.email || '').slice(0, 190), pkg.category,
      String(b.event_date || '').slice(0, 20), String(b.venue || '').slice(0, 255), pkg.id, pkg.name, pkg.features, pkg.price,
      String(b.notes || '').slice(0, 2000)]
  );
  res.json({ id: r.insertId, number, download: `/api/public/quotes/${token}/pdf` });
}));

router.get('/quotes/:token/pdf', wrap(async (req, res) => {
  const q = await db.one('SELECT * FROM quotes WHERE token=?', [req.params.token]);
  if (!q) return res.status(404).send('Quotation not found');
  pdf.quote(res, q, await db.getSettings());
}));

module.exports = router;
