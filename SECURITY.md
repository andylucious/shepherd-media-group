# Security notes: Shepherd Media Group

## Already built in
- Passwords are stored as bcrypt hashes. New passwords need 8+ characters with a letter and a number, and common passwords are refused.
- Sign-in is limited per connection, and 6 wrong passwords lock that email on that connection for 15 minutes.
- Sessions are HttpOnly, SameSite=Strict, and Secure on HTTPS. Changing a password signs out every other session.
- Admin and client sessions are separate and cannot be used for each other.
- Roles: Admin (everything) and Staff (no reports, users, contractors, client accounts or settings). Disabling an account takes effect immediately.
- Clients only ever see their own quotations, invoices, receipts and projects. Receipts and quotations are shared by long random links.
- Uploads: only real image and video types, stored with a safe extension chosen by the server. SVG and HEIC are refused.
- All database queries use parameters. All text shown in pages is escaped. CSV exports neutralise spreadsheet formulas.
- Security headers on every response: Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and HSTS on HTTPS. API responses are never cached.
- Forms, likes and visitor counters are rate limited. `npm audit` reports no known vulnerabilities.

## Do before going live
1. Set a long random `JWT_SECRET` and a strong `ADMIN_PASSWORD` in Railway variables (never in the code). Change the admin password after the first sign-in.
2. Use HTTPS only (Railway provides it). Keep `.env` out of GitHub (it is in `.gitignore`).
3. Turn on database backups (Cloud SQL automated backups, or Railway backups) and test a restore once.
4. Back up the uploads volume too, or move photos to a storage bucket with versioning.
5. Give the database user only the rights it needs, and never expose the database port to the internet.
6. Run `npm audit` and `npm update` every month.

## Recommended next steps
- Email: add password reset and email verification for client accounts (needs an email service such as Resend or SendGrid). Until then, the admin resets client passwords.
- Two-step sign-in (an authenticator app) for admin accounts.
- An activity log (who deleted or changed what, and when).
- Put the site behind Cloudflare for DDoS protection and a web application firewall.
- Scan uploads for malware if untrusted people ever upload files (today only signed-in admins and staff can).
- Move rate-limit counters to a shared store (Redis) if you run more than one server.
