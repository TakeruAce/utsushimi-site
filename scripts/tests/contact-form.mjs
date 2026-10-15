// Exercise the shipped controller with in-memory DOM, clipboard, and mailto stubs.
// No browser, mail application, network request, or real clipboard is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const code = stripTypeScriptTypes(readFileSync('src/scripts/contactForm.ts', 'utf8'), { mode: 'strip' })
  .replaceAll('export function', 'function');
const component = readFileSync('src/components/ContactForm.astro', 'utf8');
const recipient = 'info@utsushimi.co.jp';
const sample = { organization: 'A&B / 開発 #1', name: '山田 太郎', email: 'test+form@example.com',
  type: '共同研究', message: 'こんにちは\n🌸 & + # ? 100%' };
const flushCopy = () => new Promise(resolve => setImmediate(resolve));

function setup(values = {}) {
  const element = () => ({ dataset: {}, listeners: {}, hidden: true, open: false, textContent: '',
    value: '', href: '', focusCount: 0, selectCount: 0,
    addEventListener(key, callback) { (this.listeners[key] ||= []).push(callback); },
    emit(key, event = {}) { for (const listener of this.listeners[key] || []) listener({ preventDefault() {}, ...event }); },
    focus() { this.focusCount++; }, select() { this.selectCount++; },
  });
  const field = value => ({ value, validity: '', setCustomValidity(error) { this.validity = error; } });
  const fields = Object.fromEntries(Object.entries({ ...sample, ...values }).map(([key, value]) => [key, field(value)]));
  const keys = ['inquiry-form', 'form-status', 'mail-help', 'copy-status', 'copy-body', 'open-mail',
    'manual-copy', 'copy-text', 'mail-subject', 'form-fallback', 'copy-label', 'copy-recipient'];
  const nodes = Object.fromEntries(keys.map(key => [key, element()]));
  const form = nodes['inquiry-form'];
  form.elements = { namedItem: key => fields[key] };
  // Native validity is checked in the browser; this stub honors controller custom validity.
  form.reportValidity = () => Object.values(fields).every(field => !field.validity);
  form.reset = () => { throw new Error('The mailto flow must not clear unsent input'); };
  const root = { dataset: {}, querySelector: key => nodes[key.slice(6, -1)] };
  const navigations = [], copied = [], network = [];
  let clipboardDenied = false, navigationDenied = false;
  const context = {
    window: { location: { assign(url) { if (navigationDenied) throw new Error('No handler'); navigations.push(url); } } },
    navigator: { clipboard: { async writeText(text) { if (clipboardDenied) throw new Error('Permission denied'); copied.push(text); } } },
    FormData: class { get(key) { return fields[key]?.value; } },
    fetch: (...args) => { network.push(args); throw new Error('Contact must not submit a network request'); },
  };
  runInNewContext(code, context);
  context.initializeContactForm(root);
  return { form, fields, nodes, root, context, navigations, copied, network,
    denyClipboard() { clipboardDenied = true; }, denyNavigation() { navigationDenied = true; },
    submit() { form.emit('submit'); }, input() { form.emit('input'); },
    click(key) { nodes[key].emit('click'); },
    values() { return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])); },
    status() { return nodes['form-status'].textContent; },
  };
}

