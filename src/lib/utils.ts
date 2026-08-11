import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * French ligatures (œ/æ) are separate Unicode letters, not compatibility
 * decompositions of "o"+"e" / "a"+"e" — neither NFD nor NFKD normalize
 * decomposes them (verified: "œ".normalize("NFKD") is still "œ"), so
 * they need an explicit fold before the generic diacritic-stripping
 * step below, or a word like "cœur" never lines up with "coeur".
 */
function foldLigatures(value: string): string {
  // Case doesn't need preserving here — both callers lowercase their
  // result afterward regardless.
  return value.replace(/œ/gi, "oe").replace(/æ/gi, "ae");
}

/**
 * Derives a URL-safe slug from a display name (e.g. a doctor's full
 * name) -- lowercase, accents stripped (NFD-decompose + drop combining
 * marks, so "Étienne" -> "etienne"), non-alphanumeric runs collapsed to
 * a single hyphen, no leading/trailing hyphen. Matches the
 * `[a-z0-9]+(-[a-z0-9]+)*` pattern the admin create/edit forms already
 * validate slugs against.
 */
export function slugify(value: string): string {
  return foldLigatures(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug suggestion specifically for a doctor's public URL — strips a
 * leading title (Dr./Pr., with or without the period, fr or ar) before
 * slugifying, so "Dr Amira Ben Salah" suggests "amira-ben-salah" rather
 * than "dr-amira-ben-salah". A suggestion only: the admin form still
 * lets this be edited before submit.
 */
export function deriveDoctorSlugSuggestion(fullName: string): string {
  const withoutTitle = fullName.replace(/^\s*(dr|pr|د|أ)\.?\s+/i, "");
  return slugify(withoutTitle);
}

/**
 * Normalizes free text for fuzzy/alias search comparisons — lowercase,
 * accents stripped (same NFD approach as slugify), internal whitespace
 * collapsed, trimmed. Unlike slugify, spaces are kept (not turned into
 * hyphens) so multi-word aliases like "problème cardiaque" still compare
 * word-for-word against typed queries like "Problème  Cardiaque".
 */
export function normalizeSearchText(value: string): string {
  return foldLigatures(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
