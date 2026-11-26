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

// WaitLess v2 — department-scoped staff access and compatible legacy APIs.
// Run server/sql/department_security_migration.sql before starting this file.
const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT || 5000);
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32 || SECRET.includes('REPLACE_WITH')) {
  throw Error('Set a strong JWT_SECRET in server/.env (minimum 32 characters)');
}

const configuredOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const origins = [configuredOrigin];
if (configuredOrigin === 'http://localhost:5173') origins.push('http://127.0.0.1:5173');
if (configuredOrigin === 'http://127.0.0.1:5173') origins.push('http://localhost:5173');
const corsOptions = { origin: origins };
const io = new Server(server, { cors: corsOptions });

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

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
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const idNumber = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const validEmail = email => typeof email === 'string' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 190;

// Re-check the DB account on every protected request: disabling a staff user
// takes effect immediately even if they still hold an unexpired JWT.
const auth = wrap(async (req, _res, next) => {
  const bearer = req.headers.authorization || '';
  const token = bearer.replace(/^Bearer\s+/i, '');
  let claims;
  try {
    if (!/^Bearer\s+/i.test(bearer)) throw Error('No bearer token');
    claims = jwt.verify(token, SECRET);
  } catch {
    throw fail(401, 'Sign in required');
  }
  const id = idNumber(claims.id);
  if (!id) throw fail(401, 'Invalid account');
  const [[user]] = await query(
    'SELECT id,full_name,email,role,is_active FROM wl_users WHERE id=?', [id]
  );
  if (!user || !user.is_active) throw fail(401, 'Account disabled or unavailable');
  req.user = {
    id: Number(user.id), name: user.full_name, email: user.email, role: user.role
  };
  next();
});
const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(fail(403, 'Insufficient permissions'));

function publicUser(u) {
  return { id: Number(u.id), name: u.full_name, email: u.email, role: u.role };
}
function sign(u) {
  return jwt.sign({ id: Number(u.id), role: u.role }, SECRET, { expiresIn: '8h' });
}

