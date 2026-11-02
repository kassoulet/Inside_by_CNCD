#!/usr/bin/env python3
"""emu.py - boot the ORIGINAL INSIDE.EXE code (unpacked by unpack_pmodew.py, entry 0x26a48) in Unicorn, flat 32-bit model.
Emulated: DOS int21 (files: inside.dat via host, sound.cfg absent), int10 mode set, VGA ports (palette, 3da retrace), PIT/timer via a
virtual clock, int16 keyboard. Data from mem0.bin (pristine snapshot at the program entry point)."""
import os,struct,sys,collections
from unicorn import *
from unicorn.x86_const import *
from capstone import *
R=lambda n:getattr(sys.modules['unicorn.x86_const'],'UC_X86_REG_'+n)
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.abspath(HERE+'/..')
mu=Uc(UC_ARCH_X86,UC_MODE_32)
mu.mem_map(0,0x10000000)
_d=open(HERE+'/mem0.bin','rb').read(0x400000)
mu.mem_write(0x1b000,_d[0x1b000:0x40000]); mu.mem_write(0x100000,_d[0x100000:0x400000]); del _d
GDT=0x30000000; mu.mem_map(GDT,0x100000)
def desc(code,acc=None): return struct.pack('<HHBBBB',0xffff,0,0,acc or (0x9b if code else 0x93),0xcf,0)
g=b''.join(desc(i==1) for i in range(256)); mu.mem_write(GDT,g)
mu.reg_write(UC_X86_REG_GDTR,(0,GDT,len(g)-1,0))
LDT=GDT+0x10000
mu.mem_write(LDT,b''.join(desc(False,0xf3) for i in range(256)))
mu.reg_write(UC_X86_REG_LDTR,(0x30,LDT,255*8+7,0x82))
mu.reg_write(UC_X86_REG_CR0,mu.reg_read(UC_X86_REG_CR0)|1)
for r,s in [('CS',0x08),('DS',0x10),('ES',0x10),('SS',0x10),('FS',0x10),('GS',0x10)]: mu.reg_write(R(r),s)
def ireg(n): return mu.reg_read(R(n))
def w(r,v): mu.reg_write(R(r),v&0xffffffff)
def rd(a,n): return bytes(mu.mem_read(a,n))
def wr(a,b): mu.mem_write(a,bytes(b))
def rd32(a): return struct.unpack('<I',rd(a,4))[0]
def wr32(a,v): wr(a,struct.pack('<I',v&0xffffffff))
PSP=GDT+0x20000; mu.mem_write(PSP+0x80,b'\x00\x0d'); mu.mem_write(PSP+0x5c,struct.pack('<I',0x8000000))
def setdesc(idx,base,limit=0xfffff): mu.mem_write(LDT+idx*8,struct.pack('<HHBBBB',limit&0xffff,base&0xffff,(base>>16)&0xff,0xf3,0xc0|(limit>>16),(base>>24)&0xff))
setdesc(4,PSP)
DAT=open(ROOT+'/INSIDE.DAT','rb').read()
files={}; nextfd=[5]
def hostfile(n):
    n=n.lower().replace('\\','/')
    if n.endswith('inside.dat'): return DAT
    return None
def cstr(a):
    b=b''
    while True:
        c=rd(a,1)
        if c==b'\0': return b.decode('latin1')
        b+=c; a+=1
