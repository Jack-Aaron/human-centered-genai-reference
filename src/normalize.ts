export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}
