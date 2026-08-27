const jwt = require('jsonwebtoken');
const { get } = require('../db');

const COOKIE_NAME = 'bizsuite_token';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set (see .env.example)');
}

function issueToken(res, { userId, tenantId }) {
  const token = jwt.sign({ userId, tenantId }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

// Attaches req.user + req.tenant if a valid session cookie is present.
// Never blocks the request — use requireAuth for that.
function attachUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', [payload.userId, payload.tenantId]);
    const tenant = user ? get('SELECT * FROM tenants WHERE id = ?', [payload.tenantId]) : null;
    if (user && tenant) {
      req.user = user;
      req.tenant = tenant;
      req.tenantId = tenant.id;
    }
  } catch (err) {
    // invalid/expired token — treat as logged out
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

module.exports = { COOKIE_NAME, issueToken, clearToken, attachUser, requireAuth, requireGuest };
