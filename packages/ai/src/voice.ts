import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';

/**
 * Voice for Foresight Q&A (T-073): speech in, text out, and text back to
 * speech — an interface over the same grounded Q&A, never a separate brain.
 * Audio is processed in memory and discarded; only transcripts are kept.
 */
export interface SpeechToText {
  readonly available: boolean;
  /** 16-bit little-endian mono PCM at `sampleRate` Hz. */
  transcribe(pcm: Uint8Array, sampleRate: number): Promise<string>;
}

export interface TextToSpeech {
  readonly available: boolean;
  /** MP3 bytes of the spoken text. */
  speak(text: string): Promise<Uint8Array>;
}

export class VoiceUnavailableError extends Error {
  constructor() {
    super('Voice is not available in this environment');
    this.name = 'VoiceUnavailableError';
  }
}

/** Where voice is not configured: typing still works. */
export const NO_SPEECH_TO_TEXT: SpeechToText = {
  available: false,
  transcribe: async () => {
    throw new VoiceUnavailableError();
  },
};
export const NO_TEXT_TO_SPEECH: TextToSpeech = {
  available: false,
  speak: async () => {
    throw new VoiceUnavailableError();
  },
};

const CHUNK_BYTES = 8 * 1024;

/** Amazon Transcribe streaming (the AWS default credential chain, like Bedrock). */
export class TranscribeSpeechToText implements SpeechToText {
  readonly available = true;
  private readonly client: TranscribeStreamingClient;

  constructor(region: string, private readonly languageCode: 'en-US' | 'en-GB' = 'en-US') {
    this.client = new TranscribeStreamingClient({ region });
  }

  async transcribe(pcm: Uint8Array, sampleRate: number): Promise<string> {
    async function* audio() {
      for (let offset = 0; offset < pcm.byteLength; offset += CHUNK_BYTES) {
        yield { AudioEvent: { AudioChunk: pcm.subarray(offset, offset + CHUNK_BYTES) } };
      }
    }
    const response = await this.client.send(
      new StartStreamTranscriptionCommand({ LanguageCode: this.languageCode, MediaEncoding: 'pcm', MediaSampleRateHertz: sampleRate, AudioStream: audio() }),
    );
    const parts: string[] = [];
    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        if (result.IsPartial) continue;
        const text = result.Alternatives?.[0]?.Transcript;
        if (text) parts.push(text);
      }
    }
    return parts.join(' ').trim();
  }
}

/** Amazon Polly (neural voice, MP3). */
export class PollyTextToSpeech implements TextToSpeech {
  readonly available = true;
  private readonly client: PollyClient;

  constructor(region: string, private readonly voiceId: 'Joanna' | 'Matthew' | 'Amy' = 'Joanna') {
    this.client = new PollyClient({ region });
  }

  async speak(text: string): Promise<Uint8Array> {
    const response = await this.client.send(new SynthesizeSpeechCommand({ Engine: 'neural', OutputFormat: 'mp3', Text: text.slice(0, 2900), VoiceId: this.voiceId }));
    if (!response.AudioStream) throw new Error('Polly returned no audio');
    return response.AudioStream.transformToByteArray();
  }
}
