# Template: one-page-clean

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex
- **Page limit:** 1 page(s)
- **Fonts:** Lato (bundled, loaded from `cover_letters/OpenFonts/fonts/lato/` by a path relative to `cv/`)
- **Class/packages:** article, geometry, fontspec, enumitem, titlesec, xcolor, hyperref

## Compile command

    cd cv && rm -f <file>.pdf && mkdir -p build && lualatex -interaction=nonstopmode -halt-on-error -output-directory=build <file>.tex && mv build/<file>.pdf ./

## Style rules

- Single column, black text, no icons, so the ATS text layer reads in visual order.
- Header is centered: name in capitals, a role line tailored to the posting, then a contact line between two thin rules.
- Section order for technical roles: Technical Skills, Professional Experience, Projects, Education, Additional Information. Move Projects above Professional Experience only when the posting is ML or computer vision and the projects are the stronger evidence.
- Use 4 bullets for YOOZ, 3-4 for BlueBird, and 1-3 projects. Each bullet is one line where possible.
- Every project or company that has a public URL carries its link through `\cvlink`.
- Date ranges use a single ASCII hyphen with spaces, such as `2025 - Present`.

## Known pitfalls

- Keep `\raggedright`. Justified lines squeeze word gaps until the text layer joins words (`andMongoDB`).
- Keep `Kerning = Off` in the font setup. With kerning on, the PDF text layer splits words at kerning pairs (`PyT orch`, `T ensorFlow`), so an ATS keyword match fails even though the page looks right.
- Compile from `cv/`. The font path is relative to that folder, so a compile from anywhere else fails with a missing Lato error.
- Escape `&`, `%`, `#` and `_` in body text. An unescaped `%` silently removes the rest of the line.
- `tools/verify_layout.py` is written for the two-page moderncv layout. For this template, rely on `tools/verify_pdf.py --pages 1 --ascii-dates` and the visual read.
