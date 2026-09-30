// KITOB hotel classes — shared by the Oteller tab and scripts/import-kitob-hotels.mjs.
//
// The ten keys are the vocabulary of hotels_kitob_class_check (20261059). verify_schema.sql
// asserts the same ten as an exact set; change all three together.
//
// ORDER is the display order in the Sınıf dropdown: stars high to low, then the
// non-star types.
export const HOTEL_CLASSES = [
  'star5', 'star4', 'star3', 'star2', 'star1',
  'boutique', 'holiday_village', 'bungalow', 'apart', 'special_certified',
]

export const HOTEL_CLASS_LABEL_KEY = {
  star5:             'hotelClassStar5',
  star4:             'hotelClassStar4',
  star3:             'hotelClassStar3',
  star2:             'hotelClassStar2',
  star1:             'hotelClassStar1',
  boutique:          'hotelClassBoutique',
  holiday_village:   'hotelClassHolidayVillage',
  bungalow:          'hotelClassBungalow',
  apart:             'hotelClassApart',
  special_certified: 'hotelClassSpecialCertified',
}

// Star count for the card's star row; 0 for the non-star types.
export const HOTEL_CLASS_STARS = { star5: 5, star4: 4, star3: 3, star2: 2, star1: 1 }
