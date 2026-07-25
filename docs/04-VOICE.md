# 04 — Voice

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

Copy rules for every word on the site.

---

## The two readers

A **studio or production house** scanning for craft. They want to watch something in ten seconds
and know whether you can hold a frame, cut a scene, and tell a story.

A **client** deciding whether to hire. They want to know what you make, what it costs them in time,
and how to reach you.

Neither of them cares which model rendered the frames.

---

## Rules

**1. The films come first. AI is how they were made, not what they are.**

The single most important rule. It is not modesty — it is positioning. "AI filmmaker" invites the
reader to judge the tool. "Filmmaker" invites them to judge the film. The work is stronger under
the second frame, and the first one dates badly.

No tool logos. No "made with AI" badges. No model names in titles, loglines or headings. If the
process genuinely matters to a piece, it belongs on Process, described as craft — what problem it
solved, what it cost — not as a spec sheet.

**2. Never invent a fact.**

No made-up titles, credits, clients, festival selections, runtimes or testimonials. If something is
unknown, leave the placeholder. A visible gap is honest; a plausible invention is a lie a client
will eventually check.

**3. Write short. Cut adjectives before nouns.**

A logline is one sentence. A synopsis is two or three. If a sentence survives having its adjectives
removed, it did not need them.

**4. Concrete beats abstract.**

Name the thing. "A woman returns to a demolished house and finds it standing" tells you more than
"an exploration of memory and loss."

**5. No agency voice.**

Ban: *cutting-edge, revolutionary, seamless, elevate, unlock, harness, leverage, journey, passionate
about, we craft compelling stories, push the boundaries, bring your vision to life, next level,
game-changing, state-of-the-art, powered by.*

**6. Say "I", not "we".**

One person. Pretending otherwise is the first thing a client discovers.

**7. Sentence case for headings.** Not Title Case, not ALL CAPS in the content — casing is the
stylesheet's job, so the same string can be restyled without an edit.

**8. Active voice, present tense** for what you do. Past tense for what you made.

---

## Worked examples

> **Before:** Award-winning AI filmmaker leveraging cutting-edge generative technology to craft
> compelling visual narratives that push the boundaries of storytelling.
>
> **After:** I make short films. Some of them are for brands.

Three rules at once: no AI framing, no agency voice, no invented award.

---

> **Before:** *The Long Way Home* — A breathtaking journey through memory, powered by Runway Gen-3
> and Midjourney, this stunning piece explores themes of loss and belonging.
>
> **After:** *The Long Way Home* — A woman returns to a demolished house and finds it standing.

The logline now does the job a logline does. Tools are gone. "Breathtaking" and "stunning" are the
reader's call, not yours.

---

> **Before:** Let's collaborate to bring your vision to life! I'm passionate about partnering with
> forward-thinking brands to create seamless, elevated content experiences.
>
> **After:** Brand films, usually 30 to 90 seconds. Two to four weeks. Email me.

---

> **Before:** Utilising a proprietary AI-driven workflow, I am able to achieve cinematic results at
> a fraction of traditional production timelines.
>
> **After:** Most brand films take two to four weeks, start to delivery.

The claim survives; the self-congratulation and the tool talk do not.

---

## Placeholder style

Placeholders must be obviously placeholder. Never write something that could be mistaken for real
content.

Good: `TODO: one-sentence logline`, `MISSING: poster for the-long-quiet`
Bad: `An evocative tale of love and loss` — that reads as real copy and will ship by accident.

---

## Enforcement

`build.mjs` lints content for the banned list above and for AI-forward framing in titles, loglines
and headings, and warns by JSON path. It is a check, not a hope — but it catches phrases, not tone.
Tone is still on you.
