import type { Character, Location, Chapter, Act, StoryStructure } from "./manuscript-types"

export const initialCharacters: Character[] = [
  {
    id: "char-elena",
    name: "Elena Voss",
    role: "Protagonist",
    age: "32",
    occupation: "Archivist",
    avatar: "/characters/elena.jpg",
    description:
      "A meticulous archivist who returns to her family's ancestral home after the death of her estranged grandmother. Elena's quiet competence hides a fierce loyalty and a temper she works hard to control.",
    appearance:
      "Average height, dark hair always pulled back, sharp gray eyes that miss nothing. Prefers practical clothing in dark tones. A small ink stain permanently on her right index finger.",
    motivation:
      "To uncover the truth about her grandmother's death and protect what remains of her family's legacy from those who would exploit it.",
    arc: "Begins skeptical and emotionally guarded; learns to trust others and accept that some truths are worth more than safety.",
    traits: ["Observant", "Stubborn", "Loyal", "Reserved", "Pragmatic"],
    relationships: [
      { id: "rel-mock-char-marcus", characterId: "char-marcus", type: "Mentor", note: "Family friend who knew her grandmother" },
      { id: "rel-mock-char-iris", characterId: "char-iris", type: "Ally", note: "Local librarian who becomes her confidante" },
      { id: "rel-mock-char-silas", characterId: "char-silas", type: "Antagonist", note: "Rival claimant to the estate" },
    ],
  },
  {
    id: "char-marcus",
    name: "Marcus Hale",
    role: "Mentor",
    age: "58",
    occupation: "Retired Judge",
    avatar: "/characters/marcus.jpg",
    description:
      "Elena's late grandmother's oldest friend and executor of her estate. A man of careful words and carefully kept secrets.",
    appearance:
      "Tall, gray-bearded, carries himself with the deliberate weight of someone who has spent decades watching people lie under oath.",
    motivation: "To honor a promise made to his oldest friend, even if it costs him everything.",
    arc: "His unwavering moral compass is tested when honoring the promise requires breaking the law.",
    traits: ["Principled", "Patient", "Guarded", "Wise"],
    relationships: [
      { id: "rel-mock-char-elena", characterId: "char-elena", type: "Mentee", note: "Sees her grandmother in her" },
      { id: "rel-mock-char-silas", characterId: "char-silas", type: "Adversary", note: "Decades-old grudge" },
    ],
  },
  {
    id: "char-iris",
    name: "Iris Thorne",
    role: "Ally",
    age: "27",
    occupation: "Librarian",
    avatar: "/characters/iris.jpg",
    description:
      "The town's young librarian, who knows every book in Oldgate and most of the secrets between their pages.",
    appearance: "Auburn hair, freckles across the bridge of her nose, always a book within reach.",
    motivation: "To prove she belongs in a town that has never quite accepted her.",
    arc: "Moves from cautious observer to active participant, finding her own courage in the process.",
    traits: ["Curious", "Witty", "Resourceful", "Empathetic"],
    relationships: [{ id: "rel-mock-char-elena", characterId: "char-elena", type: "Friend", note: "Sees a kindred spirit" }],
  },
  {
    id: "char-silas",
    name: "Silas Crane",
    role: "Antagonist",
    age: "54",
    occupation: "Real Estate Developer",
    avatar: "/characters/silas.jpg",
    description:
      "A polished man with a long memory and longer reach. He believes the Voss estate is rightfully his and has spent twenty years preparing to take it.",
    appearance: "Tall, gaunt, immaculately dressed. Speaks softly. Smiles only when negotiating.",
    motivation: "To reclaim what he believes was stolen from his family three generations ago.",
    arc: "His belief in his own righteousness blinds him to the cost of victory.",
    traits: ["Calculating", "Charming", "Vindictive", "Patient"],
    relationships: [
      { id: "rel-mock-char-elena", characterId: "char-elena", type: "Adversary", note: "Underestimates her at first" },
      { id: "rel-mock-char-marcus", characterId: "char-marcus", type: "Enemy", note: "Old wound, never healed" },
    ],
  },
]

