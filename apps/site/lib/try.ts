import { COMPANY_TYPE_LABELS, demoDataFiles, demoDataFolderUrl, PACK_IDS, PACKS, type PackId } from '@pactlab/domain';
import type { IconName } from './icons';
import { PUBLISHED_INDUSTRIES } from './industry-stories';

/**
 * "Try it with synthetic data" (Kumar, 2026-11-13): pick a pact, download its synthetic data
 * room and extracts from the public demo data, and follow the steps. Every name and figure in
 * the files is invented; nothing here is a customer's.
 */
export interface TryStep {
  readonly icon: IconName;
  readonly title: string;
  readonly where: string;
  readonly do: readonly string[];
  readonly see: string;
}

export interface TryPack {
  readonly slug: string;
  readonly name: string;
  readonly type: PackId;
  readonly folderUrl: string;
  readonly dataRoomUrl: string;
  readonly extracts: readonly { label: string; fileName: string; url: string }[];
}

/** The packs people can try: the released ones the site shows, each with its demo files. */
export const TRY_PACKS: readonly TryPack[] = PUBLISHED_INDUSTRIES.flatMap((industry) => {
  const type = PACK_IDS.find((id) => PACKS[id].slug === industry.slug);
  if (!type) return [];
  const files = demoDataFiles(type);
  return [{ slug: industry.slug, name: industry.name, type, folderUrl: demoDataFolderUrl(type), dataRoomUrl: files.dataRoom, extracts: files.extracts }];
});

export const findTryPack = (slug: string) => TRY_PACKS.find((pack) => pack.slug === slug);

/** The walk through one pact, from an empty account to terms, with what each step shows. */
export function trySteps(pack: TryPack): readonly TryStep[] {
  const label = COMPANY_TYPE_LABELS[pack.type];
  const raise = pack.type === 'VENTURE_RAISE';
  return [
    {
      icon: 'Database',
      title: 'Download the synthetic data',
      where: 'This page',
      do: [`Download the data room (one zip) and the ${pack.extracts.length} extract file${pack.extracts.length === 1 ? '' : 's'} below.`, 'Keep them together; you upload them in steps 4 and 5.'],
      see: 'A fictional company’s files: contracts, financials and system extracts, with a few problems planted for Pactlab to find.',
    },
    {
      icon: 'Users',
      title: 'Create your organization',
      where: 'Sign up',
      do: ['Sign up with your work email and confirm the code we send.', 'Invite a colleague: findings are accepted by a second person.'],
      see: 'Your own private workspace. Nothing you upload is visible to anyone else.',
    },
    {
      icon: 'Handshake',
      title: raise ? 'Start a raise' : 'Start a pact',
      where: 'Start a Pact',
      do: raise
        ? ['Name the round and choose the company type “Venture Raise”.', 'Your startup is the company being diligenced; investors are the other side.']
        : [`Name the deal and choose the seller’s company type “${label}”.`, 'Add an asking price if you have one: Sextant measures against it.'],
      see: `The ${label} pack switches on: its checks, its metrics and its valuation methods.`,
    },
    {
      icon: 'FileText',
      title: 'Upload the data room',
      where: 'Diligence → Documents',
      do: ['Choose “Upload a data room” and pick the zip.', 'Answer any question Pactlab asks about a file it was unsure of.'],
      see: 'Each file read and filed as what it is: contracts, financial statements, extracts. Terms are drafted with exact page citations.',
    },
    {
      icon: 'Layers',
      title: 'Import the extracts',
      where: 'Diligence → Sources',
      do: pack.extracts.map((extract) => `${extract.label}: import ${extract.fileName}`),
      see: 'Every row checked as it lands; the metrics rebuilt from the records rather than from the deck.',
    },
    {
      icon: 'ClipboardList',
      title: 'Review the findings',
      where: 'Diligence → Findings',
      do: ['Run the checks, then open each draft finding and its evidence.', 'Price a risk, submit it, and have your colleague accept or reject it.'],
      see: 'The planted problems surface as findings, each linked to the rows and pages behind it, with seller statements marked verified or contradicted.',
    },
    {
      icon: 'Calculator',
      title: raise ? 'Model the round' : 'Price it with Sextant',
      where: raise ? 'Valuation → Raise' : 'Valuation → Scenarios and bridge',
      do: raise
        ? ['Set the round you are raising, and add the offers you received.', 'Compare them side by side.']
        : ['Add downside, base and upside scenarios; link the accepted risks.', 'Look at comparables, and judge the asking price.'],
      see: raise ? 'Dilution and preferences for each offer, explained as consequences.' : 'A price you can defend: from enterprise value to equity, moved by the risks you accepted.',
    },
    {
      icon: 'Signature',
      title: raise ? 'Share the investor view' : 'Propose the terms',
      where: raise ? 'Valuation → Raise' : 'Valuation → Proposed terms',
      do: raise ? ['Open the investor view: it holds verified facts only.'] : ['Draft the terms from the evaluation and propose them.', 'Invite a colleague as the seller to counter, then agree.'],
      see: raise ? 'What an investor will see, with nothing confidential in it.' : 'Each term tied to the risk that justifies it, then signed by both sides on the Closing tab.',
    },
  ];
}
