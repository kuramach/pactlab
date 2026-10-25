'use client';

import { useRef, useState, useTransition } from 'react';
import { askForesight, askForesightByVoice, type AskOutcome } from './actions';

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 60;

/** Float32 samples at `from` Hz → 16-bit little-endian mono PCM at 16 kHz. */
export function toPcm16(samples: Float32Array, from: number): Uint8Array {
  const ratio = from / SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new DataView(new ArrayBuffer(length * 2));
  for (let index = 0; index < length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[Math.floor(index * ratio)] ?? 0));
    out.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

const base64 = (bytes: Uint8Array) => {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
};

/**
 * Ask Foresight a question by text or voice (T-073). The microphone is used
 * only while recording; audio goes to the server once, is transcribed there
 * and discarded. Answers name the trends and assumptions they rely on.
 */
export function AskForesight({ dealId, lines, voice }: { dealId: string; lines: { id: string | null; name: string }[]; voice: { speechToText: boolean; textToSpeech: boolean } }) {
  const [scenarioId, setScenarioId] = useState<string>('');
  const [speak, setSpeak] = useState(false);
  const [outcome, setOutcome] = useState<AskOutcome | null>(null);
  const [recording, setRecording] = useState(false);
  const [pending, startTransition] = useTransition();
  const stop = useRef<(() => void) | null>(null);

  const show = (result: AskOutcome) => {
    setOutcome(result);
    if (result.ok && result.answer.audio) void new Audio(`data:audio/mpeg;base64,${result.answer.audio}`).play().catch(() => undefined);
  };

  const ask = (form: FormData) =>
    startTransition(async () => show(await askForesight(dealId, { question: String(form.get('question') ?? ''), scenarioId: scenarioId || null, speak })));

  const record = async () => {
    if (recording) {
      stop.current?.();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setOutcome({ ok: false, message: 'The microphone is not available. Allow it in the browser, or type the question.' });
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(context.destination);
    setRecording(true);
    const timer = setTimeout(() => stop.current?.(), MAX_SECONDS * 1000);
    stop.current = () => {
      clearTimeout(timer);
      stop.current = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      const pcm = toPcm16(samples, context.sampleRate);
      void context.close();
      setRecording(false);
      startTransition(async () => show(await askForesightByVoice(dealId, { audio: base64(pcm), sampleRate: SAMPLE_RATE, scenarioId: scenarioId || null, speak })));
    };
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <form action={ask} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 font-medium">
          Ask about the trends and the projected value
          <input name="question" required minLength={3} maxLength={1000} placeholder="What happens to the exit value if rates stay high?" className="rounded-md border border-border bg-background px-3 py-2" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Against
            <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1" aria-label="Scenario to ask against">
              {lines.map((line) => (
                <option key={line.id ?? 'baseline'} value={line.id ?? ''}>
                  {line.name}
                </option>
              ))}
            </select>
          </label>
          {voice.textToSpeech ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={speak} onChange={(event) => setSpeak(event.target.checked)} /> Speak the answer
            </label>
          ) : null}
          <button type="submit" disabled={pending} className="rounded-md bg-indigo px-3 py-1.5 font-semibold text-navy">
            {pending ? 'Thinking…' : 'Ask'}
          </button>
          {voice.speechToText ? (
            <button type="button" onClick={() => void record()} disabled={pending} className="rounded-md border border-border px-3 py-1.5" aria-pressed={recording}>
              {recording ? 'Stop and ask' : 'Ask by voice'}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Voice is not available here; typing works.</span>
          )}
        </div>
      </form>
      {outcome ? (
        outcome.ok ? (
          <div role="status" className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-xs text-muted-foreground">You asked: “{outcome.answer.question}”</span>
            <p>{outcome.answer.answer}</p>
            <span className="text-xs text-muted-foreground">Relies on: {outcome.answer.reliesOn.join(', ')}</span>
          </div>
        ) : (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">{outcome.message}</p>
        )
      ) : null}
    </div>
  );
}
