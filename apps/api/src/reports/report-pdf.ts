import { D } from '@pactlab/calculations';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { brandFontFile, documentColors, POWERED_BY, type DocumentBrand } from '../brand/document-brand';
import { phaseLabel, type ExecutiveReportModel, type Money, type PactReportModel } from './report-model';

/**
 * Report PDFs (T-110): A4 pages in the Pactlab brand (Manrope, navy and indigo, the logo), real
 * tables that wrap and carry over pages, and on every page the version, "data as of" and a
 * confidentiality line. A document a partner can forward, not a screenshot of the app.
 */

export interface ReportStamp {
  title: string;
  subtitle: string;
  organizationName: string;
  version: number;
  generatedAt: Date;
  generatedByName: string;
  dataAsOf: Date;
  /** The generating organization's kit (T-123), stamped at generation; absent or null: Pactlab's. */
  brand?: DocumentBrand | null;
}

const LOGO = resolve(import.meta.dirname, '../../assets/brand/pactlab-logo.png');

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const NAVY = rgb(0.043, 0.078, 0.18);
const INDIGO = rgb(0.31, 0.27, 0.9);
const MUTED = rgb(0.4, 0.43, 0.5);
const RULE = rgb(0.86, 0.87, 0.9);
const STRIPE = rgb(0.965, 0.97, 0.98);

const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
export const formatMoney = (money: Money | null | undefined): string => {
  if (!money) return '—';
  const [whole = '0', fraction = ''] = money.amount.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = fraction.replace(/0+$/, '') ? `.${(fraction + '00').slice(0, 2)}` : '';
  return `${money.amount.startsWith('-') ? '−' : ''}${money.currency} ${grouped}${cents}`;
};
const range = (low: string, high: string, currency: string) => `${formatMoney({ amount: low, currency })} – ${formatMoney({ amount: high, currency }).replace(`${currency} `, '')}`;

class ReportWriter {
  private page!: PDFPage;
  private y = 0;
  private readonly pages: PDFPage[] = [];

  private constructor(
    readonly pdf: PDFDocument,
    private readonly fonts: { regular: PDFFont; semibold: PDFFont; bold: PDFFont },
    private readonly logo: PDFImage | null,
    private readonly meta: ReportStamp,
    private readonly colors: { ink: ReturnType<typeof rgb>; accent: ReturnType<typeof rgb> },
  ) {}

