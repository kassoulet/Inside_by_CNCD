org 100h
  mov ax,13h
  int 10h
  mov di,res
  mov cx,8
again:
  push cx
  cli
  call meas
  stosw
  pop cx
  loop again
  mov ax,3
  int 10h
  sti
  mov ah,3Ch
  xor cx,cx
  mov dx,fn
  int 21h
  mov bx,ax
  mov ah,40h
  mov cx,16
  mov dx,res
  int 21h
  mov ah,3Eh
  int 21h
  mov ax,4C00h
  int 21h
meas:
  mov dx,3dah
.a: in al,dx
  and al,8
  jnz .a
.b: in al,dx
  and al,8
  jz .b
  mov al,36h
  out 43h,al
  xor al,al
  out 40h,al
  out 40h,al
.c: in al,dx
  and al,8
  jnz .c
.d: in al,dx
  and al,8
  jz .d
  xor al,al
  out 43h,al
  in al,40h
  mov ah,al
  in al,40h
  xchg al,ah
  neg ax
  ret
fn db 'RES.BIN',0
res times 16 db 0
