import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildOffline} from './build-offline.mjs';

const root=new URL('../',import.meta.url);
const styleEntry='<link rel="stylesheet" href="styles.css">';
const scriptEntry='<script defer src="app.offline.js"></script>';
const documentLink=/<a href="([A-Za-z0-9_-]+\.txt)" target="_blank">/g;

// Blob downloads use the same browser mechanism as the application's reports.
// The bytes originate only from the public documents embedded during the build.
export function prepareDocumentDownloads(){
  for(const link of document.querySelectorAll('a[data-embedded-document]')){
    const bytes=Uint8Array.from(atob(link.href.split(',')[1]),character=>character.charCodeAt(0));
    link.href=URL.createObjectURL(new Blob([bytes],{type:'text/plain;charset=utf-8'}));
  }
}

export function inlineAssets({html,css,bundle,license,documents={}}){
  for(const marker of [styleEntry,scriptEntry]){
    if(html.split(marker).length!==2)throw new Error(`Expected source entry exactly once: ${marker}`);
  }
  // HTML raw-text parsing happens before JS/CSS parsing. Fail explicitly if a
  // future source change would terminate an inline block or alter script parsing.
  if(/<\/?script\b|<!--/i.test(bundle))throw new Error('Unsafe inline script token; review the source before packaging');
  if(/<\/style\b/i.test(css))throw new Error('Unsafe inline style token; review the source before packaging');
  if(/-->|<!--/.test(license))throw new Error('Unsafe license comment');
  const notice=`<!-- Generated single-file edition; edit source files and rebuild.\n${license.trim()}\n-->\n`;
  let documentCount=0;
  html=html.replace(documentLink,(_,name)=>{
    if(typeof documents[name]!=='string')throw new Error(`Missing embedded document: ${name}`);
    const data=Buffer.from(documents[name],'utf8').toString('base64');
    documentCount++;
    return `<a href="data:text/plain;charset=utf-8;base64,${data}" download="${name}" data-embedded-document title="下载内置说明，无需联网">`;
  });
  const script=bundle+(documentCount?`\n(${prepareDocumentDownloads.toString()})();\n`:'');
  return notice+html
    .replace(styleEntry,()=>`<style>${css}</style>`)
    .replace(scriptEntry,()=>`<script>${script}</script>`);
}

export async function buildStandalone(){
  const [html,css,bundle,license]=await Promise.all([
    readFile(new URL('index.html',root),'utf8'),
    readFile(new URL('styles.css',root),'utf8'),
    buildOffline(),
    readFile(new URL('../LICENSE',root),'utf8')
  ]);
  const names=[...new Set([...html.matchAll(documentLink)].map(match=>match[1]))];
  const documents=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL(name,root),'utf8')])));
  return inlineAssets({html,css,bundle,license,documents});
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const html=await buildStandalone();
  await writeFile(new URL('financial-human-model-standalone.html',root),html);
  console.log(`Standalone HTML built (${Buffer.byteLength(html)} bytes); no sibling assets required`);
}
