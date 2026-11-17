import PDFDocument from 'pdfkit';

const ROW_HEIGHT = 18;
// Makes Excel open the CSV as UTF-8
const UTF8_BOM = String.fromCharCode(0xFEFF);

// Spreadsheet apps run cells that start with these characters as formulas.
const FORMULA_START = /^[=+\-@\t\r]/;

// Quotes a value only when it needs it, and stops it from being read as a formula.
function toCsvCell(value) {
    let text = value === undefined || value === null ? '' : String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ label, value: row => any }]
export function toCsv(columns, rows) {
    const lines = [columns.map(column => toCsvCell(column.label)).join(',')];
    for (const row of rows) {
        lines.push(columns.map(column => toCsvCell(column.value(row))).join(','));
    }
    return lines.join('\r\n');
}

export function sendCsv(res, filename, columns, rows) {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.status(200).send(UTF8_BOM + toCsv(columns, rows));
}

function drawRow(doc, cells, widths, bold) {
    if (doc.y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = doc.page.margins.left;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((cell, index) => {
        doc.text(String(cell ?? ''), x, y, { width: widths[index] - 6, height: ROW_HEIGHT, ellipsis: true, lineBreak: false });
        x += widths[index];
    });
    doc.x = doc.page.margins.left;
    doc.y = y + ROW_HEIGHT;
}

function drawTable(doc, { heading, columns, rows }) {
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const widths = columns.map(() => width / columns.length);

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text(heading);
    doc.moveDown(0.5);
    drawRow(doc, columns.map(column => column.label), widths, true);
    if (rows.length === 0) return drawRow(doc, ['No data'], [width], false);
    for (const row of rows) drawRow(doc, columns.map(column => column.value(row)), widths, false);
}

// tables: [{ heading, columns, rows }]
export function sendPdf(res, filename, { title, subtitle, tables }) {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.status(200);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(18).text(title);
    doc.font('Helvetica').fontSize(10).text(subtitle);
    for (const table of tables) drawTable(doc, table);

    doc.end();
}
