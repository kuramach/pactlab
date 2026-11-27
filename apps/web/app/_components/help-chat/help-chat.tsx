'use client';

import type { SupportChatHandoff, SupportChatLocale, SupportChatReplyView, SupportChatTurn } from '@pactlab/contracts';
import { Button } from '@pactlab/ui';
import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import type { HelpAsk, HelpAskResult, HelpHandoffResult } from './actions';
import { HELP_LABELS, type HelpLabels } from './labels';

export type HelpSurface = 'SITE' | 'APP';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  reply?: SupportChatReplyView;
}

/** A random conversation id: the API's rate-limit key for this panel. Nothing else identifies the visitor. */
function newSessionId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/** What the assistant said, its sources, its steps and its link; shared by both surfaces. */
export function HelpReply({ reply, labels }: { reply: SupportChatReplyView; labels: HelpLabels }) {
  return (
    <div className="flex flex-col gap-2" data-reply-kind={reply.kind}>
      {reply.localeNote ? <p className="text-xs italic text-muted-foreground">{reply.localeNote}</p> : null}
      <p className="whitespace-pre-line">{reply.text}</p>
      {reply.steps.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {reply.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {reply.deepLink ? (
        <a href={reply.deepLink.href} className="font-semibold text-indigo-ink underline">
          {reply.deepLink.label}
        </a>
      ) : null}
      {reply.citations.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {labels.sources}:{' '}
          {reply.citations.map((citation, index) => (
            <span key={citation.href + citation.title}>
              {index > 0 ? ' · ' : null}
              <a href={citation.href} className="underline" {...(citation.href.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {citation.title}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

const HANDOFF_TEXT = (labels: HelpLabels, result: HelpHandoffResult, feature: boolean) =>
  result.kind === 'sent' ? (feature ? labels.logged : labels.sent) : result.kind === 'email-required' ? labels.emailRequired : result.kind === 'limited' ? labels.limited : result.kind === 'unavailable' ? labels.unavailable : labels.failed;

/** The confirm step before anything leaves the chat: a question for the team, or a feature request to log. */
function Handoff({ reply, question, surface, labels, onSend }: { reply: SupportChatReplyView; question: string; surface: HelpSurface; labels: HelpLabels; onSend: (kind: SupportChatHandoff['kind'], summary: string, email: string | undefined) => Promise<HelpHandoffResult> }) {
  const feature = reply.featureRequest !== null;
  const [open, setOpen] = useState(feature);
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<HelpHandoffResult | null>(null);
  const [declined, setDeclined] = useState(false);
  const [pending, start] = useTransition();
  if (declined) return null;
  if (result?.kind === 'sent') return <p className="text-xs font-semibold text-emerald-800">{HANDOFF_TEXT(labels, result, feature)}</p>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(async () => setResult(await onSend(feature ? 'FEATURE_REQUEST' : 'QUESTION', feature ? (reply.featureRequest?.summary ?? question) : question, email.trim() || undefined)));
  };
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {labels.emailOffer}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {surface === 'SITE' ? (
        <label className="flex flex-col gap-1 text-xs font-medium">
          {labels.emailLabel}
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-sm" autoComplete="email" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {feature ? labels.logIt : labels.emailSend}
        </Button>
        {feature ? (
          <Button size="sm" variant="outline" type="button" onClick={() => setDeclined(true)}>
            {labels.noThanks}
          </Button>
        ) : null}
      </div>
      {result ? (
        <p role="alert" className="text-xs text-red-800">
          {HANDOFF_TEXT(labels, result, feature)}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The product-help chat panel (T-175), the same on the public site and in the app. It answers from Pactlab’s
 * published guides only and never sees pact data; the conversation stays in this panel.
 */
export function HelpChat({
  surface,
  locale,
  page,
  ask,
  handOff,
  onClose,
}: {
  surface: HelpSurface;
  locale: SupportChatLocale;
  page: string;
  ask: (message: HelpAsk) => Promise<HelpAskResult>;
  handOff: (handoff: SupportChatHandoff) => Promise<HelpHandoffResult>;
  onClose?: () => void;
}) {
  const labels = HELP_LABELS[locale];
  const sessionId = useMemo(newSessionId, []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);
  const history = (all: Turn[]): SupportChatTurn[] => all.slice(-10).map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2000) }));

  const send = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;
    const before = turns;
    setTurns([...before, { role: 'user', text: question }]);
    setDraft('');
    setFailed(false);
    start(async () => {
      const result = await ask({ locale, page, question: question.slice(0, 1000), history: history(before), sessionId });
      if (result.kind === 'ok') setTurns((current) => [...current, { role: 'assistant', text: result.reply.text, reply: result.reply }]);
      else setFailed(true);
      list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    });
  };
  const questionBefore = (index: number) => [...turns.slice(0, index)].reverse().find((turn) => turn.role === 'user')?.text ?? '';

  return (
    <section aria-label={labels.title} className="flex h-full flex-col gap-3 text-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold">{labels.title}</h2>
          <p className="text-xs text-muted-foreground">{labels.intro}</p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" aria-label={labels.close} onClick={onClose}>
            ✕
          </Button>
        ) : null}
      </header>
      <ol ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {turns.map((turn, index) => (
          <li key={`${index}-${turn.role}`} className={turn.role === 'user' ? 'self-end rounded-lg bg-indigo/10 px-3 py-2' : 'rounded-lg bg-muted px-3 py-2'}>
            {turn.reply ? (
              <div className="flex flex-col gap-2">
                <HelpReply reply={turn.reply} labels={labels} />
                {turn.reply.offerEmail || turn.reply.featureRequest ? (
                  <Handoff
                    reply={turn.reply}
                    question={questionBefore(index)}
                    surface={surface}
                    labels={labels}
                    onSend={(kind, summary, email) => handOff({ kind, confirmed: true, summary: summary.slice(0, 500), locale, page, sessionId, transcript: history(turns.slice(0, index + 1)), ...(email ? { email } : {}) })}
                  />
                ) : null}
              </div>
            ) : (
              <p className="whitespace-pre-line">{turn.text}</p>
            )}
          </li>
        ))}
        {pending ? <li className="text-xs text-muted-foreground">{labels.sending}</li> : null}
        {failed ? (
          <li role="alert" className="text-xs text-red-800">
            {labels.failed}
          </li>
        ) : null}
      </ol>
      <form onSubmit={send} className="flex gap-2">
        <input
          aria-label={labels.title}
          value={draft}
          maxLength={1000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={labels.placeholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2"
        />
        <Button type="submit" disabled={pending || !draft.trim()}>
          {labels.send}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">{labels.noPactData}</p>
    </section>
  );
}
