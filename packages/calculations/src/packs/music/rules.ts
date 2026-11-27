import { D } from '../../metrics/decimal';
import { MUSIC_INCOME_TREND } from './history';
import { grouped, moneyIn, percent } from '../common';
import { collapse, findSentence, MAX_CITED, sentences, type PackRule, type PackRulePage, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import { catalogRows, incomeModel, MUSIC_EVIDENCE, MUSIC_EVIDENCE_TYPES, MUSIC_THRESHOLDS, statedHoldYears, statementGaps, terminationExposure, writerIncome, type CatalogRows } from './catalog';

/**
 * Music rights rules (T-140, ADR 0041). Deterministic, decimal-only and cited; every proposal is a
 * DRAFT a named reviewer decides. Diligence support only: no rule says title is good or bad, or
 * that a termination notice is valid — each flags a gap in the evidence for the parties and counsel.
 */
type Decimal = InstanceType<typeof D>;
const money = (value: Decimal) => grouped(value);
const points = (value: Decimal) => value.toFixed(1).replace(/\.0$/, '');
const cited = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
const evidenceOf = (rows: CatalogRows, workId: string) => rows.works.filter((work) => work.id === workId).map((work) => work.evidenceId);

/** A work producing income with no assignment (or work-for-hire) and no registration behind it. */
export const MUSIC_CHAIN_OF_TITLE_GAP: PackRule = {
  id: 'music-chain-of-title-gap',
  version: '1',
  evidenceTypes: MUSIC_EVIDENCE_TYPES,
  detect: ({ evidence }) => {
    const rows = catalogRows(evidence);
    const income = incomeModel(rows);
    return rows.works.flatMap((work): PackRuleProposal[] => {
      const earned = income.byWork.get(work.id);
      if (!earned?.trailing.gt(0)) return [];
      const grants = rows.grants.filter((grant) => grant.workId === work.id);
      const missing = [
        ...(grants.some((grant) => grant.type === 'registration') ? [] : ['no registration']),
        ...(grants.some((grant) => grant.type === 'assignment' || grant.type === 'work_for_hire') ? [] : ['no assignment to the seller or work-for-hire agreement']),
      ];
      if (missing.length === 0) return [];
      const share = income.trailing.gt(0) ? earned.trailing.div(income.trailing) : new D(0);
      return [
        {
          key: work.id,
          domain: 'LEGAL',
          title: `Chain-of-title gap: ${work.title}`,
          description: `${work.title} (${work.id}) earned ${money(earned.trailing)} in the twelve months to ${income.latestPeriodEnd} (${percent(share)} of trailing income), but the chain of title holds ${missing.join(' and ')} for it. The evidence does not show how the seller holds the rights; counsel should confirm before the work is paid for.`,
          severity: share.gte('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Income the buyer may not own: a title holdback (escrow) the reviewer sizes until the assignment is produced.',
          evidenceIds: cited([...evidenceOf(rows, work.id), ...grants.map((grant) => grant.id), ...earned.lineIds]),
        },
      ];
    });
  },
};

/** Splits on a work do not total 100%, or the statement pays different splits from the split sheet. */
export const MUSIC_SPLIT_MISMATCH: PackRule = {
  id: 'music-split-mismatch',
  version: '1',
  evidenceTypes: MUSIC_EVIDENCE_TYPES,
  detect: ({ evidence }) => {
    const rows = catalogRows(evidence);
    const titles = new Map(rows.works.map((work) => [work.id, work.title]));
    const tolerance = new D(MUSIC_THRESHOLDS.splitPoints);
    const workIds = [...new Set(rows.splits.map((split) => split.workId))].sort();
    return workIds.flatMap((workId): PackRuleProposal[] => {
      const sheet = rows.splits.filter((split) => split.workId === workId && split.source === 'split_sheet');
      const paid = rows.splits.filter((split) => split.workId === workId && split.source === 'statement');
      const problems: string[] = [];
      const total = sheet.reduce((sum, split) => sum.plus(split.share), new D(0));
      if (sheet.length && total.minus(100).abs().gt(tolerance)) problems.push(`the split sheet's shares total ${points(total)}%, not 100%`);
      for (const split of paid) {
        const signed = sheet.find((candidate) => candidate.writer === split.writer);
        if (!signed) problems.push(`the statement pays ${split.writer} ${points(split.share)}%, who is not on the split sheet`);
        else if (signed.share.minus(split.share).abs().gt(tolerance)) problems.push(`the statement pays ${split.writer} ${points(split.share)}% against ${points(signed.share)}% on the split sheet`);
      }
      if (problems.length === 0) return [];
      const title = titles.get(workId) ?? workId;
      return [
        {
          key: workId,
          domain: 'LEGAL',
          title: `Split mismatch: ${title}`,
          description: `On ${title} (${workId}), ${problems.join('; ')}. Royalties are being paid or claimed on shares the documents do not support.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Over-claimed shares are income the buyer may have to repay or will not receive: the reviewer prices the excess.',
          evidenceIds: cited([...evidenceOf(rows, workId), ...sheet.map((split) => split.id), ...paid.map((split) => split.id)]),
        },
      ];
    });
  },
};

/** Grants behind a material share of trailing income become terminable inside the hold. */
export const MUSIC_TERMINATION_EXPOSURE: PackRule = {
  id: 'music-termination-exposure',
  version: '1',
  evidenceTypes: MUSIC_EVIDENCE_TYPES,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = catalogRows(evidence);
    const income = incomeModel(rows);
    const hold = statedHoldYears(pages);
    const exposure = terminationExposure(rows, income, hold.years);
    if (!exposure.share || exposure.share.lt(MUSIC_THRESHOLDS.terminationShare)) return [];
    const opening = [...exposure.grants].sort((a, b) => a.window.opens.localeCompare(b.window.opens));
    const first = opening[0]?.window.opens ?? '';
    const works = new Set(exposure.grants.map((grant) => grant.workId));
    return [
      {
        key: `${exposure.analysisDate}:${hold.years}`,
        domain: 'LEGAL',
        title: 'Termination exposure inside the hold period',
        description: `Grants behind ${percent(exposure.share)} of trailing income (${money(exposure.exposedIncome)} of ${money(exposure.trailing)} a year, across ${works.size} work${works.size === 1 ? '' : 's'}) become terminable under 17 U.S.C. §203 or §304(c) before the ${hold.years}-year hold ends on ${exposure.holdEnds}${hold.stated ? '' : ' (the pack’s default hold; a stated hold period on any document replaces it)'}. The first window opens on ${first}. Price it as its own line: a price reduction on that share of income. Whether notices are served, or valid, is for counsel.`,
        severity: exposure.share.gte('0.25') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Income the authors can recover during the hold: a price reduction on the exposed share, priced by the reviewer at the scenario’s royalty multiple.',
        evidenceIds: cited([...exposure.grants.map((grant) => grant.grantId), ...exposure.grants.flatMap((grant) => evidenceOf(rows, grant.workId))]),
      },
    ];
  },
};

/** The top work, or the top writer, carries more than a stated share of trailing income. */
export const MUSIC_INCOME_CONCENTRATION: PackRule = {
  id: 'music-income-concentration',
  version: '1',
  evidenceTypes: MUSIC_EVIDENCE_TYPES,
  detect: ({ evidence }) => {
    const rows = catalogRows(evidence);
    const income = incomeModel(rows);
    if (!income.trailing.gt(0)) return [];
    const titles = new Map(rows.works.map((work) => [work.id, work.title]));
    const proposals: PackRuleProposal[] = [];
    const [top] = [...income.byWork.values()].sort((a, b) => b.trailing.comparedTo(a.trailing) || a.workId.localeCompare(b.workId));
    if (top && top.trailing.div(income.trailing).gt(MUSIC_THRESHOLDS.topWorkShare)) {
      const title = titles.get(top.workId) ?? top.workId;
      proposals.push({
        key: `work:${top.workId}`,
        domain: 'COMMERCIAL',
        title: `Income concentration: ${title}`,
        description: `${title} (${top.workId}) is ${percent(top.trailing.div(income.trailing))} of trailing income (${money(top.trailing)} of ${money(income.trailing)}), above the ${percent(new D(MUSIC_THRESHOLDS.topWorkShare))} the pack flags. The catalog's value moves with one work's decay and its title.`,
        severity: top.trailing.div(income.trailing).gte('0.3') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A concentration sensitivity in the scenarios, not a price term.',
        evidenceIds: cited([...evidenceOf(rows, top.workId), ...top.lineIds]),
      });
    }
    const [writer] = [...writerIncome(rows, income).entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]));
    if (writer && writer[1].div(income.trailing).gt(MUSIC_THRESHOLDS.topWriterShare)) {
      const splits = rows.splits.filter((split) => split.writer === writer[0] && split.source === 'split_sheet');
      proposals.push({
        key: `writer:${writer[0]}`,
        domain: 'COMMERCIAL',
        title: `Income concentration: writer ${writer[0]}`,
        description: `Works by writer ${writer[0]} carry ${percent(writer[1].div(income.trailing))} of trailing income at their split-sheet shares (${money(writer[1])} of ${money(income.trailing)}), above the ${percent(new D(MUSIC_THRESHOLDS.topWriterShare))} the pack flags.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A concentration sensitivity in the scenarios, not a price term.',
        evidenceIds: cited(splits.map((split) => split.id)),
      });
    }
    return proposals;
  },
};

/** "Unrecouped balance carried forward: USD 412,500." — a ledger figure, against what the seller's summary says. */
const LEDGER = /unrecouped (?:advance )?balance carried forward/i;
const STATED = /unrecouped advance/i;

/** The publisher or label ledger shows an unrecouped advance the seller's summary omits or states differently. */
export const MUSIC_RECOUPMENT_MISMATCH: PackRule = {
  id: 'music-recoupment-mismatch',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const ledger = findSentence(pages, (sentence) => LEDGER.test(sentence) && moneyIn(sentence) !== null);
    const balance = ledger ? moneyIn(ledger.quote) : null;
    if (!ledger || !balance || !balance.amount.gt(0)) return [];
    const statements = pages
      .filter((page) => page.documentId !== ledger.page.documentId)
      .flatMap((page) => sentences(page.text).filter((sentence) => STATED.test(sentence) && !LEDGER.test(sentence)).map((quote) => ({ page, quote })));
    const stated = statements[0] ?? null;
    const statedAmount = stated ? (moneyIn(stated.quote)?.amount ?? new D(0)) : new D(0);
    const gap = balance.amount.minus(statedAmount);
    if (!gap.gt(0)) return [];
    const quotes: PackRuleQuote[] = [{ documentId: ledger.page.documentId, pageNumber: ledger.page.pageNumber, quote: ledger.quote }, ...(stated ? [{ documentId: stated.page.documentId, pageNumber: stated.page.pageNumber, quote: stated.quote }] : [])];
    return [
      {
        key: `${ledger.page.documentId}:${ledger.page.pageNumber}`,
        domain: 'FINANCIAL',
        title: 'Unrecouped advance not disclosed',
        description: stated
          ? `The ledger shows an unrecouped advance of ${balance.currency} ${money(balance.amount)} (“${ledger.quote}”), but the seller states “${stated.quote}” — ${balance.currency} ${money(gap)} the summary does not account for. Royalties go to recouping it before they reach the owner.`
          : `The ledger shows an unrecouped advance of ${balance.currency} ${money(balance.amount)} (“${ledger.quote}”), which no other document discloses. Royalties go to recouping it before they reach the owner.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Income already paid out as an advance: the undisclosed balance comes off the price.',
        pricedRisk: { type: 'PRICE_REDUCTION', currency: balance.currency, low: gap.toFixed(2), high: gap.toFixed(2), basis: 'The unrecouped balance the ledger states, less any balance the seller disclosed.' },
        evidenceIds: [],
        quotes,
      },
    ];
  },
};

/** Registered compositions with no performance income where comparable works (same catalog age) earn it. */
export const MUSIC_ROYALTY_LEAKAGE: PackRule = {
  id: 'music-royalty-leakage',
  version: '1',
  evidenceTypes: MUSIC_EVIDENCE_TYPES,
  detect: ({ evidence }) => {
    const rows = catalogRows(evidence);
    const income = incomeModel(rows);
    if (!income.latestPeriodEnd) return [];
    const latestYear = Number(income.latestPeriodEnd.slice(0, 4));
    const compositions = rows.works.filter((work) => work.type === 'composition' && work.pro && work.releaseYear !== null);
    const performing = (workId: string) => (income.byWork.get(workId)?.bySource.get('performance') ?? new D(0)).gt(0);
    const earning = (workId: string) => (income.byWork.get(workId)?.trailing ?? new D(0)).gt(0);
    const bandOf = (year: number) => { const age = latestYear - year; return age <= 2 ? 0 : age <= 5 ? 1 : age <= 10 ? 2 : age <= 20 ? 3 : 4; };
    const leaking = compositions.filter((work) => {
      if (!earning(work.id) || performing(work.id)) return false;
      const peers = compositions.filter((peer) => peer.id !== work.id && bandOf(peer.releaseYear ?? 0) === bandOf(work.releaseYear ?? 0));
      return peers.length >= 3 && new D(peers.filter((peer) => performing(peer.id)).length).div(peers.length).gte(MUSIC_THRESHOLDS.leakagePeers);
    });
    if (leaking.length === 0) return [];
    const names = leaking.map((work) => `${work.title} (${work.id}, ${work.pro})`);
    return [
      {
        key: `${income.latestPeriodEnd}:${leaking.map((work) => work.id).join(',')}`,
        domain: 'COMMERCIAL',
        title: 'Royalty leakage: registered works with no performance income',
        description: `${leaking.length} registered composition${leaking.length === 1 ? '' : 's'} earned mechanical or streaming income but no performance income in the twelve months to ${income.latestPeriodEnd}, while most works of the same catalog age do: ${names.join('; ')}. Their PRO registrations or work codes should be checked; nothing here estimates the missing income.`,
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        direction: 0,
        directionRationale: 'A gap to close, not a price term: unclaimed income is never added to the price.',
        evidenceIds: cited(leaking.flatMap((work) => [work.evidenceId, ...(income.byWork.get(work.id)?.lineIds ?? [])])),
      },
    ];
  },
};

const LIEN = /\b(UCC|financing statement|security interest|lien)\b/i;
const NAME_WORD = String.raw`(?:[A-Z][\w&.'-]*|\([a-z]+\))`;
const SECURED_PARTY = new RegExp(String.raw`in favou?r of (${NAME_WORD}(?:\s+(?:${NAME_WORD}|of|and|&))*)`);

/** A lien, UCC filing or claim in the evidence that no other document (the deal summary) discloses. */
export const MUSIC_UNDISCLOSED_ENCUMBRANCE: PackRule = {
  id: 'music-undisclosed-encumbrance',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    for (const page of pages) {
      const sentence = sentences(page.text).find((candidate) => LIEN.test(candidate) && SECURED_PARTY.test(candidate));
      const party = sentence ? SECURED_PARTY.exec(sentence)?.[1]?.trim() : null;
      if (!sentence || !party) continue;
      const elsewhere = (other: PackRulePage) => other.documentId !== page.documentId && collapse(other.text).toLowerCase().includes(party.toLowerCase());
      if (pages.some(elsewhere)) continue;
      const secured = moneyIn(sentence);
      const quote = sentence.length > 400 ? sentence.slice(0, 400) : sentence;
      return [
        {
          key: `${page.documentId}:${page.pageNumber}`,
          domain: 'LEGAL',
          title: `Undisclosed encumbrance: ${party}`,
          description: `The evidence records a lien or security interest in favour of ${party} (“${quote}”), and no other document in the data room mentions it. The deal summary should disclose it, and it should be released at closing or covered by an indemnity.`,
          severity: 'HIGH',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'A claim on the catalog the buyer would inherit: an indemnity, sized at the amount the filing secures.',
          pricedRisk: secured ? { type: 'INDEMNITY', currency: secured.currency, low: secured.amount.toFixed(2), high: secured.amount.toFixed(2), basis: 'The amount the filing secures.' } : null,
          evidenceIds: [],
          quotes: [{ documentId: page.documentId, pageNumber: page.pageNumber, quote }],
        },
      ];
    }
    return [];
  },
};

/** A payer skipped a statement period: the gap is shown, never filled. */
export const MUSIC_STATEMENT_GAP: PackRule = {
  id: 'music-statement-gap',
  version: '1',
  evidenceTypes: [MUSIC_EVIDENCE.ROYALTY],
  detect: ({ evidence }) =>
    statementGaps(catalogRows(evidence)).map((gap) => ({
      key: `${gap.payer}:${gap.missing.join(',')}`,
      domain: 'FINANCIAL',
      title: `Missing statement period: ${gap.payer}`,
      description: `${gap.payer} has no statement for the period${gap.missing.length === 1 ? '' : 's'} ending ${gap.missing.join(', ')}, between statements it did send. The income model shows the gap as absence; ask for the statement before relying on the trailing figures.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap in the evidence to close before pricing, not a price term.',
      evidenceIds: cited(gap.lineIds),
    })),
};

/** Trailing income above the prior year: confirmed value for the buyer's ledger, never a price increase. */
export const MUSIC_VERIFIED_GROWTH: PackRule = {
  id: 'music-verified-growth',
  version: '1',
  evidenceTypes: [MUSIC_EVIDENCE.ROYALTY],
  detect: ({ evidence }) => {
    const income = incomeModel(catalogRows(evidence));
    if (!income.prior.gt(0) || !income.trailing.div(income.prior).minus(1).gte(MUSIC_THRESHOLDS.verifiedGrowth)) return [];
    const growth = income.trailing.div(income.prior).minus(1);
    return [
      {
        key: `${income.latestPeriodEnd}`,
        domain: 'FINANCIAL',
        title: 'Verified catalog growth',
        description: `Statement income grew ${percent(growth)} year on year, to ${money(income.trailing)} in the twelve months to ${income.latestPeriodEnd}, from ${money(income.prior)}. Recorded as confirmed value; the decay-adjusted income the price rests on never adds growth.`,
        severity: 'INFO',
        confidence: 'HIGH',
        direction: 1,
        directionRationale: 'Upside confirmed by statements: confirmed value only, never a price increase.',
        valueConfirmation: { valueDriver: 'Catalog income growth', impliedValue: null, basis: 'Trailing twelve months of statement income against the prior twelve.' },
        evidenceIds: cited([...income.byWork.values()].flatMap((work) => work.lineIds)),
      },
    ];
  },
};

export const MUSIC_RULES: readonly PackRule[] = [
  MUSIC_CHAIN_OF_TITLE_GAP,
  MUSIC_SPLIT_MISMATCH,
  MUSIC_TERMINATION_EXPOSURE,
  MUSIC_INCOME_CONCENTRATION,
  MUSIC_RECOUPMENT_MISMATCH,
  MUSIC_ROYALTY_LEAKAGE,
  MUSIC_UNDISCLOSED_ENCUMBRANCE,
  MUSIC_STATEMENT_GAP,
  MUSIC_VERIFIED_GROWTH,
  MUSIC_INCOME_TREND,
];
