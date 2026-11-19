# Acceptance Test Checklist

- [ ] MySQL schema adds `wl_users`, `wl_services`, `wl_counters`, `wl_tokens`, `wl_daily_sequences` without changing existing tables
- [ ] Backend health `ok:true` and MySQL reachable
- [ ] Student registration and login successful; invalid credentials rejected
- [ ] Student can create token, cannot create duplicate active token for same service
- [ ] Staff can call next token for correct service counter
- [ ] Student page updates after call (Socket.IO event)
- [ ] Staff can start and complete or skip; cannot complete token twice
- [ ] Student can cancel only waiting token
- [ ] Admin can create a service and counter
- [ ] Browser refresh keeps data persisted in MySQL; student session lasts until JWT expiry
- [ ] ML is labelled demo; fallback works if FastAPI is offline
- [ ] Mobile display tested at 375px
- [ ] Secrets in .env are not committed to GitHub

## Demo test accounts

No hardcoded universal credentials. Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STAFF_EMAIL`, `STAFF_PASSWORD` in `.env` before startup to seed accounts.
