# Ville vivante

Une petite ville isométrique, générée à partir d'une graine, où environ 420
habitants vivent leur vie sans script : ils dorment, déjeunent, vont travailler
à pied ou en voiture, se croisent, se lient, tombent amoureux. Les heures de
pointe, les bouchons, les rencontres et les accidents émergent de la
simulation.

Vous êtes un petit esprit. Vous ne pilotez personne : vous soufflez une idée à
un habitant, il l'accepte ou la refuse selon son caractère et ses besoins, et
les conséquences se propagent toutes seules jusque dans la chronique de la
ville.

**En ligne : <https://hugohismans.github.io/Town/>**

## Lancer

Il faut Node 22.

```sh
npm ci
npm run dev       # http://localhost:5173/
npm test          # Vitest sur la simulation
npm run build     # site statique dans dist/ (chemins relatifs)
```

Adresses utiles : `?seed=42` ou `?seed=Port-Hugo` force une ville (sans
toucher à la sauvegarde), `?speed=16` démarre en accéléré.

Chaque push sur `main` passe les tests, construit le site et le publie sur
GitHub Pages (`.github/workflows/deploy.yml`).

## Jouer

- Glisser pour se déplacer, pincer ou molette pour zoomer, toucher pour
  sélectionner. Clavier : espace (pause), 1, 2, 3 (vitesses), Échap.
- Toucher un habitant ouvre sa fiche : besoins, humeur, attention, caractère,
  proches, journal, et un bouton pour le suivre à la caméra.
- Dix idées à souffler, chacune avec un coût en influence ✦ :

| action | coût | ce qui se passe |
|---|---|---|
| Envoyer | 15 | lui donne envie d'aller dans un lieu que vous désignez |
| Visite | 15 | lui donne envie de passer voir quelqu'un |
| Rencontre | 30 | donne rendez-vous à deux habitants dans un lieu à mi-chemin |
| Rentrer | 10 | lui donne envie de rentrer chez lui |
| Distraire | 25 | son attention s'effondre quelques secondes ; au volant ou en traversant, c'est dangereux |
| Envie | 10 | faim, sommeil, compagnie ou loisir |
| Presser | 15 | il marche et roule plus vite, moins prudemment |
| Égayer | 10 | lui remonte le moral |
| Sécher | 20 | lui donne envie de sécher le travail ou l'école |
| Rumeur | 35 | il croit qu'il se passe quelque chose quelque part, y va, et en parle autour de lui |

Quelques réactions en chaîne à essayer : distraire un conducteur lancé vers une
file à l'arrêt ; souffler le sommeil à quelqu'un qui conduit ; lancer une
rumeur sur un café à l'heure du déjeuner ; presser un piéton puis le distraire
devant un passage piéton ; provoquer la rencontre de deux célibataires.

## Architecture

Trois couches, et une seule règle de dépendance : `sim` n'importe rien,
`render` et `ui` lisent `sim`, seul `main.ts` connaît les trois. Un test
(`tests/purity.test.ts`) le vérifie.

```
src/sim/      simulation pure (3 700 lignes) : aucun DOM, aucun canvas, tourne dans Node
  citygen.ts    rues, canal, ponts, carrefours, graphes voiture et piéton, bâtiments
  popgen.ts     foyers, emplois, horaires, relations, voitures
  people.ts     besoins, IA à utilité, marche, conversations, amours, rumeurs
  traffic.ts    voies, feux, priorités, piétons, accidents, ambulances, dépanneuses
  commands.ts   validation et application des commandes, jauge d'influence
  path.ts       plus courts chemins (trottoirs, voies)
  roadgeo.ts    courbes de carrefour, table de conflits entre mouvements
  world.ts      createWorld, step, snapshot, restore, hashState
  chronicle.ts, query.ts, names.ts, rng.ts, constants.ts, types.ts
src/render/   lit l'état, ne le modifie jamais (2 300 lignes)
  models.ts     bâtiments, arbres, lampadaires en listes de polygones
  sprites.ts    cache par niveau de zoom, bâtiments découpés par rangée
  ground.ts     sol peint en dalles mises en cache (ou en direct, de près)
  entities.ts   habitants et véhicules
  renderer.ts   une image : sol, tri en profondeur, nuit, bulles, sélection
src/ui/       produit des commandes, ne modifie jamais l'état (600 lignes)
  ui.ts, input.ts, style.css
src/main.ts   boucle à pas fixe, caméra, sauvegarde
tests/        déterminisme, accident, commandes, génération, pureté des couches
```

