require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

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

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // allow React's inline scripts during dev
}));

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// ─── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SFMS Backend running on http://127.0.0.1:${PORT}`);
});

module.exports = app;
