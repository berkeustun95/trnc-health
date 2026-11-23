import { Linking } from 'react-native'
import { logContactEvent } from './logContactEvent'

// Velesbit Postası Home banner tap. Logged FIRST (utils/logContactEvent never throws; an insert the server refuses is dropped
// quietly), then the site opens in the EXTERNAL browser on both platforms, never an in-app browser (Berke, 2026-11-23):
// some outlets in the Veles feed carry casino and lottery ads, and ADA declares 13-17 audiences under Play Families, so that
// content must not render inside ADA. expo-web-browser is never loaded here. Never throws.
export const VELES_URL = 'https://velesbitpostasi.com/'
// Identifies the link, not a person: one fixed UUID so the monthly counts group under one entity.
export const VELES_ENTITY_ID = '3b3f075c-4a8d-4470-8f65-8ec5cabe0a0e'

export async function openVeles(lang) {
  try {
    logContactEvent('news', VELES_ENTITY_ID, 'website', null, lang)
    await Linking.openURL(VELES_URL)
    return true
  } catch {
    return false
  }
}
