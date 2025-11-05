import XLSX from 'xlsx';
import { existsSync } from 'fs';
import { join } from 'path';

export interface PlotData {
  plotNumber: string;
  rowIndex: number;
}

export class ExcelReader {
  static readPlotNumbers(filePath: string, columnIndex?: number): PlotData[] {
    console.log(`Reading Excel file from: ${filePath}`);

    if (!existsSync(filePath)) {
      throw new Error(`Excel file not found at: ${filePath}`);
    }

    console.log('✓ File exists, loading workbook...');

    let workbook;
    try {
      workbook = XLSX.readFile(filePath);
    } catch (error) {
      throw new Error(`Failed to read Excel file: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`✓ Workbook loaded, available sheets: ${workbook.SheetNames.join(', ')}`);

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length === 0) {
      throw new Error('Excel file is empty');
    }

    console.log(`✓ Loaded ${data.length} rows from Excel`);

    const headerRow = data[0];
    console.log(`Header row: ${JSON.stringify(headerRow)}`);

    let plotIdColumnIndex: number;

    if (columnIndex !== undefined) {
      plotIdColumnIndex = columnIndex;
      console.log(`✓ Using specified column index ${plotIdColumnIndex}`);
    } else {
      plotIdColumnIndex = headerRow.findIndex((header: string) =>
        header && header.toString().toLowerCase().includes('plot id')
      );

      if (plotIdColumnIndex === -1) {
        throw new Error(`Could not find "Plot Id" column in Excel file. Available columns: ${headerRow.join(', ')}`);
      }

      console.log(`✓ Found "Plot Id" column at index ${plotIdColumnIndex}`);
    }

    const plots: PlotData[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row && row[plotIdColumnIndex]) {
        const plotNumber = row[plotIdColumnIndex].toString().trim();
        if (plotNumber) {
          plots.push({
            plotNumber,
            rowIndex: i + 1,
          });
        }
      }
    }

    console.log(`✓ Loaded ${plots.length} plot numbers from Excel file`);
    return plots;
  }

  static getExcelFilePath(): string {
    const dataDir = join(process.cwd(), 'data');
    return join(dataDir, 'units.xlsx');
  }
}
