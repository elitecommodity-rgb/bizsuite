const express = require('express');
const { run, get, all, newId } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const status = req.query.status;
  const valid = ['SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];
  const base = `SELECT d.*, o.number as order_number, c.name as client_name FROM deliveries d
                JOIN orders o ON o.id = d.order_id JOIN clients c ON c.id = o.client_id
                WHERE d.tenant_id = ?`;
  const deliveries = status && valid.includes(status)
    ? all(`${base} AND d.status = ? ORDER BY d.scheduled_date ASC, d.created_at DESC`, [req.tenantId, status])
    : all(`${base} ORDER BY d.scheduled_date ASC, d.created_at DESC`, [req.tenantId]);
  res.render('deliveries/index', { title: 'Deliveries', deliveries, status: status || '' });
});

// Create a delivery under an order
router.post('/order/:orderId', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.orderId, req.tenantId]);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const { scheduledDate, address, notes } = req.body;
  run(
    `INSERT INTO deliveries (id, tenant_id, order_id, status, scheduled_date, address, notes) VALUES (?, ?, ?, 'SCHEDULED', ?, ?, ?)`,
    [newId('del'), req.tenantId, order.id, scheduledDate || null, address || null, notes || null]
  );
  setFlash(res, 'success', 'Delivery scheduled.');
  res.redirect(`/orders/${order.id}`);
});

router.post('/:id/status', (req, res) => {
  const delivery = get('SELECT * FROM deliveries WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!delivery) return res.status(404).render('404', { title: 'Not found' });
  const { status } = req.body;
  if (!['SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'].includes(status)) {
    setFlash(res, 'error', 'Invalid status.');
    return res.redirect(`/orders/${delivery.order_id}`);
  }
  const deliveredDate = status === 'DELIVERED' ? new Date().toISOString() : delivery.delivered_date;
  run('UPDATE deliveries SET status = ?, delivered_date = ? WHERE id = ? AND tenant_id = ?', [status, deliveredDate, delivery.id, req.tenantId]);
  if (status === 'DELIVERED') {
    run("UPDATE orders SET status = 'DELIVERED' WHERE id = ? AND tenant_id = ? AND status NOT IN ('COMPLETED','CANCELLED')", [delivery.order_id, req.tenantId]);
  }
  setFlash(res, 'success', 'Delivery status updated.');
  res.redirect(req.get('referer') && req.get('referer').includes('/deliveries') ? '/deliveries' : `/orders/${delivery.order_id}`);
});

module.exports = router;
