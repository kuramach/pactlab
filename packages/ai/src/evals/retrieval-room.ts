/**
 * The retrieval eval set (T-139): a synthetic data room well over the context budget, and questions whose
 * answer pages are known. Generated, deterministic, synthetic only: never customer data, and no HR,
 * compensation, performance or named-contribution content. Half the questions use the documents' own words;
 * half are paraphrased the way a deal team asks ("can they walk away if we buy them?"), which is where keyword
 * search is expected to struggle and the case for vectors would show.
 */

export interface RetrievalRoomDocument {
  readonly fileName: string;
  readonly pages: readonly string[];
}

export interface RetrievalQuestion {
  readonly id: string;
  readonly kind: 'KEYWORD' | 'PARAPHRASE';
  readonly question: string;
  readonly answer: { readonly fileName: string; readonly pageNumber: number; readonly quote: string };
}

/** Boilerplate a real agreement repeats: it shares the legal vocabulary of every answer, so answers must outrank it. */
const BOILERPLATE: readonly [string, ...string[]] = [
  'Each party shall perform its obligations under this Agreement in a professional and workmanlike manner.',
  'All notices under this Agreement shall be in writing and delivered to the addresses set out in the Order Form.',
  'Invoices are payable within thirty days of the invoice date unless the Order Form states otherwise.',
  'Either party may terminate this Agreement for material breach that remains uncured thirty days after written notice.',
  'Confidential Information shall be used only to perform this Agreement and shall be protected with reasonable care.',
  'The Services shall be provided in accordance with the service levels described in the applicable schedule.',
  'No waiver of any provision of this Agreement shall be effective unless made in writing and signed by both parties.',
  'If any provision of this Agreement is held invalid, the remaining provisions shall continue in full force and effect.',
  'The parties are independent contractors and nothing in this Agreement creates a partnership or joint venture.',
  'Change requests to the scope of the Services are handled by the project steering committee described in Schedule 2.',
  'Each party shall comply with all laws applicable to its performance of this Agreement.',
  'The Supplier shall maintain insurance with reputable insurers in amounts customary for a business of its size.',
  'Records relating to the fees shall be kept for six years and made available for audit on reasonable notice.',
  'Neither party is liable for delay caused by events beyond its reasonable control, including flood, fire or strike.',
  'This Agreement, with its schedules, is the entire agreement between the parties on its subject matter.',
  'Headings are for convenience only and do not affect the interpretation of this Agreement.',
  'The Customer shall provide timely access to the information and facilities the Supplier reasonably needs.',
  'Acceptance testing of each deliverable shall be completed within ten business days of delivery.',
  'Personal data processed under this Agreement is subject to the data processing addendum attached as Schedule 4.',
  'Disputes about invoices shall be raised in good faith within fifteen days, and the undisputed amount shall be paid.',
  'The Supplier may use subcontractors, and remains responsible for their performance under this Agreement.',
  'Service credits are the Customer’s sole remedy for a failure to meet the service levels.',
  'Each party warrants that it has the authority to enter into and perform this Agreement.',
  'The term of this Agreement begins on the Effective Date and continues for the period stated in the Order Form.',
  'Amendments to this Agreement must be in writing and signed by authorised representatives of both parties.',
  'Clauses that by their nature survive termination, including confidentiality and payment, shall survive.',
  'The Customer may request reasonable reports on the use of the Services once each calendar quarter.',
  'Security incidents affecting Customer data shall be notified without undue delay after the Supplier becomes aware.',
  'Equipment supplied by the Supplier remains its property and shall be returned at the end of the term.',
  'Training on the Services is available at the rates in the Supplier’s current price list.',
];

const pick = <T>(list: readonly [T, ...T[]], index: number): T => list[index % list.length] ?? list[0];

const KINDS: readonly [string, ...string[]] = ['Master subscription agreement', 'Reseller agreement', 'Hosting agreement', 'Supply agreement', 'Services agreement', 'Licence agreement'];
const COUNTERPARTIES: readonly [string, ...string[]] = ['Northwind Retail', 'Bluefin Logistics', 'Cedar Health', 'Harbor Freight Partners', 'Juniper Media', 'Kestrel Energy', 'Lumen Grocers', 'Mariner Bank', 'Orchid Travel', 'Pinecrest Schools'];