// One staff user -> one assigned service and one assigned counter.
async function staffAssignment(userId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT a.staff_user_id,a.service_id,a.counter_id,
            s.name AS service_name,c.label AS counter_label
     FROM wl_staff_assignments a
     JOIN wl_services s ON s.id=a.service_id AND s.is_active=1
     JOIN wl_counters c ON c.id=a.counter_id AND c.service_id=a.service_id AND c.is_active=1
     WHERE a.staff_user_id=? AND a.is_active=1`, [userId]
  );
  return rows[0] || null;
}
async function requireAssignment(userId, connection = pool) {
  const assignment = await staffAssignment(userId, connection);
  if (!assignment) throw fail(403, 'No active staff department/counter assignment');
  return assignment;
}

// The existing frontend listens to queue:changed. This event contains NO
// student names, service identifiers, token details or other protected data.
// All actual queue data is fetched from authorization-checked HTTP routes.
function publish() {
  io.emit('queue:changed', { at: new Date().toISOString() });
}

async function seedDemo() {
  // Backward compatibility with the existing local .env setup.
  // Existing staff must still be explicitly assigned by an admin.
  for (const role of ['admin', 'staff']) {
    const email = process.env[`${role.toUpperCase()}_EMAIL`];
    const password = process.env[`${role.toUpperCase()}_PASSWORD`];
    if (!validEmail(email) || typeof password !== 'string' ||
        password.length < 8 || password.startsWith('CHANGE_THIS')) continue;
    const [found] = await query('SELECT id FROM wl_users WHERE email=?', [email.toLowerCase()]);
    if (!found.length) {
      await query(
        'INSERT INTO wl_users(full_name,email,password_hash,role) VALUES(?,?,?,?)',
        [role === 'admin' ? 'Demo Admin' : 'Demo Staff', email.toLowerCase(),
         await bcrypt.hash(password, 12), role]
      );
    }
  }
}

// ---------- HEALTH AND AUTH ----------
app.get('/api/health', wrap(async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, database: true });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120 ||
      !validEmail(email) || typeof password !== 'string' ||
      password.length < 8 || password.length > 100) {
    throw fail(400, 'Name, valid email and password of at least 8 characters required');
  }
  try {
    const [r] = await query(
      'INSERT INTO wl_users(full_name,email,password_hash,role) VALUES(?,?,?,?)',
      [name.trim(), email.toLowerCase(), await bcrypt.hash(password, 12), 'student']
    );
    const user = { id: r.insertId, full_name: name.trim(), email: email.toLowerCase(), role: 'student' };
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'Email already registered');
    throw err;
  }
}));

const login = wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const portal = req.portalRole || req.body?.portal || null;
  if (!validEmail(email) || typeof password !== 'string') throw fail(400, 'Invalid credentials');
  if (portal !== null && !['student', 'staff', 'admin'].includes(portal)) {
    throw fail(400, 'Invalid portal');
  }
  const [[user]] = await query('SELECT * FROM wl_users WHERE email=?', [email.toLowerCase()]);
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    throw fail(401, 'Invalid credentials');
  }
  if (portal && user.role !== portal) throw fail(403, 'Use your assigned login portal');
  const assignment = user.role === 'staff' ? await staffAssignment(user.id) : null;
  res.json({ token: sign(user), user: publicUser(user), assignment });
});
// Old login endpoint remains supported until the three login screens are built.
app.post('/api/auth/login', login);
for (const role of ['student', 'staff', 'admin']) {
  app.post(`/api/auth/${role}/login`, (req, res, next) => {
    req.portalRole = role;
    login(req, res, next);
  });
}
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const assignment = req.user.role === 'staff' ? await staffAssignment(req.user.id) : null;
  res.json({ user: req.user, assignment });
}));

// ---------- SERVICES AND COUNTERS ----------
app.get('/api/services', auth, wrap(async (req, res) => {
  if (req.user.role === 'staff') {
    const a = await requireAssignment(req.user.id);
    const [rows] = await query(
      'SELECT id,name,avg_duration_min,is_active FROM wl_services WHERE id=?',
      [a.service_id]
    );
    return res.json(rows);
  }
  const [rows] = await query(
    'SELECT id,name,avg_duration_min,is_active FROM wl_services ORDER BY id'
  );
  res.json(rows);
}));
app.get('/api/counters', auth, wrap(async (req, res) => {
  let sql = `SELECT c.*,s.name AS service_name
             FROM wl_counters c JOIN wl_services s ON s.id=c.service_id`;
  const params = [];
  if (req.user.role === 'staff') {
    const a = await requireAssignment(req.user.id);
    sql += ' WHERE c.id=? AND c.service_id=?';
    params.push(a.counter_id, a.service_id);
  }
  sql += ' ORDER BY c.id';
  const [rows] = await query(sql, params);
  res.json(rows);
}));

// ---------- PREDICTION ----------
async function predictWaiting({ queueLength, activeCounters, serviceDuration, serviceType }) {
  const fallback = Math.max(0, Math.round(
    queueLength * serviceDuration / Math.max(activeCounters, 1)
  ));
  try {
    const response = await fetch(`${process.env.ML_URL || 'http://127.0.0.1:8000'}/predict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queue_length: queueLength,
        active_counters: activeCounters,
        service_duration: serviceDuration,
        service_type: serviceType,
        time_of_day: new Date().getHours()
      }),
      signal: AbortSignal.timeout(2500)
    });
    if (response.ok) {
      const data = await response.json();
      if (Number.isFinite(data.predicted_minutes) && data.predicted_minutes >= 0) {
        return { minutes: Math.round(data.predicted_minutes), source: 'ml-synthetic-demo' };
      }
    } else {
      console.warn('ML API returned HTTP', response.status);
    }
  } catch (err) {
    console.warn('ML prediction unavailable, using rule fallback:', err.message);
  }
  return { minutes: fallback, source: 'rule-based-fallback' };
}

