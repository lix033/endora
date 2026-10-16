// Variables : portées, variables dynamiques, éditeurs de variables.

import type { Translation } from '../types'

export const en = {
  'scope.local': 'Local',
  'scope.data': 'Data',
  'scope.environment': 'Environment',
  'scope.collection': 'Collection',
  'scope.globals': 'Global',

  'dyn.uuid': 'UUID v4',
  'dyn.timestamp': 'Unix timestamp (seconds)',
  'dyn.isoTimestamp': 'ISO 8601 timestamp (UTC)',
  'dyn.randomInt': 'Integer between 0 and 1000',
  'dyn.randomBoolean': 'true or false',
  'dyn.randomAlphaNumeric': 'Alphanumeric character',
  'dyn.randomHexColor': 'Hex color',
  'dyn.randomIP': 'IPv4 address',
  'dyn.randomFirstName': 'First name',
  'dyn.randomLastName': 'Last name',
  'dyn.randomFullName': 'Full name',
  'dyn.randomEmail': 'Email address',
  'dyn.randomWord': 'Word',
  'dyn.randomLoremSentence': 'Sentence',

  'var.initial': 'Initial',
  'var.current': 'Current',
  'var.scope': 'Scope',
  'var.dynamic': (p) => `Dynamic variable: ${p['description']}, generated on every send.`,
  'var.unresolved': 'Unresolved variable. Define it in the active environment, the collection or the globals.'
} satisfies Translation<Record<string, unknown>>

export const fr: Translation<typeof en> = {
  'scope.local': 'Locale',
  'scope.data': 'Données',
  'scope.environment': 'Environnement',
  'scope.collection': 'Collection',
  'scope.globals': 'Globale',

  'dyn.uuid': 'UUID v4',
  'dyn.timestamp': 'Horodatage Unix (secondes)',
  'dyn.isoTimestamp': 'Horodatage ISO 8601 (UTC)',
  'dyn.randomInt': 'Entier entre 0 et 1000',
  'dyn.randomBoolean': 'true ou false',
  'dyn.randomAlphaNumeric': 'Caractère alphanumérique',
  'dyn.randomHexColor': 'Couleur hexadécimale',
  'dyn.randomIP': 'Adresse IPv4',
  'dyn.randomFirstName': 'Prénom',
  'dyn.randomLastName': 'Nom',
  'dyn.randomFullName': 'Nom complet',
  'dyn.randomEmail': 'Adresse e-mail',
  'dyn.randomWord': 'Mot',
  'dyn.randomLoremSentence': 'Phrase',

  'var.initial': 'Initiale',
  'var.current': 'Courante',
  'var.scope': 'Portée',
  'var.dynamic': (p) => `Variable dynamique : ${p['description']}, générée à chaque envoi.`,
  'var.unresolved': 'Variable non résolue. Définissez-la dans l’environnement actif, la collection ou les globales.'
}
