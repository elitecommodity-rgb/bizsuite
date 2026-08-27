const { get } = require('../db');

/**
 * Generates the next sequential document number for a tenant, e.g. Q-0007.
 * Scans the max existing number for that prefix rather than keeping a
 * separate counter table, which is simple and correct for prototype-scale
 * concurrency (single writer, low volume).
 */
function nextNumber(tenantId, table, prefix) {
  const row = get(
    `SELECT number FROM ${table} WHERE tenant_id = ? AND number LIKE ? ORDER BY LENGTH(number) DESC, number DESC LIMIT 1`,
    [tenantId, `${prefix}-%`]
  );
  let next = 1;
  if (row && row.number) {
    const match = row.number.match(/(\d+)$/);
    if (match) next = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

module.exports = { nextNumber };
