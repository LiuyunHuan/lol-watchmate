import { SpeechJob } from '../shared/types';

export class SpeechQueue {
  private answers: SpeechJob[] = [];
  private banter: SpeechJob[] = [];
  has(messageId: string) { return this.current?.messageId === messageId || [...this.answers, ...this.banter].some(j => j.messageId === messageId); }
  current: SpeechJob | null = null;
  userSpeaking = false;
  answering = false;
  paused = true;
  enqueue(job: SpeechJob) {
    if (job.kind === 'answer') this.answers.push(job);
    else this.banter.push(job);
  }
  replaceBanter(jobs: SpeechJob[]) { this.banter = jobs; }
  interrupt() { const prior = this.current; this.current = null; return prior; }
  clear() { this.answers = []; this.banter = []; this.current = null; }
  filter(check: (job: SpeechJob) => boolean) {
    this.answers = this.answers.filter(check);
    this.banter = this.banter.filter(check);
    if (this.current && !check(this.current)) this.current = null;
  }
  next(now: number): SpeechJob | null {
    if (this.paused || this.userSpeaking || this.current) return this.current;
    if (this.answers.length) this.current = this.answers.shift()!;
    else if (!this.answering) {
      this.banter = this.banter.filter(j => j.expiresAt > now);
      this.current = this.banter.shift() ?? null;
    }
    return this.current;
  }
  finish(id: string) { if (this.current?.id === id) this.current = null; }
}
