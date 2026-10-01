# Shepherd Media Group: website + back office

Node.js (Express) + MySQL. Tables are created automatically on first start.

## Run locally
1. Set `DB_PASSWORD` (and `DB_USER` if not root) in `.env`.
2. `npm install`, then `npm start`.
3. Site: http://localhost:3000 · Back office: http://localhost:3000/admin/
   Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (created on first start). Change the password under Settings.

## Google Cloud SQL
Create a MySQL instance and set in `.env` (or the service's environment):
- Cloud Run / App Engine: `DB_SOCKET=/cloudsql/PROJECT:REGION:INSTANCE`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- Elsewhere: run the Cloud SQL Auth Proxy and keep `DB_HOST=127.0.0.1`.
Also set a long random `JWT_SECRET`.
Photos and videos are stored in `uploads/`; on Cloud Run use a Cloud Storage bucket (or a mounted volume), as container disk is not persistent.

## Back office
Quotes, invoices with part payments, payables (bills you owe), client project links (shown to clients under "My project"),
receipts for every payment (A4 PDF, sent to clients by WhatsApp link), bookings (Booked / In progress / Completed), reminders, A4 PDF reports (download or print) with CSV export, users (admin / staff), gallery, packages, blog, visitors, settings. Light and dark theme on the site and back office.

## API
- Public: `/api/public/{settings,packages,gallery,videos,picks,posts,quotes}`
- Admin (cookie login): `/api/admin/*`

## Deploy on Railway
1. Push this repo to GitHub, then on https://railway.com create a **New Project → Deploy from GitHub repo** and pick it.
2. In the same project click **+ New → Database → MySQL**. Railway provides `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`; the app reads them automatically.
3. In the app service → **Variables**, add:
   - `JWT_SECRET` = a long random string
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` = the first admin (used only when no users exist yet)
   - `SITE_URL` = your Railway or custom domain
   - `UPLOADS_DIR` = `/data/uploads`
   - `DB_HOST`=`${{MySQL.MYSQLHOST}}`, `DB_PORT`=`${{MySQL.MYSQLPORT}}`, `DB_USER`=`${{MySQL.MYSQLUSER}}`, `DB_PASSWORD`=`${{MySQL.MYSQLPASSWORD}}`, `DB_NAME`=`${{MySQL.MYSQLDATABASE}}` (reference variables, so the app and database stay linked)
4. In the app service → **Settings → Volumes** add a volume mounted at `/data`, so uploaded photos and videos survive redeploys.
5. **Settings → Networking → Generate Domain** (or add your own domain). Railway runs `npm start`.
