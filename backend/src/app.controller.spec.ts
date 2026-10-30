import { AppController } from './app.controller';

describe('GET /health', () => {
  const original = process.env.RAILWAY_GIT_COMMIT_SHA;
  afterEach(() => {
    if (original === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = original;
  });

  it('expose le commit déployé par Railway (attente de version par la CI post-déploiement)', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abc123';
    expect(new AppController().health()).toEqual(expect.objectContaining({ status: 'ok', commit: 'abc123' }));
  });

  it('commit null hors Railway', () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    expect(new AppController().health().commit).toBeNull();
  });
});
