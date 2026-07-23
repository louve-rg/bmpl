/** The six districts of Belize. Mirrors the Prisma `District` enum. */
export const DISTRICTS = [
  'BELIZE',
  'CAYO',
  'COROZAL',
  'ORANGE_WALK',
  'STANN_CREEK',
  'TOLEDO',
] as const;

export type District = (typeof DISTRICTS)[number];

export const DISTRICT_LABELS: Record<District, string> = {
  BELIZE: 'Belize',
  CAYO: 'Cayo',
  COROZAL: 'Corozal',
  ORANGE_WALK: 'Orange Walk',
  STANN_CREEK: 'Stann Creek',
  TOLEDO: 'Toledo',
};
