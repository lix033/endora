export type Params = Record<string, string | number>

/** Un message : texte avec `{param}` remplacés, ou fonction (pluriels, accords). */
export type Msg = string | ((p: Params) => string)

/** Traduction complète d'un jeu de messages anglais : une clé manquante est une erreur de type. */
export type Translation<T> = { [K in keyof T]: Msg }
