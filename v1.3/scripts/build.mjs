import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=new URL('../',import.meta.url),order=['finance','decision','app'];
export async function buildBundle(entry='app'){
  if(!order.includes(entry))throw new Error('Unknown entry');
  const seen=new Set(),chunks=[];
  for(const name of order.slice(0,order.indexOf(entry)+1)){
    let source=await readFile(new URL(`src/${name}.js`,root),'utf8');const exports=new Set();
    source=source.replace(/^import\s*\{\s*([\w\s,]+)\s*\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?/gm,(_,members,dep)=>{
      if(!seen.has(dep))throw new Error(`Dependency order ${name} -> ${dep}`);
      return `const {${members.replace(/\s+as\s+/g,': ')}}=__modules[${JSON.stringify(dep)}];`;
    });
    source=source.replace(/^export (const|let|function) (\w+)/gm,(_,kind,id)=>{exports.add(id);return `${kind} ${id}`;});
    if(/^\s*(import|export)\s/m.test(source))throw new Error(`Unsupported syntax in ${name}`);
    chunks.push(`__modules[${JSON.stringify(name)}]=(()=>{\n${source}\nreturn {${[...exports].join(',')}};\n})();`);seen.add(name);
  }
  return `// Generated from v1.3/src.\n(()=>{\n'use strict';\nconst __modules=Object.create(null);\n${chunks.join('\n')}\nreturn __modules[${JSON.stringify(entry)}];\n})();\n`;
}
export function inlineAssets({html,css,bundle,license}){
  const style='<link rel="stylesheet" href="styles.css">',script='<script defer src="app.offline.js"></script>';
  if([style,script].some(token=>html.split(token).length!==2))throw new Error('Expected source entry exactly once');
  if(/<\/?script\b|<!--/i.test(bundle)||/<\/style\b/i.test(css)||/-->|<!--/.test(license))throw new Error('Unsafe raw-text token');
  return `<!-- Generated single-file edition; edit v1.3/src and rebuild.\n${license.trim()}\n-->\n`+html.replace(style,()=>`<style>${css}</style>`).replace(script,()=>`<script>${bundle}</script>`);
}
export async function buildStandalone(){
  const [html,css,bundle,license]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('styles.css',root),'utf8'),buildBundle(),readFile(new URL('../LICENSE',root),'utf8')]);
  return inlineAssets({html,css,bundle,license});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  await writeFile(new URL('app.offline.js',root),await buildBundle());
  const html=await buildStandalone();await writeFile(new URL('financial-human-model-standalone.html',root),html);
  console.log(`1.3 offline bundle and standalone built (${Buffer.byteLength(html)} bytes)`);
}
