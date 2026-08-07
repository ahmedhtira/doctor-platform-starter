/**
 * Shared presentation helper for the photo-placeholder monogram used
 * anywhere a doctor doesn't (yet) have a real photo — the profile hero and
 * the search result cards both use this so the same name always produces
 * the same monogram.
 */
export function getInitials(fullName: string): string {
  const withoutTitle = fullName.replace(/^(Dr\.?|Pr\.?)\s+/i, "");
  const parts = withoutTitle.split(" ").filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
