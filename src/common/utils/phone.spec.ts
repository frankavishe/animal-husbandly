import { normalizeTzPhone } from './phone';

describe('normalizeTzPhone', () => {
  it.each([
    ['0712345678', '+255712345678'],
    ['712345678', '+255712345678'],
    ['+255712345678', '+255712345678'],
    ['+255 712 345 678', '+255712345678'],
    ['255712345678', '+255712345678'],
    ['0754-123-456', '+255754123456'],
    ['0682123456', '+255682123456'],
  ])('normalises %s → %s', (input, expected) => {
    expect(normalizeTzPhone(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['letters', 'abc'],
    ['too short', '07123'],
    ['Kenyan mobile', '+254712345678'],
    ['TZ landline', '0222123456'],
    ['too long', '07123456789'],
    ['non-string', 712345678],
  ])('rejects %s', (_label, input) => {
    expect(normalizeTzPhone(input)).toBeNull();
  });
});
