const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbName = process.env.DB_NAME || 'shepherd_media';

const baseConfig = () => {
  const cfg = {
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  };
  // Cloud SQL via unix socket (Cloud Run / App Engine) or plain TCP (local, Cloud SQL proxy)
  if (process.env.DB_SOCKET) cfg.socketPath = process.env.DB_SOCKET;
  else {
    cfg.host = process.env.DB_HOST || '127.0.0.1';
    cfg.port = Number(process.env.DB_PORT || 3306);
  }
  return cfg;
};

let pool;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(60) PRIMARY KEY,
    v TEXT
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS packages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    tagline VARCHAR(255) DEFAULT '',
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    features TEXT,
    popular TINYINT(1) DEFAULT 0,
    active TINYINT(1) DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS media (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(10) NOT NULL,
    category VARCHAR(40) DEFAULT 'general',
    title VARCHAR(190) DEFAULT '',
    file VARCHAR(255) NOT NULL,
    likes INT DEFAULT 0,
    views INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    excerpt VARCHAR(500) DEFAULT '',
    body MEDIUMTEXT,
    cover VARCHAR(255) DEFAULT '',
    published TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(30) NOT NULL UNIQUE,
    token VARCHAR(64) NOT NULL UNIQUE,
    client_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    email VARCHAR(190) DEFAULT '',
    event_type VARCHAR(40) DEFAULT '',
    event_date VARCHAR(20) DEFAULT '',
    venue VARCHAR(255) DEFAULT '',
    package_id INT NULL,
    package_name VARCHAR(160) NOT NULL,
    items TEXT,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'new',
    invoice_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(30) NOT NULL UNIQUE,
    quote_id INT NULL,
    client_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) DEFAULT '',
    email VARCHAR(190) DEFAULT '',
    event_type VARCHAR(40) DEFAULT '',
    event_date VARCHAR(20) DEFAULT '',
    venue VARCHAR(255) DEFAULT '',
    package_name VARCHAR(160) NOT NULL,
    items TEXT,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'unpaid',
    due_date VARCHAR(20) DEFAULT '',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    method VARCHAR(30) DEFAULT 'M-Pesa',
    reference VARCHAR(80) DEFAULT '',
    note VARCHAR(255) DEFAULT '',
    paid_at DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (invoice_id), INDEX (paid_at)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier VARCHAR(160) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    category VARCHAR(40) DEFAULT 'Other',
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'unpaid',
    due_date VARCHAR(20) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payable_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    payable_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    method VARCHAR(30) DEFAULT 'M-Pesa',
    reference VARCHAR(80) DEFAULT '',
    paid_at DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (payable_id), INDEX (paid_at)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(40) NOT NULL UNIQUE,
    client_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) DEFAULT '',
    quote_number VARCHAR(30) DEFAULT '',
    title VARCHAR(190) NOT NULL,
    url VARCHAR(600) NOT NULL,
    note VARCHAR(500) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS visits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visitor VARCHAR(40) NOT NULL,
    path VARCHAR(255) NOT NULL,
    referrer VARCHAR(255) DEFAULT '',
    device VARCHAR(20) DEFAULT '',
    ip VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (created_at)
  ) DEFAULT CHARSET=utf8mb4`,
];

const DEFAULT_SETTINGS = {
  company_name: 'Shepherd Media Group',
  tagline: 'Capturing Moments | Telling Stories',
  phone: '0796335184',
  whatsapp: '254796335184',
  email: 'info@shepherdmedia.co.ke',
  address: 'Nairobi, Kenya',
  quote_terms:
    'This quotation is valid for 14 days. A 50% deposit secures your date; the balance is due on or before the event day. Prices are in Kenya Shillings (KES).',
  payment_details: 'M-Pesa / Bank details provided on confirmation.',
  ceo_name: 'David Murith',
  ceo_title: 'Founder & CEO',
  about:
    'Shepherd Media Group is a professional photography and videography company. We capture weddings, ruracio, burials and live events, and stream them to family and friends anywhere in the world.',
};

const DEFAULT_PACKAGES = [
  ['Wedding', 'Wedding Silver', 'Essential wedding coverage', 60000, 'One photographer\nOne videographer\nCeremony and reception coverage (up to 6 hours)\n300+ edited photos\n5-minute highlight film\nOnline gallery', 0],
  ['Wedding', 'Wedding Gold', 'Our most booked wedding package', 110000, 'Two photographers\nTwo videographers\nFull day coverage (up to 10 hours)\n600+ edited photos\nCinematic highlight film (8-10 minutes)\nFull ceremony video\nDrone shots\nPremium photo album (30 pages)', 1],
  ['Wedding', 'Wedding Platinum', 'Complete wedding storytelling', 180000, 'Three photographers\nTwo videographers\nPre-wedding shoot\nFull day coverage\nUnlimited edited photos\nCinematic film and full documentary\nDrone shots\nTwo premium albums\nLive stream of the ceremony', 0],
  ['Ruracio', 'Ruracio Standard', 'Traditional ceremony coverage', 40000, 'One photographer\nOne videographer\nUp to 5 hours coverage\n200+ edited photos\n4-minute highlight film\nOnline gallery', 0],
  ['Ruracio', 'Ruracio Premium', 'Full ruracio story', 75000, 'Two photographers\nTwo videographers\nFull day coverage\n400+ edited photos\nHighlight film and full ceremony video\nDrone shots\nPhoto album (20 pages)', 1],
  ['Livestreaming', 'Live Stream Basic', 'Stream your event online', 25000, 'Single camera HD stream\nStreaming to Facebook or YouTube\nUp to 3 hours\nStream link shared with guests\nRecording of the stream', 0],
  ['Livestreaming', 'Live Stream Pro', 'Multi-camera broadcast', 55000, 'Multi-camera HD stream\nLive graphics and titles\nStreaming to multiple platforms\nUp to 6 hours\nDedicated internet backup\nFull recording delivered', 1],
  ['Burial', 'Burial Memorial', 'Dignified coverage of the service', 30000, 'One photographer\nOne videographer\nService and burial coverage\n150+ edited photos\nFull service video\nOnline gallery', 0],
  ['Burial', 'Burial Memorial + Live Stream', 'Let distant family join the service', 50000, 'Photography and videography\nHD live stream for family abroad\nRecording of the stream\n200+ edited photos\nFull service video\nTribute slideshow', 1],
];

async function init() {
  const boot = await mysql.createConnection(baseConfig());
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await boot.end();

  pool = mysql.createPool({
    ...baseConfig(),
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
    decimalNumbers: true,
  });

  for (const sql of SCHEMA) await pool.query(sql);

  // migrations for databases created before a column existed
  const addColumn = async (table, col, def) => {
    const [[{ c }]] = await pool.query(
      'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [dbName, table, col]);
    if (!c) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  await addColumn('packages', 'image', "VARCHAR(255) DEFAULT ''");
  await addColumn('users', 'role', "VARCHAR(20) NOT NULL DEFAULT 'admin'");
  await addColumn('users', 'phone', "VARCHAR(40) DEFAULT ''");
  await addColumn('users', 'active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('users', 'last_login', 'TIMESTAMP NULL DEFAULT NULL');
  // invoices that were marked paid before payment records existed keep their amount as one payment
  await pool.query(
    `INSERT INTO payments (invoice_id, amount, method, note, paid_at)
     SELECT i.id, i.paid, 'Earlier payment', 'Imported', DATE(i.created_at) FROM invoices i
     WHERE i.paid > 0 AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)`);

  const [[{ n: userCount }]] = await pool.query('SELECT COUNT(*) n FROM users');
  if (!userCount) {
    const email = process.env.ADMIN_EMAIL;
    const pw = process.env.ADMIN_PASSWORD;
    if (email && pw) {
      await pool.query('INSERT INTO users (email, name, password_hash) VALUES (?,?,?)', [
        email.toLowerCase(),
        'David Murith',
        await bcrypt.hash(pw, 10),
      ]);
      console.log(`Admin created: ${email}`);
    } else console.warn('No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  }

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
    await pool.query('INSERT IGNORE INTO settings (k, v) VALUES (?,?)', [k, v]);

  const [[{ n: pkgCount }]] = await pool.query('SELECT COUNT(*) n FROM packages');
  if (!pkgCount) {
    let i = 0;
    for (const [category, name, tagline, price, features, popular] of DEFAULT_PACKAGES)
      await pool.query(
        'INSERT INTO packages (category,name,tagline,price,features,popular,sort_order) VALUES (?,?,?,?,?,?,?)',
        [category, name, tagline, price, features, popular, i++]
      );
  }
  return pool;
}

const q = (sql, params) => pool.query(sql, params).then(([rows]) => rows);
const one = (sql, params) => q(sql, params).then((r) => r[0] || null);

async function getSettings() {
  const rows = await q('SELECT k, v FROM settings');
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

// Sequential document numbers like SMG-Q-0007
async function nextNumber(table, prefix) {
  const [[{ n }]] = await pool.query(`SELECT COALESCE(MAX(id),0)+1 n FROM ${table}`);
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

module.exports = { init, q, one, getSettings, nextNumber, pool: () => pool };
