# 公開方法

ソースとGitHub Pages配信を `TakeruAce/utsushimi-site` に統合しています。公開URLは https://utsushimi.co.jp/ です。

## 更新

1. ローカルで編集し、`pnpm test`、`pnpm build`、`pnpm check:site` を実行します。
2. `main` へcommit・pushします。
3. Actionsの `Build and deploy website` が成功したことを確認し、公開ページを確認します。

GitHub ActionsはNode.js 24・pnpm 10.18.3で依存関係を固定インストールし、テストと静的参照チェックを実行します。公開するのは生成した `dist/` のみです。リポジトリのソースやREADMEをサイトの配信ルートへコピーする方式ではありません。

PagesのBuild and deploymentは **GitHub Actions** を選択します。Custom domainは `utsushimi.co.jp`、Enforce HTTPSは有効です。GitHub側の同じリポジトリで配信を続けるため、今回のソース統合でDNSの変更は不要です。

必要ならActions画面の `Run workflow` でmainを再公開できます。PRのワークフローはテスト・ビルドのみで、本番へデプロイしません。

## 履歴と資料

既存の公開用リポジトリの履歴に、公開対象のソースのみを追加しました。非公開ソースのGit履歴や社内資料・フォーム管理URLは取り込んでいません。移行前の資料は非公開の保管先に保持しています。

入力操作のテストはDOMモックによる確認です。実ブラウザーでの入力・動画・スクロールも変更内容に応じて確認してください。
