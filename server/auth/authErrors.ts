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