export const initialLocations: Location[] = [
  {
    id: "loc-blackwood",
    name: "Blackwood Manor",
    type: "Primary Residence",
    image: "/locations/blackwood-manor.jpg",
    description:
      "The Voss family's ancestral home, perched on a windswept rise above the town of Oldgate. Built in 1847, it has been added to and altered by every generation, leaving a labyrinth of mismatched wings and hidden rooms.",
    atmosphere:
      "Heavy. Watchful. The kind of house that seems to be holding its breath. Every floorboard has an opinion.",
    significance:
      "The center of the inheritance dispute. Contains the family archive, the locked study, and the secret Elena's grandmother died protecting.",
    sensoryDetails:
      "Smell of old paper, lavender oil, and woodsmoke. The constant low groan of timbers settling. Light is always slightly too dim, as if the house refuses to be fully seen.",
  },
  {
    id: "loc-docks",
    name: "Oldgate Harbor",
    type: "Town District",
    image: "/locations/harbor-docks.jpg",
    description:
      "The working heart of Oldgate. Fishing boats, freight, and the kind of business that prefers to happen between lampposts.",
    atmosphere: "Restless. Salt-bitten. A place where everyone is either arriving or leaving and no one stays long.",
    significance: "Where Silas's holdings are concentrated. The site of the second-act confrontation.",
    sensoryDetails: "Brine, diesel, wet rope. Gulls. The slap of water against pilings. Fog that swallows sound.",
  },
  {
    id: "loc-library",
    name: "Oldgate Public Library",
    type: "Public Building",
    image: "/locations/oldgate-library.jpg",
    description:
      "A neoclassical building older than the town itself. Three stories of stacks, a rare-books reading room, and a basement archive that hasn't been catalogued since 1962.",
    atmosphere: "Reverent. Hushed. The kind of quiet that has weight.",
    significance: "Where Elena and Iris meet. The first clue to the cipher is hidden here.",
    sensoryDetails: "Dust. Beeswax polish on oak tables. The whisper of pages and the tick of an unseen clock.",
  },
]

