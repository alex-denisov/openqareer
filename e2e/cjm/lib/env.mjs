// Читает учётные данные из ~/.openqareer/openqareer.env. Пароли не логируются
// и не возвращаются наружу отдельно — только внутри объекта credentials,
// который скрипты передают прямо в page.fill().
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');

export function readEnvironment(file = ENV_FILE) {
  if (!existsSync(file)) {
    throw new Error(`нет файла с учётными данными: ${file}`);
  }
  const values = {};
  // Последнее присваивание выигрывает — в файле встречаются повторы ключей.
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

export function credentialsFor(role) {
  const env = readEnvironment();
  if (role === 'owner') {
    return {
      username: env.OPENQAREER_OWNER_TEST_USERNAME,
      password: env.OPENQAREER_OWNER_TEST_PASSWORD,
    };
  }
  if (role === 'qa-candidate') {
    return {
      username: env.OPENQAREER_QA_CANDIDATE_USERNAME,
      password: env.OPENQAREER_QA_CANDIDATE_PASSWORD,
    };
  }
  throw new Error(`неизвестная роль: ${role}`);
}

export const BASE_URL = process.env.OPENQAREER_CJM_BASE ?? 'https://openqareer.com';
