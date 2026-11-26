import { expect, it } from 'vitest';
import type { AtsField } from './atsFormTypes';
import { askedFields, questionIdOf } from './atsQuestions';
import { sentItems } from './atsSentItems';

const field = (key: string, label: string, more: Partial<AtsField> = {}): AtsField => ({
  key,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
  ...more,
});
const options = [
  { value: '1', label: 'Female' },
  { value: '2', label: 'Prefer not to say' },
];

it('видно всё, что встанет в форму: контакты, ответы, согласия и отказ от ответа', () => {
  const email = field('id:email', 'Email');
  const visa = field('id:visa', 'Visa?', {
    kind: 'select',
    options: [{ value: '7', label: 'No' }],
  });
  const gender = field('id:g', 'Gender', { kind: 'select', options, required: false });
  const noDecline = field('id:r', 'Race', {
    kind: 'select',
    options: options.slice(0, 1),
    required: false,
  });
  const gdpr = field('id:gdpr', 'I agree to the privacy policy', { kind: 'checkbox' });
  const resume = field('id:cv', 'Resume', { kind: 'file' });
  const letter = field('id:cl', 'Cover letter', { kind: 'textarea' });
  const draft = { [questionIdOf(email)]: 'm@example.com', [questionIdOf(visa)]: 'No' };
  const items = sentItems(
    [email, visa, gender, noDecline, gdpr, resume, letter],
    draft,
    'jobs.lever.co',
  );
  expect(items.map(({ question, answer }) => [question, answer])).toEqual([
    ['Email', 'm@example.com'],
    ['Visa?', 'No'],
    ['Gender', 'Prefer not to say'],
    ['I agree to the privacy policy', 'Да'],
  ]);
});

it('составная галочка становится вопросом', () => {
  const mixed = field('id:m', 'I accept the privacy policy and newsletter', { kind: 'checkbox' });
  expect(askedFields([mixed])).toEqual([mixed]);
  expect(sentItems([mixed], {}, 'jobs.lever.co')).toEqual([]);
});
