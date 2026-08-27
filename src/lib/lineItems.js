// Parses the parallel-array line-item fields submitted by the dynamic
// line-item form (see public/js/app.js) into a clean array, dropping any
// blank rows.

function parseLineItemsFromBody(body) {
  const descriptions = [].concat(body.description || []);
  const quantities = [].concat(body.quantity || []);
  const unitPrices = [].concat(body.unitPrice || []);
  const stockItemIds = [].concat(body.stockItemId || []);

  const lines = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    const description = (descriptions[i] || '').trim();
    const quantity = Number(quantities[i]);
    const unitPrice = Number(unitPrices[i]);
    if (!description || !quantity) continue;
    lines.push({
      description,
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      stockItemId: stockItemIds[i] || null,
    });
  }
  return lines;
}

module.exports = { parseLineItemsFromBody };
