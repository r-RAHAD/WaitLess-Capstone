
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);

const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin } });

app.use(helmet());
app.use(cors({ origin }));
app.use(express.json({ limit: '32kb' }));

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

const PORT = Number(process.env.PORT || 5000);
const SECRET = process.env.JWT_SECRET;

if (!SECRET || SECRET.length < 32 || SECRET.includes('REPLACE_WITH')) {
  throw Error('Set a strong JWT_SECRET in server/.env (minimum 32 characters)');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'waitless_db',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

const query = (sql, params = []) => pool.execute(sql, params);

const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const fail = (code, message) =>
  Object.assign(new Error(message), { status: code });

function auth(req, _res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(fail(401, 'Sign in required'));
  }
}

const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role)
    ? next()
    : next(fail(403, 'Insufficient permissions'));

function publicUser(u) {
  return {
    id: u.id,
    name: u.full_name,
    email: u.email,
    role: u.role
  };
}

function sign(u) {
  return jwt.sign(
    {
      id: u.id,
      name: u.full_name,
      email: u.email,
      role: u.role
    },
    SECRET,
    { expiresIn: '8h' }
  );
}

function validEmail(e) {
  return typeof e === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) &&
    e.length <= 190;
}

function publish() {
  io.emit('queue:changed', {
    at: new Date().toISOString()
  });
}

async function seedDemo() {
  for (const role of ['admin', 'staff']) {
    const email = process.env[`${role.toUpperCase()}_EMAIL`];
    const password = process.env[`${role.toUpperCase()}_PASSWORD`];

    if (!email || !password || password.startsWith('CHANGE_THIS')) {
      continue;
    }

    const [exists] = await query(
      'SELECT id FROM wl_users WHERE email=?',
      [email.toLowerCase()]
    );

    if (exists.length === 0) {
      await query(
        'INSERT INTO wl_users(full_name,email,password_hash,role) VALUES(?,?,?,?)',
        [
          role === 'admin' ? 'Demo Admin' : 'Demo Staff',
          email.toLowerCase(),
          await bcrypt.hash(password, 12),
          role
        ]
      );
    }
  }
}

// HEALTH CHECK

app.get('/api/health', wrap(async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, database: true });
}));

// STUDENT REGISTRATION

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    name.length > 120 ||
    !validEmail(email) ||
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 100
  ) {
    throw fail(
      400,
      'Name, valid email, and password of at least 8 characters required'
    );
  }

  try {
    const [r] = await query(
      'INSERT INTO wl_users(full_name,email,password_hash,role) VALUES(?,?,?,?)',
      [
        name.trim(),
        email.toLowerCase(),
        await bcrypt.hash(password, 12),
        'student'
      ]
    );

    const u = {
      id: r.insertId,
      full_name: name.trim(),
      email: email.toLowerCase(),
      role: 'student'
    };

    res.status(201).json({
      token: sign(u),
      user: publicUser(u)
    });

  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      throw fail(409, 'Email already registered');
    }

    throw e;
  }
}));

// LOGIN

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};

  if (!validEmail(email) || typeof password !== 'string') {
    throw fail(400, 'Invalid credentials');
  }

  const [users] = await query(
    'SELECT * FROM wl_users WHERE email=?',
    [email.toLowerCase()]
  );

  const u = users[0];

  if (!u || !await bcrypt.compare(password, u.password_hash)) {
    throw fail(401, 'Invalid credentials');
  }

  res.json({
    token: sign(u),
    user: publicUser(u)
  });
}));

// SERVICES

app.get('/api/services', auth, wrap(async (_req, res) => {
  const [rows] = await query(
    'SELECT id,name,avg_duration_min,is_active FROM wl_services ORDER BY id'
  );

  res.json(rows);
}));

// COUNTERS

app.get('/api/counters', auth, wrap(async (_req, res) => {
  const [rows] = await query(
    `SELECT c.*,s.name AS service_name
     FROM wl_counters c
     JOIN wl_services s ON s.id=c.service_id
     ORDER BY c.id`
  );

  res.json(rows);
}));

