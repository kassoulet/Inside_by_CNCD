#!/usr/bin/env python3
"""INSIDE.DAT unpacker (python3 tools/dat.py [outdir]).  Format recovered from loader 0x1c0e8, LZSS 0x1d1c0, lookup 0x1c22c:
 u32 usize ; LZSS stream: flag byte LSB first, 1=literal byte; 0 = match: b0 + ((b1&0xf0)<<4) = back distance, (b1&15)+3 = length.
 Unpacked blob ends with a directory: entries[count] x 0x30 bytes {char name[0x20]; u32 size; u32 offset; u32 pad[2]}, last dword = count.
 Lookup (0x1c22c): '\\'->'/', linear strcmp over the entries, first match wins; returns blob+offset (so the 3 'temple/putki.sro' and 2 'flower/kukka1.sro' duplicates are unreachable)."""
import struct,sys,os
def unlz(s,n):
    o=bytearray(); i=0; f=0
    while len(o)<n:
        f>>=1
        if not f&0x100: f=s[i]|0xff00; i+=1
        if f&1: o.append(s[i]); i+=1
        else:
            b0=s[i]; b1=s[i+1]; i+=2
            d=b0|((b1&0xf0)<<4); l=(b1&15)+3
            for _ in range(l): o.append(o[-d])
    return bytes(o[:n])
def load(path):
    raw=open(path,'rb').read()
    n=struct.unpack_from('<I',raw)[0]
    return unlz(raw[4:],n)
def directory(b):
    cnt=struct.unpack_from('<I',b,len(b)-4)[0]
    base=len(b)-4-cnt*0x30
    ents=[]
    for i in range(cnt):
        e=b[base+i*0x30:base+i*0x30+0x30]
        name=e[:0x20].split(b'\0')[0].decode('latin1')
        ents.append((name,)+struct.unpack_from('<II',e,0x20)[::-1]+(struct.unpack_from('<I',e,0x20)[0],))
    return ents
if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    b=load(here+'/../INSIDE.DAT'); print(len(b))
    es=directory(b); print(len(es))
    for e in es[:5]+es[-5:]: print(e)
    out=sys.argv[1] if len(sys.argv)>1 else here+'/../re/assets'
    seen={}
    for name,off,_,size in es:
        k=seen.get(name,0); seen[name]=k+1
        p=os.path.join(out,name+('' if k==0 else '.dup%d'%k)); os.makedirs(os.path.dirname(p),exist_ok=True)
        open(p,'wb').write(b[off:off+size]); print('%-26s off=%8d size=%8d%s'%(name,off,size,'' if k==0 else '  (duplicate name #%d, unreachable by the demo)'%(k+1)))
