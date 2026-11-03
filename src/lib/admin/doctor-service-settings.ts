import { z } from "zod";

// TND has three decimal places. Parse the decimal string directly so money is
// stored as integer millimes, without floating-point rounding or truncation.
export function parseTndMillimes(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const millimes = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return millimes > 0 && millimes <= 10_000_000 ? millimes : null;
}

export const doctorServiceSettingsSchema = z
  .object({
    sosEnabled: z.boolean(),
    sosPhone: z.string().trim().max(30),
    sosArea: z.string().trim().max(160),
    paymentRequired: z.boolean(),
    paymentMode: z.enum(["deposit", "full"]),
    paymentAmount: z.string().trim().max(20),
    paymentTerms: z.string().trim().max(2000),
    recipientName: z.string().trim().max(160),
    providerName: z.string().trim().max(80),
    accountReference: z.string().trim().max(200),
  })
  .superRefine((value, ctx) => {
    if (
      (value.sosEnabled || value.sosPhone) &&
      (!/^\+?[0-9 ()-]{6,30}$/.test(value.sosPhone) || value.sosPhone.replace(/\D/g, "").length < 6)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sosPhone"],
        message: "Enter a valid SOS phone number.",
      });
    }
    if (
      (value.paymentRequired || value.paymentAmount) &&
      parseTndMillimes(value.paymentAmount) === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentAmount"],
        message: "Enter a positive TND amount with at most three decimals (maximum 10,000 TND).",
      });
    }
    if (value.paymentRequired && !value.paymentTerms) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentTerms"],
        message: "Cancellation and refund terms are required.",
      });
    }
  });

export type DoctorServiceSettings = z.infer<typeof doctorServiceSettingsSchema>;

export const defaultDoctorServiceSettings: DoctorServiceSettings = {
  sosEnabled: false,
  sosPhone: "",
  sosArea: "",
  paymentRequired: false,
  paymentMode: "deposit",
  paymentAmount: "",
  paymentTerms: "",
  recipientName: "",
  providerName: "",
  accountReference: "",
};

export function serviceSettingsPayload(settings: DoctorServiceSettings) {
  const { paymentAmount, ...rest } = doctorServiceSettingsSchema.parse(settings);
  return { ...rest, paymentAmountMillimes: parseTndMillimes(paymentAmount) };
}
