/**
 * Malaysia lead-time rules — shared with API via `src/utils/cleanlemonBookingEligibility.js`.
 */
import {
  addDaysToMalaysiaYmd,
  getEarliestBookableMalaysiaYmd,
  getMalaysiaCalendarYmd,
  leadTimeToMinCalendarDayOffset,
  validateBookingLeadTimeForConfig,
  validateServiceInSelectedServices,
} from '../../../src/utils/cleanlemonBookingEligibility.js'

export type LeadTimeId =
  | 'twelve_hour'
  | 'same_day'
  | 'one_day'
  | 'two_day'
  | 'three_day'
  | 'four_day'
  | 'five_day'
  | 'six_day'
  | 'one_week'
  | 'two_week'
  | 'three_week'
  | 'four_week'
  | 'one_month'

export {
  addDaysToMalaysiaYmd,
  getEarliestBookableMalaysiaYmd,
  getMalaysiaCalendarYmd,
  leadTimeToMinCalendarDayOffset,
  validateBookingLeadTimeForConfig,
  validateServiceInSelectedServices,
}
