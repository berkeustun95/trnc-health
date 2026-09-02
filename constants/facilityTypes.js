// The four human-health facility types. ADA's health surface is a DIRECTORY.
// It was once the ONLY directory — every other type could take an in-app
// appointment, and this list was the gate that kept bookings away from health.
// 20261004 removed bookings entirely, so the whole app is a directory now and
// nothing branches on this for booking any more. Still used for type grouping.
export const HEALTH_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
