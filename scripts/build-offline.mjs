// Small, dependency-free packer for this project's named local ESM imports.
// Unsupported import/export forms fail explicitly; no runtime loading is emitted.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const order=['parameters','model','experiment','presentation','app'];
export async function buildOffline(entry='app') {
  if(!order.includes(entry)) throw new Error('Unknown entry');
  const included=order.slice(0,order.indexOf(entry)+1), chunks=[];
  const seen=new Set();
  for(const name of included){
    let source=await readFile(resolve(root,`src/${name}.js`),'utf8');
    const exports=new Set();
    source=source.replace(/^export\s*\{\s*([\w\s,]+)\s*\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?\s*$/gm,(_all,members,dep)=>{
      if(!seen.has(dep)) throw new Error(`Dependency order: ${name} -> ${dep}`);
      for(const member of members.split(',').map(s=>s.trim()).filter(Boolean)) exports.add(member);
      return '';
    });
    source=source.replace(/^import\s*\{\s*([\w\s,]+)\s*\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?/gm,(_all,members,dep)=>{
      if(!seen.has(dep)) throw new Error(`Dependency order: ${name} -> ${dep}`);
      const bindings=members.split(',').map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/\s+as\s+/,': ')).join(', ');
      return `const { ${bindings} } = __modules[${JSON.stringify(dep)}];`;
    });
    source=source.replace(/^export (const|let|function) (\w+)/gm,(_all,kind,id)=>{exports.add(id);return `${kind} ${id}`;});
    if(/^\s*(import|export)\s/m.test(source)) throw new Error(`Unsupported module syntax in ${name}`);
    chunks.push(`__modules[${JSON.stringify(name)}] = (() => {\n${source}\nreturn { ${[...exports].join(', ')} };\n})();`);
    seen.add(name);
  }
  return `// Generated from src/*.js by scripts/build-offline.mjs\n(() => {\n'use strict';\nconst __modules = Object.create(null);\n${chunks.join('\n')}\nreturn __modules[${JSON.stringify(entry)}];\n})();\n`;
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const output=resolve(root,'app.offline.js');
  await writeFile(output,await buildOffline(),'utf8');
  console.log(`Offline bundle: ${output}`);
}