// MACHINE LEARNING WAITING TIME PREDICTION

async function predictWaiting({
  queueLength,
  activeCounters,
  serviceDuration,
  serviceType
}) {
  const fallback = Math.max(
    0,
    Math.round(
      queueLength * serviceDuration / Math.max(activeCounters, 1)
    )
  );

  try {
    const response = await fetch(
      `${process.env.ML_URL || 'http://127.0.0.1:8000'}/predict`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          queue_length: queueLength,
          active_counters: activeCounters,
          service_duration: serviceDuration,
          service_type: serviceType,
          time_of_day: new Date().getHours()
        }),
        signal: AbortSignal.timeout(1200)
      }
    );

    if (response.ok) {
      const data = await response.json();

      if (
        Number.isFinite(data.predicted_minutes) &&
        data.predicted_minutes >= 0
      ) {
        return {
          minutes: Math.round(data.predicted_minutes),
          source: 'ml-synthetic-demo'
        };
      }
    }
  } catch {
    // ML unavailable: use fallback.
  }

  return {
    minutes: fallback,
    source: 'rule-based-fallback'
  };
}

// QUEUE LIST

app.get('/api/queue', auth, wrap(async (req, res) => {
  const serviceId = Number(req.query.service_id || 0);

  const [rows] = await query(
    `SELECT
       t.id,
       t.token_code,
       t.status,
       t.predicted_minutes,
       t.prediction_source,
       t.issued_at,
       t.called_at,
       t.started_at,
       t.completed_at,
       t.user_id,
       t.service_id,
       t.counter_id,
       s.name AS service_name,
       u.full_name AS student_name
     FROM wl_tokens t
     JOIN wl_services s ON t.service_id=s.id
     JOIN wl_users u ON u.id=t.user_id
     WHERE (?=0 OR t.service_id=?)
       AND (
         t.issued_at >= CURRENT_DATE()
         OR t.status IN ('waiting','called','serving')
       )
     ORDER BY t.issued_at ASC,t.id ASC
     LIMIT 500`,
    [serviceId, serviceId]
  );

  res.json(
    req.user.role === 'student'
      ? rows.filter(r => r.user_id === req.user.id)
      : rows
  );
}));

// QUEUE STATISTICS

