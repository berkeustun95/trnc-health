export const PRESET_AVATARS = [
  { id: 'av1', emoji: '😊', bg: '#FFD6A5' },
  { id: 'av2', emoji: '😎', bg: '#CAFFBF' },
  { id: 'av3', emoji: '🤗', bg: '#9BF6FF' },
  { id: 'av4', emoji: '😄', bg: '#BDB2FF' },
  { id: 'av5', emoji: '😌', bg: '#FFC6FF' },
  { id: 'av6', emoji: '🧐', bg: '#A8E6CF' },
  { id: 'av7', emoji: '🥳', bg: '#FFB7B2' },
  { id: 'av8', emoji: '😇', bg: '#B5EAD7' },
  { id: 'av9', emoji: '🤩', bg: '#C7CEEA' },
]

export function getPreset(avatarUrl) {
  if (!avatarUrl?.startsWith('preset:')) return null
  const id = avatarUrl.replace('preset:', '')
  return PRESET_AVATARS.find(a => a.id === id) ?? null
}
