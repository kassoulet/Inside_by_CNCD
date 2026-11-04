#!/usr/bin/env python3
"""Figures of the write-ups -> figures/.   usage: python3 tools/make_figures.py
Needs: re/assets (python3 tools/dat.py), matplotlib/numpy/pillow, and golden/port frame dirs produced by
  python3 re/golden.py START 120 /tmp/ig_START 1      and      node tools/render_node.mjs START 120 10 /tmp/ip_START
for the START times listed in SCENES (original / port, 28.6 frames per second).  The golden run starts a scene 'frames since its trigger', so the port frames are
matched to the golden ones with the best time shift (searched +-60 ticks); the shift is printed on the figure."""
import os,sys,json,struct,glob
import numpy as np
from PIL import Image
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
H=os.path.dirname(os.path.abspath(__file__))+'/..';OUT=H+'/figures/';os.makedirs(OUT,exist_ok=True)
plt.rcParams.update({'figure.dpi':110,'savefig.dpi':130,'font.size':9})
SCENES=[('0.2','intro'),('19.7','logo'),('29.6','credits'),('59.1','warp'),('69.0','flower'),('98.5','flight'),('118.1','water'),('157.6','temple')]
def rgb(f,p):return (p.reshape(256,3).astype(np.int32)*255//63)[f]
def best(start):
    g='/tmp/ig_'+start;j='/tmp/ip_'+start
    G=np.load(g+'/frames.npy');GP=np.load(g+'/pals.npy');GM=json.load(open(g+'/meta.json'))
    JM=json.load(open(j+'/meta.json'));n=len(JM);J=np.fromfile(j+'/frames.u8','u1').reshape(n,200,320);JP=np.fromfile(j+'/pals.u8','u1').reshape(n,768)
    jt={m['tick']:i for i,m in enumerate(JM)}
    out=None
    for s in range(-60,61):
        errs=[];pairs=[]
        for gi in range(0,len(GM),4):
            tk=round(GM[gi]['t']*285.714286)+s
            if tk in jt:
                a=rgb(G[gi],GP[gi]);b=rgb(J[jt[tk]],JP[jt[tk]]);errs.append(np.abs(a-b).mean());pairs.append((gi,jt[tk]))
        if len(errs)>=10 and (out is None or np.mean(errs)<out[0]):out=(float(np.mean(errs)),s,pairs)
    mae,s,pairs=out;gi,ji=pairs[len(pairs)//2]
    return mae,s,rgb(G[gi],GP[gi]).astype('u1'),rgb(J[ji],JP[ji]).astype('u1'),GM[gi]['t']
res=[]
fig,axs=plt.subplots(len(SCENES),3,figsize=(9.6,len(SCENES)*2.05))
for r,(st,name) in enumerate(SCENES):
    mae,s,a,b,t=best(st);res.append((name,mae,s))
    d=np.abs(a.astype(int)-b.astype(int)).clip(0,255).astype('u1')
    for c,(im,lab) in enumerate(((a,'original (emulated)'),(b,'JS port'),(d,'|difference|'))):
        axs[r,c].imshow(im);axs[r,c].set_xticks([]);axs[r,c].set_yticks([])
        if r==0:axs[r,c].set_title(lab,fontsize=9)
    axs[r,0].set_ylabel('%s\n%.1f s'%(name,t),fontsize=8)
    axs[r,2].set_xlabel('MAE %.1f/255 at shift %+d ticks'%(mae,s),fontsize=7)
fig.tight_layout();fig.savefig(OUT+'compare_scenes.png');plt.close(fig)
fig,ax=plt.subplots(figsize=(7.5,2.8));ax.bar([n for n,m,s in res],[m for n,m,s in res],color='#4c78a8');ax.set_ylabel('mean |port - original| (0..255)');ax.set_title('Per-scene error after best time alignment',fontsize=9)
plt.xticks(rotation=25);fig.tight_layout();fig.savefig(OUT+'error_per_scene.png');plt.close(fig)
# ---- 3D objects (.sro)
def sro(p):
    b=open(p,'rb').read();h=struct.unpack_from('<5I',b,0);nv,fo,nf=h[2],h[3],h[4]
    V=np.array([struct.unpack_from('<3h',b,0x14+12*i) for i in range(nv)],float);F=np.array([struct.unpack_from('<4H',b,fo+8*i)[1:] for i in range(nf)])
    return V,F
OBJ=[('logo/obuke','logo: obuke (130 v / 256 f)'),('credits/tuubi','credits: tuubi'),('credits/piikkis','credits: piikkis (spike ball)'),('nigga/poksi','warp: poksi'),('flower/kukka1','flower: kukka1'),('flower/tunneli1','flower: tunneli1 (tunnel)'),('flight/ship','flight: ship'),('water/obuke','water: obuke'),('water/fish','water: fish'),('temple/mesta22','temple: mesta22'),('temple/mesta23','temple: mesta23'),('temple/putki','temple: putki')]
fig=plt.figure(figsize=(12,8.4))
for i,(f,t) in enumerate(OBJ):
    V,F=sro(H+'/re/assets/'+f+'.sro');ax=fig.add_subplot(3,4,i+1,projection='3d')
    ax.add_collection3d(Poly3DCollection(V[F],facecolor='#72b7b2',edgecolor='#334',linewidths=0.2,alpha=0.8))
    c=(V.min(0)+V.max(0))/2;r=(V.max(0)-V.min(0)).max()/2;ax.set_xlim(c[0]-r,c[0]+r);ax.set_ylim(c[1]-r,c[1]+r);ax.set_zlim(c[2]-r,c[2]+r)
    ax.set_title(t,fontsize=8);ax.set_xticks([]);ax.set_yticks([]);ax.set_zticks([]);ax.view_init(20,-55)
fig.suptitle('INSIDE.DAT 3D objects (.sro, signed 16-bit vertices): 12 of the 22 reachable meshes',fontsize=10);fig.tight_layout();fig.savefig(OUT+'objects_3d.png');plt.close(fig)
print(res)
