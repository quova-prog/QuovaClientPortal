import { describe, it, expect } from 'vitest'
import { toUsd, FALLBACK_FX } from './fx'

describe('toUsd', () => {
  describe('USD passthrough', () => {
    it('returns amount unchanged for USD', () => {
      expect(toUsd(1000, 'USD', {})).toBe(1000)
    })

    it('handles lowercase usd', () => {
      expect(toUsd(1000, 'usd', {})).toBe(1000)
    })

    it('handles negative amounts', () => {
      expect(toUsd(-500, 'USD', {})).toBe(-500)
    })

    it('handles zero', () => {
      expect(toUsd(0, 'USD', {})).toBe(0)
    })
  })

  describe('direct CCY/USD pair from live rates', () => {
    it('uses EUR/USD when present', () => {
      expect(toUsd(100, 'EUR', { 'EUR/USD': 1.10 })).toBeCloseTo(110, 10)
    })

    it('uses GBP/USD when present', () => {
      expect(toUsd(50, 'GBP', { 'GBP/USD': 1.30 })).toBeCloseTo(65, 10)
    })

    it('also accepts EURUSD (no slash)', () => {
      expect(toUsd(100, 'EUR', { EURUSD: 1.10 })).toBeCloseTo(110, 10)
    })

    it('prefers slash form when both forms exist', () => {
      // 'EUR/USD' should win over 'EURUSD'
      expect(toUsd(100, 'EUR', { 'EUR/USD': 1.10, EURUSD: 99 })).toBeCloseTo(110, 10)
    })

    it('is case-insensitive on the input currency code', () => {
      expect(toUsd(100, 'eur', { 'EUR/USD': 1.10 })).toBeCloseTo(110, 10)
    })
  })

  describe('inverse USD/CCY pair from live rates', () => {
    it('inverts USD/JPY for JPY conversion', () => {
      // 1 USD = 150 JPY ⇒ 15000 JPY = 100 USD
      expect(toUsd(15000, 'JPY', { 'USD/JPY': 150 })).toBeCloseTo(100, 6)
    })

    it('also accepts USDJPY (no slash)', () => {
      expect(toUsd(15000, 'JPY', { USDJPY: 150 })).toBeCloseTo(100, 6)
    })

    it('prefers direct pair over inverse', () => {
      // If both EUR/USD and USD/EUR are present, EUR/USD wins
      expect(toUsd(100, 'EUR', { 'EUR/USD': 1.10, 'USD/EUR': 0.5 })).toBeCloseTo(110, 10)
    })

    it('skips inverse when rate is zero (avoid division by zero)', () => {
      // Falls through to FALLBACK_FX
      expect(toUsd(100, 'JPY', { 'USD/JPY': 0 })).toBeCloseTo(100 * FALLBACK_FX.JPY, 6)
    })

    it('skips inverse when rate is negative', () => {
      expect(toUsd(100, 'JPY', { 'USD/JPY': -150 })).toBeCloseTo(100 * FALLBACK_FX.JPY, 6)
    })
  })

  describe('fallback when no live pair available', () => {
    it('uses FALLBACK_FX for known currencies', () => {
      expect(toUsd(100, 'EUR', {})).toBeCloseTo(100 * FALLBACK_FX.EUR, 10)
      expect(toUsd(1000, 'JPY', {})).toBeCloseTo(1000 * FALLBACK_FX.JPY, 10)
      expect(toUsd(50, 'BRL', {})).toBeCloseTo(50 * FALLBACK_FX.BRL, 10)
    })

    it('returns amount * 1.0 for completely unknown currencies', () => {
      expect(toUsd(100, 'XYZ', {})).toBe(100)
    })

    it('FALLBACK_FX includes all 25 documented currencies', () => {
      const expected = [
        'EUR','GBP','JPY','CAD','AUD','CHF','CNY','USD',
        'NZD','SEK','NOK','DKK','HKD','SGD',
        'KRW','INR','BRL','ZAR','TRY','IDR','PHP','THB','MYR','MXN',
      ]
      for (const ccy of expected) {
        expect(FALLBACK_FX).toHaveProperty(ccy)
        expect(FALLBACK_FX[ccy]).toBeGreaterThan(0)
      }
    })
  })

  describe('fallback ordering — live > FALLBACK_FX', () => {
    it('live rate takes priority over FALLBACK_FX', () => {
      // FALLBACK_FX.EUR = 1.09; live rate is 1.20
      expect(toUsd(100, 'EUR', { 'EUR/USD': 1.20 })).toBeCloseTo(120, 10)
    })

    it('falls through to FALLBACK_FX when live map exists but key is missing', () => {
      expect(toUsd(100, 'EUR', { 'GBP/USD': 1.30 })).toBeCloseTo(100 * FALLBACK_FX.EUR, 10)
    })
  })

  describe('numerical stability', () => {
    it('handles very small currency rates (e.g. IDR)', () => {
      // 1B IDR ≈ $63K
      expect(toUsd(1_000_000_000, 'IDR', {})).toBeCloseTo(1_000_000_000 * FALLBACK_FX.IDR, 0)
    })

    it('handles very large notionals', () => {
      const big = 1e12
      expect(toUsd(big, 'EUR', { 'EUR/USD': 1.10 })).toBeCloseTo(big * 1.10, -3)
    })

    it('produces same result regardless of slash placement in live rates', () => {
      const direct = toUsd(100, 'EUR', { 'EUR/USD': 1.10 })
      const condensed = toUsd(100, 'EUR', { EURUSD: 1.10 })
      expect(direct).toBe(condensed)
    })
  })
})
