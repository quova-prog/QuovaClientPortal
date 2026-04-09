// =============================================================================
// ERP Schema Stub Builder
//
// For MVP, no real ERP connections exist. This module builds a SchemaMetadata
// object per ERP type using mock data. When real connectors ship (via BFF),
// this module gets replaced by actual schema extraction.
// =============================================================================

import type { ERPType } from '@/types'

// ── Inline type definitions (mirrored from schema-discovery) ─────────────────
// These types are duplicated here so orbit-mvp can build standalone without
// requiring the schema-discovery package. Keep in sync with:
//   packages/schema-discovery/src/types/schema-metadata.ts

export type ErpType = 'sap_s4hana' | 'sap_ecc' | 'oracle' | 'netsuite' | 'dynamics' | 'workday' | 'unknown'

export interface ColumnMetadata {
  name: string
  dataType: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  sampleValues: string[]
  distinctValueCount?: number
}

export interface TableMetadata {
  name: string
  schema?: string
  columns: ColumnMetadata[]
  rowCount?: number
  description?: string
}

export interface SchemaMetadata {
  erpType: ErpType
  erpVersion: string
  extractedAt: Date
  tables: TableMetadata[]
  relationships: Array<{ from: string; to: string; type: string }>
}

/**
 * Builds a SchemaMetadata object for the given ERP type.
 * SAP variants use the rich 60-table mock schema (lazy-loaded if schema-discovery
 * package is available); other ERPs get a minimal schema from known module names.
 */
