import { ConfigService } from '@nestjs/config';
import { ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { isTrivialPin, PIN_PATTERN } from './pin.util';
import { IpRateLimitGuard } from './ip-rate-limit.guard';
import { MailerService } from './mailer.service';

describe('code personnel — règles', () => {
  it('exactement 6 chiffres', () => {
    for (const ok of ['482913', '000001', '730518']) expect(PIN_PATTERN.test(ok)).toBe(true);
    for (const ko of ['48291', '4829134', 'abcdef', ' 48291', '48291\n']) expect(PIN_PATTERN.test(ko)).toBe(false);
  });

  it('triviaux : chiffres identiques et suites de pas ±1, rien de plus', () => {
    for (const trivial of ['000000', '111111', '999999', '123456', '234567', '456789', '012345', '654321', '987654', '543210']) {
      expect(isTrivialPin(trivial)).toBe(true);
    }
    for (const ok of ['482913', '112233', '121212', '135791', '890123', '102030', '000001']) expect(isTrivialPin(ok)).toBe(false);
  });
});

describe('IpRateLimitGuard', () => {
  const context = (ip: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as unknown as ExecutionContext;

  it('au plus N requêtes par minute et par IP, indépendamment par IP, fenêtre glissante', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const guard = new IpRateLimitGuard({ get: () => '3' } as unknown as ConfigService);
      for (let i = 0; i < 3; i++) expect(guard.canActivate(context('1.1.1.1'))).toBe(true);
      expect(() => guard.canActivate(context('1.1.1.1'))).toThrow(HttpException);
      expect(guard.canActivate(context('2.2.2.2'))).toBe(true);
      now.mockReturnValue(1_000_000 + 60_001);
      expect(guard.canActivate(context('1.1.1.1'))).toBe(true);
    } finally {
      now.mockRestore();
    }
  });
});

describe('MailerService sans fournisseur configuré', () => {
  it('ne journalise jamais un code de réinitialisation', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const mailer = new MailerService({ get: () => undefined } as unknown as ConfigService);
      await mailer.sendOtpEmail('a@test.local', '246810', 'PIN_RESET');
      expect(warn.mock.calls.flat().join(' ')).not.toContain('246810');
    } finally {
      warn.mockRestore();
    }
  });
});
