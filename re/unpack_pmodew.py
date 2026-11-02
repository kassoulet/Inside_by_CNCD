#!/usr/bin/env python3
"""unpack_pmodew.py - unpack TOUR.EXE by *running its own loader* in Unicorn.

TOUR.EXE = MZ stub + PMODE/W 1.33 (packed by a first-stage LZ, an LZEXE-style bit-reader) + overlay 'PMW1' (the program, LE-like, pages
compressed). Stage 1 (16-bit real mode, entry 0x5e) decompresses the PMODE/W extender in place; PMODE/W then reads the PMW1 overlay with DOS
int 21h, decompresses and relocates the objects, switches to protected mode (own DPMI host) and jumps to the program.
We emulate: real mode, the switch to PM (Unicorn follows CR0.PE; we dispatch software INTs through the guest IDT), DOS file I/O (int 21h
open/read/seek on TOUR.EXE itself), XMS/int15 memory queries, and let it run for T seconds (default 100): at that time the whole program is
loaded (object 1 at linear 0x100000, ~1.6 MB; object 2 = self-modifying rasteriser at 0x1b000). mem.bin (64 MB) is the raw dump,
from which re/image.bin (0x100000..0x1cc000) and re/obj2.bin (0x1b000..0x25000) were cut.
usage:  python3 unpack_pmodew.py 100      (writes mem.bin next to this file)
"""
import sys,struct
from unicorn import *; from unicorn.x86_const import *
import os
EXE=sys.argv[2]; IMGEND=int(sys.argv[3],0); SSX=int(sys.argv[4],0); OUT=sys.argv[5]
d=open(EXE,'rb').read()
img=d[0x40:IMGEND]
SEG=0x1000
mu=Uc(UC_ARCH_X86,UC_MODE_16); mu.mem_map(0,0x4000000)
mu.mem_write(SEG*16,img)
psp=(SEG-0x10)*16
# PSP: int20, top of mem, env seg=0
mu.mem_write(psp,b'\xcd\x20'+struct.pack('<H',0x9fc0))
mu.mem_write(psp+0x80,b'\x00\r')
R=mu.reg_write; G=mu.reg_read
for _n in range(256):
    mu.mem_write(0xF0000+_n*8,bytes([0xCD,_n,0xCA,2,0]))
    mu.mem_write(_n*4,struct.pack('<HH',_n*8,0xF000))
R(UC_X86_REG_CS,SEG);R(UC_X86_REG_IP,0x5e)
R(UC_X86_REG_SS,SEG+SSX);R(UC_X86_REG_SP,0x100)
R(UC_X86_REG_DS,SEG-0x10);R(UC_X86_REG_ES,SEG-0x10)
files={}; nextfh=[5]
ALLOC=[0x2000]  # next free paragraph
def reg(n): return G(getattr(__import__('unicorn.x86_const',fromlist=['x']),'UC_X86_REG_'+n))
def wr(n,v): R(getattr(__import__('unicorn.x86_const',fromlist=['x']),'UC_X86_REG_'+n),v)
def iret_cf(uc,cf):
    # modify flags on stack saved by INT? we emulate intr ourselves: set CF directly
    fl=G(UC_X86_REG_EFLAGS); fl=(fl|1) if cf else (fl&~1); R(UC_X86_REG_EFLAGS,fl)
tr=[]
def pm_int(uc,n):
    idtr=G(UC_X86_REG_IDTR); base,lim=idtr[1],idtr[2]
    if n*8+7>lim: print('PM int',hex(n),'beyond idt',hex(lim),'at',hex(reg('EIP'))); uc.emu_stop(); return
    g=bytes(uc.mem_read(base+n*8,8)); off=g[0]|(g[1]<<8)|(g[6]<<16)|(g[7]<<24); sel=g[2]|(g[3]<<8); typ=g[5]&0xf
    cs=reg('CS'); eip=reg('EIP'); fl=reg('EFLAGS')
    # code seg default size
    ss=reg('SS'); esp=reg('ESP')
    sdesc=G(UC_X86_REG_SS)
    gdtr=G(UC_X86_REG_GDTR); db=bytes(uc.mem_read(gdtr[1]+(ss&~7),8)); big=(db[6]>>6)&1
    if typ in (0xe,0xf):
        for v in (fl,cs,eip):
            if big: esp-=4; uc.mem_write(db_base(db)+esp,struct.pack('<I',v))
            else: esp=(esp-4)&0xffff; uc.mem_write(db_base(db)+esp,struct.pack('<I',v))
        R(UC_X86_REG_ESP,esp)
    else:
        for v in (fl&0xffff,cs,eip&0xffff):
            esp-=2; uc.mem_write(db_base(db)+esp,struct.pack('<H',v&0xffff))
        R(UC_X86_REG_ESP,esp)
    R(UC_X86_REG_EFLAGS,fl&~0x300 if typ in(0xe,6) else fl&~0x100)
    R(UC_X86_REG_CS,sel); R(UC_X86_REG_EIP,off)
