"""Rebuild selectable bird artwork from the shared palette in model.js.

Only the marked generated block and birds/*.svg are written. Original pose
symbols and bird.svg remain the templates, so stable action IDs stay intact.
"""
from pathlib import Path
import json
import re

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'model.js').read_text()
catalog=json.loads(re.search(r'  const BIRD_APPEARANCES = (\[.*?\]);\n',source,re.S).group(1))
art=(ROOT/'art.svg').read_text()
poses=dict(re.findall(r'<symbol id="(pose-\d+)"[^>]*>(.*?)</symbol>',art,re.S))
assert len(poses)==12
symbols=[]
(ROOT/'birds').mkdir(exist_ok=True)
for bird in catalog:
    for name,body in poses.items():
        replacements={'#9ab77c':bird['body'],'#7e9d68':bird['wing'],'#79a57a':bird['tail'],'#efb590':bird['face'],'#ce7b5d':bird['beak']}
        body=re.sub(r'#[0-9a-fA-F]{6}',lambda match:replacements.get(match.group(),match.group()),body)
        if bird['species']=='button':
            body=body.replace('<ellipse cx="62" cy="34"',f'<path d="M38 49q21 13 45-4l1 14q-25 15-45-1Z" fill="{bird["collar"]}"/><ellipse cx="62" cy="34"',1)
            eye='<circle cx="69" cy="29" r="3"'
            if eye in body:
                body=body.replace(eye,'<circle cx="69" cy="29" r="6" fill="#fff"/>'+eye,1)
            else:
                body=body.replace('<path d="M65 29', '<ellipse cx="69" cy="29" rx="6" ry="5" fill="none" stroke="#fff" stroke-width="2"/><path d="M65 29',1)
        symbols.append(f'<symbol id="{bird["id"]}-{name}" viewBox="0 0 120 110">{body}</symbol>')
    image=(ROOT/'bird.svg').read_text()
    colors={'#adc98b':bird['body'],'#6c9e76':bird['body'],'#9cbb73':bird['wing'],'#64885c':bird['wing'],'#6b9e7b':bird['tail'],'#e89e7b':bird['face'],'#f4cc9e':bird['face'],'#b5c48b':bird['body'] if bird['species']=='lovebird' else bird['face'],'#d5775a':bird['beak']}
    image=re.sub(r'#[0-9a-fA-F]{6}',lambda match:colors.get(match.group(),match.group()),image)
    if bird['species']=='button':
        image=image.replace('<ellipse cx="217" cy="123"',f'<path d="M157 160q55 34 112-14l-2 36q-65 39-110-5Z" fill="{bird["collar"]}"/><ellipse cx="217" cy="123"',1)
        image=image.replace('<ellipse cx="241" cy="108" rx="6"', '<ellipse cx="241" cy="108" rx="13" ry="14" fill="#fff"/><ellipse cx="241" cy="108" rx="6"',1)
        image=image.replace('stroke="#d48d73"','stroke="#77766e"')
    (ROOT/'birds'/f'{bird["id"]}.svg').write_text(image)
block='<!-- bird-variants:start -->\n'+''.join(symbols)+'\n<!-- bird-variants:end -->'
if '<!-- bird-variants:start -->' in art:
    art=re.sub(r'<!-- bird-variants:start -->.*?<!-- bird-variants:end -->',lambda _:block,art,flags=re.S)
else:
    art=art.replace('</svg>',block+'</svg>')
(ROOT/'art.svg').write_text(art)
print(f'Generated {len(catalog)} bird illustrations and {len(symbols)} action symbols.')
