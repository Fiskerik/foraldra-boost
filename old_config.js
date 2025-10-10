/**
 * config.js - Constants and global variables for Föräldrapenningkalkylator
 * Stores static values like income caps, benefit amounts, and default preferences.
 */

// Global configuration variables
export const vårdnad = "gemensam";
export const beräknaPartner = "ja";
export const barnIdag = 0;
export const barnPlanerat = 0;
export const hasCalculated = false;

// Parental leave days
export const förälder1InkomstDagar = 195; // Sjukpenningnivå days for Parent 1
export const förälder2InkomstDagar = 195; // Sjukpenningnivå days for Parent 2
export const förälder1LägstanivåDagar = 45; // Lägstanivå days for Parent 1
export const förälder2LägstanivåDagar = 45; // Lägstanivå days for Parent 2
export const förälder1MinDagar = 45; // Minimum reserved days for Parent 1
export const förälder2MinDagar = 45; // Minimum reserved days for Parent 2

// Benefits
export const barnbidragPerPerson = 625; // Child allowance per person (SEK/month)
export const tilläggPerPerson = 0; // Additional allowance per person (SEK/month)

// Constants
export const INCOME_CAP = 1250; // SEK/day max parental benefit
export const MINIMUM_RATE = 180; // SEK/day minimum parental benefit
export const GRUNDNIVÅ = 250; // SEK/day grundnivå for low income parents
export const SGI_CAP = 49000; // Max monthly SGI
export const DEFAULT_BARNBIDRAG = 625; // Default child allowance per person
export const PRISBASBELOPP = 58800; // Prisbasbelopp 2025 (SEK)

// Default preferences
export const defaultPreferences = {
    deltid: "nej",
    ledigTid1: 6,
    minInkomst: 10000,
    strategy: "longer"
};
