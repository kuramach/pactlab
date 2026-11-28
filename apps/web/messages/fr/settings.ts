import type { Localized } from '@pactlab/ui';
import type { settings as source } from '../en/settings';

export const settings: Localized<typeof source> = {
  language: {
    title: 'Langue',
    description: 'La langue dans laquelle Pactlab s’affiche. Les montants restent dans la devise propre à chaque pacte ; seule leur écriture change.',
    label: 'Langue',
    save: 'Enregistrer la langue',
    saved: 'Langue enregistrée.',
    pilot: 'Le français couvre pour l’instant l’accueil du pacte et les constats ; les autres écrans restent en anglais.',
  },
  alerts: {
    title: 'Alertes urgentes sur votre téléphone et vos applications de messagerie',
    description:
      'Uniquement pour les éléments « à traiter maintenant » : une signature en attente, des conditions à valider, une échéance dans moins de deux jours, une décision du comité d’investissement, une question qui vous est adressée. Chaque alerte indique seulement qu’un pacte a besoin de vous et renvoie vers Pactlab, qui vous demande de vous connecter. Elle ne nomme jamais le pacte, une partie, un montant ou un document. Les e-mails restent réglés comme ci-dessus.',
    limits: 'Au plus {cap} alertes par jour, tous canaux confondus, et une par pacte toutes les {fold} minutes ; les événements suivants de ce pacte partent ensemble dans la suivante.',
    channelsLegend: 'Envoyer les alertes urgentes vers',
    notLinked: 'non connecté',
    linkOnProfile: 'Connectez Telegram, Slack ou Teams depuis votre profil.',
    profileLink: 'Votre profil',
    save: 'Enregistrer les canaux',
    saved: 'Canaux enregistrés.',
    invalid: 'L’enregistrement n’a pas abouti. Réessayez.',
    channels: {
      WEB_PUSH: 'Alertes sur vos appareils',
      TELEGRAM: 'Telegram',
      SLACK: 'Slack',
      TEAMS: 'Microsoft Teams',
      WHATSAPP: 'WhatsApp',
    },
    device: {
      title: 'Alertes sur cet appareil',
      description: 'Pactlab affiche une notification sur cet appareil lorsqu’un pacte a besoin de vous, même si l’onglet est fermé.',
      iphone: 'Sur iPhone et iPad (iOS 16.4 ou ultérieur), ajoutez d’abord Pactlab à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvrez-le depuis là et activez les alertes.',
      turnOn: 'Activer les alertes sur cet appareil',
      turningOn: 'Activation…',
      on: 'Les alertes sont activées sur cet appareil.',
      unsupported: 'Ce navigateur ne peut pas afficher les alertes Pactlab. Sur iPhone ou iPad, ajoutez d’abord Pactlab à l’écran d’accueil.',
      denied: 'Les notifications de Pactlab sont bloquées dans ce navigateur. Autorisez-les dans les réglages du site du navigateur, puis réessayez.',
      failed: 'Les alertes n’ont pas pu être activées. Rien n’a été modifié ; réessayez.',
      off: 'Les alertes sur appareils ne sont pas encore activées pour ce Pactlab.',
      list: 'Vos appareils',
      none: 'Aucun appareil ne reçoit encore d’alertes.',
      added: 'Ajouté le {date}',
      test: 'Envoyer une alerte de test',
      tested: 'Alerte de test envoyée.',
      expired: 'Cet appareil n’accepte plus les alertes ; il a donc été retiré.',
      remove: 'Retirer',
      removed: 'Appareil retiré.',
    },
  },
};