// ---------- QUEUE VISIBILITY ----------
app.get('/api/queue', auth, wrap(async (req, res) => {
  const rawService = req.query.service_id;
  const requestedService = rawService === undefined || rawService === '' ? 0 : Number(rawService);
  if (!Number.isSafeInteger(requestedService) || requestedService < 0) {
    throw fail(400, 'Invalid service_id');
  }
  let extra = '';
  const params = [requestedService, requestedService];
  if (req.user.role === 'student') {
    extra = ' AND t.user_id=?';
    params.push(req.user.id);
  } else if (req.user.role === 'staff') {
    const a = await requireAssignment(req.user.id);
    if (requestedService && requestedService !== Number(a.service_id)) {
      throw fail(403, 'Cannot view another department');
    }
    extra = ' AND t.service_id=?';
    params.push(a.service_id);
  }
  const [rows] = await query(
    `SELECT t.id,t.token_code,t.status,t.predicted_minutes,t.prediction_source,
            t.issued_at,t.called_at,t.started_at,t.completed_at,
            t.user_id,t.service_id,t.counter_id,s.name AS service_name,
            u.full_name AS student_name
     FROM wl_tokens t
     JOIN wl_services s ON s.id=t.service_id
     JOIN wl_users u ON u.id=t.user_id
     WHERE (?=0 OR t.service_id=?)
       AND (t.issued_at >= CURRENT_DATE() OR t.status IN ('waiting','called','serving'))
       ${extra}
     ORDER BY t.issued_at ASC,t.id ASC
     LIMIT 500`, params
  );
  res.json(rows);
}));

