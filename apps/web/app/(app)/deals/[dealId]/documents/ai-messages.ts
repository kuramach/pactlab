/** Why AI could not run, from the API's stable reason code. */
export function aiOutcome(code: string | undefined): 'ai-access' | 'ai-throttled' | 'ai-delayed' | 'ai-failed' | 'ai-off' {
  return code === 'AI_ACCESS' ? 'ai-access' : code === 'AI_THROTTLED' ? 'ai-throttled' : code === 'AI_DELAYED' ? 'ai-delayed' : code === 'AI_UNAVAILABLE' ? 'ai-failed' : 'ai-off';
}

/** Plain-language reasons AI is unavailable; shared with the page's outcome banner. */
export const AI_UNAVAILABLE: Readonly<Record<'ai-access' | 'ai-throttled' | 'ai-delayed' | 'ai-failed' | 'ai-off', string>> = {
  'ai-access':
    'AI is unavailable: Claude access was refused for this environment (an expired sign-in, or model access switched off for the account). An operator needs to restore it. Uploads still work; run AI on these files again once it’s back.',
  'ai-throttled': 'AI is busy (the model provider is rate-limiting requests). Try again in a minute. Nothing was drafted.',
  'ai-delayed': 'AI is delayed: the model provider had repeated outages, so calls are paused for a short while. Nothing was drafted — try again in a few minutes. Everything else keeps working.',
  'ai-failed': 'The model call failed or timed out. Nothing was drafted — try again in a moment.',
  'ai-off': 'AI is not switched on for this environment yet. Drafts will appear once the Claude connection is enabled.',
};
