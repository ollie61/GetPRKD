# GetPRKD backend — deployment required

This is **not live** until deployed. GitHub Pages cannot run server-side code or keep a private dashboard.

1. Create a Cloudflare Worker and a D1 database; bind it as `DB`.
2. Apply `backend/schema.sql` to D1.
3. Deploy `backend/worker.js` as a module Worker.
4. Set `ALLOWED_ORIGIN=https://ollie61.github.io`; configure secret `IP_SALT` (random long value) and secret `ADMIN_TOKEN` (different long random value). Never commit secrets.
5. Connect the website to the deployed Worker URL in a later frontend update.
6. Admin-only statistics: GET `/admin/stats` with header `Authorization: Bearer <ADMIN_TOKEN>`. Never place this token in public HTML or JavaScript.

Stats are aggregate daily counts. IPs are used only to derive temporary salted hashes, stored for up to two hours. Gives are not publicly listed; a check returns only the newest eligible Give for that exact spot. The endpoint requires additional abuse controls (edge request rate limiting / bot challenge) before public launch; simple questions alone do not reliably stop bots. Privacy and legal review required before production.
