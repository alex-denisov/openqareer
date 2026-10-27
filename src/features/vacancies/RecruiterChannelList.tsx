import type { Icon } from '@phosphor-icons/react';
import {
  ChatCircleDots,
  EnvelopeSimple,
  FacebookLogo,
  GithubLogo,
  Globe,
  InstagramLogo,
  LinkedinLogo,
  LinkSimple,
  Phone,
  SkypeLogo,
  TelegramLogo,
  WhatsappLogo,
  XLogo,
} from '@phosphor-icons/react';
import type {
  CandidateRecruiterChannel,
  RecruiterChannelKind,
} from '../../../shared/recruiterChannel';
import { CareerTooltip } from '../shell/CareerTooltip';

const CHANNEL_COPY: Record<RecruiterChannelKind, { label: string; icon: Icon }> = {
  telegram: { label: 'Telegram', icon: TelegramLogo },
  whatsapp: { label: 'WhatsApp', icon: WhatsappLogo },
  facebook: { label: 'Facebook', icon: FacebookLogo },
  viber: { label: 'Viber', icon: ChatCircleDots },
  phone: { label: 'Телефон', icon: Phone },
  email_personal: { label: 'Личная почта', icon: EnvelopeSimple },
  email_corporate: { label: 'Рабочая почта', icon: EnvelopeSimple },
  instagram: { label: 'Instagram', icon: InstagramLogo },
  linkedin: { label: 'LinkedIn', icon: LinkedinLogo },
  vk: { label: 'ВКонтакте', icon: LinkSimple },
  x: { label: 'X', icon: XLogo },
  github: { label: 'GitHub', icon: GithubLogo },
  skype: { label: 'Skype', icon: SkypeLogo },
  website: { label: 'Сайт', icon: Globe },
  other: { label: 'Профиль', icon: LinkSimple },
};

const HYPOTHESIS_HINT = 'Выведено по шаблону или нику и не подтверждено — может не сработать';

const SAFE_HREF = /^(?:https:\/\/|mailto:|tel:|viber:\/\/|skype:)/u;

function isExternal(href: string): boolean {
  return /^https?:\/\//u.test(href);
}

/** Каналы связи с рекрутёром в порядке ценности для кандидата (B258). */
export function RecruiterChannelList({
  channels,
}: {
  readonly channels: readonly CandidateRecruiterChannel[];
}) {
  if (channels.length === 0) return null;
  return (
    <ul className="career-recruiter-channels" aria-label="Каналы связи">
      {channels.map((channel) => {
        const copy = CHANNEL_COPY[channel.kind];
        const IconComponent = copy.icon;
        const content = (
          <>
            <IconComponent size={15} aria-hidden="true" />
            <span className="career-recruiter-channel-label">{copy.label}</span>
            <span className="career-recruiter-channel-value">{channel.value}</span>
          </>
        );
        return (
          <li
            key={`${channel.kind}:${channel.value}`}
            className="career-recruiter-channel"
            data-status={channel.status}
          >
            {channel.href && SAFE_HREF.test(channel.href) ? (
              <a
                href={channel.href}
                className="career-recruiter-link"
                {...(isExternal(channel.href) ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {content}
              </a>
            ) : (
              <span className="career-recruiter-link">{content}</span>
            )}
            {channel.status === 'hypothesis' ? (
              <CareerTooltip content={HYPOTHESIS_HINT}>
                <span className="career-recruiter-badge" data-status="hypothesis">
                  Предположение
                </span>
              </CareerTooltip>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
