import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, ValidateBy } from 'class-validator';
import { normalizeTzPhone } from '../utils/phone';

/**
 * Normalises a Tanzanian mobile number to `+255XXXXXXXXX` and rejects anything else.
 * `null` passes through untouched (meaning "clear" on PATCH; combine with @IsOptional()).
 */
export function IsTzPhone(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeTzPhone(value) ?? value),
    ValidateBy({
      name: 'isTzPhone',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && /^\+255\d{9}$/.test(value),
        defaultMessage: (args) =>
          `${args?.property ?? 'phone'} must be a valid Tanzanian mobile number (e.g. 0712345678)`,
      },
    }),
  );
}

/** Trims and lowercases an email, then validates it. */
export function IsNormalizedEmail(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail({}, { message: 'email must be a valid email address' }),
    MaxLength(254),
  );
}

/** Trims surrounding whitespace on strings. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** FR-010: ≥ 8 characters with at least one letter and one digit (bcrypt caps input at 72 bytes). */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8),
    MaxLength(72),
    Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' }),
    Matches(/\d/, { message: 'password must contain at least one digit' }),
  );
}

/** A trimmed person name of 2–100 characters. */
export function IsPersonName(): PropertyDecorator {
  return applyDecorators(Trim(), IsString(), MinLength(2), MaxLength(100));
}
