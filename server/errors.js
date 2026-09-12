export class ScoreNotFound extends Error {
  constructor(name) {
    super(`score not found: ${name}`);
    this.code = 'SCORE_NOT_FOUND';
    this.status = 404;
  }
}

export class InvalidRequest extends Error {
  constructor(reason) {
    super(`invalid request: ${reason}`);
    this.code = 'INVALID_REQUEST';
    this.status = 400;
  }
}
