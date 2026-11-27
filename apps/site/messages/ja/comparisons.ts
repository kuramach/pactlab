import type { Catalog } from '../../lib/i18n/catalog';

/**
 * Japanese comparison page (machine translation, T-171). What it says about the other product is a
 * translation of its public product page as checked in October 2026; the source link stays English.
 */
export const comparisons: Catalog['comparisons'] = {
  'valuation-software': {
    title: 'Pactlab と M&A バリュエーション・ソフトウェアの比較',
    description: 'MoneySoft DealSense のようなバリュエーション・ディールモデリングのソフトウェアと Pactlab の違い：所見が価格に流れ込む、エビデンス重視のデューデリジェンス。',
    intro: 'バリュエーション・ソフトウェアは、入力した財務諸表からディールをモデル化します。Pactlab はもっと手前から始めます。その財務諸表の裏にあるエビデンスを検証し、見つけたものを記録し、承認された所見をバリュエーションに反映します。両者は異なる問いに答えるもので、両方を使うチームも多くあります。',
    them: 'MoneySoft DealSense',
    rows: [
      { topic: '出発点', them: 'ユーザーが入力するか、Excel や CSV から取り込んだ過去の財務諸表。', pactlab: '出典となる記録：請求エクスポート、コードリポジトリ、課題トラッカー、文書、業界の抽出データ。' },
      { topic: 'デューデリジェンスの所見', them: '製品ページに記載なし。', pactlab: 'エビデンスから引用付きで所見を起案し、指名されたレビュー担当者が承認、却下、または根拠の追加を求めます。' },
      { topic: 'バリュエーション', them: '企業価値評価、ディールの価格設定と構造化、予測、ROI、EPS の増減分析。', pactlab: '承認された所見を価格ブリッジに結び付けた、バージョン管理されたシナリオ（ARR マルチプル、DCF、業界別の手法）。' },
      { topic: 'コードとデリバリー', them: '製品ページに記載なし。', pactlab: 'リポジトリの履歴と課題トラッカーから、オーナーシップ、ライセンス、デリバリーの健全性を読み取ります。ソースコードは保存しません。' },
      { topic: '類似取引のデータ', them: 'DealStats、BIZCOMPS、RMA Annual Statement Studies などのデータベースとの任意の連携。', pactlab: 'エビデンスに基づくシナリオと並べて、出典とともに記録した類似取引。' },
      { topic: 'レポート', them: '評価書、ピッチブックと CIM、買収提案書、タームシート。', pactlab: '所見、主張の登録簿、バリュエーションのシナリオ、提案するディール条件。いずれもエビデンスまでたどれます。' },
      { topic: '動作環境', them: 'Windows デスクトップ、または Windows のリモートデスクトップ、ターミナル、Citrix サーバー。', pactlab: 'ブラウザで動作し、各ディールはデータベースの行レベルセキュリティで分離されます。' },
    ],
    conclusion: '合意済みの財務数値からディールをモデル化するには、バリュエーション・ソフトウェアを。どの財務数値をエビデンスが裏付け、どのようなリスクが示され、その所見が価格をどう変えるかを確かめるには、Pactlab を。各ステップは人が承認します。',
    sources: [{ label: 'MoneySoft：DealSense 製品ページ（英語）' }],
  },
};
