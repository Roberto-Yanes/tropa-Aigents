from pathlib import Path
import sys,struct,zlib,hashlib,xml.etree.ElementTree as ET,ctypes as C,ctypes.util
for name in sys.argv[1:]:
 p=Path(name)
 with p.open('rb')as f:
  magic,header,version,compressed,length,algorithm=struct.unpack('>IHHQQI',f.read(28));assert(magic,header,version,algorithm)==(0x78617221,28,1,1)
  tocbytes=f.read(compressed);toc=ET.fromstring(zlib.decompress(tocbytes));assert hashlib.sha1(tocbytes).digest()==f.read(20)
  for item in toc.findall('./toc/file'):
   data=item.find('data');f.seek(header+compressed+int(data.findtext('offset')));left=int(data.findtext('length'));h=hashlib.sha1()
   while left:
    b=f.read(min(left,1048576));assert b;left-=len(b);h.update(b)
   assert h.hexdigest()==data.findtext('archived-checksum')
 # Independent libarchive parser recognizes and reads each member.
 lib=C.CDLL(ctypes.util.find_library('archive'))
 lib.archive_read_new.restype=C.c_void_p
 for fn in ['archive_read_support_filter_all','archive_read_support_format_all','archive_read_free','archive_read_data_skip']:getattr(lib,fn).argtypes=[C.c_void_p]
 lib.archive_read_open_filename.argtypes=[C.c_void_p,C.c_char_p,C.c_size_t];lib.archive_read_next_header.argtypes=[C.c_void_p,C.POINTER(C.c_void_p)];lib.archive_entry_pathname.argtypes=[C.c_void_p];lib.archive_entry_pathname.restype=C.c_char_p
 a=lib.archive_read_new();lib.archive_read_support_filter_all(a);lib.archive_read_support_format_all(a);assert lib.archive_read_open_filename(a,str(p).encode(),10240)==0
 entries=[];entry=C.c_void_p()
 while True:
  r=lib.archive_read_next_header(a,C.byref(entry))
  if r==1:break
  assert r==0,r;entries.append(lib.archive_entry_pathname(entry).decode());assert lib.archive_read_data_skip(a)==0
 lib.archive_read_free(a);assert entries==['Bom','PackageInfo','Payload'],entries
 print(p.name+': XAR reconocido por libarchive; contenido y sumas correctos.')
