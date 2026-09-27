import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({entryPoints:['src/app.js'],bundle:true,minify:true,outfile:'assets/js/app.js'});
await copyFile('assets/js/app.js','dist/app.js');
await copyFile('assets/css/style.css','dist/style.css');
console.log('JavaScript listo para Jekyll');
