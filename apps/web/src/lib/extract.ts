/**
 * Pulls the things a test usually needs out of a message body:
 * one-time codes and links. The same logic backs GET /api/messages/:id/extract
 * so an agent gets exactly what the UI shows.
 */

export interface Extracted {
  codes: string[]
  links: string[]
}

const CODE_CONTEXT = /\b(code|otp|pin|passcode|verification)\b/i

export function extract(text: string): Extracted {
  const links = Array.from(new Set(text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []))

  const codes: string[] = []
  // Ports, ids and query params inside links are never the code.
  const prose = text.replace(/https?:\/\/\S+/g, " ")
  if (CODE_CONTEXT.test(prose)) {
    // "482913", "482 913", "482-913"
    for (const m of prose.matchAll(/\b(\d{3})[ -]?(\d{3})\b|\b(\d{4,8})\b/g)) {
      const code = m[3] ?? `${m[1]}${m[2]}`
      if (!codes.includes(code) && !/^(19|20)\d{2}$/.test(code))
        codes.push(code)
    }
  }

  return { codes: codes.slice(0, 2), links: links.slice(0, 3) }
}
