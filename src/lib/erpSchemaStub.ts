// =============================================================================
// ERP Schema Stub Builder
//
// For MVP, no real ERP connections exist. This module builds a SchemaMetadata
// object per ERP type using mock data. When real connectors ship (via BFF),
// this module gets replaced by actual schema extraction.
// =============================================================================

import type { SchemaMetadata, TableMetadata, ColumnMetadata, ErpType } from 'schema-discovery/src/types/schema-metadata'
import type { ERPType } from '@/types'

/**
 * Builds a SchemaMetadata object for the given ERP type.
 * SAP variants use the rich 60-table mock schema; other ERPs get a minimal
 * schema from known module names.
 */
export async function buildErpSchema(erpType: ERPType): Promise<SchemaMetadata> {
  switch (erpType) {
    case 'sap_s4hana_cloud':
    case 'sap_s4hana_onprem':
    case 'sap_ecc': {
      // Lazy-import the mock SAP schema to avoid bundle bloat on the flat file path.
      // Filter to only FX-relevant tables to keep LLM calls manageable in the browser.
      // The full 60-table schema is available for server-side pipeline runs.
      const { generateMockSapSchema, FX_RELEVANT_TABLES } = await import(
        'schema-discovery/src/test/fixtures/mock-sap-schema'
      )
      const fullSchema = generateMockSapSchema()
      const fxTableNames = new Set(FX_RELEVANT_TABLES)
      return {
        ...fullSchema,
        tables: fullSchema.tables.filter((t: { name: string }) => fxTableNames.has(t.name)),
      }
    }

    case 'netsuite':
      return buildMinimalSchema('netsuite' as ErpType, 'SuiteQL', [
        buildStubTable('TRANSACTION', ['TRANID', 'TRANDATE', 'TYPE', 'STATUS', 'ENTITY', 'CURRENCY', 'AMOUNT', 'EXCHANGERATE', 'SUBSIDIARY', 'MEMO', 'DUEDATE']),
        buildStubTable('TRANSACTIONLINE', ['TRANSACTION', 'LINESEQUENCENUMBER', 'ITEM', 'AMOUNT', 'FOREIGNAMOUNT', 'CURRENCY', 'ACCOUNT', 'DEPARTMENT', 'CLASS']),
        buildStubTable('SUBSIDIARY', ['ID', 'NAME', 'CURRENCY', 'COUNTRY', 'ISELIMINATION', 'PARENT']),
        buildStubTable('VENDOR', ['ID', 'ENTITYID', 'COMPANYNAME', 'CURRENCY', 'COUNTRY']),
        buildStubTable('CUSTOMER', ['ID', 'ENTITYID', 'COMPANYNAME', 'CURRENCY', 'COUNTRY']),
        buildStubTable('ACCOUNT', ['ID', 'ACCTNUMBER', 'ACCTNAME', 'ACCTTYPE', 'CURRENCY']),
      ])

    case 'oracle_cloud_erp':
    case 'oracle_ebs':
      return buildMinimalSchema('oracle' as ErpType, 'Oracle ERP', [
        buildStubTable('AP_INVOICES_ALL', ['INVOICE_ID', 'VENDOR_ID', 'INVOICE_NUM', 'INVOICE_DATE', 'INVOICE_AMOUNT', 'INVOICE_CURRENCY_CODE', 'PAYMENT_CROSS_RATE', 'PAYMENT_STATUS_FLAG', 'DUE_DATE', 'ORG_ID']),
        buildStubTable('AP_INVOICE_LINES_ALL', ['INVOICE_ID', 'LINE_NUMBER', 'AMOUNT', 'DESCRIPTION', 'ORG_ID']),
        buildStubTable('AR_PAYMENT_SCHEDULES_ALL', ['PAYMENT_SCHEDULE_ID', 'CUSTOMER_ID', 'INVOICE_CURRENCY_CODE', 'AMOUNT_DUE_ORIGINAL', 'AMOUNT_DUE_REMAINING', 'DUE_DATE', 'STATUS', 'ORG_ID']),
        buildStubTable('GL_JE_LINES', ['JE_HEADER_ID', 'JE_LINE_NUM', 'LEDGER_ID', 'CODE_COMBINATION_ID', 'ENTERED_DR', 'ENTERED_CR', 'CURRENCY_CODE', 'EFFECTIVE_DATE']),
        buildStubTable('HR_OPERATING_UNITS', ['ORGANIZATION_ID', 'NAME', 'DEFAULT_LEGAL_CONTEXT_ID']),
      ])

    case 'dynamics_365':
      return buildMinimalSchema('dynamics' as ErpType, 'D365 F&O', [
        buildStubTable('VendInvoiceJour', ['InvoiceId', 'InvoiceDate', 'InvoiceAmount', 'CurrencyCode', 'VendAccount', 'DueDate', 'DataAreaId', 'LedgerVoucher']),
        buildStubTable('CustInvoiceJour', ['InvoiceId', 'InvoiceDate', 'InvoiceAmount', 'CurrencyCode', 'InvoiceAccount', 'DueDate', 'DataAreaId']),
        buildStubTable('LedgerJournalTrans', ['JournalNum', 'Voucher', 'TransDate', 'AmountCurDebit', 'AmountCurCredit', 'CurrencyCode', 'AccountNum', 'Company']),
        buildStubTable('CompanyInfo', ['DataArea', 'Name', 'CurrencyCode', 'CountryRegionId']),
      ])

    case 'workday':
      return buildMinimalSchema('workday' as ErpType, 'Workday Financials', [
        buildStubTable('Supplier_Invoice', ['Invoice_Number', 'Supplier', 'Invoice_Date', 'Due_Date', 'Total_Amount', 'Currency', 'Company', 'Status']),
        buildStubTable('Customer_Invoice', ['Invoice_Number', 'Customer', 'Invoice_Date', 'Due_Date', 'Total_Amount', 'Currency', 'Company', 'Status']),
        buildStubTable('Journal_Entry', ['Journal_Number', 'Ledger_Account', 'Debit_Amount', 'Credit_Amount', 'Currency', 'Accounting_Date', 'Company']),
        buildStubTable('Company', ['Company_ID', 'Company_Name', 'Currency_Code', 'Country']),
      ])

    default:
      return buildMinimalSchema('unknown' as ErpType, 'Custom API', [
        buildStubTable('transactions', ['id', 'type', 'date', 'amount', 'currency', 'counterparty', 'entity', 'status', 'due_date']),
      ])
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMinimalSchema(erpType: ErpType, erpVersion: string, tables: TableMetadata[]): SchemaMetadata {
  return {
    erpType,
    erpVersion,
    extractedAt: new Date(),
    tables,
    relationships: [],
  }
}

function buildStubTable(name: string, columnNames: string[]): TableMetadata {
  const columns: ColumnMetadata[] = columnNames.map(col => ({
    name: col,
    dataType: inferDataType(col),
    nullable: !isPrimaryLike(col),
    isPrimaryKey: isPrimaryLike(col),
    isForeignKey: isForeignLike(col),
    sampleValues: [],
    distinctValueCount: undefined,
  }))

  return {
    name,
    schema: undefined,
    columns,
    rowCount: Math.floor(Math.random() * 50000) + 1000,
    description: undefined,
  }
}

function inferDataType(col: string): string {
  const lower = col.toLowerCase()
  if (lower.includes('date') || lower.includes('_at')) return 'DATE'
  if (lower.includes('amount') || lower.includes('rate') || lower.includes('debit') || lower.includes('credit')) return 'DECIMAL'
  if (lower.includes('count') || lower.includes('num') || lower.includes('id') || lower.includes('number')) return 'INTEGER'
  if (lower.includes('currency') || lower.includes('currencycode')) return 'VARCHAR(3)'
  if (lower.includes('flag') || lower.includes('is_')) return 'BOOLEAN'
  return 'VARCHAR(255)'
}

function isPrimaryLike(col: string): boolean {
  const lower = col.toLowerCase()
  return lower === 'id' || lower.endsWith('_id') || lower === 'tranid' || lower === 'invoice_id'
}

function isForeignLike(col: string): boolean {
  const lower = col.toLowerCase()
  return lower.includes('vendor') || lower.includes('customer') || lower.includes('entity') || lower.includes('subsidiary')
}
