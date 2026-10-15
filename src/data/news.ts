// Existing published announcements, shared by the home and news pages.
const entries = [
  {
    date: '2024.12',
    category: '受賞',
    title: 'SIGGRAPH Asia 2024 Best Demo in Show Award を受賞しました',
  },
  {
    date: '2024.11',
    category: '受賞',
    title: 'DCEXPO にて NEDO賞・SIGGRAPH Special Prize をダブル受賞しました',
  },
  {
    date: '2024.10',
    category: '学会発表',
    title: 'ACM UIST 2024 にて "Selfrionette" 論文が採択されました',
  },
  {
    date: '2025.09',
    category: '学会発表',
    title: '日本バーチャルリアリティ学会大会（VRSJ 2025）にて発表',
  },
  {
    date: '2025',
    category: '展示',
    title: 'SIGGRAPH 2025 にて展示しました',
  },
  {
    date: '2026.04',
    category: 'お知らせ',
    title: 'コーポレートサイトを公開しました',
  },
];

export const news = [...entries].sort((a, b) => b.date.localeCompare(a.date)).map(item => ({ ...item, datetime: item.date.includes('.') ? item.date.replace('.', '-') : undefined }));
