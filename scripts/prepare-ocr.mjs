import fs from 'node:fs';
import path from 'node:path';
const target = path.resolve('public/ocr');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js', path.join(target, 'worker.min.js'));
for (const name of fs.readdirSync('node_modules/tesseract.js-core')) {
  if (name.endsWith('.wasm.js') || name.endsWith('.wasm')) fs.copyFileSync(path.join('node_modules/tesseract.js-core', name), path.join(target, name));
}
fs.copyFileSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', path.join(target, 'eng.traineddata.gz'));
fs.copyFileSync('node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz', path.join(target, 'chi_sim.traineddata.gz'));
fs.copyFileSync('node_modules/tesseract.js/LICENSE.md', path.join(target, 'TESSERACT-LICENSE'));
fs.copyFileSync('node_modules/tesseract.js-core/LICENSE', path.join(target, 'CORE-LICENSE'));
fs.copyFileSync('node_modules/tesseract.js-core/LICENSE', path.join(target, 'TESSDATA-APACHE-LICENSE'));
for (const lang of ['eng', 'chi_sim']) for (const file of ['package.json', 'README.md']) {
  fs.copyFileSync(`node_modules/@tesseract.js-data/${lang}/${file}`, path.join(target, `${lang}-${file}`));
}
fs.copyFileSync('docs/THIRD_PARTY.md', path.join(target, 'THIRD_PARTY.md'));
