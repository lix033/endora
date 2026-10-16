# Journal des modifications

Toutes les évolutions notables d'Endora sont listées ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le
[versionnage sémantique](https://semver.org/lang/fr/). La section d'une version sert de notes de
release (voir [docs/PUBLICATION.md](docs/PUBLICATION.md)).

## [Non publié]

## [0.4.0] — 2026-10-16

### Ajouté

- **Beautify (Prettier)** : bouton « Beautify » et raccourci ⌘B / Ctrl+B (modifiable) pour mettre
  en forme le body brut (JSON, XML, HTML, JavaScript), les scripts pre-request / post-response et
  les scripts de mock. Les `{{variables}}` sont conservées et les objets JSON dépliés ; ⌘Z annule la
  mise en forme ; un code invalide affiche l'erreur avec sa position.
- **Onglets qui se souviennent** : en revenant sur un onglet, on retrouve le sous-onglet (Params,
  Body…), le mode du body, la vue de la réponse (Pretty, Raw, Headers…), la phase des scripts, les
  filtres, ainsi que le curseur, la sélection, le défilement et l'historique d'annulation des
  éditeurs. Le script d'un mock en cours d'édition n'est plus perdu en changeant d'onglet.
- **Volets redimensionnables** : barre latérale, séparation requête/réponse et panneau de code se
  règlent à la souris (ou au clavier) ; double clic pour revenir à la taille par défaut. Les tailles
  sont mémorisées.

### Modifié

- **Responsivité** : l'interface s'adapte à la place disponible (petite fenêtre, panneau de code
  ouvert, grand écran) : barre d'URL sur deux lignes, champs d'auth et éditeur de scripts empilés,
  onglets et statistiques de réponse qui passent à la ligne, Runner et Services réorganisés. Taille
  minimale de la fenêtre abaissée à 760 × 520.
- **Défilement** : les barres d'onglets défilent à la molette et l'onglet actif reste visible.
- **Pretty** : le XML et le HTML de la réponse sont mis en forme (jusqu'à 512 Ko).

### Corrigé

- Plus d'éclair bleu nuit au démarrage : la fenêtre et l'interface s'ouvrent directement aux
  couleurs du thème choisi.
- Une URL longue ou une ligne de réponse très longue élargissait toute l'interface au-delà de la
  fenêtre (boutons Send/Save hors écran).
- La vue Pretty arrondissait les grands entiers JSON (ex. identifiants sur 19 chiffres).
- Les valeurs d'en-têtes de réponse très longues débordaient au lieu de passer à la ligne.
- ⌘S (raccourci « Enregistrer ») et le menu Fichier › Enregistrer enregistrent le script d'un mock
  dans Services ; le raccourci était intercepté sans effet.

## [0.3.1] — 2026-10-16

### Ajouté

- **Thème Vantablack** : noir absolu sur toute l'interface (fond, panneaux, éditeurs), pensé pour
  les écrans OLED. Disponible dans Paramètres › Thèmes, en thème fixe ou comme thème sombre de la
  synchronisation système.

### Corrigé

- Une nouvelle fenêtre s'ouvre avec le fond du thème choisi en mode fixe, et non plus celui du
  thème sombre ou clair du système.

## [0.3.0] — 2026-10-16

### Ajouté

- **Langues** : interface en anglais (par défaut) et en français, réglable dans Paramètres ›
  Général. Les termes familiers des clients d'API restent identiques dans les deux langues
  (Bearer Token, API Key, Headers, Body, Pre-request…).
- **Mises à jour automatiques** : vérification au démarrage puis toutes les 6 heures. Les petites
  mises à jour (correctifs) se téléchargent en arrière-plan et s'installent au redémarrage ; les
  grosses mises à jour attendent l'accord de l'utilisateur (notification, bouton « Installer »).
  Réglable dans Paramètres › Mises à jour.

### Modifié

- **Langue par défaut** : l'interface s'ouvre désormais en anglais ; le français se choisit dans
  Paramètres › Général › Langue.
- **Mises à jour** : cette version est la dernière à installer manuellement ; les suivantes
  arrivent automatiquement (petites mises à jour) ou en un clic (grosses mises à jour).

### Corrigé

- **Mock servers** : le bouton de création restait inactif quand l'onglet Services était restauré
  au démarrage ; une erreur de création bloquait le bouton sans message.

## [0.2.2] — 2026-10-16

### Ajouté

- **Barre du haut** : logo, accès aux espaces de travail (bientôt disponibles), notifications
  (mises à jour disponibles, avec pastille), services et paramètres.
- **Mock servers** (Services) : autant de mocks que voulu, créés depuis une collection, avec une URL
  automatique ; accès public ou privé (clé), déploiement automatique des modifications, sessions
  (`x-mock-session`), script injecté exécuté à chaque requête (`pm.request`, `pm.response`,
  `pm.state`), journal des requêtes. Les mocks actifs redémarrent avec l'application.
- **Exemples de réponse** : « Enregistrer comme exemple » sur une réponse ; les mocks les servent.

### Modifié

- **Paramètres › Mises à jour** : la section « À propos » n'affiche plus que la version et le
  stockage des secrets.

### Corrigé

- **macOS** : l'application est signée (Developer ID) et notarisée par Apple ; Gatekeeper ne
  l'empêche plus de s'ouvrir. Le build macOS de la 0.2.1 échouait à la signature.

## [0.2.1] — 2026-10-16

### Ajouté

- **Onglets** : réorganisation par glisser-déposer ; renommage par double-clic ou par le menu
  contextuel (renomme aussi la requête, le dossier, la collection ou l'environnement affiché).

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
