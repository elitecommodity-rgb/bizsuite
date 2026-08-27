const express = require('express');
const { all } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getRange } = require('../lib/periods');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const tenantId = req.tenantId;

  const clientCount = all('SELECT COUNT(*) as n FROM clients WHERE tenant_id = ?', [tenantId])[0].n;
  const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ?', [tenantId]);
  const lowStock = stockItems.filter((i) => i.quantity_on_hand <= i.reorder_level);
  const openOrders = all("SELECT COUNT(*) as n FROM orders WHERE tenant_id = ? AND status IN ('PENDING','IN_PROGRESS')", [tenantId])[0].n;
  const pendingExtensions = all("SELECT COUNT(*) as n FROM orders WHERE tenant_id = ? AND extension_status = 'REQUESTED'", [tenantId])[0].n;

  const invoices = all("SELECT total, amount_paid, status FROM invoices WHERE tenant_id = ? AND status NOT IN ('DRAFT','CANCELLED')", [tenantId]);
  const outstanding = invoices.reduce((sum, i) => sum + (i.total - i.amount_paid), 0);
  const overdueCount = all("SELECT COUNT(*) as n FROM invoices WHERE tenant_id = ? AND status = 'OVERDUE'", [tenantId])[0].n;

  const { startISO } = getRange('month');
  const monthRevenue = all(
    `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE tenant_id = ? AND paid_at >= ?`,
    [tenantId, startISO]
  )[0].total;

  const upcomingDeliveries = all(
    `SELECT d.*, o.number as order_number, c.name as client_name FROM deliveries d
     JOIN orders o ON o.id = d.order_id JOIN clients c ON c.id = o.client_id
     WHERE d.tenant_id = ? AND d.status IN ('SCHEDULED','OUT_FOR_DELIVERY') ORDER BY d.scheduled_date ASC LIMIT 5`,
    [tenantId]
  );

  const recentQuotes = all(
    `SELECT q.*, c.name as client_name FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.tenant_id = ? ORDER BY q.created_at DESC LIMIT 5`,
    [tenantId]
  );

  res.render('dashboard/index', {
    title: 'Dashboard',
    clientCount,
    stockCount: stockItems.length,
    lowStock,
    openOrders,
    pendingExtensions,
    outstanding,
    overdueCount,
    monthRevenue,
    upcomingDeliveries,
    recentQuotes,
  });
});

module.exports = router;
