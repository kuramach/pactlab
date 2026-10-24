/** Why AI could not run, from the API's stable reason code. */
export function aiOutcome(code: string | undefined): 'ai-access' | 'ai-throttled' | 'ai-failed' | 'ai-off' {
  return code === 'AI_ACCESS' ? 'ai-access' : code === 'AI_THROTTLED' ? 'ai-throttled' : code === 'AI_UNAVAILABLE' ? 'ai-failed' : 'ai-off';
}

/** Plain-language reasons AI is unavailable; shared with the page's outcome banner. */
export const AI_UNAVAILABLE: Readonly<Record<'ai-access' | 'ai-throttled' | 'ai-failed' | 'ai-off', string>> = {
  'ai-access':
    'AI is unavailable: this environment’s AWS sign-in has expired or was refused. An operator needs to sign in again (aws login), then try again. Nothing was drafted.',
  'ai-throttled': 'AI is busy (the model provider is rate-limiting requests). Try again in a minute. Nothing was drafted.',
  'ai-failed': 'The model call failed or timed out. Nothing was drafted — try again in a moment.',
  'ai-off': 'AI is not switched on for this environment yet. Drafts will appear once the Claude connection is enabled.',
};
