// Interface HTML par-dessus le canvas. Elle lit l'état pour l'afficher et
// produit des commandes ; elle ne modifie jamais la simulation.

import {
  COSTS, DAY_NAMES, INFLUENCE_MAX, LOC_AMB, LOC_DOWN, LOC_IN,
  activityText, attention, clockText, dayIndex, fullName, minuteOfDay, moodIcon, thoughtIcon, weekday,
  type Building, type ChronicleEvent, type CommandType, type NeedKey, type Person, type World,
} from '../sim';

export type Selection = { type: 'person' | 'building'; id: number } | null;

export interface UiHooks {
  world(): World;
  playerId: string;
  send(type: CommandType, targetId: number, params?: { buildingId?: number; personId?: number; need?: NeedKey }): void;
  select(sel: Selection, fly?: boolean): void;
  selection(): Selection;
  flyTo(x: number, y: number, zoom?: number): void;
  setSpeed(n: number): void;
  speed(): number;
  setFollow(on: boolean): void;
  following(): boolean;
  newCity(name: string | null): void;
  toggleLabels(): boolean;
  night(): number;
}

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k, v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, String(v));
  }
  for (const kid of kids) el.append(kid);
  return el;
}

const KIND_LABEL: Record<string, string> = {
  house: 'Maison', apartment: 'Immeuble', office: 'Bureaux', shop: 'Commerce', cafe: 'Café', restaurant: 'Restaurant',
  bar: 'Bar', hospital: 'Hôpital', school: 'École', park: 'Parc', garage: 'Garage', townhall: 'Mairie', cinema: 'Cinéma',
};
const KIND_ICON: Record<string, string> = {
  house: '🏠', apartment: '🏢', office: '🏬', shop: '🛍️', cafe: '☕', restaurant: '🍽️', bar: '🍷', hospital: '🏥',
  school: '🏫', park: '🌳', garage: '🔧', townhall: '🏛️', cinema: '🎬',
};
const EVENT_ICON: Record<ChronicleEvent['kind'], string> = {
  accident: '💥', rescue: '🚑', traffic: '🚗', social: '👋', love: '❤️', rumor: '🤫', life: '🌱', day: '🕰️', spirit: '✨',
};
const REL_LABEL: Record<string, [string, string]> = {
  family: ['famille', 'famille'], partner: ['en couple', 'en couple'], friend: ['ami', 'amie'],
  colleague: ['collègue', 'collègue'], neighbor: ['voisin', 'voisine'], known: ['connaissance', 'connaissance'],
};
const NEED_LABEL: [NeedKey, string, string][] = [['hunger', 'Faim', '🍴'], ['fatigue', 'Fatigue', '😴'], ['social', 'Solitude', '👋'], ['fun', 'Ennui', '🎈']];

interface ActionDef {
  type: CommandType;
  label: string;
  icon: string;
  hint: string;
  target?: 'building' | 'person';
  ask?: string;
}
const ACTIONS: ActionDef[] = [
  { type: 'goto', label: 'Envoyer', icon: '📍', hint: 'Lui donner envie d\'aller quelque part', target: 'building', ask: 'Touchez un lieu où envoyer {name}' },
  { type: 'visit', label: 'Visite', icon: '🚪', hint: 'Lui donner envie de passer voir quelqu\'un', target: 'person', ask: 'Touchez la personne à qui {name} rendra visite' },
  { type: 'meet', label: 'Rencontre', icon: '💐', hint: 'Provoquer une rencontre avec un autre habitant', target: 'person', ask: 'Touchez la personne que {name} doit rencontrer' },
  { type: 'goHome', label: 'Rentrer', icon: '🏠', hint: 'Lui donner envie de rentrer' },
  { type: 'distract', label: 'Distraire', icon: '💫', hint: 'Son attention s\'effondre quelques secondes. Dangereux au volant.' },
  { type: 'whisper', label: 'Envie', icon: '🌬️', hint: 'Souffler une envie : faim, sommeil, compagnie, loisir' },
  { type: 'hurry', label: 'Presser', icon: '⚡', hint: 'Marche et roule plus vite, moins prudemment' },
  { type: 'cheer', label: 'Égayer', icon: '☀️', hint: 'Lui remonter le moral' },
  { type: 'skipWork', label: 'Sécher', icon: '🙈', hint: 'Lui donner envie de sécher le travail ou l\'école' },
  { type: 'rumor', label: 'Rumeur', icon: '🤫', hint: 'Lui confier une rumeur sur un lieu : elle se propagera', target: 'building', ask: 'Touchez le lieu sur lequel lancer une rumeur' },
];

