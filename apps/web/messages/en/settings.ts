/** Settings → Language (T-172). */
export const settings = {
  language: {
    title: 'Language',
    description: 'The language Pactlab shows you. Amounts stay in each pact’s own currency; only how they are written changes.',
    label: 'Language',
    save: 'Save language',
    saved: 'Language saved.',
    pilot: 'German covers the pact home and Findings so far; other screens are still in English.',
  },
  /** Your profile → LINE (T-182). */
  line: {
    title: 'LINE',
    description: 'Free. Pactlab messages you on LINE when a pact needs you, with no deal details, only a link. Sign in with LINE, then add Pactlab as a friend.',
    connected: 'Connected',
    verified: 'Verified',
    since: 'since {date}',
    test: 'Send a test message',
    disconnect: 'Disconnect LINE',
    disconnectHint: 'You can also disconnect from LINE: send STOP to Pactlab, or block it.',
    connect: 'Connect LINE',
    connectHint: 'Opens LINE Login. After you agree, LINE offers to add Pactlab as a friend: messages reach you only once you have.',
    pendingTitle: 'One step left: add Pactlab as a friend on LINE.',
    pendingHint: 'You are connected as soon as you add it. If you skipped the screen, open the link, or connect again.',
    addFriend: 'Add Pactlab on LINE',
    off: 'LINE is not set up on this Pactlab yet.',
  },
  /** Operator console → Health → LINE (T-182). */
  lineUsage: {
    summary: 'LINE this month ({month}): {sent} of {allowance} free messages sent.',
    reached: 'Sends have stopped until next month; people still get email.',
    off: 'LINE is not set up on this Pactlab.',
  },
};
