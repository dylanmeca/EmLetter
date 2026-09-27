import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';

await build({entryPoints:['src/app.js'],bundle:true,minify:true,outfile:'assets/js/app.js'});
await copyFile('src/export-image.js','assets/js/export-image.js');
await mkdir('dist',{recursive:true});
await Promise.all([
  copyFile('assets/js/app.js','dist/app.js'),
  copyFile('assets/js/export-image.js','dist/export-image.js'),
  copyFile('assets/css/style.css','dist/style.css'),
]);
console.log('JavaScript y estilos listos para Jekyll y dist');
