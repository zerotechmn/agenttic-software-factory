"""Build the retained final presentation; optional --out permits a validation export."""
from pathlib import Path
import argparse
import json
from pptx import Presentation
from pptx.util import Inches

P = Path(__file__).parent
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=P / 'FORGE-mongolian-notes.pptx')
args = parser.parse_args()
notes = json.loads((P / 'notes-mn.json').read_text())
video = json.loads((P / 'video-layout.json').read_text())
presentation = Presentation()
presentation.slide_width = Inches(16)
presentation.slide_height = Inches(9)
units = lambda px: Inches(px / 100)
for index, note in enumerate(notes):
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_picture(str(P / 'slides' / f'slide-{index + 1:02d}.png'), 0, 0,
                             width=presentation.slide_width, height=presentation.slide_height)
    frame = slide.notes_slide.notes_text_frame
    frame.text = note
    for paragraph in frame.paragraphs:
        for run in paragraph.runs:
            run.font.name = 'Arial'
            run._r.get_or_add_rPr().set('lang', 'mn-MN')
    if index == 9:
        slide.shapes.add_movie(str(P / 'assets/agents-working.mp4'), units(video['x']), units(video['y']),
                               units(video['width']), units(video['height']),
                               poster_frame_image=str(P / 'assets/complete-demo-poster.png'), mime_type='video/mp4')
        link = slide.shapes.add_textbox(units(1190), units(620), units(330), units(65))
        link.click_action.hyperlink.address = 'http://127.0.0.1:4300/office/?run=wheels2go-shadow-20261103-091012&replay=1'
assert len(presentation.slides) == 10
presentation.save(args.out)
print(f'Built {args.out.name}: ten slides, Mongolian notes and embedded video.')
