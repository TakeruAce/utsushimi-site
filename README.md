# うつしみ Webサイト

[utsushimi.co.jp](https://utsushimi.co.jp/) の公開ソースです。Astroで構築し、このリポジトリの `main` へのpushをGitHub Actionsで検証・ビルドしてGitHub Pagesへ公開します。

## ローカル開発

Node.js 24とpnpm 10.18.3を使います。

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 4330
pnpm test
pnpm build
pnpm check:site
```

## 編集場所

- ページ: `src/pages/`
- 共通部品: `src/components/`
- 色・文字・ロゴ: `src/styles/site-settings.css`
- 会社の公開情報・問い合わせフォームURL: `src/data/company.ts`
- 画像: `src/assets/images/`
- 動画・書体・論文: `public/`
- favicon生成: `node scripts/generate-favicons.mjs`

問い合わせは公開Googleフォームの埋め込みです。`.env.example` のURLは任意の上書き用で、通常は `company.ts` の公開URLを使用します。認証情報を追加する必要はありません。

公開方法は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。社内資料・管理用URL・未採用の試作・検証記録は、この公開リポジトリでは管理しません。
