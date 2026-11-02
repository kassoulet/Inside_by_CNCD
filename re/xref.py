import sys,struct,os
H=os.path.dirname(os.path.abspath(__file__))
d=open(H+'/mem0.bin','rb').read(0x300000)
v=int(sys.argv[1],0)
t=struct.pack('<I',v); i=0
while True:
    i=d.find(t,i+1)
    if i<0:break
    print(hex(i))
