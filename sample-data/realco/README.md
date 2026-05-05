# RealCo Sample Data

Sample CSV files for the fictional company **RealCo** — a US-based multi-national
with subsidiaries in Germany, UK, Japan, Canada, and Mexico. Functional currency
is USD; transactional currencies span EUR, GBP, JPY, CAD, MXN, KRW.

All dates are anchored around **May 2026** with the bulk of activity falling in
the next 12 months (May 2026 → April 2027). Loans and contracts include realistic
historical start dates from 2025.

## Files in this folder

| File | Target table / page | Purpose |
|---|---|---|
| `onboarding_exposures.csv` | `fx_exposures` (via onboarding wizard) | Workday-style export — use during the **Setup → ConnectERP → DiscoveryFeed → ValidateMappings → GoLive** onboarding flow |
| `fx_exposures.csv` | `fx_exposures` (via Manual Upload tab on Exposure page) | Simple format for direct manual upload — `entity, currency_pair, direction, notional, settlement_date, description` |
| `cash_flows.csv` | Cash Flows page | Realised + forecasted cash inflows / outflows |
| `payroll.csv` | Payroll page | Monthly gross/net payroll across all entities |
| `purchase_orders.csv` | Purchase Orders page | Open / approved / pending POs |
| `revenue_forecasts.csv` | Revenue Forecasts page | Quarterly revenue forecasts by segment / region |
| `loan_schedules.csv` | Loan Schedules page | Outstanding term loans, revolvers, bridge facilities |
| `capex.csv` | Capex page | Capital projects — committed, approved, planned |
| `supplier_contracts.csv` | Supplier Contracts page | Multi-year supplier framework agreements with payment schedules |
| `customer_contracts.csv` | Customer Contracts page | Multi-year customer agreements with quarterly payments |
| `intercompany_transfers.csv` | Intercompany Transfers page | Cross-entity funding, dividends, royalties |
| `budget_rates.csv` | Budget Rates page | Quarterly budget FX rates by currency pair |

## Entities

- **RealCo Inc** — US HQ (USD)
- **RealCo Europe GmbH** — Germany / EU (EUR)
- **RealCo UK Ltd** — UK (GBP)
- **RealCo Japan KK** — Japan (JPY)
- **RealCo Canada Ltd** — Canada (CAD)
- **RealCo Mexico SA de CV** — Mexico (MXN)

## Notes for testing

- Every row has a settlement / due / pay / flow date. Most fall **after** today
  (~2026-05-05) so they appear as live exposures in the dashboard.
- Some intentional edge cases: a `disputed` customer contract (Tesco), a Honda /
  Komatsu PO chain affecting a single facility build-out, multiple loans across
  several lenders to test concentration views.
- Payroll covers May → December 2026 in monthly cadence, with entity-specific
  variations (year-end bonuses in December for US, Christmas allowance for DE).
- Currency mix is intentional: the dashboard's per-currency aggregation should
  show meaningful EUR, GBP, JPY exposures with smaller CAD / MXN / KRW slices.

## Sequence to test full data flow

1. Sign up a new test org as RealCo
2. Run onboarding: upload `onboarding_exposures.csv` at the ConnectERP step
3. Navigate to each module and upload its corresponding file
4. Confirm Exposure dashboard summary aggregates the imports correctly
