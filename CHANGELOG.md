# Journal des modifications

Toutes les évolutions notables d'Endora sont listées ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le
[versionnage sémantique](https://semver.org/lang/fr/). La section d'une version sert de notes de
release (voir [docs/PUBLICATION.md](docs/PUBLICATION.md)).

## [Non publié]

## [0.2.0] — 2026-10-16

### Corrigé

- Compatibilité avec TypeScript 7 : l'option `baseUrl`, supprimée, est retirée de `tsconfig.json`.

## [0.1.0] — 2026-10-16

Première version publique.

### Ajouté

- **Requêtes HTTP** : méthodes, paramètres synchronisés avec l'URL, en-têtes, bodies raw / form-data
  (fichiers) / x-www-form-urlencoded, HTTP/1.1 et HTTP/2 (ALPN, h2c), redirections, délais, taille
  maximale de réponse ; réponse formatée, brute, aperçu, en-têtes.
- **Organisation** : collections et dossiers, onglets avec aperçu, historique groupé par jour,
  requêtes libres sans collection, glisser-déposer, import/export collection v2.1.
- **Variables** : environnements, globales, variables de collection, valeurs initiales et courantes,
  secrets chiffrés, variables dynamiques, coloration et autocomplétion des `{{variables}}`.
- **Autorisation** : clé d'API, Bearer, Basic, Digest, OAuth 1.0, OAuth 2.0 (5 modes d'obtention du
  jeton), Hawk, AWS Signature v4, NTLM, Akamai EdgeGrid, JWT, ASAP, avec héritage.
- **Scripts et tests** : scripts avant la requête et après la réponse, API `pm.*`, assertions chai,
  exécution isolée, résultats des tests, console.
- **Collection Runner** : ordre d'exécution, itérations, délai, fichiers de données CSV/JSON,
  `setNextRequest`, rapport exportable.
- **Imports** : cURL, collections v1/v2/v2.1, environnements, sauvegarde complète, OpenAPI 3.0/3.1,
  Swagger 1.2/2.0, RAML 0.8/1.0, GraphQL, HAR, WSDL 1.1/2.0, WADL ; par fichier, lien ou texte.
- **Génération de code** dans 20 langages.
- **Application** : 5 thèmes avec synchronisation clair/sombre du système, raccourcis
  personnalisables, vérification des mises à jour.
- **Distribution** : installeurs macOS, Windows et Linux ; Homebrew, winget, Scoop et scripts
  d'installation.

[Non publié]: https://github.com/lix033/endora/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lix033/endora/releases/tag/v0.1.0
