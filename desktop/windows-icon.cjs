const fs=require('node:fs/promises');
const {NtExecutable,NtExecutableResource,Data,Resource}=require('resedit');
module.exports=async function applyWindowsIcon(file,iconFile){
 const exe=NtExecutable.from(await fs.readFile(file)),res=NtExecutableResource.from(exe);
 const groups=Resource.IconGroupEntry.fromEntries(res.entries);
 if(!groups.length)throw Error('No se encontró el recurso de ícono de Windows.');
 const ico=Data.IconFile.from(await fs.readFile(iconFile));
 for(const group of groups)Resource.IconGroupEntry.replaceIconsForResource(res.entries,group.id,group.lang,ico.icons.map(icon=>icon.data));
 res.outputResource(exe);await fs.writeFile(file,Buffer.from(exe.generate()));
};
