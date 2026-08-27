// Seeds a demo tenant so the app is explorable immediately after deploy.
// Safe to re-run: skips if the demo tenant already exists.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { run, get, all, newId, transaction } = require('./index');
const { computeTotals } = require('../lib/calc');
const { nextNumber } = require('../lib/numbering');

async function seed() {
  const existing = get('SELECT id FROM tenants WHERE slug = ?', ['demo-scaffold-co']);
  if (existing) {
    console.log('Demo tenant already exists — skipping seed.');
    return;
  }

  const tenantId = newId('ten');
  const userId = newId('usr');
  const passwordHash = await bcrypt.hash('demo1234', 10);

  transaction(() => {
    run(
      `INSERT INTO tenants (id, name, slug, industry, currency, tax_rate_pct) VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, 'Demo Scaffold Co', 'demo-scaffold-co', 'Scaffolding & construction hire', 'ZAR', 15]
    );
    run(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, tenantId, 'demo@bizsuite.app', passwordHash, 'Demo Owner', 'OWNER']
    );

    // Stock
    const stock = [
      { name: 'Standard scaffold frame (1.8m)', category: 'Frame', unit: 'each', qty: 120, reorder: 20, cost: 350, price: 55 },
      { name: 'Cross brace', category: 'Brace', unit: 'each', qty: 200, reorder: 40, cost: 90, price: 15 },
      { name: 'Scaffold board 3.9m', category: 'Board', unit: 'each', qty: 8, reorder: 15, cost: 220, price: 35 },
      { name: 'Base plate', category: 'Fitting', unit: 'each', qty: 150, reorder: 30, cost: 60, price: 10 },
      { name: 'Guard rail post', category: 'Safety', unit: 'each', qty: 60, reorder: 15, cost: 140, price: 22 },
    ];
    const stockIds = {};
    stock.forEach((s) => {
      const id = newId('stk');
      stockIds[s.name] = id;
      run(
        `INSERT INTO stock_items (id, tenant_id, name, category, unit, quantity_on_hand, reorder_level, unit_cost, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, s.name, s.category, s.unit, s.qty, s.reorder, s.cost, s.price]
      );
      run(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reason) VALUES (?, ?, ?, 'IN', ?, 'Initial stock')`, [
        newId('mov'), tenantId, id, s.qty,
      ]);
    });

    // Clients
    const clients = [
      { name: 'Coastal Builders (Pty) Ltd', email: 'accounts@coastalbuilders.example', phone: '031 555 0101', address: '12 Marine Parade, Durban' },
      { name: 'Ridgeline Construction', email: 'ap@ridgeline.example', phone: '011 555 0199', address: '4 Ridge Road, Johannesburg' },
      { name: 'Harbor View Developments', email: 'finance@harborview.example', phone: '021 555 0155', address: '9 Quay Street, Cape Town' },
    ];
    const clientIds = clients.map((c) => {
      const id = newId('cli');
      run('INSERT INTO clients (id, tenant_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)', [id, tenantId, c.name, c.email, c.phone, c.address]);
      return id;
    });

    // Quote (draft) for client 1
    const quoteLines1 = computeTotals(
      [
        { description: 'Standard scaffold frame (1.8m)', quantity: 20, unitPrice: 55, stockItemId: stockIds['Standard scaffold frame (1.8m)'] },
        { description: 'Cross brace', quantity: 30, unitPrice: 15, stockItemId: stockIds['Cross brace'] },
      ],
      15
    );
    const quote1Id = newId('quo');
    const quote1Number = nextNumber(tenantId, 'quotes', 'Q');
    run(
      `INSERT INTO quotes (id, tenant_id, client_id, number, status, subtotal, tax_rate_pct, tax_amount, total) VALUES (?, ?, ?, ?, 'SENT', ?, ?, ?, ?)`,
      [quote1Id, tenantId, clientIds[1], quote1Number, quoteLines1.subtotal, quoteLines1.taxRatePct, quoteLines1.taxAmount, quoteLines1.total]
    );
    quoteLines1.lines.forEach((l) => {
      run('INSERT INTO quote_line_items (id, quote_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        newId('qli'), quote1Id, l.stockItemId, l.description, l.quantity, l.unitPrice, l.lineTotal,
      ]);
    });

    // Completed order + paid invoice for client 0
    const orderLines = computeTotals(
      [
        { description: 'Standard scaffold frame (1.8m)', quantity: 40, unitPrice: 55, stockItemId: stockIds['Standard scaffold frame (1.8m)'] },
        { description: 'Base plate', quantity: 40, unitPrice: 10, stockItemId: stockIds['Base plate'] },
        { description: 'Guard rail post', quantity: 12, unitPrice: 22, stockItemId: stockIds['Guard rail post'] },
      ],
      15
    );
    const orderId = newId('ord');
    const orderNumber = nextNumber(tenantId, 'orders', 'ORD');
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    run(
      `INSERT INTO orders (id, tenant_id, client_id, number, status, start_date, delivery_date, completion_date, subtotal, tax_rate_pct, tax_amount, total)
       VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, tenantId, clientIds[0], orderNumber, twoWeeksAgo, oneWeekAgo, oneWeekAgo, orderLines.subtotal, orderLines.taxRatePct, orderLines.taxAmount, orderLines.total]
    );
    orderLines.lines.forEach((l) => {
      run('INSERT INTO order_line_items (id, order_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        newId('oli'), orderId, l.stockItemId, l.description, l.quantity, l.unitPrice, l.lineTotal,
      ]);
      run(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reason, ref_type, ref_id) VALUES (?, ?, ?, 'OUT', ?, 'Delivered to job', 'order', ?)`, [
        newId('mov'), tenantId, l.stockItemId, l.quantity, orderId,
      ]);
      run('UPDATE stock_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [l.quantity, l.stockItemId]);
    });
    run(
      `INSERT INTO deliveries (id, tenant_id, order_id, status, scheduled_date, delivered_date, address) VALUES (?, ?, ?, 'DELIVERED', ?, ?, ?)`,
      [newId('del'), tenantId, orderId, oneWeekAgo, oneWeekAgo, clients[0].address]
    );

    const invoiceId = newId('inv');
    const invoiceNumber = nextNumber(tenantId, 'invoices', 'INV');
    run(
      `INSERT INTO invoices (id, tenant_id, client_id, order_id, number, status, issue_date, due_date, subtotal, tax_rate_pct, tax_amount, total, amount_paid)
       VALUES (?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, tenantId, clientIds[0], orderId, invoiceNumber, oneWeekAgo, oneWeekAgo, orderLines.subtotal, orderLines.taxRatePct, orderLines.taxAmount, orderLines.total, orderLines.total]
    );
    orderLines.lines.forEach((l) => {
      run('INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)', [
        newId('ili'), invoiceId, l.description, l.quantity, l.unitPrice, l.lineTotal,
      ]);
    });
    run('INSERT INTO payments (id, tenant_id, invoice_id, amount, method, paid_at) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('pay'), tenantId, invoiceId, orderLines.total, 'EFT', oneWeekAgo,
    ]);

    // In-progress order with a pending extension request for client 2
    const order2Lines = computeTotals(
      [{ description: 'Scaffold board 3.9m', quantity: 15, unitPrice: 35, stockItemId: stockIds['Scaffold board 3.9m'] }],
      15
    );
    const order2Id = newId('ord');
    const order2Number = nextNumber(tenantId, 'orders', 'ORD');
    const inTwoDays = new Date(now.getTime() + 2 * 86400000).toISOString();
    const inNineDays = new Date(now.getTime() + 9 * 86400000).toISOString();
    run(
      `INSERT INTO orders (id, tenant_id, client_id, number, status, start_date, delivery_date, subtotal, tax_rate_pct, tax_amount, total, extension_status, extension_request_date, extension_requested_date, extension_reason)
       VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?)`,
      [order2Id, tenantId, clientIds[2], order2Number, now.toISOString(), inTwoDays, order2Lines.subtotal, order2Lines.taxRatePct, order2Lines.taxAmount, order2Lines.total, now.toISOString(), inNineDays, 'Supplier delivery delayed by a week']
    );
    order2Lines.lines.forEach((l) => {
      run('INSERT INTO order_line_items (id, order_id, stock_item_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        newId('oli'), order2Id, l.stockItemId, l.description, l.quantity, l.unitPrice, l.lineTotal,
      ]);
    });
  });

  console.log('Seeded demo tenant.');
  console.log('  Login: demo@bizsuite.app / demo1234');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
