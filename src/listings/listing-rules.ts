import { BadRequestException } from '@nestjs/common';
import { AnimalSex, ListingType, ListingUnit, Species } from '@prisma/client';

/**
 * Constitution II domain rules for listings. Mirrored in the database by the CHECK constraints
 * `listings_species_type`, `listings_unit_type` and `listings_animal_fields`.
 */

/** FR-005: units allowed for each listing type. */
export const ALLOWED_UNITS: Record<ListingType, readonly ListingUnit[]> = {
  [ListingType.LIVE_ANIMAL]: [ListingUnit.HEAD, ListingUnit.KG],
  [ListingType.MEAT]: [ListingUnit.KG, ListingUnit.PIECE],
  [ListingType.MILK]: [ListingUnit.LITRE],
  [ListingType.EGGS]: [ListingUnit.PIECE, ListingUnit.TRAY],
};

/** FR-003: milk only from cattle, eggs only from chickens; live animals and meat from any species. */
export function isAllowedCombination(species: Species, type: ListingType): boolean {
  switch (type) {
    case ListingType.MILK:
      return species === Species.CATTLE;
    case ListingType.EGGS:
      return species === Species.CHICKEN;
    default:
      return true;
  }
}

export interface ListingRuleInput {
  species: Species;
  listingType: ListingType;
  unit: ListingUnit;
  breed?: string | null;
  sex?: AnimalSex | null;
  ageMonths?: number | null;
  weightKg?: number | null;
}

const ANIMAL_FIELDS = ['breed', 'sex', 'ageMonths', 'weightKg'] as const;

/** Throws 400 with a clear message when the listing breaks a domain rule. */
export function validateListing(l: ListingRuleInput): void {
  if (!isAllowedCombination(l.species, l.listingType)) {
    const only = l.listingType === ListingType.MILK ? Species.CATTLE : Species.CHICKEN;
    throw new BadRequestException(`${l.listingType} listings are only allowed for ${only}`);
  }
  if (!ALLOWED_UNITS[l.listingType].includes(l.unit)) {
    throw new BadRequestException(`Unit ${l.unit} is not allowed for ${l.listingType} listings`);
  }
  if (l.listingType === ListingType.LIVE_ANIMAL) {
    if (l.breed == null || l.sex == null || l.ageMonths == null) {
      throw new BadRequestException('LIVE_ANIMAL listings require breed, sex and ageMonths');
    }
    return;
  }
  for (const field of ANIMAL_FIELDS) {
    if (l[field] != null) {
      throw new BadRequestException(`${field} is only allowed for LIVE_ANIMAL listings`);
    }
  }
}