{
  const t = setup();
  const input = { ...sample, name: '山田\r\nBcc: someone@example.test', type: '相談 & # ?\nCC: nobody@example.test',
    message: '一行目\n二行目\r三行目\r\n四行目 & + # ? % 🌸' };
  const draft = t.context.createInquiryEmail(input);
  const url = new URL(draft.url);
  assert.equal(url.protocol, 'mailto:'); assert.equal(url.pathname, recipient);
  assert.deepEqual([...url.searchParams.keys()], ['subject', 'body'], 'content cannot add mailto headers');
  assert.equal(url.searchParams.get('subject'), draft.subject, 'Unicode/symbol subject round-trips');
  assert.equal(url.searchParams.get('body'), draft.body, 'Unicode/symbol body round-trips');
  assert.doesNotMatch(draft.subject, /[\r\n\u0000-\u001f\u007f]/, 'subject remains a single header line');
  assert.match(draft.body, /一行目\r\n二行目\r\n三行目\r\n四行目 & \+ # \? % 🌸/);
  assert.doesNotMatch(draft.body, /(^|[^\r])\n|\r(?!\n)/, 'all body line endings are CRLF');
  assert.equal(new URL(draft.shortUrl).searchParams.get('subject'), draft.subject);
  assert.equal(new URL(draft.shortUrl).searchParams.has('body'), false);
}
{
  for (const key of ['name', 'message']) {
    const t = setup({ [key]: ' \t\n ' });
    t.submit(); t.click('copy-body'); await flushCopy();
    assert.equal(t.navigations.length, 0, `blank ${key} cannot open a draft`);
    assert.equal(t.copied.length, 0, `blank ${key} cannot be copied as a valid inquiry`);
    assert.ok(t.fields[key].validity);
    t.fields[key].value = sample[key]; t.input(); t.submit();
    assert.equal(t.navigations.length, 1, `corrected ${key} can open a draft`);
    assert.equal(t.network.length, 0);
  }
}
{
  const emailInput = component.match(/<input\b[^>]*\bname="email"[^>]*>/)?.[0];
  assert.ok(emailInput); assert.doesNotMatch(emailInput, /\brequired\b/, 'reply address remains optional in native HTML');
  const t = setup({ email: '', organization: '', type: '' });
  const before = t.values(); t.submit();
  assert.equal(t.navigations.length, 1, 'email address is not required to open a draft');
  const draft = new URL(t.navigations[0]);
  assert.doesNotMatch(draft.searchParams.get('body'), /返信先:|会社名・ご所属:/);
  assert.match(draft.searchParams.get('subject'), /お問い合わせ/);
  assert.deepEqual(t.values(), before, 'opening mail leaves all unsent input in place');
  assert.match(t.status(), /確認して送信/);
  assert.doesNotMatch(t.status(), /受け付けました|送信しました|送信完了|送信済み/);
  assert.equal(t.network.length, 0);
}
{
  const message = 'あ'.repeat(2995) + 'END🌸';
  const t = setup({ message }); const before = t.values();
  const expected = t.context.createInquiryEmail(before);
  assert.equal(expected.needsCopy, true);
  t.submit();
  assert.equal(t.navigations.length, 0, 'long draft is never sent to a truncation-prone mailto handler');
  assert.equal(t.nodes['mail-help'].open, true);
  assert.equal(t.nodes['copy-body'].focusCount, 1);
  assert.match(t.status(), /本文をコピー/);
  t.click('copy-body'); await flushCopy();
  assert.equal(t.copied[0], expected.body, 'copy retains the complete long message');
  assert.ok(t.copied[0].endsWith(message), 'the end of the long message is not truncated');
  assert.deepEqual(t.values(), before);
  assert.equal(new URL(t.nodes['open-mail'].href).searchParams.has('body'), false);
  assert.equal(t.network.length, 0);
}
{
  const t = setup(); t.denyClipboard();
  const before = t.values(), expected = t.context.createInquiryEmail(before);
  t.click('copy-body'); await flushCopy();
  assert.equal(t.nodes['manual-copy'].hidden, false, 'denied clipboard exposes manual copy');
  assert.equal(t.nodes['copy-text'].value, expected.body);
  assert.equal(t.nodes['copy-text'].focusCount, 1);
  assert.equal(t.nodes['copy-text'].selectCount, 1);
  assert.match(t.nodes['copy-status'].textContent, /手動でコピー/);
  assert.match(component, /<textarea\b[^>]*\bdata-copy-text\b[^>]*\breadonly\b/, 'manual copy is a readonly textarea');
  t.click('copy-recipient'); await flushCopy();
  assert.equal(t.nodes['copy-text'].value, recipient, 'recipient can also be copied without Clipboard API');
  assert.match(t.nodes['copy-label'].textContent, /宛先/);
  assert.deepEqual(t.values(), before);
  t.fields.message.value = '編集後'; t.input();
  assert.equal(t.nodes['manual-copy'].hidden, true, 'editing hides a stale manual draft');
  assert.equal(t.nodes['copy-text'].value, '');
  assert.equal(t.network.length, 0);
}
{
  const t = setup(); const before = t.values(); t.denyNavigation(); t.submit();
  assert.equal(t.nodes['mail-help'].open, true, 'an immediate mail-handler error opens fallback help');
  assert.match(t.status(), /開けません/); assert.deepEqual(t.values(), before);
  t.click('copy-recipient'); await flushCopy();
  assert.equal(t.copied[0], recipient);
  t.click('open-mail'); assert.match(t.nodes['copy-status'].textContent, /貼り付けてから送信/);
  assert.equal(t.network.length, 0);
}
{
  const t = setup(); t.context.initializeContactForm(t.root); t.submit();
  assert.equal(t.navigations.length, 1, 'initialization is idempotent');
  assert.equal(t.nodes['form-fallback'].hidden, true);
  assert.equal(t.form.hidden, false); assert.equal(t.nodes['mail-help'].hidden, false);
}
console.log('PASS: mailto Unicode/symbol encoding, CRLF, blank-input correction, optional reply address, long-draft copy, preserved input, no false delivery claim, manual-copy fallback, and initialization. No network or mail was sent.');
