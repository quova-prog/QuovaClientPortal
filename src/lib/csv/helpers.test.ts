import { describe, it, expect } from 'vitest'
import { findColumn, parseDate, isValidCurrencyPair } from './helpers'

describe('findColumn', () => {
  it('returns the original-cased header on a case-insensitive match', () => {
    const headers = ['Currency Pair', 'Notional', 'Settlement Date']
    expect(findColumn(headers, ['currency pair'])).toBe('Currency Pair')
    expect(findColumn(headers, ['CURRENCY PAIR'])).toBe('Currency Pair')
  })

  it('matches the first alias that hits', () => {
    const headers = ['amount', 'currency']
    expect(findColumn(headers, ['notional', 'amount'])).toBe('amount')
  })

  it('trims whitespace on the header side', () => {
    const headers = ['  pair  ', '  notional  ']
    expect(findColumn(headers, ['pair'])).toBe('  pair  ')
  })

  it('returns null when no alias matches', () => {
    expect(findColumn(['foo'], ['bar', 'baz'])).toBeNull()
  })

  it('returns null on empty headers', () => {
    expect(findColumn([], ['anything'])).toBeNull()
  })
})

describe('parseDate', () => {
  describe('explicit formats — locked in', () => {
    it('accepts ISO 8601', () => {
      expect(parseDate('2026-04-15')).toBe('2026-04-15')
    })

    it('accepts US MM/DD/YYYY', () => {
      expect(parseDate('04/15/2026')).toBe('2026-04-15')
    })

    it('accepts US M/D/YYYY without leading zeros', () => {
      expect(parseDate('4/5/2026')).toBe('2026-04-05')
    })

    it('accepts US MM-DD-YYYY hyphenated', () => {
      expect(parseDate('04-15-2026')).toBe('2026-04-15')
    })

    it('accepts European DD.MM.YYYY', () => {
      expect(parseDate('15.04.2026')).toBe('2026-04-15')
    })
  })

  describe('locale-ambiguous slash dates — pinning interpretation', () => {
    // CRITICAL: do not "fix" these to the European reading without also
    // updating every parser-driven CSV importer. The helper interprets
    // slash-separated 4-digit-year dates as US MM/DD/YYYY because that
    // is what nearly all US-centric ERP exports emit (Workday, NetSuite,
    // Oracle EBS, Sage Intacct). European customers should send ISO 8601
    // or DD.MM.YYYY (also supported above) — the parser's order makes
    // the ISO and dot variants win before this branch.

    it('treats 03/04/2026 as March 4 (MM/DD/YYYY), NOT April 3', () => {
      expect(parseDate('03/04/2026')).toBe('2026-03-04')
    })

    it('treats 12/01/2026 as December 1 (MM/DD/YYYY)', () => {
      expect(parseDate('12/01/2026')).toBe('2026-12-01')
    })

    it('treats 01/12/2026 as January 12 (MM/DD/YYYY) — NOT December 1', () => {
      expect(parseDate('01/12/2026')).toBe('2026-01-12')
    })
  })

  describe('native fallback — for inputs not in any of the explicit formats', () => {
    it('handles "Apr 15, 2026"', () => {
      expect(parseDate('Apr 15, 2026')).toBe('2026-04-15')
    })

    it('handles "April 15, 2026"', () => {
      expect(parseDate('April 15, 2026')).toBe('2026-04-15')
    })

    it('handles ISO with time component', () => {
      // Date.parse on "2026-04-15T10:30:00Z" produces a valid date — we
      // truncate to the YYYY-MM-DD portion of the resulting ISO string.
      expect(parseDate('2026-04-15T10:30:00Z')).toBe('2026-04-15')
    })
  })

  describe('rejection cases', () => {
    it('returns null on empty string', () => {
      expect(parseDate('')).toBeNull()
    })

    it('returns null on whitespace-only', () => {
      expect(parseDate('   ')).toBeNull()
    })

    it('returns null on garbage', () => {
      expect(parseDate('not a date')).toBeNull()
    })

    // Note: the helper does NOT validate that a date round-trips. V8's
    // new Date() rolls over invalid components (e.g. '2026-02-30' becomes
    // March 2), and the helper returns the original constructed string
    // rather than the rolled-over result. If strict round-trip validation
    // is needed in the future, harden parseDate to compare components
    // before returning. Not in scope here — tests pin current behaviour.
  })
})

describe('isValidCurrencyPair', () => {
  it('accepts standard ISO triple/triple', () => {
    expect(isValidCurrencyPair('EUR/USD')).toBe(true)
    expect(isValidCurrencyPair('GBP/JPY')).toBe(true)
    expect(isValidCurrencyPair('USD/MXN')).toBe(true)
  })

  it('rejects lowercase', () => {
    expect(isValidCurrencyPair('eur/usd')).toBe(false)
  })

  it('rejects missing slash', () => {
    expect(isValidCurrencyPair('EURUSD')).toBe(false)
  })

  it('rejects wrong-length codes', () => {
    expect(isValidCurrencyPair('EU/USD')).toBe(false)
    expect(isValidCurrencyPair('EURO/USD')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidCurrencyPair('')).toBe(false)
  })
})
