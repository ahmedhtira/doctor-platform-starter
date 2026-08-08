"use client";

import { cn } from "@/lib/utils";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";

function formatSlotTime(iso: string, timezone: string, locale: string): string {
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

export function SlotPicker({
  date,
  onDateChange,
  minDate,
  slots,
  selectedSlotStart,
  onSelectSlot,
  clinicTimezone,
  locale,
  loading,
  dateLabel,
  loadingLabel,
  emptyLabel,
}: {
  date: string;
  onDateChange: (date: string) => void;
  minDate: string;
  slots: AvailableSlot[];
  selectedSlotStart: string | null;
  onSelectSlot: (slotStart: string) => void;
  clinicTimezone: string;
  locale: string;
  loading: boolean;
  dateLabel: string;
  loadingLabel: string;
  emptyLabel: string;
}) {
  return (
    <div>
      <label htmlFor="booking-date" className="text-muted-foreground text-sm font-medium">
        {dateLabel}
      </label>
      <input
        id="booking-date"
        type="date"
        value={date}
        min={minDate}
        onChange={(event) => onDateChange(event.target.value)}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 h-9 w-full max-w-56 rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3"
      />

      <div className="mt-4 min-h-9">
        {loading ? (
          <p className="text-muted-foreground text-sm">{loadingLabel}</p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => {
              const isSelected = slot.slotStart === selectedSlotStart;
              return (
                <button
                  key={slot.slotStart}
                  type="button"
                  onClick={() => onSelectSlot(slot.slotStart)}
                  aria-pressed={isSelected}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-input hover:bg-muted",
                  )}
                >
                  {formatSlotTime(slot.slotStart, clinicTimezone, locale)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
