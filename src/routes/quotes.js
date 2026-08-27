const express = require('express');
const { run, get, all, newId, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');
const { nextNumber } = require('../lib/numbering');
const { computeTotals } = require('../lib/calc');
const { parseLineItemsFromBody } = require('../lib/lineItems');
const { sendClientEmail } = require('../lib/email');

const router = express.Router();
router.use(requireAuth);

function loadQuoteLines(quoteId, tenantId) {
  return all('SELECT * FROM quote_line_items WHERE quote_id = ?', [quoteId]);
}

router.get('/', (req, res) => {
  const status = req.query.status;
  const valid = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'];
  const quotes = status && valid.includes(status)
    ? all('SELECT q.*, c.name as client_name FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.tenant_id = ? AND q.status = ? ORDER BY q.created_at DESC', [req.tenantId, status])
    : all('SELECT q.*, c.name as client_name FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.tenant_id = ? ORDER BY q.created_at DESC', [req.tenantId]);
  res.render('quotes/index', { title: 'Quotes', quotes, status: status || '' });
});

router.get('/new', (req, res) => {
  const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  if (!clients.length) {
    setFlash(res, 'error', 'Add a client before creating a quote.');
    return res.redirect('/clients/new');
  }
  res.render('quotes/form', {
    title: 'New quote',
    quote: { client_id: req.query.clientId || '', tax_rate_pct: req.tenant.tax_rate_pct },
    lines: [],
    clients,
    stockItems,
    error: null,
  });
});

router.post('/', (req, res) => {
  const { clientId, expiryDate, notes, taxRatePct } = req.body;
  const client = clientId && get('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, req.tenantId]);
  const lines = parseLineItemsFromBody(req.body);

  if (!client || !lines.length) {
    const clients = all('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    const stockItems = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    return res.status(400).render('quotes/form', {
      title: 'New quote',
      quote: { client_id: clientId, tax_rate_pct: taxRatePct },
      lines,
      clients,
      stockItems,
      error: !client ? 'Select a valid client.' : 'Add at least one line item.',
    });
  }

  const totals = computeTotals(lines, taxRatePct);
  const id = newId('quo');
  const number = nextNumber(req.tenantId, 'quotes', 'Q');

  transaction(() => {
    run(
      `INSERT INTO quotes (id, tenant_id, client_id, number, status, expiry_date, subtotal, tax_rate_pct, tax_amount, total, notes)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, client.id, number, expiryDate || null, totals.subtotal, totals.taxRatePct, totals.taxAmount, totals.total, notes || null]
    );
    totals.lines.forEach((l) => {
      run(
        `INSERT INTO quote_line_items (id, quote_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId('qli'), id, l.stockItemId || null, l.description, l.quantity, l.unitPrice, l.lineTotal]
      );
    });
  });

  setFlash(res, 'success', `Quote ${number} created.`);
  res.redirect(`/quotes/${id}`);
});

router.get('/:id', (req, res) => {
  const quote = get('SELECT q.*, c.name as client_name, c.email as client_email FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = ? AND q.tenant_id = ?', [req.params.id, req.tenantId]);
  if (!quote) return res.status(404).render('404', { title: 'Not found' });
  const lines = loadQuoteLines(quote.id, req.tenantId);
  const order = get('SELECT * FROM orders WHERE quote_id = ? AND tenant_id = ?', [quote.id, req.tenantId]);
  res.render('quotes/show', { title: `Quote ${quote.number}`, quote, lines, order });
});

