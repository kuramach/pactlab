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
    description: 'For Japan. Pactlab messages you on LINE when a pact needs you, with no deal details, only a link. Messages arrive in English and Japanese.',
    connected: 'Connected',
    verified: 'Verified',
    since: 'since {date}',
    test: 'Send a test message',
    disconnect: 'Disconnect LINE',
    disconnectHint: 'You can also disconnect from LINE itself: block the Pactlab account.',
    connect: 'Connect LINE',
    connectHint: 'Sign in with LINE, then add the Pactlab account as a friend. Both steps are needed; the sign-in works once, for 10 minutes.',
    off: 'LINE is not set up on this Pactlab yet.',
    addFriendTitle: 'One more step: add Pactlab as a friend',
    addFriendBody: 'LINE only delivers messages to friends. Add the Pactlab account within 15 minutes and LINE is connected.',
    addFriend: 'Add Pactlab on LINE',
    allowanceNote: 'Pactlab sends a limited number of LINE messages each month. If that is reached, you still get the email.',
    admin: {
      reached: 'LINE monthly allowance reached',
      reachedBody: 'LINE messages are held until next month; the people they were for still got the email. A paid LINE plan needs Kumar’s approval first (runbook: contact channels).',
      summary: 'LINE this month: {used} of {allowance} messages used (LINE’s count) · {sent} sent · {heldBack} held back · {failed} failed',
      unreadable: 'LINE this month: LINE could not be asked how many messages were used, so LINE sends are held · {sent} sent · {heldBack} held back',
    },
    done: {
      connected: 'LINE is connected.',
    },
    errors: {
      LINE_OFF: 'LINE is not set up on this Pactlab yet.',
      LINE_CANCELLED: 'LINE sign-in was cancelled. Nothing was connected.',
      LINE_LOGIN_FAILED: 'LINE sign-in did not complete. Try again.',
      LINE_LINK_EXPIRED: 'That LINE sign-in has expired or was already used. Start again with Connect LINE.',
      LINE_ALLOWANCE_REACHED: 'Pactlab has sent this month’s LINE messages, so the test was not sent. You still get notifications by email.',
    },
  },
};
