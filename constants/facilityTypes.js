// The four human-health facility types. ADA's health surface is a DIRECTORY:
// these types do not take in-app appointments. Booking is only for the
// service types (vet, grooming, garage). Shared so the "no booking / no
// availability editor / no requests" gate has one source of truth.
export const HEALTH_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