export const initialChapters: Chapter[] = [
  {
    id: "ch-prologue",
    number: 0,
    title: "Prologue: The Letter",
    status: "final",
    povCharacterId: "char-elena",
    locationId: "loc-blackwood",
    summary: "Elena receives news of her grandmother's death and a letter she was never meant to read.",
    publishedAt: null,
    wordCount: 1840,
    content: `# Prologue: The Letter

The letter arrived on a Tuesday, which Elena would later think was unfair. Tuesdays were for laundry and overdue emails, not for the dead.

She read it twice in the doorway of her apartment, the rain still falling off her coat onto the floorboards. The handwriting was her grandmother's — that much she recognized — but the date was wrong. The date was three years too late.

> *Elena,*
> *If you are reading this, I have failed. Come home. The house knows what to do.*
> *— G*

She stood there a long time, the door still open, the cold November air pulling at the edges of the page. Somewhere in the building, a child was laughing. Somewhere, a kettle was beginning to whistle.

The house knows what to do.

Elena folded the letter once, precisely, along the crease her grandmother had made. She put it in the inside pocket of her coat. Then she closed the door and began, methodically, to pack.

---

The drive to Oldgate took six hours in good weather. It took her nine.

She told herself it was the rain. She told herself it was the traffic out of the city. By the time she crossed the old iron bridge into the town she had been telling herself things for so long that she had almost stopped listening.

Blackwood Manor rose out of the dusk like something half-remembered from a dream — the kind of dream you wake from already forgetting, the kind that leaves only an ache behind the eyes.

The lights were on.

That was the first thing that was wrong.`,
  },
  {
    id: "ch-1",
    number: 1,
    title: "The House That Waited",
    status: "in-progress",
    povCharacterId: "char-elena",
    locationId: "loc-blackwood",
    summary: "Elena arrives at Blackwood Manor and meets Marcus, who has been waiting for her.",
    publishedAt: null,
    wordCount: 3210,
    content: `# Chapter 1: The House That Waited

The key her grandmother had sent — heavy iron, longer than her hand — turned in the lock with a sound like a small bone breaking.

The door opened on its own weight. Elena stepped inside.

The foyer smelled exactly as she remembered: lavender oil, old paper, the faintest edge of woodsmoke from a fire that had been out for years. The chandelier was lit. Someone had lit the chandelier.

"You took your time."

The voice came from the library doorway. A man, tall, gray-bearded, holding a glass of something amber. Marcus Hale. She hadn't seen him since she was twelve.

"I drove the speed limit," Elena said.

"That," said Marcus, "explains it." He stepped aside, gestured her in. "Come. There's a fire. And there are things you need to know before morning."

Elena did not move.

"Why are the lights on?"

Marcus considered her over the rim of his glass. He had her grandmother's eyes — not in shape, but in the way they refused to look away.

"Because," he said, "the house has been waiting for you. And the house," he added, more quietly, "is not the only one."

---

[continue scene — Marcus explains the inheritance, hints at Silas without naming him, Elena notices the locked study door for the first time]`,
  },
  {
    id: "ch-2",
    number: 2,
    title: "Cipher in the Stacks",
    status: "draft",
    povCharacterId: "char-elena",
    locationId: "loc-library",
    summary:
      "Elena visits the library to research her grandmother's last weeks and meets Iris, who recognizes the family seal.",
    publishedAt: null,
    wordCount: 1120,
    content: `# Chapter 2: Cipher in the Stacks

[draft — opening at the library steps in early morning]

The librarian was already waiting at the door when Elena arrived, ten minutes before opening. A woman in her late twenties with auburn hair and an expression that suggested she had been expecting someone, though not necessarily her.

"You're the Voss girl," the librarian said. It was not a question.

"Elena."

"Iris." She unlocked the door with a key on a long chain. "Your grandmother had a card here. She came every Thursday for forty-one years. The last time she came, she left something for you."

Elena followed her in.`,
  },
  {
    id: "ch-3",
    number: 3,
    title: "Crane at the Door",
    status: "review",
    povCharacterId: "char-elena",
    locationId: "loc-blackwood",
    summary: "Silas Crane arrives at Blackwood with an offer, a threat, and a name Elena has not heard since childhood.",
    publishedAt: null,
    wordCount: 2640,
    content: `# Chapter 3: Crane at the Door

He came in the afternoon, when the light was thin and forgiving.

Silas Crane did not knock. He rang the bell — once, politely — and then he stood on the porch with his hands clasped behind his back like a man who had been told to wait and was choosing, for now, to oblige.

Elena watched him through the side window for a full minute before she opened the door.

"Miss Voss." His smile was small and exact. "I wonder if I might have a moment of your time."

"You have until the kettle boils," Elena said.

His smile deepened. "Then I shall be brief."`,
  },
  {
    id: "ch-4",
    number: 4,
    title: "The Locked Study",
    status: "draft",
    povCharacterId: "char-elena",
    locationId: "loc-blackwood",
    summary: "Elena finally opens the door her grandmother kept locked, and finds the first piece of the puzzle.",
    publishedAt: null,
    wordCount: 0,
    content: `# Chapter 4: The Locked Study

[outline only]

- Elena returns to the manor after Crane's visit, shaken
- Marcus is gone; a note says he will return at dusk
- She climbs to the second floor, stands outside the study door
- The key from the prologue's letter fits
- Inside: a desk, a wall of correspondence, and a map with three pins
- One of the pins is on the harbor. One is on the library. One is on a place she does not recognize.
- End of chapter on the third pin.`,
  },
  {
    id: "ch-5",
    number: 5,
    title: "Things Marcus Knew",
    status: "draft",
    povCharacterId: "char-marcus",
    locationId: "loc-blackwood",
    summary: "A POV shift to Marcus, twenty years earlier, and the promise that started everything.",
    publishedAt: null,
    wordCount: 0,
    content: `# Chapter 5: Things Marcus Knew

[POV shift — Marcus, twenty years earlier]

[opening at her grandmother's kitchen table, two glasses of whiskey, the storm outside]`,
  },
]

