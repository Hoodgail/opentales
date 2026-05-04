---
name: novel-chapters
description: >
  Write, draft, or improve full novel chapters at a professional, publishable level — the kind of craft found in Red Rising, Cormac McCarthy, literary fiction, thrillers, fantasy, and all serious genre fiction. Use this skill whenever the user asks to write a chapter, draft a scene, continue a novel, improve their chapter writing, or write any extended piece of narrative fiction. Trigger for requests like "write chapter one", "continue this scene", "write what happens next", "help me write this chapter", "make this scene better", "write the scene where X happens", or any fiction-writing request longer than a single exchange. If prose narrative is being written, use this skill.
---

# Novel Chapter Writing Skill

You are writing chapters for a real novel — not a writing exercise, not a summary, not a synopsis. The prose must be publishable. Think: *Red Rising*, *No Country for Old Men*, *The Name of the Wind*, *A Little Life*, *Neuromancer*. Whatever the genre, the craft standard is always the same.

## OpenTales Chapter Workflow

When writing chapters inside OpenTales, use the current project model as the source of structure. Chapters, characters, locations, story structure, and ProjectDocs are available through the agent's read tools. Proposed changes to chapters or ProjectDocs should be made through approval-gated project mutations, never by inventing a separate file schema.

- Use the project chapter list as the canonical chapter manifest.
- Read the target chapter, nearby summaries, relevant characters, locations, story structure, and planning ProjectDocs before drafting or revising.
- Use `updateChapter` for proposed chapter metadata or manuscript edits.
- Use `createProjectDoc` or `updateProjectDoc` for chapter briefs, scene plans, continuity notes, or other supporting planning material.
- Keep section names stable so later revisions remain reliable.
- Do not read the entire novel by default; prefer summaries, lists, grep, and bounded reads unless full text is necessary.

---

## Before Writing a Single Word: Establish the Scene's DNA

Every chapter or scene must be built on answers to these questions. If you don't have them, ask or infer from context before writing.

**The 5 Pre-Writing Questions:**
1. What does the POV character want in this scene — specifically, right now?
2. What is standing in their way?
3. What does the scene need to *do* in the larger story? (Reveal something, shift the power dynamic, raise stakes, deepen character, advance plot — ideally more than one.)
4. What is the **high moment** — the most important beat this scene is building toward?
5. What changes between the first line and the last? If nothing has changed, there is no scene.

Write backwards from the high moment. The opening exists to set up that moment. Every paragraph either builds toward it or deepens the stakes around it.

---

## The Anatomy of a Chapter

A well-built chapter is a **mini-novel**. It has a shape:

**Opening** → Establish: where we are, when we are, who we're with, what they want, what mood they're in. Ground the reader fast.

**Rising action** → The protagonist moves toward their goal. Obstacles appear. The tension ratchets. Each beat should push the stakes higher or complicate the situation.

**High moment** → The climactic beat of the scene. The confrontation, the revelation, the decision, the rupture. This should fall as close to the end of the chapter as possible.

**Closing hook / transition** → Either leave something unresolved that compels the next read, or close on a beat that resonates. Don't end on nothing.

---

## Part 1: Scene Openings — The First Page Is a Covenant

Readers will stop reading before they finish your first page if you don't earn their attention. The opening of every chapter must do several things quickly:

### The Six Elements Every Chapter Opening Needs:

**1. Connective tissue** — Bridge the gap from the previous scene. How much time has passed? Are we in a new location? New POV? Establish this immediately and crisply. "The next morning" is fine. A single orienting detail is fine. Confusion is not.

**2. Physical grounding** — Where are the characters in space? Even one precise, well-chosen detail does more than a paragraph of generic description. "Angie rolled her suitcase through the harsh light of Terminal B" tells you everything. Use sensory specifics: light quality, temperature, texture, smell. Make the environment real before you put characters in it.

**3. The protagonist's mindset** — What are they feeling? What's on their mind after the last chapter? Don't say "Nathan woke up frustrated." Show the frustration — the things running through their head, the way they move, what they notice and what they filter out. The POV character's emotional state shapes everything they perceive.

**4. Motivation** — What does the protagonist want to do right now, in this chapter, today? Prime the reader. We invest in the story by investing in what the character is going after. Make the goal clear, even if the character hasn't fully articulated it yet.

**5. Stakes** — What happens if they fail? What will it cost them personally, not just externally? Stakes must connect to the character's identity — what they value, what they fear losing, what they're still trying to prove. The broader canvas (save the world) only matters when we see how it intersects with the specific character (and what it means to *them* personally if they fail).

