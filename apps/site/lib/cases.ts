/**
 * The failed-deal case library, public pages (T-092). Each published case
 * tells what really happened — from court rulings, regulator filings, company
 * filings and reputable reporting, every factual sentence citing its source —
 * and how Pactlab is set up to surface each defect. That mapping is stated as
 * design intent, never as a claim that Pactlab was involved or would have
 * changed the outcome. Anything still in litigation is framed as an
 * allegation, with the date of its status.
 */

export interface CaseSource {
  readonly id: number;
  readonly title: string;
  readonly publisher: string;
  readonly date: string;
  readonly url: string;
}

/** A sentence or two of fact, and the sources it rests on. */
export interface CitedFact {
  readonly text: string;
  readonly sources: readonly number[];
}

export interface CaseDefect {
  readonly name: string;
  /** What the record shows, cited. */
  readonly record: CitedFact;
  /** The Pactlab check built for exactly this kind of failure. */
  readonly check: string;
  readonly phase: 'Pre-Diligence' | 'Diligence';
  readonly how: string;
  /** The product or pack page that explains the check. */
  readonly href: string;
}

export interface CaseStudy {
  readonly slug: string;
  readonly number: number;
  readonly title: string;
  /** The deal, the outcome and the failure in a phrase (the index line). */
  readonly line: string;
  readonly description: string;
  readonly deal: readonly CitedFact[];
  readonly defects: readonly CaseDefect[];
  /** Still-litigated matters, framed as allegations, with the date of this status. */
  readonly status: { readonly asOf: string; readonly facts: readonly CitedFact[] };
  readonly sources: readonly CaseSource[];
  /** The synthetic dataset a visitor can run. */
  readonly dataset: { readonly name: string; readonly href: string };
}

