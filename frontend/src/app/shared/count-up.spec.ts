import { countFrame } from './count-up';

describe('countFrame', () => {
  it('counts a plain number', () => {
    expect(countFrame('300 Mbps', 0.5)).toBe('150 Mbps');
    expect(countFrame('300 Mbps', 0)).toBe('0 Mbps');
  });

  it('keeps currency, thousands separators and decimals', () => {
    expect(countFrame('$1,210', 0.5)).toBe('$605');
    expect(countFrame('$20.00', 0.5)).toBe('$10.00');
    expect(countFrame('$20.00', 0)).toBe('$0.00');
    expect(countFrame('$12,345.60', 0.5)).toBe('$6,172.80');
  });

  it('keeps French formatting (narrow no-break space, decimal comma)', () => {
    expect(countFrame('1 210,00 $US', 0.5)).toBe('605,00 $US');
    expect(countFrame('2 000,50 $US', 1)).toBe('2 000,50 $US');
  });

  it('only moves the first number in a sentence', () => {
    expect(countFrame('5.26 GB of 50 GB used', 0.5)).toBe('2.63 GB of 50 GB used');
    expect(countFrame('استهلكت 5.26 من 50 غيغابايت', 1)).toBe('استهلكت 5.26 من 50 غيغابايت');
  });

  it('ends exactly on the real value, and leaves text without numbers alone', () => {
    expect(countFrame('$1,210', 1)).toBe('$1,210');
    expect(countFrame('No data yet', 0.3)).toBe('No data yet');
  });
});
