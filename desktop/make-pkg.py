"""Build an unsigned standard flat macOS component package (XAR + ODC payload + BOM)."""
from pathlib import Path
import sys,subprocess,tempfile,shutil,gzip,hashlib,zlib,struct,plistlib,xml.etree.ElementTree as ET
app=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();arch=sys.argv[3]
mkbom=Path('/tmp/agentes-build-runtime/bomutils-master/build/bin/mkbom')
with tempfile.TemporaryDirectory(prefix='agentes-pkg-')as temp:
 t=Path(temp);root=t/'root';root.mkdir();shutil.copytree(app,root/app.name,symlinks=True)
 files=[p for p in root.rglob('*')];size=sum(p.stat().st_size for p in files if p.is_file()and not p.is_symlink())//1024+1
 payload=t/'Payload'
 paths=['.']+['./'+str(p.relative_to(root))for p in files]
 with payload.open('wb')as f:
  with gzip.GzipFile(fileobj=f,mode='wb',compresslevel=6,mtime=0)as gz:
   proc=subprocess.Popen(['cpio','-o','--format=odc','--owner=0:80','--null'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   import threading
   def feed():proc.stdin.write(('\0'.join(paths)+'\0').encode());proc.stdin.close()
   thread=threading.Thread(target=feed);thread.start()
   shutil.copyfileobj(proc.stdout,gz);thread.join();err=proc.stderr.read();code=proc.wait()
   if code:raise RuntimeError(err.decode())
 subprocess.run([str(mkbom),'-u','0','-g','80',str(root),str(t/'Bom')],check=True)
 info=plistlib.loads((app/'Contents/Info.plist').read_bytes());identifier=info['CFBundleIdentifier']
 pkg=ET.Element('pkg-info',{'format-version':'2','identifier':identifier+'.pkg','version':info['CFBundleShortVersionString'],'install-location':'/Applications','auth':'root'})
 ET.SubElement(pkg,'payload',{'installKBytes':str(size),'numberOfFiles':str(len(files)+1)})
 bv=ET.SubElement(pkg,'bundle-version');ET.SubElement(bv,'bundle',{'id':identifier,'CFBundleIdentifier':identifier,'path':'./'+app.name,'CFBundleVersion':info['CFBundleVersion']})
 (t/'PackageInfo').write_bytes(ET.tostring(pkg,encoding='utf-8',xml_declaration=True))
 # XAR header checksum algorithm 1 is SHA1. Heap starts with checksum of compressed TOC.
 xar=ET.Element('xar');toc=ET.SubElement(xar,'toc');check=ET.SubElement(toc,'checksum',{'style':'sha1'});ET.SubElement(check,'offset').text='0';ET.SubElement(check,'size').text='20'
 offset=20;entries=[]
 for i,name in enumerate(['Bom','PackageInfo','Payload'],1):
  path=t/name;length=path.stat().st_size
  h=hashlib.sha1()
  with path.open('rb')as f:
   for block in iter(lambda:f.read(1048576),b''):h.update(block)
  item=ET.SubElement(toc,'file',{'id':str(i)});ET.SubElement(item,'name').text=name;ET.SubElement(item,'type').text='file';ET.SubElement(item,'mode').text='0644';ET.SubElement(item,'uid').text='0';ET.SubElement(item,'gid').text='80'
  data=ET.SubElement(item,'data');ET.SubElement(data,'length').text=str(length);ET.SubElement(data,'offset').text=str(offset);ET.SubElement(data,'size').text=str(length);ET.SubElement(data,'encoding',{'style':'application/octet-stream'})
  for tag in ['archived-checksum','extracted-checksum']:ET.SubElement(data,tag,{'style':'sha1'}).text=h.hexdigest()
  entries.append(path);offset+=length
 xml=ET.tostring(xar,encoding='utf-8',xml_declaration=True);compressed=zlib.compress(xml,9)
 with out.open('wb')as f:
  f.write(struct.pack('>IHHQQI',0x78617221,28,1,len(compressed),len(xml),1));f.write(compressed);f.write(hashlib.sha1(compressed).digest())
  for path in entries:
   with path.open('rb')as source:shutil.copyfileobj(source,f)
 print(out, out.stat().st_size,flush=True)
