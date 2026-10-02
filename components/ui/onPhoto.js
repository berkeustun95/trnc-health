import { createContext, useContext } from 'react'

// True inside a ModuleScreen (content over a module photo). The kit reads it: ScreenHeader goes
// white with a round white back button, SectionHeader puts its title on a dark pill, EmptyState /
// ErrorState sit in a white card, Card / ListCard become 93% white. Screens never pass it by hand.
export const OnPhotoContext = createContext(false)
export const useOnPhoto = () => useContext(OnPhotoContext)
