type Inquiry = {
  organization: string;
  name: string;
  email: string;
  type: string;
  message: string;
};

// Not printed on the page. A static mailto address is still discoverable in client code.
const recipient = ['info', 'utsushimi.co.jp'].join('@');
// Mail clients have different URI limits. Keep longer drafts available through copy/paste.
const maxMailtoLength = 1800;

export function createInquiryEmail(inquiry: Inquiry) {
  const singleLine = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
  const subject = `【Utsushimi】${singleLine(inquiry.type) || 'お問い合わせ'}${inquiry.name ? ` / ${singleLine(inquiry.name)}` : ''}`;
  const body = [
    'うつしみ株式会社 ご担当者様', '',
    `お名前: ${inquiry.name}`,
    ...(inquiry.organization ? [`会社名・ご所属: ${inquiry.organization}`] : []),
    ...(inquiry.email ? [`返信先: ${inquiry.email}`] : []),
    `お問い合わせ種別: ${inquiry.type || '未選択'}`, '',
    'お問い合わせ内容:', inquiry.message,
  ].join('\n').replace(/\r\n?|\n/g, '\r\n');
  const shortUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}`;
  const url = `${shortUrl}&body=${encodeURIComponent(body)}`;
  return { subject, body, url, shortUrl, needsCopy: url.length > maxMailtoLength };
}

export function initializeContactForm(root: HTMLElement) {
  if (root.dataset.initialized) return;
  const form = root.querySelector<HTMLFormElement>('[data-inquiry-form]')!;
  const status = root.querySelector<HTMLElement>('[data-form-status]')!;
  const help = root.querySelector<HTMLDetailsElement>('[data-mail-help]')!;
  const copyStatus = root.querySelector<HTMLElement>('[data-copy-status]')!;
  const copyBody = root.querySelector<HTMLButtonElement>('[data-copy-body]')!;
  const openMail = root.querySelector<HTMLAnchorElement>('[data-open-mail]')!;
  const manualCopy = root.querySelector<HTMLElement>('[data-manual-copy]')!;
  const copyText = root.querySelector<HTMLTextAreaElement>('[data-copy-text]')!;
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const message = form.elements.namedItem('message') as HTMLTextAreaElement;

  function validateText() {
    name.setCustomValidity(name.value.trim() ? '' : 'ご担当者名を入力してください。');
    message.setCustomValidity(message.value.trim() ? '' : 'お問い合わせ内容を入力してください。');
  }
  function readInquiry() {
    const data = new FormData(form);
    return createInquiryEmail({
      organization: String(data.get('organization') ?? '').trim(),
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      type: String(data.get('type') ?? '').trim(),
      message: String(data.get('message') ?? '').trim(),
    });
  }
  function updateDraft() {
    const draft = readInquiry();
    openMail.href = draft.shortUrl;
    root.querySelector<HTMLElement>('[data-mail-subject]')!.textContent = `件名: ${draft.subject}`;
    return draft;
  }
  function isValid() {
    validateText();
    return form.reportValidity();
  }
  form.addEventListener('input', () => {
    validateText();
    status.textContent = copyStatus.textContent = '';
    manualCopy.hidden = true;
    copyText.value = '';
    updateDraft();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!isValid()) return;
    const draft = updateDraft();
    if (draft.needsCopy) {
      help.open = true;
      status.textContent = '内容が長いため、下の「本文をコピー」を押し、メールに貼り付けて送信してください。入力内容は残しています。';
      copyBody.focus();
      return;
    }
    status.textContent = 'メールアプリで内容を確認して送信してください。開かない場合は、下のコピー機能をご利用ください。入力内容は残しています。';
    // Synchronous navigation preserves the user's activation; it does not prove delivery.
    try { window.location.assign(draft.url); }
    catch { help.open = true; status.textContent = 'メールアプリを開けませんでした。下のコピー機能をご利用ください。'; }
  });
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      manualCopy.hidden = true;
      copyText.value = '';
      copyStatus.textContent = `${label}をコピーしました。メールに貼り付けてください。`;
    } catch {
      manualCopy.hidden = false;
      root.querySelector<HTMLElement>('[data-copy-label]')!.textContent = `${label}（選択してコピー）`;
      copyText.value = value;
      copyText.focus();
      copyText.select();
      copyStatus.textContent = '自動コピーが利用できません。選択した内容を手動でコピーしてください。';
    }
  }
  copyBody.addEventListener('click', () => {
    if (isValid()) void copy(updateDraft().body, '本文');
  });
  root.querySelector<HTMLButtonElement>('[data-copy-recipient]')!.addEventListener('click', () => void copy(recipient, '宛先'));
  openMail.addEventListener('click', () => {
    copyStatus.textContent = '開いたメールに本文を貼り付けてから送信してください。';
  });
  updateDraft();
  root.dataset.initialized = 'true';
  root.querySelector<HTMLElement>('[data-form-fallback]')!.hidden = true;
  form.hidden = help.hidden = false;
}
