[English](README.md) | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | **Français** | [Deutsch](README.de.md) | [Español](README.es.md)

# Diple Docs — surligner et commenter des documents Markdown pour l’IA (plugin Hermes Desktop)

Ouvrez un fichier `.md` dans Hermes Desktop, surlignez des passages, écrivez des commentaires et transmettez-les à l’IA dans votre chat ; chaque annotation garde sa place dans le fichier et indique si elle a été envoyée, si l’IA y a répondu ou si elle est résolue.

> **Le nom.** La *diplè* (›) est le signe que les scribes grecs traçaient en marge pour renvoyer une ligne à son commentaire. Diple Docs (圈批·文档) est le membre documents de la famille ; [Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) est le membre chat.

> **Non officiel.** Ce plugin est communautaire. Il n’est ni créé, ni vérifié, ni pris en charge par Nous Research ou le projet Hermes Agent.

## Fonctionnalités

- **Une page de document en lecture seule** — ouvre un fichier `.md` / `.markdown` dans son propre onglet, au même endroit que l’aperçu Hermes : à côté du chat, à sa droite. Affichages **Rendu** et **Source**, **Recharger** et **Afficher dans le Finder**. Le plugin ne modifie jamais le document.
- **Annoter une sélection** — sélectionnez du texte et cliquez sur **Annoter**. L’éditeur s’ouvre juste sous le passage et la sélection garde une légère teinte temporaire, pour voir ce que vous annotez. Rien n’est encore ajouté.
- **Enregistrée, donc listée** — **Enregistrer** avec un commentaire crée un *commentaire* (l’IA doit y répondre) ; **Enregistrer** avec le champ vide crée un *surlignage* (fond seulement). Ce n’est qu’alors que l’annotation entre dans la liste et devient l’annotation courante. Un brouillon vide disparaît si vous cliquez ailleurs ou appuyez sur <kbd>Échap</kbd>. Un brouillon avec du texte n’est pas perdu si vous cliquez ailleurs, passez à une autre annotation, fermez la page ou la rechargez ; seuls <kbd>Échap</kbd> ou **×** l’abandonnent. Quand le fichier est actualisé, le brouillon suit son passage ; s’il est introuvable, on vous demande de le sélectionner à nouveau. Si une autre fenêtre a enregistré le même passage entre-temps, vous choisissez : **Garder l’existant**, **Remplacer par le mien** ou **Fusionner**.
- **La liste d’annotations** — toutes les annotations du fichier dans l’ordre du document, avec des filtres (Toutes, À envoyer, Envoyées, Répondues, Original modifié, Résolues). Sur une carte : aller au passage, modifier le commentaire, marquer résolue ou rouvrir, supprimer (avec annulation), envoyer celle-ci.
- **Annotation en attente précédente / suivante** — deux flèches dans l’en-tête de la liste (et dans la barre d’état en marge) parcourent ce qui n’est pas encore résolu.
- **Effacer en lot, avec annulation** — le menu **⋯** de la liste efface tout, les résolues, les envoyées ou répondues, celles dont l’original a changé ou celles du filtre, marque tout comme résolu ou copie tout en Markdown. Chaque effacement peut être annulé.
- **Afficher ou masquer la liste depuis la barre d’outils** — l’interrupteur à l’extrémité droite de la barre d’outils du document (il indique combien restent en attente). Masquée, la liste laisse une **barre d’état en marge** : un repère par annotation à sa place dans le document, coloré selon son état ; survolez un repère pour l’aperçu, cliquez pour y aller.
- **Fenêtres étroites** — quand la page est trop étroite pour la liste à côté du document, la liste devient une barre en bas qui se déplie et se replie.
- **Suit les modifications du fichier** — quand le fichier change sur le disque, la page se recharge (elle attend si vous écrivez un commentaire) et retrouve chaque passage. Un passage introuvable est marqué **Original modifié** et garde l’ancien texte, avec **Choisir un nouvel original** sur la carte.
- **Le transmettre au chat** — **Envoyer N ▾** transmet les annotations à [Diple](https://github.com/waiclay-349687/hermes-diple) : dans la liste d’attente de la conversation, pour partir avec votre prochain message, ou envoyées tout de suite. La carte affiche ensuite **Envoyée**, puis **Répondue** une fois que l’IA a répondu, avec un lien vers la conversation. **Copier pour l’IA** dans le même menu les copie plutôt en Markdown.
- **« Ouvrir dans Diple Docs » dans le chat** — quand l’IA écrit un fichier `.md`, une carte à la fin de sa réponse l’ouvre pour l’annoter (désactivable). Les documents récents sont aussi dans la palette de commandes.

L’interface du plugin existe dans toutes les langues de Hermes Desktop : **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch et Español** (l’arabe de droite à gauche). Elle suit la langue de l’application par défaut ; vous pouvez aussi en choisir une dans les réglages du plugin.

## Captures d’écran

Toutes les captures utilisent l’interface en chinois simplifié et un document d’exemple inventé.

L’éditeur de commentaire juste sous le passage sélectionné ; à droite, la barre d’état en marge :

![L’éditeur sous un passage sélectionné, avec le champ de commentaire et les boutons Enregistrer et envoyer / Enregistrer (en chinois)](docs/screenshots/editor.png)

L’en-tête de la liste : annotation en attente précédente / suivante, le menu **⋯** ouvert avec les actions en lot, les filtres et les premières cartes :

![La liste d’annotations avec son menu ⋯ ouvert : tout effacer, effacer les résolues, effacer les envoyées/répondues, effacer « original modifié », tout marquer résolu, tout copier en Markdown (en chinois)](docs/screenshots/list-menu.png)

La liste masquée depuis la barre d’outils : la barre d’état en marge avec un repère par annotation (thème clair et sombre) :

![Le document avec la liste masquée et une étroite barre d’état de repères colorés sur le bord droit (en chinois)](docs/screenshots/rail.png)

![La même chose en thème sombre](docs/screenshots/rail-dark.png)

Une page étroite : la liste en barre du bas :

![Une page de document étroite avec la liste d’annotations en barre du bas (en chinois)](docs/screenshots/narrow.png)

Les captures ont été prises dans un bac à sable, avant le dernier changement de l’éditeur : une nouvelle annotation y avait déjà son numéro pendant que l’éditeur était ouvert ; elle le reçoit désormais à l’enregistrement.

## Installation

Le plugin a deux moitiés : un plugin de bureau (`plugin.js`) et un petit backend Python (`plugins/diple-docs/`). Les deux sont nécessaires. Pour envoyer des annotations au chat, installez aussi [Diple](https://github.com/waiclay-349687/hermes-diple) (voir « Plugin compagnon » plus bas). Dans les commandes ci-dessous, `~/.hermes` est votre dossier Hermes ; pour un profil nommé, utilisez `~/.hermes/profiles/<name>`.

### Option A : télécharger une version publiée

1. Téléchargez `plugin.js`, `plugin.js.sha256`, `diple-docs-python-0.1.0.zip` et `diple-docs-python-0.1.0.zip.sha256` depuis la [dernière version](https://github.com/waiclay-349687/hermes-diple-docs/releases), puis vérifiez-les :

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-docs-python-0.1.0.zip.sha256
   ```

2. Mettez-les en place :

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple-docs ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple-docs/plugin.js
   unzip -o diple-docs-python-0.1.0.zip -d ~/.hermes/plugins/
   ```

3. Activez le backend et redémarrez Hermes Desktop :

   ```bash
   hermes plugins enable diple-docs
   ```

### Option B : depuis les sources

Nécessite Node.js 22 ou plus récent.

```bash
git clone https://github.com/waiclay-349687/hermes-diple-docs.git
cd hermes-diple-docs
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple-docs
```

`scripts/install.mjs` construit `plugin.js` et copie les deux moitiés dans le dossier Hermes donné par `--home` (il n’en devine jamais un). Redémarrez ensuite Hermes Desktop : la moitié Python ne se charge qu’au démarrage de l’application.

## Utilisation

1. Ouvrez un document : dans la palette de commandes (<kbd>⌘K</kbd>), choisissez « Diple Docs : Ouvrir un document… » ou « Diple Docs : Documents récents… », ou cliquez sur **Ouvrir** sur une carte « Ouvrir dans Diple Docs » du chat.
2. Sélectionnez un passage et cliquez sur **Annoter**. Écrivez un commentaire, ou laissez le champ vide pour un surlignage, et cliquez sur **Enregistrer** (ou appuyez sur <kbd>Entrée</kbd> ; <kbd>Maj</kbd>+<kbd>Entrée</kbd> ajoute une ligne). L’annotation apparaît dans la liste et en teinte sur le passage.
3. Continuez. Les flèches de l’en-tête de la liste parcourent ce qui reste en attente, et l’interrupteur de la barre d’outils masque la liste quand vous voulez récupérer la largeur.
4. Ouvrez **Envoyer N ▾** : choisissez celle-ci ou toutes les non envoyées du fichier, puis la conversation actuelle, pour les ajouter à sa liste d’attente ou les envoyer tout de suite. Ou choisissez **Copier pour l’IA**.
5. Quand l’IA a répondu, les cartes indiquent **Répondue**. Marquez ce qui est réglé comme résolu, et effacez-le depuis le menu **⋯** quand vous avez fini.

**Enregistrer et envoyer** dans l’éditeur enregistre d’abord, puis envoie cette annotation à la conversation actuelle.

### Raccourcis

| Action | Par défaut | Remarques |
| --- | --- | --- |
| Annoter la sélection sur la page du document | <kbd>⌘⇧E</kbd> | Le même raccourci que celui de Diple, traité par la page elle-même ; vous pouvez aussi attribuer « Annoter la sélection (page du document) » dans les réglages clavier de l’application |
| Afficher ou masquer la liste d’annotations | <kbd>⌘⌥B</kbd> | Modifiable |
| Annotation en attente précédente / suivante | aucun | À attribuer dans les réglages clavier de l’application |

Les surfaces de travail (bouton, éditeur, liste, barre d’état) n’affichent pas ces touches ; la page de réglages du plugin les liste.

Sous Windows et Linux, <kbd>⌘</kbd> correspond à <kbd>Ctrl</kbd>. La palette de commandes (<kbd>⌘K</kbd>) propose aussi « Annoter la sélection (page du document) » et « Diple Docs : Réglages » (dans la langue de l’interface).

## Réglages

Ouvrez-les depuis la palette de commandes (« Diple Docs : Réglages ») ou depuis les réglages de l’application.

| Réglage | Par défaut | Effet |
| --- | --- | --- |
| Langue | Suivre l’application | Suivre l’application, ou l’une des neuf langues, chacune affichée sous son propre nom. |
| Ajouter une carte « Ouvrir dans Diple Docs » quand l’IA écrit un fichier `.md` | activé | Une carte à la fin de la réponse ouvre le fichier écrit. Désactivé : ouvrez-le depuis la palette de commandes. |
| Raccourcis | — | Liste les raccourcis ci-dessus ; changez-les dans les réglages clavier de l’application. |
| Réinitialiser | — | Rétablit les valeurs par défaut. |

## Fonctionnement

### Ce que reçoit l’IA

Diple Docs ne parle pas lui-même à l’IA. **Envoyer** transmet les annotations à Diple par des événements de plugin (le protocole de transmission, [ADR 0007](docs/adr/README.md)) ; Diple les place dans la liste d’attente de la conversation à côté des annotations prises dans le chat et les envoie comme les siennes : la bulle du chat reste courte, et l’IA reçoit chaque passage en entier avec son fichier et sa ligne, votre commentaire et la règle de répondre à chaque commentaire. Diple indique en retour ce qui a été envoyé et ce qui a reçu une réponse, et les cartes suivent.

**Copier pour l’IA** met les mêmes annotations dans le presse-papiers en Markdown (le passage en citation, puis votre commentaire), pour n’importe quel chat ou outil.

### La place de chaque annotation

Une annotation enregistre son passage, la ligne et assez de texte alentour pour le retrouver. Après une modification du fichier, le plugin cherche le passage dans le nouveau texte ; quand le contexte n’est pas assez unique pour en être sûr, il ne devine pas : l’annotation est marquée **Original modifié** et garde le texte d’origine.

### Où sont stockées les données

- Les annotations, leur état et la liste des documents récents : SQLite dans `~/.hermes/plugin-data/diple-docs/data.db`, par chemin de fichier. Rien n’est écrit à côté de vos documents.
- Les choix de disposition (largeur de la liste, affichée ou masquée, l’affichage) : le stockage des plugins de bureau de Hermes Desktop (clés préfixées par `hermes.plugin.diple-docs.`).

Les décisions de conception sont consignées dans [docs/adr](docs/adr/README.md) et la structure d’ensemble dans [docs/architecture.md](docs/architecture.md).

## Confidentialité

Tout reste sur votre machine. Le plugin ne fait aucune requête réseau de lui-même et n’a pas de télémétrie. Il ne lit que les documents que vous ouvrez et refuse les emplacements qui contiennent des identifiants ou des données internes de Hermes (par exemple `~/.ssh` ou le `.env` de Hermes). Les annotations n’atteignent votre fournisseur de modèle que lorsque vous les envoyez dans une conversation, exactement comme le texte que vous tapez.

## Limites connues

Les principales (liste complète avec les raisons dans [docs/known-limitations.md](docs/known-limitations.md)) :

- L’envoi nécessite Diple. Sans lui, le premier envoi attend 3 secondes une réponse (10 secondes vers une autre conversation, que Diple ouvre d’abord), puis la page indique que Diple ne répond pas et désactive l’envoi ; la liste, les commentaires, **Copier pour l’IA** et **Tout copier en Markdown** continuent de fonctionner.
- La destination est toujours une conversation existante : on ne peut pas en créer une nouvelle d’ici, car `newChat()` du SDK ne renvoie pas d’identifiant de session. _(issue not filed yet)_
- Dans l’affichage Rendu, une sélection dans un tableau, du HTML brut ou une note de bas de page peut ne pas correspondre à la source ; la page vous demande alors de la refaire dans l’affichage Source.
- Un fichier renommé ou déplacé repart avec une liste vide.
- Si un autre plugin réécrit aussi les réponses de l’IA, la carte « Ouvrir dans Diple Docs » peut se perdre (l’hôte ne garde que la première réécriture) ; le fichier reste dans les documents récents.

## Compatibilité

Testé avec Hermes Agent **v0.22.5 (2026.9.24)**, commit `bf0203a` (2026-10-22), sous macOS, avec Diple 0.2.2. Nécessite Hermes Desktop (la CLI seule ne charge pas les plugins de bureau). D’autres versions peuvent fonctionner mais n’ont pas été testées ; dites-nous ce que vous constatez.

## Plugin compagnon : Diple

[Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) est le membre chat de la famille : surlignez et commentez des passages d’une conversation, gardez-les dans une liste d’attente au-dessus du champ de saisie et envoyez-les avec votre prochain message ; l’IA répond à chaque commentaire et vous passez de chaque réponse à son passage et inversement.

- **Sans Diple** : ouvrir des documents, annoter, la liste, les filtres, résoudre, la barre d’état en marge, **Copier pour l’IA** dans le menu d’envoi et **Tout copier en Markdown** fonctionnent. Seul l’envoi vers une conversation nécessite Diple.
- **Avec Diple** : **Envoyer N ▾** place les annotations du document dans la liste d’attente de la conversation, à côté de celles prises dans le chat, sous forme de puces au-dessus du champ de saisie ; elles partent avec votre prochain message, ou tout de suite si vous choisissez la conversation elle-même dans le menu. Les réponses de l’IA indiquent à quel commentaire elles répondent, et les cartes ici passent à **Envoyée**, puis **Répondue**.

Ce sont deux plugins distincts, avec des dépôts et des versions séparés ; installez l’un, l’autre ou les deux. Ils ne partagent aucun code à l’exécution : chacun embarque sa propre copie du noyau commun.

## Ce qui le distingue

L’aperçu intégré de Hermes Desktop affiche un fichier Markdown et peut le modifier. Diple Docs ne modifie jamais : il sert à relire. Il garde une liste d’annotations par fichier d’une session à l’autre, les retrouve après une modification, suit chacune de « à envoyer » à « répondue » puis « résolue », et les transmet au chat par Diple.

## Feuille de route et tickets

- [ROADMAP.md](ROADMAP.md) — ce qui est en cours, à venir et pour plus tard.
- [Issues](https://github.com/waiclay-349687/hermes-diple-docs/issues) — questions ouvertes, discussions de conception et limites connues.
- [CHANGELOG.md](CHANGELOG.md) — ce qui a changé dans chaque version.
- [CONTRIBUTING.md](CONTRIBUTING.md) — compiler et tester.

## Licence

[MIT](LICENSE).
