import sys,glob
from PIL import Image, ImageDraw
d=sys.argv[1]; out=sys.argv[2]; a=float(sys.argv[3]); b=float(sys.argv[4]); step=float(sys.argv[5]); cols=int(sys.argv[6])
fs=sorted(glob.glob(d+'/*.png')); T=lambda f:float(f.split('_')[-1][:-4])
sel=[];t=a
while t<=b:
    c=min(fs,key=lambda f:abs(T(f)-t)); sel.append((t,c)); t+=step
w,h=256,160
rows=(len(sel)+cols-1)//cols
W=Image.new('RGB',(cols*w,rows*h))
for i,(t,f) in enumerate(sel):
    im=Image.open(f).resize((w,h)); ImageDraw.Draw(im).text((3,2),'%.1f'%t,fill=(255,255,0)); W.paste(im,((i%cols)*w,(i//cols)*h))
W.save(out)
