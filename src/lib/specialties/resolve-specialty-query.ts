import { normalizeSearchText } from "@/lib/utils";
import type { Specialty } from "./list-specialties";
import type { SpecialtyAlias } from "./list-specialty-aliases";

/**
 * Classic edit-distance DP, O(a*b) — candidate strings here are short
 * (specialty names / aliases, a handful of words at most), so this is
 * cheap even compared against every candidate on every search.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i][0] = i;
  for (let j = 0; j < cols; j++) distances[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1, // deletion
        distances[i][j - 1] + 1, // insertion
        distances[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return distances[rows - 1][cols - 1];
}

type Candidate = { text: string; slug: string };

/**
 * Resolves free-text patient wording ("cœur", "généraliste",
 * "dentiste") to a canonical specialty slug — accent- and
 * case-insensitive (via normalizeSearchText), tolerant of substrings
 * ("cardio" -> "cardiologie") and small typos (bounded edit distance,
 * not unlimited fuzziness — a wildly different word should never match).
 * Matches against both specialty display names (fr/ar) and every row in
 * specialty_aliases; never invents or duplicates a specialty — the
 * result is always one of the slugs already present in `specialties`,
 * or null if nothing is close enough to be a confident match.
 */
export function resolveSpecialtyFromQuery(
  rawQuery: string,
  specialties: Specialty[],
  aliases: SpecialtyAlias[],
): string | null {
  const query = normalizeSearchText(rawQuery);
  if (!query) return null;

  const specialtyById = new Map(specialties.map((specialty) => [specialty.id, specialty]));

  const candidates: Candidate[] = [];
  for (const specialty of specialties) {
    candidates.push({ text: normalizeSearchText(specialty.name_fr), slug: specialty.slug });
    candidates.push({ text: normalizeSearchText(specialty.name_ar), slug: specialty.slug });
  }
  for (const alias of aliases) {
    const specialty = specialtyById.get(alias.specialty_id);
    if (!specialty) continue;
    candidates.push({ text: normalizeSearchText(alias.alias), slug: specialty.slug });
  }

  const exact = candidates.find((candidate) => candidate.text === query);
  if (exact) return exact.slug;

  const substring = candidates.find(
    (candidate) => candidate.text.includes(query) || query.includes(candidate.text),
  );
  if (substring) return substring.slug;

  // Typo tolerance only for reasonably short queries — a long free-text
  // sentence isn't a plausible near-miss of any single specialty/alias,
  // and comparing it would just risk a nonsense match.
  if (query.length > 24) return null;

  let best: { slug: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const threshold = candidate.text.length <= 5 ? 1 : 2;
    const distance = levenshteinDistance(query, candidate.text);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { slug: candidate.slug, distance };
    }
  }

  return best?.slug ?? null;
}
