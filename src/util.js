// Shared helpers: dates in Kenyan time, booking status, simple rate limiting.

// Today as YYYY-MM-DD in Africa/Nairobi, so "before / after the event" flips at local midnight.
const today = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};

const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);

// Booking status shown to the admin and the client:
//   Completed   - the project link was sent or the job was marked completed
//   Booked      - the event date is still ahead (shows the date)
//   In progress - the event date has come and the project is not delivered yet
function bookingStatus({ event_date, completed, delivered }) {
  const t = today();
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(event_date || '');
  if (completed || delivered) return { code: 'completed', label: 'Completed' };
  if (!isDate) return { code: 'booked', label: 'Booked (date to be confirmed)' };
  if (event_date > t) {
    const n = daysBetween(t, event_date);
    return { code: 'booked', label: 'Booked', date: event_date, days: n, in: n === 1 ? 'tomorrow' : `in ${n} days` };
  }
  return { code: 'in_progress', label: 'In progress', date: event_date };
}

// In-memory limiter (per IP). Good enough for one server; protects forms and login from floods.
function limiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || 'x';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    next();
  };
}

module.exports = { today, daysBetween, bookingStatus, limiter };

// ---------------------------------------------------------------- security helpers
const crypto = require('crypto');

// One signing secret for both admin and client sessions. Without JWT_SECRET a random one is made per run.
const RUN_SECRET = crypto.randomBytes(32).toString('hex');
const secret = () => process.env.JWT_SECRET || RUN_SECRET;

// Fingerprint of the stored password hash. Put in the session token, so changing a password signs out every old session.
const pv = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);

const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou', 'admin123', 'letmein123', 'welcome1', 'abc12345', '11111111', '00000000']);
// Returns an error message for a weak NEW password, or '' when it is acceptable.
function weakPassword(pw) {
  const p = String(pw || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (COMMON.has(p.toLowerCase()) || /^(.)\1+$/.test(p)) return 'That password is too easy to guess. Choose another.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use at least one letter and one number in the password.';
  return '';
}

// Per-account sign-in throttle (on top of the per-IP limiter): 6 wrong passwords locks that account for 15 minutes.
const fails = new Map();
const lock = {
  check(key) { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; },
  fail(key) {
    if (fails.size > 5000) fails.clear(); // bounded memory if someone sprays random emails
    const cur = fails.get(key) || { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= 6) { cur.until = Date.now() + 15 * 60 * 1000; cur.n = 0; }
    fails.set(key, cur);
  },
  ok(key) { fails.delete(key); },
};

Object.assign(module.exports, { secret, pv, weakPassword, lock });
