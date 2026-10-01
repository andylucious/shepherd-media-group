// A4 PDFs for receipts and reports (quotes and invoices live in pdf.js).
const PDFDocument = require('pdfkit');
const path = require('path');

const BLUE = '#1f4ca3';
const RED = '#e4471b';
const INK = '#1c2333';
const MUTED = '#667085';
const LINE = '#e3e8f0';
const LOGO = path.join(__dirname, '..', 'public', 'img', 'logo.png');
const W = 595.28;
const H = 841.89;
const M = 40;

const money = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function start(res, filename, title, inline) {
  const pdf = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: title } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}.pdf"`);
  pdf.pipe(res);
  return pdf;
}

function bars(pdf) {
  pdf.rect(0, 0, W, 8).fill(BLUE);
  pdf.rect(W * 0.6, 0, W * 0.4, 8).fill(RED);
}

function footers(pdf, s) {
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    pdf.rect(0, H - 34, W, 34).fill(BLUE);
    pdf.rect(W * 0.6, H - 34, W * 0.4, 34).fill(RED);
    pdf.fillColor('#fff').font('Helvetica').fontSize(8.5)
      .text(`${s.company_name}  |  ${s.phone}  |  ${s.email}`, M, H - 22, { width: W - 2 * M - 70, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, W - M - 70, H - 22, { width: 70, align: 'right', lineBreak: false });
  }
}

