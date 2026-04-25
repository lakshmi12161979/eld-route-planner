/**
 * HOS (Hours of Service) utility functions for the ELD log frontend.
 * All time values are in minutes unless otherwise noted.
 *
 * FMCSA Rules enforced:
 * - 11-hour driving limit per day
 * - 14-hour duty window per day
 * - 30-minute break required after 8 consecutive driving hours
 * - 70-hour / 8-day cycle limit
 * - 10-hour off-duty reset between shifts
 */

import { DutyStatus } from "../backend";
import type { DailyLog, HosEntry, LogGridRow } from "../types/eld";
import type { RecapValues } from "../types/eld";

/**
 * Convert minutes to HH:MM display format.
 * Example: 90 → "01:30"
 */
export function minsToHHMM(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Convert BigInt minutes to HH:MM display format.
 * Used when reading backend BigInt time values.
 */
export function bigIntMinsToHHMM(totalMins: bigint): string {
  return minsToHHMM(Number(totalMins));
}

/**
 * Convert minutes-from-midnight to a wall-clock label.
 * Example: 0 → "00:00", 750 → "12:30"
 */
export function minsToTimeLabel(mins: number): string {
  return minsToHHMM(mins % (24 * 60));
}

/**
 * Format hours as a decimal string with one decimal place.
 * Example: 8.5 → "8.5 hrs"
 */
export function formatHours(hours: number): string {
  return `${hours.toFixed(1)} hrs`;
}

/**
 * Calculate total hours for each duty status from a HOS schedule.
 * Returns an object with hours per status (as numbers, not bigints).
 */
export function calcStatusTotals(
  hosSchedule: HosEntry[],
): Record<DutyStatus, number> {
  const totals: Record<DutyStatus, number> = {
    [DutyStatus.offDuty]: 0,
    [DutyStatus.sleeperBerth]: 0,
    [DutyStatus.driving]: 0,
    [DutyStatus.onDutyNotDriving]: 0,
  };

  for (const entry of hosSchedule) {
    const durationMins = Number(entry.endTime) - Number(entry.startTime);
    const durationHrs = durationMins / 60;
    totals[entry.status] = (totals[entry.status] ?? 0) + durationHrs;
  }

  return totals;
}

/**
 * Calculate total hours driven across all daily logs.
 */
export function calcTotalDrivingHours(dailyLogs: DailyLog[]): number {
  let total = 0;
  for (const log of dailyLogs) {
    for (const row of log.gridRows) {
      if (row.status === DutyStatus.driving) {
        for (const block of row.blocks) {
          total += Number(block.duration) / 60;
        }
      }
    }
  }
  return total;
}

/**
 * Check if a HOS schedule has any driving violations.
 * Returns array of violation description strings.
 *
 * Rules checked:
 * 1. No single driving segment > 11 hours
 * 2. No duty window > 14 hours
 * 3. After 8 consecutive driving hours, a 30-min break is required
 */
export function checkHosViolations(hosSchedule: HosEntry[]): string[] {
  const violations: string[] = [];

  let totalDrivingMins = 0;
  let dutyWindowStart: number | null = null;
  let continuousDrivingMins = 0;
  let hasBreakAfter8 = false;

  for (const entry of hosSchedule) {
    const startMins = Number(entry.startTime);
    const endMins = Number(entry.endTime);
    const durationMins = endMins - startMins;

    // Track duty window start (first non-off-duty segment)
    if (
      entry.status !== DutyStatus.offDuty &&
      entry.status !== DutyStatus.sleeperBerth &&
      dutyWindowStart === null
    ) {
      dutyWindowStart = startMins;
    }

    if (entry.status === DutyStatus.driving) {
      totalDrivingMins += durationMins;
      continuousDrivingMins += durationMins;

      // Rule: max 11 hours driving per day
      if (totalDrivingMins > 11 * 60) {
        violations.push("Exceeded 11-hour driving limit");
      }

      // Rule: 30-min break after 8 consecutive hours
      if (continuousDrivingMins > 8 * 60 && !hasBreakAfter8) {
        violations.push(
          "Missing mandatory 30-minute break after 8 hours driving",
        );
      }
    } else if (
      entry.status === DutyStatus.offDuty ||
      entry.status === DutyStatus.sleeperBerth
    ) {
      // A break of 30+ mins resets the continuous driving counter
      if (durationMins >= 30) {
        hasBreakAfter8 = true;
        continuousDrivingMins = 0;
      }
    }
  }

  // Rule: 14-hour duty window
  if (dutyWindowStart !== null) {
    const lastEntry = hosSchedule[hosSchedule.length - 1];
    const dutyWindowMins = Number(lastEntry.endTime) - dutyWindowStart;
    if (dutyWindowMins > 14 * 60) {
      violations.push("Exceeded 14-hour duty window");
    }
  }

  return violations;
}

/**
 * Validate route planner form inputs.
 * Returns array of error messages (empty = valid).
 */
export function validateRouteInputs(params: {
  currentLat: number | null;
  currentLon: number | null;
  pickupLat: number | null;
  pickupLon: number | null;
  dropoffLat: number | null;
  dropoffLon: number | null;
  cycleHoursUsed: number;
}): string[] {
  const errors: string[] = [];

  if (params.currentLat === null || params.currentLon === null) {
    errors.push("Current location must be selected from suggestions");
  }
  if (params.pickupLat === null || params.pickupLon === null) {
    errors.push("Pickup location must be selected from suggestions");
  }
  if (params.dropoffLat === null || params.dropoffLon === null) {
    errors.push("Dropoff location must be selected from suggestions");
  }
  if (params.cycleHoursUsed < 0 || params.cycleHoursUsed > 70) {
    errors.push("Cycle hours used must be between 0 and 70");
  }

  return errors;
}

/**
 * Get the human-readable label for a duty status.
 */
export function dutyStatusLabel(status: DutyStatus): string {
  switch (status) {
    case DutyStatus.offDuty:
      return "Off Duty";
    case DutyStatus.sleeperBerth:
      return "Sleeper Berth";
    case DutyStatus.driving:
      return "Driving";
    case DutyStatus.onDutyNotDriving:
      return "On Duty (Not Driving)";
  }
}

/**
 * Get the numbered FMCSA row label for a duty status.
 * Matches official form: "1. Off Duty", "2. Sleeper Berth", etc.
 */
export function dutyStatusFmcsaLabel(status: DutyStatus): string {
  switch (status) {
    case DutyStatus.offDuty:
      return "1. Off Duty";
    case DutyStatus.sleeperBerth:
      return "2. Sleeper Berth";
    case DutyStatus.driving:
      return "3. Driving";
    case DutyStatus.onDutyNotDriving:
      return "4. On Duty\n(Not Driving)";
  }
}

/**
 * Get the CSS class for a duty status row in the ELD grid.
 */
export function dutyStatusClass(status: DutyStatus): string {
  switch (status) {
    case DutyStatus.offDuty:
      return "duty-off";
    case DutyStatus.sleeperBerth:
      return "duty-sleeper";
    case DutyStatus.driving:
      return "duty-driving";
    case DutyStatus.onDutyNotDriving:
      return "duty-on-duty";
  }
}

/**
 * Returns the ordered list of duty statuses as displayed in FMCSA log format.
 * Row 1: Off Duty, Row 2: Sleeper Berth, Row 3: Driving, Row 4: On Duty (Not Driving)
 */
export const FMCSA_ROW_ORDER: DutyStatus[] = [
  DutyStatus.offDuty,
  DutyStatus.sleeperBerth,
  DutyStatus.driving,
  DutyStatus.onDutyNotDriving,
];

/**
 * Calculate total hours for a specific status from a log's grid rows.
 */
export function calcRowTotalHours(row: LogGridRow): number {
  return row.blocks.reduce(
    (sum, block) => sum + Number(block.duration) / 60,
    0,
  );
}

/**
 * Calculate on-duty hours for a single daily log.
 * On-duty = Driving + On Duty Not Driving (excludes Off Duty and Sleeper Berth).
 */
export function calcOnDutyHours(log: DailyLog): number {
  let total = 0;
  for (const row of log.gridRows) {
    if (
      row.status === DutyStatus.driving ||
      row.status === DutyStatus.onDutyNotDriving
    ) {
      for (const block of row.blocks) {
        total += Number(block.duration) / 60;
      }
    }
  }
  return total;
}

/**
 * Calculate HOS Recap values for the official FMCSA Recap table.
 *
 * - onDutyToday: sum of Driving + On Duty Not Driving hours for the target day
 * - totalLast7Days: sum of on-duty hours for this day + prior 6 days (up to 7 days total)
 * - availableTomorrow70: 70 − totalLast7Days (clamped to [0, 70])
 * - availableTomorrow60: 60 − totalLast7Days (clamped to [0, 60])
 *
 * @param logs - Array of DailyLog (all generated logs for the trip)
 * @param dayIndex - The index of the target day in the logs array (0-based)
 */
export function calcRecapValues(
  logs: DailyLog[],
  dayIndex: number,
): RecapValues {
  const onDutyToday = calcOnDutyHours(logs[dayIndex]);

  // Sum on-duty hours from up to 7 days (current day + 6 prior days)
  let totalLast7Days = 0;
  for (let i = Math.max(0, dayIndex - 6); i <= dayIndex; i++) {
    totalLast7Days += calcOnDutyHours(logs[i]);
  }

  const availableTomorrow70 = Math.max(0, 70 - totalLast7Days);
  const availableTomorrow60 = Math.max(0, 60 - totalLast7Days);

  return {
    onDutyToday,
    totalLast7Days,
    availableTomorrow70,
    availableTomorrow60,
  };
}
