# Endora — feuille de route

Stack : Electron + React + TypeScript (electron-vite), Zustand, CodeMirror 6,
undici côté process principal, stockage fichiers JSON (format compatible
collection v2.1) puis SQLite si nécessaire, Vitest.

Principe : toutes les requêtes réseau et l'exécution de scripts tournent dans le
process principal ou un worker isolé, jamais dans le renderer.
`contextIsolation` activé, `nodeIntegration` désactivé, IPC typé et minimal.

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Socle Electron/React/TS, IPC typé, sécurité, tests | fait |
| 1 | Requêteur HTTP : méthode, URL, params, en-têtes, body (raw/urlencoded/form-data), réponse (statut, temps, taille, en-têtes, body formaté) | fait (base) |
| 2 | Collections/dossiers, onglets, historique, persistance locale, import/export collection v2.1, coller/copier cURL | fait (base) |
| 3 | Environnements, globales, variables `{{var}}`, valeurs secrètes | fait (base) |
| 4 | Auth complète (API key → OAuth 2.0, AWS SigV4, Digest, NTLM, Hawk, EdgeGrid, JWT, ASAP) | fait (base) |
| 5 | Scripts pre-request/post-response sandboxés, API `pm.*`, tests chai, console | fait (base) |
| 6 | Collection Runner (itérations, délai, fichiers de données, rapport) + requêtes libres (sans collection) | fait (base) |
| 7 | Imports (cURL, OpenAPI, RAML, HAR, GraphQL, WSDL…) et génération de code | fait (base) |
| 8 | Cookies, proxy, certificats, SSL, réglages | |
| 9 | WebSocket, Socket.IO, SSE, GraphQL (introspection/subscriptions) | |
| 10 | gRPC, MQTT, MCP | |
| 11 | Mock server local ✔︎ (exemples, sessions, script, accès privé/public, déploiement auto), visualiseur, documentation/export PDF | en cours |
| 12 | Tests de performance, fichiers locaux + Git, recherche plein texte | |
| 13 | Thèmes ✔︎ et raccourcis ✔︎ (livrés avec les phases 3-5, comme l'onglet Paramètres et la vérification des mises à jour), interceptor/proxy de capture, Kafka, packaging et mises à jour | |
