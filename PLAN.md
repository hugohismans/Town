# Ville vivante : plan

Une petite ville isométrique, générée à partir d'une graine, où environ 420
habitants vivent seuls. Le joueur est un esprit qui souffle des idées ; il ne pilote
personne. Ce document fixe l'architecture, le modèle de données, les commandes
et les étapes. Les décisions prises sans consigne sont listées à la fin.

## Arborescence

```
src/
  sim/        simulation pure : aucun DOM, aucun canvas, tourne dans Node
    rng.ts        PRNG à graine (mulberry32) + hachages
    constants.ts  pas de temps, vitesses, coûts
    types.ts      City (statique), SimState (dynamique), Command, etc.
    names.ts      prénoms, noms, rues, enseignes (français)
    citygen.ts    rues, canal, carrefours, graphes voiture/piéton, bâtiments
    roadgeo.ts    géométrie des voies, courbes de carrefour, table de conflits
    path.ts       plus courts chemins (trottoirs, voies)
    popgen.ts     foyers, emplois, relations, voitures
    people.ts     besoins, IA à utilité, marche, conversations, rumeurs
    query.ts      lectures pour le rendu et l'interface (activité, pensée)
    traffic.ts    voitures, priorités, feux, accidents, secours
    commands.ts   validation + application des commandes, influence
    chronicle.ts  fil d'événements en français
    world.ts      createWorld, step, snapshot, restore, hash
    index.ts      API publique
  render/     lit l'état, ne le modifie jamais
    camera.ts, color.ts, daylight.ts, models.ts (bâtiments en vectoriel),
    sprites.ts (cache par niveau de zoom), ground.ts, entities.ts, renderer.ts
  ui/         produit des commandes, ne modifie jamais l'état
    input.ts (souris, molette, tactile), ui.ts, style.css
  main.ts     boucle : pas fixe 10 ticks/s, rendu interpolé, sauvegarde
tests/        Vitest sur sim/ (déterminisme, accident, commandes, génération)
```

Règle de dépendance : `sim` n'importe rien d'autre ; `render` et `ui`
importent `sim` en lecture ; seul `main.ts` connaît les trois.

## Modèle de données

Deux objets, volontairement séparés :

- **`City`** (statique, fonction pure de la graine, jamais sérialisée) : grille
  de tuiles, lignes de rues nommées, nœuds (carrefours : feux, priorité ou
  libre), arêtes dirigées (une voie par sens), graphe piéton (coins de
  trottoir, passages piétons), bâtiments (emprise, fonction, horaires, porte,
  accès voiture et piéton), arbres, lampadaires.
- **`SimState`** (dynamique, 100 % JSON) :
  - `seed`, `tick`, `rng` (état du PRNG)
  - `people[]` : identité, foyer, emploi et horaires, traits (sociable,
    ponctuel, prudent, têtu, énergique, curieux), besoins (faim, fatigue,
    social, loisir), humeur, attention, relations, activité et destination,
    trajet à pied, objectif soufflé par un joueur, rumeur portée, journal
  - `cars[]` : propriétaire, état (garée, en route, accidentée, en réparation),
    arête, position, vitesse, itinéraire ; ambulances et dépanneuses comprises
  - `accidents[]` : lieu, véhicules, blessés, cause, secours, retards causés
  - `homes` (garde-manger par logement), `chronicle[]`, `players{}` (jauge
    d'influence), `queue[]` (commandes en attente), `feedback[]`, `stats`

`snapshot(world)` = `JSON.stringify(state)` ; `restore(json)` régénère la
`City` depuis la graine et reprend exactement. Le hash d'état est un FNV-1a du
snapshot.

## Déterminisme

- Pas fixe : 10 ticks/s en vitesse ×1. Un tick = 12 s de temps de ville, une
  journée = 7 200 ticks = 12 minutes réelles (3 min en ×4, 45 s en ×16).
- Un seul PRNG, dont l'état vit dans `SimState`. Aucun `Math.random`,
  `Date.now`, ni fonction transcendante (`sin`, `cos`, `pow`) dans `sim/` :
  uniquement `+ - * /` et `sqrt`, identiques sur toutes les machines.
- Itérations dans l'ordre des identifiants ; pas de `Map`/`Set` dont l'ordre
  dépendrait de l'exécution. Les index dérivés (voitures par voie, occupants
  par bâtiment) sont reconstruits à chaque tick à partir de l'état.

## Commandes

