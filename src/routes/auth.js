const express = require('express');
const bcrypt = require('bcryptjs');
const { run, get, newId, transaction } = require('../db');
const { issueToken, clearToken, requireGuest } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');

const router = express.Router();

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

router.get('/signup', requireGuest, (req, res) => {
  res.render('auth/signup', { title: 'Create your account', error: null, form: {} });
});

router.post('/signup', requireGuest, async (req, res) => {
  const { businessName, industry, name, email, password, confirmPassword } = req.body;
  const form = { businessName, industry, name, email };

  if (!businessName || !name || !email || !password) {
    return res.status(400).render('auth/signup', { title: 'Create your account', error: 'All fields are required.', form });
  }
  if (password.length < 8) {
    return res.status(400).render('auth/signup', { title: 'Create your account', error: 'Password must be at least 8 characters.', form });
  }
  if (password !== confirmPassword) {
    return res.status(400).render('auth/signup', { title: 'Create your account', error: 'Passwords do not match.', form });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Login is by email alone (no separate "which business" step), so email
  // must be unique across all tenants, not just within one.
  if (get('SELECT id FROM users WHERE email = ?', [normalizedEmail])) {
    return res.status(400).render('auth/signup', { title: 'Create your account', error: 'An account with that email already exists. Try logging in instead.', form });
  }

  try {
    let slug = slugify(businessName) || 'business';
    let suffix = 0;
    while (get('SELECT id FROM tenants WHERE slug = ?', [suffix ? `${slug}-${suffix}` : slug])) {
      suffix += 1;
    }
    if (suffix) slug = `${slug}-${suffix}`;

    const tenantId = newId('ten');
    const userId = newId('usr');
    const passwordHash = await bcrypt.hash(password, 10);

    transaction(() => {
      run('INSERT INTO tenants (id, name, slug, industry) VALUES (?, ?, ?, ?)', [
        tenantId,
        businessName.trim(),
        slug,
        (industry || '').trim() || null,
      ]);
      run(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, tenantId, normalizedEmail, passwordHash, name.trim(), 'OWNER']
      );
    });

    issueToken(res, { userId, tenantId });
    setFlash(res, 'success', `Welcome to BizSuite, ${businessName}! Your account is ready.`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).render('auth/signup', { title: 'Create your account', error: 'Something went wrong creating your account. Please try again.', form });
  }
});

router.get('/login', requireGuest, (req, res) => {
  res.render('auth/login', { title: 'Log in', error: null, form: {} });
});

router.post('/login', requireGuest, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  const user = get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  const valid = user ? await bcrypt.compare(password || '', user.password_hash) : false;

  if (!user || !valid) {
    return res.status(401).render('auth/login', { title: 'Log in', error: 'Invalid email or password.', form: { email } });
  }

  issueToken(res, { userId: user.id, tenantId: user.tenant_id });
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.redirect('/login');
});

module.exports = router;
