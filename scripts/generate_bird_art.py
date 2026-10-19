"""Generate the rounded, pastel Kozabota icon family without external assets.

Stable symbol IDs and appearance IDs are shared by all record screens. Rebuild:
    python3 scripts/generate_bird_art.py
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads(re.search(r'  const BIRD_APPEARANCES = (\[.*?\]);\n', (ROOT/'model.js').read_text(), re.S).group(1))
SAGE='#91aa7c'
PEACH='#edb49c'
BLUE='#8cbfca'
GOLD='#e5c46e'
INK='#344e46'

def path(d, color, **attrs):
    return '<path d="'+d+'" fill="'+color+'" '+ ' '.join(f'{k.replace("_","-")}="{v}"' for k,v in attrs.items())+'/>'

def line(d, color=SAGE, width=2):
    return path(d,'none',stroke=color,stroke_width=width,stroke_linecap='round',stroke_linejoin='round')

def rect(x,y,w,h,c,rx=3):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{c}"/>'

def circle(x,y,r,c):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'

# Small navigation and care icons use colored silhouettes, with fine details only
# where needed to distinguish their action at 24px. No emoji or font dependencies.
ui={
'home':path('M3 11 12 3 21 11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z','#a3ba91')+rect(9,13,6,9,'#f8f8ec',2)+circle(17,11,2,'#e5c46e'),
'scale':rect(3,6,18,17,'#a4c5ae',5)+rect(7,2,10,9,'#dbe8d6',3)+path('M9 5h6l-3 4Z','#6f947e')+circle(12,17,2,'#f7f7ed'),
'heart':path('M12 21C7 18 2 14 2 8c0-6 8-7 10-2 3-5 10-4 10 2 0 6-5 10-10 13Z','#e5aa9a'),
'calendar':rect(2,4,20,19,'#a6ba8d',4)+rect(3,9,18,12,'#f5f4e6',2)+line('M7 2v5m10-5v5','#718d66',2.6)+''.join(circle(x,y,1.15,SAGE) for x in (7,12,17) for y in (13,17)),
'camera':rect(2,6,20,16,'#9fc6cb',4)+rect(7,3,10,5,'#9fc6cb',2)+circle(12,14,5,'#f6f8ed')+circle(12,14,3,'#759fa8')+circle(18,9,1,'#fff8e8'),
'menu':''.join(rect(3,y,4,4,'#a5ba90',2)+rect(10,y+1,11,2,'#78966e',1) for y in (3,10,17)),
'note':rect(3,3,15,20,'#dfdfbe',3)+line('M7 8h6M7 12h4','#fffdf4')+path('m11 17 2-6 7-8 3 3-8 9Z','#ba9b78')+path('m11 17 1-4 3 2Z','#6b7960'),
'leaf':path('M3 20C0 8 7 2 22 3 21 17 14 24 3 20Z','#a2ba8a')+line('m4 20 12-12','#e8edda',1.7),
'drop':path('M12 1C9 7 3 11 4 17c1 9 16 9 16 0 1-6-5-10-8-16Z','#96c7d0')+line('M8 14q-2 4 2 6','#dff0eb'),
'bowl':path('M2 12h20c0 13-20 13-20 0Z','#d8bc77')+f'<ellipse cx="12" cy="12" rx="10" ry="3" fill="#f7e9bc"/>'+''.join(circle(x,y,1,'#b89c62') for x,y in [(7,12),(12,11),(17,12)])+line('M8 6V4m7 3 1-3','#b7ac75',1.5),
'broom':line('m16 2-6 13','#bba078',3)+path('m7 10 10 5-4 8L1 18Z','#d7c68c')+line('m7 14-3 4m6-2-3 4','#a7a779',1.3),
'egg':path('M12 2C5 2-3 23 12 23S19 2 12 2Z','#ead9b5')+path('M9 6C5 10 5 15 7 17','#f8efdb'),
'medical':rect(2,7,20,16,'#b5c8aa',4)+line('M8 7V3h8v4','#89a37e',2.7)+rect(10,10,4,10,'#fff9ed',1)+rect(7,13,10,4,'#fff9ed',1),
'bell':path('M4 18c0-3 2-3 2-9a6 6 0 0 1 12 0c0 6 2 6 2 9Z','#e2c97d')+circle(12,21,2,'#bda45e')+circle(12,2,1.7,'#bda45e'),
'arrow':line('m9 5 7 7-7 7','#829a73',2.7),
'back':line('m15 5-7 7 7 7','#829a73',2.7),
'check':line('m4 12 5 6L21 5','#6f9679',3),
'download':rect(3,17,18,6,'#dce5cf',2)+line('M12 2v13m-5-5 5 5 5-5','#8eaa7b',2.8),
'chart':rect(3,12,4,10,'#aac3a1',2)+rect(10,7,4,15,'#8fb5a6',2)+rect(17,2,4,20,'#e2c57e',2),
'cloud':path('M6 21C-2 20-1 10 6 10 5 0 20-1 20 10c7 0 7 11-1 11Z','#b9d0cd')+circle(10,8,3,'#cedfda'),
'star':path('m12 1 3.3 7 7.7 1-5.5 5.5 1.3 8L12 19l-6.8 3.5 1.3-8L1 9l7.7-1Z',GOLD),
'play':path('M6 3q-2-1-2 2v15q0 3 2 2l16-9q2-1 0-2Z','#9db58a'),
'clock':circle(12,12,11,'#bfd0ac')+circle(12,12,8,'#fbf8e9')+line('M12 6v7l4 2','#819a72',2.2),
}

def bird(b, pose=0, with_prop=True):
    body=b['body']; wing=b['wing'];tail=b['tail']; face=b['face'];beak=b['beak']
    sleepy=pose in (8,11)
    # Round cheeks, round body and a single rounded wing echo the selected icon.
    s=path('M35 67 15 94 44 88Z',tail)
    s+=f'<ellipse cx="53" cy="65" rx="32" ry="31" fill="{body}"/>'
    s+=f'<ellipse cx="52" cy="73" rx="20" ry="18" fill="{wing}"/>'
    s+=line('M42 94v7m23-7 2 7','#c79b67',4)
    if b['species']=='button':
        s+=f'<ellipse cx="58" cy="47" rx="29" ry="17" fill="{b["collar"]}"/>'
    s+=f'<ellipse cx="58" cy="32" rx="29" ry="28" fill="{face}"/>'
    if b['species']=='button': s+=circle(68,29,7,'#fffdf5')
    s+=line('M64 29q4 5 8 0',INK,2.6) if sleepy else circle(68,29,4.4,INK)+circle(69.5,27.5,1.4,'#fffdf5')
    s+=path('M82 31q12 1 8 10l-9 8-6-10Z',beak)
    # Stable canonical order: affection, bite, sing, paper, preen, bath, play,
    # restless, sleep, food, water, beak-grinding. Props never determine data IDs.
    props=[
      path('M94 78c-20-12-13-25-5-16 8-9 16 2 5 16Z','#e4aa9d'),
      path('m97 49-8 18h9l-6 17 19-24h-11l7-11Z',GOLD),
      line('M96 59V39l13-3v20','#be9e70',3)+f'<ellipse cx="92" cy="60" rx="5" ry="3" fill="#be9e70"/><ellipse cx="105" cy="57" rx="5" ry="3" fill="#be9e70"/>',
      '<g transform="rotate(12 98 73)">'+rect(86,56,23,33,'#f8efd4',2)+line('M90 63h14M90 69h12M90 75h13M90 81h9','#c6b68a',1.3)+'</g>',
      line('M42 53q5 14 18 17',tail,5)+path('m96 49 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z',GOLD),
      f'<ellipse cx="57" cy="96" rx="43" ry="10" fill="#b9dbe0"/>'+line('M18 93q10 8 20 0t20 0t20 0t20 0',BLUE,3)+path('M99 58q-13 17 0 18 13-1 0-18Z',BLUE),
      path('m97 55 4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1Z',GOLD),
      line('m99 57 5 4-5 4m4 9 5 4-5 4','#b5a683',2.5),
      line('M92 53h13L93 66h13m-3-27h8l-8 9h8','#8fa98c',2.5),
      '<g transform="translate(78 72) scale(1.4)">'+ui['bowl']+'</g>',
      path('M87 72h23l-3 23H90Z','#a8ced5')+path('m89 79 8 2 10-2-2 13H91Z','#e5f2ee')+path('M101 49q-10 14 0 15 10-1 0-15Z',BLUE),
      line('M84 102H27','#a7ad83',3)+line('m95 32 6-4m-5 12h7m-8 8 6 4','#bba27a',2)+path('M100 79c-15-9-9-19-3-12 7-7 12 2 3 12Z','#e4aa9d'),
    ]
    return s+props[pose] if with_prop else s

symbols=[f'<symbol id="{name}" viewBox="0 0 24 24">{body}</symbol>' for name,body in ui.items()]
# Keep the old public IDs available for cached or standalone references.
symbols.append('<symbol id="bird" viewBox="0 0 120 110">'+bird(catalog[0])+'</symbol>')
for n in range(12): symbols.append(f'<symbol id="pose-{n}" viewBox="0 0 120 110">'+bird(catalog[0],n)+'</symbol>')
symbols.append('<!-- bird-variants:start -->')
for b in catalog:
    for n in range(12): symbols.append(f'<symbol id="{b["id"]}-pose-{n}" viewBox="0 0 120 110">'+bird(b,n)+'</symbol>')
    # Generous space around the single bird for cover framing and timer display.
    scene='<rect width="400" height="340" rx="32" fill="#edf3e2"/>'
    scene+=line('M28 289q165-16 340 0','#9eae83',11)
    scene+=path('M48 286q-34-3-37-27 28-5 37 27M350 287q8-32 37-27-4 27-37 27','#a6bc91')
    # Strip action props from the cover; its crop remains a profile preference.
    neutral=bird(b, with_prop=False)
    scene+='<g transform="translate(28 30) scale(2.45)">'+neutral+'</g>'
    image='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 340">'+scene+'</svg>'
    (ROOT/'birds'/f'{b["id"]}.svg').write_text(image)
    (ROOT/'covers').mkdir(exist_ok=True)
    (ROOT/'covers'/f'{b["id"]}.svg').write_text(image)
    if b['id']=='lovebird-green': (ROOT/'bird.svg').write_text(image)
symbols.append('<!-- bird-variants:end -->')
(ROOT/'art.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg">'+''.join(symbols)+'</svg>')
print(f'Generated {len(ui)} UI icons, {len(catalog)} covers and {len(catalog)*12} behavior illustrations.')
