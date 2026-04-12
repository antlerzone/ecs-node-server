/** Type declaration for dateMalaysia.js (Malaysia UTC+8 date helpers). */
export function malaysiaDateRangeToUtcForQuery(
  fromYYYYMMDD: string | null,
  toYYYYMMDD: string | null
): { fromUtc: string | null; toUtc: string | null };
export function malaysiaDateToUtcDatetimeForDb(v: string | Date): string;
export function malaysiaWallClockToUtcDatetimeForDb(ymd: string, hh: number, mm: number): string | null;
export function utcDatetimeFromDbToMalaysiaDateOnly(v: string | Date | null): string;
export function utcDatetimeFromDbToMalaysiaDate(v: string | Date | null): string;
export function getTodayMalaysiaDate(): string;
export function getTodayPlusDaysMalaysia(days: number): string;
export function getMalaysiaMonthStartYmd(): string;
export function getMalaysiaMonthStartMonthsAgo(monthsAgo: number): string;
export function formatApiResponseDates(obj: unknown): unknown;
export const DEFAULT_DATE_KEYS: string[];
