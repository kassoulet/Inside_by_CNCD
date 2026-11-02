#!/usr/bin/env python3
"""golden.py  START_SEC  NFRAMES  OUTDIR  [every=1] [--png] [--k=10]
Run the ORIGINAL INSIDE code headlessly under Unicorn (emu.py): no sound (the DSMI init is skipped; the AMF order/row the script table keys on is fed from a
virtual clock using the libopenmpt time map web/assets/music_times.json); the demo's tick ISR (0x1c70c, 285.7 Hz) is injected once per main-loop iteration and in
the frame-wait spin loops, i.e. K ISR ticks (default K=10, i.e. 28.6 frames/s - an idealised Pentium) are injected per main-loop iteration; ISR rate = 285.714 ticks per music second (see emu.py).  Starting at any START_SEC works: the script table fires every
entry up to that position in one go (the scene state is then 'frames since its trigger' - but a scene triggered by the catch-up starts at START_SEC).
Output in OUTDIR: frames.npy (N,200,320) uint8 mode-13h screen, pals.npy (N,768) uint8 6-bit VGA DAC, meta.json (per frame: time, order, row, tick1058c4, tick1058c8, frame#)
[--png: also indexed PNGs].   Usage example: python3 golden.py 98.38 520 /tmp/flight 1"""
import sys,json,os,struct,time
import emu as E
from emu import *
import numpy as np
from PIL import Image
TM=json.load(open(E.ROOT+'/web/assets/music_times.json'))['times']
def pos(t):
    o=0
    while o+1<len(TM) and TM[o+1][0]<=t: o+=1
    r=0
    while r+1<len(TM[o]) and TM[o][r+1]<=t: r+=1
    return o,r
E.at(0x1d0b4,lambda:E.wr32(0x103784,1))   # skip audio init (DSMI): with the 'sound error' flag set 0x1d0b4 returns at once
for a in (0x20fd6,0x25724): E.tick_at(a)  # frame-wait spin loops: ticks must pass
args=[a for a in sys.argv[1:] if not a.startswith('--')]
t0=float(args[0]); NF=int(args[1]); OUT=args[2]; EVERY=int(args[3]) if len(args)>3 else 1; PNG='--png' in sys.argv
os.makedirs(OUT,exist_ok=True)
K=int(next((a[4:] for a in sys.argv if a.startswith('--k=')),10)); DT=K/E.TICK_HZ; fr=[0]; frames=[]; pals=[]; meta=[]
def loop():
    t=t0+fr[0]*DT; o,r=pos(t)
    wr(0x104399,b'\x01'); wr(0x103a5d,bytes([o])); wr(0x103a61,struct.pack('<H',r))
    if fr[0]>0 and (fr[0]-1)%EVERY==0:
        raw=np.frombuffer(rd(0xA0000,64000),'u1').reshape(200,320).copy()
        frames.append(raw); pals.append(np.array(E.vga['pal'],dtype='u1'))
        meta.append(dict(t=round(t0+rd32(0x1058c4)/E.TICK_HZ,4),order=o,row=r,tick_total=rd32(0x1058c4),tick_scene=rd32(0x1058c8),frame=fr[0]-1,note='t = time of the ISR tick count at capture (what is on screen then)'))
        if PNG:
            im=Image.fromarray(raw,'P'); P=(np.array(pals[-1],dtype=np.int32)*255//63).astype('u1'); im.putpalette(P.tobytes()); im.save('%s/f_%07.3f.png'%(OUT,meta[-1]['t']))
    fr[0]+=1
    if fr[0]>NF: mu.emu_stop()
E.tick_at(0x1ccbf,loop,n=lambda:K)
T=time.time(); E.start(0)
np.save(OUT+'/frames.npy',np.array(frames)); np.save(OUT+'/pals.npy',np.array(pals)); json.dump(meta,open(OUT+'/meta.json','w'))
print('frames',fr[0],'captured',len(frames),'secs %.1f'%(time.time()-T),'eip',hex(ireg('EIP')),E.log[-3:])