  static async create(meta: ReportStamp): Promise<ReportWriter> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.setTitle(`${meta.title} — v${meta.version}`);
    const brand = meta.brand ?? null;
    pdf.setAuthor(brand ? brand.name : 'Pactlab');
    pdf.setCreator('Pactlab');
    pdf.setCreationDate(meta.generatedAt);
    pdf.setModificationDate(meta.generatedAt);
    pdf.setProducer('Pactlab reports');
    const fonts = {
      regular: await pdf.embedFont(brandFontFile(brand?.font ?? 'MANROPE', 400), { subset: true }),
      semibold: await pdf.embedFont(brandFontFile(brand?.font ?? 'MANROPE', 600), { subset: true }),
      bold: await pdf.embedFont(brandFontFile(brand?.font ?? 'MANROPE', 700), { subset: true }),
    };
    const logo = await (async (): Promise<PDFImage | null> => {
      try {
        // A branded organization's own logo; with only an SVG (or none) its name prints as a wordmark.
        if (brand) return brand.logo ? await (brand.logo.type === 'image/png' ? pdf.embedPng(brand.logo.bytes) : pdf.embedJpg(brand.logo.bytes)) : null;
        return await pdf.embedPng(readFileSync(LOGO));
      } catch {
        return null;
      }
    })();
    const writer = new ReportWriter(pdf, fonts, logo, meta, documentColors(brand, { ink: NAVY, accent: INDIGO }));
    writer.newPage();
    return writer;
  }

  /** Characters the font lacks become "?", never silently dropped. */
  private safe(text: string, font: PDFFont): string {
    const supported = new Set(font.getCharacterSet());
    return [...text.replace(/\s+/g, ' ')].map((char) => (supported.has(char.codePointAt(0) ?? 0) ? char : '?')).join('');
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = this.safe(text, font).split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        // A single word longer than the width is cut, not overflowed.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  private newPage(): void {
    this.page = this.pdf.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - MARGIN;
    if (this.pages.length > 1) {
      this.page.drawText(this.safe(this.meta.title, this.fonts.semibold), { x: MARGIN, y: this.y, size: 8, font: this.fonts.semibold, color: MUTED });
      this.y -= 22;
    }
  }

  private ensure(height: number): void {
    if (this.y - height < MARGIN + 30) this.newPage();
  }

  cover(): void {
    if (this.logo) {
      // At most 120 wide and 48 tall, whatever the logo's shape.
      const scale = Math.min(120 / this.logo.width, 48 / this.logo.height);
      this.page.drawImage(this.logo, { x: MARGIN, y: this.y - this.logo.height * scale, width: this.logo.width * scale, height: this.logo.height * scale });
      this.y -= this.logo.height * scale + 28;
    } else if (this.meta.brand) {
      this.text(this.meta.brand.name, { size: 18, font: 'bold', color: this.colors.ink, after: 18 });
    }
    this.text(this.meta.title, { size: 22, font: 'bold', color: this.colors.ink, after: 6 });
    this.text(this.meta.subtitle, { size: 12, color: this.colors.accent, after: 18 });
    this.facts([
      ['Organization', this.meta.organizationName],
      ['Report version', `v${this.meta.version}`],
      ['Data as of', stamp(this.meta.dataAsOf)],
      ['Generated', `${stamp(this.meta.generatedAt)} by ${this.meta.generatedByName}`],
    ]);
    this.text(
      'A snapshot: figures are as they stood at "data as of". Later versions never change this one. Projections and valuations are under the stated assumptions, not predictions. Confidential.',
      { size: 8, color: MUTED, after: 12 },
    );
  }

  text(content: string, options: { size?: number; font?: 'regular' | 'semibold' | 'bold'; color?: ReturnType<typeof rgb>; after?: number; indent?: number } = {}): void {
    const size = options.size ?? 10;
    const font = this.fonts[options.font ?? 'regular'];
    const indent = options.indent ?? 0;
    for (const line of this.wrap(content, font, size, A4.width - 2 * MARGIN - indent)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: options.color ?? NAVY });
      this.y -= size + 4;
    }
    this.y -= options.after ?? 4;
  }

  heading(content: string): void {
    this.ensure(48);
    this.y -= 10;
    this.text(content, { size: 14, font: 'bold', color: this.colors.ink, after: 2 });
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 1.5, color: this.colors.accent });
    this.y -= 10;
  }

  facts(rows: readonly [string, string][]): void {
    for (const [label, value] of rows) {
      const lines = this.wrap(value, this.fonts.regular, 10, A4.width - 2 * MARGIN - 130);
      this.ensure(lines.length * 14);
      this.page.drawText(this.safe(label, this.fonts.semibold), { x: MARGIN, y: this.y - 10, size: 9, font: this.fonts.semibold, color: MUTED });
      for (const [index, line] of lines.entries()) this.page.drawText(line, { x: MARGIN + 130, y: this.y - 10 - index * 14, size: 10, font: this.fonts.regular, color: NAVY });
      this.y -= lines.length * 14 + 2;
    }
    this.y -= 6;
  }

  /** A real table: header row repeated on each page, cells wrapped, zebra rows. Widths are fractions. */
  table(columns: readonly { label: string; width: number; align?: 'right' }[], rows: readonly string[][], empty = 'None.'): void {
    if (rows.length === 0) {
      this.text(empty, { size: 9, color: MUTED, after: 8 });
      return;
    }
    const total = A4.width - 2 * MARGIN;
    const widths = columns.map((column) => column.width * total);
    const header = () => {
      this.ensure(22);
      this.page.drawRectangle({ x: MARGIN, y: this.y - 16, width: total, height: 18, color: this.colors.ink });
      let x = MARGIN;
      for (const [index, column] of columns.entries()) {
        this.page.drawText(this.safe(column.label, this.fonts.semibold), { x: x + 4, y: this.y - 12, size: 8, font: this.fonts.semibold, color: rgb(1, 1, 1) });
        x += widths[index] ?? 0;
      }
      this.y -= 18;
    };
    header();
    for (const [rowIndex, row] of rows.entries()) {
      const cells = row.map((cell, index) => this.wrap(cell, this.fonts.regular, 8.5, (widths[index] ?? 40) - 8));
      const height = Math.max(...cells.map((lines) => lines.length)) * 11 + 6;
      if (this.y - height < MARGIN + 30) {
        this.newPage();
        header();
      }
      if (rowIndex % 2 === 1) this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: total, height, color: STRIPE });
      let x = MARGIN;
      for (const [index, lines] of cells.entries()) {
        const width = widths[index] ?? 40;
        for (const [lineIndex, line] of lines.entries()) {
          const lineWidth = this.fonts.regular.widthOfTextAtSize(line, 8.5);
          const at = columns[index]?.align === 'right' ? x + width - 4 - lineWidth : x + 4;
          this.page.drawText(line, { x: at, y: this.y - 10 - lineIndex * 11, size: 8.5, font: this.fonts.regular, color: NAVY });
        }
        x += width;
      }
      this.y -= height;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + total, y: this.y }, thickness: 0.5, color: RULE });
    }
    this.y -= 12;
  }

  /** Footers last, once the page count is known. */
  async finish(): Promise<{ bytes: Uint8Array; sha256: string }> {
    for (const [index, page] of this.pages.entries()) {
      const footer = `${this.meta.title} · v${this.meta.version} · Data as of ${stamp(this.meta.dataAsOf)} · Confidential: ${this.meta.organizationName} · Page ${index + 1} of ${this.pages.length}`;
      page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: A4.width - MARGIN, y: MARGIN }, thickness: 0.5, color: RULE });
      page.drawText(this.wrap(footer, this.fonts.regular, 7, A4.width - 2 * MARGIN)[0] ?? '', { x: MARGIN, y: MARGIN - 12, size: 7, font: this.fonts.regular, color: MUTED });
      // A branded document still says where it was made (T-123), on its own line so it is never cut.
      if (this.meta.brand) page.drawText(POWERED_BY, { x: MARGIN, y: MARGIN - 22, size: 7, font: this.fonts.semibold, color: MUTED });
    }
    // Deterministic bytes for the same content: no random document id.
    const bytes = await this.pdf.save({ useObjectStreams: true });
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
}