// ---------------------------------------------------------------- receipt
// r: { number, paid_at, client_name, phone, invoice_number, package_name, event_type, event_date, amount, method, reference,
//      total, paid_to_date, balance }
function receipt(res, r, s, inline) {
  const pdf = start(res, `Receipt-${r.number}`, `Receipt ${r.number}`, inline);
  bars(pdf);
  try { pdf.image(LOGO, 44, 30, { width: 88 }); } catch (e) { /* optional */ }
  pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(17).text(s.company_name, 144, 38, { width: 230 });
  pdf.fillColor(RED).font('Helvetica-Oblique').fontSize(9).text(s.tagline || '', 144, 60, { width: 230 });
  pdf.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Tel / WhatsApp: ${s.phone}`, 144, 76).text(`Email: ${s.email}`, 144, 89).text(s.address || '', 144, 102);

  pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(26).text('RECEIPT', 340, 34, { width: W - 44 - 340, align: 'right' });
  pdf.fillColor(INK).font('Helvetica').fontSize(10)
    .text(`No: ${r.number}`, 340, 70, { width: W - 44 - 340, align: 'right' })
    .text(`Date: ${String(r.paid_at).slice(0, 10)}`, 340, 84, { width: W - 44 - 340, align: 'right' });
  pdf.moveTo(44, 134).lineTo(W - 44, 134).lineWidth(1).strokeColor(LINE).stroke();

  let y = 152;
  pdf.fillColor(RED).font('Helvetica-Bold').fontSize(9).text('RECEIVED FROM', 44, y);
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(r.client_name, 44, y + 14);
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED).text(r.phone || '', 44, y + 33);
  pdf.fillColor(RED).font('Helvetica-Bold').fontSize(9).text('FOR', 320, y);
  pdf.fillColor(INK).font('Helvetica').fontSize(10)
    .text(`Invoice: ${r.invoice_number}`, 320, y + 14)
    .text(`${r.package_name}`, 320, y + 28, { width: W - 44 - 320 })
    .text(`Event: ${r.event_type || '-'}  ${r.event_date || ''}`, 320, y + 56);

  y = 260;
  pdf.roundedRect(44, y, W - 88, 90, 10).fill('#f1f5fc');
  pdf.fillColor(MUTED).font('Helvetica').fontSize(10).text('AMOUNT RECEIVED', 64, y + 16);
  pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(28).text(money(r.amount), 64, y + 34);
  pdf.fillColor(MUTED).font('Helvetica').fontSize(10)
    .text(`Method: ${r.method}`, 360, y + 18, { width: W - 44 - 380 })
    .text(`Reference: ${r.reference || '-'}`, 360, y + 34, { width: W - 44 - 380 });

  y = 380;
  const row = (label, value, bold) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(bold ? INK : MUTED).text(label, 64, y);
    pdf.fillColor(INK).text(value, 64, y, { width: W - 128, align: 'right' });
    y += 24;
    pdf.moveTo(64, y - 6).lineTo(W - 64, y - 6).lineWidth(0.6).strokeColor(LINE).stroke();
  };
  row('Invoice total', money(r.total));
  row('Total paid to date (including this payment)', money(r.paid_to_date));
  row('Balance remaining', money(r.balance), true);

  if (r.balance <= 0.005) {
    pdf.save().rotate(-12, { origin: [W / 2, 540] });
    pdf.roundedRect(W / 2 - 110, 515, 220, 50, 8).lineWidth(3).strokeColor('#2fa866').stroke();
    pdf.fillColor('#2fa866').font('Helvetica-Bold').fontSize(24).text('PAID IN FULL', W / 2 - 110, 528, { width: 220, align: 'center' });
    pdf.restore();
  } else {
    pdf.fillColor(MUTED).font('Helvetica').fontSize(10).text('This is a receipt for a part payment. The balance is still due.', 64, 520, { width: W - 128, align: 'center' });
  }
  pdf.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10).text('Thank you for choosing Shepherd Media Group.', 44, 640, { width: W - 88, align: 'center' });
  footers(pdf, s);
  pdf.end();
}

// ---------------------------------------------------------------- reports
// rep: { filename, title, subtitle, summary: [[label, value]], sections: [{ title, columns:[{h, w, align, money}], rows:[[...]], total:[...]|null, empty }] }
function report(res, rep, s, inline) {
  const pdf = start(res, rep.filename, rep.title, inline);
  const innerW = W - 2 * M;
  const bottom = H - 56;

  const pageTop = (first) => {
    bars(pdf);
    if (first) {
      try { pdf.image(LOGO, M, 22, { width: 70 }); } catch (e) { /* optional */ }
      pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(18).text(rep.title, M + 84, 28, { width: innerW - 84 });
      pdf.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(rep.subtitle || '', M + 84, 52, { width: innerW - 84 })
        .text(`Prepared ${new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi' })} · ${s.company_name} · Amounts in KES`, M + 84, 66, { width: innerW - 84 });
      return 98;
    }
    pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(`${rep.title} (continued)`, M, 22);
    return 40;
  };

  let y = pageTop(true);
  const ensure = (need) => { if (y + need > bottom) { pdf.addPage(); y = pageTop(false); return true; } return false; };

  // summary tiles, up to 4 per row
  if (rep.summary && rep.summary.length) {
    const per = Math.min(4, rep.summary.length);
    const gap = 10;
    const tw = (innerW - gap * (per - 1)) / per;
    rep.summary.forEach(([label, value], i) => {
      if (i && i % per === 0) y += 62;
      const x = M + (i % per) * (tw + gap);
      pdf.roundedRect(x, y, tw, 52, 8).fill('#f1f5fc');
      pdf.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), x + 10, y + 9, { width: tw - 20 });
      pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(tw < 110 ? 11 : 13).text(value, x + 10, y + 26, { width: tw - 20 });
    });
    y += 72;
  }

  for (const sec of rep.sections || []) {
    ensure(70);
    pdf.fillColor(RED).font('Helvetica-Bold').fontSize(10.5).text(sec.title.toUpperCase(), M, y);
    y += 18;
    const cols = sec.columns;
    const sum = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / sum) * innerW);
    const header = () => {
      pdf.rect(M, y, innerW, 20).fill(BLUE);
      let x = M;
      cols.forEach((c, i) => {
        pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(c.h, x + 5, y + 6, { width: widths[i] - 10, align: c.align || (c.money ? 'right' : 'left'), lineBreak: false });
        x += widths[i];
      });
      y += 20;
    };
    header();
    if (!sec.rows.length) {
      pdf.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(sec.empty || 'Nothing to show for this period.', M + 5, y + 8);
      y += 30;
      continue;
    }
    sec.rows.forEach((r, ri) => {
      // measure row height from the tallest cell
      pdf.font('Helvetica').fontSize(8.5);
      const cells = r.map((v, i) => (cols[i].money ? short(v) : String(v ?? '')));
      const h = Math.max(...cells.map((t, i) => pdf.heightOfString(t, { width: widths[i] - 10 }))) + 10;
      if (y + h > bottom) { pdf.addPage(); y = pageTop(false); header(); }
      if (ri % 2) pdf.rect(M, y, innerW, h).fill('#f7f9fd');
      let x = M;
      cells.forEach((t, i) => {
        pdf.fillColor(INK).font('Helvetica').fontSize(8.5).text(t, x + 5, y + 5, { width: widths[i] - 10, align: cols[i].align || (cols[i].money ? 'right' : 'left') });
        x += widths[i];
      });
      y += h;
      pdf.moveTo(M, y).lineTo(M + innerW, y).lineWidth(0.4).strokeColor(LINE).stroke();
    });
    if (sec.total) {
      ensure(24);
      pdf.rect(M, y, innerW, 22).fill('#e8eefb');
      let x = M;
      sec.total.forEach((v, i) => {
        const t = v === null || v === undefined ? '' : cols[i].money && typeof v === 'number' ? short(v) : String(v);
        pdf.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(t, x + 5, y + 7, { width: widths[i] - 10, align: cols[i].align || (cols[i].money ? 'right' : 'left'), lineBreak: false });
        x += widths[i];
      });
      y += 22;
    }
    y += 22;
  }
  footers(pdf, s);
  pdf.end();
}

module.exports = { receipt, report, money };
