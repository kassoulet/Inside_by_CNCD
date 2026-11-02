#!/usr/bin/env python3
"""disassemble: ds.py ADDR [N]  (linear addresses into re/mem.bin)"""
import sys,os
from capstone import *
H=os.path.dirname(os.path.abspath(__file__))
d=open(H+'/mem.bin','rb').read(0x300000)
a=int(sys.argv[1],0); n=int(sys.argv[2]) if len(sys.argv)>2 else 40
md=Cs(CS_ARCH_X86,CS_MODE_32)
c=0
for i in md.disasm(d[a:a+n*8],a):
    print('%x: %-24s %s %s'%(i.address,d[i.address:i.address+i.size].hex(),i.mnemonic,i.op_str))
    c+=1
    if c>=n:break
