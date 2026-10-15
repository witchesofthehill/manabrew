import { MseError } from './document.mjs';
import { MseCard, MseSet, MseCollection, MseDateTime, force, text } from './script-values.mjs';
import { MseScope } from './script-runtime.mjs';

export class MseCardRegistry {
  constructor({clock=()=>new Date()}={}) { this.clock=clock;this.entries = new Map(); this.byObject = new Map(); this.sequence = 0; this.age = 0; this.cards = new MseCollection(); }
  register(context, input, uid) {
    if (uid === undefined) { do { uid = `card-${++this.sequence}`; } while (this.entries.has(uid)); }
    uid = String(uid);
    if (!uid || this.entries.has(uid)) throw new MseError('card-uid', `Duplicate or empty card UID ${uid}`);
    const links = Array.from({ length: 32 }, (_, i) => ({ uid: String(input[`linked_card_${i + 1}`] || ''), relation: String(input[`linked_relation_${i + 1}`] || '') }));
    const linkDependency={};
    const now=this.clock();
    const metadata={time_created:{value:new MseDateTime(input.time_created??now)},time_modified:{value:new MseDateTime(input.time_modified??now)}};
    const card = new MseCard(name => {
      if(Object.hasOwn(metadata,name)){context.fieldUpdates?.read(metadata[name]);return metadata[name].value;}
      if (name === 'uid') return uid;
      if (name === 'notes') return String(input.notes || '');
      const link = /^linked_(card|relation)_([1-9]|[12][0-9]|3[0-2])$/.exec(name);
      if (link) {context.fieldUpdates?.read(linkDependency);return links[Number(link[2]) - 1][link[1] === 'card' ? 'uid' : 'relation'];}
      return context.field('card', name);
    });
    const entry = { uid, card, links, linkDependency, context, metadata };
    this.entries.set(uid, entry); this.byObject.set(card, entry); this.cards.values.push(card);
    return card;
  }
  resolve(value) { value = force(value); return typeof value === 'string' ? this.entries.get(value) : this.byObject.get(value); }
  readLinks(entry) { this.fieldUpdates?.read(entry.linkDependency);return entry.links; }
  linked(entry, relation) { return this.readLinks(entry).filter(link => link.relation === relation).map(link => this.entries.get(link.uid)).filter(Boolean); }
  touch(card) {const cell=this.resolve(card).metadata.time_modified;cell.value=new MseDateTime(this.clock());return cell;}
  changed() { for (const entry of this.entries.values()) entry.context.invalidate(); }
  linksChanged(entries) {
    this.changed();
    // Native link actions notify dependent scripts. A script's own add_link /
    // remove_links call mutates storage directly during evaluation; it must not
    // start a recursive field-update transaction.
    if(this.fieldUpdates&&!this.fieldUpdates.running)this.fieldUpdates.changeMany([...new Set(entries.map(entry=>entry.linkDependency))]);
  }
  add(a, b, selected, linked) {
    const slot = (entry, uid) => entry.links.find(link => link.uid === uid) || entry.links.find(link => !link.uid) || entry.links.find(link => !this.entries.has(link.uid));
    const first = slot(a, b.uid), second = slot(b, a.uid);
    if (!first || !second) throw new MseError('card-links-full', 'No free card link slot');
    Object.assign(first, { uid: b.uid, relation: linked });
    Object.assign(second, { uid: a.uid, relation: selected });
    this.linksChanged([a,b]);
  }
  remove(a, b) {
    for (const [entry, uid] of [[a, b.uid], [b, a.uid]]) {
      const link = entry.links.find(link => link.uid === uid);
      if (link) Object.assign(link, { uid: '', relation: '' });
    }
    this.linksChanged([a,b]);
  }
}

export function cardLinkBuiltins(registry) {
  const input = scope => registry.resolve(scope.get('input'));
  const styledCard=scope=>{
    const card=force(scope.get('input')),set=force(scope.get('set'));
    const entry=registry.resolve(card);
    if(!(card instanceof MseCard)||!(set instanceof MseSet)||set.registry!==registry||!entry)
      throw new MseError('card-styling','Invalid set or card argument');
    return entry.context;
  };
  const face = (scope, direction) => {
    const entry = input(scope);
    if (!entry) return null;
    const context = entry.context, script = context.template.faceScripts?.[direction];
    if (script) {
      const result = force(context.runtime.evaluate(script, new MseScope(context.runtime.scope, [['input', scope.get('input')]])));
      if (result !== null && !registry.byObject.has(result)) throw new MseError('card-result', `get_${direction}_face_script must return a card or nil`);
      return result;
    }
    return registry.linked(entry, direction === 'front' ? 'Front Face' : 'Back Face')[0]?.card || null;
  };
  return {
    get_card_styling: scope=>styledCard(scope).runtime.scope.get('styling'),
    get_card_stylesheet: scope=>styledCard(scope).stylesheet,
    get_card_from_uid: scope => registry.entries.get(text(scope.get('input')))?.card || null,
    get_front_face: scope => face(scope, 'front'),
    get_back_face: scope => face(scope, 'back'),
    get_cards_from_link: scope => {
      const entry = input(scope); if (!entry) return null;
      const relation = text(scope.get('linked_relation'));
      let linked = registry.linked(entry, relation);
      const alias = entry.context.template.linkAliases?.get(relation);
      if (!linked.length && alias) linked = registry.linked(entry, alias);
      return new MseCollection(linked.map(entry => entry.card));
    },
    get_link_from_cards: scope => {
      const a = input(scope), b = registry.resolve(scope.get('linked_card'));
      if (!a || !b) return null;
      return new MseCollection([registry.readLinks(b).find(link => link.uid === a.uid)?.relation ?? null, registry.readLinks(a).find(link => link.uid === b.uid)?.relation ?? null]);
    },
    has_link: scope => { const entry = input(scope); return Boolean(entry&&registry.readLinks(entry).some(link => link.relation === text(scope.get('linked_relation')))); },
    add_link: scope => {
      const a = input(scope), b = registry.resolve(scope.get('linked_card'));
      if (!a || !b) return null;
      registry.add(a, b, text(scope.get('selected_relation')), text(scope.get('linked_relation')));
      return b.card;
    },
    remove_links: scope => {
      const entry = input(scope), targets = [];
      if (entry) {
        if (scope.has('linked_card')) { const target = registry.resolve(scope.get('linked_card')); if (target) targets.push(target); }
        if (scope.has('linked_relation') && force(scope.get('linked_relation')) !== null) targets.push(...registry.linked(entry, text(scope.get('linked_relation'))));
        for (const target of targets) registry.remove(entry, target);
      }
      return new MseCollection(targets.map(target => target.card));
    },
  };
}
