// Loopback preview exposes only the three deployable assets, not project files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const routes=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html',['index.html','text/html; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']],
  ['/app.offline.js',['app.offline.js','text/javascript; charset=utf-8']]
]);
export function createPreviewServer(){
  return createServer(async (req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const asset=routes.get(pathname);
    if(!['GET','HEAD'].includes(req.method)||!asset){res.writeHead(404);res.end('Not found');return;}
    try{
      const data=await readFile(resolve(root,asset[0]));
      res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(500);res.end('Preview asset unavailable');}
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const server=createPreviewServer();
  server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
}
