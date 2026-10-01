const db = require('./db');

// Builds the numbers shown on a receipt for one payment (totals as at that payment).
async function receiptData(pay) {
  const inv = await db.one('SELECT * FROM invoices WHERE id=?', [pay.invoice_id]);
  if (!inv) return null;
  const { s: toDate } = await db.one('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=? AND id<=?', [pay.invoice_id, pay.id]);
  const total = inv.amount - inv.discount;
  return {
    number: pay.receipt_number, paid_at: pay.paid_at, client_name: inv.client_name, phone: inv.phone,
    invoice_number: inv.number, package_name: inv.package_name, event_type: inv.event_type, event_date: inv.event_date,
    amount: pay.amount, method: pay.method, reference: pay.reference, total, paid_to_date: toDate, balance: Math.max(total - toDate, 0),
  };
}

module.exports = { receiptData };
