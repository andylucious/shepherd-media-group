// Data helpers for contractors (freelance photographers, videographers, editors...).
// Each job assignment creates a payable, so the existing partial-payment and "money owed" tools handle what we owe them.
const db = require('./db');

// One row per contractor: jobs, total fees agreed, paid so far, still owed
const contractorTotals = (where = '', params = []) => db.q(`
  SELECT c.id, c.name, c.role, c.phone, c.email, c.rate, c.notes, c.active,
    COUNT(a.id) AS jobs, COALESCE(SUM(p.amount),0) AS fees, COALESCE(SUM(p.paid),0) AS paid,
    COALESCE(SUM(p.amount - p.paid),0) AS owed
  FROM contractors c
  LEFT JOIN assignments a ON a.contractor_id = c.id
  LEFT JOIN payables p ON p.id = a.payable_id
  ${where} GROUP BY c.id ORDER BY c.active DESC, c.name`, params);

// Jobs given to contractors, with the matching invoice (booking) and bill
const assignmentRows = (where = '', params = []) => db.q(`
  SELECT a.id, a.contractor_id, a.invoice_id, a.job, a.role, a.event_date, a.payable_id, a.created_at,
    c.name AS contractor, c.phone AS contractor_phone,
    i.number AS invoice_number, i.client_name, i.venue,
    p.amount AS fee, p.paid, p.status, p.due_date
  FROM assignments a
  JOIN contractors c ON c.id = a.contractor_id
  LEFT JOIN invoices i ON i.id = a.invoice_id
  LEFT JOIN payables p ON p.id = a.payable_id
  ${where} ORDER BY a.id DESC`, params);

module.exports = { contractorTotals, assignmentRows };
