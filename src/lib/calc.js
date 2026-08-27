// Shared money/line-item math used by quotes, orders and invoices.
// Kept in one place so tax/subtotal/total logic can't drift between modules.

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * lines: [{ quantity, unitPrice }]
 * Returns per-line totals plus subtotal/tax/total for the whole document.
 */
function computeTotals(lines, taxRatePct) {
  const computedLines = lines.map((l) => {
    const quantity = Number(l.quantity) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const lineTotal = round2(quantity * unitPrice);
    return { ...l, quantity, unitPrice, lineTotal };
  });
  const subtotal = round2(computedLines.reduce((sum, l) => sum + l.lineTotal, 0));
  const rate = Number(taxRatePct) || 0;
  const taxAmount = round2(subtotal * (rate / 100));
  const total = round2(subtotal + taxAmount);
  return { lines: computedLines, subtotal, taxRatePct: rate, taxAmount, total };
}

module.exports = { round2, computeTotals };
