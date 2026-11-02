import sys,glob
from PIL import Image
d=sys.argv[1]; out=sys.argv[2]; cols=int(sys.argv[3]) if len(sys.argv)>3 else 4
fs=sorted(glob.glob(d+'/*.png'))
if len(sys.argv)>4: fs=fs[::int(sys.argv[4])]
fs=fs[:cols*4]
rows=(len(fs)+cols-1)//cols
W=Image.new('RGB',(cols*320,rows*200))
for i,f in enumerate(fs): W.paste(Image.open(f),((i%cols)*320,(i//cols)*200))
W.save(out); print(len(fs))
