import type { SupportChatLocale } from '@pactlab/contracts';

/**
 * The panel's own words (T-175), in each surface locale until the app's catalog (T-172) takes them over.
 * The assistant's fixed sentences come from the API; these are only the panel around them.
 */
export interface HelpLabels {
  title: string;
  intro: string;
  placeholder: string;
  send: string;
  sending: string;
  close: string;
  sources: string;
  emailOffer: string;
  emailLabel: string;
  emailSend: string;
  sent: string;
  logIt: string;
  noThanks: string;
  logged: string;
  declinedBefore: string;
  failed: string;
  unavailable: string;
  limited: string;
  emailRequired: string;
  noPactData: string;
}

export const HELP_LABELS: Readonly<Record<SupportChatLocale, HelpLabels>> = {
  en: {
    title: 'Ask about Pactlab',
    intro: 'Ask how a feature works or how to do something. Answers come from Pactlab’s published guides, each with its source.',
    placeholder: 'How do I…?',
    send: 'Send',
    sending: 'Thinking…',
    close: 'Close help',
    sources: 'From',
    emailOffer: 'Email this to the team',
    emailLabel: 'Your email address, for the reply',
    emailSend: 'Send to the team',
    sent: 'Sent. The Pactlab team will reply by email.',
    logIt: 'Yes, log it',
    noThanks: 'No, thanks',
    logged: 'Logged for the team, with this conversation. Nothing is promised about whether or when it is built.',
    declinedBefore: 'The team looked at something like this before and decided not to build it.',
    failed: 'The help assistant could not be reached. Try again in a moment.',
    unavailable: 'This can’t be passed on from here right now.',
    limited: 'Too many messages from here; try again in an hour.',
    emailRequired: 'Add your email address so the team can reply.',
    noPactData: 'This assistant can’t see any pact, deal or document.',
  },
  de: {
    title: 'Fragen zu Pactlab',
    intro: 'Fragen Sie, wie eine Funktion arbeitet oder wie Sie etwas erledigen. Die Antworten stammen aus Pactlabs veröffentlichten Anleitungen, jeweils mit Quelle.',
    placeholder: 'Wie kann ich …?',
    send: 'Senden',
    sending: 'Einen Moment …',
    close: 'Hilfe schließen',
    sources: 'Quelle',
    emailOffer: 'Per E-Mail an das Team',
    emailLabel: 'Ihre E-Mail-Adresse für die Antwort',
    emailSend: 'An das Team senden',
    sent: 'Gesendet. Das Pactlab-Team antwortet per E-Mail.',
    logIt: 'Ja, festhalten',
    noThanks: 'Nein, danke',
    logged: 'Mit diesem Gespräch für das Team festgehalten. Ob oder wann es umgesetzt wird, ist nicht zugesagt.',
    declinedBefore: 'Das Team hat sich etwas Ähnliches schon einmal angesehen und beschlossen, es nicht umzusetzen.',
    failed: 'Der Hilfe-Assistent ist nicht erreichbar. Bitte versuchen Sie es gleich noch einmal.',
    unavailable: 'Das kann von hier aus gerade nicht weitergeleitet werden.',
    limited: 'Zu viele Nachrichten von hier; versuchen Sie es in einer Stunde erneut.',
    emailRequired: 'Geben Sie Ihre E-Mail-Adresse an, damit das Team antworten kann.',
    noPactData: 'Dieser Assistent sieht keinen Pact, keinen Deal und kein Dokument.',
  },
  fr: {
    title: 'Questions sur Pactlab',
    intro: 'Demandez comment fonctionne une fonctionnalité ou comment faire quelque chose. Les réponses viennent des guides publiés de Pactlab, chacune avec sa source.',
    placeholder: 'Comment puis-je… ?',
    send: 'Envoyer',
    sending: 'Un instant…',
    close: 'Fermer l’aide',
    sources: 'Source',
    emailOffer: 'Envoyer à l’équipe par e-mail',
    emailLabel: 'Votre adresse e-mail, pour la réponse',
    emailSend: 'Envoyer à l’équipe',
    sent: 'Envoyé. L’équipe Pactlab répondra par e-mail.',
    logIt: 'Oui, transmettre',
    noThanks: 'Non, merci',
    logged: 'Transmis à l’équipe avec cette conversation. Rien n’est promis quant à sa réalisation ni à sa date.',
    declinedBefore: 'L’équipe a déjà étudié une demande similaire et a décidé de ne pas la réaliser.',
    failed: 'L’assistant d’aide est injoignable. Réessayez dans un instant.',
    unavailable: 'Ce message ne peut pas être transmis d’ici pour le moment.',
    limited: 'Trop de messages depuis ici ; réessayez dans une heure.',
    emailRequired: 'Ajoutez votre adresse e-mail pour que l’équipe puisse répondre.',
    noPactData: 'Cet assistant ne voit aucun pact, aucune opération ni aucun document.',
  },
  ja: {
    title: 'Pactlab について質問する',
    intro: '機能の仕組みや操作方法をお尋ねください。回答は Pactlab の公開ガイドに基づき、出典を添えてお示しします。',
    placeholder: '〜するには？',
    send: '送信',
    sending: '確認しています…',
    close: 'ヘルプを閉じる',
    sources: '出典',
    emailOffer: 'チームにメールで送る',
    emailLabel: '返信先のメールアドレス',
    emailSend: 'チームに送信',
    sent: '送信しました。Pactlab チームからメールでご返信します。',
    logIt: 'はい、記録してください',
    noThanks: 'いいえ',
    logged: 'この会話とともにチームに記録しました。実現の有無や時期はお約束できません。',
    declinedBefore: 'チームは以前に似たご要望を検討し、実現しないと決めました。',
    failed: 'ヘルプアシスタントに接続できませんでした。少し待ってから再度お試しください。',
    unavailable: '現在、ここからはお送りできません。',
    limited: 'ここからのメッセージが多すぎます。1 時間後に再度お試しください。',
    emailRequired: 'チームが返信できるよう、メールアドレスを入力してください。',
    noPactData: 'このアシスタントは、パクト・案件・文書を一切見ることができません。',
  },
};

export function helpLocale(value: string | null | undefined): SupportChatLocale {
  const short = (value ?? '').toLowerCase().slice(0, 2);
  return short === 'de' || short === 'fr' || short === 'ja' ? short : 'en';
}