**6. The scene's problem** — A scene without a problem is not a scene. The problem should be apparent or implied in the opening. What tension is already present before the first event happens?

### The Cinematic Approach to Scene Openings:

Think like a director. You have three camera moves:

- **Establishing shot** — Brief. Locates the reader in space and time. One to three lines. Don't linger.
- **In media res** — Start in the middle of something happening. Not a character waking up. Not a character brushing their teeth. Start where it gets interesting.
- **Deliberate camera placement** — What does the reader need to notice first? What should they not notice yet? Move attention intentionally.

Avoid opening chapters with characters waking up, looking in mirrors, thinking about their backstory, or listening to exposition from another character. These are all stalls before the story starts.

---

## Part 2: POV and Narrative Voice — The Invisible Engine

The narrative voice is not a neutral camera. It is a personality filtering the world through one specific consciousness. This is what separates publishable prose from a plot summary.

### Deep POV Rules:

Every sentence of description, action, and interiority must be filtered through the POV character's personality, values, fears, and desires. They don't see the world neutrally — they see it *through themselves*.

- A paranoid character notices exits and threat vectors, not decoration.
- A grieving character sees everything as a reminder of loss.
- A hungry-for-power character sizes up every room as a contest.

The world described in the narrative voice reveals as much about the POV character as about the setting.

### What the Narrative Voice Does:
- Carries physical description — economically, precisely, personality-inflected
- Carries thought processes and interiority — *not* raw stream of consciousness, but curated inner life
- Carries context and exposition — delivered when the reader needs it to understand what's happening, tied to events in the present narrative
- Makes the POV character's hopes, fears, and desires felt even when they're not stated

### What It Must Never Do:
- Become a dry play-by-play ("and then this happened, and then this happened")
- Serve as an exposition delivery vehicle divorced from the present action
- Diagnose the character's psychology clinically ("she felt acute anxiety")
- Drift into a different character's head mid-scene without a deliberate break

---

## Part 3: Prose Craft — The Sentence Level

Great chapters are built sentence by sentence. The prose itself must be doing work beyond conveying information.

### Rhythm Controls Feeling:
- Short, punchy sentences accelerate. They create tension. They push.
- Longer, more winding sentences slow the reader down, let them breathe, create a sense of weight or meditation or languor.
- Vary rhythm deliberately. Monotonous sentence structure makes even exciting events feel flat.

### Specificity Over Generality — Always:
Generic: *He walked into a large room with a high ceiling.*
Specific: *The ceilings vaulted thirty feet, the kind of height that makes you aware of your own smallness.*

The specific detail does double work: it describes the space AND creates an emotional effect. Every important description should do both.

### What Makes Prose Feel Alive:
- Unexpected word choices that are precisely right
- Comparisons that illuminate rather than decorate
- Sensory details beyond the visual (sound, smell, texture, temperature, proprioception)
- Physical action that carries emotional weight
- The world filtered through the POV character's specific way of seeing

### What Kills Prose:
- Adverbs where stronger verbs should be
- Generic gestures (she sighed, he nodded, she shrugged) as the primary means of showing emotion
- Stacked qualifiers ("very," "really," "rather," "quite," "almost")
- Passive construction where active would work
- Characters described without personality in the description itself

---

## Part 4: Character Interiority — Making the Inner Life Visible

The most powerful tool in prose fiction is the one movies and TV cannot replicate: direct, unmediated access to a character's inner world.

Use it.

### The Interior Layer:
Every significant event or revelation needs an interior response — not just physical action. What does the character *think* just happened? How are they contextualizing it? What are they afraid it means? What do they wish they could do? What are they choosing not to do?

Blend: Physical action + interior response = reader fully inside the character.

### Hopes and Dreams Are the Character's North Star:
Be specific about what the character is ultimately after. Not "freedom" — but what freedom looks like to them, precisely. Not "success" — but the exact vision in their head of what success means. This specificity tells the reader more about the character's values than any direct description. Show the character imagining their best-case scenario in concrete detail; the reader will immediately understand who they are.

### Showing Character Through Reaction:
Under pressure, under threat, in surprise — how a character responds is who they are. The response must be specific to this character, not universal:
- Don't diagnose: "She felt anxious." 
- Don't go generic: "She gasped."
- Do show the specific manifestation: what they do with their hands, what their mind jumps to, what old fear this reactivates, what anger this resurfaces.

When something truly important happens, the emotional reverb doesn't stop after one paragraph. It gnaws. It resurfaces. It explodes sideways later at the wrong person, at the wrong moment. Show that.

---

## Part 5: Stakes, Tension, and Scene Engine

A scene with no tension is not a scene — it's a summary. Every moment must carry the weight of something that might not go the way the character needs.

