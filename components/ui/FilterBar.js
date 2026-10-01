import { ScrollView, View, StyleSheet } from 'react-native'

// The dropdown row above a module list (S3). flexShrink: 0 is the house rule: a fixed row
// above a scrolling list in a flex:1 column is otherwise compressed once the list overflows
// (crops its text; only visible with long lists, so Turkish finds it first). Children are
// Dropdowns (components/ui/Dropdown = FilterDropdown).
export default function FilterBar({ children, style }) {
  return (
    <View style={[s.wrap, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flexShrink: 0 },
  row:  { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
})
