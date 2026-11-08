from pathlib import Path
import sys,shutil,hashlib,urllib.request,tarfile,zipfile,subprocess
root=Path(__file__).resolve().parent.parent
platform,arch=sys.argv[1:3];assert platform in ('linux','win32','darwin');assert arch in ('x64','arm64')
stage=root/'desktop/stage'
if stage.exists():shutil.rmtree(stage)
backend=stage/'backend';backend.mkdir(parents=True)
for f in root.glob('*.mjs'):shutil.copy2(f,backend/f.name)
shutil.copy2(root/'google-vault.py',backend/'google-vault.py')
for name in ['package.json','package-lock.json','LICENSE','browser-extension.zip']:shutil.copy2(root/name,backend/name)
for name in ['public','browser-extension']:shutil.copytree(root/name,backend/name)
shutil.copytree(root/'channels',backend/'channels')
subprocess.run([shutil.which('npm') or 'npm','ci','--omit=dev','--no-audit','--no-fund','--os='+platform,'--cpu='+arch],cwd=backend,check=True)
nodeplatform='win' if platform=='win32' else platform
filename=f'node-v24.22.1-{nodeplatform}-{arch}'+('.zip'if platform=='win32'else'.tar.gz')
cache=Path('/tmp/agentes-build-runtime');cache.mkdir(exist_ok=True);archive=cache/filename
if not archive.exists():urllib.request.urlretrieve('https://nodejs.org/dist/v24.22.1/'+filename,archive)
expected=next(line.split()[0]for line in(root/'packaging/node-SHASUMS256.txt').read_text().splitlines()if line.endswith(filename))
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise ValueError('SHA-256 de Node incorrecto')
runtime=stage/'runtime';runtime.mkdir()
if platform=='win32':
 with zipfile.ZipFile(archive)as z:
  for info in z.infolist():
   if not info.is_dir():
    dest=runtime/info.filename.split('/',1)[1];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
else:
 with tarfile.open(archive)as tar:tar.extractall(stage/'unpack',filter='data')
 unpack=next((stage/'unpack').iterdir());shutil.rmtree(runtime);shutil.move(str(unpack),runtime);shutil.rmtree(stage/'unpack')
print('Preparado:',platform,arch,flush=True)
