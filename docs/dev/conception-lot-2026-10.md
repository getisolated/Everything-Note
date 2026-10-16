# Conception — lot d'évolutions (octobre 2026)

Branche de base : `NF/dev`. Une branche par **feature cohérente** (`NF/feat/<slug>-<yyMMdd>`, date de création ; le tableau omet le suffixe), PR vers `NF/dev` : les petits points qui touchent le même module sont regroupés, les sujets éloignés restent séparés (pas de PR fourre-tout). Un commit par point dans la branche.

Légende statut : 🟡 en discussion · 🟢 validé · ⏸️ gelé · ✅ implémenté

## Constat technique préalable

- Les notes et dossiers « core » sont en **SQLite** ([database.ts](../../electron/database.ts)) : `notes(id, title, content, tags, folder_id, sort_order)`, `folders(id, name, parent_id, is_default, sort_order)`. Aucun fichier `.md` sur disque.
- Réglages dans `settings.json` ([settings-schema.ts](../../electron/settings-schema.ts)), assainis par `sanitizeSettings`.
- Les quick notes sont des notes taguées `overlay`, concaténées dans un **document virtuel lecture seule** (`OVERLAY_NOTES_TAB_ID = -1`, [note.model.ts](../../src/app/core/models/note.model.ts)).
- Recherche = panneau natif `@codemirror/search` ([editor.component.ts](../../src/app/features/editor/editor.component.ts)).

## Branches et ordre d'implémentation

Petites branches d'abord (faible risque), gros chantiers ensuite. 🔗 = dépend d'une autre branche.

| Ordre | Branche | Points | Thème commun | Taille |
|---|---|---|---|---|
| 1 | `NF/feat/theming` | #1, #20, #21 | Thèmes : palette sombre, nouveaux thèmes, sélecteur Ctrl+K Ctrl+T | M |
| 2 | `NF/feat/editor-display` | #2, #7, #8, #9, #23 | Affichage de l'éditeur : défauts (lignes, sommaire, barre floating), barre de formatage (tailles, positions, actions), scrollbar masquable | M |
| 3 | `NF/feat/search` | #3, #10 | Recherche : retrait de la loupe titlebar (doublon), panneau Ctrl+F / Ctrl+H | M |
| 4 | `NF/feat/quick-notes` | #4, #5, #6 | Quick notes : renommage, pas de sommaire, édition dans l'app | M |
| 5 | `NF/feat/sidebar-actions` | #12, #13, #14 | Actions sur les éléments de la sidebar : multi-sélection, bulk delete/move, vider, couleur | M |
| 6 | `NF/feat/markdown-preview` | #16, #17, #22 | Rendu markdown : preview GitHub-like (lecture seule), side-by-side, mermaid, liens non résolus en rouge | L |
| 7 | `NF/feat/note-export` 🔗6 | #11 | Copier / exporter md, html, zip (réutilise le rendu HTML de la preview) | S |
| 8 | `NF/feat/collections` 🔗5 | #15 | Collections sur disque (+ couleurs et actions sidebar étendues aux fichiers) | XL |
| 9 | `NF/feat/collections-graph` 🔗8 | #15 (suite) | Graph view interne à chaque collection | M |
| — | `NF/feat/drawings` | #18 | ⏸️ Gelé : mode dessin, repris quand l'app sera aboutie | XL |
| 10 | `NF/feat/tabs-tweaks` | #19 | Variantes d'onglets (réglage expérimental) | M |
| — | `NF/feat/wysiwyg-preview` | #16 (suite) | ⏸️ Gelé : preview éditable | XL |

Justification des regroupements non évidents :
- **#3 avec #10** plutôt qu'avec #19 : #19 est expérimental et peut ne jamais être mergé, #3 ne doit pas en dépendre ; et il s'agit dans les deux cas de l'ergonomie de recherche.
- **#11 séparé de #16** : le rendu (#16/#17) est déjà L ; l'export n'en est qu'un consommateur.
- **Graphe des collections séparé de #15** : #15 est déjà XL ; le graphe réutilise le utilityProcess sans toucher au reste.
- **#23 avec l'affichage de l'éditeur** : simple réglage d'affichage, comme #2.
- **#22 avec #16** : la résolution des liens est partagée entre les décorations de l'éditeur et le rendu de la preview ; #15 l'étend aux liens relatifs.
- **#14 dans `sidebar-actions`** : même menu contextuel et même modèle que #12/#13. Côté collections, la couleur est simplement étendue dans `collections` (pas de dépendance de #14 envers #15).

