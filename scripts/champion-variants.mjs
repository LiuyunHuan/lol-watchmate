// Supplement Data Dragon with in-game skin portraits. Static files, no API key or runtime requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=path.resolve('public/champions/variants');await fs.mkdir(root,{recursive:true});
const version='16.21';
const champions=process.argv.slice(2).length?process.argv.slice(2):['Ryze','Viktor','Renekton','Lulu','Syndra'];
const manifest=JSON.parse(await fs.readFile('public/champions/manifest.json','utf8'));
const previous=await fs.readFile(path.join(root,'manifest.json'),'utf8').then(JSON.parse).catch(()=>({entries:[]}));
const entries=previous.entries.filter(e=>!champions.includes(e.championId));
for(const id of champions){
 if(!manifest.champions.some(c=>c.id===id))throw Error('Unknown canonical champion: '+id);
 const base=`https://raw.communitydragon.org/${version}/game/assets/characters/${id.toLowerCase()}/hud/`;
 const listing=await fetch(base,{signal:AbortSignal.timeout(30000)});if(!listing.ok)throw Error('HUD listing '+listing.status);
 const files=[...new Set([...((await listing.text()).matchAll(/href="([^"/]*circle[^"/]*\.png)"/g))].map(m=>m[1]))];
 let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<files.length){
  const name=files[next++],file=id+'-'+name,url=base+name,dest=path.join(root,file);
  let bytes;try{bytes=await fs.readFile(dest);}catch{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HUD portrait '+r.status);bytes=Buffer.from(await r.arrayBuffer());await fs.writeFile(dest,bytes);}
  entries.push({championId:id,file,source:url,sha256:createHash('sha256').update(bytes).digest('hex')});
 }}));
 console.log(id,files.length,'in-game portraits');
}
entries.sort((a,b)=>a.file.localeCompare(b.file));
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({version,source:'https://communitydragon.org/documentation/assets',entries},null,2));
