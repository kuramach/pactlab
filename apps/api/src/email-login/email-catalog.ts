import type { NotificationEventType } from '@pactlab/domain';

/**
 * Outbound email in the recipient's language (T-174, ADR 0067). One typed catalog per language;
 * English is the source. A language missing a string fails typecheck (`satisfies`), never falls
 * back to English string by string. Same convention as the app's catalogs (ADR 0064).
 *
 * The tagline and the note about Pactlab are the site's renderings (T-171, `valueTitle`); they are
 * translated, never dropped. Pactlab is never translated.
 */
export const EMAIL_LOCALES = ['en', 'de', 'fr', 'ja'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

const isEmailLocale = (value: string): value is EmailLocale => (EMAIL_LOCALES as readonly string[]).includes(value);

/**
 * The first offered language among the candidates, in order (the person's choice, the
 * organization's default, the page the request came from), else English. A region tag (`de-AT`)
 * counts as its language; anything else is skipped.
 */
export function resolveEmailLocale(...candidates: readonly (string | null | undefined)[]): EmailLocale {
  for (const candidate of candidates) {
    const language = candidate?.trim().toLowerCase().split(/[-_]/)[0];
    if (language && isEmailLocale(language)) return language;
  }
  return 'en';
}

/** Pact roles, as an invitation names them. */
export type InvitationRole = 'DEAL_LEAD' | 'ANALYST' | 'REVIEWER' | 'ADVISER' | 'TARGET_CONTRIBUTOR' | 'VIEWER' | 'BIDDER' | 'INVESTMENT_COMMITTEE' | 'INVESTOR';
export type InvitationSide = 'BUYER' | 'SELLER' | 'ADVISOR' | 'BIDDER' | 'INVESTOR';

export interface EmailCopy {
  readonly layout: {
    readonly tagline: string;
    readonly blurb: string;
    readonly learnMore: string;
    readonly pasteLink: string;
    readonly defaultReason: string;
    readonly sentFor: (organization: string) => string;
  };
  readonly signInCode: {
    readonly subject: string;
    readonly heading: string;
    readonly enter: string;
    readonly textCode: (code: string) => string;
    readonly expires: (minutes: number) => string;
    readonly ignore: string;
  };
  readonly signupCode: {
    readonly subject: string;
    readonly heading: string;
    readonly enter: string;
    readonly textCode: (code: string) => string;
    readonly expires: (minutes: number) => string;
    readonly ignore: string;
  };
  readonly invitation: {
    readonly subject: (inviter: string) => string;
    readonly heading: (pact: string) => string;
    /** "Ann invited you to “Atlas” on Pactlab, the buyer side (analyst)." Role is omitted for bidders and investors. */
    readonly body: (inviter: string, pact: string, side: string, role: string | null) => string;
    readonly onlyThisPact: string;
    readonly open: string;
    readonly expires: (days: number) => string;
    readonly ignore: string;
    readonly sides: Readonly<Record<InvitationSide, string>>;
    readonly roles: Readonly<Record<InvitationRole, string>>;
  };
  readonly notification: {
    readonly titles: Readonly<Record<NotificationEventType, string>>;
    readonly onPact: (pact: string) => string;
    readonly open: string;
    readonly openText: (url: string) => string;
    readonly reason: (settingsUrl: string) => string;
  };
  readonly digest: {
    readonly subject: (count: number) => string;
    readonly heading: string;
    readonly intro: (count: number) => string;
    readonly listHeading: string;
    readonly more: (count: number) => string;
    readonly seeAll: (url: string) => string;
    readonly open: string;
  };
}

const enUpdates = (count: number) => (count === 1 ? '1 update' : `${count} updates`);

const en = {
  layout: {
    tagline: 'Test the pact before you sign it.',
    blurb: 'Pactlab checks every claim in an M&A deal against the evidence: revenue, code, contracts, people. Every finding is cited, and the decisions stay with you.',
    learnMore: 'Learn more',
    pasteLink: 'Or paste this link into your browser:',
    defaultReason: 'You received this email because of an action on your Pactlab account.',
    sentFor: (organization) => `Sent with Pactlab for ${organization}`,
  },
  signInCode: {
    subject: 'Your Pactlab sign-in code',
    heading: 'Your sign-in code',
    enter: 'Enter this code on the Pactlab sign-in page:',
    textCode: (code) => `Your Pactlab sign-in code is ${code}.`,
    expires: (minutes) => `It expires in ${minutes} minutes and works once.`,
    ignore: 'If you did not try to sign in, ignore this email.',
  },
  signupCode: {
    subject: 'Confirm your Pactlab sign-up',
    heading: 'Confirm your sign-up',
    enter: 'Enter this code to finish creating your Pactlab account:',
    textCode: (code) => `Your Pactlab sign-up code is ${code}.`,
    expires: (minutes) => `It expires in ${minutes} minutes and works once.`,
    ignore: 'If you did not sign up for Pactlab, ignore this email.',
  },
  invitation: {
    subject: (inviter) => `${inviter} invited you to a pact on Pactlab`,
    heading: (pact) => `You're invited to “${pact}”`,
    body: (inviter, pact, side, role) => `${inviter} invited you to “${pact}” on Pactlab, ${side}${role ? ` (${role})` : ''}.`,
    onlyThisPact: 'You join this pact only — not the inviting company.',
    open: 'Open the invitation',
    expires: (days) => `The link works once and expires in ${days} days.`,
    ignore: 'If you were not expecting this, ignore this email.',
    sides: { BUYER: 'the buyer side', SELLER: 'the seller side', ADVISOR: 'as an advisor', BIDDER: 'as a bidder', INVESTOR: 'as an investor in the vehicle' },
    roles: {
      DEAL_LEAD: 'deal lead',
      ANALYST: 'analyst',
      REVIEWER: 'reviewer',
      ADVISER: 'adviser',
      TARGET_CONTRIBUTOR: 'target contributor',
      VIEWER: 'viewer',
      BIDDER: 'bidder',
      INVESTMENT_COMMITTEE: 'investment committee',
      INVESTOR: 'investor',
    },
  },
  notification: {
    titles: {
      SIGNATURE_REQUESTED: 'Your signature is requested',
      TERMS_PROPOSED: 'New terms are waiting for your answer',
      TERMS_COUNTERED: 'The other side answered your terms',
      DEADLINE_NEAR: 'A deadline is less than two days away',
      IC_DECIDED: 'The investment committee has decided',
      QUESTION_ASKED: 'A question is waiting for you',
      DOCUMENT_ADDED: 'The other side added a document',
      FINDING_DRAFTED: 'A finding was drafted',
      FINDING_DECIDED: 'A finding was reviewed',
      MEMBER_ADDED: 'Someone joined the pact',
      VALUATION_SUBMITTED: 'A valuation scenario was submitted',
      SYNC_FINISHED: 'A data sync finished',
      SYNC_FAILED: 'A data sync failed',
    },
    onPact: (pact) => `On ${pact}.`,
    open: 'Open in Pactlab',
    openText: (url) => `Open it in Pactlab: ${url}`,
    reason: (settingsUrl) => `You are on this pact in Pactlab. Choose what you are emailed about in Settings → Notifications: ${settingsUrl}`,
  },
  digest: {
    subject: (count) => `Your Pactlab digest: ${enUpdates(count)}`,
    heading: 'Your Pactlab digest',
    intro: (count) => `What changed on your pacts since your last digest (${enUpdates(count)}).`,
    listHeading: 'What changed',
    more: (count) => `And ${count} more in Pactlab.`,
    seeAll: (url) => `See everything in Pactlab: ${url}`,
    open: 'Open your notifications',
  },
} as const satisfies EmailCopy;

const deUpdates = (count: number) => (count === 1 ? '1 Neuigkeit' : `${count} Neuigkeiten`);

/** German. Machine-made; native review pending (docs/runbooks/app-translations.md). */
const de = {
  layout: {
    tagline: 'Prüfen Sie den Pakt, bevor Sie ihn unterschreiben.',
    blurb: 'Pactlab prüft jede Aussage in einer M&A-Transaktion anhand der Belege: Umsatz, Code, Verträge, Personal. Jeder Befund ist belegt, und die Entscheidungen bleiben bei Ihnen.',
    learnMore: 'Mehr erfahren',
    pasteLink: 'Oder fügen Sie diesen Link in Ihren Browser ein:',
    defaultReason: 'Sie erhalten diese E-Mail wegen einer Aktion in Ihrem Pactlab-Konto.',
    sentFor: (organization) => `Mit Pactlab gesendet für ${organization}`,
  },
  signInCode: {
    subject: 'Ihr Pactlab-Anmeldecode',
    heading: 'Ihr Anmeldecode',
    enter: 'Geben Sie diesen Code auf der Pactlab-Anmeldeseite ein:',
    textCode: (code) => `Ihr Pactlab-Anmeldecode lautet ${code}.`,
    expires: (minutes) => `Er läuft in ${minutes} Minuten ab und gilt einmal.`,
    ignore: 'Wenn Sie sich nicht anmelden wollten, ignorieren Sie diese E-Mail.',
  },
  signupCode: {
    subject: 'Bestätigen Sie Ihre Registrierung bei Pactlab',
    heading: 'Registrierung bestätigen',
    enter: 'Geben Sie diesen Code ein, um Ihr Pactlab-Konto fertig einzurichten:',
    textCode: (code) => `Ihr Pactlab-Registrierungscode lautet ${code}.`,
    expires: (minutes) => `Er läuft in ${minutes} Minuten ab und gilt einmal.`,
    ignore: 'Wenn Sie sich nicht bei Pactlab registriert haben, ignorieren Sie diese E-Mail.',
  },
  invitation: {
    subject: (inviter) => `${inviter} hat Sie zu einem Pakt auf Pactlab eingeladen`,
    heading: (pact) => `Einladung zu „${pact}“`,
    body: (inviter, pact, side, role) => `${inviter} hat Sie zu „${pact}“ auf Pactlab eingeladen, ${side}${role ? ` (${role})` : ''}.`,
    onlyThisPact: 'Sie treten nur diesem Pakt bei, nicht dem einladenden Unternehmen.',
    open: 'Einladung öffnen',
    expires: (days) => `Der Link gilt einmal und läuft in ${days} Tagen ab.`,
    ignore: 'Wenn Sie das nicht erwartet haben, ignorieren Sie diese E-Mail.',
    sides: { BUYER: 'auf der Käuferseite', SELLER: 'auf der Verkäuferseite', ADVISOR: 'als Berater', BIDDER: 'als Bieter', INVESTOR: 'als Investor im Vehikel' },
    roles: {
      DEAL_LEAD: 'Deal-Lead',
      ANALYST: 'Analyst',
      REVIEWER: 'Prüfer',
      ADVISER: 'Berater',
      TARGET_CONTRIBUTOR: 'Mitwirkender des Zielunternehmens',
      VIEWER: 'Leser',
      BIDDER: 'Bieter',
      INVESTMENT_COMMITTEE: 'Investitionskomitee',
      INVESTOR: 'Investor',
    },
  },
  notification: {
    titles: {
      SIGNATURE_REQUESTED: 'Ihre Unterschrift wird erbeten',
      TERMS_PROPOSED: 'Neue Konditionen warten auf Ihre Antwort',
      TERMS_COUNTERED: 'Die Gegenseite hat auf Ihre Konditionen geantwortet',
      DEADLINE_NEAR: 'Eine Frist endet in weniger als zwei Tagen',
      IC_DECIDED: 'Das Investitionskomitee hat entschieden',
      QUESTION_ASKED: 'Eine Frage wartet auf Sie',
      DOCUMENT_ADDED: 'Die Gegenseite hat ein Dokument hinzugefügt',
      FINDING_DRAFTED: 'Ein Befund wurde entworfen',
      FINDING_DECIDED: 'Ein Befund wurde geprüft',
      MEMBER_ADDED: 'Jemand ist dem Pakt beigetreten',
      VALUATION_SUBMITTED: 'Ein Bewertungsszenario wurde eingereicht',
      SYNC_FINISHED: 'Eine Datensynchronisierung ist abgeschlossen',
      SYNC_FAILED: 'Eine Datensynchronisierung ist fehlgeschlagen',
    },
    onPact: (pact) => `Im Pakt ${pact}.`,
    open: 'In Pactlab öffnen',
    openText: (url) => `In Pactlab öffnen: ${url}`,
    reason: (settingsUrl) => `Sie sind in Pactlab an diesem Pakt beteiligt. Worüber Sie E-Mails erhalten, legen Sie unter Einstellungen → Benachrichtigungen fest: ${settingsUrl}`,
  },
  digest: {
    subject: (count) => `Ihre Pactlab-Übersicht: ${deUpdates(count)}`,
    heading: 'Ihre Pactlab-Übersicht',
    intro: (count) => `Was sich seit Ihrer letzten Übersicht in Ihren Pakten geändert hat (${deUpdates(count)}).`,
    listHeading: 'Was sich geändert hat',
    more: (count) => `Und ${count} weitere in Pactlab.`,
    seeAll: (url) => `Alles in Pactlab ansehen: ${url}`,
    open: 'Benachrichtigungen öffnen',
  },
} as const satisfies EmailCopy;

const frUpdates = (count: number) => (count === 1 ? '1 nouveauté' : `${count} nouveautés`);

/** French. Machine-made; native review pending. */
const fr = {
  layout: {
    tagline: 'Testez le pacte avant de le signer.',
    blurb: 'Pactlab vérifie chaque affirmation d’une opération de fusion-acquisition au regard des preuves : chiffre d’affaires, code, contrats, équipes. Chaque constat est sourcé, et les décisions vous appartiennent.',
    learnMore: 'En savoir plus',
    pasteLink: 'Ou collez ce lien dans votre navigateur :',
    defaultReason: 'Vous recevez cet e-mail en raison d’une action sur votre compte Pactlab.',
    sentFor: (organization) => `Envoyé avec Pactlab pour ${organization}`,
  },
  signInCode: {
    subject: 'Votre code de connexion Pactlab',
    heading: 'Votre code de connexion',
    enter: 'Saisissez ce code sur la page de connexion de Pactlab :',
    textCode: (code) => `Votre code de connexion Pactlab est ${code}.`,
    expires: (minutes) => `Il expire dans ${minutes} minutes et ne sert qu’une fois.`,
    ignore: 'Si vous n’avez pas essayé de vous connecter, ignorez cet e-mail.',
  },
  signupCode: {
    subject: 'Confirmez votre inscription à Pactlab',
    heading: 'Confirmez votre inscription',
    enter: 'Saisissez ce code pour finir de créer votre compte Pactlab :',
    textCode: (code) => `Votre code d’inscription Pactlab est ${code}.`,
    expires: (minutes) => `Il expire dans ${minutes} minutes et ne sert qu’une fois.`,
    ignore: 'Si vous ne vous êtes pas inscrit à Pactlab, ignorez cet e-mail.',
  },
  invitation: {
    subject: (inviter) => `${inviter} vous a invité à un pacte sur Pactlab`,
    heading: (pact) => `Vous êtes invité à « ${pact} »`,
    body: (inviter, pact, side, role) => `${inviter} vous a invité à « ${pact} » sur Pactlab, ${side}${role ? ` (${role})` : ''}.`,
    onlyThisPact: 'Vous rejoignez ce pacte uniquement, pas l’entreprise qui vous invite.',
    open: 'Ouvrir l’invitation',
    expires: (days) => `Le lien ne sert qu’une fois et expire dans ${days} jours.`,
    ignore: 'Si vous ne vous y attendiez pas, ignorez cet e-mail.',
    sides: { BUYER: 'côté acheteur', SELLER: 'côté vendeur', ADVISOR: 'en tant que conseil', BIDDER: 'en tant qu’enchérisseur', INVESTOR: 'en tant qu’investisseur dans le véhicule' },
    roles: {
      DEAL_LEAD: 'responsable de l’opération',
      ANALYST: 'analyste',
      REVIEWER: 'réviseur',
      ADVISER: 'conseil',
      TARGET_CONTRIBUTOR: 'contributeur de la cible',
      VIEWER: 'lecteur',
      BIDDER: 'enchérisseur',
      INVESTMENT_COMMITTEE: 'comité d’investissement',
      INVESTOR: 'investisseur',
    },
  },
  notification: {
    titles: {
      SIGNATURE_REQUESTED: 'Votre signature est demandée',
      TERMS_PROPOSED: 'De nouvelles conditions attendent votre réponse',
      TERMS_COUNTERED: 'L’autre partie a répondu à vos conditions',
      DEADLINE_NEAR: 'Une échéance tombe dans moins de deux jours',
      IC_DECIDED: 'Le comité d’investissement a décidé',
      QUESTION_ASKED: 'Une question vous attend',
      DOCUMENT_ADDED: 'L’autre partie a ajouté un document',
      FINDING_DRAFTED: 'Un constat a été rédigé',
      FINDING_DECIDED: 'Un constat a été examiné',
      MEMBER_ADDED: 'Quelqu’un a rejoint le pacte',
      VALUATION_SUBMITTED: 'Un scénario de valorisation a été soumis',
      SYNC_FINISHED: 'Une synchronisation de données est terminée',
      SYNC_FAILED: 'Une synchronisation de données a échoué',
    },
    onPact: (pact) => `Sur ${pact}.`,
    open: 'Ouvrir dans Pactlab',
    openText: (url) => `Ouvrir dans Pactlab : ${url}`,
    reason: (settingsUrl) => `Vous participez à ce pacte dans Pactlab. Choisissez les e-mails que vous recevez dans Paramètres → Notifications : ${settingsUrl}`,
  },
  digest: {
    subject: (count) => `Votre récapitulatif Pactlab : ${frUpdates(count)}`,
    heading: 'Votre récapitulatif Pactlab',
    intro: (count) => `Ce qui a changé sur vos pactes depuis votre dernier récapitulatif (${frUpdates(count)}).`,
    listHeading: 'Ce qui a changé',
    more: (count) => `Et ${count} de plus dans Pactlab.`,
    seeAll: (url) => `Tout voir dans Pactlab : ${url}`,
    open: 'Ouvrir vos notifications',
  },
} as const satisfies EmailCopy;

/** Japanese. Machine-made; native review pending. */
const ja = {
  layout: {
    tagline: '署名する前に、パクトを検証する。',
    blurb: 'Pactlabは、M&A取引のあらゆる主張を、売上・コード・契約・人材という証拠に照らして検証します。すべての指摘には出典があり、判断はあなたに委ねられます。',
    learnMore: '詳しく見る',
    pasteLink: 'または、このリンクをブラウザに貼り付けてください：',
    defaultReason: 'このメールは、お使いのPactlabアカウントでの操作により送信されました。',
    sentFor: (organization) => `${organization} のためにPactlabから送信`,
  },
  signInCode: {
    subject: 'Pactlabのサインインコード',
    heading: 'サインインコード',
    enter: 'Pactlabのサインインページで次のコードを入力してください：',
    textCode: (code) => `Pactlabのサインインコードは ${code} です。`,
    expires: (minutes) => `有効期限は${minutes}分で、1回だけ使えます。`,
    ignore: 'サインインしようとしていない場合は、このメールを無視してください。',
  },
  signupCode: {
    subject: 'Pactlabへの登録の確認',
    heading: '登録の確認',
    enter: 'Pactlabアカウントの作成を完了するには、次のコードを入力してください：',
    textCode: (code) => `Pactlabの登録コードは ${code} です。`,
    expires: (minutes) => `有効期限は${minutes}分で、1回だけ使えます。`,
    ignore: 'Pactlabに登録していない場合は、このメールを無視してください。',
  },
  invitation: {
    subject: (inviter) => `${inviter}さんからPactlabのパクトへの招待が届きました`,
    heading: (pact) => `「${pact}」への招待`,
    body: (inviter, pact, side, role) => `${inviter}さんが、Pactlabの「${pact}」に${side}${role ? `（${role}）` : ''}としてあなたを招待しました。`,
    onlyThisPact: '参加するのはこのパクトだけで、招待元の会社には参加しません。',
    open: '招待を開く',
    expires: (days) => `リンクは1回だけ使え、${days}日後に期限切れになります。`,
    ignore: '心当たりがない場合は、このメールを無視してください。',
    sides: { BUYER: '買い手側', SELLER: '売り手側', ADVISOR: 'アドバイザー', BIDDER: '入札者', INVESTOR: 'ビークルの投資家' },
    roles: {
      DEAL_LEAD: 'ディールリード',
      ANALYST: 'アナリスト',
      REVIEWER: 'レビュアー',
      ADVISER: 'アドバイザー',
      TARGET_CONTRIBUTOR: '対象会社の協力者',
      VIEWER: '閲覧者',
      BIDDER: '入札者',
      INVESTMENT_COMMITTEE: '投資委員会',
      INVESTOR: '投資家',
    },
  },
  notification: {
    titles: {
      SIGNATURE_REQUESTED: '署名が求められています',
      TERMS_PROPOSED: '新しい条件があなたの回答を待っています',
      TERMS_COUNTERED: '相手方があなたの条件に回答しました',
      DEADLINE_NEAR: '期限まで2日を切りました',
      IC_DECIDED: '投資委員会が決定しました',
      QUESTION_ASKED: '質問があなたを待っています',
      DOCUMENT_ADDED: '相手方が文書を追加しました',
      FINDING_DRAFTED: '指摘事項が起案されました',
      FINDING_DECIDED: '指摘事項がレビューされました',
      MEMBER_ADDED: 'パクトに新しいメンバーが参加しました',
      VALUATION_SUBMITTED: 'バリュエーションのシナリオが提出されました',
      SYNC_FINISHED: 'データの同期が完了しました',
      SYNC_FAILED: 'データの同期に失敗しました',
    },
    onPact: (pact) => `パクト：${pact}`,
    open: 'Pactlabで開く',
    openText: (url) => `Pactlabで開く：${url}`,
    reason: (settingsUrl) => `あなたはPactlabでこのパクトに参加しています。メールで受け取る内容は「設定 → 通知」で選べます：${settingsUrl}`,
  },
  digest: {
    subject: (count) => `Pactlabダイジェスト：更新${count}件`,
    heading: 'Pactlabダイジェスト',
    intro: (count) => `前回のダイジェスト以降にあなたのパクトで変わったこと（更新${count}件）。`,
    listHeading: '変わったこと',
    more: (count) => `ほか${count}件はPactlabで確認できます。`,
    seeAll: (url) => `すべてPactlabで見る：${url}`,
    open: '通知を開く',
  },
} as const satisfies EmailCopy;

export const EMAIL_COPY: Readonly<Record<EmailLocale, EmailCopy>> = { en, de, fr, ja };
