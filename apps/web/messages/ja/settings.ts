import type { Localized } from '@pactlab/ui';
import type { settings as source } from '../en/settings';

export const settings: Localized<typeof source> = {
  language: {
    title: '言語',
    description: 'Pactlabの表示言語です。金額は各パクトの通貨のままで、表記だけが変わります。',
    label: '言語',
    save: '言語を保存',
    saved: '言語を保存しました。',
    pilot: '現在、日本語はパクトのホームと所見に対応しています。ほかの画面は英語のままです。',
  },
  alerts: {
    title: 'スマートフォンとチャットアプリへの緊急アラート',
    description:
      '「今すぐ対応が必要」な項目のみ対象です:署名待ち、回答が必要な条件、2日以内の期限、投資委員会の決定、あなたへの質問。各アラートは、パクトがあなたの対応を待っていることだけを伝え、サインインを求めるPactlabへのリンクを示します。パクト名、当事者、金額、文書は一切記載しません。メールは上記の設定のままです。',
    limits: '全チャネル合計で1日最大{cap}件、同じパクトについては{fold}分に1件までです。そのパクトの後続のイベントは、次のアラートにまとめて送られます。',
    channelsLegend: '緊急アラートの送信先',
    notLinked: '未接続',
    linkOnProfile: 'Telegram、Slack、Teamsはプロフィールで接続してください。',
    profileLink: 'あなたのプロフィール',
    save: 'チャネルを保存',
    saved: 'チャネルを保存しました。',
    invalid: '保存できませんでした。もう一度お試しください。',
    channels: {
      WEB_PUSH: 'お使いのデバイスへのアラート',
      TELEGRAM: 'Telegram',
      SLACK: 'Slack',
      TEAMS: 'Microsoft Teams',
      WHATSAPP: 'WhatsApp',
    },
    device: {
      title: 'このデバイスへのアラート',
      description: 'パクトがあなたの対応を待っているとき、タブを閉じていても、このデバイスにPactlabが通知を表示します。',
      iphone: 'iPhoneとiPad(iOS 16.4以降)では、まずPactlabをホーム画面に追加し(共有 → ホーム画面に追加)、そこから開いてアラートをオンにしてください。',
      turnOn: 'このデバイスのアラートをオンにする',
      turningOn: 'オンにしています…',
      on: 'このデバイスのアラートはオンです。',
      unsupported: 'このブラウザではPactlabのアラートを表示できません。iPhoneまたはiPadでは、まずPactlabをホーム画面に追加してください。',
      denied: 'このブラウザでPactlabの通知がブロックされています。ブラウザのサイト設定で許可してから、もう一度お試しください。',
      failed: 'アラートをオンにできませんでした。何も変更されていません。もう一度お試しください。',
      off: 'このPactlabでは、デバイスへのアラートはまだオンになっていません。',
      list: 'お使いのデバイス',
      none: 'アラートを受け取るデバイスはまだありません。',
      added: '{date}に追加',
      test: 'テストアラートを送信',
      tested: 'テストアラートを送信しました。',
      expired: 'このデバイスはアラートを受け付けなくなったため、削除しました。',
      remove: '削除',
      removed: 'デバイスを削除しました。',
    },
  },
};