function traitWords(p: Person): string[] {
  const t = p.traits, f = p.female;
  const out: string[] = [];
  const add = (v: number, hi: string, lo: string) => { if (v >= 0.72) out.push(hi); else if (v <= 0.3) out.push(lo); };
  add(t.soc, 'sociable', 'solitaire');
  add(t.punct, f ? 'ponctuelle' : 'ponctuel', 'toujours en retard');
  add(t.care, f ? 'prudente' : 'prudent', "tête en l'air");
  add(t.stub, f ? 'têtue' : 'têtu', 'influençable');
  add(t.energy, 'énergique', f ? 'nonchalante' : 'nonchalant');
  add(t.curio, f ? 'curieuse' : 'curieux', f ? 'blasée' : 'blasé');
  return out;
}

function when(tick: number, now: number): string {
  const d = dayIndex(tick);
  const today = dayIndex(now);
  const day = d === today ? '' : d === today - 1 ? 'hier ' : `${DAY_NAMES[weekday(tick)]!.slice(0, 3)}. `;
  return `${day}${clockText(tick)}`;
}

function hours(b: Building): string {
  if (b.openFrom === 0 && b.openTo === 1440) return 'ouvert jour et nuit';
  const f = (m: number) => `${Math.floor((m % 1440) / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
  return `${f(b.openFrom)} – ${f(b.openTo)}`;
}

export class Ui {
  private el: {
    city: HTMLElement; clock: HTMLElement; sun: HTMLElement; speeds: HTMLElement; gaugeFill: HTMLElement; gaugeNum: HTMLElement;
    toasts: HTMLElement; sheet: HTMLElement; chron: HTMLElement; chronList: HTMLElement; ticker: HTMLElement;
    banner: HTMLElement; bannerText: HTMLElement; menu: HTMLElement; intro: HTMLElement;
  };
  private pending: { def: ActionDef; personId: number } | null = null;
  private sheetKey = '';
  private tab: 'vie' | 'liens' | 'journal' = 'vie';
  private lastEvent = -1;
  private lastFeedback = 0;
  private listSig = '';
  private whisperOpen = false;

  constructor(root: HTMLElement, private hooks: UiHooks) {
    const speeds = h('div', { class: 'pill speeds', role: 'group', 'aria-label': 'Vitesse du temps' });
    for (const [s, label, title] of [[0, '❚❚', 'Pause (espace)'], [1, '▶', 'Vitesse normale (1)'], [4, '×4', 'Rapide (2)'], [16, '×16', 'Très rapide (3)']] as [number, string, string][])
      speeds.append(h('button', { 'data-s': s, title, 'aria-label': title, click: () => { hooks.setSpeed(s); this.update(true); } }, label));
    const sun = h('span', { class: 'sun' }, '☀️');
    const city = h('b', {}, '');
    const clock = h('small', {}, '');
    const gaugeFill = h('i', {});
    const gaugeNum = h('b', {}, '0');
    const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const sheet = h('aside', { class: 'panel sheet', hidden: true });
    const chronList = h('div', { class: 'chron-list' });
    const ticker = h('button', { class: 'ticker', click: () => this.el.chron.classList.toggle('open') });
    const chron = h('aside', { class: 'panel chron' },
      h('header', { click: () => this.el.chron.classList.toggle('open') }, h('b', {}, 'Chronique'), h('span', { class: 'chev' }, '⌄')),
      ticker, chronList);
    const bannerText = h('span', {}, '');
    const banner = h('div', { class: 'banner', hidden: true }, bannerText, h('button', { click: () => this.cancelTarget() }, 'Annuler'));
    const menu = h('div', { class: 'menu-pop panel', hidden: true },
      h('button', { click: () => { this.el.menu.hidden = true; const name = prompt('Nom de la nouvelle ville (il sert de graine) :', ''); if (name !== null) hooks.newCity(name.trim() || null); } }, '🌱 Nouvelle ville…'),
      h('button', { click: (e) => { (e.currentTarget as HTMLElement).textContent = hooks.toggleLabels() ? '🏷️ Masquer les enseignes' : '🏷️ Afficher les enseignes'; } }, '🏷️ Masquer les enseignes'),
      h('button', { click: () => { this.el.menu.hidden = true; this.el.intro.hidden = false; } }, '❔ Comment jouer'),
      h('p', {}, 'La ville est sauvegardée automatiquement dans ce navigateur.'));
    const intro = h('div', { class: 'intro', hidden: true },
      h('div', { class: 'card' },
        h('h1', {}, 'Ville vivante'),
        h('p', {}, 'Quelques centaines d\'habitants vivent ici leur vie : ils dorment, travaillent, se croisent, tombent amoureux, prennent leur voiture. Rien n\'est écrit d\'avance.'),
        h('p', {}, 'Vous êtes un petit esprit. Touchez un habitant pour lire sa vie, puis soufflez-lui une idée : aller quelque part, rencontrer quelqu\'un, se laisser distraire… Il reste libre de refuser, et les conséquences se propagent toutes seules.'),
        h('ul', {},
          h('li', {}, h('b', {}, 'Glisser'), ' pour se déplacer, ', h('b', {}, 'pincer'), ' ou molette pour zoomer.'),
          h('li', {}, 'Chaque idée coûte de l\'', h('b', {}, 'influence ✦'), ', qui se recharge avec le temps.'),
          h('li', {}, 'La ', h('b', {}, 'chronique'), ' raconte ce qui arrive ; touchez une ligne pour y aller.')),
        h('button', { class: 'primary', click: () => { this.el.intro.hidden = true; try { localStorage.setItem('ville-vivante:intro', '1'); } catch { /* stockage indisponible */ } } }, 'Entrer dans la ville')));
    root.append(
      h('header', { class: 'bar' },
        h('div', { class: 'pill title' }, sun, h('div', {}, city, clock)),
        speeds,
        h('div', { class: 'pill influence', title: 'Influence : chaque idée soufflée en coûte, elle se recharge avec le temps' }, h('span', {}, '✦'), h('div', { class: 'gauge' }, gaugeFill), gaugeNum),
        h('button', { class: 'pill icon', 'aria-label': 'Menu', click: () => { this.el.menu.hidden = !this.el.menu.hidden; } }, '☰')),
      toasts, sheet, chron, banner, menu, intro);
    this.el = { city, clock, sun, speeds, gaugeFill, gaugeNum, toasts, sheet, chron, chronList, ticker, banner, bannerText, menu, intro };
    try { if (!localStorage.getItem('ville-vivante:intro')) intro.hidden = false; } catch { intro.hidden = false; }
    this.lastFeedback = hooks.world().state.tick;
  }

  /** Une action attend-elle qu'on désigne un lieu ou un habitant sur la carte ? */
  wantsTarget(): boolean {
    return this.pending !== null;
  }
  provideTarget(sel: Selection): void {
    const pend = this.pending;
    if (!pend || !sel) return;
    const w = this.hooks.world();
    if (pend.def.target === 'building') {
      // Toucher un habitant désigne le lieu où il se trouve.
      const b = sel.type === 'building' ? sel.id : w.state.people[sel.id]?.loc === LOC_IN ? w.state.people[sel.id]!.at : -1;
      if (b < 0) return this.toast('Touchez plutôt un bâtiment ou un parc.', false);
      this.hooks.send(pend.def.type, pend.personId, { buildingId: b });
    } else {
      if (sel.type !== 'person') return this.toast('Touchez un habitant (zoomez pour mieux les voir).', false);
      if (sel.id === pend.personId) return this.toast('Il faut désigner quelqu\'un d\'autre.', false);
      this.hooks.send(pend.def.type, pend.personId, { personId: sel.id });
    }
    this.cancelTarget();
  }
  cancelTarget(): void {
    this.pending = null;
    this.el.banner.hidden = true;
    document.body.classList.remove('targeting');
  }

  toast(text: string, ok: boolean): void {
    const t = h('div', { class: `toast ${ok ? 'ok' : 'no'}` }, text);
    this.el.toasts.append(t);
    while (this.el.toasts.childElementCount > 3) this.el.toasts.firstElementChild?.remove();
    setTimeout(() => t.classList.add('gone'), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  private act(def: ActionDef, p: Person): void {
    if (def.type === 'whisper') { this.whisperOpen = !this.whisperOpen; this.sheetKey = ''; this.update(true); return; }
    if (def.target) {
      this.pending = { def, personId: p.id };
      this.el.bannerText.textContent = (def.ask ?? '').replace('{name}', p.first);
      this.el.banner.hidden = false;
      document.body.classList.add('targeting');
      return;
    }
    this.hooks.send(def.type, p.id);
  }

  /** Rafraîchit l'affichage. Appelé quelques fois par seconde. */
  update(force = false): void {
    const w = this.hooks.world();
    const s = w.state;
    const el = this.el;
    el.city.textContent = w.city.name;
    el.clock.textContent = `${DAY_NAMES[weekday(s.tick)]} · ${clockText(s.tick)}`;
    const m = minuteOfDay(s.tick);
    el.sun.textContent = m < 330 || m >= 1290 ? '🌙' : m < 450 ? '🌅' : m >= 1170 ? '🌇' : '☀️';
    document.body.classList.toggle('night', this.hooks.night() > 0.5);
    for (const b of Array.from(el.speeds.children)) b.classList.toggle('on', Number((b as HTMLElement).dataset['s']) === this.hooks.speed());
    const inf = s.players[this.hooks.playerId]?.influence ?? 60;
    el.gaugeFill.style.width = `${(inf / INFLUENCE_MAX) * 100}%`;
    el.gaugeNum.textContent = String(Math.floor(inf));

    // Retours des commandes du joueur.
    for (const f of s.feedback) {
      if (f.t <= this.lastFeedback || f.playerId !== this.hooks.playerId) continue;
      this.toast(f.text, f.ok);
    }
    if (s.feedback.length) this.lastFeedback = Math.max(this.lastFeedback, s.feedback[s.feedback.length - 1]!.t);
    if (s.tick < this.lastFeedback) this.lastFeedback = s.tick; // nouvelle ville

    this.chronicle(w, force);
    this.sheet(w, force);
  }

  private chronicle(w: World, force: boolean): void {
    const c = w.state.chronicle;
    const lastId = c.length ? c[c.length - 1]!.id : 0;
    if (lastId === this.lastEvent && !force) return;
    const first = this.lastEvent === -1;
    this.lastEvent = lastId;
    const list = this.el.chronList;
    list.textContent = '';
    for (let i = c.length - 1; i >= 0 && i >= c.length - 70; i--) {
      const ev = c[i]!;
      const mine = ev.by === this.hooks.playerId;
      list.append(h('button', { class: `ev k-${ev.kind}${mine ? ' mine' : ''}${i === c.length - 1 && !first ? ' new' : ''}`, click: () => this.goEvent(ev) },
        h('span', { class: 'ic' }, EVENT_ICON[ev.kind]),
        h('span', { class: 'tx' }, h('time', {}, when(ev.t, w.state.tick) + (mine ? ' · par vous ✦' : '')), ev.text)));
    }
    const latest = c[c.length - 1];
    this.el.ticker.textContent = '';
    if (latest) this.el.ticker.append(h('span', { class: 'ic' }, EVENT_ICON[latest.kind]), h('span', { class: 'tx' }, latest.text), h('span', { class: 'chev' }, '⌃'));
  }

  private goEvent(ev: ChronicleEvent): void {
    const w = this.hooks.world();
    this.el.chron.classList.remove('open');
    if (ev.person >= 0 && w.state.people[ev.person]) this.hooks.select({ type: 'person', id: ev.person }, ev.x < 0);
    else if (ev.building >= 0) this.hooks.select({ type: 'building', id: ev.building }, ev.x < 0);
    if (ev.x >= 0) this.hooks.flyTo(ev.x, ev.y, 70);
  }

  private sheet(w: World, force: boolean): void {
    const sel = this.hooks.selection();
    const sheet = this.el.sheet;
    document.body.classList.toggle('has-sheet', sel !== null);
    if (!sel) {
      if (!sheet.hidden) { sheet.hidden = true; this.sheetKey = ''; }
      return;
    }
    const key = `${sel.type}:${sel.id}:${this.tab}`;
    if (key !== this.sheetKey || force) {
      const same = key === this.sheetKey;
      this.sheetKey = key;
      this.listSig = '';
      const scroll = same ? sheet.querySelector('.body')?.scrollTop ?? 0 : 0;
      sheet.textContent = '';
      sheet.hidden = false;
      if (sel.type === 'person') this.buildPerson(w, w.state.people[sel.id]!);
      else this.buildBuilding(w, w.city.buildings[sel.id]!);
      const body = sheet.querySelector('.body');
      if (body) body.scrollTop = scroll;
    }
    if (sel.type === 'person') this.refreshPerson(w, w.state.people[sel.id]!);
    else this.refreshBuilding(w, w.city.buildings[sel.id]!);
  }

  private close = (): void => {
    this.cancelTarget();
    this.hooks.select(null);
    this.update(true);
  };

  private personLink(p: Person, extra = ''): HTMLElement {
    return h('button', { class: 'link', click: () => { if (this.wantsTarget()) this.provideTarget({ type: 'person', id: p.id }); else this.hooks.select({ type: 'person', id: p.id }, true); } },
      h('span', { class: 'face' }, moodIcon(p)), h('span', { class: 'nm' }, fullName(p)), h('small', {}, extra));
  }
  private placeLink(b: Building, prefix: string): HTMLElement {
    return h('button', { class: 'link place', click: () => { if (this.wantsTarget()) this.provideTarget({ type: 'building', id: b.id }); else this.hooks.select({ type: 'building', id: b.id }, true); } },
      h('span', { class: 'face' }, KIND_ICON[b.kind] ?? '🏠'), h('span', { class: 'nm' }, `${prefix}${b.name}`));
  }

  private buildPerson(w: World, p: Person): void {
    const B = w.city.buildings;
    const tabs = h('nav', { class: 'tabs' });
    for (const [id, label] of [['vie', 'Sa vie'], ['liens', `Proches (${p.rel.length})`], ['journal', 'Journal']] as ['vie' | 'liens' | 'journal', string][])
      tabs.append(h('button', { class: this.tab === id ? 'on' : '', click: () => { this.tab = id; this.update(true); } }, label));
    const body = h('div', { class: 'body' });
    if (this.tab === 'vie') {
      const needs = h('div', { class: 'needs' });
      for (const [k, label, icon] of NEED_LABEL) needs.append(h('div', { class: 'need', 'data-k': k }, h('span', {}, `${icon} ${label}`), h('div', { class: 'meter' }, h('i', {}))));
      needs.append(h('div', { class: 'need', 'data-k': 'mood' }, h('span', {}, '🙂 Humeur'), h('div', { class: 'meter good' }, h('i', {}))));
      needs.append(h('div', { class: 'need', 'data-k': 'att' }, h('span', {}, '👁️ Attention'), h('div', { class: 'meter good' }, h('i', {}))));
      const traits = h('div', { class: 'chips' });
      for (const t of traitWords(p)) traits.append(h('span', {}, t));
      body.append(needs, traits, h('div', { class: 'places' },
        this.placeLink(B[p.home]!, 'Habite : '),
        ...(p.work >= 0 ? [this.placeLink(B[p.work]!, p.role === 'student' ? 'École : ' : 'Travail : ')] : []),
        h('p', { class: 'meta' }, p.work >= 0 ? `Horaires : ${Math.floor(p.shiftStart / 60)} h ${String(p.shiftStart % 60).padStart(2, '0')} – ${Math.floor((p.shiftEnd % 1440) / 60)} h ${String(p.shiftEnd % 60).padStart(2, '0')}${p.car >= 0 ? ' · a une voiture' : ''}` : p.car >= 0 ? 'A une voiture' : '')));
    } else body.append(h('div', { class: 'list' }));
    const actions = h('div', { class: 'actions' });
    for (const def of ACTIONS) {
      actions.append(h('button', { class: 'act', 'data-type': def.type, title: def.hint, click: () => this.act(def, p) },
        h('span', { class: 'ai' }, def.icon), h('span', { class: 'al' }, def.label), h('span', { class: 'ac' }, `✦ ${COSTS[def.type]}`)));
    }
    const whisper = h('div', { class: 'whisper', hidden: !this.whisperOpen });
    for (const [k, label] of [['hunger', '🍴 Faim'], ['fatigue', '😴 Sommeil'], ['social', '👋 Compagnie'], ['fun', '🎈 Loisir']] as [NeedKey, string][])
      whisper.append(h('button', { click: () => { this.hooks.send('whisper', p.id, { need: k }); this.whisperOpen = false; this.sheetKey = ''; this.update(true); } }, label));
    this.el.sheet.append(
      h('header', {},
        h('div', { class: 'who' },
          h('div', { class: 'avatar', 'data-face': '' }, moodIcon(p)),
          h('div', {}, h('h2', {}, fullName(p)), h('p', {}, `${p.age} ans · ${p.job || (p.role === 'retired' ? 'à la retraite' : '')}`))),
        h('button', { class: 'follow', title: 'Suivre à la caméra', click: () => { this.hooks.setFollow(!this.hooks.following()); this.update(); } }, '🎥 Suivre'),
        h('button', { class: 'x', 'aria-label': 'Fermer', click: this.close }, '×')),
      h('p', { class: 'doing' }, ''),
      tabs, body, whisper, actions);
  }

  private refreshPerson(w: World, p: Person): void {
    const sheet = this.el.sheet;
    const t = w.state.tick;
    const doing = sheet.querySelector('.doing') as HTMLElement;
    const text = `${thoughtIcon(w, p)} ${p.first} ${activityText(w, p)}.`;
    if (doing.textContent !== text) doing.textContent = text;
    (sheet.querySelector('.avatar') as HTMLElement).textContent = moodIcon(p);
    sheet.querySelector('.follow')?.classList.toggle('on', this.hooks.following());
    if (this.tab === 'vie') {
      const set = (k: string, v: number) => {
        const i = sheet.querySelector(`.need[data-k="${k}"] i`) as HTMLElement | null;
        if (i) { i.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; i.parentElement!.classList.toggle('high', v > 0.75); }
      };
      for (const [k] of NEED_LABEL) set(k, p.needs[k]);
      set('mood', p.mood);
      set('att', attention(p, t));
    } else {
      const list = sheet.querySelector('.list') as HTMLElement;
      if (this.tab === 'liens') {
        const sig = `l${p.rel.length}:${p.rel.reduce((a, r) => a + Math.round(r.aff * 20), 0)}:${p.partner}`;
        if (sig !== this.listSig) {
          this.listSig = sig;
          list.textContent = '';
          const order = { partner: 0, family: 1, friend: 2, colleague: 3, neighbor: 4, known: 5 } as Record<string, number>;
          for (const r of [...p.rel].sort((a, b) => order[a.kind]! - order[b.kind]! || b.aff - a.aff)) {
            const o = w.state.people[r.id]!;
            const hearts = '●'.repeat(Math.max(1, Math.round(r.aff * 5))) + '○'.repeat(5 - Math.max(1, Math.round(r.aff * 5)));
            list.append(this.personLink(o, `${REL_LABEL[r.kind]![o.female ? 1 : 0]} ${hearts}`));
          }
          if (!p.rel.length) list.append(h('p', { class: 'meta' }, 'Ne connaît encore personne.'));
        }
      } else {
        const sig = `j${p.journal.length}:${p.journal.length ? p.journal[p.journal.length - 1]!.t : 0}`;
        if (sig !== this.listSig) {
          this.listSig = sig;
          list.textContent = '';
          for (let i = p.journal.length - 1; i >= 0; i--) list.append(h('p', { class: 'entry' }, h('time', {}, when(p.journal[i]!.t, t)), p.journal[i]!.s));
          if (!p.journal.length) list.append(h('p', { class: 'meta' }, 'Rien de marquant pour l\'instant.'));
        }
      }
    }
    const inf = w.state.players[this.hooks.playerId]?.influence ?? 60;
    const blocked = t < p.cooldownUntil || p.loc === LOC_DOWN || p.loc === LOC_AMB || p.act === 'hospital';
    for (const b of Array.from(sheet.querySelectorAll('.act')) as HTMLButtonElement[]) {
      const type = b.dataset['type'] as CommandType;
      b.disabled = blocked || inf < COSTS[type];
      b.classList.toggle('armed', this.pending?.def.type === type || (type === 'whisper' && this.whisperOpen));
    }
    sheet.querySelector('.actions')?.classList.toggle('cooling', t < p.cooldownUntil);
  }

  private buildBuilding(w: World, b: Building): void {
    const street = w.city.lines[b.line]!.name;
    this.el.sheet.append(
      h('header', {},
        h('div', { class: 'who' },
          h('div', { class: 'avatar' }, KIND_ICON[b.kind] ?? '🏠'),
          h('div', {}, h('h2', {}, b.name), h('p', {}, `${KIND_LABEL[b.kind]} · ${street}`))),
        h('button', { class: 'x', 'aria-label': 'Fermer', click: this.close }, '×')),
      h('p', { class: 'doing' }, ''),
      h('div', { class: 'body' }, h('div', { class: 'list' })));
  }

  private refreshBuilding(w: World, b: Building): void {
    const sheet = this.el.sheet;
    const s = w.state;
    const occ = w.rt.occupants[b.id]!;
    const housing = b.kind === 'house' || b.kind === 'apartment';
    const doing = sheet.querySelector('.doing') as HTMLElement;
    const text = housing ? `${occ.length} personne${occ.length > 1 ? 's' : ''} à la maison.` : `${hours(b)} · ${occ.length} personne${occ.length > 1 ? 's' : ''} sur place.`;
    if (doing.textContent !== text) doing.textContent = text;
    const sig = `b${occ.join(',')}`;
    if (sig === this.listSig) return;
    this.listSig = sig;
    const list = sheet.querySelector('.list') as HTMLElement;
    list.textContent = '';
    const here = new Set(occ);
    const members = s.people.filter((p) => (housing ? p.home === b.id : p.work === b.id));
    if (occ.length) {
      list.append(h('h3', {}, 'Sur place'));
      for (const id of occ.slice(0, 40)) { const p = s.people[id]!; list.append(this.personLink(p, activityText(w, p).split(' au ')[0]!.split(' à ')[0]!)); }
    }
    const away = members.filter((p) => !here.has(p.id));
    if (away.length) {
      list.append(h('h3', {}, housing ? 'Habitants sortis' : b.kind === 'school' ? 'Élèves et professeurs absents' : 'Employés absents'));
      for (const p of away.slice(0, 40)) list.append(this.personLink(p, p.job));
    }
    if (!occ.length && !away.length) list.append(h('p', { class: 'meta' }, housing ? 'Ce logement est inoccupé.' : 'Personne pour le moment.'));
  }
}