router.post('/:id/status', (req, res) => {
  const quote = get('SELECT * FROM quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!quote) return res.status(404).render('404', { title: 'Not found' });
  const { status } = req.body;
  if (!['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(status)) {
    setFlash(res, 'error', 'Invalid status.');
    return res.redirect(`/quotes/${quote.id}`);
  }
  run('UPDATE quotes SET status = ? WHERE id = ? AND tenant_id = ?', [status, quote.id, req.tenantId]);
  setFlash(res, 'success', `Quote marked ${status.toLowerCase()}.`);
  res.redirect(`/quotes/${quote.id}`);
});

router.post('/:id/send', async (req, res) => {
  const quote = get('SELECT q.*, c.name as client_name, c.email as client_email FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = ? AND q.tenant_id = ?', [req.params.id, req.tenantId]);
  if (!quote) return res.status(404).render('404', { title: 'Not found' });
  if (!quote.client_email) {
    setFlash(res, 'error', 'This client has no email address on file.');
    return res.redirect(`/quotes/${quote.id}`);
  }
  const lines = loadQuoteLines(quote.id, req.tenantId);
  const rowsHtml = lines.map((l) => `<tr><td style="padding:4px 8px;">${l.description}</td><td style="padding:4px 8px;text-align:right;">${l.quantity}</td><td style="padding:4px 8px;text-align:right;">${req.tenant.currency} ${l.unit_price.toFixed(2)}</td><td style="padding:4px 8px;text-align:right;">${req.tenant.currency} ${l.line_total.toFixed(2)}</td></tr>`).join('');
  const body = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2>Quote ${quote.number} from ${req.tenant.name}</h2>
      <p>Hi ${quote.client_name},</p>
      <p>Please find your quote below.</p>
      <table style="width:100%;border-collapse:collapse;"><thead><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Price</th><th align="right">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p style="text-align:right;margin-top:12px;"><strong>Total: ${req.tenant.currency} ${quote.total.toFixed(2)}</strong></p>
      ${quote.notes ? `<p>${quote.notes}</p>` : ''}
      <p>Thank you,<br/>${req.tenant.name}</p>
    </div>`;
  const result = await sendClientEmail({
    tenantId: req.tenantId,
    toEmail: quote.client_email,
    subject: `Quote ${quote.number} from ${req.tenant.name}`,
    body,
    relatedType: 'quote',
    relatedId: quote.id,
  });
  if (quote.status === 'DRAFT') {
    run('UPDATE quotes SET status = ? WHERE id = ? AND tenant_id = ?', ['SENT', quote.id, req.tenantId]);
  }
  setFlash(res, result.status === 'FAILED' ? 'error' : 'success', result.status === 'FAILED' ? `Email failed to send: ${result.error}` : `Quote emailed to ${quote.client_email}.`);
  res.redirect(`/quotes/${quote.id}`);
});

router.post('/:id/convert', (req, res) => {
  const quote = get('SELECT * FROM quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!quote) return res.status(404).render('404', { title: 'Not found' });
  const existing = get('SELECT * FROM orders WHERE quote_id = ? AND tenant_id = ?', [quote.id, req.tenantId]);
  if (existing) {
    setFlash(res, 'info', 'This quote already has an order.');
    return res.redirect(`/orders/${existing.id}`);
  }
  const lines = loadQuoteLines(quote.id, req.tenantId);
  const orderId = newId('ord');
  const number = nextNumber(req.tenantId, 'orders', 'ORD');
  transaction(() => {
    run(
      `INSERT INTO orders (id, tenant_id, client_id, quote_id, number, status, subtotal, tax_rate_pct, tax_amount, total, notes)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
      [orderId, req.tenantId, quote.client_id, quote.id, number, quote.subtotal, quote.tax_rate_pct, quote.tax_amount, quote.total, quote.notes]
    );
    lines.forEach((l) => {
      run(
        `INSERT INTO order_line_items (id, order_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId('oli'), orderId, l.stock_item_id, l.description, l.quantity, l.unit_price, l.line_total]
      );
    });
    if (quote.status !== 'ACCEPTED') {
      run('UPDATE quotes SET status = ? WHERE id = ? AND tenant_id = ?', ['ACCEPTED', quote.id, req.tenantId]);
    }
  });
  setFlash(res, 'success', `Order ${number} created from this quote.`);
  res.redirect(`/orders/${orderId}`);
});

module.exports = router;
