import type { HelpArticle } from './corpus';

/**
 * In-app help and steps (T-175): how each screen works, in the words its buttons and headings use.
 * When a screen's wording changes, change its steps here; steps mode answers from nothing else.
 * Every article is about the product, never about a particular pact.
 */
export const APP_HELP: readonly HelpArticle[] = [
  {
    id: 'app-help:map-an-import',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Importing a spreadsheet and mapping its columns',
    url: '/deals/:dealId/sources/upload',
    text:
      'Imports turn a seller’s spreadsheet (billing export, rent roll, P&L, loan tape or another extract) into records Pactlab can calculate from. The AI proposes how the sheet is laid out — the header row, which column feeds each field, what each statement line is — and you confirm it. Code reads every value from the cells; the AI never supplies a number. Importing the same file and mapping twice changes nothing, and a confirmed layout is saved and reused for the next file laid out the same way.',
    steps: [
      'Open the pact, go to Sources, and choose the upload for the data you have (for example "Upload and map columns" under the billing or industry data).',
      'Under "Choose the file", drop a CSV, TSV or Excel file (up to 50 MB). You can add instructions for the AI about the sheet, then select "Upload and map columns".',
      'In "2. Map columns", check the column chosen for each field. A suggested mapping is marked; answer any question Pactlab asks before you go on.',
      'Select "Check every row". The "3. Validation report" shows how many rows are ready and which will be skipped. Nothing has been imported yet.',
      'Select "Import" (it shows how many rows will be imported). The metrics the data feeds appear on Finances.',
    ],
    deepLink: { label: 'Open the import page', path: '/deals/:dealId/sources/upload' },
    routes: ['/deals/:dealId/sources', '/deals/:dealId/sources/upload', '/deals/:dealId/sources/upload/:uploadId'],
    audience: ['BUYER', 'SELLER'],
  },
  {
    id: 'app-help:upload-documents',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Uploading documents to a pact',
    url: '/deals/:dealId/documents',
    text:
      'Documents holds the pact’s files: agreements, statements, decks and scans. Pactlab reads what each file is and files it; when it is unsure it asks you ("Pactlab needs you") instead of guessing. You can upload many files at once or one zip, or connect a Google Drive or OneDrive folder.',
    steps: [
      'Open the pact and go to Documents.',
      'Drop files (or one zip) on the upload area, or choose them, then select "Upload".',
      'Watch each file’s status: "Reading what it is…", then "Filed". A file marked "Pactlab needs you" waits for you to choose what it is.',
      'Open a filed document to see its pages; AI drafts from it appear as draft findings for a person to review.',
    ],
    deepLink: { label: 'Open Documents', path: '/deals/:dealId/documents' },
    routes: ['/deals/:dealId/documents'],
    audience: ['BUYER', 'SELLER'],
  },
  {
    id: 'app-help:ask-documents',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Asking questions of a pact’s documents',
    url: '/deals/:dealId/documents',
    text:
      'On Documents, "Ask these documents" answers a question from the pact’s own pages, and every statement in the answer cites the page it came from. If no cited answer is found it says so. In a large data room it says which pages it read, and you can narrow the question to chosen documents. This help assistant cannot see any documents; use "Ask these documents" inside the pact for that.',
    steps: [
      'Open the pact and go to Documents.',
      'Type your question in "Ask these documents" and send it.',
      'Open the citations to check each statement against its page.',
      'If the answer says it read only some pages, choose "Narrow the question to chosen documents".',
    ],
    deepLink: { label: 'Open Documents', path: '/deals/:dealId/documents' },
    routes: ['/deals/:dealId/documents'],
    audience: ['BUYER'],
  },
  {
    id: 'app-help:review-a-finding',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Reviewing a finding',
    url: '/deals/:dealId/findings',
    text:
      'Findings are drafts until a person decides. A finding shows its evidence, its direction (whether it moves value) and, for a risk, its priced range. Accepting or rejecting needs a short rationale, saved in the audit trail with your name. A deal lead or reviewer makes the decision.',
    steps: [
      'Open the pact and go to Findings, then open a finding.',
      'Read its Evidence and open each citation.',
      'Set the Direction, and for a risk the Priced risk, if they are not set.',
      'Under Decision, write a short rationale and accept or reject it, or ask for more support.',
    ],
    deepLink: { label: 'Open Findings', path: '/deals/:dealId/findings' },
    routes: ['/deals/:dealId/findings', '/deals/:dealId/findings/:findingId'],
    audience: ['BUYER'],
  },
  {
    id: 'app-help:valuation-scenario',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Running a valuation scenario',
    url: '/deals/:dealId/valuation',
    text:
      'Valuation runs deterministic scenarios from stored inputs: the methods the pact’s industry offers (for example ARR multiple, DCF, or NOI over a capitalization rate), with sensitivities and a purchase-price bridge. Accepted, priced findings reach the bridge as adjustments. The model never sets a price; the numbers come from versioned code.',
    steps: [
      'Open the pact and go to Valuation.',
      'Start a new scenario and choose the method.',
      'Enter or confirm the inputs; revenue and EBITDA start from an imported P&L where there is one.',
      'Link the accepted findings that should adjust the price, then run it and read the bridge.',
    ],
    deepLink: { label: 'Open Valuation', path: '/deals/:dealId/valuation' },
    routes: ['/deals/:dealId/valuation', '/deals/:dealId/valuation/new'],
    audience: ['BUYER'],
  },
  {
    id: 'app-help:invite-people',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Inviting people to a pact',
    url: '/deals/:dealId/team',
    text:
      'The pact’s Team page lists who is on it. Only the deal lead can change the team. A colleague in your organization is added directly; someone from another party (the seller, an advisor) is invited by email to this pact only, on the buying side or the seller side, and never joins your organization.',
    steps: [
      'Open the pact and go to Team.',
      'To add someone from your organization, use "Add a colleague".',
      'To bring in another party, use "Invite by email": enter the address and choose a side and role.',
      'The invitation link works once and expires; you can withdraw it from the same page.',
    ],
    deepLink: { label: 'Open Team', path: '/deals/:dealId/team' },
    routes: ['/deals/:dealId/team'],
    audience: ['BUYER', 'ADMIN'],
  },
  {
    id: 'app-help:start-a-pact',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Starting a pact',
    url: '/pacts/new',
    text:
      'A pact is one deal. "Start a Pact" sets who the parties are, the seller’s company type (which picks the industry pack: its imports, checks and valuation methods) and the pact’s currency, which is set once.',
    steps: ['In the sidebar, choose "Start a Pact".', 'Name the parties and choose the seller’s company type.', 'Choose the pact’s currency, then create it. Its Sources page then lists what to bring in.'],
    deepLink: { label: 'Start a Pact', path: '/pacts/new' },
    routes: ['/pacts/new', '/deals'],
    audience: ['BUYER', 'ADMIN'],
  },
  {
    id: 'app-help:report-a-bug',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'Reporting a problem',
    url: '/',
    text:
      'The "Report a bug" button at the bottom of every page sends the Pactlab team a report with a masked screenshot of the app view; password fields and private elements are left out. Serious errors are also reported automatically. You can see your own reports’ status.',
    steps: ['Select "Report a bug" at the bottom of the page.', 'Say what you were doing; the screenshot is attached with private fields masked.', 'Send it. You get a reference you can quote.'],
    audience: ['BUYER', 'SELLER', 'ADMIN'],
  },
  {
    id: 'app-help:whats-new',
    kind: 'APP_HELP',
    locale: 'en',
    title: 'What’s new cards',
    url: '/',
    text: 'New features show as cards on the home page. Dismissing a card moves it behind the icon next to the bug icon, where you can read it again.',
    audience: ['BUYER', 'SELLER', 'ADMIN'],
  },
];
