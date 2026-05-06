import { describe, expect, it } from 'vitest'
import { csvEscape, neutralizeCsvFormula, toCsvObjects, toCsvRows } from './escape'

describe('CSV escaping', () => {
  it.each(['=HYPERLINK("https://evil.test")', '+SUM(1,2)', '-cmd', '@foo', '\t=1+1', '\r=1+1'])(
    'neutralizes formula-like value %j',
    value => {
      expect(neutralizeCsvFormula(value)).toBe(`'${value}`)
      expect(csvEscape(value).startsWith("'" ) || csvEscape(value).startsWith('"\'')).toBe(true)
    },
  )

  it('does not alter ordinary values', () => {
    expect(csvEscape('EUR/USD')).toBe('EUR/USD')
    expect(csvEscape('Receivable')).toBe('Receivable')
  })

  it('quotes comma, quote, and newline characters after formula neutralization', () => {
    expect(csvEscape('hello,world')).toBe('"hello,world"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
    expect(csvEscape('+SUM(1,2)')).toBe('"\'+SUM(1,2)"')
  })

  it('serializes row arrays safely', () => {
    expect(toCsvRows([
      ['Name', 'Amount'],
      ['=HYPERLINK("https://evil.test")', 123],
    ])).toBe('Name,Amount\n"\'=HYPERLINK(""https://evil.test"")",123')
  })

  it('serializes object rows safely', () => {
    expect(toCsvObjects([{ name: '@attacker', note: 'ok' }])).toBe('name,note\n\'@attacker,ok')
  })
})
