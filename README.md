# WaitLess — ML-Integrated Smart Queue Management (Capstone MVP)

A runnable **university-service virtual queue** prototype with student, staff and admin roles; MySQL token history; real-time Socket.IO updates; and an optional Python ML demo. The system is a development prototype, not a production deployment.

## What works

- Student registration/login, password hashing, JWT sessions
- Student token generation, status history, cancellation
- Staff/admin call-next, start, complete, skip
- Admin add services and counters
- MySQL persistence, structured token IDs, transaction-based call-next
- Real-time queue refresh notifications
- Python random-forest prediction API **trained on synthetic generated examples**; fallback formula when ML service is offline
- Responsive dashboard layouts

## Important honesty about ML

The demo model **has no historical university records**. A random forest is trained on artificial assumptions and **is not evidence of real-life prediction accuracy**. The 12-minute displays in visuals are examples only. The backend labels estimates as `ml-synthetic-demo` or `rule-based-fallback`. Collect consented, anonymized timestamps from actual service operations, split train/test by date and measure MAE before asserting validated predictions.

## Setup on Windows 11

### 1. Database

Your existing `waitless_db` and its `users`, `organizations` tables remain unchanged. In **MySQL Workbench**, open `server/sql/schema.sql`, select all and click ⚡. It adds separate `wl_` tables.

### 2. Backend (terminal 1)

```powershell
cd D:\WaitLess\server
copy .env.example .env
```

Open `server/.env` and replace `YOUR_MYSQL_PASSWORD`, `JWT_SECRET` and the two demo passwords (avoid committing secrets). If you want admin/staff logins, set strong `ADMIN_PASSWORD` and `STAFF_PASSWORD` **before first boot**. Default placeholders will *not* create these accounts.

```powershell
npm install
npm run dev
```

Verify `http://localhost:5000/api/health` returns `{"ok":true,"database":true}`.

### 3. Frontend (terminal 2)

```powershell
cd D:\WaitLess\client
npm install
npm run dev
```

Open `http://localhost:5173` in the browser. Create a student account and book a token. Staff and admin should use the seeded credentials configured above.

### 4. ML service (terminal 3; optional, after frontend is running)

```powershell
cd D:\WaitLess\ml
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python train.py
uvicorn api:app --host 127.0.0.1 --port 8000
```

The backend automatically uses ML when `http://127.0.0.1:8000/predict` is available, otherwise an explicitly labelled formula fallback.

## URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5000/api/health`
- ML docs: `http://127.0.0.1:8000/docs`

## Suggested demo

1. Student registers and generates token for Registrar Office.
2. Staff logs in, selects matching counter and clicks **Call Next**.
3. Student sees status update automatically.
4. Staff starts and completes service.
5. Admin reviews stats, services and counters.
6. Optional ML service is launched to switch estimates from fallback to synthetic-model mode.

## Repository / progress tracking

From project folder:

```powershell
git init
git add .
git commit -m "feat: initial WaitLess full-stack capstone MVP"
```

Create an empty GitHub repository and follow the exact commands GitHub displays to add remote and push. **Never commit `.env`**. A project report should call this a working MVP only after you run it and perform the above acceptance tests.

## Next milestones

- Secure sessions/refresh tokens, account verification, role assignments and audit logs
- Better transaction constraints for concurrent staff requests, timestamp/timezone handling, idempotent token operations
- Counter calendars, organization membership, appointments/notifications
- Automated integration tests, migrations/rollback, CI, deployment
- Real-world ML dataset, valid evaluation, drift monitoring and retraining

## Folder map

```text
waitless_mvp/
├── client/             React + Vite UI
├── server/src/         Express API
├── server/sql/         Safe additive MySQL schema
├── ml/                 Synthetic ML training + FastAPI
└── docs/               Documentation
```
