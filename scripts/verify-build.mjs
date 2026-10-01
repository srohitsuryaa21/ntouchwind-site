import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const root = resolve('dist');
function walk(directory) {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const path=join(directory,entry.name);
    return entry.isDirectory()?walk(path):path.endsWith('.html')?[path]:[];
  });
}
const pages=walk(root);
const parsed=new Map(pages.map(path=>{
  const html=readFileSync(path,'utf8');
  return [path,{
    ids:new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1])),
    refs:[...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match=>match[1]),
  }];
}));
const broken=[];
let count=0;
for(const [page,{refs}] of parsed) {
  for(const ref of refs) {
    if(/^(?:[a-z]+:|\/\/)/i.test(ref))continue;
    count++;
    const [url,fragment]=ref.split('#');
    const path=decodeURIComponent(url.split('?')[0]);
    let target=path?resolve(path.startsWith('/')?root:dirname(page),path.replace(/^\//,'')):page;
    if(!target.startsWith(root)) {broken.push(`${page}: outside output directory: ${ref}`);continue;}
    if(existsSync(target)&&statSync(target).isDirectory())target=join(target,'index.html');
    if(!existsSync(target))broken.push(`${page}: missing ${ref}`);
    else if(fragment&&parsed.has(target)&&!parsed.get(target).ids.has(fragment))broken.push(`${page}: missing fragment ${ref}`);
  }
}
console.log(`${pages.length} pages, ${count} internal references, ${broken.length} broken targets.`);
for(const issue of broken)console.error(issue);
if(broken.length)process.exitCode=1;
