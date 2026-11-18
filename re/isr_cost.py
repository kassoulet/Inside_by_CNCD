import sys,json,struct
sys.path.insert(0,'/nonexistent'); sys.path.insert(0,''+__import__('os').path.dirname(__import__('os').path.abspath(__file__))+'')
import emu as E
from emu import *
from unicorn import *
TM=json.load(open(E.ROOT+'/web/assets/music_times.json'))['times']
def pos(t):
    o=0
    while o+1<len(TM) and TM[o+1][0]<=t: o+=1
    r=0
    while r+1<len(TM[o]) and TM[o][r+1]<=t: r+=1
    return o,r
E.at(0x1d0b4,lambda:E.wr32(0x103784,1))
for a in (0x20fd6,0x25724): E.tick_at(a)
t0=float(sys.argv[1]); NF=int(sys.argv[2]); K=10
st=dict(isr=0,ins=[0,0],rep=[0,0],outs=[0,0],nisr=0,fr=0)
def code(uc,a,sz,_):
    i=0 if st['isr'] else 1
    st['ins'][i]+=1
    b=bytes(mu.mem_read(a,2))
    if b[0]==0xf3 and b[1] in (0xa4,0xa5,0xaa,0xab,0x6c,0x6d,0x6e,0x6f): st['rep'][i]+=ireg('ECX')
def pout(uc,port,size,val,_): pass
H=[None]
cnt=[0]
mu.hook_add(UC_HOOK_INSN,lambda uc,port,size,_: (st['outs'].__setitem__(0 if st['isr'] else 1, st['outs'][0 if st['isr'] else 1]+1) , 0)[1] if False else None,None,1,0,UC_X86_INS_OUT) if False else None
def isr_in():
    st['isr']=1; st['nisr']+=1; H[0]=mu.hook_add(UC_HOOK_CODE,code,None,0x1b000,0x40000)
def isr_out():
    st['isr']=0
    if H[0] is not None: mu.hook_del(H[0]); H[0]=None
E.at(0x1c70c,isr_in); E.at(STUB if False else E.STUB+13,isr_out)
def loop():
    t=t0+rd32(0x1058c4)/E.TICK_HZ; o,r=pos(t)
    wr(0x104399,b'\x01'); wr(0x103a5d,bytes([o])); wr(0x103a61,struct.pack('<H',r))
    st['fr']+=1
    if st['fr']>NF: mu.emu_stop()
E.tick_at(0x1ccbf,loop,n=lambda:K)
E.start(0)
n=st['nisr']; f=st['fr']
print('t0',t0,'frames',f,'isr',n,'ISR instr/tick',st['ins'][0]/n,'rep iters/tick',st['rep'][0]/n,'| main instr/frame',st['ins'][1]/f,'rep/frame',st['rep'][1]/f)
E.json=None
