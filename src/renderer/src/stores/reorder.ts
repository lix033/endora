/**
 * Déplace l'élément `id` juste avant `beforeId`, ou à la fin si `beforeId` est nul.
 * Renvoie le tableau d'origine quand rien ne change (élément inconnu, déposé sur lui-même ou à sa place).
 */
export function moveBefore<T extends { id: string }>(items: T[], id: string, beforeId: string | null): T[] {
  const from = items.findIndex((i) => i.id === id)
  if (from === -1 || id === beforeId) return items
  const rest = items.filter((i) => i.id !== id)
  const to = beforeId === null ? rest.length : rest.findIndex((i) => i.id === beforeId)
  if (to === -1 || to === from) return items
  rest.splice(to, 0, items[from]!)
  return rest
}
