import { DateTime } from "luxon";

export const EVENT_NAME = "KENYATTA UNIVERSITY ORCHESTRA";
export const EVENT_VENUE = "CONFICIOUS HALL";
export const EVENT_DATE = DateTime.local().set({
  day: 29,
  hour: 16, // 4 PM in 24-hour format
  minute: 0,
  second: 0,
  millisecond: 0,
});