### Deux objets

- **`City`** : tout ce qui est statique (tuiles, rues, carrefours, bâtiments).
  C'est une fonction pure de la graine ; elle n'est jamais sérialisée.
- **`SimState`** : tout ce qui bouge (habitants, voitures, accidents, garde-
  manger, chronique, joueurs, file de commandes, état du PRNG). Uniquement des
  objets, tableaux, nombres, chaînes et booléens : `JSON.stringify(state)` est
  le snapshot (≈ 570 ko, 113 ko gzippé), `restore()` régénère la ville depuis
  la graine et reprend exactement.

### Un tick

10 ticks par seconde en vitesse ×1 ; un tick vaut 12 secondes de temps de
ville, une journée dure 12 minutes (45 secondes en ×16). Le rendu interpole
entre deux ticks.

```
step(world):
  tick++
  reconstruire les index dérivés (voitures par voie, occupants par bâtiment)
  appliquer les commandes dues à ce tick        <- seule porte d'entrée du joueur
  recharger l'influence
  habitants : besoins, décision, marche, conversations
  trafic : voitures, carrefours, collisions, secours
  chronique du jour
```

### Déterminisme

- Un seul PRNG (mulberry32) dont l'état vit dans `SimState`.
- Ni `Math.random`, ni `Date.now`, ni fonction transcendante dans `sim/` :
  seulement `+ - * /` et `sqrt`, identiques sur tous les moteurs JavaScript.
- Itérations dans l'ordre des identifiants ; les index dérivés sont
  reconstruits à chaque tick et ne font pas partie de l'état.
- Tests : même graine + même liste de commandes = même hash après 10 000
  ticks ; un snapshot restauré en cours de route donne la même suite.

### Les habitants ne sont jamais télécommandés

Une commande ne déplace personne. Elle pose une suggestion, fait chuter
l'attention ou change l'humeur ; ensuite `decide()` compare cette suggestion
à tout le reste (travail selon la ponctualité, faim, fatigue, envies) avec un
poids qui dépend de l'entêtement et de l'humeur de l'habitant. S'il la
retient, il se met en route par ses propres moyens ; sinon il refuse et dit
pourquoi. Il peut aussi abandonner en chemin si un besoin devient pressant.

### Les accidents sont physiques

