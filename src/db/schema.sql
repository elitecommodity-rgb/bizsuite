-- BizSuite schema (SQLite via Node's built-in node:sqlite module)
-- No enums in SQLite: enum-like columns are TEXT with a CHECK constraint.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  industry      TEXT,
  logo_url      TEXT,
  primary_color TEXT NOT NULL DEFAULT '#8a6d3b',
  currency      TEXT NOT NULL DEFAULT 'ZAR',
  tax_rate_pct  REAL NOT NULL DEFAULT 15,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','ADMIN','STAFF')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);

CREATE TABLE IF NOT EXISTS stock_items (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  sku              TEXT,
  name             TEXT NOT NULL,
  category         TEXT,
  unit             TEXT NOT NULL DEFAULT 'unit',
  quantity_on_hand REAL NOT NULL DEFAULT 0,
  reorder_level    REAL NOT NULL DEFAULT 0,
  unit_cost        REAL NOT NULL DEFAULT 0,
  unit_price       REAL NOT NULL DEFAULT 0,
  photo_url        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_items_tenant ON stock_items(tenant_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  stock_item_id TEXT NOT NULL REFERENCES stock_items(id),
  type          TEXT NOT NULL CHECK (type IN ('IN','OUT','ADJUST')),
  quantity      REAL NOT NULL,
  reason        TEXT,
  ref_type      TEXT,
  ref_id        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(stock_item_id);

CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  client_id    TEXT NOT NULL REFERENCES clients(id),
  number       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED')),
  issue_date   TEXT NOT NULL DEFAULT (datetime('now')),
  expiry_date  TEXT,
  subtotal     REAL NOT NULL DEFAULT 0,
  tax_rate_pct REAL NOT NULL DEFAULT 15,
  tax_amount   REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON quotes(tenant_id);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id            TEXT PRIMARY KEY,
  quote_id      TEXT NOT NULL REFERENCES quotes(id),
  stock_item_id TEXT REFERENCES stock_items(id),
  description   TEXT NOT NULL,
  quantity      REAL NOT NULL,
  unit_price    REAL NOT NULL,
  line_total    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_line_items(quote_id);

CREATE TABLE IF NOT EXISTS orders (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id),
  client_id              TEXT NOT NULL REFERENCES clients(id),
  quote_id               TEXT UNIQUE REFERENCES quotes(id),
  number                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DELIVERED','COMPLETED','CANCELLED')),
  start_date             TEXT,
  delivery_date          TEXT,
  completion_date        TEXT,
  extension_status       TEXT NOT NULL DEFAULT 'NONE' CHECK (extension_status IN ('NONE','REQUESTED','APPROVED','DECLINED')),
  extension_request_date TEXT,
  extension_reason       TEXT,
  extension_requested_date TEXT,
  subtotal               REAL NOT NULL DEFAULT 0,
  tax_rate_pct           REAL NOT NULL DEFAULT 15,
  tax_amount              REAL NOT NULL DEFAULT 0,
  total                  REAL NOT NULL DEFAULT 0,
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);

CREATE TABLE IF NOT EXISTS order_line_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  stock_item_id TEXT REFERENCES stock_items(id),
  description   TEXT NOT NULL,
  quantity      REAL NOT NULL,
  unit_price    REAL NOT NULL,
  line_total    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_line_items(order_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  order_id       TEXT NOT NULL REFERENCES orders(id),
  status         TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','OUT_FOR_DELIVERY','DELIVERED','FAILED')),
  scheduled_date TEXT,
  delivered_date TEXT,
  address        TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant ON deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(order_id);

CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  client_id    TEXT NOT NULL REFERENCES clients(id),
  order_id     TEXT REFERENCES orders(id),
  number       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','PAID','PARTIALLY_PAID','OVERDUE','CANCELLED')),
  issue_date   TEXT NOT NULL DEFAULT (datetime('now')),
  due_date     TEXT,
  subtotal     REAL NOT NULL DEFAULT 0,
  tax_rate_pct REAL NOT NULL DEFAULT 15,
  tax_amount   REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL DEFAULT 0,
  amount_paid  REAL NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity    REAL NOT NULL,
  unit_price  REAL NOT NULL,
  line_total  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_line_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount     REAL NOT NULL,
  method     TEXT,
  paid_at    TEXT NOT NULL DEFAULT (datetime('now')),
  notes      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  related_type TEXT,
  related_id   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('SENT','FAILED','PREVIEW')),
  error        TEXT,
  sent_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_logs_tenant ON email_logs(tenant_id);