---

## 1. Gris sombre légèrement bleuté 🟢

**Actuel** : `--evn-bg-panel: #252526` (sidebar, titlebar), `--evn-bg: #1e1e1e`, etc. ([styles.scss](../../src/styles.scss)).

**Décision** : tous les gris du thème `dark` actuel (surfaces, gris moyens, noirs clairs, bordures), à la manière de GitHub Dark Dimmed : du gris qui *tire* vers le bleu, le bleu ne doit pas se ressentir.
- Teinte ~215–220°, saturation 3–6 % (plus faible sur les gris les plus sombres), luminosité conservée pour ne pas modifier les contrastes.
- Ex. `--evn-bg-panel` `#252526` → `#24252a`, `--evn-bg` `#1e1e1e` → `#1d1e21`.
- Les couleurs d'accent, de syntaxe et sémantiques (erreur, succès…) ne bougent pas.
- Les nouveaux thèmes sombres (#20) ne sont pas concernés.

## 2. Défauts : numéros de ligne et sommaire décochés 🟢

`DEFAULT_SETTINGS.showLineNumbers` et `showOutline` passent à `false`. Pas de migration : les utilisateurs existants gardent leur valeur.

## 3. Retirer la loupe de la titlebar 🟢

Supprimer le bouton loupe de [tabs-bar.component.ts](../../src/app/features/tabs/tabs-bar.component.ts) (+ styles). Le raccourci `search.global` reste. Le 2ᵉ bouton portant la classe `search-icon-btn` (toggle « wide mode ») est conservé, classe renommée en `titlebar-icon-btn`.

## 4. Renommer « overlay notes » → « quick notes » 🟢

- Libellés UI : sidebar, onglet, palette (`Overlay Notes` → `Quick Notes`), README.
- Code : `OVERLAY_NOTES_TAB_ID` → `QUICK_NOTES_TAB_ID`, `overlayNotes*` → `quickNotes*`. L'id `-1` est conservé, donc les onglets persistés restent valides.
- Tag en base : migration idempotente au démarrage `overlay` → `quick-note`.
- La fenêtre flottante reste « overlay » (nom de la fenêtre) ; seules les *notes* changent de nom.

## 5. Pas de sommaire dans les quick notes 🟢

Masquer le panneau outline quand la note active est le document quick notes.

## 6. Quick notes éditables dans l'app centrale 🟢

Le document reste une **concaténation** de N notes (une par bloc, en-tête timestamp via `note-timestamps.ts`), chaque bloc étant mappé à l'id de sa note (`RangeSet` maintenu à travers les transactions).

- **Survol d'un bloc** → barre d'actions flottante en haut à droite du bloc (style messages Discord) : **Copier** le contenu, **Éditer**, **Supprimer** (avec confirmation).
- **Éditer** : le bloc passe en édition inline (les autres restent en lecture seule) ; `Échap` annule, `Ctrl+Entrée` ou perte de focus enregistre.
- Pas de création depuis l'app (uniquement depuis l'overlay), pas de fusion / scission de blocs.
- Hors édition, le document reste en lecture seule.

## 7. Barre de formatage : tailles 🟢

On garde `'compact' | 'full'`, défaut `full`. Pur CSS, pas de migration.
- `compact` = dimensions de l'actuel `full`.
- `full` = nouvelles dimensions plus grandes (boutons, icônes, police, espacements).

## 8. Barre de formatage : floating par défaut + 4 positions 🟢

- Défaut : `formattingBarEnabled: true` (déjà), `formattingBarStyle: 'floating'`.
- `FormattingBarPosition` : `'top' | 'bottom' | 'left' | 'right'`.
- Le conteneur de la barre devient la **zone de page**, pas la fenêtre : `bottom` = bas de la zone de page, **au-dessus** du panneau backlinks ; `left` / `right` = verticale, au bord intérieur de la page, centrée verticalement ; `right` se place **à droite du sommaire**.
- En vertical : icônes seules + tooltip, quelle que soit la taille ; le sélecteur de titres s'ouvre latéralement.
- `pinned` + `left`/`right` : la barre réserve sa largeur. `floating` : elle flotte par-dessus, avec une ombre.

