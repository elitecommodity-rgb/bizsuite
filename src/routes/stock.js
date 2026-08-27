const express = require('express');
const { run, get, all, newId, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { setFlash } = require('../lib/flash');
const { upload } = require('../lib/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let items;
  if (q) {
    items = all(
      `SELECT * FROM stock_items WHERE tenant_id = ? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) ORDER BY name`,
      [req.tenantId, `%${q}%`, `%${q}%`, `%${q}%`]
    );
  } else {
    items = all('SELECT * FROM stock_items WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  }
  const lowStockCount = items.filter((i) => i.quantity_on_hand <= i.reorder_level).length;
  res.render('stock/index', { title: 'Stock', items, q, lowStockCount });
});

router.get('/new', (req, res) => {
  res.render('stock/form', { title: 'Add stock item', item: {}, error: null });
});

router.post('/', upload.single('photo'), (req, res) => {
  const { name, sku, category, unit, quantityOnHand, reorderLevel, unitCost, unitPrice } = req.body;
  if (!name) {
    return res.status(400).render('stock/form', { title: 'Add stock item', item: req.body, error: 'Item name is required.' });
  }
  const id = newId('stk');
  const photoUrl = req.file ? `/public/uploads/${req.file.filename}` : null;
  run(
    `INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, quantity_on_hand, reorder_level, unit_cost, unit_price, photo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.tenantId,
      sku || null,
      name.trim(),
      category || null,
      unit || 'unit',
      Number(quantityOnHand) || 0,
      Number(reorderLevel) || 0,
      Number(unitCost) || 0,
      Number(unitPrice) || 0,
      photoUrl,
    ]
  );
  if (Number(quantityOnHand) > 0) {
    run(
      `INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reason) VALUES (?, ?, ?, 'IN', ?, 'Initial stock')`,
      [newId('mov'), req.tenantId, id, Number(quantityOnHand)]
    );
  }
  setFlash(res, 'success', `${name} added to stock.`);
  res.redirect('/stock');
});

router.get('/:id', (req, res) => {
  const item = get('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!item) return res.status(404).render('404', { title: 'Not found' });
  const movements = all('SELECT * FROM stock_movements WHERE stock_item_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 50', [item.id, req.tenantId]);
  res.render('stock/show', { title: item.name, item, movements });
});

router.get('/:id/edit', (req, res) => {
  const item = get('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!item) return res.status(404).render('404', { title: 'Not found' });
  res.render('stock/form', { title: 'Edit stock item', item, error: null });
});

router.post('/:id', upload.single('photo'), (req, res) => {
  const item = get('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!item) return res.status(404).render('404', { title: 'Not found' });
  const { name, sku, category, unit, reorderLevel, unitCost, unitPrice } = req.body;
  if (!name) {
    return res.status(400).render('stock/form', { title: 'Edit stock item', item: { ...item, ...req.body }, error: 'Item name is required.' });
  }
  const photoUrl = req.file ? `/public/uploads/${req.file.filename}` : item.photo_url;
  run(
    `UPDATE stock_items SET sku=?, name=?, category=?, unit=?, reorder_level=?, unit_cost=?, unit_price=?, photo_url=? WHERE id=? AND tenant_id=?`,
    [sku || null, name.trim(), category || null, unit || 'unit', Number(reorderLevel) || 0, Number(unitCost) || 0, Number(unitPrice) || 0, photoUrl, item.id, req.tenantId]
  );
  setFlash(res, 'success', 'Stock item updated.');
  res.redirect(`/stock/${item.id}`);
});

router.post('/:id/movement', (req, res) => {
  const item = get('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!item) return res.status(404).render('404', { title: 'Not found' });
  const { type, quantity, reason } = req.body;
  const qty = Number(quantity);
  if (!['IN', 'OUT', 'ADJUST'].includes(type) || !qty || qty <= 0) {
    setFlash(res, 'error', 'Enter a valid quantity.');
    return res.redirect(`/stock/${item.id}`);
  }
  if (type === 'OUT' && qty > item.quantity_on_hand) {
    setFlash(res, 'error', `Only ${item.quantity_on_hand} ${item.unit} available — cannot remove ${qty}.`);
    return res.redirect(`/stock/${item.id}`);
  }
  transaction(() => {
    const delta = type === 'OUT' ? -qty : qty;
    run('UPDATE stock_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ? AND tenant_id = ?', [delta, item.id, req.tenantId]);
    run(
      `INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reason) VALUES (?, ?, ?, ?, ?, ?)`,
      [newId('mov'), req.tenantId, item.id, type, qty, reason || null]
    );
  });
  setFlash(res, 'success', 'Stock movement recorded.');
  res.redirect(`/stock/${item.id}`);
});

router.post('/:id/delete', (req, res) => {
  const item = get('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!item) return res.status(404).render('404', { title: 'Not found' });
  const inUse = get(
    `SELECT id FROM order_line_items WHERE stock_item_id = ? UNION SELECT id FROM quote_line_items WHERE stock_item_id = ?`,
    [item.id, item.id]
  );
  if (inUse) {
    setFlash(res, 'error', 'Cannot delete an item that is used on a quote or order. Archive it instead by setting quantity to 0.');
    return res.redirect(`/stock/${item.id}`);
  }
  transaction(() => {
    run('DELETE FROM stock_movements WHERE stock_item_id = ? AND tenant_id = ?', [item.id, req.tenantId]);
    run('DELETE FROM stock_items WHERE id = ? AND tenant_id = ?', [item.id, req.tenantId]);
  });
  setFlash(res, 'success', 'Stock item deleted.');
  res.redirect('/stock');
});

module.exports = router;
