# Final FORGE pitch

- **FORGE-mongolian-notes.pptx** — retained final deck: 10 slides, Mongolian Presenter View notes and the embedded walkthrough. Slide artwork is rendered for consistent layout; edit the source to change it.
- **agentic-software-factory.pdf** — static presentation, without video playback.
- **deck.html** — HTML presentation: arrows/space navigate, N shows notes, F enters fullscreen. Keep assets alongside it.
- **pitch-script.md** — timed narration; speaker notes are Mongolian.
- **notes-mn.json** — editable source of all ten Mongolian notes.
- **assets/architecture.svg**, **architecture.html**, **architecture.png** — final reference-style architecture.
- **assets/agents-working.mp4** — final 51-second walkthrough, edited from actual UI screen captures. It is not continuous live execution.
- **assets/demo-captures/** — the 19 verified screen captures used in the final video; provenance is recorded in assets/complete-demo-provenance.json.

Earlier deck versions, duplicate presentations, ZIP bundles, failed recordings, intermediate clips and superseded architecture/report drafts have been removed. Core project source, recorded runs and unrelated local changes are retained.

## Rebuild

Use Python with python-pptx installed (requirements.txt), plus the Office project's installed Playwright/Chromium:

```sh
python3 build_deck.py
node export_deck.mjs
python3 package_deck.py
```

The generator writes the current HTML, slide content and script. Export writes the current slide PNGs, PDF and video geometry. Packaging produces only FORGE-mongolian-notes.pptx. Pass `--out /tmp/check.pptx` to test packaging without replacing the final file.

## Claim boundaries

Earlier task examples and screenshots use the Living Foundry sample. Slide 10 uses actual Wheels2Go run documents through the existing console in replay mode; it does not start a new run. Kanban means FORGE's existing task board. That run has no research document, and lessons are cross-run guidance rather than model retraining.

Jev/TypeSafe is experimental, disabled by default and advisory. The current hook only offers dev and never changes assignment. No speedup, cost-saving benchmark, hardened isolation or production-readiness claim is made. Native desktop PowerPoint playback varies; use the HTML or separate MP4 if needed.
