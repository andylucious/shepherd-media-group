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
