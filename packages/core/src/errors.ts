/** 领域错误,带 code 供 API 层映射成 HTTP/用户提示。 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Σdebit ≠ Σcredit(铁律 3 · 应用层防线)。 */
export class UnbalancedEntryError extends DomainError {
  constructor(
    public readonly totalDebit: string,
    public readonly totalCredit: string,
  ) {
    super(`unbalanced entry: debit ${totalDebit} <> credit ${totalCredit}`, 'UNBALANCED_ENTRY');
  }
}

/** 没有分录行,或借贷净额为 0 的空凭证。 */
export class EmptyEntryError extends DomainError {
  constructor() {
    super('entry has no lines / zero value', 'EMPTY_ENTRY');
  }
}

/** 单行同时有借和贷,或借贷都为 0。 */
export class InvalidLineError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_LINE');
  }
}

/** 期间已关账/锁定,拒绝写入(铁律:period 关账后拒绝增改)。 */
export class ClosedPeriodError extends DomainError {
  constructor(public readonly status: string) {
    super(`fiscal period is ${status}, refusing to write`, 'CLOSED_PERIOD');
  }
}

/** entry_date 找不到对应 fiscal_period。 */
export class NoFiscalPeriodError extends DomainError {
  constructor(date: string) {
    super(`no fiscal period covers ${date}`, 'NO_FISCAL_PERIOD');
  }
}

/** account 不属于该 org 或已停用。 */
export class InvalidAccountError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_ACCOUNT');
  }
}

export class EntryNotFoundError extends DomainError {
  constructor(id: string) {
    super(`journal entry ${id} not found`, 'ENTRY_NOT_FOUND');
  }
}

export class AlreadyPostedError extends DomainError {
  constructor(id: string) {
    super(`journal entry ${id} is already posted`, 'ALREADY_POSTED');
  }
}
