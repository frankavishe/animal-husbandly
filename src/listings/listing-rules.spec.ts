import { BadRequestException } from '@nestjs/common';
import { AnimalSex, ListingType, ListingUnit, Species } from '@prisma/client';
import {
  ALLOWED_UNITS,
  isAllowedCombination,
  ListingRuleInput,
  validateListing,
} from './listing-rules';

const ALL_SPECIES = Object.values(Species);
const ALL_TYPES = Object.values(ListingType);
const ALL_UNITS = Object.values(ListingUnit);

const INVALID_PAIRS: Array<[Species, ListingType]> = [
  [Species.GOAT, ListingType.MILK],
  [Species.SHEEP, ListingType.MILK],
  [Species.PIG, ListingType.MILK],
  [Species.CHICKEN, ListingType.MILK],
  [Species.FISH, ListingType.MILK],
  [Species.CATTLE, ListingType.EGGS],
  [Species.GOAT, ListingType.EGGS],
  [Species.SHEEP, ListingType.EGGS],
  [Species.PIG, ListingType.EGGS],
  [Species.FISH, ListingType.EGGS],
];

const isInvalid = (s: Species, t: ListingType) =>
  INVALID_PAIRS.some(([is, it]) => is === s && it === t);

const ANIMAL = { breed: 'Boran', sex: AnimalSex.FEMALE, ageMonths: 30 };

/** A listing that is valid for (species, type), using the first allowed unit. */
function base(species: Species, listingType: ListingType): ListingRuleInput {
  return {
    species,
    listingType,
    unit: ALLOWED_UNITS[listingType][0],
    ...(listingType === ListingType.LIVE_ANIMAL ? ANIMAL : {}),
  };
}

function expect400(input: ListingRuleInput, message: string): void {
  expect(() => validateListing(input)).toThrow(BadRequestException);
  expect(() => validateListing(input)).toThrow(message);
}

describe('listing rules', () => {
  it('covers exactly 24 species × type combinations, 10 of them invalid', () => {
    expect(ALL_SPECIES.length * ALL_TYPES.length).toBe(24);
    const invalid = ALL_SPECIES.flatMap((s) =>
      ALL_TYPES.filter((t) => !isAllowedCombination(s, t)).map((t) => [s, t]),
    );
    expect(invalid).toHaveLength(10);
  });

  describe.each(ALL_SPECIES.flatMap((s) => ALL_TYPES.map((t) => [s, t] as const)))(
    '%s + %s',
    (species, type) => {
      if (isInvalid(species, type)) {
        it('is rejected', () => {
          expect(isAllowedCombination(species, type)).toBe(false);
          const only = type === ListingType.MILK ? 'CATTLE' : 'CHICKEN';
          expect400(base(species, type), `${type} listings are only allowed for ${only}`);
        });
      } else {
        it('is accepted', () => {
          expect(isAllowedCombination(species, type)).toBe(true);
          expect(() => validateListing(base(species, type))).not.toThrow();
        });
      }
    },
  );

  describe('units per type', () => {
    const species: Record<ListingType, Species> = {
      LIVE_ANIMAL: Species.CATTLE,
      MEAT: Species.GOAT,
      MILK: Species.CATTLE,
      EGGS: Species.CHICKEN,
    };
    for (const type of ALL_TYPES) {
      for (const unit of ALL_UNITS) {
        const allowed = ALLOWED_UNITS[type].includes(unit);
        it(`${type} by ${unit} is ${allowed ? 'allowed' : 'rejected'}`, () => {
          const input = { ...base(species[type], type), unit };
          if (allowed) expect(() => validateListing(input)).not.toThrow();
          else expect400(input, `Unit ${unit} is not allowed for ${type} listings`);
        });
      }
    }
  });

  describe('live animal fields', () => {
    it.each(['breed', 'sex', 'ageMonths'] as const)('LIVE_ANIMAL without %s is rejected', (f) => {
      expect400(
        { ...base(Species.CATTLE, ListingType.LIVE_ANIMAL), [f]: undefined },
        'LIVE_ANIMAL listings require breed, sex and ageMonths',
      );
    });

    it('LIVE_ANIMAL with null field is rejected', () => {
      expect400(
        { ...base(Species.CATTLE, ListingType.LIVE_ANIMAL), sex: null },
        'LIVE_ANIMAL listings require breed, sex and ageMonths',
      );
    });

    it('LIVE_ANIMAL weight is optional', () => {
      const l = base(Species.GOAT, ListingType.LIVE_ANIMAL);
      expect(() => validateListing(l)).not.toThrow();
      expect(() => validateListing({ ...l, weightKg: 35.5 })).not.toThrow();
    });

    const others: Array<[ListingType, Species]> = [
      [ListingType.MEAT, Species.PIG],
      [ListingType.MILK, Species.CATTLE],
      [ListingType.EGGS, Species.CHICKEN],
    ];
    const fields: Array<[keyof ListingRuleInput, unknown]> = [
      ['breed', 'Boran'],
      ['sex', AnimalSex.MALE],
      ['ageMonths', 0],
      ['weightKg', 10],
    ];
    for (const [type, species] of others) {
      for (const [field, value] of fields) {
        it(`${field} on ${type} is rejected`, () => {
          expect400(
            { ...base(species, type), [field]: value },
            `${field} is only allowed for LIVE_ANIMAL listings`,
          );
        });
      }
      it(`${type} with animal fields null is accepted`, () => {
        expect(() =>
          validateListing({
            ...base(species, type),
            breed: null,
            sex: null,
            ageMonths: null,
            weightKg: null,
          }),
        ).not.toThrow();
      });
    }
  });
});
