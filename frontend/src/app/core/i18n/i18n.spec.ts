import { AR } from './ar';
import { FR } from './fr';
import { norm, t } from './index';

describe('translations', () => {
  it('fills in values and falls back to English for unknown text', () => {
    // Tests run in English: t() returns the English text with the values filled in.
    expect(t('{used} GB of {limit} GB used', { used: '3.50', limit: 50 })).toBe('3.50 GB of 50 GB used');
    expect(t('Not a key  we\nknow')).toBe('Not a key we know');
  });

  it('treats curly and straight apostrophes and line breaks as the same key', () => {
    expect(norm('You’ll get\n   another')).toBe("You'll get another");
  });

  it('Arabic and French translate the same texts, keeping every {placeholder}', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(FR).sort());
    for (const [key, ar] of Object.entries(AR)) {
      const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(holes(ar), `ar: ${key}`).toBe(holes(key));
      expect(holes(FR[key]), `fr: ${key}`).toBe(holes(key));
    }
  });
});
