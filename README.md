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
reports (CSV export), users (admin / staff), gallery, packages, blog, visitors, settings. Light and dark theme on the site and back office.

## API
- Public: `/api/public/{settings,packages,gallery,videos,picks,posts,quotes}`
- Admin (cookie login): `/api/admin/*`