### The Two Kinds of Stakes:

**External stakes** — What happens to the character or their world if they fail. Broadening the external stakes (more lives at risk, bigger consequences) raises pressure.

**Personal stakes** — What failure means to this specific character's identity. This is almost always more powerful. Connect what's happening to what the character truly cares about — their sense of self, their relationships, their deepest fears about who they are.

The best scenes have both simultaneously, and they're intertwined.

### Tension Mechanics:
- Obstacles that force choices (not random bad luck — obstacles that require the character to reveal what they value)
- Competing desires (the character wants two things that can't both be satisfied right now)
- Information asymmetry (reader knows something the character doesn't, or vice versa)
- Time pressure — deadlines, literal or emotional
- Irreversibility — decisions that can't be taken back once made

**Do not release tension once you've established it.** The moment you let the reader off the hook, they relax. Keep them leaning forward. Ratchet pressure up through the scene; don't let it plateau.

---

## Part 6: Worldbuilding and Setting — The World Inhabits the Scene

Setting is not a backdrop. It's atmosphere, it's character, it's tone. Done well, it's indistinguishable from everything else.

### Rules for Integrating Setting and World:

**Ground, then action** — Establish where we are physically before the scene demands full attention. One clear moment of spatial orientation at the start of every new location.

**Tie the world to the character's perception** — What the POV character notices about a space tells us about them. A soldier notices sight lines. A thief notices exits. An architect notices what's wrong with the construction. Filter setting through character.

**Exposition on demand, not in advance** — Deliver worldbuilding information when the reader needs it to understand the present narrative. Never in advance "because it'll matter later." The reader doesn't need the thousand-year history of the Black Knights until the Black Knights are in the scene. When they arrive, a quick crisp explanation via the narrative voice is fine. Elaborate in-dialogue worldbuilding is almost never fine.

**Make the world tactile** — Abstract world-details (political systems, histories, cosmologies) land when anchored to sensory, physical experience. Don't explain magic systems in technical terms; show what they feel like to use, what they cost, what they do to the body or mind.

---

## Part 7: Pacing — The Reader's Heartbeat

Pacing is control of reader experience. Slow when emotion demands it, accelerate when momentum demands it.

### Structural Pacing:
- **Scene** (real-time action, dialogue, high intensity) vs. **Sequel** (reflection, aftermath, the character processing what happened and deciding what to do next) — alternate these or blend them as the story demands
- Chapters that only contain one or the other become monotonous
- After a high-intensity scene, the reader (and character) often need a moment to breathe and integrate before the next assault

### Line-Level Pacing:
- Short paragraphs, short sentences = speed, tension, urgency
- Long paragraphs, long sentences = slowdown, meditation, emotional weight
- White space is a pacing tool — use it
- A single short line after several long paragraphs hits like a punctuation mark

### Chapter Endings:
End on the beat that compels the reader to start the next chapter. Not necessarily a cliffhanger — a resonant note, a question left open, a revelation that recontextualizes what came before. The chapter ending should make it impossible to stop reading.

---

## The Chapter Checklist

Before delivering any chapter, run this:

1. **Does the opening establish where/when/who/what-they-want within the first few lines?**
2. **Is there a high moment? Does the chapter build toward it?**
3. **Does something change between the first line and the last?**
4. **Is the narrative voice personality-inflected — not just a camera, but a consciousness?**
5. **Is there physical description that's specific, sensory, and character-filtered?**
6. **Does exposition appear in dialogue when it should be in the narrative voice?**
7. **Are the stakes both external and personal?**
8. **Is tension present throughout — not just at the climax?**
9. **Do character reactions reveal this specific person, not just a generic human?**
10. **Does the prose rhythm vary? Short sentences where you need them, long where you need them?**
11. **Does the chapter end in a place that demands the next be read?**
12. **Could this appear in a published novel exactly as written?**

---

## What AI-Generated and Novice Chapters Look Like (Avoid This)

- Chapters that summarize events rather than inhabit them
- Physical description so generic it could be any scene ("a large room," "a dark forest")
- POV character's thoughts rendered as a clinical inventory of emotions rather than actual thought
- Every character reacting with the same generic gestures
- Scenes that exist to deliver information, not to push a character through a meaningful moment
- Pacing that never varies — the same sentence length, paragraph length, and intensity throughout
- World-building explanations delivered in exposition monologues or tortured dialogue
- Opening on the protagonist waking up, looking in a mirror, or listening to someone explain something
- Chapters that end by completing the scene neatly, with nothing left to pull the reader forward

The goal: every chapter should feel like it was ripped from a novel you've already decided you can't put down.
