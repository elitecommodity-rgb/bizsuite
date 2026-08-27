const express = require('express');
const { all } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getRange } = require('../lib/periods');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const tenantId = req.tenantId;
  const period = ['today', 'week', 'month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const { startISO, endISO } = getRange(period);

  const quotesInPeriod = all(
    `SELECT COUNT(*) as n, COALESCE(SUM(total),0) as value FROM quotes WHERE tenant_id = ? AND created_at >= ?`,
    [tenantId, startISO]
  )[0];
  const ordersInPeriod = all(
    `SELECT COUNT(*) as n, COALESCE(SUM(total),0) as value FROM orders WHERE tenant_id = ? AND created_at >= ?`,
    [tenantId, startISO]
  )[0];
  const invoicesInPeriod = all(
    `SELECT COUNT(*) as n, COALESCE(SUM(total),0) as value FROM invoices WHERE tenant_id = ? AND created_at >= ? AND status != 'CANCELLED'`,
    [tenantId, startISO]
  )[0];
  const revenueCollected = all(
    `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE tenant_id = ? AND paid_at >= ?`,
    [tenantId, startISO]
  )[0].total;

  const stockIn = all(`SELECT COALESCE(SUM(quantity),0) as total FROM stock_movements WHERE tenant_id = ? AND type = 'IN' AND created_at >= ?`, [tenantId, startISO])[0].total;
  const stockOut = all(`SELECT COALESCE(SUM(quantity),0) as total FROM stock_movements WHERE tenant_id = ? AND type = 'OUT' AND created_at >= ?`, [tenantId, startISO])[0].total;

  const topClients = all(
    `SELECT c.id, c.name, COALESCE(SUM(i.total),0) as invoiced, COALESCE(SUM(i.amount_paid),0) as paid
     FROM clients c LEFT JOIN invoices i ON i.client_id = c.id AND i.tenant_id = c.tenant_id AND i.status != 'CANCELLED' AND i.created_at >= ?
     WHERE c.tenant_id = ? GROUP BY c.id ORDER BY invoiced DESC LIMIT 8`,
    [startISO, tenantId]
  ).filter((c) => c.invoiced > 0);

  const quoteConversion = all(
    `SELECT
       (SELECT COUNT(*) FROM quotes WHERE tenant_id = ? AND created_at >= ?) as sent,
       (SELECT COUNT(*) FROM quotes WHERE tenant_id = ? AND status = 'ACCEPTED' AND created_at >= ?) as accepted`,
    [tenantId, startISO, tenantId, startISO]
  )[0];

  const outstandingInvoices = all(
    `SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.tenant_id = ? AND i.status IN ('SENT','PARTIALLY_PAID','OVERDUE') ORDER BY i.due_date ASC LIMIT 10`,
    [tenantId]
  );

  // Last 14 days of collected revenue for a simple trend chart.
  const dailyRevenue = all(
    `SELECT date(paid_at) as day, SUM(amount) as total FROM payments WHERE tenant_id = ? AND paid_at >= date('now', '-13 days') GROUP BY date(paid_at)`,
    [tenantId]
  );
  const revenueByDay = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = dailyRevenue.find((r) => r.day === key);
    revenueByDay.push({ day: key, total: found ? found.total : 0 });
  }
  const maxDaily = Math.max(1, ...revenueByDay.map((d) => d.total));

  res.render('reports/index', {
    title: 'Reports',
    period,
    quotesInPeriod,
    ordersInPeriod,
    invoicesInPeriod,
    revenueCollected,
    stockIn,
    stockOut,
    topClients,
    quoteConversion,
    outstandingInvoices,
    revenueByDay,
    maxDaily,
  });
});

module.exports = router;
