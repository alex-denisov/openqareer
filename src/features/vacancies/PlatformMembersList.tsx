import { useState } from 'react';
import { LinkedinLogo } from '@phosphor-icons/react';
import type { PlatformMember } from './vacancyLetterApi';
import { platformMemberMessage } from './vacancyPathCircles';

/**
 * B561 (owner 30.10): platform members are 1st circle to each other. Circle 2 names
 * the members who know someone at the company, with their LinkedIn and a first
 * message to send there. The platform itself sends nothing.
 */
export function PlatformMembersList({
  companyName,
  members,
}: {
  readonly companyName: string;
  readonly members: readonly PlatformMember[];
}) {
  if (members.length === 0) return null;
  return (
    <div className="vacancy-platform-members">
      <b>Участники OpenQareer</b>
      <ul>
        {members.map((member) => (
          <PlatformMemberItem
            key={member.fullName + (member.linkedinUrl ?? '') + member.personName}
            member={member}
            companyName={companyName}
          />
        ))}
      </ul>
    </div>
  );
}

function PlatformMemberItem({
  member,
  companyName,
}: {
  readonly member: PlatformMember;
  readonly companyName: string;
}) {
  const message = platformMemberMessage(member, companyName);
  // The server canonicalizes the address; the page still links only to a LinkedIn profile.
  const profileUrl = member.linkedinUrl?.startsWith('https://www.linkedin.com/in/')
    ? member.linkedinUrl
    : null;
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = () => {
    navigator.clipboard
      .writeText(message)
      .then(() => setCopied('done'))
      .catch(() => setCopied('failed'));
  };
  return (
    <li>
      <p>
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noreferrer noopener">
            <LinkedinLogo size={14} aria-hidden="true" /> {member.fullName}
          </a>
        ) : (
          <>
            {member.fullName} · <small>Профиль LinkedIn не указан</small>
          </>
        )}{' '}
        знает {member.personName}
      </p>
      <p className="vacancy-platform-message">{message}</p>
      <button type="button" className="vac-sm" onClick={copy}>
        Скопировать сообщение
      </button>
      {copied === 'done' ? <small role="status">Скопировано</small> : null}
      {copied === 'failed' ? (
        <small role="alert">Не удалось скопировать: выделите текст и скопируйте вручную.</small>
      ) : null}
    </li>
  );
}
