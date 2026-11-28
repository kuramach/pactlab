import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import type { CitableSource } from './context';
import { TransportClaudeGateway, type AiRunRecord, type GatewayRequest } from './gateway';
import { evaluatedLanguagesOf, MODEL_LANGUAGE_EVALUATIONS, resolveOutputLanguage, withOutputLanguage } from './languages';
import { defaultPromptRegistry, documentQaPrompt } from './prompts';
import { ScriptedModelTransport } from './transport';

const page: CitableSource = {
  citationId: newId(),
  documentId: newId(),
  documentName: 'MSA.txt',
  pageNumber: 1,
  text: 'Either party may terminate on a change of control of the other party.',
  classification: 'BUSINESS',
};
const answer = JSON.stringify({
  unanswerable: false,
  answer: 'Ja.',
  claims: [{ statement: 'Kontrollwechsel erlaubt Kündigung.', citations: [{ citationId: page.citationId, quote: 'terminate on a change of control' }] }],
});
const request = (outputLanguage?: GatewayRequest['outputLanguage']): GatewayRequest => ({
  organizationId: newId(),
  dealId: newId(),
  inputs: [{ classification: 'BUSINESS', text: 'Gibt es eine Kontrollwechselklausel?', name: 'question' }],
  sources: [page],
  ...(outputLanguage ? { outputLanguage } : {}),
});

function gateway(evaluatedLanguages?: (modelId: string) => readonly ('en' | 'de' | 'fr' | 'ja')[]) {
  const transport = new ScriptedModelTransport(() => answer);
  const runs: AiRunRecord[] = [];
  const instance = new TransportClaudeGateway({ transport, registry: defaultPromptRegistry(), onRun: (run) => void runs.push(run), ...(evaluatedLanguages ? { evaluatedLanguages } : {}) });
  return { instance, transport, runs };
}

describe('output language (T-174)', () => {
  it('every serving model is evaluated in English only until an evaluation says otherwise', () => {
    expect(MODEL_LANGUAGE_EVALUATIONS).toEqual({});
    expect(evaluatedLanguagesOf('us.anthropic.claude-sonnet-5-5')).toEqual(['en']);
    expect(evaluatedLanguagesOf('m', { m: ['ja'] })).toEqual(['en', 'ja']);
  });

  it('an evaluated language is written as asked; an unevaluated one falls back to English, labelled', () => {
    expect(resolveOutputLanguage('de', ['en', 'de'])).toEqual({ requested: 'de', written: 'de', fallback: false, label: null });
    const fallback = resolveOutputLanguage('ja', ['en']);
    expect(fallback).toMatchObject({ requested: 'ja', written: 'en', fallback: true });
    expect(fallback.label).toContain('not yet evaluated in Japanese');
  });

  it('adds the language instruction only when writing in a language other than English', () => {
    expect(withOutputLanguage('SYSTEM', 'en')).toBe('SYSTEM');
    expect(withOutputLanguage('SYSTEM', 'de')).toContain('in German');
    expect(withOutputLanguage('SYSTEM', 'de')).toContain('quotes exactly as given');
  });

  it('records the language on the run and writes in it on a model evaluated in it', async () => {
    const { instance, transport, runs } = gateway(() => ['en', 'de']);
    await instance.invoke(documentQaPrompt, request('de'));
    expect(runs[0]?.outputLanguage).toEqual({ requested: 'de', written: 'de', fallback: false, label: null });
    expect(transport.requests[0]?.system).toContain('in German');
  });

  it('on an unevaluated model the job runs in English and the run says it fell back', async () => {
    const { instance, transport, runs } = gateway();
    await instance.invoke(documentQaPrompt, request('ja'));
    expect(runs[0]?.outputLanguage).toMatchObject({ requested: 'ja', written: 'en', fallback: true });
    expect(transport.requests[0]?.system).not.toContain('Japanese');
  });

  it('a job that names no language records none and its prompt is unchanged', async () => {
    const { instance, transport, runs } = gateway();
    await instance.invoke(documentQaPrompt, request());
    expect(runs[0]?.outputLanguage).toBeUndefined();
    expect(transport.requests[0]?.system).toBe(documentQaPrompt.system);
  });
});
