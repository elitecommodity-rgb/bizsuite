const express = require('express');
const { run, get, all, newId, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');
const { nextNumber } = require('../lib/numbering');
const { computeTotals, round2 } = require('../lib/calc');
const { parseLineItemsFromBody } = require('../lib/lineItems');
const { sendClientEmail } = require('../lib/email');

const router = express.Router();
router.use(requireAuth);

function statusForPayment(total, amountPaid) {
  if (amountPaid <= 0) return null; // caller decides between DRAFT/SENT/OVERDUE
  if (amountPaid >= total) return 'PAID';
  return 'PARTIALLY_PAID';
}

router.get('/', (req, res) => {
  const status = req.query.status;
  const valid = ['DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'];
  // Auto-flag overdue: SENT/PARTIALLY_PAID invoices past due date.
  run("UPDATE invoices SET status = 'OVERDUE' WHERE tenant_id = ? AND status IN ('SENT','PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date < date('now')", [req.tenantId]);

  const base = `SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.tenant_id = ?`;
  const invoices = status && valid.includes(status)
    ? all(`${base} AND i.status = ? ORDER BY i.created_at DESC`, [req.tenantId, status])
    : all(`${base} ORDER BY i.created_at DESC`, [req.tenantId]);
  const outstandingTotal = all(`SELECT total, amount_paid FROM invoices WHERE tenant_id = ? AND status NOT IN ('PAID','CANCELLED','DRAFT')`, [req.tenantId])
    .reduce((sum, i) => sum + (i.total - i.amount_paid), 0);
  res.render('invoices/index', { title: 'Invoices', invoices, status: status || '', outstandingTotal });
});

router.get('/new', (req, res) => {
  const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  if (!clients.length) {
    setFlash(res, 'error', 'Add a client before creating an invoice.');
    return res.redirect('/clients/new');
  }

  let invoice = { tax_rate_pct: req.tenant.tax_rate_pct };
  let lines = [];
  let orderId = null;

  if (req.query.orderId) {
    const order = get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.query.orderId, req.tenantId]);
    if (order) {
      const existing = get('SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?', [order.id, req.tenantId]);
      if (existing) {
        setFlash(res, 'info', 'This order already has an invoice.');
        return res.redirect(`/invoices/${existing.id}`);
      }
      orderId = order.id;
      invoice = { client_id: order.client_id, tax_rate_pct: order.tax_rate_pct, notes: order.notes };
      lines = all('SELECT * FROM order_line_items WHERE order_id = ?', [order.id]).map((l) => ({
        description: l.description, quantity: l.quantity, unitPrice: l.unit_price, stockItemId: l.stock_item_id,
      }));
    }
  }

  res.render('invoices/form', { title: 'New invoice', invoice, lines, clients, stockItems, orderId, error: null });
});

