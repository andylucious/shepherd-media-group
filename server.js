require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./src/db');

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
app.use(express.json({ limit: '2mb' }));
app.use(require('cookie-parser')());

const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/public', require('./src/routes/public'));
app.use('/api/admin', require('./src/routes/admin'));

app.get('/admin', (req, res) => res.redirect('/admin/'));
app.get('/blog/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'post.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

const port = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(port, () => console.log(`Shepherd Media Group running on http://localhost:${port}`)))
  .catch((e) => {
    console.error('Database start-up failed:', e.message);
    process.exit(1);
  });
