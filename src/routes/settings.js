const express = require('express');
const { run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');
const { upload } = require('../lib/upload');
const { isLiveEmailConfigured } = require('../lib/email');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('settings/index', { title: 'Settings', error: null, liveEmail: isLiveEmailConfigured() });
});

router.post('/', upload.single('logo'), (req, res) => {
  const { name, industry, currency, taxRatePct, primaryColor } = req.body;
  if (!name) {
    return res.status(400).render('settings/index', { title: 'Settings', error: 'Business name is required.', liveEmail: isLiveEmailConfigured() });
  }
  const logoUrl = req.file ? `/public/uploads/${req.file.filename}` : req.tenant.logo_url;
  run(
    `UPDATE tenants SET name=?, industry=?, currency=?, tax_rate_pct=?, primary_color=?, logo_url=? WHERE id=?`,
    [name.trim(), industry || null, currency || 'ZAR', Number(taxRatePct) || 0, primaryColor || '#8a6d3b', logoUrl, req.tenantId]
  );
  setFlash(res, 'success', 'Settings updated.');
  res.redirect('/settings');
});

module.exports = router;