export const initialActs: Act[] = [
  { id: "act-1", title: "Act I — Inheritance", chapterIds: ["ch-prologue", "ch-1", "ch-2", "ch-3"] },
  { id: "act-2", title: "Act II — The Cipher", chapterIds: ["ch-4", "ch-5"] },
  { id: "act-3", title: "Act III — Reckoning", chapterIds: [] },
]

export const initialStructure: StoryStructure = {
  title: "The Blackwood Cipher",
  genre: "Literary Mystery",
  perspective: "Third-person limited",
  pov: "Primary: Elena Voss. Secondary: Marcus Hale (chapters 5, 11, 17).",
  voice: "Restrained, observational, lightly ironic. Sentences run long when Elena is thinking, short when she is acting. Occasional present-tense intrusions for memory.",
  tone: "Atmospheric, melancholic, with sudden flashes of dry humor.",
  themes: ["Inheritance", "Buried truth", "The cost of loyalty", "What we owe the dead"],
  logline:
    "When a meticulous archivist returns to her family's ancestral home to settle her grandmother's estate, she discovers a decades-old cipher and the man who has spent his life waiting to break it.",
  outline: `## Three-Act Structure

### Act I — Inheritance (Chapters 1–7)
Elena returns to Oldgate and Blackwood Manor. Meets Marcus, Iris, and Silas Crane. Discovers the locked study and the first piece of the cipher. Inciting incident: the grandmother's letter. First plot point: the study is opened.

### Act II — The Cipher (Chapters 8–18)
Elena and Iris work to decode the cipher while Crane closes in. A second POV (Marcus, twenty years earlier) reveals the original promise. Midpoint: Elena learns her grandmother's death was not natural. Second plot point: Crane forces her hand at the harbor.

### Act III — Reckoning (Chapters 19–24)
The cipher leads to the third location. Elena chooses between the safe answer and the true one. Climax at Blackwood. Resolution: the house, finally, can stop waiting.`,
  climax: `The final confrontation takes place in the locked study at Blackwood, during a storm.

Elena has the last piece of the cipher. Crane has Marcus. The choice she must make is not between the two men but between two versions of the truth — the public one, which destroys Crane and exonerates her grandmother, and the private one, which destroys her grandmother's memory and lets Crane walk away.

She chooses the private truth.

The reader learns, only in the final pages, why.`,
  obstacles: [
    {
      id: "obs-1",
      title: "Silas Crane's legal claim",
      type: "external",
      description:
        "Crane has spent twenty years building a case that the Voss estate was acquired fraudulently. His paperwork is, technically, correct.",
      resolution: "Resolved in Act III when Elena chooses to release a single document that voids his claim — at a cost.",
    },
    {
      id: "obs-2",
      title: "Elena's distrust of Marcus",
      type: "interpersonal",
      description: "Elena cannot tell whether Marcus is protecting her or her grandmother's reputation.",
      resolution: "Resolved at the midpoint when Marcus tells her the truth, and she has to decide what to do with it.",
    },
    {
      id: "obs-3",
      title: "Elena's own inheritance",
      type: "internal",
      description:
        "Elena has spent her adult life refusing to be a Voss. The story asks whether she can claim the name without becoming the thing she fled.",
      resolution: "Ongoing. Resolves only in the final scene.",
    },
    {
      id: "obs-4",
      title: "The cipher itself",
      type: "external",
      description: "A book cipher keyed to a volume that no longer exists in any public collection.",
      resolution: "Iris finds the key in the library's uncatalogued basement archive in Chapter 12.",
    },
  ],
}
