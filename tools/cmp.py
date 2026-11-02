#!/usr/bin/env python3
"""cmp.py GOLDEN_DIR JS_DIR [OUT.png] : compare frames of the original (re/golden.py output: frames.npy,pals.npy,meta.json) with the JS port
(tools/render_node.mjs output) frame by frame by display tick (tick = round(t*285.714)).  Prints per-frame RGB error: mean |dRGB| (0..255) and % pixels with any channel
differing by > 8; optionally writes a contact sheet golden | js | abs diff.   Palettes are compared through the DAC (6-bit -> 8-bit)."""
import sys,json,numpy as np
from PIL import Image,ImageDraw
g=sys.argv[1]; j=sys.argv[2]
G=np.load(g+'/frames.npy'); GP=np.load(g+'/pals.npy'); GM=json.load(open(g+'/meta.json'))
JM=json.load(open(j+'/meta.json')); n=len(JM)
J=np.fromfile(j+'/frames.u8','u1').reshape(n,200,320); JP=np.fromfile(j+'/pals.u8','u1').reshape(n,768)
jt={m['tick']:i for i,m in enumerate(JM)}
def rgb(f,p): P=(p.reshape(256,3).astype(np.int32)*255//63); return P[f]
rows=[];tot=[]
for gi,m in enumerate(GM):
    tk=round(m['t']*285.714286)
    if tk not in jt: continue
    ji=jt[tk]; a=rgb(G[gi],GP[gi]); b=rgb(J[ji],JP[ji]); d=np.abs(a-b)
    mae=d.mean(); bad=(d.max(axis=2)>8).mean()*100; tot.append((mae,bad)); rows.append((gi,ji,m['t'],mae,bad))
    print('t=%8.3f tick=%5d  MAE=%6.2f  bad>8: %5.1f%%'%(m['t'],tk,mae,bad))
if tot: print('MEAN MAE %.2f  bad %.1f%% over %d frames'%(np.mean([x[0] for x in tot]),np.mean([x[1] for x in tot]),len(tot)))
if len(sys.argv)>3 and rows:
    sel=rows[::max(1,len(rows)//6)][:6]; W=Image.new('RGB',(3*320,len(sel)*200))
    for r,(gi,ji,t,mae,bad) in enumerate(sel):
        a=rgb(G[gi],GP[gi]).astype('u1'); b=rgb(J[ji],JP[ji]).astype('u1'); d=np.abs(a.astype(int)-b.astype(int)).clip(0,255).astype('u1')
        for c,im in enumerate((a,b,d)): W.paste(Image.fromarray(im),(c*320,r*200))
        ImageDraw.Draw(W).text((3,r*200+2),'%.2fs MAE %.1f'%(t,mae),fill=(255,255,0))
    W.save(sys.argv[3])
