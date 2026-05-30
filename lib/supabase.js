import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jeihxnwqytnxtytgkzgf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaWh4bndxeXRueHR5dGdremdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzEzNTUsImV4cCI6MjA5NTc0NzM1NX0.wWYmD2R2T3mzQ_y1moIVca8cjvLOgYQjG8nz7W0vEJw'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})