Il n'y a pas de tirage « accident ». Un conducteur attentif regarde la route à
chaque tick et freine à temps. Un conducteur inattentif (distrait par un
esprit, épuisé, pressé, ou victime d'une petite inattention spontanée) ne
regarde plus : il garde sa vitesse, ne voit ni la file arrêtée, ni le feu, ni
la priorité, ni le piéton. S'il touche quelqu'un, la voie ou le carrefour est
bloqué, les blessés attendent l'ambulance, la dépanneuse dégage les épaves,
les badauds s'attroupent, les autres conducteurs ralentissent pour regarder,
ceux dont l'itinéraire passait par là arrivent en retard, et tout finit dans
la chronique et dans les journaux des personnes concernées.

## Performances

Mesuré, pas supposé, mais dans un Chromium sans GPU (rendu logiciel), en
résolution téléphone 390 × 844 avec une densité de pixels de 2 :

| vue | images/s | JavaScript par image |
|---|---|---|
| ville entière, heure de pointe, ×1 | 60 | 2,0 ms |
| ville entière, ×16 | 60 | 1,8 ms |
| zoom moyen | 60 | 1,3 ms |
| nuit, ville entière | 59 | 2,2 ms |
| zoom rapproché | 50 à 55 | 1 à 2 ms |

Un pas de simulation coûte 0,06 à 0,12 ms (une journée entière se simule en
0,8 s dans Node). Ce qui reste, de près, est du tramage de grands sprites, que
le GPU d'un téléphone fait bien plus vite que ce conteneur. Je n'ai pas pu
mesurer sur un vrai téléphone : c'est à vérifier de votre côté. Garde-fous en
place : densité de pixels plafonnée à 2 et abaissée automatiquement si
l'appareil peine, budget mémoire des sprites avec repli sur un niveau de
détail plus grossier. Canvas 2D suffit ; pas besoin de WebGL à cette échelle.

## Passage en ville partagée

La destination est une ville unique et persistante que tous les visiteurs
influencent en même temps. Rien de réseau n'est codé, mais l'architecture est
faite pour.

### Ce qui est déjà prêt

- **Commandes sérialisables** : `{ tick, playerId, type, targetId, params }`,
  seule porte d'entrée dans l'état. L'interface n'appelle qu'une fonction,
  `send`, câblée dans `main.ts` sur `submit(world, cmd)`.
- **File dans l'état** : les commandes en attente font partie du snapshot et
  sont appliquées, dans leur ordre d'arrivée, au début du tick visé.
- **Validation dans la simulation** : cible existante, paramètres, coût en
  influence par joueur, délai entre deux sollicitations d'un même habitant
  (commun à tous les joueurs), file plafonnée. Un client modifié ne peut rien
  obtenir de plus qu'un client honnête.
- **Plusieurs joueurs** : `state.players` est indexé par `playerId`, les
  retours (`feedback`) et les événements de la chronique portent leur auteur.
- **Déterminisme, snapshot, hash** : de quoi faire tourner la même ville sur
  le serveur et chez chaque client, et détecter une divergence.
- **Simulation sans navigateur** : `sim/` tourne tel quel dans Node (c'est ce
  que font les tests).

### Ce qu'il faudra brancher

1. **Un serveur d'autorité** qui fait tourner `sim/` à 10 ticks/s, sans pause
   ni accéléré, et persiste un snapshot à intervalle régulier.
2. **L'ordonnancement des commandes.** Le client envoie seulement
   `{ type, targetId, params }`. Le serveur ajoute le `playerId` tiré de la
   session (jamais celui annoncé par le client) et le `tick` d'application
   (tick courant + 2 ou 3, pour laisser le temps de diffuser), applique une
   limite de débit par joueur, puis diffuse la commande à tous.
3. **Deux façons de synchroniser**, la première étant celle pour laquelle le
   code est fait :
   - *Lockstep déterministe* : chaque client simule localement et applique
     les mêmes commandes aux mêmes ticks. Le serveur envoie un battement
     (numéro de tick et, toutes les N secondes, `hashState`). En cas d'écart,
     le client redemande un snapshot. Le trafic réseau se limite aux
     commandes.
   - *État diffusé* : le serveur envoie des snapshots ou des deltas. Plus
     simple à raisonner, bien plus lourd.
4. **L'arrivée d'un visiteur** : il reçoit le dernier snapshot (113 ko
   gzippés) et les commandes émises depuis, appelle `restore()`, rejoue les
   ticks manquants en accéléré, puis suit le battement.
5. **Dans `main.ts`**, trois changements et rien d'autre :
   - `send` écrit sur le WebSocket au lieu d'appeler `submit` ;
   - la boucle n'avance plus selon l'horloge locale mais jusqu'au tick annoncé
     par le serveur (l'interpolation du rendu ne change pas) ;
   - la sauvegarde locale et les boutons de vitesse disparaissent.
6. **Un vrai `playerId`** : aujourd'hui un identifiant aléatoire gardé dans
   `localStorage`. Demain, celui de la session authentifiée.
7. **Une version commune** : `SIM_VERSION` est dans le snapshot ; le serveur
   doit refuser un client dont la version de `sim/` diffère (sinon les
   simulations divergent) et l'inviter à recharger.

### Points de vigilance

- Le déterminisme entre machines repose sur l'interdiction des fonctions
  transcendantes dans `sim/`. Le test de pureté doit rester.
- Le coût en influence et le délai par habitant sont réglés pour un joueur.
  À plusieurs centaines, il faudra sans doute un coût qui croît avec la
  popularité d'une cible et des protections contre le harcèlement d'un même
  habitant (le délai commun en est le début).
- La jauge se recharge au rythme des ticks : en ville partagée, elle ne
  dépend donc plus de la vitesse choisie par chacun.

## Limites connues

- Une seule voie par sens ; les voitures ne se doublent pas.
- Les véhicules de secours passent entre les files sans gêner personne (les
  autres leur cèdent les carrefours, mais ne se rangent pas visuellement).
- Les logements vacants restent sombres : la ville a plus de maisons que de
  foyers.
- Pas encore de saisons, de météo, de naissances ni de déménagements.