const DIRECTION: Record<string, string> = { '-1': 'Risk', '0': 'Neutral', '1': 'Confirms value' };
const STATUS: Record<string, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', ACCEPTED: 'Accepted', REJECTED: 'Rejected' };

/** The investment committee's record on a pact (T-118): buyer side only, so a seller's report never has it. */
export interface CommitteeRecord {
  submissions: { version: number; submittedAt: string; submittedByName: string | null; decision: { decision: string; note: string; decidedByName: string | null; decidedAt: string } | null; conditions: { text: string; status: string }[] }[];
}

const DECISIONS: Readonly<Record<string, string>> = { APPROVE: 'Approved', APPROVE_WITH_CONDITIONS: 'Approved with conditions', DECLINE: 'Declined' };

export async function pactReportPdf(
  model: PactReportModel,
  meta: ReportStamp,
  extra: { committee?: CommitteeRecord | null; icPack?: { blockers: string[] } } = {},
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const w = await ReportWriter.create(meta);
  w.cover();
  const { deal } = model;
  if (extra.icPack) {
    // The pack opens with what the committee is asked to decide, then the full pact record follows.
    w.heading('For the investment committee');
    const findings = model.findings ?? [];
    const drags = findings.filter((finding) => finding.direction === -1 && finding.status !== 'REJECTED' && finding.pricedRisk);
    // Ordered by the decimal high end; no floating point on money.
    const largest = [...drags].sort((a, b) => new D(b.pricedRisk?.high ?? '0').cmp(a.pricedRisk?.high ?? '0')).slice(0, 3);
    w.facts([
      ['Decision asked', 'Approve, approve with conditions, or decline this pact on the terms below.'],
      ['Findings', `${findings.filter((finding) => finding.status === 'ACCEPTED').length} accepted · ${findings.filter((finding) => finding.status === 'DRAFT' || finding.status === 'IN_REVIEW').length} in review`],
      ['Largest priced risks', largest.map((finding) => `${finding.title} (${finding.pricedRisk ? range(finding.pricedRisk.low, finding.pricedRisk.high, finding.pricedRisk.currency) : ''})`).join('; ') || 'None'],
    ]);
    w.table([{ label: 'Open blocker', width: 1 }], extra.icPack.blockers.map((blocker) => [blocker]), 'No open blockers.');
  }
  w.heading('Overview');
  w.facts([
    ['Pact', deal.name],
    ['Target', deal.targetName],
    ['Parties', (deal.parties ?? []).map((party) => `${party.role === 'BUYER' ? 'Buyer' : 'Seller'}: ${party.name}`).join(' · ') || '—'],
    ['Phase · stage', `${phaseLabel(deal.phase)} · ${deal.stage.replace(/_/g, ' ').toLowerCase()}`],
    ['Viewpoint', model.sideLabel],
    ['Base currency', deal.baseCurrency],
  ]);

  if (extra.committee && extra.committee.submissions.length > 0) {
    w.heading('Investment committee');
    w.table(
      [{ label: 'Pack', width: 0.1 }, { label: 'Submitted', width: 0.2 }, { label: 'Decision', width: 0.25 }, { label: 'Note and conditions', width: 0.45 }],
      extra.committee.submissions.map((submission) => [
        `v${submission.version}`,
        `${submission.submittedAt.slice(0, 10)}${submission.submittedByName ? ` · ${submission.submittedByName}` : ''}`,
        submission.decision ? `${DECISIONS[submission.decision.decision] ?? submission.decision.decision} · ${submission.decision.decidedAt.slice(0, 10)}${submission.decision.decidedByName ? ` · ${submission.decision.decidedByName}` : ''}` : 'Awaiting decision',
        [submission.decision?.note, ...submission.conditions.map((condition) => `Condition (${condition.status.toLowerCase()}): ${condition.text}`)].filter(Boolean).join(' | ') || '—',
      ]),
    );
  }

  if (model.evidence) {
    w.heading('Evidence');
    w.table(
      [{ label: 'Document', width: 0.5 }, { label: 'Class', width: 0.15 }, { label: 'Intake', width: 0.2 }, { label: 'Added', width: 0.15 }],
      model.evidence.documents.map((doc) => [doc.fileName, doc.dataClass.toLowerCase(), (doc.intake?.category ?? doc.intake?.state ?? '—').replace(/_/g, ' ').toLowerCase(), doc.createdAt.slice(0, 10)]),
      'No documents.',
    );
    w.table(
      [{ label: 'Connected source', width: 0.45 }, { label: 'Provider', width: 0.2 }, { label: 'Records', width: 0.15, align: 'right' }, { label: 'Last sync', width: 0.2 }],
      model.evidence.sources.map((source) => [source.displayName, source.provider, String(source.evidenceCount ?? 0), source.lastSyncRun?.completedAt?.slice(0, 10) ?? '—']),
      'No connected sources.',
    );
  }

  if (model.findings) {
    w.heading('Findings');
    w.table(
      [{ label: 'Finding', width: 0.36 }, { label: 'Direction', width: 0.13 }, { label: 'Status', width: 0.11 }, { label: 'Severity', width: 0.1 }, { label: 'Priced impact / why', width: 0.3 }],
      model.findings.map((finding) => [
        finding.title,
        finding.direction === null ? 'Undecided' : (DIRECTION[String(finding.direction)] ?? '—'),
        STATUS[finding.status] ?? finding.status,
        finding.severity.toLowerCase(),
        finding.pricedRisk
          ? `${range(finding.pricedRisk.low, finding.pricedRisk.high, finding.pricedRisk.currency)} (${finding.pricedRisk.type.replace(/_/g, ' ').toLowerCase()})`
          : finding.direction === 0
            ? (finding.directionRationale ?? 'Neutral')
            : finding.valueConfirmation
              ? `Confirms: ${finding.valueConfirmation.valueDriver}`
              : '—',
      ]),
      'No findings yet.',
    );
  }

  if (model.claims) {
    w.heading('Claims register');
    w.table(
      [{ label: 'Claim', width: 0.4 }, { label: 'Status', width: 0.15 }, { label: 'Source', width: 0.2 }, { label: 'Why', width: 0.25 }],
      model.claims.map((claim) => [claim.statement, claim.status.toLowerCase(), claim.source ?? '—', claim.rationale ?? '—']),
    );
  }

  if (model.valuation) {
    w.heading('Valuation');
    if (model.valuation.persona) w.facts([['Priced as', model.valuation.persona]]);
    for (const item of model.valuation.scenarios) {
      const run = item.latestRun;
      w.text(`${item.scenario.name}${item.scenario.scenarioCase ? ` · ${item.scenario.scenarioCase.toLowerCase()} case` : ''}`, { size: 11, font: 'semibold', after: 2 });
      if (!run) {
        w.text('Not run yet.', { size: 9, color: MUTED, after: 8 });
        continue;
      }
      const method = run.result.method;
      const methodName = typeof method === 'string' ? method : method.method;
      w.text(`Method: ${methodName.replace(/_/g, ' ').toLowerCase()}${typeof method === 'object' && method.multiple ? ` at ${method.multiple}x` : ''} · run ${run.ranAt.slice(0, 10)}`, { size: 8, color: MUTED, after: 4 });
      w.table(
        [{ label: 'Purchase-price bridge', width: 0.7 }, { label: 'Amount', width: 0.3, align: 'right' }],
        [
          ...run.result.bridge.lines.map((line) => [line.label, formatMoney(line.amount)]),
          ['Equity purchase price', formatMoney(run.result.bridge.equityPurchasePrice)],
          ['Held back', formatMoney(run.result.bridge.holdbacks)],
          ['Cash at close', formatMoney(run.result.bridge.cashAtClose)],
        ],
      );
      if (item.askingComparison) w.facts([['Asking', formatMoney(item.askingComparison.asking)]]);
    }
    if (model.valuation.confirmedValue) {
      w.text('Value confirmed, not paid for (buyer only)', { size: 11, font: 'semibold', after: 2 });
      for (const label of model.valuation.confirmedValue) w.text(`• ${label}`, { size: 9, indent: 8 });
    }
  }

  if (model.terms) {
    w.heading('Terms');
    const proposed = model.terms.proposed;
    if (!proposed) w.text('No terms proposed yet.', { size: 9, color: MUTED });
    else {
      w.facts([['Version', `v${proposed.version}${proposed.agreedAt ? ` · agreed ${proposed.agreedAt.slice(0, 10)}` : ' · under negotiation'}`]]);
      w.table(
        [{ label: 'Term', width: 0.45 }, { label: 'Amount', width: 0.3, align: 'right' }, { label: 'Response', width: 0.25 }],
        proposed.terms.map((term) => [term.lever.replace(/_/g, ' ').toLowerCase(), formatMoney({ amount: term.amount, currency: term.currency ?? deal.baseCurrency }), term.response ? `${term.response.decision.toLowerCase()}${term.response.counterAmount ? ` at ${formatMoney({ amount: term.response.counterAmount, currency: term.currency ?? deal.baseCurrency })}` : ''}` : '—']),
      );
    }
  }

  // Buyer financing (T-117): what funds the deal, as the buyer attests it; the seller's report shows the seller-visible layer.
  if (model.financing) {
    w.heading('Buyer financing');
    w.text('Buyer-provided: amounts and statuses are the buyer’s attestation. “Document-backed” means a letter or proof is attached and visible to this side.', { size: 8, color: MUTED, after: 6 });
    for (const plan of model.financing) {
      if (plan.tranches.length === 0 && !plan.escrow) continue;
      w.facts([
        ...(plan.firmName ? ([['Bidder', plan.firmName]] as [string, string][]) : []),
        ['Posture', plan.posture.headline],
        ['Coverage', plan.posture.coverage.against ? `${formatMoney({ amount: plan.posture.coverage.total, currency: plan.posture.coverage.currency })} of ${formatMoney({ amount: plan.posture.coverage.against.price, currency: plan.posture.coverage.currency })} (${plan.posture.coverage.against.agreed ? 'agreed' : 'proposed'} price)` : formatMoney({ amount: plan.posture.coverage.total, currency: plan.posture.coverage.currency })],
        ...(plan.posture.escrow ? ([['Earnest money', plan.posture.escrow]] as [string, string][]) : []),
        ...(plan.commitmentExpectedBy ? ([['Commitment expected by', plan.commitmentExpectedBy]] as [string, string][]) : []),
      ]);
      w.table(
        [{ label: 'Source', width: 0.3 }, { label: 'Amount', width: 0.25, align: 'right' }, { label: 'Status', width: 0.25 }, { label: 'Backing', width: 0.2 }],
        plan.tranches.map((tranche) => [tranche.kind.replace(/_/g, ' ').toLowerCase().replace('sba 7a', 'SBA 7(a)'), formatMoney({ amount: tranche.amount, currency: tranche.currency }), tranche.status.replace(/_/g, ' ').toLowerCase(), tranche.documented ? 'document-backed' : 'buyer-attested']),
      );
      for (const blocker of plan.posture.blockers) w.text(`Open: ${blocker}`, { size: 9, after: 2 });
    }
  }

  if (model.postClose) {
    w.heading('Post-close register');
    w.table(
      [{ label: 'Action', width: 0.55 }, { label: 'Status', width: 0.2 }, { label: 'Due', width: 0.25 }],
      model.postClose.map((item) => [item.title ?? item.kind ?? '—', (item.status ?? '—').toLowerCase(), item.dueOn ?? '—']),
    );
  }
  return w.finish();
}

