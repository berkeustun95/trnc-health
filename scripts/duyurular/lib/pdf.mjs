// PDF → plain text, used ONLY to read a deadline. The text is never stored, logged or returned
// past the caller (extractDeadline). unpdf 1.8.1 (pinned, CI-only: scripts/duyurular/package.json).

import { extractText, getDocumentProxy } from 'unpdf'

const MAX_PAGES = 6

export async function pdfText(bytes) {
  const doc = await getDocumentProxy(new Uint8Array(bytes))
  try {
    if (doc.numPages > MAX_PAGES) {
      const parts = []
      for (let i = 1; i <= MAX_PAGES; i++) {
        const page = await doc.getPage(i)
        const c = await page.getTextContent()
        parts.push(c.items.map(it => it.str).join(' '))
      }
      return { text: parts.join('\n'), pages: doc.numPages }
    }
    const { text, totalPages } = await extractText(doc, { mergePages: true })
    return { text, pages: totalPages }
  } finally {
    await doc.destroy?.()
  }
}
