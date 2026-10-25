import { useEffect, useRef, useState } from 'react';
import { Snapshot } from '../shared/types';

export function encodeWav(chunks: Float32Array[], sourceRate: number): { wav: string; seconds: number } {
  const length = chunks.reduce((n, a) => n + a.length, 0);
  const joined = new Float32Array(length);
  let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * 16000 / sourceRate), bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, count * 2, true);
  // Average source samples rather than selecting one sample when downsampling.
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sourceRate / 16000), end = Math.min(length, Math.floor((i + 1) * sourceRate / 16000));
    let sum = 0; for (let j = start; j < Math.max(start + 1, end); j++) sum += joined[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  const array = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
  return { wav: `data:audio/wav;base64,${btoa(binary)}`, seconds: length / sourceRate };
}

export function useSpeech(state: Snapshot | null) {
  const current = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    current.current?.pause(); current.current = null;
    const job = state?.speech;
    if (!state?.running || !job) return;
    let cancelled = false;
    window.watchmate.audio({ text: job.text }).then(data => {
      if (cancelled) return;
      const audio = new Audio(data); current.current = audio;
      audio.onplaying = () => { if (!cancelled) void window.watchmate.action({ type: 'speech', id: job.id, event: 'started' }); };
      audio.onended = () => { if (!cancelled) void window.watchmate.action({ type: 'speech', id: job.id, event: 'done' }); };
      audio.onerror = () => { if (!cancelled) void window.watchmate.action({ type: 'speech', id: job.id, event: 'error', error: '音频播放失败，请检查 Windows 输出设备' }); };
      return audio.play();
    }).catch(error => {
      if (!cancelled) void window.watchmate.action({ type: 'speech', id: job.id, event: 'error', error: String(error.message).slice(0, 300) });
    });
    return () => { cancelled = true; current.current?.pause(); current.current = null; };
  }, [state?.speech?.id, state?.running]);
}

export function useMicrophone(state: Snapshot | null, report: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [level, setLevel] = useState(0);
  const cleanup = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const latest = useRef(state); latest.current = state;
  const stop = () => { generation.current++; cleanup.current?.(); cleanup.current = null; setEnabled(false); setLevel(0); void window.watchmate.action({ type: 'speaking', value: false }); };
  useEffect(() => { if (!state?.running) stop(); }, [state?.running]);
  useEffect(() => () => { generation.current++; cleanup.current?.(); }, []);
  const start = async () => {
    if (!latest.current?.running || latest.current.mode !== 'live') { report('请先开始实际观赛；演示模式可使用文字提问。'); return; }
    const token = ++generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (token !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain(); mute.gain.value = 0;
      source.connect(processor); processor.connect(mute); mute.connect(context.destination);
      let chunks: Float32Array[] = [], speaking = false, silentMs = 0, duration = 0, transcribing = false;
      let preroll: Float32Array[] = [];
      processor.onaudioprocess = event => {
        if (!latest.current?.running || token !== generation.current) return;
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        setLevel(Math.min(1, rms * 8));
        if (transcribing) return;
        const voiced = rms > latest.current.settings.vadThreshold, ms = samples.length / context.sampleRate * 1000;
        if (voiced && !speaking) {
          speaking = true; chunks = [...preroll]; duration = chunks.length * ms; silentMs = 0;
          void window.watchmate.action({ type: 'speaking', value: true });
        }
        if (speaking) {
          chunks.push(samples); duration += ms; silentMs = voiced ? 0 : silentMs + ms;
          if (silentMs > 700 || duration >= 20000) {
            speaking = false;
            const output = chunks; chunks = []; preroll = [];
            if (duration > 350) {
              transcribing = true;
              const clip = encodeWav(output, context.sampleRate);
              void window.watchmate.transcribe(clip).catch(e => report(String(e.message))).finally(() => { transcribing = false; });
            } else void window.watchmate.action({ type: 'speaking', value: false });
            duration = 0;
          }
        } else { preroll.push(samples); if (preroll.length > 3) preroll.shift(); }
      };
      cleanup.current = () => {
        processor.onaudioprocess = null; processor.disconnect(); mute.disconnect(); source.disconnect();
        stream.getTracks().forEach(t => t.stop()); void context.close();
      };
      await context.resume(); setEnabled(true);
    } catch (error) { stop(); report(`无法启用麦克风：${String((error as Error).message)}`); }
  };
  return { enabled, level, toggle: () => enabled ? stop() : void start(), stop };
}
