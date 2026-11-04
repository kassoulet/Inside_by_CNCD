#!/usr/bin/env python3
"""python3 tools/export_meshes.py > web/assets/meshes.json : the reachable .sro meshes of INSIDE.DAT (needs re/assets from tools/dat.py) for web/viewer3d.html."""
import struct,json,glob,os
H=os.path.dirname(os.path.abspath(__file__))+'/..'
out={}
for p in sorted(glob.glob(H+'/re/assets/*/*.sro')):
    if '.dup' in p:continue
    b=open(p,'rb').read();h=struct.unpack_from('<5I',b,0);nv,fo,nf=h[2],h[3],h[4]
    V=[c for i in range(nv) for c in struct.unpack_from('<3h',b,0x14+12*i)];F=[c for i in range(nf) for c in struct.unpack_from('<4H',b,fo+8*i)[1:]]
    out[os.path.relpath(p,H+'/re/assets')[:-4]]={'v':V,'f':F}
print(json.dumps(out,separators=(',',':')))
