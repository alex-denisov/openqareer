export class AuthUsernameTakenError extends Error {
  constructor() {
    super('username is already registered');
    this.name = 'AuthUsernameTakenError';
  }
}

export class AuthEmailTakenError extends Error {
  constructor() {
    super('email is already registered');
    this.name = 'AuthEmailTakenError';
  }
}

export class AuthInvalidPasswordError extends Error {
  constructor() {
    super('invalid password');
    this.name = 'AuthInvalidPasswordError';
  }
}

export class AuthInvalidResetTokenError extends Error {
  constructor() {
    super('invalid or expired reset token');
    this.name = 'AuthInvalidResetTokenError';
  }
}

export class AuthUserBlockedError extends Error {
  constructor() {
    super('user account is blocked');
    this.name = 'AuthUserBlockedError';
  }
}

export class AuthDisposableEmailError extends Error {
  constructor(
    message = 'Временные и одноразовые почтовые ящики не поддерживаются. Пожалуйста, укажите постоянный рабочий или личный email.',
  ) {
    super(message);
    this.name = 'AuthDisposableEmailError';
  }
}

export class AuthEmailDomainUnreachableError extends Error {
  constructor() {
    super('У этого адреса почта не принимается. Проверьте домен после @.');
    this.name = 'AuthEmailDomainUnreachableError';
  }
}

export class AuthEmailVerificationInvalidCodeError extends Error {
  constructor() {
    super('Код не подходит. Проверьте письмо и попробуйте ещё раз.');
    this.name = 'AuthEmailVerificationInvalidCodeError';
  }
}

export class AuthEmailVerificationExpiredError extends Error {
  constructor() {
    super('Срок действия кода закончился. Отправьте новый код.');
    this.name = 'AuthEmailVerificationExpiredError';
  }
}

export class AuthEmailVerificationLockedError extends Error {
  constructor() {
    super('Попытки закончились. Отправьте новый код.');
    this.name = 'AuthEmailVerificationLockedError';
  }
}

export class AuthEmailVerificationResendTooSoonError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Повторно отправить код можно через ${retryAfterSeconds} с.`);
    this.name = 'AuthEmailVerificationResendTooSoonError';
  }
}

export class AuthEmailVerificationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Лимит отправки кода исчерпан. Попробуйте позже.');
    this.name = 'AuthEmailVerificationRateLimitError';
  }
}

export class AuthEmailVerificationDeliveryError extends Error {
  constructor() {
    super('Не удалось отправить письмо с кодом. Попробуйте ещё раз.');
    this.name = 'AuthEmailVerificationDeliveryError';
  }
}

export class AuthEmailVerificationNotRequiredError extends Error {
  constructor() {
    super('Адрес уже подтверждён. Войдите в кабинет.');
    this.name = 'AuthEmailVerificationNotRequiredError';
  }
}

export class AuthEmailChangeRequiresVerificationError extends Error {
  constructor() {
    super('Для смены email потребуется отдельное подтверждение нового адреса.');
    this.name = 'AuthEmailChangeRequiresVerificationError';
  }
}
