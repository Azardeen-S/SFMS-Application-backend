require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const os = require('os');

// Route imports
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/company');
const plantRoutes = require('./routes/plant');
const deptRoutes = require('./routes/dept');
const employeeRoutes = require('./routes/employee');
const shopRoutes = require('./routes/shop');
const moduleRoutes = require('./routes/module');
const lineRoutes = require('./routes/line');
const machineRoutes = require('./routes/machine');
const typeRoutes = require('./routes/type');
const gapRoutes = require('./routes/gap');
const trnLineStoppageRoutes = require('./routes/trnLineStoppage');
const dashboardRoutes = require('./routes/dashboard');
const reportsRoutes = require('./routes/reports');
const genericRoutes = require('./routes/generic');
const roleRoutes = require('./routes/role');
const smsLogRoutes = require('./routes/smsLog');
const { startNotificationSync } = require('./utils/notificationSyncService');
const { startSmsNotification } = require('./utils/smsNotificationService');
const { startEscalationMail } = require('./utils/escalationMailService');
const { startMobileCloseFtp } = require('./utils/mobileCloseFtpService');

const app = express();
const PORT = process.env.PORT || 6000;

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // allow React's inline scripts during dev
}));

// CLIENT_ORIGIN may be a single origin or a comma-separated list, e.g.:
//   CLIENT_ORIGIN=http://localhost:3000,http://10.51.11.49:3000
// In quality/production the frontend is normally served BY this same
// server (see the static/catch-all block below), so most real requests
// are same-origin and never hit this check at all - this only matters
// if the frontend is ever hosted on a different host/port than the API.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // no Origin header = same-origin page load, curl/Postman, server-to-server -> allow
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`CORS blocked request from origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Every /api/* URL is the same regardless of which user/plant is asking -
// the actual data returned depends on the caller's JWT, not the URL. Express
// auto-generates an ETag for every JSON response by default, so without this
// the browser can send If-None-Match on a later request (e.g. after data
// changed, or as a different user) and get back a 304 telling it to reuse an
// old cached body that no longer matches the database - GET /api/generic/...
// then "silently" keeps showing stale data until a hard refresh clears it.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/plant', plantRoutes);
app.use('/api/dept', deptRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/module', moduleRoutes);
app.use('/api/line', lineRoutes);
app.use('/api/machine', machineRoutes);
app.use('/api/type', typeRoutes);
app.use('/api/gap', gapRoutes);
app.use('/api/trnLineStoppage', trnLineStoppageRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/generic', genericRoutes);
app.use('/api/role', roleRoutes);
app.use('/api/sms-log', smsLogRoutes);

// ─── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Unmatched /api/* -> clear JSON 404 (instead of falling through to the
// SPA catch-all below, which would otherwise be confusing for API callers) ──
app.use('/api', (req, res) => {
  res.status(404).json({ message: `No API route: ${req.method} ${req.originalUrl}` });
});

// ─── Serve React Frontend (Production build) ─────────────────────
const distPath = path.join(__dirname, '..', 'SFMS-React-Frontend', 'dist');
app.use(express.static(distPath));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error.' });
});

// ─── Start Server ─────────────────────────────────────────────────
// Listening on 0.0.0.0 means "every network interface this machine has" -
// but the old log line only ever printed 127.0.0.1, which is misleading on
// a server with a real network IP (quality/production). List every address
// this process is actually reachable on instead.
function listReachableAddresses(port) {
  const addresses = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return addresses;
}

app.listen(PORT, () => {
  console.log('✅ SFMS Backend running - reachable at:');
  for (const addr of listReachableAddresses(PORT)) {
    console.log(`   ${addr}`);
  }
  // Replaces the Windows Task Scheduler job: polls PM-SAP/OUT on an interval
  // driven by config/notificationSync.json and updates Notification_No.
  startNotificationSync();
  // Ported from RaneSMSNew (SMS-SFMS folder): stoppage/resume SMS alerts and the
  // daily 9-9:30 AM escalation mail. Both start disabled (see their config/*.json)
  // until the recipient tables are migrated and the queries verified - see
  // utils/smsNotificationService.js and utils/escalationMailService.js.
  startSmsNotification();
  startEscalationMail();
  startMobileCloseFtp();
});

module.exports = app;