export const CASE_STUDIES: readonly CaseStudy[] = [
  {
    slug: 'kroger-albertsons',
    number: 1,
    title: 'Why did the Kroger–Albertsons merger fail?',
    line: 'Kroger / Albertsons (2022–2024): blocked by federal and state courts on the same day; the divestiture package did not answer the overlap.',
    description:
      'The anatomy of the Kroger–Albertsons grocery merger: a $24.6 billion deal blocked in December 2024, a divestiture package the court found insufficient, and the checks Pactlab is built to run on exactly these failure modes.',
    deal: [
      {
        text: 'On 14 October 2022 Kroger agreed to acquire Albertsons for about $24.6 billion including net debt — $34.10 per share in cash — combining two of the largest US supermarket operators.',
        sources: [1],
      },
      {
        text: 'The merger agreement bound both sides to "reasonable best efforts" to obtain clearance and treated divesting "in excess of 650 Stores" as a material divestment event; it set a $600,000,000 termination fee payable by Kroger in specified circumstances.',
        sources: [2],
      },
      {
        text: 'In September 2023 the parties agreed to sell 413 stores, banners and eight distribution centers to C&S Wholesale Grocers; on 22 April 2024 they expanded the package to 579 stores.',
        sources: [3, 4],
      },
    ],
    defects: [
      {
        name: 'Overlap in local markets',
        record: {
          text: 'On 26 February 2024 the FTC, joined by a bipartisan group of nine state attorneys general, sued to block the deal, alleging it would eliminate head-to-head competition between supermarkets that compete in local markets and raise prices.',
          sources: [5],
        },
        check: 'Local-market concentration screen',
        phase: 'Pre-Diligence',
        how: 'Computes HHI before and after the merger in every local market where the two footprints overlap, flags the markets that meet the 2023 Merger Guidelines presumption (HHI above 1,800 with a rise above 100, or a share above 30%), and names the markets where the two parties are the only full-service competitors — before any remedy exists.',
        href: '/how-it-works',
      },
      {
        name: 'Labor-market harm',
        record: {
          text: 'The FTC alleged that Kroger and Albertsons are the two largest employers of union grocery labor in the US, that they compete for those workers, and that the merger would erase that competition and weaken workers’ bargaining position.',
          sources: [5],
        },
        check: 'Labor exposure screen',
        phase: 'Pre-Diligence',
        how: 'Measures union density and shared bargaining agreements in the overlap markets, treating labor as a theory of harm in its own right rather than a footnote.',
        href: '/how-it-works',
      },
      {
        name: 'A remedy too small and set up to struggle',
        record: {
          text: 'Granting the FTC a preliminary injunction on 10 December 2024, the federal court in Oregon found "ample evidence that the divestiture is not sufficient in scale to adequately compete with the merged firm and is structured in a way that will significantly disadvantage C&S as a competitor." The package offered 579 stores against the 650-store level the agreement had contemplated.',
          sources: [6, 7, 2, 4],
        },
        check: 'Headroom and cherry-pick checks',
        phase: 'Diligence',
        how: 'Sets the package against the divestiture cap in the merger agreement and states the unused headroom in sites and percent; compares the performance of the divested sites with the sites the parties keep in the same markets, so a package skewed to weaker assets shows as a distribution, not an impression.',
        href: '/how-it-works',
      },
      {
        name: 'A patchwork, not a business',
        record: {
          text: 'The FTC described the proposal as a "hodgepodge" of stores, banners, brands and other assets that had been "cobbled together", to be run by a company with limited experience operating supermarkets.',
          sources: [8],
        },
        check: 'Package coherence score',
        phase: 'Diligence',
        how: 'Scores whether a package can stand alone as an operating business — shared distribution, systems, banners and regional clustering — with every input shown, so a team can see exactly what to change to move the score.',
        href: '/how-it-works',
      },
      {
        name: 'A remedy buyer without the operating record',
        record: {
          text: 'C&S, primarily a grocery wholesaler, operated 23 supermarkets at the time of the challenge. A decade earlier, Haggen — a chain of 18 stores — bought 146 stores divested in the Albertsons–Safeway merger and filed for bankruptcy in 2015.',
          sources: [8, 9],
        },
        check: 'Remedy-buyer viability',
        phase: 'Diligence',
        how: 'Assesses the divestiture buyer like any counterparty: its record running this business at this scale, and precedent flags where a prior remedy involving the same parties or the same kind of buyer failed.',
        href: '/how-it-works',
      },
      {
        name: 'A pledge that earned no credit',
        record: {
          text: 'Kroger pledged to invest $1 billion in lower prices; the federal court held that "the promise to make a price investment is not legally binding, and the court must give limited weight to a non-binding promise made during these proceedings."',
          sources: [10],
        },
        check: 'Commitment quality grading',
        phase: 'Diligence',
        how: 'Grades every pledge made to regulators or counterparties by measurement, enforcement and term; a pledge with none is marked unverifiable and kept out of any regulator-facing case.',
        href: '/how-it-works',
      },
      {
        name: 'Blocked twice in one day',
        record: {
          text: 'On 10 December 2024 the Oregon federal court preliminarily enjoined the merger and, the same day, King County Superior Court Judge Marshall Ferguson permanently enjoined it under Washington law. Kroger and Albertsons abandoned the deal; Kroger terminated the C&S agreement.',
          sources: [6, 11, 3],
        },
        check: 'Covenant and deal-certainty tracker',
        phase: 'Diligence',
        how: 'Tracks the agreement’s certainty terms as register items — efforts standard, divestiture cap, outside date, who pays which fee — with the deal’s age and the long-stop countdown always visible, and puts the termination-fee exposure and expected remedy cost into the valuation bridge as priced lines a reviewer confirms.',
        href: '/how-it-works',
      },
    ],
    status: {
      asOf: '28 October 2026',
      facts: [
        {
          text: 'Albertsons sued Kroger in the Delaware Court of Chancery, alleging that Kroger breached the merger agreement — including its efforts obligations — and seeking more than $9.3 billion, including the $600 million termination fee. Kroger disputes the claims and says it owes no termination fee because Albertsons did not comply with its own covenants.',
          sources: [3, 12],
        },
        {
          text: 'A bench trial before the Court of Chancery began on 19 October 2026. No ruling had been issued as of the date of this page; these remain allegations.',
          sources: [13],
        },
      ],
    },
    sources: [
      { id: 1, title: 'Kroger and Albertsons Companies Announce Definitive Merger Agreement', publisher: 'Albertsons Companies', date: '14 October 2022', url: 'https://www.albertsonscompanies.com/newsroom/press-releases/news-details/2022/Kroger-and-Albertsons-Companies-Announce-Definitive-Merger-Agreement/default.aspx' },
      { id: 2, title: 'Agreement and Plan of Merger (Exhibit 2.1 to Form 8-K), §6.3 and §8.4(d)', publisher: 'The Kroger Co., SEC EDGAR', date: '14 October 2022', url: 'https://www.sec.gov/Archives/edgar/data/56873/000110465922108671/tm2227942d1_ex2-1.htm' },
      { id: 3, title: 'Form 10-Q for the quarter ended 9 November 2024', publisher: 'The Kroger Co., SEC EDGAR', date: 'December 2024', url: 'https://www.sec.gov/Archives/edgar/data/56873/000155837024016233/kr-20241109x10q.htm' },
      { id: 4, title: 'Kroger and Albertsons announce updated divestiture plan with C&S (Exhibit 99.1 to Form 8-K)', publisher: 'The Kroger Co., SEC EDGAR', date: '22 April 2024', url: 'https://www.sec.gov/Archives/edgar/data/56873/000110465924049754/tm2412341d1_ex99-1.htm' },
      { id: 5, title: 'FTC Challenges Kroger’s Acquisition of Albertsons', publisher: 'Federal Trade Commission', date: '26 February 2024', url: 'https://www.ftc.gov/news-events/news/press-releases/2024/02/ftc-challenges-krogers-acquisition-albertsons' },
      { id: 6, title: 'Statement on FTC Victory Securing Halt to Kroger, Albertsons Grocery Merger', publisher: 'Federal Trade Commission', date: '10 December 2024', url: 'https://www.ftc.gov/news-events/news/press-releases/2024/12/statement-ftc-victory-securing-halt-kroger-albertsons-grocery-merger' },
      { id: 7, title: 'Kroger’s $24.6 Billion Albertsons Deal Blocked by Judges', publisher: 'Bloomberg Law', date: '10 December 2024', url: 'https://news.bloomberglaw.com/mergers-and-acquisitions/krogers-24-6-billion-albertsons-deal-blocked-by-federal-judge' },
      { id: 8, title: 'Issues at Check Out: FTC Challenges Kroger’s Acquisition of Albertsons with Novel Theories About Labor Market Harm and Adequate Remedies', publisher: 'Wilson Sonsini', date: 'March 2024', url: 'https://www.wsgr.com/en/insights/issues-at-check-out-ftc-challenges-krogers-acquisition-of-albertsons-with-novel-theories-about-labor-market-harm-and-adequate-remedies.html' },
      { id: 9, title: 'More than buyer must beware', publisher: 'The Daily Herald (Everett)', date: '14 December 2015', url: 'https://www.heraldnet.com/2015/12/14/more-than-buyer-must-beware/' },
      { id: 10, title: 'A federal judge temporarily halts the proposed supermarket merger of Kroger and Albertsons', publisher: 'Associated Press', date: '10 December 2024', url: 'https://www.news4jax.com/business/2024/12/10/a-federal-judge-temporarily-halts-the-proposed-supermarket-merger-of-kroger-and-albertsons/' },
      { id: 11, title: 'Judge blocks Kroger-Albertsons merger following AG Ferguson challenge', publisher: 'Washington State Office of the Attorney General', date: '10 December 2024', url: 'https://www.atg.wa.gov/news/news-releases/judge-blocks-kroger-albertsons-merger-following-ag-ferguson-challenge' },
      { id: 12, title: 'Albertsons Seeks More Than $9 Billion for Busted Kroger Deal', publisher: 'Bloomberg', date: '12 October 2026', url: 'https://www.bloomberg.com/news/articles/2026-10-12/albertsons-seeks-more-than-9-billion-over-busted-kroger-deal' },
      { id: 13, title: 'Albertsons Begins Its $8 Billion Trial Against Kroger Over Failed Merger', publisher: 'U.S. News & World Report (Reuters)', date: '19 October 2026', url: 'https://money.usnews.com/investing/news/articles/2026-10-19/albertsons-begins-its-8-billion-trial-against-kroger-over-failed-merger' },
    ],
    dataset: { name: 'Case 1: Meridian / Harvest Lane (synthetic)', href: 'https://github.com/kuramach/pactlab/tree/main/demo-data/cases/case-01-grocery' },
  },
];