Forme unique : `{ tick, playerId, type, targetId, params }`. L'UI les pousse
dans la file ; la simulation les valide et les applique au début du tick visé.
Chaque commande coûte de l'influence (jauge 0 à 100, +1 toutes les 6 ticks).
Un habitant ne peut pas être sollicité deux fois en moins de 15 s.

| type       | coût | effet (sur les objectifs, l'attention ou l'humeur, jamais sur la position) |
|------------|------|-----|
| `goto`     | 15 | suggère d'aller dans un lieu (`params.buildingId`) |
| `visit`    | 15 | suggère de rendre visite à quelqu'un (`params.personId`) |
| `goHome`   | 10 | suggère de rentrer |
| `skipWork` | 20 | donne envie de sécher le travail aujourd'hui |
| `distract` | 25 | l'attention s'effondre quelques secondes (dangereux au volant ou en traversant) |
| `whisper`  | 10 | souffle une envie : `params.need` = faim, sommeil, compagnie ou loisir |
| `meet`     | 30 | provoque une rencontre avec `params.personId` dans un lieu à mi-chemin |
| `cheer`    | 10 | remonte le moral (plus sociable, plus attentif) |
| `hurry`    | 15 | le presse : il marche et roule plus vite, avec moins de prudence |
| `rumor`    | 35 | lui confie une rumeur sur un lieu ; elle se propage de conversation en conversation et attire les curieux |

L'habitant décide : la suggestion entre dans son IA à utilité avec un bonus qui
dépend de son caractère (têtu ou non) et de son humeur. Il peut refuser
(besoin pressant, travail, fatigue) ou abandonner en route ; la raison est
renvoyée au joueur et notée dans son journal.

## Étapes (un commit, un déploiement et une vérification navigateur chacune)

- a. Ville générée + caméra (zoom, déplacement, tactile)
- b. Habitants : besoins, horaires, déplacements à pied
- c. Voitures, trafic, accidents, secours
- d. Sélection, fiche habitant, commandes, jauge d'influence
- e. Chronique, sauvegarde, finitions visuelles, cycle jour/nuit, README

## Décisions prises sans consigne

- **Carte** : grille 46×46 (assez compacte pour que 420 habitants la fassent
  vivre, la consigne était « 300, plus si ça tient »), rues orthogonales à espacement irrégulier, quelques
  tronçons retirés pour casser le damier, un boulevard de ceinture, deux
  avenues, et un canal traversé par quelques ponts (goulots naturels : c'est là
  que naissent les bouchons).
- **Carrefours** : feux quand deux axes importants se croisent, sinon priorité
  à l'axe principal (cédez-le-passage sur l'autre). Circulation à droite. Les
  mouvements compatibles traversent en même temps ; la table des conflits est
  calculée géométriquement.
- **Accidents** : purement physiques. Un conducteur inattentif ne regarde pas
  à chaque tick ; s'il rate un freinage ou une priorité et touche quelqu'un, il
  y a accident. Aucun tirage « accident oui/non ». Un piéton distrait peut
  aussi traverser sans regarder.
- **Secours** : ambulance depuis l'hôpital, dépanneuse depuis le garage. Elles
  roulent sur la ligne médiane, les autres se serrent. Les badauds s'arrêtent,
  les conducteurs ralentissent pour regarder (bouchon de curiosité).
- **Soupape anti-blocage** : un conducteur coincé trop longtemps abandonne sa
  voiture et finit à pied (noté dans la chronique). Un accident jamais dégagé
  finit par l'être.
- **Temps** : la ville démarre un lundi à 6 h. Semaine de 7 jours, bureaux et
  école fermés le week-end, équipes de nuit à l'hôpital, bar ouvert tard.
- **Vie sociale** : conversations spontanées sur le trottoir et dans les lieux,
  amitiés, couples, rumeurs. Les fenêtres s'allument quand quelqu'un est
  éveillé à l'intérieur et s'éteignent quand la maison s'endort.
- **Rendu** : bâtiments dessinés en vectoriel une fois puis mis en cache par
  niveau de zoom ; tri en profondeur exact (bâtiments découpés par rangée).
  Nuit par variantes assombries + fenêtres et lampadaires. DPR plafonné à 2.
- **Trajets** : chaque habitant connaît la durée de son trajet domicile-travail
  (détour par les ponts compris) et la corrige après chaque trajet réel ; les
  retards restants viennent des bouchons, des accidents et des étourdis.
- **Sauvegarde** : seul l'état dynamique est stocké (la ville se régénère de la
  graine), ce qui tient largement dans localStorage.
