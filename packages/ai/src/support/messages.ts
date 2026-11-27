import type { SupportLocale } from './corpus';

/**
 * The assistant's fixed sentences (T-175), in each surface locale. These never come from a model: the
 * boundary, the don't-know, the language note and the feature-request confirmation say exactly this.
 */
export interface SupportMessages {
  readonly boundary: string;
  readonly dontKnow: string;
  readonly unavailable: string;
  /** Said when the corpus is not yet published in the page's language: the answer that follows is in English. */
  readonly englishOnly: string;
  /** `{summary}` is the request in the visitor's words, as the assistant understood it. */
  readonly featureConfirm: string;
  readonly limited: string;
}

export const SUPPORT_MESSAGES: Readonly<Record<SupportLocale, SupportMessages>> = {
  en: {
    boundary:
      'I can only help with how Pactlab works. I can’t see any pact, deal, document or finding — yours or anyone else’s — so I can’t answer questions about what they contain. Open the pact itself to see it there, or I can pass your question to the Pactlab team by email.',
    dontKnow: 'I don’t know — Pactlab’s guides don’t cover that, and I won’t guess. I can pass your question to the Pactlab team by email, with this conversation attached.',
    unavailable: 'The help assistant isn’t available right now. You can still send your question to the Pactlab team by email.',
    englishOnly: '',
    featureConfirm: 'You’d like {summary}. Shall I log that for the team? It goes to the people who decide what Pactlab builds; I can’t say whether or when it will be built.',
    limited: 'That’s a lot of questions in a short time. Please wait a few minutes and ask again.',
  },
  de: {
    boundary:
      'Ich kann nur erklären, wie Pactlab funktioniert. Ich sehe keinen Pact, keinen Deal, kein Dokument und keinen Befund – weder Ihre noch die anderer –, deshalb kann ich keine Fragen zu deren Inhalt beantworten. Öffnen Sie den Pact selbst, um ihn dort zu sehen, oder ich leite Ihre Frage per E-Mail an das Pactlab-Team weiter.',
    dontKnow: 'Das weiß ich nicht – Pactlabs Anleitungen behandeln das nicht, und ich rate nicht. Ich kann Ihre Frage mit diesem Gespräch per E-Mail an das Pactlab-Team weiterleiten.',
    unavailable: 'Der Hilfe-Assistent ist gerade nicht verfügbar. Sie können Ihre Frage trotzdem per E-Mail an das Pactlab-Team senden.',
    englishOnly: 'Pactlabs Hilfeseiten gibt es noch nicht auf Deutsch, deshalb antworte ich auf Englisch.',
    featureConfirm: 'Sie wünschen sich: {summary}. Soll ich das für das Team festhalten? Es geht an die Personen, die entscheiden, was Pactlab baut; ob und wann es kommt, kann ich nicht sagen.',
    limited: 'Das waren viele Fragen in kurzer Zeit. Bitte warten Sie ein paar Minuten und fragen Sie dann erneut.',
  },
  fr: {
    boundary:
      'Je peux seulement expliquer le fonctionnement de Pactlab. Je ne vois aucun pact, aucune opération, aucun document ni aucune constatation – ni les vôtres ni ceux des autres –, je ne peux donc pas répondre aux questions sur leur contenu. Ouvrez le pact lui-même pour le consulter, ou je peux transmettre votre question à l’équipe Pactlab par e-mail.',
    dontKnow: 'Je ne sais pas – les guides de Pactlab ne traitent pas ce point, et je ne veux pas deviner. Je peux transmettre votre question à l’équipe Pactlab par e-mail, avec cette conversation.',
    unavailable: 'L’assistant d’aide n’est pas disponible pour le moment. Vous pouvez toujours envoyer votre question à l’équipe Pactlab par e-mail.',
    englishOnly: 'Les pages d’aide de Pactlab ne sont pas encore disponibles en français ; je réponds donc en anglais.',
    featureConfirm: 'Vous aimeriez : {summary}. Voulez-vous que je le transmette à l’équipe ? Cela va aux personnes qui décident de ce que Pactlab construit ; je ne peux pas dire si ni quand ce sera fait.',
    limited: 'Cela fait beaucoup de questions en peu de temps. Merci de patienter quelques minutes avant de demander à nouveau.',
  },
  ja: {
    boundary:
      'お手伝いできるのは Pactlab の使い方に関することだけです。ご自身のものも他の方のものも含め、パクト・案件・文書・指摘事項は一切見えないため、その内容に関するご質問にはお答えできません。内容はパクトを開いてご確認いただくか、ご質問をメールで Pactlab チームにお送りします。',
    dontKnow: '分かりません。Pactlab のガイドにはその内容がなく、推測でお答えすることはしません。この会話を添えて、ご質問をメールで Pactlab チームにお送りできます。',
    unavailable: 'ヘルプアシスタントは現在ご利用いただけません。ご質問はメールで Pactlab チームにお送りいただけます。',
    englishOnly: 'Pactlab のヘルプページはまだ日本語で公開されていないため、英語でお答えします。',
    featureConfirm: '「{summary}」をご希望ですね。チームに記録してよろしいですか？Pactlab で何を作るかを決める担当者に届きますが、実現するかどうか、いつになるかはお約束できません。',
    limited: '短時間に多くのご質問をいただきました。数分おいてから、もう一度お試しください。',
  },
};

/** Locales whose help corpus is published. The rest answer from the English corpus and say so. */
export const PUBLISHED_CORPUS_LOCALES: readonly SupportLocale[] = ['en'];
