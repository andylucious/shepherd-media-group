const PDFDocument = require('pdfkit');
const path = require('path');

const BLUE = '#1f4ca3';
const RED = '#e4471b';
const INK = '#1c2333';
const MUTED = '#667085';
const LOGO = path.join(__dirname, '..', 'public', 'img', 'logo.jpg');

const money = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lines = (t) => String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// kind: 'QUOTATION' | 'INVOICE'
function build(res, filename, kind, doc, s) {
  const pdf = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${kind} ${doc.number}`, Author: s.company_name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  pdf.pipe(res);

  const W = 595.28;
  const H = 841.89;
  const M = 44;

  // top colour bar
  pdf.rect(0, 0, W, 8).fill(BLUE);
  pdf.rect(W * 0.6, 0, W * 0.4, 8).fill(RED);

  // header: logo + company
  try { pdf.image(LOGO, M, 28, { width: 84 }); } catch (e) { /* logo optional */ }
  pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(17).text(s.company_name, M + 100, 36, { width: 250 });
  pdf.fillColor(RED).font('Helvetica-Oblique').fontSize(9).text(s.tagline || '', M + 100, 58, { width: 250 });
  pdf.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text(`Tel / WhatsApp: ${s.phone}`, M + 100, 74)
    .text(`Email: ${s.email}`, M + 100, 87)
    .text(s.address || '', M + 100, 100);

  // document title block
  pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(26).text(kind, 340, 34, { width: W - M - 340, align: 'right' });
  pdf.fillColor(INK).font('Helvetica').fontSize(10)
    .text(`No: ${doc.number}`, 340, 70, { width: W - M - 340, align: 'right' })
    .text(`Date: ${String(doc.created_at).slice(0, 10)}`, 340, 84, { width: W - M - 340, align: 'right' });
  if (kind === 'INVOICE' && doc.due_date)
    pdf.text(`Due: ${doc.due_date}`, 340, 98, { width: W - M - 340, align: 'right' });

  pdf.moveTo(M, 132).lineTo(W - M, 132).lineWidth(1).strokeColor('#e3e8f0').stroke();

  // client + event boxes
  let y = 148;
  pdf.fillColor(RED).font('Helvetica-Bold').fontSize(9).text(kind === 'INVOICE' ? 'BILL TO' : 'PREPARED FOR', M, y);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(doc.client_name, M, y + 14);
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(doc.phone || '', M, y + 32)
    .text(doc.email || '', M, y + 45);

  pdf.fillColor(RED).font('Helvetica-Bold').fontSize(9).text('EVENT', 320, y);
  pdf.fillColor(INK).font('Helvetica').fontSize(10)
    .text(`Type: ${doc.event_type || '-'}`, 320, y + 14)
    .text(`Date: ${doc.event_date || 'To be confirmed'}`, 320, y + 28)
    .text(`Venue: ${doc.venue || 'To be confirmed'}`, 320, y + 42, { width: W - M - 320 });

  // package heading bar
  y = 236;
  pdf.rect(M, y, W - 2 * M, 28).fill(BLUE);
  pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('DESCRIPTION', M + 12, y + 9);
  pdf.text('AMOUNT', M, y + 9, { width: W - 2 * M - 12, align: 'right' });

  y += 40;
  const price = Number(doc.price ?? doc.amount ?? 0);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(doc.package_name, M + 12, y, { width: 340 });
  pdf.text(money(price), M, y, { width: W - 2 * M - 12, align: 'right' });
  y += 24;
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(RED).text('THIS PACKAGE INCLUDES', M + 12, y);
  y += 16;
  pdf.font('Helvetica').fontSize(10).fillColor(INK);
  for (const item of lines(doc.items)) {
    if (y > H - 250) break;
    pdf.fillColor(RED).circle(M + 16, y + 5, 2.2).fill();
    pdf.fillColor(INK).text(item, M + 28, y, { width: 380 });
    y += pdf.heightOfString(item, { width: 380 }) + 5;
  }

  // totals
  y = Math.max(y + 12, 560);
  const discount = Number(doc.discount || 0);
  const total = price - discount;
  const tx = 330;
  const tw = W - M - tx;
  pdf.moveTo(M, y - 8).lineTo(W - M, y - 8).lineWidth(1).strokeColor('#e3e8f0').stroke();
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED).text('Subtotal', tx, y).fillColor(INK).text(money(price), tx, y, { width: tw, align: 'right' });
  y += 18;
  if (discount) {
    pdf.fillColor(MUTED).text('Discount', tx, y).fillColor(INK).text('- ' + money(discount), tx, y, { width: tw, align: 'right' });
    y += 18;
  }
  pdf.rect(tx - 10, y - 4, tw + 10, 30).fill(RED);
  pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('TOTAL', tx, y + 5).text(money(total), tx, y + 5, { width: tw - 8, align: 'right' });
  y += 40;
  if (kind === 'INVOICE') {
    const paid = Number(doc.paid || 0);
    pdf.font('Helvetica').fontSize(10).fillColor(MUTED).text('Amount paid', tx, y).fillColor(INK).text(money(paid), tx, y, { width: tw, align: 'right' });
    y += 18;
    pdf.font('Helvetica-Bold').fillColor(BLUE).text('Balance due', tx, y).text(money(Math.max(total - paid, 0)), tx, y, { width: tw, align: 'right' });
  } else {
    pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text('A 50% deposit secures your date.', tx - 10, y, { width: tw + 10, align: 'right' });
  }

  // notes / terms (left)
  let ny = Math.max(y - 90, 560);
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text(kind === 'INVOICE' ? 'PAYMENT DETAILS' : 'TERMS', M, ny);
  pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text(kind === 'INVOICE' ? s.payment_details : s.quote_terms, M, ny + 13, { width: 250 });
  if (doc.notes) {
    ny = pdf.y + 10;
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('NOTES', M, ny);
    pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text(doc.notes, M, ny + 13, { width: 250 });
  }

  // footer
  pdf.rect(0, H - 46, W, 46).fill(BLUE);
  pdf.rect(W * 0.6, H - 46, W * 0.4, 46).fill(RED);
  pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
    .text(`${s.company_name}  |  ${s.phone}  |  ${s.email}`, 0, H - 30, { width: W, align: 'center' });

  pdf.end();
}

module.exports = {
  quote: (res, q, s) => build(res, `Quotation-${q.number}`, 'QUOTATION', q, s),
  invoice: (res, i, s) => build(res, `Invoice-${i.number}`, 'INVOICE', i, s),
};
