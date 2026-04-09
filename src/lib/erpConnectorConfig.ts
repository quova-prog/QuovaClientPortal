// ============================================================
// ERP Connector Config — definition-driven connector catalog
// Used by ConnectERP.tsx (keeps UI logic clean)
// ============================================================

import type { ERPType } from '@/types'

export interface ERPConnectorField {
  key: string
  label: string
  type: 'text' | 'url' | 'password' | 'select'
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface ERPConnectorConfig {
  erp_type: ERPType
  label: string
  badge: 'Cloud' | 'On-prem' | 'File' | 'Custom'
  description: string
  estimated_setup_time: string
  fields: ERPConnectorField[]
  modules_to_validate: string[]
  help_doc_url: string
  available: boolean // false = "Coming Soon"
}

export const ERP_CONNECTORS: ERPConnectorConfig[] = [
  {
    erp_type: 'flat_file',
    label: 'Flat File (CSV / Excel)',
    badge: 'File',
    description: 'Upload a CSV or Excel file containing your FX exposure data.',
    estimated_setup_time: '5 minutes',
    fields: [],
    modules_to_validate: [],
    help_doc_url: '/docs/connect/flat-file',
    available: true,
  },
  {
    erp_type: 'sap_s4hana_cloud',
    label: 'SAP S/4HANA Cloud',
    badge: 'Cloud',
    description: 'Connect via OData APIs using OAuth 2.0 / BTP credentials.',
    estimated_setup_time: '10 minutes',
    fields: [
      { key: 'base_url',       label: 'SAP API Base URL',       type: 'url',      required: true,  placeholder: 'https://my-instance.s4hana.cloud.sap' },
      { key: 'subdomain',      label: 'Subdomain',              type: 'text',     required: true,  placeholder: 'e.g. my-company-s4h' },
      { key: 'region',         label: 'Region',                 type: 'select',   required: true,  options: ['US East (Virginia)', 'US West (Oregon)', 'EU Central (Frankfurt)', 'EU West (Ireland)', 'AP Southeast (Singapore)', 'AP Northeast (Tokyo)', 'AP South (Mumbai)'] },
      { key: 'client_id',      label: 'OAuth 2.0 Client ID',    type: 'text',     required: true  },
      { key: 'client_secret',  label: 'OAuth 2.0 Client Secret', type: 'password', required: true  },
      { key: 'environment',    label: 'Environment',            type: 'select',   required: true,  options: ['Production', 'Sandbox'] },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable', 'general_ledger', 'intercompany'],
    help_doc_url: '/docs/connect/sap-s4-cloud',
    available: true,
  },
  {
    erp_type: 'sap_s4hana_onprem',
    label: 'SAP S/4HANA On-Premise',
    badge: 'On-prem',
    description: 'Connect via SAP Cloud Connector or direct OData.',
    estimated_setup_time: '20 minutes',
    fields: [
      { key: 'base_url',   label: 'SAP Host URL',               type: 'url',      required: true  },
      { key: 'client',     label: 'Client Number',              type: 'text',     required: true  },
      { key: 'username',   label: 'Service Account Username',   type: 'text',     required: true  },
      { key: 'password',   label: 'Service Account Password',   type: 'password', required: true  },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable'],
    help_doc_url: '/docs/connect/sap-s4-onprem',
    available: true,
  },
  {
    erp_type: 'netsuite',
    label: 'NetSuite',
    badge: 'Cloud',
    description: 'Connect via SuiteQL + REST APIs with TBA or OAuth 2.0.',
    estimated_setup_time: '15 minutes',
    fields: [
      { key: 'account_id',      label: 'NetSuite Account ID',   type: 'text',     required: true,  placeholder: '12345' },
      { key: 'consumer_key',    label: 'Consumer Key',          type: 'text',     required: true  },
      { key: 'consumer_secret', label: 'Consumer Secret',       type: 'password', required: true  },
      { key: 'token_id',        label: 'Token ID',              type: 'text',     required: true  },
      { key: 'token_secret',    label: 'Token Secret',          type: 'password', required: true  },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable', 'transactions'],
    help_doc_url: '/docs/connect/netsuite',
    available: true,
  },
  {
    erp_type: 'oracle_cloud_erp',
    label: 'Oracle Cloud ERP',
    badge: 'Cloud',
    description: 'Connect via Oracle Cloud REST APIs with IDCS OAuth.',
    estimated_setup_time: '15 minutes',
    fields: [
      { key: 'base_url',      label: 'Oracle Cloud URL',      type: 'url',      required: true  },
      { key: 'client_id',     label: 'OAuth Client ID',       type: 'text',     required: true  },
      { key: 'client_secret', label: 'OAuth Client Secret',   type: 'password', required: true  },
    ],
    modules_to_validate: ['payables', 'receivables', 'general_ledger'],
    help_doc_url: '/docs/connect/oracle-cloud',
    available: true,
  },
  {
    erp_type: 'dynamics_365',
    label: 'Microsoft Dynamics 365',
    badge: 'Cloud',
    description: 'Connect via Dataverse API with Azure AD OAuth.',
    estimated_setup_time: '15 minutes',
    fields: [
      { key: 'tenant_id',     label: 'Azure Tenant ID',                 type: 'text',     required: true },
      { key: 'client_id',     label: 'App Registration Client ID',      type: 'text',     required: true },
      { key: 'client_secret', label: 'Client Secret',                   type: 'password', required: true },
      { key: 'org_url',       label: 'Dynamics 365 Organisation URL',   type: 'url',      required: true },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable'],
    help_doc_url: '/docs/connect/dynamics-365',
    available: true,
  },
  {
    erp_type: 'workday',
    label: 'Workday',
    badge: 'Cloud',
    description: 'Connect via Workday REST APIs with OAuth 2.0.',
    estimated_setup_time: '20 minutes',
    fields: [
      { key: 'tenant',        label: 'Workday Tenant Name',   type: 'text',     required: true },
      { key: 'client_id',     label: 'Client ID',             type: 'text',     required: true },
      { key: 'client_secret', label: 'Client Secret',         type: 'password', required: true },
    ],
    modules_to_validate: ['financial_management', 'accounting'],
    help_doc_url: '/docs/connect/workday',
    available: true,
  },
  {
    erp_type: 'oracle_ebs',
    label: 'Oracle EBS',
    badge: 'On-prem',
    description: 'Connect via Oracle E-Business Suite APIs.',
    estimated_setup_time: '30 minutes',
    fields: [
      { key: 'base_url',  label: 'Oracle EBS URL',    type: 'url',      required: true },
      { key: 'username',  label: 'API Username',       type: 'text',     required: true },
      { key: 'password',  label: 'API Password',       type: 'password', required: true },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable'],
    help_doc_url: '/docs/connect/oracle-ebs',
    available: true,
  },
  {
    erp_type: 'sap_ecc',
    label: 'SAP ECC 6.0',
    badge: 'On-prem',
    description: 'Connect via SAP BAPI/RFC interfaces.',
    estimated_setup_time: '30 minutes',
    fields: [
      { key: 'host',          label: 'SAP Host',       type: 'text',     required: true },
      { key: 'system_number', label: 'System Number',  type: 'text',     required: true },
      { key: 'client',        label: 'Client',         type: 'text',     required: true },
      { key: 'username',      label: 'Username',       type: 'text',     required: true },
      { key: 'password',      label: 'Password',       type: 'password', required: true },
    ],
    modules_to_validate: ['accounts_payable', 'accounts_receivable'],
    help_doc_url: '/docs/connect/sap-ecc',
    available: true,
  },
  {
    erp_type: 'api_custom',
    label: 'Custom API',
    badge: 'Custom',
    description: 'Connect your own data source via REST API or webhook.',
    estimated_setup_time: 'Varies',
    fields: [
      { key: 'endpoint', label: 'API Endpoint URL', type: 'url',      required: true  },
      { key: 'api_key',  label: 'API Key',          type: 'password', required: false },
    ],
    modules_to_validate: [],
    help_doc_url: '/docs/connect/custom-api',
    available: true,
  },
]
