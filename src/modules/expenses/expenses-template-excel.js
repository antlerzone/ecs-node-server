/**
 * Generate Bulk Expenses Template Excel (same structure as htmldownloadtemplate iframe).
 * Returns Buffer. Used by POST /api/expenses/bulk-template-file.
 */

const ExcelJS = require('exceljs');
const { getExpensesFilters } = require('./expenses.service');
const pool = require('../../config/db');

async function getClientCurrency(clientId) {
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  return (rows[0] && rows[0].currency) ? String(rows[0].currency).toUpperCase() : 'MYR';
}

/**
 * @param {string} clientId
 * @returns {Promise<Buffer>}
 */
async function generateBulkTemplateExcel(clientId) {
  const filters = await getExpensesFilters(clientId);
  const properties = filters.properties || [];
  const suppliers = filters.suppliers || [];
  const currency = await getClientCurrency(clientId);

  const workbook = new ExcelJS.Workbook();

  const supplierSheet = workbook.addWorksheet('Supplier');
  supplierSheet.columns = [
    { header: 'Supplier', key: 'title', width: 30 },
    { header: 'Id', key: 'id', width: 40 }
  ];
  suppliers.forEach(s => {
    supplierSheet.addRow({ title: s.title || '', id: s.id || '' });
  });

  const propertySheet = workbook.addWorksheet('Property');
  propertySheet.columns = [
    { header: 'Property', key: 'shortname', width: 30 },
    { header: 'Id', key: 'id', width: 40 }
  ];
  properties.forEach(p => {
    propertySheet.addRow({ shortname: p.label || '', id: p.value || '' });
  });

  const expenseSheet = workbook.addWorksheet('Expenses');
  expenseSheet.columns = [
    { header: 'Property', key: 'property', width: 30 },
    { header: 'Supplier', key: 'supplier', width: 30 },
    { header: 'Description', key: 'description', width: 40 },
    { header: `Amount (${currency})`, key: 'amount', width: 20 },
    { header: 'Period', key: 'period', width: 20 }
  ];
  expenseSheet.views = [{ state: 'frozen', ySplit: 1 }];
  expenseSheet.addRow({
    property: '',
    supplier: '',
    description: 'Sample Expense',
    amount: 100,
    period: new Date()
  });

  const supplierRange = `Supplier!$A$2:$A$${Math.max(2, suppliers.length + 1)}`;
  const propertyRange = `Property!$A$2:$A$${Math.max(2, properties.length + 1)}`;

  for (let i = 2; i <= 500; i++) {
    try {
      expenseSheet.getCell(`A${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [propertyRange]
      };
      expenseSheet.getCell(`B${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [supplierRange]
      };
      expenseSheet.getCell(`D${i}`).numFmt = '0.00';
      expenseSheet.getCell(`E${i}`).numFmt = 'dd/mm/yyyy';
    } catch (_) {}
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateBulkTemplateExcel, getClientCurrency };
