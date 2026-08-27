// Computes [startISO, endISO) date ranges for the BI report periods.
// All dates are local-server-time day boundaries, formatted as
// SQLite-comparable 'YYYY-MM-DD HH:MM:SS' strings.

function fmt(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // week starts Monday
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function getRange(period) {
  const now = new Date();
  let start;
  switch (period) {
    case 'week':
      start = startOfWeek(now);
      break;
    case 'month':
      start = startOfMonth(now);
      break;
    case 'quarter':
      start = startOfQuarter(now);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'today':
    default:
      start = startOfDay(now);
  }
  return { startISO: fmt(start), endISO: fmt(now), label: period || 'today' };
}

module.exports = { getRange, startOfDay, startOfWeek, startOfMonth, startOfQuarter };
