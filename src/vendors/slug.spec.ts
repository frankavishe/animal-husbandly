import { SLUG_MAX_LENGTH, slugify } from './slug';

describe('slugify', () => {
  it('handles Swahili apostrophes', () => expect(slugify("Ng'ombe Bora")).toBe('ngombe-bora'));
  it('handles typographic apostrophes', () => expect(slugify('Ng’ombe Bora')).toBe('ngombe-bora'));
  it('strips diacritics', () => expect(slugify('Café Élevage Ñ')).toBe('cafe-elevage-n'));
  it('collapses separators and trims dashes', () =>
    expect(slugify('  Mwanza -- Cattle & Goats!! ')).toBe('mwanza-cattle-goats'));
  it('returns empty for symbols only', () => expect(slugify('!!! ***')).toBe(''));
  it('caps long names without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(59)} bbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('a'.repeat(59));
  });
});
