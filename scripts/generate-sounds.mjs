import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sampleRate = 44_100;
const output = join(import.meta.dirname, '..', 'resources');
mkdirSync(output, { recursive: true });

function tone(frequency, duration, start, samples) {
  const length = Math.floor(duration * sampleRate);
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / 400, (length - i) / 1_800);
    samples[Math.floor(start * sampleRate) + i] += Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.16 * fade;
  }
}

function write(name, duration, notes) {
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  for (const [frequency, length, start] of notes) tone(frequency, length, start, samples);
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  writeFileSync(join(output, name), bytes);
}

write('alert-approval.wav', 0.44, [[740, 0.12, 0], [740, 0.12, 0.22]]);
write('alert-input.wav', 0.22, [[660, 0.16, 0]]);
write('alert-done.wav', 0.42, [[523, 0.12, 0], [784, 0.18, 0.16]]);
write('alert-unknown.wav', 0.44, [[262, 0.13, 0], [220, 0.15, 0.22]]);
