import React from 'react';
import { AUTHOR, AUTHOR_PHOTO_PATH } from '../../../shared/author';

/** Карточка автора в статье: фото из профиля, имя, должность, одна фраза. */
export function AuthorByline() {
  return (
    <div className="oq-guide-byline">
      <img src={AUTHOR_PHOTO_PATH} alt="" width={40} height={40} loading="lazy" />
      <p>
        <a href={AUTHOR.linkedin} rel="author noopener">
          <b>{AUTHOR.name}</b>
        </a>
        <span>{AUTHOR.jobTitle}</span>
        <small>{AUTHOR.note}</small>
      </p>
    </div>
  );
}
