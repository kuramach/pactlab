/**
 * The privacy policy and terms of service (Kumar, 2026-11-23: "create the pages since I want to go live
 * soon"). Every statement here describes how Pactlab is actually built and run, from the code and
 * infrastructure; nothing is aspirational. Change the practice first, then these words, and bump the date.
 * Reviewed by counsel before relying on it for customers.
 */

export const LEGAL_ENTITY = 'Pactlab LLC';
export const LEGAL_CONTACT = 'support@pactlab.ai';
export const LEGAL_UPDATED = '2026-11-24';

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly string[];
}

export interface LegalDocument {
  readonly slug: 'privacy' | 'terms';
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly LegalSection[];
}

export const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy policy',
  summary: `How ${LEGAL_ENTITY} collects, uses and protects information when you use the Pactlab website and the Pactlab platform.`,
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [
        `${LEGAL_ENTITY} ("Pactlab", "we") operates pactlab.ai and the Pactlab deal platform at app.pactlab.ai. Pactlab is used by businesses (private equity firms, corporate development teams, their advisers, and the companies they are acquiring or investing in) to run diligence and deals.`,
        'For information that a customer organization puts into Pactlab (its deals, documents and evidence), that organization decides what is collected and why, and we process it on its behalf and under its instructions. This policy explains our own practices; a customer’s own privacy notice governs what it asks you to share.',
      ],
    },
    {
      heading: 'What we collect',
      items: [
        'Account information: your name, work email address, organization and role, and the sign-in methods you set up (one-time email codes, passkeys, or your organization’s identity provider). We never see or store a passkey’s private key.',
        'Deal content you or your organization add: documents and files you upload or connect, imported data (for example billing exports, rent rolls and profit and loss statements), and the findings, notes, assumptions, valuations and terms people create in a pact.',
        'Connected sources you choose to connect: read-only access to code repositories, delivery trackers, billing systems, OneDrive / SharePoint folders, and the Google Drive files you choose, limited to what you connect.',
        'Usage and security records: an audit trail of sensitive reads, decisions, exports, approvals and sign-ins, and technical logs needed to run and secure the service (for example the time, request identifier and outcome of a request).',
        'Messages you send us, such as support requests and pilot enquiries.',
      ],
    },
    {
      heading: 'How we use it',
      items: [
        'To provide the platform to you and your organization: storing and reading your documents, running the analysis you ask for, and showing results to the people your organization allows.',
        'To keep it secure: authentication, tenant isolation, abuse prevention, and the audit trail your organization can review.',
        'To operate the service: billing, sending service email (sign-in codes, invitations, notifications), support, and fixing problems.',
        'We do not sell personal information, we do not use it for advertising, and the website does not use advertising or analytics trackers.',
      ],
    },
    {
      heading: 'AI processing',
      paragraphs: [
        'Pactlab uses AI models to read, classify, extract from and summarize documents and data in a pact, as part of the features you use. Models assist; a person reviews and decides every finding, valuation and term.',
        'By default, models run on Amazon Bedrock inside our AWS account. Where an organization or Pactlab enables another model provider for a task (for example OpenAI, Google or Anthropic directly), content is sent to that provider only under data terms that do not allow it to train on or retain customer content beyond processing the request.',
        'Your content is not used to train AI models, by us or by any model provider. Named, compensation, performance and other people data is kept away from AI models.',
      ],
    },
    {
      heading: 'Google Drive and other connected sources',
      paragraphs: [
        'With Google Drive, you choose files in Google’s own file picker, and Pactlab asks Google only for access to the files you choose (the drive.file permission). Pactlab reads those files, and nothing else in your Drive, to bring them into the pact you chose them for. Files you add to a Drive folder later are not read unless you choose them too. Pactlab never creates, changes, moves, shares or deletes anything in your Drive.',
        'Information received from Google is used only to provide that feature to you: listing and reading the folder’s files into the pact, where they are handled like any other document in it (including the AI processing described above, for that pact only). It is not used for advertising, not sold, not used to train AI models, and not shared with anyone except as needed to provide the feature, to comply with law, or with your consent.',
        'Pactlab’s use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
        'With OneDrive / SharePoint, Pactlab asks Microsoft for read-only access (Files.Read.All) and reads the folder you connect, including files added to it later; the same commitments apply. Your sign-in to a source is kept encrypted and is deleted when you disconnect. You can also revoke Pactlab’s access at any time in your Google or Microsoft account settings.',
      ],
    },
    {
      heading: 'Who processes data for us',
      paragraphs: ['We use service providers to run Pactlab. They process data only to provide their service to us:'],
      items: [
        'Amazon Web Services: hosting, storage, databases, encryption keys, email delivery and AI models (Amazon Bedrock). Pactlab’s data is hosted in the United States (AWS US East, Ohio).',
        'Stripe: payments and billing.',
        'BoldSign, and DocuSign where an organization connects its own account: electronic signatures on agreed terms.',
        'Google and Microsoft: only when you connect a Drive file or a OneDrive folder, to read it.',
        'Other AI model providers: only where enabled for a task, as described above.',
      ],
    },
    {
      heading: 'How we protect it',
      items: [
        'Every organization’s data is isolated in the database itself: each query is limited to one organization and the deals a person belongs to.',
        'People from a company being acquired see only what the buyer chooses to share.',
        'Data is encrypted in transit and at rest, and credentials for connected sources are kept in a dedicated encrypted store.',
        'Source code from connected repositories is scanned in short-lived workspaces that are destroyed afterwards; it is never kept.',
        'Sensitive actions are recorded in a tamper-evident, append-only audit trail.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        `Documents carry a retention setting chosen when they are added: kept for the life of the deal, kept for 90 days, or held for legal reasons. People with the right role can delete a document at any time. To delete a whole deal or account, an organization’s administrators ask us at ${LEGAL_CONTACT}. When a customer’s account ends, we delete its content after any period agreed with it, except records we must keep by law. Audit records are kept so that an organization’s decisions remain traceable.`,
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: ['The platform uses cookies only to keep you signed in and to keep the service secure. The website uses no advertising or analytics cookies.'],
    },
    {
      heading: 'Your choices and rights',
      paragraphs: [
        `You can ask to see, correct, export or delete personal information we hold about you by writing to ${LEGAL_CONTACT}. If your information is in a customer organization’s pact, we will work with that organization, which decides what happens to its content. Depending on where you live, you may have further rights under local law, including the right to complain to a data protection authority.`,
      ],
    },
    {
      heading: 'Children',
      paragraphs: ['Pactlab is a business service and is not meant for anyone under 18.'],
    },
    {
      heading: 'Changes',
      paragraphs: ['We will update this page when our practices change and show the date at the top. If a change is significant, we will tell customer administrators before it takes effect.'],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions about privacy: ${LEGAL_CONTACT}.`],
    },
  ],
};

export const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms of service',
  summary: `The terms on which ${LEGAL_ENTITY} provides the Pactlab website and platform.`,
  sections: [
    {
      heading: 'Agreement',
      paragraphs: [
        `These terms are an agreement between you and ${LEGAL_ENTITY} ("Pactlab", "we"). By creating an account or using the Pactlab platform, you agree to them on behalf of yourself and the organization you use it for, and you confirm you are authorized to do so. If your organization has signed a separate agreement with us, that agreement governs where it differs from these terms.`,
      ],
    },
    {
      heading: 'The service',
      paragraphs: [
        'Pactlab is a deal platform for diligence, valuation, deal terms and closing. Features may change as we improve the service; if we remove a feature your organization pays for, we will tell you in advance.',
        'Some features are offered as a pilot or in preview. They may change or stop, and are provided as they are.',
      ],
    },
    {
      heading: 'Accounts',
      items: [
        'Keep your sign-in methods secure and tell us at once if you think someone else has used your account.',
        'Your organization’s administrators control who joins, what roles they have and which deals they see.',
        'You are responsible for what is done through your account.',
      ],
    },
    {
      heading: 'Your content',
      paragraphs: [
        'You and your organization own the documents, data and other content you put into Pactlab, and the work product you create with it. You give us permission to host, process and display that content only as needed to provide the service to you, as described in our privacy policy.',
        'You confirm you have the right to share the content you add, including any confidentiality obligations to the other parties to a deal, and that adding it does not break the law or anyone’s rights.',
      ],
    },
    {
      heading: 'AI results and decisions',
      paragraphs: [
        'Pactlab uses AI to read documents and draft findings, extractions and summaries, each with a citation to its source. AI output can be wrong or incomplete. It is a starting point for review, not a conclusion: a person on your team reviews and decides every finding, valuation, price and term.',
        'Pactlab does not give legal, tax, accounting, financial or investment advice, and its output is not a substitute for your own judgment or for advice from qualified professionals. You are responsible for the decisions you make.',
      ],
    },
    {
      heading: 'Connected services',
      paragraphs: [
        'You can connect services such as code repositories, billing systems and drive folders. Pactlab reads them with the read-only access you grant. Your use of those services is governed by their own terms, and we are not responsible for them or for their availability.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: ['You will not:'],
      items: [
        'access another organization’s data, or try to get around the platform’s security or access controls;',
        'upload malware, or content you have no right to share;',
        'use the service to break the law or anyone’s rights;',
        'overload, disrupt, copy or reverse-engineer the service, or resell it without our agreement.',
      ],
    },
    {
      heading: 'Fees',
      paragraphs: [
        'Paid plans are billed as shown when you buy them or as set out in your order. Payments are processed by Stripe. Fees are non-refundable except where the law or your order says otherwise. We will give notice before changing the price of a plan you have already bought.',
      ],
    },
    {
      heading: 'Confidentiality',
      paragraphs: [
        'We treat your content as confidential and use it only to provide the service. We disclose it only to the people your organization allows, to service providers who need it to run the service under equivalent obligations, or where the law requires, in which case we will tell you if we lawfully can.',
      ],
    },
    {
      heading: 'Ending the agreement',
      paragraphs: [
        'You can stop using Pactlab at any time. We may suspend or end access if these terms are seriously broken, if needed to protect the service or other customers, or if fees remain unpaid after notice. When an account ends, we provide a copy of the organization’s content on request for a period we agree, after which it is deleted as described in our privacy policy.',
      ],
    },
    {
      heading: 'Disclaimers',
      paragraphs: [
        'To the extent the law allows, the service is provided "as is" and "as available", and we disclaim all warranties not expressly stated in these terms, including fitness for a particular purpose and that the service will be uninterrupted or error-free.',
      ],
    },
    {
      heading: 'Limitation of liability',
      paragraphs: [
        'To the extent the law allows, neither party is liable for indirect, incidental, special or consequential damages, or for lost profits, revenue, data or goodwill. Our total liability arising from these terms or the service is limited to the fees your organization paid us for the service in the twelve months before the claim arose. These limits do not apply to liability that cannot be limited by law.',
      ],
    },
    {
      heading: 'Governing law',
      paragraphs: ['These terms are governed by the laws of the State of Texas, without regard to its conflict-of-law rules. The state and federal courts located in Texas have exclusive jurisdiction over any dispute arising from them.'],
    },
    {
      heading: 'Changes',
      paragraphs: ['We may update these terms and will show the date at the top. If a change is significant, we will tell customer administrators before it takes effect; continuing to use the service after that means you accept it.'],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions about these terms: ${LEGAL_CONTACT}.`],
    },
  ],
};