export async function executiveReportPdf(model: ExecutiveReportModel, meta: ReportStamp): Promise<{ bytes: Uint8Array; sha256: string }> {
  const w = await ReportWriter.create(meta);
  w.cover();
  w.heading('Across your pacts');
  const { rollup } = model;
  w.facts([
    ['Pacts', `${model.blocks.length}: ${rollup.openByPhase.PRE} pre-diligence, ${rollup.openByPhase.DILIGENCE} in diligence, ${rollup.openByPhase.POST} post-close`],
    ['Value in diligence', rollup.valueInDiligence.map((money) => formatMoney(money)).join(' · ') || '—'],
    ['Priced risk exposure', rollup.dragExposure.map((entry) => range(entry.low, entry.high, entry.currency)).join(' · ') || '—'],
  ]);
  w.text('Every total above is the sum of the pacts listed below.', { size: 8, color: MUTED, after: 6 });
  for (const role of ['BUYER', 'SELLER'] as const) {
    const blocks = model.blocks.filter((block) => block.role === role);
    if (blocks.length === 0) continue;
    w.heading(role === 'BUYER' ? 'As buyer' : 'As seller');
    w.table(
      [{ label: 'Pact', width: 0.26 }, { label: 'Phase', width: 0.12 }, { label: 'Asking', width: 0.15, align: 'right' }, { label: 'Priced (EV)', width: 0.15, align: 'right' }, { label: 'Findings', width: 0.17 }, { label: 'Next', width: 0.15 }],
      blocks.map((block) => [
        `${block.deal.name} (${block.deal.targetName})`,
        phaseLabel(block.deal.phase),
        formatMoney(block.asking),
        formatMoney(block.priced),
        `${block.findings.risks} risk · ${block.findings.cushions} value · ${block.findings.neutral} neutral${block.findings.undecided ? ` · ${block.findings.undecided} undecided` : ''}`,
        [block.openReview ? `${block.openReview} to review` : null, block.awaitingResponse ? 'terms awaiting you' : null].filter(Boolean).join(' · ') || `active ${block.lastActivity.slice(0, 10)}`,
      ]),
    );
    for (const block of blocks.filter((entry) => entry.topDrags.length)) {
      w.text(`${block.deal.name}: top priced risks`, { size: 9, font: 'semibold', after: 2 });
      for (const drag of block.topDrags) w.text(`• ${drag.title} — ${range(drag.low, drag.high, drag.currency)}`, { size: 8.5, indent: 8, after: 1 });
      w.text('', { size: 4, after: 4 });
    }
  }
  if (model.blocks.length === 0) w.text('No pacts yet.', { size: 10, color: MUTED });
  return w.finish();
}