/** The planted answers: [document index, page number, clause]. */
const ANSWERS = {
  changeOfControl: [7, 12, 'CHANGE OF CONTROL. If Vendor undergoes a Change of Control, Customer may terminate this Agreement upon sixty (60) days written notice without penalty.'],
  exclusivity: [3, 5, 'EXCLUSIVITY. Distributor shall be the exclusive reseller of the Products in the Territory, and Vendor shall not appoint any other reseller there.'],
  governingLaw: [21, 18, 'GOVERNING LAW. This Facility Agreement is governed by the laws of the State of New York, and the courts of New York have exclusive jurisdiction over any dispute.'],
  mfn: [30, 9, 'MOST FAVOURED NATION. If Vendor offers any other customer lower prices for comparable volumes, Vendor shall offer the same prices to Customer.'],
  liabilityCap: [42, 14, 'LIMITATION OF LIABILITY. The Supplier’s aggregate liability under this Agreement is capped at two times the annual fees paid in the preceding twelve months.'],
  assignment: [55, 9, '9. ASSIGNMENT. The Supplier may not assign or transfer this Agreement, in whole or in part, to any third party without the prior written consent of the Customer.'],
  indemnity: [13, 20, 'INTELLECTUAL PROPERTY INDEMNITY. Vendor shall indemnify and defend Customer against third-party claims alleging that the Software infringes their patents or copyrights.'],
  priceEscalator: [37, 6, 'FEE ADJUSTMENT. The fees increase by five percent on each anniversary of the Effective Date without further notice.'],
} as const;

/** Mulberry32: a seeded generator, so the room is the same on every run. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RETRIEVAL_ROOM = { documents: 60, pagesPerDocument: 25, pageChars: 1_600 } as const;

export function retrievalRoom(): { documents: RetrievalRoomDocument[]; questions: RetrievalQuestion[] } {
  const random = generator(139);
  const planted = new Map<string, string>(Object.values(ANSWERS).map(([doc, pageNumber, clause]) => [`${doc}:${pageNumber}`, clause]));
  const documents: RetrievalRoomDocument[] = [];
  for (let doc = 0; doc < RETRIEVAL_ROOM.documents; doc += 1) {
    const kind = pick(KINDS, doc);
    const counterparty = pick(COUNTERPARTIES, doc);
    const fileName = `${String(doc + 1).padStart(2, '0')} ${kind} - ${counterparty} (synthetic).txt`;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= RETRIEVAL_ROOM.pagesPerDocument; pageNumber += 1) {
      const lines = pageNumber === 1 ? [`${kind.toUpperCase()} between ${counterparty} (synthetic) and Example Vendor (synthetic).`] : [];
      const clause = planted.get(`${doc}:${pageNumber}`);
      while (lines.join(' ').length < RETRIEVAL_ROOM.pageChars) {
        if (clause && lines.length === 3) lines.push(clause);
        else lines.push(pick(BOILERPLATE, Math.floor(random() * BOILERPLATE.length)));
      }
      pages.push(lines.join(' '));
    }
    documents.push({ fileName, pages });
  }
  const answer = (key: keyof typeof ANSWERS) => {
    const [doc, pageNumber, clause] = ANSWERS[key];
    return { fileName: documents[doc]?.fileName ?? '', pageNumber, quote: clause };
  };
  const questions: RetrievalQuestion[] = [
    { id: 'coc', kind: 'KEYWORD', question: 'Which agreements let the customer terminate on a change of control?', answer: answer('changeOfControl') },
    { id: 'exclusivity', kind: 'KEYWORD', question: 'Is any reseller exclusive in its territory?', answer: answer('exclusivity') },
    { id: 'law', kind: 'KEYWORD', question: 'What is the governing law of the facility agreement?', answer: answer('governingLaw') },
    { id: 'mfn', kind: 'KEYWORD', question: 'Is there a most favoured nation pricing clause?', answer: answer('mfn') },
    { id: 'cap', kind: 'KEYWORD', question: 'What is the supplier’s aggregate liability cap?', answer: answer('liabilityCap') },
    { id: 'section9', kind: 'KEYWORD', question: 'Section 9 assignment: may the supplier assign without consent?', answer: answer('assignment') },
    { id: 'walk-away', kind: 'PARAPHRASE', question: 'Can they walk away if we buy them?', answer: answer('changeOfControl') },
    { id: 'only-seller', kind: 'PARAPHRASE', question: 'Does one distributor stop us selling through anyone else in that region?', answer: answer('exclusivity') },
    { id: 'which-courts', kind: 'PARAPHRASE', question: 'Which courts would hear a fight over the loan?', answer: answer('governingLaw') },
    { id: 'best-price', kind: 'PARAPHRASE', question: 'Do they have to give us their best price?', answer: answer('mfn') },
    { id: 'hand-over', kind: 'PARAPHRASE', question: 'Can they hand the contract over to another company?', answer: answer('assignment') },
    { id: 'sued', kind: 'PARAPHRASE', question: 'Who pays if someone sues saying the software copies their invention?', answer: answer('indemnity') },
    { id: 'price-rise', kind: 'PARAPHRASE', question: 'Will the price go up automatically every year?', answer: answer('priceEscalator') },
  ];
  return { documents, questions };
}
