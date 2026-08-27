const express = require('express');
const { run, get, all, newId } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');

const router = express.Router();
router.use(requireAuth);

// NOTE: the render-data key for a single client record is deliberately named
// `clientRecord`, not `client` — EJS reserves `client` as a compile option
// (client-side bundle mode) and silently strips server helpers like
// `include` from the compiled template if a data key named `client` is
// present. See views/clients/*.ejs for the matching variable name.

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const clients = q
    ? all('SELECT * FROM clients WHERE tenant_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name', [req.tenantId, `%${q}%`, `%${q}%`])
    : all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  res.render('clients/index', { title: 'Clients', clients, q });
});

router.get('/new', (req, res) => {
  res.render('clients/form', { title: 'Add client', clientRecord: {}, error: null });
});

router.post('/', (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  if (!name) return res.status(400).render('clients/form', { title: 'Add client', clientRecord: req.body, error: 'Client name is required.' });
  const id = newId('cli');
  run('INSERT INTO clients (id, tenant_id, name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, req.tenantId, name.trim(), email || null, phone || null, address || null, notes || null,
  ]);
  setFlash(res, 'success', `${name} added.`);
  res.redirect(`/clients/${id}`);
});

router.get('/:id', (req, res) => {
  const clientRecord = get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!clientRecord) return res.status(404).render('404', { title: 'Not found' });
  const quotes = all('SELECT * FROM quotes WHERE client_id = ? AND tenant_id = ? ORDER BY created_at DESC', [clientRecord.id, req.tenantId]);
  const orders = all('SELECT * FROM orders WHERE client_id = ? AND tenant_id = ? ORDER BY created_at DESC', [clientRecord.id, req.tenantId]);
  const invoices = all('SELECT * FROM invoices WHERE client_id = ? AND tenant_id = ? ORDER BY created_at DESC', [clientRecord.id, req.tenantId]);
  const outstanding = invoices.reduce((sum, i) => (i.status !== 'PAID' && i.status !== 'CANCELLED' ? sum + (i.total - i.amount_paid) : sum), 0);
  res.render('clients/show', { title: clientRecord.name, clientRecord, quotes, orders, invoices, outstanding });
});

router.get('/:id/edit', (req, res) => {
  const clientRecord = get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!clientRecord) return res.status(404).render('404', { title: 'Not found' });
  res.render('clients/form', { title: 'Edit client', clientRecord, error: null });
});

router.post('/:id', (req, res) => {
  const clientRecord = get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!clientRecord) return res.status(404).render('404', { title: 'Not found' });
  const { name, email, phone, address, notes } = req.body;
  if (!name) return res.status(400).render('clients/form', { title: 'Edit client', clientRecord: { ...clientRecord, ...req.body }, error: 'Client name is required.' });
  run('UPDATE clients SET name=?, email=?, phone=?, address=?, notes=? WHERE id=? AND tenant_id=?', [
    name.trim(), email || null, phone || null, address || null, notes || null, clientRecord.id, req.tenantId,
  ]);
  setFlash(res, 'success', 'Client updated.');
  res.redirect(`/clients/${clientRecord.id}`);
});

router.post('/:id/delete', (req, res) => {
  const clientRecord = get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!clientRecord) return res.status(404).render('404', { title: 'Not found' });
  const inUse = get(
    `SELECT id FROM quotes WHERE client_id = ? UNION SELECT id FROM orders WHERE client_id = ? UNION SELECT id FROM invoices WHERE client_id = ?`,
    [clientRecord.id, clientRecord.id, clientRecord.id]
  );
  if (inUse) {
    setFlash(res, 'error', 'Cannot delete a client with existing quotes, orders or invoices.');
    return res.redirect(`/clients/${clientRecord.id}`);
  }
  run('DELETE FROM clients WHERE id = ? AND tenant_id = ?', [clientRecord.id, req.tenantId]);
  setFlash(res, 'success', 'Client deleted.');
  res.redirect('/clients');
});

module.exports = router;
