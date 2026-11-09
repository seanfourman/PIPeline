# The showcase README recipe

The shape and the voice of a README that makes a project look like the serious work it is. Distilled from READMEs
that do this well: a 3D reinforcement-learning tournament and a full-stack stargazing atlas. Follow the structure,
fill it only with what is true of *this* project, and drop any section the project has nothing real for.

## The voice

- **Plain and concrete.** Say what it does, then how. "Drop a pin anywhere and it tells you how dark the sky is
  there" beats "a powerful, intuitive platform for astronomy enthusiasts".
- **Numbers, never adjectives.** "~3 GB GeoTIFF", "13 algorithms", "won 98.3% against a converged opponent where the
  default won 1.8%", "681 commits". Every number must come from the code, the data, the git history or a measurement
  in the repository. Never invent one, never round a claim up.
- **Bold the term a reader scans for**, once, where it is introduced: **SQM**, **Bortle class**, **Value Iteration**.
- **Show the clever part.** A formula, the exact rule, a worked example with real values. The deep dives are where a
  reader decides the author really built it.
- **Honest notes.** Known limits and rough edges go in a short Notes section, stated flatly. They read as confidence.
- **No hype, no emoji clutter.** At most a single ▶ in a "play/try it" badge. No "blazing fast", "seamless",
  "revolutionary", "cutting-edge". No marketing questions ("Ever wondered…?").
- **Short paragraphs**, 2 to 4 sentences, wrapped near 80 columns in the source.
- **Second person for the user** ("you pick the two characters"), first-person plural never.
- **Written by a person.** Before it is done, the prose gets the humanizer pass (`.claude/skills/humanizer/SKILL.md`,
  SKILL.md Step 4): no not-X-but-Y contrasts, one-line closers, forced threes, dashes or stock AI words.

## The structure, top to bottom

1. **Hero** (centred): banner or logo, an H3 tagline, two or three sentences on what it is and why it's interesting,
   a big call-to-action badge when there is a live link, one row of tech badges, then the reel: an animated GIF
   recorded from the running app, ~900px wide, with an italic caption saying what it shows. When there is a longer
   video with sound, link or embed it right under the GIF.
2. `---`
3. **What it is**: two or three paragraphs. The core idea first, then the moving parts, then the stack in one
   sentence ("React 19 + Vite on the front and ASP.NET Core 9 + SQL Server stored procedures on the back").
4. **The feature sections**, one per part of the product, each named for what the user does or sees ("The map",
   "Beyond the map", "Your account", "In your pocket", "The tournament", "Seeing inside the model"). Each one is
   mostly media: a two-column table of screenshots or GIFs with a caption under each, the caption's first sentence in
   bold as its title. A single wide image or GIF gets a centred italic caption.
5. **How it works**: one `<details>` per mechanism, each with a bold summary that names the mechanism and what it
   does. Inside: the pipeline as a one-line arrow diagram, numbered steps with the real constants, formulas in code
   blocks, a table where values map to classes, a worked example with real numbers, a real API response.
6. **Run it locally**: prerequisites as a list, then numbered steps with copy-paste commands for the platform the
   project targets, config keys in a table, the one-command launcher if there is one, and how to get a public link
   or a phone test when that matters.
7. **Reference tables**, only those that apply: Scripts (command | what it does), Controls or Using it
   (input | action), Settings (setting | default | effect), Routes (route | page).
8. **API**: a plain text block grouped by area, one endpoint per line, with the auth level aligned on the right.
9. **Architecture**: an ASCII box-and-arrow diagram of the parts, then a **Code map** table (path | what it does) so
   "where is X?" always has a one-hop answer. Link a longer ARCHITECTURE.md if there is one.
10. **Notes**: the honest caveats.
11. **Data and credits**: datasets with citations, services, textures, fonts, icons, music, with their licences.

