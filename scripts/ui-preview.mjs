import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { embedAuthHero } from './embed-auth-hero.mjs';
await embedAuthHero();
const result = await build({entryPoints:['scripts/ui-preview/main.tsx'],bundle:true,format:'esm',write:false,jsx:'automatic',loader:{'.png':'dataurl','.svg':'dataurl'},define:{'process.env.AGENTLENS_RELEASE_PROFILE':JSON.stringify(process.env.AGENTLENS_RELEASE_PROFILE || 'full')}});
const port = Number(process.env.AGENTLENS_UI_PORT || 4173);
const nativeHostCss = process.env.AGENTLENS_NATIVE_HOST_CSS;
const routes = {'/':'scripts/ui-preview/index.html','/host.css':'scripts/ui-preview/host.css','/styles.css':'styles.css'};
createServer(async (req,res)=>{
 const path = new URL(req.url,'http://localhost').pathname;
 if(path === '/native-host.css' && nativeHostCss){res.setHeader('Content-Type','text/css');res.end(await readFile(nativeHostCss));return;}
 if(path === '/preview.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].contents);return;}
 if(!routes[path]){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/html');const content=await readFile(routes[path]);
 if(path==='/' && nativeHostCss){res.end(content.toString().replace('<link rel="stylesheet" href="/host.css">','<link rel="stylesheet" href="/native-host.css"><link rel="stylesheet" href="/host.css">').replace('<body>','<body class="theme-light is-desktop mod-macos styled-scrollbars">'));return;}
 res.end(content);
}).listen(port,'127.0.0.1',()=>process.stdout.write(`UI preview: http://127.0.0.1:${port}\n`));