app.get('/api/stats', auth, requireRole('admin', 'staff'), wrap(async (req, res) => {
  let where = 'WHERE issued_at >= CURRENT_DATE()';
  const params = [];
  if (req.user.role === 'staff') {
    const a = await requireAssignment(req.user.id);
    where += ' AND service_id=?';
    params.push(a.service_id);
  }
  const [[stats]] = await query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status='waiting'),0) AS waiting,
            COALESCE(SUM(status='serving'),0) AS serving,
            COALESCE(SUM(status='completed'),0) AS completed,
            COALESCE(SUM(status='skipped'),0) AS skipped
     FROM wl_tokens ${where}`, params
  );
  res.json(stats);
}));

// ---------- STUDENT TOKEN OPERATIONS ----------
app.post('/api/tokens', auth, requireRole('student'), wrap(async (req, res) => {
  const serviceId = idNumber(req.body?.service_id);
  if (!serviceId) throw fail(400, 'Select a service');
  const connection = await pool.getConnection();
  let created;
  try {
    await connection.beginTransaction();
    const [[service]] = await connection.query(
      'SELECT * FROM wl_services WHERE id=? AND is_active=1 FOR UPDATE', [serviceId]
    );
    if (!service) throw fail(404, 'Service unavailable');
    const [dups] = await connection.query(
      `SELECT id FROM wl_tokens WHERE user_id=? AND service_id=?
       AND status IN ('waiting','called','serving') LIMIT 1`, [req.user.id, serviceId]
    );
    if (dups.length) throw fail(409, 'You already have an active token for this service');
    const [[counts]] = await connection.query(
      `SELECT COUNT(*) AS waiting FROM wl_tokens WHERE service_id=?
       AND status IN ('waiting','called','serving')`, [serviceId]
    );
    const [[counters]] = await connection.query(
      'SELECT COUNT(*) AS active FROM wl_counters WHERE service_id=? AND is_active=1',
      [serviceId]
    );
    const [[dateRow]] = await connection.query('SELECT CURRENT_DATE() AS day_key');
    const day = dateRow.day_key instanceof Date
      ? [dateRow.day_key.getFullYear(), String(dateRow.day_key.getMonth() + 1).padStart(2, '0'),
         String(dateRow.day_key.getDate()).padStart(2, '0')].join('-')
      : String(dateRow.day_key).slice(0, 10);
    await connection.query(
      'INSERT INTO wl_daily_sequences(day_key,service_id,`last_value`) VALUES(?,?,0) ON DUPLICATE KEY UPDATE `last_value`=`last_value`',
      [day, serviceId]
    );
    const [[seq]] = await connection.query(
      'SELECT `last_value` FROM wl_daily_sequences WHERE day_key=? AND service_id=? FOR UPDATE',
      [day, serviceId]
    );
    const next = Number(seq.last_value) + 1;
    await connection.query(
      'UPDATE wl_daily_sequences SET `last_value`=? WHERE day_key=? AND service_id=?',
      [next, day, serviceId]
    );
    const prediction = await predictWaiting({
      queueLength: Number(counts.waiting),
      activeCounters: Number(counters.active),
      serviceDuration: Number(service.avg_duration_min),
      serviceType: serviceId
    });
    const tokenCode = `S${serviceId}-${day.replaceAll('-', '')}-${String(next).padStart(3, '0')}`;
    const [result] = await connection.query(
      `INSERT INTO wl_tokens(token_code,user_id,service_id,predicted_minutes,prediction_source)
       VALUES(?,?,?,?,?)`,
      [tokenCode, req.user.id, serviceId, prediction.minutes, prediction.source]
    );
    await connection.commit();
    created = {
      id: result.insertId, token_code: tokenCode, service_id: serviceId,
      status: 'waiting', predicted_minutes: prediction.minutes,
      prediction_source: prediction.source
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  publish();
  res.status(201).json(created);
}));

app.patch('/api/tokens/:id/cancel', auth, requireRole('student'), wrap(async (req, res) => {
  const id = idNumber(req.params.id);
  if (!id) throw fail(400, 'Invalid token');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[token]] = await connection.query(
      'SELECT id,service_id,status FROM wl_tokens WHERE id=? AND user_id=? FOR UPDATE',
      [id, req.user.id]
    );
    if (!token || token.status !== 'waiting') throw fail(409, 'Token cannot be cancelled');
    await connection.query(
      `UPDATE wl_tokens SET status='cancelled',completed_at=NOW() WHERE id=?`, [id]
    );
    await insertAudit(connection, req.user.id, id, token.service_id, 'cancel', 'waiting', 'cancelled');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  publish();
  res.json({ ok: true });
}));

async function insertAudit(connection, actorId, tokenId, serviceId, action, from, to) {
  await connection.query(
    `INSERT INTO wl_token_audit_logs
       (actor_user_id,token_id,service_id,action,old_status,new_status)
     VALUES(?,?,?,?,?,?)`,
    [actorId, tokenId, serviceId, action, from, to]
  );
}

// ---------- STAFF QUEUE OPERATIONS ----------
app.post('/api/queue/call-next', auth, requireRole('staff', 'admin'), wrap(async (req, res) => {
  const counterId = idNumber(req.body?.counter_id);
  if (!counterId) throw fail(400, 'Choose a counter');
  const connection = await pool.getConnection();
  let row;
  try {
    await connection.beginTransaction();
    const [[counter]] = await connection.query(
      'SELECT * FROM wl_counters WHERE id=? AND is_active=1 FOR UPDATE', [counterId]
    );
    if (!counter) throw fail(404, 'Counter unavailable');
    if (req.user.role === 'staff') {
      const a = await requireAssignment(req.user.id, connection);
      if (Number(a.counter_id) !== counterId || Number(a.service_id) !== Number(counter.service_id)) {
        throw fail(403, 'This counter is not assigned to you');
      }
    }
    const [busy] = await connection.query(
      `SELECT id FROM wl_tokens WHERE counter_id=?
       AND status IN ('called','serving') LIMIT 1`, [counterId]
    );
    if (busy.length) throw fail(409, 'Finish the current token first');
    const [tokens] = await connection.query(
      `SELECT id,token_code FROM wl_tokens WHERE service_id=? AND status='waiting'
       ORDER BY issued_at,id LIMIT 1 FOR UPDATE`, [counter.service_id]
    );
    if (!tokens.length) throw fail(404, 'Queue is empty');
    row = tokens[0];
    await connection.query(
      `UPDATE wl_tokens SET status='called',counter_id=?,called_at=NOW() WHERE id=?`,
      [counterId, row.id]
    );
    await insertAudit(connection, req.user.id, row.id, counter.service_id, 'call-next', 'waiting', 'called');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  publish();
  res.json({ ...row, status: 'called', counter_id: counterId });
}));

app.patch('/api/tokens/:id/status', auth, requireRole('staff', 'admin'), wrap(async (req, res) => {
  const tokenId = idNumber(req.params.id);
  const nextStatus = req.body?.status;
  if (!tokenId || !['serving', 'completed', 'skipped'].includes(nextStatus)) {
    throw fail(400, 'Invalid operation');
  }
  const allowed = { called: ['serving', 'skipped'], serving: ['completed', 'skipped'] };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[token]] = await connection.query(
      'SELECT id,status,service_id,counter_id FROM wl_tokens WHERE id=? FOR UPDATE',
      [tokenId]
    );
    if (!token) throw fail(404, 'Token not found');
    // Authorization runs before transition validation to avoid information leaks.
    if (req.user.role === 'staff') {
      const a = await requireAssignment(req.user.id, connection);
      if (Number(token.service_id) !== Number(a.service_id) ||
          Number(token.counter_id) !== Number(a.counter_id)) {
        throw fail(403, 'Token does not belong to your department/counter');
      }
    }
    if (!allowed[token.status]?.includes(nextStatus)) {
      throw fail(409, `Cannot change ${token.status} to ${nextStatus}`);
    }
    const timestamp = nextStatus === 'serving' ? 'started_at' : 'completed_at';
    await connection.query(
      `UPDATE wl_tokens SET status=?,${timestamp}=NOW() WHERE id=? AND status=?`,
      [nextStatus, tokenId, token.status]
    );
    await insertAudit(connection, req.user.id, tokenId, token.service_id, 'status-change', token.status, nextStatus);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  publish();
  res.json({ ok: true });
}));

// ---------- ADMIN: SERVICES, COUNTERS, STAFF ----------
app.post('/api/admin/services', auth, requireRole('admin'), wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const duration = Number(req.body?.avg_duration_min);
  if (!name || name.length > 140 || !Number.isInteger(duration) || duration < 1 || duration > 240) {
    throw fail(400, 'Valid service name and duration (1–240) required');
  }
  const [r] = await query('INSERT INTO wl_services(name,avg_duration_min) VALUES(?,?)', [name, duration]);
  publish();
  res.status(201).json({ id: r.insertId });
}));

app.post('/api/admin/counters', auth, requireRole('admin'), wrap(async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  const serviceId = idNumber(req.body?.service_id);
  if (!label || label.length > 60 || !serviceId) {
    throw fail(400, 'Valid counter name and service required');
  }
  const [r] = await query(
    'INSERT INTO wl_counters(label,service_id) VALUES(?,?)', [label, serviceId]
  );
  publish();
  res.status(201).json({ id: r.insertId });
}));

async function validateCounterService(connection, serviceId, counterId) {
  const [[counter]] = await connection.query(
    `SELECT c.id,c.service_id FROM wl_counters c
     JOIN wl_services s ON s.id=c.service_id
     WHERE c.id=? AND c.service_id=? AND c.is_active=1 AND s.is_active=1`,
    [counterId, serviceId]
  );
  if (!counter) throw fail(400, 'Counter does not belong to an active selected service');
}

app.get('/api/admin/staff', auth, requireRole('admin'), wrap(async (_req, res) => {
  const [rows] = await query(
    `SELECT u.id,u.full_name AS name,u.email,u.is_active,
            a.service_id,a.counter_id,a.is_active AS assignment_active,
            s.name AS service_name,c.label AS counter_label
     FROM wl_users u
     LEFT JOIN wl_staff_assignments a ON a.staff_user_id=u.id
     LEFT JOIN wl_services s ON s.id=a.service_id
     LEFT JOIN wl_counters c ON c.id=a.counter_id
     WHERE u.role='staff' ORDER BY u.id`
  );
  res.json(rows);
}));

app.post('/api/admin/staff', auth, requireRole('admin'), wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const { email, password } = req.body || {};
  const serviceId = idNumber(req.body?.service_id);
  const counterId = idNumber(req.body?.counter_id);
  if (name.length < 2 || name.length > 120 || !validEmail(email) ||
      typeof password !== 'string' || password.length < 12 || password.length > 100 ||
      !serviceId || !counterId) {
    throw fail(400, 'Name, email, password (12+ chars), service and counter required');
  }
  const connection = await pool.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    await validateCounterService(connection, serviceId, counterId);
    const [r] = await connection.query(
      'INSERT INTO wl_users(full_name,email,password_hash,role) VALUES(?,?,?,?)',
      [name, email.toLowerCase(), await bcrypt.hash(password, 12), 'staff']
    );
    userId = r.insertId;
    await connection.query(
      `INSERT INTO wl_staff_assignments(staff_user_id,service_id,counter_id,is_active)
       VALUES(?,?,?,1)`, [userId, serviceId, counterId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  res.status(201).json({ id: userId, service_id: serviceId, counter_id: counterId });
}));

app.put('/api/admin/staff/:id/assignment', auth, requireRole('admin'), wrap(async (req, res) => {
  const userId = idNumber(req.params.id);
  const serviceId = idNumber(req.body?.service_id);
  const counterId = idNumber(req.body?.counter_id);
  if (!userId || !serviceId || !counterId) throw fail(400, 'Valid staff, service and counter required');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[staff]] = await connection.query(
      `SELECT id FROM wl_users WHERE id=? AND role='staff' FOR UPDATE`, [userId]
    );
    if (!staff) throw fail(404, 'Staff account not found');
    await validateCounterService(connection, serviceId, counterId);
    const [[busy]] = await connection.query(
      `SELECT COUNT(*) AS amount FROM wl_tokens
       WHERE counter_id IN (SELECT counter_id FROM wl_staff_assignments WHERE staff_user_id=?)
       AND status IN ('called','serving')`, [userId]
    );
    if (Number(busy.amount) > 0) throw fail(409, 'Complete active counter token before reassignment');
    await connection.query(
      `INSERT INTO wl_staff_assignments(staff_user_id,service_id,counter_id,is_active)
       VALUES(?,?,?,1)
       ON DUPLICATE KEY UPDATE service_id=VALUES(service_id),
         counter_id=VALUES(counter_id),is_active=1,assigned_at=CURRENT_TIMESTAMP`,
      [userId, serviceId, counterId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  res.json({ ok: true, staff_user_id: userId, service_id: serviceId, counter_id: counterId });
}));

app.patch('/api/admin/staff/:id/status', auth, requireRole('admin'), wrap(async (req, res) => {
  const userId = idNumber(req.params.id);
  const active = req.body?.is_active;
  if (!userId || typeof active !== 'boolean') throw fail(400, 'Staff id and boolean is_active required');
  const [result] = await query(
    `UPDATE wl_users SET is_active=? WHERE id=? AND role='staff'`,
    [active ? 1 : 0, userId]
  );
  if (!result.affectedRows) throw fail(404, 'Staff account not found');
  res.json({ ok: true, is_active: active });
}));

// ---------- ERROR HANDLER ----------
app.use((err, _req, res, _next) => {
  const code = err.status || err.statusCode ||
    (['ER_DUP_ENTRY', 'ER_NO_REFERENCED_ROW_2'].includes(err.code) ? 409 : 500);
  if (code >= 500) console.error(err);
  res.status(code).json({ error: code >= 500 ? 'Server error; check logs' : err.message });
});

// ---------- STARTUP ----------
(async () => {
  // Fail early with a clear message if migration was not executed.
  await query('SELECT is_active FROM wl_users LIMIT 1');
  await query('SELECT staff_user_id FROM wl_staff_assignments LIMIT 1');
  await query('SELECT id FROM wl_token_audit_logs LIMIT 1');
  await seedDemo();
  server.listen(PORT, () => console.log(`WaitLess API on http://localhost:${PORT}`));
})().catch(err => {
  console.error('Startup failed. Run database migration first:', err.message);
  process.exit(1);
});
