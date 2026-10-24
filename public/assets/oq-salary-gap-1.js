/* B351: local comparison only. No input leaves the document or becomes a profile fact. */
export function normalizeListedSkill(value) {
  // Technical punctuation is significant: C, C++, C# and Node.js remain distinct.
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}
export function parseListedSkills(value) {
  if (value.length > 4000) throw new Error('Введите не более 4000 символов.');
  const skills = value
    .split(/[,;\n\r]+/u)
    .map(normalizeListedSkill)
    .filter(Boolean);
  if (!skills.length) throw new Error('Введите хотя бы один навык.');
  if (skills.length > 50 || skills.some((skill) => skill.length > 128))
    throw new Error('Укажите до 50 навыков, не более 128 символов каждый.');
  return new Set(skills);
}
export function compareListedSkills(listed, skills) {
  return skills.map((skill) => ({
    ...skill,
    listed: listed.has(normalizeListedSkill(skill.name)),
  }));
}
function validSummary(value, role, grade) {
  return (
    value &&
    value.role === role &&
    value.grade === (grade || null) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Number.isSafeInteger(value.sampleSize) &&
    value.sampleSize >= 5 &&
    Array.isArray(value.skills) &&
    value.skills.length > 0 &&
    value.skills.length <= 15 &&
    value.skills.every(
      (skill) =>
        typeof skill.name === 'string' &&
        skill.name.length > 0 &&
        skill.name.length <= 128 &&
        Number.isSafeInteger(skill.count) &&
        skill.count >= 0 &&
        skill.count <= value.sampleSize &&
        Number.isFinite(skill.frequency),
    )
  );
}
function install(root) {
  const form = root.querySelector('[data-gap-form]');
  const input = root.querySelector('textarea');
  const button = root.querySelector('button');
  const status = root.querySelector('[role="status"]');
  const result = root.querySelector('[data-gap-results]');
  if (!form || !input || !button || !status || !result) return;
  form.noValidate = true;
  button.disabled = false;
  let running = false;
  input.addEventListener('input', () => {
    result.replaceChildren();
    result.hidden = true;
    status.textContent = '';
    input.removeAttribute('aria-invalid');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (running) return;
    result.replaceChildren();
    result.hidden = true;
    input.removeAttribute('aria-invalid');
    let listed;
    try {
      listed = parseListedSkills(input.value);
    } catch (error) {
      status.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const role = root.dataset.role;
    const grade = root.dataset.grade;
    if (!role || role.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(role)) return;
    running = true;
    input.disabled = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Читаем подготовленный срез…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL('/api/v1/public/salary-markets/' + role + '/skills', location.origin);
      if (grade) url.searchParams.set('grade', grade);
      const response = await fetch(url, {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('unavailable');
      const { data } = await response.json();
      if (!validSummary(data, role, grade)) throw new Error('invalid_summary');
      const rows = compareListedSkills(listed, data.skills);
      const date = new Date(data.updatedAt).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
      status.textContent = `Срез ${date}: ${data.sampleSize.toLocaleString('ru-RU')} вакансий. Сравнили ${rows.length} опубликованных навыков. Это совпадение названий, а не проверка уровня или способностей.`;
      for (const matched of [true, false]) {
        const group = rows.filter((row) => row.listed === matched);
        const heading = document.createElement('h3');
        heading.textContent = `${matched ? 'Указаны в вашем списке' : 'Не указаны в вашем списке'} (${group.length})`;
        result.append(heading);
        if (!group.length) continue;
        const list = document.createElement('ul');
        for (const row of group) {
          const item = document.createElement('li');
          item.textContent = `${row.name} — ${row.frequency.toLocaleString('ru-RU')}% (${row.count.toLocaleString('ru-RU')} из ${data.sampleSize.toLocaleString('ru-RU')})`;
          list.append(item);
        }
        result.append(list);
      }
      result.hidden = false;
    } catch {
      status.textContent = 'Подготовленный срез сейчас недоступен. Попробуйте сравнить позже.';
    } finally {
      clearTimeout(timer);
      running = false;
      input.disabled = false;
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
if (typeof document !== 'undefined') document.querySelectorAll('[data-sm-gap]').forEach(install);