export async function buildErpSchema(erpType: ERPType): Promise<SchemaMetadata> {
  switch (erpType) {
    case 'sap_s4hana_cloud':
    case 'sap_s4hana_onprem':
    case 'sap_ecc':
      // Built-in SAP stub (full 60-table schema available via schema-discovery package server-side)
      return buildMinimalSchema('sap_s4hana', 'SAP S/4HANA', [
        buildStubTable('BSEG', ['BUKRS', 'BELNR', 'GJAHR', 'BUZEI', 'KOART', 'WRBTR', 'DMBTR', 'WAERS', 'HWAER', 'PSWSL', 'SHKZG', 'LIFNR', 'KUNNR', 'GSBER', 'KOSTL', 'ZFBDT', 'BUDAT', 'BLDAT']),
        buildStubTable('BKPF', ['BUKRS', 'BELNR', 'GJAHR', 'BLART', 'BUDAT', 'BLDAT', 'WAERS', 'BSTAT', 'XBLNR', 'AWTYP', 'AWKEY']),
        buildStubTable('T001', ['BUKRS', 'BUTXT', 'ORT01', 'LAND1', 'WAERS', 'KTOPL']),
        buildStubTable('TCURR', ['KURST', 'FCURR', 'TCURR', 'GDATU', 'UKURS', 'FFACT', 'TFACT']),
        buildStubTable('EKKO', ['EBELN', 'BUKRS', 'BSTYP', 'LIFNR', 'WAERS', 'BEDAT', 'KDATB', 'KDATE']),
        buildStubTable('EKPO', ['EBELN', 'EBELP', 'MATNR', 'MENGE', 'NETPR', 'NETWR', 'WAERS', 'EINDT']),
        buildStubTable('VBRK', ['VBELN', 'FKDAT', 'KUNAG', 'WAERK', 'NETWR', 'BUKRS', 'FKART']),
        buildStubTable('VBRP', ['VBELN', 'POSNR', 'MATNR', 'FKIMG', 'NETWR', 'WAERK']),
        buildStubTable('LFA1', ['LIFNR', 'NAME1', 'LAND1', 'ORT01', 'STRAS']),
        buildStubTable('KNA1', ['KUNNR', 'NAME1', 'LAND1', 'ORT01', 'STRAS']),
      ])

    case 'netsuite':
      return buildMinimalSchema('netsuite', 'SuiteQL', [
        buildStubTable('TRANSACTION', ['TRANID', 'TRANDATE', 'TYPE', 'STATUS', 'ENTITY', 'CURRENCY', 'AMOUNT', 'EXCHANGERATE', 'SUBSIDIARY', 'MEMO', 'DUEDATE']),
        buildStubTable('TRANSACTIONLINE', ['TRANSACTION', 'LINESEQUENCENUMBER', 'ITEM', 'AMOUNT', 'FOREIGNAMOUNT', 'CURRENCY', 'ACCOUNT', 'DEPARTMENT', 'CLASS']),
        buildStubTable('SUBSIDIARY', ['ID', 'NAME', 'CURRENCY', 'COUNTRY', 'ISELIMINATION', 'PARENT']),
        buildStubTable('VENDOR', ['ID', 'ENTITYID', 'COMPANYNAME', 'CURRENCY', 'COUNTRY']),
        buildStubTable('CUSTOMER', ['ID', 'ENTITYID', 'COMPANYNAME', 'CURRENCY', 'COUNTRY']),
        buildStubTable('ACCOUNT', ['ID', 'ACCTNUMBER', 'ACCTNAME', 'ACCTTYPE', 'CURRENCY']),
      ])

    case 'oracle_cloud_erp':
    case 'oracle_ebs':
      return buildMinimalSchema('oracle', 'Oracle ERP', [
        buildStubTable('AP_INVOICES_ALL', ['INVOICE_ID', 'VENDOR_ID', 'INVOICE_NUM', 'INVOICE_DATE', 'INVOICE_AMOUNT', 'INVOICE_CURRENCY_CODE', 'PAYMENT_CROSS_RATE', 'PAYMENT_STATUS_FLAG', 'DUE_DATE', 'ORG_ID']),
        buildStubTable('AP_INVOICE_LINES_ALL', ['INVOICE_ID', 'LINE_NUMBER', 'AMOUNT', 'DESCRIPTION', 'ORG_ID']),
        buildStubTable('AR_PAYMENT_SCHEDULES_ALL', ['PAYMENT_SCHEDULE_ID', 'CUSTOMER_ID', 'INVOICE_CURRENCY_CODE', 'AMOUNT_DUE_ORIGINAL', 'AMOUNT_DUE_REMAINING', 'DUE_DATE', 'STATUS', 'ORG_ID']),
        buildStubTable('GL_JE_LINES', ['JE_HEADER_ID', 'JE_LINE_NUM', 'LEDGER_ID', 'CODE_COMBINATION_ID', 'ENTERED_DR', 'ENTERED_CR', 'CURRENCY_CODE', 'EFFECTIVE_DATE']),
        buildStubTable('HR_OPERATING_UNITS', ['ORGANIZATION_ID', 'NAME', 'DEFAULT_LEGAL_CONTEXT_ID']),
      ])

    case 'dynamics_365':
      return buildMinimalSchema('dynamics', 'D365 F&O', [
        buildStubTable('VendInvoiceJour', ['InvoiceId', 'InvoiceDate', 'InvoiceAmount', 'CurrencyCode', 'VendAccount', 'DueDate', 'DataAreaId', 'LedgerVoucher']),
        buildStubTable('CustInvoiceJour', ['InvoiceId', 'InvoiceDate', 'InvoiceAmount', 'CurrencyCode', 'InvoiceAccount', 'DueDate', 'DataAreaId']),
        buildStubTable('LedgerJournalTrans', ['JournalNum', 'Voucher', 'TransDate', 'AmountCurDebit', 'AmountCurCredit', 'CurrencyCode', 'AccountNum', 'Company']),
        buildStubTable('CompanyInfo', ['DataArea', 'Name', 'CurrencyCode', 'CountryRegionId']),
      ])

    case 'workday':
      return buildMinimalSchema('workday', 'Workday Financials', [
        buildStubTable('Supplier_Invoice', ['Invoice_Number', 'Supplier', 'Invoice_Date', 'Due_Date', 'Total_Amount', 'Currency', 'Company', 'Status']),
        buildStubTable('Customer_Invoice', ['Invoice_Number', 'Customer', 'Invoice_Date', 'Due_Date', 'Total_Amount', 'Currency', 'Company', 'Status']),
        buildStubTable('Journal_Entry', ['Journal_Number', 'Ledger_Account', 'Debit_Amount', 'Credit_Amount', 'Currency', 'Accounting_Date', 'Company']),
        buildStubTable('Company', ['Company_ID', 'Company_Name', 'Currency_Code', 'Country']),
      ])

    default:
      return buildMinimalSchema('unknown', 'Custom API', [
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
