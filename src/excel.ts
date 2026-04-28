import ExcelJS from 'exceljs';
import { Charge, MonthInfo } from './types';
import { round2, formatMonthDE } from './utils';

export async function generateExcel(
  charges: Charge[],
  month: MonthInfo,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ladevorgänge');

  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'Ladevorgänge ID.BUZZ - OA-FX25E';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  const headers = [
    'Beginn',
    'Ende',
    'Kilometerstand',
    'Geladene Energie (kWh)',
    'EUR/kWh',
    'Kosten (EUR)',
  ];
  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  headerRow.font = { bold: true };

  const dateFormat = 'dd.mm.yyyy hh:mm';
  const numFormat = '#,##0.00';
  const dataStartRow = 3;
  let row = dataStartRow;

  for (const charge of charges) {
    const r = sheet.getRow(row);
    r.getCell(1).value = new Date(charge.created);
    r.getCell(1).numFmt = dateFormat;
    r.getCell(2).value = new Date(charge.finished);
    r.getCell(2).numFmt = dateFormat;
    if (charge.odometer !== null) {
      r.getCell(3).value = Math.round(charge.odometer);
    }
    r.getCell(4).value = round2(charge.chargedEnergy);
    r.getCell(4).numFmt = numFormat;
    r.getCell(5).value = round2(charge.pricePerKWh);
    r.getCell(5).numFmt = numFormat;
    r.getCell(6).value = round2(charge.price);
    r.getCell(6).numFmt = numFormat;
    row++;
  }

  const dataLastRow = row - 1;

  const totalRow = sheet.getRow(row);
  totalRow.getCell(3).value = `Summe ${formatMonthDE(month.key)}`;
  totalRow.getCell(4).value = {
    formula: `SUM(D${dataStartRow}:D${dataLastRow})`,
  } as ExcelJS.CellFormulaValue;
  totalRow.getCell(4).numFmt = numFormat;
  totalRow.getCell(5).value = {
    formula: `IF(D${row}<>0,F${row}/D${row},0)`,
  } as ExcelJS.CellFormulaValue;
  totalRow.getCell(5).numFmt = numFormat;
  totalRow.getCell(6).value = {
    formula: `SUM(F${dataStartRow}:F${dataLastRow})`,
  } as ExcelJS.CellFormulaValue;
  totalRow.getCell(6).numFmt = numFormat;
  totalRow.font = { bold: true };
  for (let c = 1; c <= 6; c++) {
    totalRow.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFB4C6E7' },
    };
  }

  const widths = [20, 20, 16, 22, 12, 14];
  sheet.columns.forEach((col, i) => {
    col.width = widths[i] ?? 14;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
