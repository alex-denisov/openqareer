import dns from 'node:dns/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { EmailStatus, RecruiterContact } from '../../shared/recruiterContact';
import { extractDomainFromUrl } from '../domain/company';

export interface UnifiedVacancyInput {
  readonly id: string;
  readonly title?: string;
  readonly company?: string;
  readonly url?: string;
  readonly description?: string;
  readonly fullDescription?: string;
  readonly contactInfo?: string;
  readonly aboutCompany?: string;
}

export type MxResolver = (
  domain: string,
) => Promise<Array<{ exchange: string; priority: number }>>;

export type SmtpValidator = (
  email: string,
  mxHost: string,
  options?: { timeoutMs?: number },
) => Promise<boolean>;

export interface DiscoveryOptions {
  readonly mxResolver?: MxResolver;
  readonly smtpValidator?: SmtpValidator;
  readonly smtpTimeoutMs?: number;
}

const AGGREGATOR_DOMAINS = new Set([
  'hh.ru',
  'headhunter.ru',
  'linkedin.com',
  'remotive.com',
  'habr.com',
  't.me',
  'telegram.org',
  'github.com',
  'superjob.ru',
]);

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo',
  ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function transliterateToLatin(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC_MAP[char] ?? char)
    .join('')
    .replace(/[^a-z0-9\s._-]/g, '')
    .trim();
}

export function extractCompanyDomain(vacancy: UnifiedVacancyInput): string | undefined {
  if (vacancy.url) {
    const fromUrl = extractDomainFromUrl(vacancy.url);
    if (fromUrl && !AGGREGATOR_DOMAINS.has(fromUrl)) {
      return fromUrl;
    }
  }
  const text = [vacancy.contactInfo, vacancy.description, vacancy.aboutCompany].filter(Boolean).join(' ');
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch && emailMatch[1] && !AGGREGATOR_DOMAINS.has(emailMatch[1].toLowerCase())) {
    return emailMatch[1].toLowerCase();
  }
  if (vacancy.company) {
    const normalized = vacancy.company.trim().toLowerCase();
    if (/\.[a-z]{2,}$/i.test(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

export function extractPhones(text: string): string[] {
  const results: string[] = [];
  const ruPattern = /(?:\+7|8)\s*(?:\(\d{3}\)|\d{3})[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
  const intlPattern = /\+(?:[1-9]\d{0,2})\s*(?:\(\d{1,4}\)|\d{1,4})[\s-]?\d{3,4}[\s-]?\d{3,4}/g;

  const matches = [...text.matchAll(ruPattern), ...text.matchAll(intlPattern)];
  for (const m of matches) {
    const raw = m[0].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && raw.replace(/\D/g, '').length >= 10) {
      if (!results.includes(raw)) results.push(raw);
    }
  }
  return results;
}

const FORBIDDEN_TG_PREFIXES = new Set(['param', 'returns', 'type', 'example', 'phosphor']);

export function extractTelegramHandles(text: string): string[] {
  const results: string[] = [];
  const handlePattern = /(?:^|\s)@([a-zA-Z0-9_]{4,32})/g;
  const linkPattern = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{4,32})/g;

  for (const match of text.matchAll(handlePattern)) {
    const handle = match[1].toLowerCase();
    if (!FORBIDDEN_TG_PREFIXES.has(handle) && !results.includes(`@${match[1]}`)) {
      results.push(`@${match[1]}`);
    }
  }
  for (const match of text.matchAll(linkPattern)) {
    const link = `t.me/${match[1]}`;
    if (!results.includes(link)) results.push(link);
  }
  return results;
}

export function extractWhatsappLinks(text: string): string[] {
  const pattern = /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)(\/?\d{10,15})/g;
  const results: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const cleanPhone = match[1].replace(/\D/g, '');
    const formatted = `https://wa.me/${cleanPhone}`;
    if (!results.includes(formatted)) results.push(formatted);
  }
  return results;
}

export function extractProfessionalProfiles(text: string): {
  linkedinUrl?: string;
  githubUrl?: string;
  twitterUrl?: string;
} {
  const li = text.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9_%-]+/i);
  const gh = text.match(/https?:\/\/github\.com\/[a-zA-Z0-9_-]+/i);
  const tw = text.match(/https?:\/\/(?:twitter|x)\.com\/[a-zA-Z0-9_]+/i);

  return {
    linkedinUrl: li ? li[0] : undefined,
    githubUrl: gh ? gh[0] : undefined,
    twitterUrl: tw ? tw[0] : undefined,
  };
}

export function generateEmailHypotheses(fullName: string, domain: string): string[] {
  const latin = transliterateToLatin(fullName);
  const parts = latin.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];

  const [first, last] = parts;
  const f = first[0];
  const dom = domain.toLowerCase();

  return [
    `${first}.${last}@${dom}`,
    `${f}.${last}@${dom}`,
    `${first}@${dom}`,
  ];
}

