#!/usr/bin/env python3
"""Order/row -> seconds map of EYE.AMF using the system libopenmpt (ctypes). Writes web/assets/music_times.json"""
import ctypes,json,os,sys
L=ctypes.CDLL('libopenmpt.so.0')
H=os.path.dirname(os.path.abspath(__file__))
def timemap(path):
    d=open(path,'rb').read()
    L.openmpt_module_create_from_memory2.restype=ctypes.c_void_p
    L.openmpt_module_create_from_memory2.argtypes=[ctypes.c_char_p,ctypes.c_size_t]+[ctypes.c_void_p]*6+[ctypes.c_void_p,ctypes.c_void_p]
    m=L.openmpt_module_create_from_memory2(d,len(d),None,None,None,None,None,None,None,None)
    L.openmpt_module_get_num_orders.argtypes=[ctypes.c_void_p]
    L.openmpt_module_get_order_pattern.argtypes=[ctypes.c_void_p,ctypes.c_int32]
    L.openmpt_module_get_pattern_num_rows.argtypes=[ctypes.c_void_p,ctypes.c_int32]
    L.openmpt_module_set_position_order_row.argtypes=[ctypes.c_void_p,ctypes.c_int32,ctypes.c_int32]
    L.openmpt_module_get_position_seconds.argtypes=[ctypes.c_void_p]; L.openmpt_module_get_position_seconds.restype=ctypes.c_double
    L.openmpt_module_get_duration_seconds.argtypes=[ctypes.c_void_p]; L.openmpt_module_get_duration_seconds.restype=ctypes.c_double
    n=L.openmpt_module_get_num_orders(m); out=[]
    for o in range(n):
        p=L.openmpt_module_get_order_pattern(m,o); nr=L.openmpt_module_get_pattern_num_rows(m,p); row=[]
        for r in range(nr):
            L.openmpt_module_set_position_order_row(m,o,r); row.append(round(L.openmpt_module_get_position_seconds(m),4))
        out.append(row)
    return out,L.openmpt_module_get_duration_seconds(m)
if __name__=='__main__':
    t,dur=timemap(H+'/../EYE.AMF'); print(len(t),'orders; rows/order',[len(x) for x in t],'dur',dur)
    os.makedirs(H+'/../web/assets',exist_ok=True)
    json.dump({'duration':dur,'times':t},open(H+'/../web/assets/music_times.json','w'))
