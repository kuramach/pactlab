import type { SupportChatTurn } from '@pactlab/contracts';

/** The conversation as plain text for the team's email; visitors' words, never pact data (the chat has none). */
export function transcriptText(turns: readonly SupportChatTurn[]): string {
  if (turns.length === 0) return '(no earlier messages)';
  return turns.map((turn) => `${turn.role === 'user' ? 'Visitor' : 'Assistant'}: ${turn.text.replace(/\s+/g, ' ').trim()}`).join('\n');
}
