import type { BillingSystem } from '@pactlab/domain';
import { FileQuestion, FileSpreadsheet, type LucideIcon } from 'lucide-react';

/**
 * A mark for each billing system on the upload form. Brand marks are the
 * simple-icons 16.35.0 paths (24×24, single path, drawn in currentColor);
 * each names its brand-resource source. Brands simple-icons does not carry
 * (Oracle, NetSuite, Zuora, Chargebee) get a lettered monogram rather than a
 * hand-drawn logo. Decorative only: the system label is the accessible name.
 */
export type SystemMark =
  | { readonly kind: 'brand'; readonly path: string; readonly source: string }
  | { readonly kind: 'monogram'; readonly letters: string }
  | { readonly kind: 'icon'; readonly icon: LucideIcon };

const SAP: SystemMark = {
  kind: 'brand',
  source: 'https://www.sap.com',
  path: 'M0 6.064v11.872h12.13L24 6.064zm3.264 2.208h.005c.863.001 1.915.245 2.676.633l-.82 1.43c-.835-.404-1.255-.442-1.73-.467-.708-.038-1.064.215-1.069.488-.007.332.669.633 1.305.838.964.306 2.19.715 2.377 1.9L7.77 8.437h2.046l2.064 5.576-.007-5.575h2.37c2.257 0 3.318.764 3.318 2.519 0 1.575-1.09 2.514-2.936 2.514h-.763l-.01 2.094-3.588-.003-.25-.908c-.37.122-.787.189-1.23.189-.456 0-.885-.071-1.263-.2l-.358.919-2 .006.09-.462c-.029.025-.057.05-.087.074-.535.43-1.208.629-2.037.644l-.213.002a5.075 5.075 0 0 1-2.581-.675l.73-1.448c.79.467 1.286.572 1.956.558.347-.007.598-.07.761-.239a.557.557 0 0 0 .156-.369c.007-.376-.53-.553-1.185-.756-.531-.164-1.135-.389-1.606-.735-.559-.41-.825-.924-.812-1.65a1.99 1.99 0 0 1 .566-1.377c.519-.537 1.357-.863 2.363-.863zm10.597 1.67v1.904h.521c.694 0 1.247-.23 1.248-.964 0-.709-.554-.94-1.248-.94zm-5.087.767l-.748 2.362c.223.085.481.133.757.133.268 0 .52-.047.742-.126l-.736-2.37z',
};

export const SYSTEM_MARKS = {
  stripe: {
    kind: 'brand',
    source: 'https://stripe.com/newsroom/information',
    path: 'M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z',
  },
  quickbooks: {
    kind: 'brand',
    source: 'https://design.intuit.com/quickbooks/brand',
    path: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm.642 4.1335c.9554 0 1.7296.776 1.7296 1.7332v9.0667h1.6c1.614 0 2.9275-1.3156 2.9275-2.933 0-1.6173-1.3136-2.9333-2.9276-2.9333h-.6654V7.3334h.6654c2.5722 0 4.6577 2.0897 4.6577 4.667 0 2.5774-2.0855 4.6666-4.6577 4.6666H12.642zM7.9837 7.333h3.3291v12.533c-.9555 0-1.73-.7759-1.73-1.7332V9.0662H7.9837c-1.6146 0-2.9277 1.316-2.9277 2.9334 0 1.6175 1.3131 2.9333 2.9277 2.9333h.6654v1.7332h-.6654c-2.5725 0-4.6577-2.0892-4.6577-4.6665 0-2.5771 2.0852-4.6666 4.6577-4.6666Z',
  },
  sap_s4hana: SAP,
  sap_ecc: SAP,
  netsuite: { kind: 'monogram', letters: 'NS' },
  oracle_fusion: { kind: 'monogram', letters: 'OR' },
  zuora: { kind: 'monogram', letters: 'Z' },
  chargebee: { kind: 'monogram', letters: 'CB' },
  pactlab_standard: { kind: 'icon', icon: FileSpreadsheet },
  other: { kind: 'icon', icon: FileQuestion },
} as const satisfies Record<BillingSystem, SystemMark>;

/** Initials of a label, for a system id this form does not know yet. */
export function monogramOf(label: string): string {
  const [first = '?', second] = label.match(/[A-Za-z0-9]+/g) ?? [];
  return (second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}

export function markFor(system: string, label: string): SystemMark {
  return (SYSTEM_MARKS as Readonly<Record<string, SystemMark>>)[system] ?? { kind: 'monogram', letters: monogramOf(label) };
}

/** The mark on a fixed-size tile beside the system label. */
export function SystemLogo({ system, label }: { system: string; label: string }) {
  const mark = markFor(system, label);
  return (
    <span
      aria-hidden="true"
      data-logo={mark.kind}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-navy/5 text-navy ring-1 ring-inset ring-navy/10"
    >
      {mark.kind === 'brand' ? (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" focusable="false">
          <path d={mark.path} />
        </svg>
      ) : mark.kind === 'icon' ? (
        <mark.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      ) : (
        <span className="text-[11px] font-bold tracking-tight">{mark.letters}</span>
      )}
    </span>
  );
}
