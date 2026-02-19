import ExcelJS from 'exceljs';
import { Charge } from './types';
import { round2, formatMonthDE } from './utils';

export async function generateExcel(
  chargesByMonth: Map<string, Charge[]>,
  monthKeys: string[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ladevorgänge');

  // Titelzeile (merged über alle Spalten)
  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'Ladevorgänge ID.BUZZ - OA-FX25E';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  // Kopfzeile
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

  let row = 3;
  const monthSumRows: number[] = [];
  const dateFormat = 'dd.mm.yyyy hh:mm';
  const numFormat = '#,##0.00';

  for (const monthKey of monthKeys) {
    const charges = chargesByMonth.get(monthKey);
    if (!charges) continue;

    const monthStartRow = row;

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

    const monthLastRow = row - 1;
    const monthLabel = formatMonthDE(monthKey);

    // Monatssumme mit Formeln
    const sumRow = sheet.getRow(row);
    sumRow.getCell(3).value = `Summe ${monthLabel}`;
    sumRow.getCell(4).value = {
      formula: `SUM(D${monthStartRow}:D${monthLastRow})`,
    } as ExcelJS.CellFormulaValue;
    sumRow.getCell(4).numFmt = numFormat;
    sumRow.getCell(5).value = {
      formula: `IF(D${row}<>0,F${row}/D${row},0)`,
    } as ExcelJS.CellFormulaValue;
    sumRow.getCell(5).numFmt = numFormat;
    sumRow.getCell(6).value = {
      formula: `SUM(F${monthStartRow}:F${monthLastRow})`,
    } as ExcelJS.CellFormulaValue;
    sumRow.getCell(6).numFmt = numFormat;

    sumRow.font = { bold: true };
    for (let c = 1; c <= 6; c++) {
      sumRow.getCell(c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };
    }

    monthSumRows.push(row);
    row++;
  }

  // Gesamtsumme
  const totalRow = sheet.getRow(row);
  totalRow.getCell(3).value = 'GESAMTSUMME';

  if (monthSumRows.length === 1) {
    totalRow.getCell(4).value = {
      formula: `D${monthSumRows[0]}`,
    } as ExcelJS.CellFormulaValue;
    totalRow.getCell(6).value = {
      formula: `F${monthSumRows[0]}`,
    } as ExcelJS.CellFormulaValue;
  } else {
    const sumRefsD = monthSumRows.map((r) => `D${r}`).join(',');
    const sumRefsF = monthSumRows.map((r) => `F${r}`).join(',');
    totalRow.getCell(4).value = {
      formula: `SUM(${sumRefsD})`,
    } as ExcelJS.CellFormulaValue;
    totalRow.getCell(6).value = {
      formula: `SUM(${sumRefsF})`,
    } as ExcelJS.CellFormulaValue;
  }
  totalRow.getCell(5).value = {
    formula: `IF(D${row}<>0,F${row}/D${row},0)`,
  } as ExcelJS.CellFormulaValue;

  for (const c of [4, 5, 6]) {
    totalRow.getCell(c).numFmt = numFormat;
  }
  totalRow.font = { bold: true };
  for (let c = 1; c <= 6; c++) {
    totalRow.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFB4C6E7' },
    };
  }

  // Spaltenbreiten
  const widths = [20, 20, 16, 22, 12, 14];
  sheet.columns.forEach((col, i) => {
    col.width = widths[i] ?? 14;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
