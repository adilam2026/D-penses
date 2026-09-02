import request from 'supertest';
import { FakeMailer } from './fake-mailer';

/**
 * Inscription + confirmation OTP complètes, pour les suites qui n'ont besoin
 * que du token final (la plupart) — jamais un contournement de
 * verifyEmailOtp, juste la même séquence qu'un vrai client : signup, lecture
 * du code capturé par FakeMailer, POST /auth/verify-email-otp.
 */
export async function signupVerified(
  http: request.Agent,
  mailer: FakeMailer,
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  await http.post('/auth/signup').send({ email, password, firstName, lastName }).expect(201);
  const code = mailer.lastCodeFor(email);
  const verified = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
  return verified.body.accessToken as string;
}
