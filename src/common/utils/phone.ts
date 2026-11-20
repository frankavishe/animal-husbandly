import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Normalises a Tanzanian mobile number to E.164 (`+255XXXXXXXXX`).
 * Accepts `0712345678`, `712345678`, `255712345678`, `+255 712 345 678`.
 * Returns `null` when the input is not a valid Tanzanian mobile number.
 */
export function normalizeTzPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{9,12}$/.test(raw)) return null;
  const candidate = /^255\d{9}$/.test(raw) ? `+${raw}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, 'TZ');
  if (!parsed || parsed.country !== 'TZ' || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return parsed.number;
}