router.post('/', (req, res) => {
  const { clientId, orderId, dueDate, notes, taxRatePct } = req.body;
  const client = clientId && get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, req.tenantId]);
  const order = orderId ? get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [orderId, req.tenantId]) : null;
  const lines = parseLineItemsFromBody(req.body);

  if (!client || !lines.length) {
    const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    return res.status(400).render('invoices/form', {
      title: 'New invoice',
      invoice: { client_id: clientId, tax_rate_pct: taxRatePct },
      lines,
      clients,
      stockItems,
      orderId: orderId || null,
      error: !client ? 'Select a valid client.' : 'Add at least one line item.',
    });
  }

  const totals = computeTotals(lines, taxRatePct);
  const id = newId('inv');
  const number = nextNumber(req.tenantId, 'invoices', 'INV');

  transaction(() => {
    run(
      `INSERT INTO invoices (id, tenant_id, client_id, order_id, number, status, due_date, subtotal, tax_rate_pct, tax_amount, total, notes)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, client.id, order ? order.id : null, number, dueDate || null, totals.subtotal, totals.taxRatePct, totals.taxAmount, totals.total, notes || null]
    );
    totals.lines.forEach((l) => {
      run(
        `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)`,
        [newId('ili'), id, l.description, l.quantity, l.unitPrice, l.lineTotal]
      );
    });
  });

  setFlash(res, 'success', `Invoice ${number} created.`);
  res.redirect(`/invoices/${id}`);
});

router.get('/:id', (req, res) => {
  const invoice = get('SELECT i.*, c.name as client_name, c.email as client_email FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ? AND i.tenant_id = ?', [req.params.id, req.tenantId]);
  if (!invoice) return res.status(404).render('404', { title: 'Not found' });
  const lines = all('SELECT * FROM invoice_line_items WHERE invoice_id = ?', [invoice.id]);
  const payments = all('SELECT * FROM payments WHERE invoice_id = ? AND tenant_id = ? ORDER BY paid_at DESC', [invoice.id, req.tenantId]);
  res.render('invoices/show', { title: `Invoice ${invoice.number}`, invoice, lines, payments, balance: round2(invoice.total - invoice.amount_paid) });
});

router.post('/:id/status', (req, res) => {
  const invoice = get('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!invoice) return res.status(404).render('404', { title: 'Not found' });
  const { status } = req.body;
  if (!['DRAFT', 'SENT', 'CANCELLED'].includes(status)) {
    setFlash(res, 'error', 'Invalid status.');
    return res.redirect(`/invoices/${invoice.id}`);
  }
  run('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?', [status, invoice.id, req.tenantId]);
  setFlash(res, 'success', `Invoice marked ${status.toLowerCase()}.`);
  res.redirect(`/invoices/${invoice.id}`);
});

router.post('/:id/payment', (req, res) => {
  const invoice = get('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!invoice) return res.status(404).render('404', { title: 'Not found' });
  const { amount, method, notes } = req.body;
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    setFlash(res, 'error', 'Enter a valid payment amount.');
    return res.redirect(`/invoices/${invoice.id}`);
  }
  const newPaid = round2(invoice.amount_paid + amt);
  if (newPaid > invoice.total + 0.01) {
    setFlash(res, 'error', `That payment would exceed the invoice total (outstanding: ${invoice.total - invoice.amount_paid}).`);
    return res.redirect(`/invoices/${invoice.id}`);
  }
  const newStatus = statusForPayment(invoice.total, newPaid) || invoice.status;
  transaction(() => {
    run('INSERT INTO payments (id, tenant_id, invoice_id, amount, method, notes) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('pay'), req.tenantId, invoice.id, amt, method || null, notes || null,
    ]);
    run('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ? AND tenant_id = ?', [newPaid, newStatus, invoice.id, req.tenantId]);
  });
  setFlash(res, 'success', 'Payment recorded.');
  res.redirect(`/invoices/${invoice.id}`);
});

router.post('/:id/send', async (req, res) => {
  const invoice = get('SELECT i.*, c.name as client_name, c.email as client_email FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ? AND i.tenant_id = ?', [req.params.id, req.tenantId]);
  if (!invoice) return res.status(404).render('404', { title: 'Not found' });
  if (!invoice.client_email) {
    setFlash(res, 'error', 'This client has no email address on file.');
    return res.redirect(`/invoices/${invoice.id}`);
  }
  const lines = all('SELECT * FROM invoice_line_items WHERE invoice_id = ?', [invoice.id]);
  const rowsHtml = lines.map((l) => `<tr><td style="padding:4px 8px;">${l.description}</td><td style="padding:4px 8px;text-align:right;">${l.quantity}</td><td style="padding:4px 8px;text-align:right;">${req.tenant.currency} ${l.unit_price.toFixed(2)}</td><td style="padding:4px 8px;text-align:right;">${req.tenant.currency} ${l.line_total.toFixed(2)}</td></tr>`).join('');
  const body = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2>Invoice ${invoice.number} from ${req.tenant.name}</h2>
      <p>Hi ${invoice.client_name},</p>
      <table style="width:100%;border-collapse:collapse;"><thead><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Price</th><th align="right">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p style="text-align:right;margin-top:12px;"><strong>Total due: ${req.tenant.currency} ${invoice.total.toFixed(2)}</strong></p>
      ${invoice.due_date ? `<p>Due date: ${new Date(invoice.due_date).toLocaleDateString()}</p>` : ''}
      ${invoice.notes ? `<p>${invoice.notes}</p>` : ''}
      <p>Thank you,<br/>${req.tenant.name}</p>
    </div>`;
  const result = await sendClientEmail({
    tenantId: req.tenantId,
    toEmail: invoice.client_email,
    subject: `Invoice ${invoice.number} from ${req.tenant.name}`,
    body,
    relatedType: 'invoice',
    relatedId: invoice.id,
  });
  if (invoice.status === 'DRAFT') {
    run('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?', ['SENT', invoice.id, req.tenantId]);
  }
  setFlash(res, result.status === 'FAILED' ? 'error' : 'success', result.status === 'FAILED' ? `Email failed to send: ${result.error}` : `Invoice emailed to ${invoice.client_email}.`);
  res.redirect(`/invoices/${invoice.id}`);
});

module.exports = router;
