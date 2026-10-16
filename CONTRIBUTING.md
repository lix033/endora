# Contribuer à Endora

Merci de votre intérêt ! Toutes les contributions sont bienvenues : signalements de bugs, idées,
documentation, traductions et code. En participant, vous acceptez le [code de conduite](CODE_OF_CONDUCT.md).

## Signaler un bug ou proposer une idée

- Cherchez d'abord dans les [tickets existants](https://github.com/lix033/endora/issues).
- Ouvrez un ticket avec le modèle adapté : version d'Endora, système, étapes pour reproduire,
  résultat attendu et obtenu.
- Faille de sécurité : **pas de ticket public**, suivez [SECURITY.md](SECURITY.md).

## Proposer une modification

1. Pour un changement important, ouvrez d'abord un ticket pour en discuter.
2. Forkez le dépôt et créez une branche depuis `main` (`fix/…`, `feat/…`, `docs/…`).
3. Installez l'environnement :

   ```bash
   nvm use            # Node 24 (voir .nvmrc)
   npm ci
   npm run dev        # application avec rechargement à chaud
   ```

4. Avant d'ouvrir la pull request :

   ```bash
   npm run typecheck
   npm test
   ```

5. Ajoutez une ligne dans `CHANGELOG.md` (section « Non publié ») si le changement est visible par
   les utilisateurs.
6. Ouvrez la pull request en décrivant le quoi et le pourquoi ; la CI doit passer sur les trois
   systèmes.

## Conventions

- **Architecture** (voir [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md)) :
  - `src/shared/` : types et logique pure, sans dépendance Electron ;
  - `src/main/` : process principal, seul autorisé à accéder au réseau et aux fichiers ;
  - `src/preload/` : pont IPC minimal ;
  - `src/renderer/` : interface React, sans accès Node ni réseau.
- **Sécurité** : `contextIsolation`, `sandbox`, pas de `nodeIntegration` ; les scripts utilisateur
  s'exécutent dans le bac à sable dédié ; toute nouvelle entrée IPC valide ses paramètres.
- **Erreurs attendues** : renvoyées comme résultats typés, pas comme exceptions.
- **Tests** : chaque comportement a un test Vitest ; le réseau est testé contre des serveurs HTTP
  locaux réels, sans mock.
- **Langue** : interface, messages et documentation en français.
- **Style** : suivre le code existant (TypeScript strict, pas de point-virgule, guillemets simples).
- **Dépendances** : licences compatibles MIT uniquement ; justifier tout ajout dans la PR.

## Publier une version

Réservé aux mainteneurs : voir [docs/PUBLICATION.md](docs/PUBLICATION.md).