app.get(
  '/api/stats',
  auth,
  requireRole('admin', 'staff'),
  wrap(async (_req, res) => {
    const [rows] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(status='waiting') AS waiting,
         SUM(status='serving') AS serving,
         SUM(status='completed') AS completed,
         SUM(status='skipped') AS skipped
       FROM wl_tokens
       WHERE issued_at >= CURRENT_DATE()`
    );

    res.json(rows[0]);
  })
);

// GENERATE VIRTUAL TOKEN - FIXED VERSION

app.post(
  '/api/tokens',
  auth,
  requireRole('student'),
  wrap(async (req, res) => {
    const serviceId = Number(req.body?.service_id);

    if (!Number.isSafeInteger(serviceId) || serviceId < 1) {
      throw fail(400, 'Select a service');
    }

    const connection = await pool.getConnection();
    let created;

    try {
      await connection.beginTransaction();

      const [[service]] = await connection.query(
        'SELECT * FROM wl_services WHERE id=? AND is_active=1 FOR UPDATE',
        [serviceId]
      );

      if (!service) {
        throw fail(404, 'Service unavailable');
      }

      const [dup] = await connection.query(
        `SELECT id FROM wl_tokens
         WHERE user_id=?
           AND service_id=?
           AND status IN ('waiting','called','serving')
         LIMIT 1`,
        [req.user.id, serviceId]
      );

      if (dup.length) {
        throw fail(409, 'You already have an active token for this service');
      }

      const [[counts]] = await connection.query(
        `SELECT COUNT(*) AS waiting
         FROM wl_tokens
         WHERE service_id=?
           AND status IN ('waiting','called','serving')`,
        [serviceId]
      );

      const [[counters]] = await connection.query(
        `SELECT COUNT(*) AS active
         FROM wl_counters
         WHERE service_id=? AND is_active=1`,
        [serviceId]
      );

      // FIX 1: Use safe SQL identifier quoting.
      // MySQL generates the current date itself.

      const [[dateRow]] = await connection.query(
        'SELECT CURRENT_DATE() AS day_key'
      );

      const day = dateRow.day_key instanceof Date
        ? [
            dateRow.day_key.getFullYear(),
            String(dateRow.day_key.getMonth() + 1).padStart(2, '0'),
            String(dateRow.day_key.getDate()).padStart(2, '0')
          ].join('-')
        : String(dateRow.day_key).slice(0, 10);

      await connection.query(
        'INSERT INTO wl_daily_sequences(day_key,service_id,`last_value`) VALUES(?,?,0) ON DUPLICATE KEY UPDATE `last_value`=`last_value`',
        [day, serviceId]
      );

      // FIX 2: Quote last_value in SELECT.

      const [[seq]] = await connection.query(
        'SELECT `last_value` FROM wl_daily_sequences WHERE day_key=? AND service_id=? FOR UPDATE',
        [day, serviceId]
      );

      // FIX 3: Correct JavaScript property access.

      const next = Number(seq.last_value) + 1;

      // FIX 4: Quote last_value in UPDATE.

      await connection.query(
        'UPDATE wl_daily_sequences SET `last_value`=? WHERE day_key=? AND service_id=?',
        [next, day, serviceId]
      );

      const prediction = await predictWaiting({
        queueLength: counts.waiting,
        activeCounters: counters.active,
        serviceDuration: service.avg_duration_min,
        serviceType: serviceId
      });

      const code =
        `S${serviceId}-${day.replaceAll('-', '')}-${String(next).padStart(3, '0')}`;

      const [result] = await connection.query(
        `INSERT INTO wl_tokens(
          token_code,
          user_id,
          service_id,
          predicted_minutes,
          prediction_source
        ) VALUES(?,?,?,?,?)`,
        [
          code,
          req.user.id,
          serviceId,
          prediction.minutes,
          prediction.source
        ]
      );

      await connection.commit();

      created = {
        id: result.insertId,
        token_code: code,
        service_id: serviceId,
        status: 'waiting',
        predicted_minutes: prediction.minutes,
        prediction_source: prediction.source
      };

    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    publish();

    res.status(201).json(created);
  })
);

// CANCEL TOKEN

app.patch(
  '/api/tokens/:id/cancel',
  auth,
  requireRole('student'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id)) {
      throw fail(400, 'Invalid token');
    }

    const [r] = await query(
      `UPDATE wl_tokens
       SET status='cancelled',completed_at=NOW()
       WHERE id=? AND user_id=? AND status='waiting'`,
      [id, req.user.id]
    );

    if (!r.affectedRows) {
      throw fail(409, 'Token cannot be cancelled');
    }

    publish();
    res.json({ ok: true });
  })
);

// STAFF: CALL NEXT TOKEN

app.post(
  '/api/queue/call-next',
  auth,
  requireRole('staff', 'admin'),
  wrap(async (req, res) => {
    const counterId = Number(req.body?.counter_id);

    if (!Number.isSafeInteger(counterId) || counterId < 1) {
      throw fail(400, 'Choose a counter');
    }

    const connection = await pool.getConnection();
    let row;

    try {
      await connection.beginTransaction();

      const [[counter]] = await connection.query(
        'SELECT * FROM wl_counters WHERE id=? AND is_active=1 FOR UPDATE',
        [counterId]
      );

      if (!counter) {
        throw fail(404, 'Counter unavailable');
      }

      const [busy] = await connection.query(
        `SELECT id FROM wl_tokens
         WHERE counter_id=?
           AND status IN ('called','serving')
         LIMIT 1`,
        [counterId]
      );

      if (busy.length) {
        throw fail(409, 'Finish the current token first');
      }

      const [tokens] = await connection.query(
        `SELECT id,token_code
         FROM wl_tokens
         WHERE service_id=? AND status='waiting'
         ORDER BY issued_at,id
         LIMIT 1 FOR UPDATE`,
        [counter.service_id]
      );

      if (!tokens.length) {
        throw fail(404, 'Queue is empty');
      }

      row = tokens[0];

      await connection.query(
        `UPDATE wl_tokens
         SET status='called',counter_id=?,called_at=NOW()
         WHERE id=?`,
        [counterId, row.id]
      );

      await connection.commit();

    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    publish();

    res.json({
      ...row,
      status: 'called',
      counter_id: counterId
    });
  })
);

// STAFF: UPDATE TOKEN STATUS

app.patch(
  '/api/tokens/:id/status',
  auth,
  requireRole('staff', 'admin'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;

    const transitions = {
      called: ['serving', 'skipped'],
      serving: ['completed', 'skipped']
    };

    if (
      !Number.isSafeInteger(id) ||
      !['serving', 'completed', 'skipped'].includes(status)
    ) {
      throw fail(400, 'Invalid operation');
    }

    const [existing] = await query(
      'SELECT status FROM wl_tokens WHERE id=?',
      [id]
    );

    if (!existing.length) {
      throw fail(404, 'Token not found');
    }

    const previous = existing[0].status;

    if (!transitions[previous]?.includes(status)) {
      throw fail(409, `Cannot change ${previous} to ${status}`);
    }

    const timestamp =
      status === 'serving' ? 'started_at' : 'completed_at';

    const [r] = await query(
      `UPDATE wl_tokens
       SET status=?,${timestamp}=NOW()
       WHERE id=? AND status=?`,
      [status, id, previous]
    );

    if (!r.affectedRows) {
      throw fail(409, 'Token changed; refresh and retry');
    }

    publish();
    res.json({ ok: true });
  })
);

// ADMIN: CREATE SERVICE

app.post(
  '/api/admin/services',
  auth,
  requireRole('admin'),
  wrap(async (req, res) => {
    const name = req.body?.name?.trim();
    const duration = Number(req.body?.avg_duration_min);

    if (
      !name ||
      name.length > 140 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 240
    ) {
      throw fail(400, 'Valid service name and duration (1–240) required');
    }

    const [r] = await query(
      'INSERT INTO wl_services(name,avg_duration_min) VALUES(?,?)',
      [name, duration]
    );

    publish();
    res.status(201).json({ id: r.insertId });
  })
);

// ADMIN: CREATE COUNTER

app.post(
  '/api/admin/counters',
  auth,
  requireRole('admin'),
  wrap(async (req, res) => {
    const label = req.body?.label?.trim();
    const serviceId = Number(req.body?.service_id);

    if (
      !label ||
      label.length > 60 ||
      !Number.isSafeInteger(serviceId)
    ) {
      throw fail(400, 'Valid counter name and service required');
    }

    const [r] = await query(
      'INSERT INTO wl_counters(label,service_id) VALUES(?,?)',
      [label, serviceId]
    );

    publish();
    res.status(201).json({ id: r.insertId });
  })
);

// ERROR HANDLER

app.use((err, _req, res, _next) => {
  const code = err.status ||
    (
      err.code === 'ER_DUP_ENTRY' ||
      err.code === 'ER_NO_REFERENCED_ROW_2'
        ? 409
        : 500
    );

  if (code === 500) {
    console.error(err);
  }

  res.status(code).json({
    error: code === 500
      ? 'Server error; check logs'
      : err.message
  });
});

// START SERVER

(async () => {
  await query('SELECT 1');
  await seedDemo();

  server.listen(PORT, () => {
    console.log(`WaitLess API on http://localhost:${PORT}`);
  });

})().catch(e => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