def setcf(v): f=ireg('EFLAGS'); mu.reg_write(UC_X86_REG_EFLAGS,(f|1) if v else (f&~1))
def wax(v): w('EAX',(ireg('EAX')&0xffff0000)|(v&0xffff))
ARENA=0x4000000; arena=[ARENA]
log=[]; vga=dict(mode=None,pal=[0]*768,palidx=0,palsub=0,palw=0); clock=[0.0]; retrace=[0]
events=collections.Counter()
def intr(uc,no,_):
    eax=ireg('EAX'); ah=(eax>>8)&0xff; al=eax&0xff
    events[(no,ah)]+=1
    if no==0x21:
        if ah==0x30:
            if ireg('EBX')==0x50484152: w('EAX',0x44580005); w('EBX',0x34); return
            w('EAX',5); return
        if ah==0x4a: setcf(0); return
        if ah==0x48: setcf(1); wax(8); return
        if ah==0x2c:
            t=int(clock[0]*100); w('ECX',(10<<8)|((t//6000)%60)); w('EDX',(((t//100)%60)<<8)|(t%100)); return
        if ah==0x3d:
            n=cstr(ireg('EDX')); f=hostfile(n); log.append(('open',n))
            if n.lower()=='con': f=b''
            if f is None: wax(2); setcf(1); return
            fd=nextfd[0]; nextfd[0]+=1; files[fd]=[f,0]; wax(fd); setcf(0); return
        if ah==0x3e: files.pop(ireg('EBX'),None); setcf(0); return
        if ah==0x3f:
            f=files[ireg('EBX')]; n=ireg('ECX'); b=f[0][f[1]:f[1]+n]; wr(ireg('EDX'),b); f[1]+=len(b); w('EAX',len(b)); setcf(0); return
        if ah==0x42:
            f=files[ireg('EBX')]; o=struct.unpack('<i',struct.pack('<I',(ireg('ECX')<<16|(ireg('EDX')&0xffff))&0xffffffff))[0]
            f[1]=o if al==0 else f[1]+o if al==1 else len(f[0])+o
            w('EAX',f[1]&0xffff); w('EDX',f[1]>>16); setcf(0); return
        if ah==0x44: w('EDX',0x80); setcf(0); return
        if ah==0x40:
            h=ireg('EBX'); n=ireg('ECX'); b=rd(ireg('EDX'),n)
            log.append(('write',b.decode('latin1')))
            w('EAX',n); setcf(0); return
        if ah==0x4c: log.append(('EXIT',al)); uc.emu_stop(); return
        if ah in(0x35,): w('EBX',0); return
        if ah in(0x25,0x09,0x0b): return
        if ah==0x1a: return
        if ah==0x19: wax(2); return
        if ah==0x47: return
    if no==0x10:
        if ah==0: vga['mode']=al; log.append(('setmode',hex(al))); return
        if ah==0x0f: wax(0x5003); return
        if ah in(1,2,5,6,7,9,0x0a,0x0e): return
    if no==0x16:
        if ah in(1,0x11): f=ireg('EFLAGS'); mu.reg_write(UC_X86_REG_EFLAGS,f|0x40); return
        if ah in(0,0x10): wax(0); return
    if no==0x31:
        setcf(0); ax=eax&0xffff
        if ax==0x0204: w('ECX',0x08); w('EDX',0); return
        if ax in(0x0205,0x0201,0x0006,0x0200): return
        if ax==0x0500: wr(ireg('EDI'),struct.pack('<12I',0x4000000,0x4000,0x4000,0x4000,0x8000,0x4000,0x4000,0x8000,0x1000,0,0,0)); return
        if ax==0x0400: wax(0x0090); return
    if no==0x33: return
    if no==0x2f and eax&0xffff in (0x1686,): wax(0); return
    log.append(('UNHANDLED',hex(no),hex(eax),hex(ireg('EBX')),hex(ireg('ECX')),hex(ireg('EDX')),hex(ireg('EIP'))))
    print('UNHANDLED INT %x ax=%04x ebx=%x ecx=%x edx=%x eip=%x'%(no,eax&0xffff,ireg('EBX'),ireg('ECX'),ireg('EDX'),ireg('EIP')))
    uc.emu_stop()
mu.hook_add(UC_HOOK_INTR,intr)
ports=collections.Counter()
def pin(uc,port,size,_):
    ports[('in',port)]+=1
    if port==0x3da: retrace[0]+=1; return 8 if (retrace[0]//3)&1 else 1
    if port in (0x60,): return 0
    return 0
def pout(uc,port,size,val,_):
    ports[('out',port)]+=1
    if port==0x3c8: vga['palidx']=val; vga['palsub']=0
    elif port==0x3c9:
        i=vga['palidx']*3+vga['palsub']; vga['pal'][i]=val&63; vga['palsub']+=1
        if vga['palsub']==3: vga['palsub']=0; vga['palidx']=(vga['palidx']+1)&255
mu.hook_add(UC_HOOK_INSN,pin,None,1,0,UC_X86_INS_IN)
mu.hook_add(UC_HOOK_INSN,pout,None,1,0,UC_X86_INS_OUT)
def mem_inv(uc,access,addr,size,val,_):
    print('MEMFAULT',access,hex(addr),size,'eip',hex(ireg('EIP'))); return False
mu.hook_add(UC_HOOK_MEM_UNMAPPED,mem_inv)
def at(addr,fn): mu.hook_add(UC_HOOK_CODE,lambda uc,a,sz,_:fn(),begin=addr,end=addr)
HP=[0x1000000]; HSZ={}
def _ret(): esp=ireg('ESP'); r=rd32(esp); w('ESP',esp+4); mu.reg_write(UC_X86_REG_EIP,r)
def _malloc():
    n=ireg('EAX'); p=(HP[0]+15)&~15; HP[0]=p+max(n,4)+16; HSZ[p]=n; w('EAX',p); _ret()
def _free(): _ret()
at(0x2710c,_malloc); at(0x278f5,_free)   # Watcom heap (malloc/free) replaced by a host bump allocator
# ---- the demo's own tick ISR (callback 0x1c70c, called by the demo's PIT interrupt 0x27ecf).  Rate: the PIT is calibrated on the VGA vertical retrace (0x27dad):
# 4 interrupts per retrace = ~280 Hz on a 70 Hz mode-13h monitor; DSMI is told 35 time units (1/10000 s) per call => 285.714 ticks per music second.
# Injected from the host: push resume EIP, jump to a guest trampoline that calls the ISR N times (N patched into the stub).
TICK_HZ=10000/35.
STUB=0x2000
wr(STUB,bytes([0x51,0xb9,1,0,0,0,0x9c,0x60,0xe8])+struct.pack('<i',0x1c70c-(STUB+13))+bytes([0x61,0x9d,0xe2,0xf5,0x59,0xc3]))
nticks=[0]; resume=[None]
def tick_at(addr,pre=None,n=lambda:1):
    """hook: at instruction ADDR run optional host fn `pre`, then inject n() ISR calls (once per arrival; the resumed instruction is not re-hooked)"""
    def h():
        if resume[0]==addr: resume[0]=None; return
        if pre: pre()
        isr(n())
    at(addr,h)
def isr(n=1):
    nticks[0]+=n; resume[0]=ireg('EIP'); wr(STUB+2,struct.pack('<I',n))
    esp=ireg('ESP')-4; wr32(esp,ireg('EIP')); w('ESP',esp); mu.reg_write(UC_X86_REG_EIP,STUB)
def start(count=0):
    mu.reg_write(UC_X86_REG_ESP,0x19b6a0); mu.reg_write(UC_X86_REG_FPCW,0x37f)
    try: mu.emu_start(0x26a48,0,count=count)
    except Exception as e: print('ERR',e,hex(ireg('EIP')))
if __name__=='__main__':
    start(int(sys.argv[1]) if len(sys.argv)>1 else 200000000)
    print(log[-10:]); print(events.most_common(20)); print(ports.most_common(20)); print('eip',hex(ireg('EIP')))
