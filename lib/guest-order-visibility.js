/**
 * Guest order public-tracking visibility and conversion linking rules.
 * Spec: 45-day window; active returns stay visible until closed.
 */

export const GUEST_TRACK_WINDOW_DAYS = Number(process.env.GUEST_TRACK_WINDOW_DAYS ?? 45);

/** Return statuses where the return process is still open. */
export const ACTIVE_RETURN_STATUSES = [
  'REQUESTED',
  'ELIGIBILITY_REVIEW',
  'APPROVED',
  'LABEL_GENERATED',
  'IN_TRANSIT',
  'RECEIVED',
  'UNDER_INSPECTION',
];

export function guestTrackCutoffDate(now = new Date()) {
  return new Date(now.getTime() - GUEST_TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function isActiveReturnStatus(status) {
  return ACTIVE_RETURN_STATUSES.includes(String(status || '').toUpperCase());
}
