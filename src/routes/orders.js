const express = require('express');
const { run, get, all, newId, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');
const { nextNumber } = require('../lib/numbering');
const { computeTotals } = require('../lib/calc');
const { parseLineItemsFromBody } = require('../lib/lineItems');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const status = req.query.status;
  const valid = ['PENDING', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED'];
  const orders = status && valid.includes(status)
    ? all('SELECT o.*, c.name as client_name FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.tenant_id = ? AND o.status = ? ORDER BY o.created_at DESC', [req.tenantId, status])
    : all('SELECT o.*, c.name as client_name FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.tenant_id = ? ORDER BY o.created_at DESC', [req.tenantId]);
  const pendingExtensions = all("SELECT COUNT(*) as n FROM orders WHERE tenant_id = ? AND extension_status = 'REQUESTED'", [req.tenantId])[0].n;
  res.render('orders/index', { title: 'Jobs / Orders', orders, status: status || '', pendingExtensions });
});

router.get('/new', (req, res) => {
  const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  if (!clients.length) {
    setFlash(res, 'error', 'Add a client before creating an order.');
    return res.redirect('/clients/new');
  }
  res.render('orders/form', {
    title: 'New order',
    order: { client_id: req.query.clientId || '', tax_rate_pct: req.tenant.tax_rate_pct },
    clients,
    stockItems,
    error: null,
  });
});

router.post('/', (req, res) => {
  const { clientId, startDate, deliveryDate, notes, taxRatePct } = req.body;
  const client = clientId && get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, req.tenantId]);
  const lines = parseLineItemsFromBody(req.body);

  if (!client || !lines.length) {
    const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    return res.status(400).render('orders/form', {
      title: 'New order',
      order: { client_id: clientId, tax_rate_pct: taxRatePct },
      clients,
      stockItems,
      error: !client ? 'Select a valid client.' : 'Add at least one line item.',
    });
  }

  const totals = computeTotals(lines, taxRatePct);
  const id = newId('ord');
  const number = nextNumber(req.tenantId, 'orders', 'ORD');

  transaction(() => {
    run(
      `INSERT INTO orders (id, tenant_id, client_id, number, status, start_date, delivery_date, subtotal, tax_rate_pct, tax_amount, total, notes)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, client.id, number, startDate || null, deliveryDate || null, totals.subtotal, totals.taxRatePct, totals.taxAmount, totals.total, notes || null]
    );
    totals.lines.forEach((l) => {
      run(
        `INSERT INTO order_line_items (id, order_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId('oli'), id, l.stockItemId || null, l.description, l.quantity, l.unitPrice, l.lineTotal]
      );
    });
  });

  setFlash(res, 'success', `Order ${number} created.`);
  res.redirect(`/orders/${id}`);
});

router.get('/:id', (req, res) => {
  const order = get('SELECT o.*, c.name as client_name, c.email as client_email FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ? AND o.tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const lines = all('SELECT * FROM order_line_items WHERE order_id = ?', [order.id]);
  const deliveries = all('SELECT * FROM deliveries WHERE order_id = ? AND tenant_id = ? ORDER BY created_at DESC', [order.id, req.tenantId]);
  const invoice = get('SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?', [order.id, req.tenantId]);
  res.render('orders/show', { title: `Order ${order.number}`, order, lines, deliveries, invoice });
});

router.post('/:id/status', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const { status } = req.body;
  if (!['PENDING', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
    setFlash(res, 'error', 'Invalid status.');
    return res.redirect(`/orders/${order.id}`);
  }
  const completionDate = status === 'COMPLETED' ? new Date().toISOString() : order.completion_date;
  run('UPDATE orders SET status = ?, completion_date = ? WHERE id = ? AND tenant_id = ?', [status, completionDate, order.id, req.tenantId]);
  setFlash(res, 'success', `Order marked ${status.replace('_', ' ').toLowerCase()}.`);
  res.redirect(`/orders/${order.id}`);
});

router.post('/:id/dates', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const { startDate, deliveryDate } = req.body;
  run('UPDATE orders SET start_date = ?, delivery_date = ? WHERE id = ? AND tenant_id = ?', [startDate || null, deliveryDate || null, order.id, req.tenantId]);
  setFlash(res, 'success', 'Timeline updated.');
  res.redirect(`/orders/${order.id}`);
});

router.post('/:id/extension-request', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const { requestedDate, reason } = req.body;
  if (!requestedDate) {
    setFlash(res, 'error', 'Enter a requested new delivery date.');
    return res.redirect(`/orders/${order.id}`);
  }
  run(
    `UPDATE orders SET extension_status = 'REQUESTED', extension_request_date = ?, extension_requested_date = ?, extension_reason = ? WHERE id = ? AND tenant_id = ?`,
    [new Date().toISOString(), requestedDate, reason || null, order.id, req.tenantId]
  );
  setFlash(res, 'success', 'Extension request recorded.');
  res.redirect(`/orders/${order.id}`);
});

router.post('/:id/extension-decision', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const { decision } = req.body;
  if (!['APPROVED', 'DECLINED'].includes(decision)) {
    setFlash(res, 'error', 'Invalid decision.');
    return res.redirect(`/orders/${order.id}`);
  }
  transaction(() => {
    if (decision === 'APPROVED' && order.extension_requested_date) {
      run('UPDATE orders SET delivery_date = ? WHERE id = ? AND tenant_id = ?', [order.extension_requested_date, order.id, req.tenantId]);
    }
    run('UPDATE orders SET extension_status = ? WHERE id = ? AND tenant_id = ?', [decision, order.id, req.tenantId]);
  });
  setFlash(res, 'success', `Extension ${decision.toLowerCase()}.`);
  res.redirect(`/orders/${order.id}`);
});

module.exports = router;