For an ML or research project, add before "How it works" a section with the experiments: the method in one paragraph
(what was trained, how long, how many seeds, what was scored), the results as a table, and the conclusion in one
bold sentence. For a library or CLI, put a 10-line usage example right after the hero and skip the media tables.

## The HTML that GitHub renders

Hero:

```html
<div align="center">

<img src="media/banner.jpg" alt="PROJECT" width="100%">

### Tagline in four to seven words.

One or two sentences on what it is and the hook. A second one on what you can do with it.

<a href="https://LIVE-URL"><img src="https://img.shields.io/badge/%E2%96%B6%20Try%20it-LIVE--HOST-e52521?style=for-the-badge" alt="Try it at LIVE-HOST"></a>

<img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
<img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+">

<img src="media/reel.gif" alt="What the reel shows, in one sentence" width="900">

<i>Recorded straight from the running app: the three or four moments it shows.</i>

</div>

---
```

Shields.io badge rules: `https://img.shields.io/badge/<LABEL>-<MESSAGE>-<HEX>?logo=<simple-icons-slug>&logoColor=white`.
In LABEL and MESSAGE a dash is `--`, an underscore `__`, a space `%20`, a plus `%2B`, a slash `%2F`. Use the
technology's own brand colour. The big call-to-action badge is `?style=for-the-badge`; the tech row uses the default
flat style. Six to eight badges at most: the stack and one or two facts that matter ("algorithms-13", "build-none").

Two media side by side, captions under them:

```html
<table>
<tr>
<td width="50%"><img src="media/feature-a.gif" alt="What happens in it"></td>
<td width="50%"><img src="media/feature-b.jpg" alt="What it shows"></td>
</tr>
<tr>
<td align="center"><b>Bold title sentence.</b> One or two sentences on what you see and why it matters, with the
real detail (the threshold, the count, the shortcut).</td>
<td align="center"><b>Bold title sentence.</b> Same.</td>
</tr>
</table>
```

One wide image with a caption:

```html
<div align="center">
<img src="media/overview.jpg" alt="..." width="720">
<br>
<i>One sentence on what to notice.</i>
</div>
```

An image beside a block of text (for a phone screen, or a picture with a long explanation):

```html
<table>
<tr>
<td width="34%" align="center"><img src="media/phone.gif" alt="..." width="300"></td>
<td width="66%">

**Bold lead.** The explanation, in Markdown. The blank lines around it inside the cell are required.

</td>
</tr>
</table>
```

A deep dive:

~~~html
<details>
<summary><b>From an input to a result (the mechanism's name)</b></summary>
<br>

```text
input ─▶ step ─▶ step ─▶ result
```

1. **Step.** What it does, with the real constant.
2. **Step.** ...

**Worked example.** Real input, real intermediate values, real output.

</details>
~~~

(Leave a blank line after `<br>` and before `</details>`, or GitHub renders the Markdown inside as plain text.)

## Media that sells it

- **The reel** is the most important asset: 8 to 15 seconds, the three or four moments that make someone want to try
  it, recorded from the real running app, sped up if needed and said so in the caption. Under 10 MB.
- **Screenshots** at a desktop size (1440×900 or similar) for the feature tables; crop to the part that matters.
- **Phone shots** in a row of five at ~170px when the app has a mobile layout.
- Keep them in `media/` at the repository's root. Name them for what they show (`gif-pin-planets.gif`,
  `round3-policy.jpg`), never `screenshot1.png`.
- Alt text describes what happens in the image, as a sentence.

## The checklist before it is done

- Every image and link path exists in the repository (or is an absolute URL that answers).
- Every number is traceable to code, data, history or a measurement in the repository.
- The humanizer pass ran on the prose, and every fact and number reads the same after it.
- Each `<details>` renders (blank lines around the Markdown inside).
- Code blocks name their language; tables have their header rows.
- The run instructions were followed once on this machine, or each step was read from the scripts it calls.
- Nothing personal or secret: no keys, no tokens, no private hostnames, no real users' data.