## 9. Barre de formatage : actions manquantes 🟢

- **Titres** : liste déroulante Paragraphe / H1 → H6 (remplace les boutons de titre actuels).
- **Ajouts**, dans la barre **et** dans les slash commands : lien (`[]()`), image (`![]()`), souligné (`<u>`), exposant (`<sup>`), indice (`<sub>`), effacer le formatage.
- Pas d'autres regroupements en menus pour l'instant (retour de test attendu).
- Insertion de dessin : traitée avec #18.

## 10. Recherche / remplacement 🟢

**Problèmes actuels** : panneau CodeMirror natif en bas, Replace toujours visible, labels mal alignés, pas de Ctrl+H.

**Décision** : panneau **custom** Angular dans le **panneau de droite** (à la place du sommaire tant qu'il est ouvert, style Word ; il s'ouvre aussi si le sommaire est masqué). Le moteur reste `@codemirror/search` (`SearchQuery`, `findNext`, `replaceAll`, `setSearchQuery`) ; le panneau natif n'est plus affiché.

Le panneau de droite devient un conteneur générique de vues (sommaire, recherche, plus tard références…).

- `Ctrl+F` : recherche seule. `Ctrl+H` : recherche + remplacement. Un chevron bascule entre les deux.
- Options en toggles icône : `Aa` (casse), `ab` (mot entier), `.*` (regex). Compteur « 3 / 12 ».
- **Tous les boutons sont des icônes** (précédent, suivant, remplacer, tout remplacer, fermer) avec tooltip + raccourci.
- `Entrée` = suivant, `Shift+Entrée` = précédent, `Échap` = fermer (retour au sommaire s'il était affiché).
- **Liste des résultats** sous les champs : ligne avec contexte et terme surligné, clic = va au résultat.
- Champ pré-rempli avec la sélection ; libellés et champs alignés sur une grille.

## 11. Partager / exporter / copier une note 🟢

Menu contextuel (onglet, sidebar, éditeur) + palette :
- **Copier le contenu** (markdown brut).
- **Exporter la note** : `.md` ou `.html` (autonome, CSS inline, rendu de la preview #16).
- **Exporter un dossier** : `.zip` des notes en `.md`, arborescence conservée.
- Liens (`note://ID`, `[](Folder/Note)`) gardés tels quels.

## 12. Sélection multiple dans la sidebar + bulk delete / move 🟢

- `Ctrl+clic` : ajoute/retire de la sélection. `Shift+clic` : plage depuis l'ancre (ordre visuel des lignes). Clic simple : sélection unique + ouverture.
- Sélection mixte notes + dossiers autorisée.
- Actions : `Suppr` / « Supprimer (N) » avec confirmation ; drag & drop de la sélection ; « Déplacer vers… » (sélecteur de dossier).
- Dossiers dans un bulk delete : même dialogue qu'aujourd'hui (déplacer à la racine / tout supprimer).
- Règles : un dossier sélectionné couvre ses descendants ; pas de déplacement d'un dossier dans lui-même ; `Inbox` non supprimable.
- `Échap` vide la sélection.
- Pas de sélection mixte core + collections (stockages différents) ; la multi-sélection *au sein* d'une collection est ajoutée par #15.

## 13. Vider un dossier 🟢

Clic droit sur dossier → « Vider le dossier… » : supprime le contenu (notes + sous-dossiers), garde le dossier. Confirmation avec décompte (« 12 notes et 3 dossiers seront supprimés »). Disponible aussi sur `Inbox`.

Toute suppression de fichier disque (collections, #15) passe par la **corbeille Windows** (`shell.trashItem`).

## 14. Couleur de dossier / fichier 🟢

- **Color picker maison** (composant `shared/ui/color-picker`) : zone saturation/luminosité + curseur de teinte + champ hex + couleurs récentes + « aucune ». Clic droit → « Couleur… ».
- Rendu d'un élément coloré : icône **outline** teintée, libellé teinté, fond de ligne de la même couleur à faible opacité (~12 %). Lisibilité vérifiée en clair et en sombre (ajustement de luminosité du libellé si contraste insuffisant).
- Pas d'héritage parent → enfants.
- Stockage core : colonne `color TEXT NULL` sur `notes` et `folders`.
- Extension aux collections dans #15.

## 15. Collections 🟢

**Besoin** : ouvrir des fichiers `.md` et des dossiers ailleurs sur le disque (ex. doc d'un repo), affichés à part des notes core, persistés.

**Principe directeur** : la gestion des collections ne doit impacter **ni les performances ni l'UI/UX** du core. Tout le travail disque se fait hors du thread UI et hors du main process (voir *Performances*).

**Modèle**
- Une seule liste « Collections » (section sidebar repliable, sous le core).
- Une collection = un dossier (arborescence récursive) ou un fichier isolé.
- **Clé = chemin disque absolu** (normalisé, unique). **Nom d'affichage** séparé, modifiable (défaut : nom du dossier/fichier). Deux dossiers homonymes = deux collections distinctes ; tant que leurs noms d'affichage sont identiques, on ajoute en grisé le parent distinctif (`docs  repoA/…`).
- Tooltip = chemin absolu sur chaque collection, dossier et fichier.
- Table SQLite `collections(path PRIMARY KEY, kind 'folder'|'file', display_name, sort_order, color)` + `collection_item_colors(collection_path, relative_path, color)`. L'arborescence n'est **pas** stockée.
- Un dossier n'est affiché que s'il contient (récursivement) au moins un `.md`.
- **Exclusions** : `.git`, `node_modules`, `bin`, `obj`, `build`, `dist`, `out`, `target`, `.angular`, `.next`, `.nuxt`, `.vs`, `.vscode`, `.idea`, `coverage`, `vendor`, `__pycache__`, `.venv`/`venv`, dossiers cachés (`.*`). Liste éditable dans les réglages (`collections.exclude`, comme `files.exclude` de VS Code).

**Performances**
- Scan et surveillance dans un **`utilityProcess`** Electron dédié (process séparé : un scan lourd ne bloque ni le main process ni le rendu).
- Chargement **en parallèle et non bloquant** au démarrage : le core s'affiche d'abord ; chaque collection a un état `loading` / `ready` / `error` (chemin introuvable → grisée avec action « Relocaliser / Retirer »).
- Scan itératif, résultats envoyés par lots ; arbre rendu en virtual scroll si besoin.
- Surveillance : `fs.watch` récursif (natif sous Windows), évènements débouncés et appliqués par diff sur l'arbre.

**Fichiers**
- Lecture/écriture via IPC, **chemins validés** (uniquement sous une racine enregistrée).
- Fichier ouvert modifié sur disque : rechargé s'il n'a pas de modification locale, sinon bandeau de conflit (garder la mienne / recharger).
- Identité d'onglet générique : `type DocRef = { kind: 'note'; id: number } | { kind: 'file'; path: string }`. **Le gros du chantier** (tabs, editor, palette, persistance de session).
- Opérations : créer, renommer, déplacer (dans la même collection), supprimer (corbeille), couleur, multi-sélection (#12 étendu).
- Liens relatifs (`[x](./autre.md)`, `#ancre`) navigables par Ctrl+clic.
- Pas de backlinks, pas de tags.
- Fichier isolé : via la sidebar (« Ouvrir un fichier… »), glisser-déposer sur la fenêtre, et association `.md` dans l'installeur (`fileAssociations` electron-builder + gestion de `second-instance` / argv). Un fichier ouvert ainsi est ajouté aux collections.
- Images non listées dans l'arbre, mais rendues dans la preview (#16) via un protocole Electron restreint aux racines de collection.

**Recherche — options**

Pour comprendre : la recherche actuelle des notes core utilise **SQLite FTS5**, un *index plein texte* : à chaque sauvegarde, SQLite tient à jour une table « mot → notes qui le contiennent ». La recherche ne relit pas les notes, elle consulte cet index : c'est instantané et trié par pertinence, mais il faut que le contenu soit dans la base.

Les fichiers de collection ne sont pas dans la base. Trois façons de les chercher :

| | Principe | Avantages | Inconvénients |
|---|---|---|---|
| **S1. À la demande** (ce que fait VS Code) | Rien n'est stocké. À chaque recherche, le utilityProcess relit les `.md` des collections et cherche le texte ; les résultats arrivent au fil de l'eau. VS Code fait exactement ça avec `ripgrep` (un exécutable de recherche très rapide) ; il ne garde en mémoire que la **liste des noms de fichiers** pour `Ctrl+P`. | Toujours à jour, aucune donnée en double, rien à synchroniser. Un dossier de doc (quelques centaines de `.md`, quelques Mo) se parcourt en < 100 ms. | Pas de tri par pertinence (ordre des fichiers) ; coût à chaque frappe (atténué par un debounce + annulation de la recherche précédente). |
| **S2. Cache mémoire** | Au scan, le utilityProcess lit tous les `.md` et garde leur contenu en RAM, mis à jour par la surveillance disque. La recherche parcourt la RAM. | Plus rapide que S1, toujours à jour pendant la session. | RAM proportionnelle à la taille des collections ; tout relire à chaque démarrage. |
| **S3. Index FTS persistant** | Une seconde table FTS5 contient le texte des fichiers de collection, alimentée au scan et par la surveillance. | Même pertinence que le core, résultats mélangés et triés ensemble. | Copie du contenu en base ; resynchronisation au démarrage (fichiers modifiés app fermée, via date de modification) ; complexité et risque d'index périmé. |

**Recommandation : S1**, comme VS Code : liste des noms de fichiers en mémoire (palette, recherche par titre instantanée) + recherche de contenu à la demande dans le utilityProcess. Dans la palette, deux groupes de résultats : « Notes » (FTS, triés par pertinence) puis « Collections » (au fil de l'eau). Si les volumes s'avèrent trop gros, on embarque `@vscode/ripgrep` sans changer l'architecture.

**Décision** : S1.

**Graph view par collection** (branche `collections-graph`)
- Graphe **interne** à une collection (pas de liens entre collections), même vue que le graphe core (canvas + d3-force).
- Les liens relatifs entre `.md` sont extraits dans le utilityProcess (au scan puis à chaque changement détecté), seul le résultat `{ nodes, edges }` est envoyé au renderer : ni le main ni le renderer ne parcourent les fichiers.
- Sélection de la collection dans la sidebar → le graphe de la page d'accueil affiche cette collection (comme le filtre par dossier actuel).
- Liens cassés dessinés en pointillés, comme les notes supprimées du core.

## 16. Preview GitHub-like ✅

- Rendu : `markdown-it` + GFM (tables, tasks, autolinks, footnotes, callouts) + coloration syntaxique + **assainissement** (`DOMPurify`) — le contenu peut venir de fichiers externes.
- CSS inspiré de `github-markdown-css`, adapté aux variables `--evn-*`.
- Modes : **Source** / **Preview** / **Côte à côte**. Bouton dans la barre + raccourcis (`Ctrl+Shift+V`, `Ctrl+K V`). Mode non mémorisé par onglet.
- Réglage `openInPreview: boolean` (défaut `false`).
- Côte à côte : preview à droite, contenu et scroll synchronisés (attribut `data-line` posé à la génération).
- Images : chemins relatifs résolus (fichiers de collection).
- Liens : clic = ouvre la note / le fichier / le navigateur.

**Décision** : preview **non éditable** pour l'instant ; le mode éditable (WYSIWYG) est gelé (`NF/feat/wysiwyg-preview`), à rediscuter plus tard.

## 17. Mermaid ✅

- Blocs ` ```mermaid ` rendus en SVG dans la **preview uniquement**.
- Lib `mermaid` en import dynamique (lourde, ~1 Mo), thème mermaid suit le thème de l'app.
- Erreur de syntaxe → message inline à la place du diagramme.

## 18. Mode dessin (canvas) ⏸️

Gelé tant que l'app n'est pas assez aboutie. À la reprise : **POC comparatif** entre A (Excalidraw : qualité garantie, mais bundle React lourd) et C (éditeur maison, préféré si l'écart de qualité est acceptable). Outils et stockage (dont collections) définis à ce moment-là.

Pistes conservées : dessins stockés à part, référencés dans les notes par `![Schéma](drawing://42)` et rendus comme images ; slash command `/drawing` ; bouton dans la barre de formatage.

## 19. Onglets : variantes « tweak » 🟢

Réglage `tabsStyle` (catégorie « Expérimental ») :
- **pills** : style actuel (défaut), inchangé.
- **attached** : onglets dont la forme de fond est rattachée au haut de la fenêtre (style navigateur), l'onglet actif se fond dans la surface de la page.
- **recents** : aucun onglet affiché ; sélecteur de récents identique au `Ctrl+E` de VS Code (palette des documents récents, ordre MRU, `Ctrl+E` répété = suivant, relâchement = ouvrir).

Pin, drag & drop et restauration de session ne sont garantis que dans **pills**.

## 20. Nouveaux thèmes 🟢

**Actuel** : `ThemePreference = 'dark' | 'light' | 'system'`, un bloc `:root[data-theme='…']` par thème dans [styles.scss](../../src/styles.scss) ; `oppositeTheme()` suppose deux thèmes seulement ([theme.util.ts](../../src/app/core/utils/theme.util.ts)).

**Proposition**
- Registre de thèmes : `{ id, label, kind: 'dark' | 'light' }`. `data-theme` = id du thème ; un attribut `data-theme-kind` sert à CodeMirror (base light/dark) et à mermaid.
- Thèmes : `dark` (actuel), `light` (actuel), `solarized-light`, `violet-light`, `github-light`, `github-dark-dimmed`. Chaque thème = un bloc de variables `--evn-*` (palettes officielles pour Solarized et GitHub Primer ; `violet-light` composé : fond blanc légèrement lavande, accents violets, contrastes AA).
- `settings.theme` : un id de thème ou `'system'`. Pour `'system'`, deux réglages `preferredDarkTheme` / `preferredLightTheme` (comme VS Code), défauts `dark` / `light`.
- L'overlay garde son propre look translucide (inchangé).
- Test unitaire : chaque thème définit **toutes** les variables du thème de référence (parse du SCSS compilé ou registre TS des tokens).

**Décisions** : Solarized en version light uniquement ; Violet light composé ; le gris bleuté (#1) ne touche que `dark`.

## 21. Chord sans timeout + sélecteur de thème 🟢

**Actuel** ([shortcuts.service.ts](../../src/app/core/services/shortcuts.service.ts)) : après `Ctrl+K`, la 2ᵉ touche est attendue **2 s** (`CHORD_TIMEOUT_MS`), et `Ctrl+K Ctrl+T` bascule directement dark ↔ light.

**Chord (comme VS Code)**
- Suppression du timeout : `Ctrl+K` met le chord en attente **indéfiniment**.
- La touche suivante est toujours consommée : si elle complète un chord → exécution ; sinon → annulation (avec message « La combinaison (Ctrl+K, X) n'est pas une commande »). `Échap` annule. Une touche modificatrice seule (Ctrl, Shift…) n'annule pas.
- Aucun indicateur visuel pendant l'attente.
- Perte de focus de la fenêtre → annulation.
- Le chord doit être intercepté en phase capture pour que CodeMirror ne consomme ni `Ctrl+K` ni la 2ᵉ touche.

**Sélecteur de thème** (`Ctrl+K Ctrl+T`)
- Nouveau mode de la palette existante (`PaletteMode` + `'theme'`), même look que la recherche de notes.
- Liste : thèmes groupés « Clairs » / « Sombres » (+ « Système »), le thème courant présélectionné.
- `↑`/`↓` : **preview immédiate** (application de `data-theme` sans écrire les réglages). Filtrage par saisie (la preview suit l'élément surligné).
- `Entrée` : persiste dans `settings.json`. `Échap` / clic dehors : restaure le thème d'origine.
- Aussi accessible depuis la palette de commandes : « Preferences: Color Theme ».
- La commande « basculer dark/light » (`ThemeService.toggle`, `oppositeTheme`) est **supprimée**.

**Décisions** : pas d'indicateur de chord ; suppression de la bascule dark/light.

## 22. Liens non résolus en rouge ✅

Un lien local (note, `note://ID`, chemin relatif de collection) qui ne pointe vers rien est affiché en **rouge** (couleur d'erreur du thème) au lieu de la couleur de lien, dans l'éditeur et dans la preview. Tooltip « Lien introuvable ». Mis à jour quand la cible est créée, renommée ou supprimée.

## 23. Masquer la scrollbar 🟢

- Réglage `hideScrollbar: boolean` (défaut `false`), catégorie « Éditeur ».
- Concerne **uniquement la scrollbar de l'éditeur**.
- Masquée en permanence (pouce transparent, largeur conservée pour ne pas décaler le contenu), le défilement reste possible (molette, clavier, trackpad).
- Réapparaît **uniquement quand la souris survole la zone de la scrollbar** (bande de la largeur de la scrollbar au bord droit de l'éditeur, détectée au `mousemove` → classe CSS), et reste visible pendant un glisser du pouce.
