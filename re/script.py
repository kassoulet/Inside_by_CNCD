#!/usr/bin/env python3
"""Dump the demo script table (0x1032e4: {order,row,fn} x97) with a first-order classification of each handler."""
import struct,json,os
from capstone import *
H=os.path.dirname(os.path.abspath(__file__))
d=open(H+'/mem0.bin','rb').read(0x300000); md=Cs(CS_ARCH_X86,CS_MODE_32)
TM=json.load(open(H+'/../web/assets/music_times.json'))['times']
def classify(a):
    ins=list(md.disasm(d[a:a+300],a)); out=[]; last=None; n=0
    for i in ins:
        n+=1
        if i.mnemonic=='mov' and i.op_str.startswith('eax, 0x') and 'ptr' not in i.op_str: last=i.op_str.split(', ')[1]
        if i.mnemonic=='xor' and i.op_str=='eax, eax': last='0'
        if i.mnemonic=='call':
            t=int(i.op_str,16)
            if t==0x1caf4: out.append('A=%s'%last)
            elif t==0x1cb04: out.append('B=%s'%last)
            elif t in(0x1c498,0x1c454,0x1c4ac,0x1c364,0x1c3ec): out.append('call %x'%t)
        if i.mnemonic=='jmp':
            t=int(i.op_str,16) if i.op_str.startswith('0x') else 0
            if t==0x1cb04: out.append('B=%s'%last)
            if t==0x1c364: out.append('setpal')
            break
        if i.mnemonic=='ret' or n>40: break
    return ' '.join(out)
rows=[]
for i in range(97):
    o,r,f=struct.unpack_from('<III',d,0x1032e4+i*12)
    rows.append(dict(i=i,order=o,row=r,fn=hex(f),t=round(TM[o][r],3) if o<len(TM) else None,desc=classify(f)))
    print(i,'%2d:%02d'%(o,r),'%7.2fs'%(rows[-1]['t'] or 0),hex(f),rows[-1]['desc'])
json.dump(rows,open(H+'/script_table.json','w'),indent=1)
