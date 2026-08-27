// Dynamic line-item rows for quote / order / invoice forms.
// Each row: description, quantity, unitPrice, optional stockItemId (data attr
// picks price+name from the stock catalog passed in via window.STOCK_ITEMS).

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initLineItems(tableBodyId, addBtnId) {
  const tbody = document.getElementById(tableBodyId);
  const addBtn = document.getElementById(addBtnId);
  if (!tbody || !addBtn) return;

  function recalcTotals() {
    let subtotal = 0;
    tbody.querySelectorAll('tr').forEach((row) => {
      const qty = parseFloat(row.querySelector('.li-qty').value) || 0;
      const price = parseFloat(row.querySelector('.li-price').value) || 0;
      const lineTotal = qty * price;
      row.querySelector('.li-total').textContent = lineTotal.toFixed(2);
      subtotal += lineTotal;
    });
    const taxRate = parseFloat(document.getElementById('taxRatePct')?.value) || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;
    const subEl = document.getElementById('calc-subtotal');
    const taxEl = document.getElementById('calc-tax');
    const totEl = document.getElementById('calc-total');
    if (subEl) subEl.textContent = subtotal.toFixed(2);
    if (taxEl) taxEl.textContent = taxAmount.toFixed(2);
    if (totEl) totEl.textContent = total.toFixed(2);
  }

  function addRow(prefill) {
    const row = document.createElement('tr');
    const stockOptions = (window.STOCK_ITEMS || [])
      .map((s) => `<option value="${escapeHtml(s.id)}" data-price="${escapeHtml(s.unit_price)}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
      .join('');
    row.innerHTML = `
      <td style="min-width:160px;">
        <select class="li-stock">
          <option value="">— custom line —</option>
          ${stockOptions}
        </select>
      </td>
      <td style="min-width:180px;"><input type="text" class="li-desc" name="description" placeholder="Description" required /></td>
      <td style="width:90px;"><input type="number" step="any" min="0" class="li-qty" name="quantity" value="1" required /></td>
      <td style="width:110px;"><input type="number" step="0.01" min="0" class="li-price" name="unitPrice" value="0" required /></td>
      <td style="width:90px;" class="right li-total">0.00</td>
      <td style="width:36px;"><button type="button" class="link-btn li-remove">✕</button></td>
      <input type="hidden" class="li-stockid" name="stockItemId" value="" />
    `;
    tbody.appendChild(row);

    const stockSelect = row.querySelector('.li-stock');
    const descInput = row.querySelector('.li-desc');
    const priceInput = row.querySelector('.li-price');
    const qtyInput = row.querySelector('.li-qty');
    const stockIdInput = row.querySelector('.li-stockid');

    stockSelect.addEventListener('change', () => {
      const opt = stockSelect.selectedOptions[0];
      if (opt && opt.value) {
        descInput.value = opt.dataset.name;
        priceInput.value = opt.dataset.price;
        stockIdInput.value = opt.value;
      } else {
        stockIdInput.value = '';
      }
      recalcTotals();
    });
    [descInput, priceInput, qtyInput].forEach((el) => el.addEventListener('input', recalcTotals));
    row.querySelector('.li-remove').addEventListener('click', () => {
      row.remove();
      recalcTotals();
    });

    if (prefill) {
      descInput.value = prefill.description || '';
      qtyInput.value = prefill.quantity != null ? prefill.quantity : 1;
      priceInput.value = prefill.unitPrice != null ? prefill.unitPrice : 0;
      if (prefill.stockItemId) {
        stockIdInput.value = prefill.stockItemId;
        stockSelect.value = prefill.stockItemId;
      }
    }
    recalcTotals();
  }

  addBtn.addEventListener('click', () => addRow());
  document.getElementById('taxRatePct')?.addEventListener('input', recalcTotals);

  const initial = window.INITIAL_LINES || [];
  if (initial.length) {
    initial.forEach((l) => addRow(l));
  } else {
    addRow();
  }
}