function handleSmtpData(
  line: string,
  state: { stage: number },
  email: string,
  socket: net.Socket,
  finish: (ok: boolean) => void,
): void {
  const code = parseInt(line.slice(0, 3), 10);
  if (Number.isNaN(code)) return;

  if (state.stage === 0 && code === 220) {
    state.stage = 1;
    socket.write('HELO openqareer.local\r\n');
  } else if (state.stage === 1 && code === 250) {
    state.stage = 2;
    socket.write('MAIL FROM:<check@openqareer.local>\r\n');
  } else if (state.stage === 2 && code === 250) {
    state.stage = 3;
    socket.write(`RCPT TO:<${email}>\r\n`);
  } else if (state.stage === 3) {
    finish(code === 250 || code === 251);
  } else {
    finish(false);
  }
}

export async function passiveSmtpHandshake(
  email: string,
  mxHost: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 3000;
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const socket = net.createConnection({ host: mxHost, port: 25 });
    const finish = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        try {
          socket.write('QUIT\r\n');
        } catch {
          // ignore
        }
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    const state = { stage: 0 };
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('data', (data) =>
      handleSmtpData(data.toString(), state, email, socket, finish),
    );
  });
}

const defaultMxResolver: MxResolver = async (domain: string) => {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
};

interface ExtractedPerson {
  fullName: string;
  roleTitle: string;
}

function findRecruiterPerson(text: string): ExtractedPerson | undefined {
  const recruiterRegex =
    /(?:Рекрутер|Recruiter|Контактное лицо|HR|Талант|Talent|Нанимающий менеджер|Hiring Manager):\s*([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)/i;
  const match = text.match(recruiterRegex);
  if (match) {
    const rawRole = match[0].split(':')[0].trim();
    return {
      fullName: match[1].trim(),
      roleTitle: rawRole || 'Рекрутер',
    };
  }
  return undefined;
}

function extractDirectEmail(text: string): string | undefined {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : undefined;
}

interface ValidationContext {
  domain?: string;
  options?: DiscoveryOptions;
}

async function resolveEmailAndStatus(
  directEmail: string | undefined,
  person: ExtractedPerson | undefined,
  ctx: ValidationContext,
): Promise<{ email: string | null; status: EmailStatus; confidence: number }> {
  const resolveMx = ctx.options?.mxResolver ?? defaultMxResolver;
  const validateSmtp = ctx.options?.smtpValidator ?? passiveSmtpHandshake;

  if (directEmail) {
    const domain = directEmail.split('@')[1];
    const mxList = await resolveMx(domain);
    if (mxList.length > 0 && ctx.options?.smtpValidator) {
      const ok = await validateSmtp(directEmail, mxList[0].exchange, { timeoutMs: ctx.options?.smtpTimeoutMs });
      if (ok) return { email: directEmail, status: 'verified', confidence: 0.95 };
    }
    // Presence in source text and a syntactically valid domain do not prove
    // deliverability. Without positive MX plus SMTP evidence this is merely an
    // observed, unverified address (PRB-034).
    return { email: directEmail, status: 'unverified', confidence: 0.5 };
  }

  if (person && ctx.domain) {
    const hypotheses = generateEmailHypotheses(person.fullName, ctx.domain);
    if (hypotheses.length > 0) {
      const top = hypotheses[0];
      const mxList = await resolveMx(ctx.domain);
      if (mxList.length > 0 && ctx.options?.smtpValidator) {
        const ok = await validateSmtp(top, mxList[0].exchange, { timeoutMs: ctx.options?.smtpTimeoutMs });
        if (ok) return { email: top, status: 'verified', confidence: 0.9 };
      }
      return { email: top, status: 'hypothesis', confidence: 0.65 };
    }
  }

  return { email: null, status: 'unverified', confidence: 0.5 };
}

export async function discoverRecruiterContacts(
  vacancy: UnifiedVacancyInput,
  options?: DiscoveryOptions,
): Promise<RecruiterContact[]> {
  const fullText = [vacancy.contactInfo, vacancy.description, vacancy.fullDescription].filter(Boolean).join('\n');
  const domain = extractCompanyDomain(vacancy);
  const person = findRecruiterPerson(fullText);
  const phones = extractPhones(fullText);
  const tgs = extractTelegramHandles(fullText);
  const was = extractWhatsappLinks(fullText);
  const profiles = extractProfessionalProfiles(fullText);
  const directEmail = extractDirectEmail(fullText);

  const hasAnySignal = person || phones.length > 0 || tgs.length > 0 || directEmail || profiles.linkedinUrl;
  if (!hasAnySignal) {
    return [];
  }

  const emailRes = await resolveEmailAndStatus(directEmail, person, { domain, options });
  const now = new Date().toISOString();

  const contact: RecruiterContact = {
    id: randomUUID(),
    vacancyId: vacancy.id,
    companyName: vacancy.company ?? 'Компания',
    fullName: person?.fullName ?? 'Команда найма',
    roleTitle: person?.roleTitle ?? 'Рекрутер',
    email: emailRes.email,
    emailStatus: emailRes.status,
    phone: phones[0] ?? null,
    telegram: tgs[0] ?? null,
    whatsapp: was[0] ?? null,
    linkedinUrl: profiles.linkedinUrl ?? null,
    githubUrl: profiles.githubUrl ?? null,
    twitterUrl: profiles.twitterUrl ?? null,
    sourceType: directEmail ? 'vacancy_text' : (person && domain ? 'domain_osint' : 'public_metadata'),
    confidence: emailRes.confidence,
    createdAt: now,
    updatedAt: now,
  };

  return [contact];
}
