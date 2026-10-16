# Politique de sécurité

## Versions prises en charge

Les correctifs de sécurité sont publiés pour la dernière version d'Endora. Mettez à jour avant de
signaler un problème (voir [docs/INSTALLATION.md](docs/INSTALLATION.md#mettre-à-jour)).

## Signaler une vulnérabilité

**N'ouvrez pas de ticket public.** Utilisez le
[signalement privé de GitHub](https://github.com/lix033/endora/security/advisories/new) (onglet
Security › Report a vulnerability), ou écrivez à julienkolou03@gmail.com.

Indiquez la version, le système, une description de l'impact et les étapes de reproduction. Nous
accusons réception sous 72 heures et vous tenons informé jusqu'à la correction ; le crédit vous est
attribué dans les notes de release si vous le souhaitez.

## Modèle de sécurité

- L'interface (renderer) est isolée : `contextIsolation`, `sandbox`, pas d'accès Node ; le réseau et
  les fichiers passent par le process principal via une API IPC limitée, réservée aux fenêtres de
  l'application.
- Les scripts des collections s'exécutent dans une fenêtre cachée sandboxée, sans Node ni accès
  réseau direct, avec un délai maximal ; `pm.sendRequest` passe par le process principal.
- Les aperçus HTML des réponses sont affichés dans un iframe `sandbox` sans script.
- Les valeurs secrètes sont chiffrées sur disque par le trousseau du système.
- Endora n'envoie aucune télémétrie ; seule la vérification des mises à jour contacte GitHub
  (désactivable dans les paramètres).

Importer une collection exécute ses scripts lors de l'envoi des requêtes : n'importez que des
collections de sources de confiance, comme avec tout client API.
