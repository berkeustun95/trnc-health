// The delete confirmation tells the seller what their chats will show: since 2026-11-12 a deleted listing reads
// mkChatListingRemoved in the seller's own chats, so the copy must quote that language's exact words.
const { LANGUAGES, t, hasOwnTranslation } = require('../constants/i18n')

test('nine languages', () => expect(LANGUAGES).toHaveLength(9))

test.each(LANGUAGES.map(l => l.key))('%s: mkDeleteBody quotes mkChatListingRemoved', lang => {
  expect(hasOwnTranslation('mkDeleteBody', lang)).toBe(true)
  expect(hasOwnTranslation('mkChatListingRemoved', lang)).toBe(true)
  expect(t('mkDeleteBody', lang)).toContain(t('mkChatListingRemoved', lang))
})
