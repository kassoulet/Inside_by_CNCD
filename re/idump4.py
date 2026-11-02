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
t0=float(args[0]); NF=int(args[1]); OUT=args[2]
K=10; DT=K/E.TICK_HZ; fr=[0]
import numpy as np
def dump():
    import struct as S2
    f=lambda a:S2.unpack('<f',rd(a,4))[0]
    for nm,a in (('cam',0x106fc0),('ctx',0x106fc4),('shadow',0x106fc8),('box',0x106fcc),('light',0x106fd0),('mat1',0x106fd4),('mat2',0x106fdc),('mat3',0x106fbc),('grid',0x106fd8)):
        p=rd32(a);print(nm,hex(a),hex(p))
        if nm.startswith('mat'):
            d=rd(p,0x44);print('  words',[hex(x) for x in S2.unpack('<17I',d)])
        elif nm=='ctx': print('  ',[hex(x) for x in S2.unpack('<20I',rd(p,0x50))])
        else:
            d=rd(p,0x100);print('  pos',S2.unpack('<3i',d[0x10:0x1c]),'flags',hex(S2.unpack('<I',d[0xc4:0xc8])[0]),'+c8',hex(S2.unpack('<I',d[0xc8:0xcc])[0]),'+cc',S2.unpack('<i',d[0xcc:0xd0])[0],'nv',S2.unpack('<I',d[0xd4:0xd8])[0],'nf',S2.unpack('<I',d[0xdc:0xe0])[0],'radius',S2.unpack('<I',d[0xf8:0xfc])[0])
    for nm,a in (('shadowvtx',rd32(rd32(0x106fc8)+0xd0)),):
        for k in range(4):
            v=rd(a+0x40*k,0x40);print(' vtx',k,S2.unpack('<II3i2ii2i2h2h2h3i',v))
    for nm,a in (('shadow faces',rd32(rd32(0x106fc8)+0xd8)),):
        for k in range(2): print(' face',k,[hex(x) for x in S2.unpack('<13I',rd(a+0x34*k,0x34))])
    bf=rd32(rd32(0x106fcc)+0xd8);print(' boxface0',[hex(x) for x in S2.unpack('<13I',rd(bf,0x34))])
    print(' light node words',[hex(x) for x in S2.unpack('<12I',rd(rd32(0x106fd0)+0xb0,0x30))])

    o=rd32(0x106fcc); nv=rd32(o+0xd4); va=rd32(o+0xd0); nf=rd32(o+0xdc); fa=rd32(o+0xd8)
    V=[];p=va
    while len(V)<nv:
        V.append(struct.unpack('<2I3i2i i 2h 2h h h 3h',rd(p,0x3a)[:0x3a]) if False else rd(p,0x40));p=rd32(p) if False else p+0x40
    open(OUT+'.vtx','wb').write(b''.join(V))
    print('box',hex(o),'nv',nv,'nf',nf,'pos',[struct.unpack('<i',rd(o+0x10+4*k,4))[0] for k in range(3)])
    open(OUT+'.node','wb').write(rd(o,0x110)); cam=rd32(rd32(0x106fc4+0)+0x38) if False else None
    sc=rd32(0x106fc4);cn=rd32(sc+0x38);open(OUT+'.cam','wb').write(rd(cn,0x110));open(OUT+'.scene','wb').write(rd(sc,0x50))
    print('scene',hex(sc),'cam',hex(cn))
def loop():
    t=t0+fr[0]*DT; o,r=pos(t)
    wr(0x104399,b''); wr(0x103a5d,bytes([o])); wr(0x103a61,struct.pack('<H',r))
    fr[0]+=1
    if fr[0]>NF: dump(); mu.emu_stop()
E.tick_at(0x1ccbf,loop,n=lambda:K)
E.start(0)
