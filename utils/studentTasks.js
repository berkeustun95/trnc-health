// Student Hub arrival tasks — storage and fetch. The rules live in studentTaskRules.js.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { KEY_CACHE, KEY_PROGRESS, parseCache, parseProgress } from './studentTaskRules'

export async function readCachedTasks() {
  try {
    return parseCache(await AsyncStorage.getItem(KEY_CACHE))
  } catch {
    return null
  }
}

// Every language's rows, not just the current one: the cache then survives a language
// switch made with no data, which is the situation two of these tasks exist to fix.
export async function fetchTasks() {
  const { data, error } = await supabase
    .from('student_tasks')
    .select('slug, icon, sort_order, external_url, student_task_i18n(lang, title, summary, steps, documents, hours, note)')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  // Zero rows is a fault, not an empty list: the table is seeded, and a session RLS
  // refuses gets [] with no error.
  if (!data?.length) throw new Error('student_tasks returned no rows')
  try {
    await AsyncStorage.setItem(KEY_CACHE, JSON.stringify({ fetchedAt: Date.now(), tasks: data }))
  } catch {}
  return data
}

export async function loadProgress() {
  try {
    return parseProgress(await AsyncStorage.getItem(KEY_PROGRESS))
  } catch {
    return {}
  }
}

export async function saveProgress(progress) {
  try {
    await AsyncStorage.setItem(KEY_PROGRESS, JSON.stringify(progress))
  } catch {}
}