def db_base(db): return db[2]|(db[3]<<8)|(db[4]<<16)|(db[7]<<24)
def intr(uc,n,ud):
    ax=reg('AX');ah=ax>>8;bx=reg('BX');cx=reg('CX');dx=reg('DX')
    cs=reg('CS');ip=reg('IP')
    if len(tr)<4000: tr.append((n,hex(ax),hex(bx),hex(cx),hex(dx),hex(cs),hex(ip)))
    if (reg('CR0')&1) and not reg('EFLAGS')&0x20000:
        return pm_int(uc,n)
    if n==0x21:
        if ah==0x3d:
            p=reg('DS')*16+dx; s=bytes(uc.mem_read(p,64)).split(b'\0')[0]; print('open',s)
            files[nextfh[0]]=[open(EXE,'rb'),0]; wr('AX',nextfh[0]); nextfh[0]+=1; iret_cf(uc,0)
        elif ah==0x3f:
            f=files[bx][0]; p=reg('DS')*16+dx; b=f.read(cx); print('read',cx,'->pos',f.tell(),flush=True); uc.mem_write(p,b); wr('AX',len(b)); iret_cf(uc,0)
        elif ah==0x42:
            f=files[bx][0]; o=(cx<<16)|dx; al=ax&255
            f.seek(o,[0,1,2][al]); pos=f.tell(); wr('AX',pos&0xffff); wr('DX',pos>>16); iret_cf(uc,0)
        elif ah==0x3e: iret_cf(uc,0)
        elif ah==0x30: wr('AX',0x0005); wr('BX',0); iret_cf(uc,0)
        elif ah==0x48:
            sz=bx; wr('AX',ALLOC[0]); ALLOC[0]+=sz; iret_cf(uc,0)
        elif ah==0x4a: iret_cf(uc,0)
        elif ah==0x51 or ah==0x62: wr('BX',SEG-0x10)
        elif ah==0x35: wr('BX',0); wr('ES',0)
        elif ah==0x25 or ah==0x09 or ah==0x2a or ah==0x2c: pass
        elif ah==0x4c: print('EXIT',ax&255); uc.emu_stop()
        elif ah==0x40:
            p=reg('DS')*16+dx; print('WRITE',bytes(uc.mem_read(p,min(cx,80)))); wr('AX',cx); iret_cf(uc,0)
        else: print('unhandled int21',hex(ax)); iret_cf(uc,0)
    elif n==0x2f:
        if ax==0x4300: wr('AX',0)
        elif ax==0x1687: wr('AX',1)  # no DPMI
        else: print('int2f',hex(ax)); uc.emu_stop()
    elif n==0x15:
        if ah==0x88: wr('AX',0x7000); iret_cf(uc,0)
        elif ax==0xe801: wr('AX',0x3c00);wr('CX',0x3c00); wr('BX',0x100); wr('DX',0x100); iret_cf(uc,0)
        elif ah==0xc0: iret_cf(uc,1)
        else: iret_cf(uc,1); print('int15',hex(ax))
    elif n==0x67:
        wr('AX',0x8100); 
    elif n==0x10 or n==0x16:
        print('INT10/16',hex(ax),'cs',hex(cs),'eip',hex(reg('EIP')),'cr0',hex(reg('CR0'))); uc.emu_stop()
    else:
        print('INT',hex(n),hex(ax),'at',hex(cs),hex(ip))
mu.hook_add(UC_HOOK_INTR,intr)
import atexit
cnt=[0]
ring=[]
def code(uc,a,sz,ud):
    cnt[0]+=1
    ring.append((a,bytes(uc.mem_read(a,sz)).hex(),reg('CS'),reg('ESP'))); del ring[:-30]
#mu.hook_add(UC_HOOK_CODE,code)
def inh(uc,port,size,ud):
    return 0
mu.hook_add(UC_HOOK_INSN,inh,None,1,0,UC_X86_INS_IN)
mu.hook_add(UC_HOOK_INSN,lambda *a:None,None,1,0,UC_X86_INS_OUT)
STOPAT=int(sys.argv[6],0) if len(sys.argv)>6 else 0
if STOPAT:   # stop at the program entry point (pristine snapshot, before the demo's own start-up modifies data)
    mu.hook_add(UC_HOOK_CODE,lambda uc,a,sz,ud:(print('ENTRY reached, regs',[hex(reg(r)) for r in ('CS','EIP','DS','ES','SS','ESP','EAX','EBX','ECX','EDX','ESI','EDI','EBP')],flush=True),uc.emu_stop()),begin=STOPAT,end=STOPAT)
if __name__=='__main__':
    try: mu.emu_start(SEG*16+0x5e,0,timeout=int(float(sys.argv[1])*1e6))
    except UcError as e: print('err',e)
    print('stopped cs:ip',hex(reg('CS')),hex(reg('EIP')),cnt, 'cr0',hex(reg('CR0')) if hasattr(__import__('unicorn.x86_const',fromlist=['x']),'UC_X86_REG_CR0') else '')
    open(OUT,'wb').write(bytes(mu.mem_read(0,0x4000000)))
    for t in tr[-3:]: print(t)
    for r in ring: print(hex(r[0]),r[1],hex(r[2]),hex(r[3]))
