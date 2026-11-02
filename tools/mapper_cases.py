#!/usr/bin/env python3
"""mapper_cases.py OUT.json [N] : run the ORIGINAL face mappers (0x30e5c, 0x2edb0, 0x2e264, 0x3269c, 0x32dc8, 0x332e0) in the emulator on random triangles
and record the framebuffer result; tools/test_mappers.mjs replays the same cases through web/js/engine3d.js (bit exactness test)."""
import sys,os,json,random,struct,base64
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','re'))
import emu as E
from emu import *
from unicorn import *
N=int(sys.argv[2]) if len(sys.argv)>2 else 40
rnd=random.Random(1234)
FN={'gouraud':0x30e5c,'tex':0x2edb0,'gouraud2':0x2e264,'blend':0x3269c,'shadedst':0x32dc8,'lightmap':0x332e0}
BASE=0x8000000; TEX=BASE; TA=BASE+0x20000; TB=BASE+0x40000; TC=BASE+0x60000; FBP=BASE+0x80000; FACE=BASE+0x100000; VT=BASE+0x100100; MAT=BASE+0x100400
RET=0x2100; wr(RET,b'\xf4')   # hlt
def setg(a,v): wr32(a,v)
res=[]
for mode,addr in FN.items():
    for case in range(N):
        tw=rnd.choice([8,8,8,7,6]); th=rnd.choice([8,8,7,6]); 
        tex=bytes(rnd.randrange(256) for _ in range(1<<(tw+th)))
        tA=bytes(rnd.randrange(256) for _ in range(65536)); tB=bytes(rnd.randrange(256) for _ in range(65536)); tC=bytes(rnd.randrange(256) for _ in range(65536))
        fb0=bytes(rnd.randrange(256) for _ in range(64000))
        wr(TEX,tex); wr(TA,tA); wr(TB,tB); wr(TC,tC); wr(FBP,fb0)
        # material: [0]=tex [4]=lightmap table [8]=shade [0xc]=shade2 [0x18]=flags [0x38]=umask [0x3c]=vmask [0x40]=ubits [0x41]=vbits
        wr(MAT,b'\0'*0x44); wr32(MAT,TEX); wr32(MAT+4,TA); wr32(MAT+8,TB); wr32(MAT+0xc,TC); wr32(MAT+0x38,(1<<tw)-1); wr32(MAT+0x3c,(1<<th)-1); wr(MAT+0x40,bytes([tw,th]))
        persp=rnd.choice([0,0,0,1,2,3,4,5]) 
        flags=(persp<<10)|2
        W=rnd.choice([320,320,160]); 
        verts=[]
        big=rnd.random()<0.3
        for i in range(3):
            x=rnd.randrange(-40*16,(W+40)*16) if not big else rnd.randrange(-300*16,(W+300)*16)
            y=rnd.randrange(-10*16,210*16) if not big else rnd.randrange(-100*16,300*16)
            z=rnd.randrange(0x3000,0x30000)
            v=dict(x=x,y=y,z=z,u=rnd.randrange(0,4096),v=-rnd.randrange(0,4096),s=rnd.randrange(0,993),u2=rnd.randrange(0,4096),v2=rnd.randrange(0,4096),s2=rnd.randrange(0,993))
            verts.append(v)
            p=VT+i*0x40; wr(p,b'\0'*0x40); wr32(p+0x14,x&0xffffffff); wr32(p+0x18,y&0xffffffff); wr32(p+0x1c,z)
            wr(p+0x28,struct.pack('<hhhhhh',v['u'],v['v'],v['u2'],v['v2'],v['s'],v['s2']))
        wr(FACE,b'\0'*0x34); wr32(FACE+0x10,MAT); wr32(FACE+0x14,VT); wr32(FACE+0x18,VT+0x40); wr32(FACE+0x1c,VT+0x80); wr32(FACE+0x30,flags)
        setg(0x199fe8,0); setg(0x199fe4,0); setg(0x199ff4,200); setg(0x19a000,W); setg(0x19a00c,320); setg(0x199ff0,FBP); setg(0x19a020,0x3000)
        # (0x199ff0 = destination base)
        esp=0x9000000; wr32(esp,RET); 
        for r in ('EBX','ECX','EDX','ESI','EDI','EBP'): w(r,0)
        w('EAX',FACE); w('ESP',esp)
        try: mu.emu_start(addr,RET,count=20000000)
        except Exception as e: print('ERR',mode,case,e,hex(ireg('EIP'))); continue
        out=rd(FBP,64000)
        res.append(dict(mode=mode,tw=tw,th=th,flags=flags,W=W,verts=verts,tex=base64.b64encode(tex).decode() if case<3 else None,seed=case,
                        fb0=base64.b64encode(fb0).decode(),out=base64.b64encode(out).decode(),
                        tA=base64.b64encode(tA).decode(),tB=base64.b64encode(tB).decode(),tC=base64.b64encode(tC).decode(),texb=base64.b64encode(tex).decode()))
json.dump(res,open(sys.argv[1],'w'))
print(len(res),'cases')
