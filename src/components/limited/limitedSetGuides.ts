export interface LimitedGuideTopic {
  title: string;
  text: string;
  cards: string[];
}

export interface LimitedSetGuide {
  name: string;
  coverage: string;
  archetypes: LimitedGuideTopic[];
  mechanics: LimitedGuideTopic[];
  interactions: LimitedGuideTopic[];
  sources: { title: string; url: string }[];
}

const feature = "https://magic.wizards.com/en/news/feature/";
const topic = (title: string, text: string, ...cards: string[]): LimitedGuideTopic => ({
  title,
  text,
  cards,
});

export const LIMITED_SET_GUIDES: Record<string, LimitedSetGuide> = {
  fdn: {
    name: "Magic: The Gathering Foundations",
    coverage:
      "All ten color-pair themes, returning mechanics and selected combat interactions. Themes describe the set's design, not pick rankings.",
    archetypes: [
      topic(
        "White-blue · Flying",
        "Build an evasive creature board. Empyrean Eagle rewards fliers, including small creatures such as Healer's Hawk.",
        "Empyrean Eagle",
        "Healer's Hawk",
      ),
      topic(
        "Blue-black · Graveyard",
        "Drawing and discarding stocks the graveyard for threshold and creature recursion.",
        "Dreadwing Scavenger",
        "Soul-Shackled Zombie",
      ),
      topic(
        "Black-red · Raid",
        "Attack to enable raid rewards. Raid checks whether you attacked, not whether an attacker survived or dealt damage.",
        "Perforating Artist",
        "Gorehorn Raider",
      ),
      topic(
        "Red-green · Power",
        "Creatures with power 4 or greater enable the pair's rewards. Large tokens and power boosts also meet that condition.",
        "Ruby, Daring Tracker",
        "Dragon Trainer",
      ),
      topic(
        "Green-white · +1/+1 counters",
        "Grow a creature board with counters. Trample and other useful abilities remain valuable as the creatures get larger.",
        "Good-Fortune Unicorn",
        "Beast-Kin Ranger",
      ),
      topic(
        "White-black · Life gain",
        "Repeated life-gain events enable creature payoffs. A single large life gain and several separate events are not interchangeable.",
        "Fiendish Panda",
        "Dazzling Angel",
      ),
      topic(
        "Blue-red · Spells",
        "Instants and sorceries support spellslinger creatures. Flashback gives another cast from the same card.",
        "Balmor, Battlemage Captain",
        "Inspiration from Beyond",
      ),
      topic(
        "Black-green · Morbid",
        "Creature deaths enable morbid, including opposing creatures killed by removal.",
        "Wardens of the Cycle",
        "Stab",
      ),
      topic(
        "Red-white · Aggro",
        "Create a wide board of small creatures and tokens, then boost the board to finish combat.",
        "Heroic Reinforcements",
        "Cat Collector",
      ),
      topic(
        "Green-blue · Ramp",
        "Extra lands help cast expensive creatures and enable land-entry rewards.",
        "Tatyova, Benthic Druid",
        "Grow from the Ashes",
      ),
    ],
    mechanics: [
      topic(
        "Flashback",
        "Cast the card from your graveyard for its flashback cost. Normal timing restrictions still apply, and paying flashback does not change mana value.",
        "Think Twice",
      ),
      topic(
        "Threshold",
        "Threshold requires seven or more cards in your graveyard. An intervening-if trigger checks that condition when it would trigger and again on resolution.",
        "Crypt Feaster",
      ),
      topic(
        "Prowess and raid",
        "Prowess triggers on noncreature spells, not lands or artifact creatures. Raid remembers attacks made earlier in the turn.",
        "Lightshell Duo",
        "Searslicer Goblin",
      ),
    ],
    interactions: [
      topic(
        "Multiple blockers",
        "Current combat rules have no damage-assignment order. A creature's controller divides its combat damage among opposing creatures during the damage step. Trample still requires lethal damage assigned to blockers before assigning excess to the defender.",
        "Giant Growth",
      ),
      topic(
        "Planeswalker combat",
        "Choose whether each attacker attacks a player or a planeswalker. Damage removes loyalty counters. Kaito's combat-damage trigger requires damage to a player, not a planeswalker.",
        "Kaito, Cunning Infiltrator",
      ),
    ],
    sources: [
      {
        title: "Wizards · Prerelease guide and archetypes",
        url: feature + "foundations-prerelease-guide",
      },
      { title: "Wizards · Mechanics and combat update", url: feature + "foundations-mechanics" },
    ],
  },
  m21: {
    name: "Core Set 2021",
    coverage:
      "Mechanics and selected card-specific rules from Wizards' release notes. This guide does not claim a complete, source-verified color-pair archetype map. Release notes also cover Jumpstart; the entries here concern M21 cards.",
    archetypes: [],
    mechanics: [
      topic(
        "Mill",
        "Milling puts cards from the top of a library into its owner's graveyard. Milling an empty library does not itself cause a loss. Trying to draw from an empty library does.",
        "Teferi's Tutelage",
      ),
      topic(
        "Prowess",
        "Noncreature spells trigger prowess. The trigger resolves before the spell and still resolves if that spell is countered. Playing lands does not trigger it.",
        "Jeskai Elder",
      ),
      topic(
        "Shrines",
        "Shrine is an enchantment subtype. Each Shrine counts itself. Cards with 'shrine' only in their name do not count.",
        "Sanctum of Stone Fangs",
      ),
      topic(
        "Dogs",
        "Older Hounds received Oracle errata to become Dogs, retaining their other creature types. Use current Oracle text for typal interactions.",
        "Pack Leader",
      ),
    ],
    interactions: [
      topic(
        "Archfiend's Vessel",
        "Returning the Vessel from the graveyard can create a Demon. If the Vessel leaves the battlefield before its trigger resolves, you cannot exile it and do not create the token.",
        "Archfiend's Vessel",
      ),
      topic(
        "Barrin's end-step check",
        "Barrin checks the entire turn, including before he entered. Returning a token to your hand counts before it ceases to exist. Several returned permanents still yield only one card.",
        "Barrin, Tolarian Archmage",
      ),
      topic(
        "Counters and death",
        "Basri's Lieutenant can target itself on entry. Its death trigger uses the creature's last battlefield state and triggers once per qualifying creature, not once per counter.",
        "Basri's Lieutenant",
      ),
      topic(
        "Targeted removal",
        "If Angelic Ascension's target becomes illegal, the spell does not resolve and no Angel token is created.",
        "Angelic Ascension",
      ),
      topic(
        "Attacking tokens",
        "Basri Ket's Soldiers enter attacking but were not declared as attackers. They do not trigger 'whenever a creature attacks' abilities.",
        "Basri Ket",
      ),
    ],
    sources: [
      {
        title: "Wizards · Core Set 2021 and Jumpstart release notes",
        url: feature + "core-set-2021-and-jumpstart-release-notes-2020-06-20",
      },
    ],
  },
  blb: {
    name: "Bloomburrow",
    coverage:
      "All ten animalfolk color-pair themes and all five main set mechanics, with selected timing notes. Creature types overlap across pairs; a shared type is not proof that a card fits the same plan.",
    archetypes: [
      topic(
        "White-blue · Birds",
        "Flying Birds support grounded creatures, including small offspring tokens.",
        "Knightfisher",
        "Pileated Provisioner",
      ),
      topic(
        "Blue-black · Rats",
        "Fill the graveyard and stall until threshold turns on at seven cards.",
        "Shoreline Looter",
        "Thornplate Intimidator",
      ),
      topic(
        "Black-red · Lizards",
        "Attack and use life-loss effects to enable aggressive Lizard rewards.",
        "Ravine Raider",
        "Flamecache Gecko",
      ),
      topic(
        "Red-green · Raccoons",
        "Spend mana casting spells in large turns to enable expend and deploy larger creatures.",
        "Brazen Collector",
        "Rust-Shield Rampager",
      ),
      topic(
        "Green-white · Rabbits",
        "Offspring and creature tokens build a wide board for creature-count rewards.",
        "Warren Elder",
        "Burrowguard Mentor",
      ),
      topic(
        "White-black · Bats",
        "Flying creatures and gaining or losing life support Bat payoffs.",
        "Wax-Wane Witness",
        "Starlit Soothsayer",
      ),
      topic(
        "Blue-red · Otters",
        "Instants and sorceries enable prowess and other spellslinger rewards.",
        "Daring Waverider",
        "Harnesser of Storms",
      ),
      topic(
        "Black-green · Squirrels",
        "Food and graveyard cards pay forage costs. Self-mill from the Rat colors can support this plan.",
        "Daggerfang Duo",
        "Treetop Sentries",
      ),
      topic(
        "Red-white · Mice",
        "Target your creatures with Equipment abilities or tricks to enable valiant.",
        "Heartfire Hero",
        "Flowerfoot Swordmaster",
      ),
      topic(
        "Green-blue · Frogs",
        "Return or blink creatures to repeat their enters abilities.",
        "Long River Lurker",
        "Sunshower Druid",
      ),
    ],
    mechanics: [
      topic(
        "Offspring",
        "Pay an optional additional cost while casting. On entry, create a 1/1 copy with the original's name, types, mana cost and abilities. The token still arrives if the parent leaves before the trigger resolves.",
        "Tender Wildguide",
      ),
      topic(
        "Gift",
        "Promise a gift when casting. For instants and sorceries, the gift happens first during resolution. Targets are already chosen, so a gifted Fish cannot be a target of that spell.",
        "Parting Gust",
        "Kitnap",
      ),
      topic(
        "Forage",
        "Exile three graveyard cards or sacrifice one Food to pay a forage cost. The same Food cannot also pay its own life-gain activation.",
        "Osteomancer Adept",
      ),
      topic(
        "Valiant",
        "Triggers the first time each turn the creature becomes a target of a spell or ability you control. This can happen on an opponent's turn too.",
        "Seedglaive Mentor",
      ),
      topic(
        "Expend",
        "Count mana spent casting spells, including additional costs. Expend 4 watches the fourth mana that turn, not every fourth mana. Mana spent activating abilities does not count.",
        "Junkblade Bruiser",
      ),
    ],
    interactions: [
      topic(
        "Expend timing",
        "A creature must already be on the battlefield to see the relevant mana spent. Junkblade Bruiser cannot trigger from the mana spent casting itself.",
        "Junkblade Bruiser",
      ),
      topic(
        "Season modes",
        "Pawprints are a mode-selection budget for that spell, not a saved resource. Modes may be repeated within the printed five-pawprint limit.",
        "Season of Weaving",
      ),
    ],
    sources: [
      {
        title: "Wizards · Prerelease guide and archetypes",
        url: feature + "bloomburrow-prerelease-guide",
      },
      { title: "Wizards · Mechanics", url: feature + "bloomburrow-mechanics" },
    ],
  },
  dsk: {
    name: "Duskmourn: House of Horror",
    coverage:
      "All ten color-pair themes, Rooms, manifest dread, survival, eerie and impending. Graveyard and enchantment themes often overlap.",
    archetypes: [
      topic(
        "White-blue · Eerie tempo",
        "Repeated enchantment entries and fully unlocked Rooms build a creature board.",
        "Gremlin Tamer",
        "Inquisitive Glimmer",
      ),
      topic(
        "Blue-black · Eerie control",
        "Use Rooms and enchantment rewards in a slower game with creature interaction.",
        "Skullsnap Nuisance",
        "Fear of Infinity",
      ),
      topic(
        "Black-red · Sacrifice",
        "Use enchantments and Rooms, then sacrifice permanents for additional value and graveyard fuel.",
        "Sawblade Skinripper",
        "Disturbing Mirth",
      ),
      topic(
        "Red-green · Delirium stompy",
        "Aggressive creatures and multiple card types in the graveyard enable delirium.",
        "Wildfire Wickerfolk",
        "Beastie Beatdown",
      ),
      topic(
        "Green-white · Survival",
        "Have survival creatures tapped at the beginning of the second main phase. Attacking is only one way to tap them.",
        "Shrewd Storyteller",
        "Baseball Bat",
      ),
      topic(
        "White-black · Reanimator",
        "Discard or mill large creatures, then return them while removal buys time.",
        "Shroudstomper",
        "Rite of the Moth",
      ),
      topic(
        "Blue-red · Rooms",
        "Multiple Rooms and door-unlocking rewards support a longer enchantment game.",
        "Intruding Soulrager",
        "Smoky Lounge // Misty Salon",
      ),
      topic(
        "Black-green · Delirium grind",
        "Reach four graveyard card types and use graveyard rewards in a midrange plan.",
        "Broodspinner",
        "Drag to the Roots",
      ),
      topic(
        "Red-white · Small-creature aggro",
        "Build a wide board with creatures of power 2 or less for the pair's rewards.",
        "Arabella, Abandoned Doll",
        "Midnight Mayhem",
      ),
      topic(
        "Green-blue · Manifest dread",
        "Manifest cards for face-down-creature rewards, then turn creature cards face up when useful.",
        "Oblivious Bookworm",
        "Growing Dread",
      ),
    ],
    mechanics: [
      topic(
        "Rooms",
        "Cast one door. Unlock the other at sorcery timing by paying its mana cost as a special action. A Room put onto the battlefield without being cast starts with both doors locked.",
        "Dollmaker's Shop // Porcelain Gallery",
      ),
      topic(
        "Manifest dread",
        "Look at two library cards, manifest one as a face-down 2/2 and put the other in your graveyard. A manifested creature card can turn face up by paying its mana cost as a special action.",
        "Unwanted Remake",
      ),
      topic(
        "Survival",
        "The creature must be tapped both when its second-main-phase trigger would trigger and when it resolves.",
        "Veteran Survivor",
      ),
      topic(
        "Eerie",
        "Triggers on your enchantment entering or your Room becoming fully unlocked. One Room can provide an entry trigger and a later fully-unlocked trigger.",
        "Scrabbling Skullcrab",
      ),
      topic(
        "Impending",
        "An Overlord cast for impending enters with time counters and is not a creature while those counters remain. Its entry ability still triggers.",
        "Overlord of the Hauntwoods",
      ),
    ],
    interactions: [
      topic(
        "Room mana value",
        "On the battlefield, count only unlocked doors. In hand, library or graveyard, use the combined mana value of both halves.",
        "Dollmaker's Shop // Porcelain Gallery",
      ),
      topic(
        "Turning face up",
        "Turning a manifested creature face up does not make it enter again. It retains counters, attachments, combat status and spells targeting it, though target legality may change.",
        "Growing Dread",
      ),
      topic(
        "Delirium types",
        "Delirium counts card types, not cards. Artifact creatures and enchantment creatures can each contribute two types.",
        "Broodspinner",
      ),
    ],
    sources: [
      {
        title: "Wizards · Prerelease and draft guide",
        url: feature + "duskmourn-house-of-horror-prerelease-and-draft-guide",
      },
      { title: "Wizards · Mechanics", url: feature + "duskmourn-house-of-horror-mechanics" },
    ],
  },
  tdm: {
    name: "Tarkir: Dragonstorm",
    coverage:
      "The five clan themes and their mechanics, Omens, behold and monocolor hybrid mana. The source also mentions two-color themes; this guide covers clans, not a complete two-color map.",
    archetypes: [
      topic(
        "White-black-green · Abzan endure",
        "Endure and +1/+1-counter rewards strengthen a board. Endure can make a Spirit instead of counters.",
        "Armament Dragon",
        "Stalwart Successor",
      ),
      topic(
        "Blue-red-white · Jeskai flurry",
        "Cast two spells in a turn. Cheap spells and temporary mana help enable the second cast.",
        "Jeskai Brushmaster",
        "Cori Mountain Stalwart",
      ),
      topic(
        "Black-green-blue · Sultai renew",
        "Stock the graveyard, then use renew and rewards for cards leaving it.",
        "Kheru Goldkeeper",
        "Kishla Skimmer",
      ),
      topic(
        "Red-white-black · Mardu mobilize",
        "Attack for temporary Warriors and use sacrifice outlets before their scheduled end-step sacrifice.",
        "Bone-Cairn Butcher",
        "Hardened Tactician",
      ),
      topic(
        "Green-blue-red · Temur harmonize",
        "High-power creatures reduce generic harmonize costs. Recasting spells also supports flurry and graveyard-exit rewards.",
        "Mammoth Bellow",
        "Glacial Dragonhunt",
      ),
    ],
    mechanics: [
      topic(
        "Endure",
        "Choose counters on the enduring creature or an N/N white Spirit. If the creature is gone when the ability resolves, create the Spirit.",
        "Dusyut Earthcarver",
      ),
      topic(
        "Flurry",
        "Triggers on your second spell each turn, once that turn. The flurry permanent must see the second cast, but need not see the first.",
        "Devoted Duelist",
      ),
      topic(
        "Renew",
        "Activate from the graveyard at sorcery timing. Exiling the renew card is part of the cost, not the resolving effect.",
        "Agent of Kotis",
      ),
      topic(
        "Mobilize",
        "Create tapped, attacking Warriors on attack and sacrifice them at the next end step. They were not declared attackers and do not trigger attack abilities.",
        "Dragonback Lancer",
      ),
      topic(
        "Harmonize",
        "Cast from the graveyard for the harmonize cost. You may tap a creature as an additional cost to reduce generic mana by its power; colored requirements remain.",
        "Roamer's Routine",
      ),
      topic(
        "Omens and behold",
        "A resolving Omen shuffles its card into your library; a countered Omen does not. Behold a Dragon by revealing one from hand or choosing one you control.",
        "Dirgur Island Dragon",
        "Caustic Exhale",
      ),
    ],
    interactions: [
      topic(
        "Monocolor hybrid",
        "A twobrid symbol can be paid with one mana of its color or two generic mana. It always contributes 2 to mana value, regardless of what you actually pay.",
        "Gurmag Nightwatch",
      ),
      topic(
        "Omen characteristics",
        "Outside the stack as an Omen, the card has only its creature characteristics. It is not an instant card in your graveyard for effects that look for instants.",
        "Dirgur Island Dragon",
      ),
      topic(
        "Clan mana",
        "The set includes common two-color lands, clan three-color lands and mana rocks. A three-color theme is not a reason to assume your pool has the fixing to cast it.",
        "Sandsteppe Citadel",
        "Mystic Monastery",
        "Opulent Palace",
        "Nomad Outpost",
        "Frontier Bivouac",
      ),
    ],
    sources: [
      {
        title: "Wizards · Prerelease guide and clan themes",
        url: feature + "tarkir-dragonstorm-prerelease-guide",
      },
      { title: "Wizards · Mechanics", url: feature + "tarkir-dragonstorm-mechanics" },
    ],
  },
};

export const LIMITED_RULES_URL = "https://magic.wizards.com/en/rules";
export const LIMITED_GATHERER_URL = "https://gatherer.wizards.com/";
