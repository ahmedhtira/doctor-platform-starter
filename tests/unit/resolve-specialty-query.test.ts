import { describe, expect, it } from "vitest";
import { resolveSpecialtyFromQuery } from "@/lib/specialties/resolve-specialty-query";
import type { Specialty } from "@/lib/specialties/list-specialties";
import type { SpecialtyAlias } from "@/lib/specialties/list-specialty-aliases";

// Fixture mirrors a slice of the real seed (migrations 23/24) — pure
// data, no DB needed, since resolveSpecialtyFromQuery only ever reads
// its two array arguments.

function specialty(id: string, slug: string, name_fr: string, name_ar: string): Specialty {
  return { id, slug, name_fr, name_ar, created_at: "2026-01-01T00:00:00Z" };
}

function alias(specialty_id: string, aliasText: string, locale: "fr" | "ar"): SpecialtyAlias {
  return {
    id: `${specialty_id}-${aliasText}-${locale}`,
    specialty_id,
    alias: aliasText,
    locale,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const SPECIALTIES: Specialty[] = [
  specialty("1", "cardiologie", "Cardiologie", "أمراض القلب"),
  specialty("2", "dermatologie", "Dermatologie", "الأمراض الجلدية"),
  specialty("3", "medecine-dentaire", "Médecine dentaire", "طب الأسنان"),
  specialty("4", "medecine-generale", "Médecine générale", "الطب العام"),
  specialty("5", "rhumatologie", "Rhumatologie", "أمراض الروماتيزم"),
];

const ALIASES: SpecialtyAlias[] = [
  alias("1", "cardiologue", "fr"),
  alias("1", "cœur", "fr"),
  alias("1", "problème cardiaque", "fr"),
  alias("1", "قلب", "ar"),
  alias("2", "peau", "fr"),
  alias("2", "acné", "fr"),
  alias("3", "dentiste", "fr"),
  alias("3", "chirurgien-dentiste", "fr"),
  alias("3", "طبيب أسنان", "ar"),
  alias("4", "généraliste", "fr"),
  alias("4", "médecin de famille", "fr"),
  alias("5", "articulations", "fr"),
  alias("5", "douleurs articulaires", "fr"),
];

describe("resolveSpecialtyFromQuery", () => {
  it("resolves the exact canonical French name", () => {
    expect(resolveSpecialtyFromQuery("Cardiologie", SPECIALTIES, ALIASES)).toBe("cardiologie");
  });

  it("resolves the exact canonical Arabic name", () => {
    expect(resolveSpecialtyFromQuery("أمراض القلب", SPECIALTIES, ALIASES)).toBe("cardiologie");
  });

  it("resolves a single-word alias", () => {
    expect(resolveSpecialtyFromQuery("cardiologue", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("dentiste", SPECIALTIES, ALIASES)).toBe("medecine-dentaire");
  });

  it("resolves an everyday-wording alias distinct from the formal name", () => {
    expect(resolveSpecialtyFromQuery("cœur", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("généraliste", SPECIALTIES, ALIASES)).toBe("medecine-generale");
  });

  it("resolves a multi-word alias regardless of internal spacing", () => {
    expect(resolveSpecialtyFromQuery("problème  cardiaque", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("douleurs articulaires", SPECIALTIES, ALIASES)).toBe("rhumatologie");
  });

  it("resolves an Arabic alias", () => {
    expect(resolveSpecialtyFromQuery("طبيب أسنان", SPECIALTIES, ALIASES)).toBe("medecine-dentaire");
    expect(resolveSpecialtyFromQuery("قلب", SPECIALTIES, ALIASES)).toBe("cardiologie");
  });

  it("is accent-insensitive", () => {
    expect(resolveSpecialtyFromQuery("coeur", SPECIALTIES, ALIASES)).toBe("cardiologie"); // no œ ligature
    expect(resolveSpecialtyFromQuery("CŒUR", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("dermatologie", SPECIALTIES, ALIASES)).toBe("dermatologie");
  });

  it("is case-insensitive", () => {
    expect(resolveSpecialtyFromQuery("CARDIOLOGIE", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("Dentiste", SPECIALTIES, ALIASES)).toBe("medecine-dentaire");
  });

  it("resolves a partial/substring query", () => {
    expect(resolveSpecialtyFromQuery("cardio", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("dermat", SPECIALTIES, ALIASES)).toBe("dermatologie");
  });

  it("tolerates a small typo (bounded edit distance)", () => {
    expect(resolveSpecialtyFromQuery("cardiologye", SPECIALTIES, ALIASES)).toBe("cardiologie");
    expect(resolveSpecialtyFromQuery("dentist", SPECIALTIES, ALIASES)).toBe("medecine-dentaire");
    expect(resolveSpecialtyFromQuery("achne", SPECIALTIES, ALIASES)).toBe("dermatologie");
  });

  it("does not match a wildly different or unrelated word", () => {
    expect(resolveSpecialtyFromQuery("xyzzyplugh", SPECIALTIES, ALIASES)).toBeNull();
    expect(resolveSpecialtyFromQuery("comptabilité", SPECIALTIES, ALIASES)).toBeNull();
  });

  it("returns null for an empty or whitespace-only query", () => {
    expect(resolveSpecialtyFromQuery("", SPECIALTIES, ALIASES)).toBeNull();
    expect(resolveSpecialtyFromQuery("   ", SPECIALTIES, ALIASES)).toBeNull();
  });

  it("never invents a specialty not present in the supplied list", () => {
    const result = resolveSpecialtyFromQuery("cardiologue", SPECIALTIES, ALIASES);
    expect(SPECIALTIES.some((specialty) => specialty.slug === result)).toBe(true);
  });
});
