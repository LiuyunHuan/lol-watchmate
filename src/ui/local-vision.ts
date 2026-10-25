import { createWorker, PSM, Worker } from 'tesseract.js';
import { Feature, LocalProfile, LocalReading, Rect } from '../shared/local';
import { similarity } from '../core/local-detector';

export function frameCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0); return c;
}
export function cloudImage(source: HTMLCanvasElement) {
  const c = document.createElement('canvas'), scale = Math.min(1, 1440 / source.width);
  c.width = Math.round(source.width * scale); c.height = Math.round(source.height * scale);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}
export function feature(source: HTMLCanvasElement, r: Rect): Feature {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, r.x * source.width, r.y * source.height, r.w * source.width, r.h * source.height, 0, 0, 8, 8);
  const pixels = ctx.getImageData(0, 0, 8, 8).data, pattern: number[] = [];
  let saturation = 0, light = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]), min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    saturation += max ? (max - min) / max : 0;
    const grey = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
    pattern.push(grey); light += grey;
  }
  return { saturation: saturation / 64, light: light / 64, pattern };
}
export class LocalVision {
  private worker?: Worker;
  private pending?: Promise<Worker>;
  private generation = 0;
  busy = false;
  async prepare() {
    if (this.worker) return this.worker;
    if (!this.pending) {
      const generation = this.generation;
      const base = new URL('./ocr/', window.location.href).href;
      this.pending = createWorker('eng+chi_sim', 1, { workerPath: base + 'worker.min.js', langPath: base, corePath: base,
        workerBlobURL: false, cacheMethod: 'none', errorHandler: () => {} }).then(async worker => {
        if (generation !== this.generation) { await worker.terminate(); throw new Error('OCR已停止'); }
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789:REPLAYreplay回放', preserve_interword_spaces: '1' });
        this.worker = worker; return worker;
      }).catch(e => { this.pending = undefined; throw e; });
    }
    return this.pending;
  }
  stop() { this.generation++; void this.worker?.terminate(); this.worker = undefined; this.pending = undefined; this.busy = false; }
  async read(source: HTMLCanvasElement, profile: LocalProfile, protectedSlots: string[]): Promise<LocalReading | null> {
    if (this.busy) return null;
    this.busy = true; const generation = this.generation, at = Date.now();
    const result: LocalReading = { profileId: profile.id, at, elapsedMs: 0, clock: null, clockConfidence: 0, samples: [], replay: false };
    try {
      if (source.width !== profile.width || source.height !== profile.height) {
        result.error = '窗口尺寸已变化，请重新校准'; return result;
      }
      const targets = profile.portraits.filter(p => !protectedSlots.includes(p.slot));
      // All portrait features help reject camera cuts; protected players are never OCR'ed.
      result.samples = profile.portraits.map(p => ({ slot: p.slot, feature: feature(source, p.rect), timer: null, timerConfidence: 0 }));
      const candidates = targets.filter(p => {
        const f = result.samples.find(s => s.slot === p.slot)!.feature;
        return f.saturation < p.alive.saturation * .5 && similarity(p.alive, f) >= .45;
      });
      // Timer OCR uses the center, avoiding level digits and adjacent health bars.
      const regions = [profile.clock, ...candidates.map(({ rect: r }) => ({ x: r.x + r.w * .15, y: r.y + r.h * .2, w: r.w * .7, h: r.h * .6 })), ...(profile.replay ? [profile.replay] : [])];
      const mosaic = document.createElement('canvas'); mosaic.width = 240; mosaic.height = regions.length * 96;
      const ctx = mosaic.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, mosaic.width, mosaic.height);
      regions.forEach((r, i) => {
        const scale = Math.min(210 / (r.w * source.width), 68 / (r.h * source.height));
        const w = r.w * source.width * scale, h = r.h * source.height * scale;
        ctx.drawImage(source, r.x * source.width, r.y * source.height, r.w * source.width, r.h * source.height, 15, i * 96 + 12, w, h);
        // White timer digits on dark HUD become dark text on white, all within local memory.
        const pixels = ctx.getImageData(15, i * 96 + 12, Math.ceil(w), Math.ceil(h));
        for (let j = 0; j < pixels.data.length; j += 4) {
          const value = pixels.data[j] * .299 + pixels.data[j + 1] * .587 + pixels.data[j + 2] * .114 > 160 ? 0 : 255;
          pixels.data[j] = pixels.data[j + 1] = pixels.data[j + 2] = value;
        }
        ctx.putImageData(pixels, 15, i * 96 + 12);
      });
      const worker = await this.prepare();
      if (generation !== this.generation) return null;
      const { data } = await worker.recognize(mosaic, {}, { text: true, blocks: true });
      if (generation !== this.generation) return null;
      const words = data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
      for (let i = 0; i < regions.length; i++) {
        const row = words.filter(w => Math.floor((w.bbox.y0 + w.bbox.y1) / 2 / 96) === i).sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const text = row.map(w => w.text).join('').trim(), confidence = row.length ? Math.min(...row.map(w => w.confidence)) : 0;
        if (i === 0) {
          const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
          if (clock) { result.clock = Number(clock[1]) * 60 + Number(clock[2]); result.clockConfidence = confidence; }
        } else if (profile.replay && i === regions.length - 1) {
          result.replay = /REPLAY|回放/i.test(text) && confidence >= 45;
        } else if (/^\d{1,2}$/.test(text) && Number(text) > 0) {
          const sample = result.samples.find(s => s.slot === candidates[i - 1].slot)!;
          sample.timer = Number(text); sample.timerConfidence = confidence;
        }
      }
      return result;
    } catch { result.error = '本地OCR启动或识别失败，请暂停后重试'; return result; }
    finally { result.elapsedMs = Date.now() - at; if (generation === this.generation) this.busy = false; }
  }
}
