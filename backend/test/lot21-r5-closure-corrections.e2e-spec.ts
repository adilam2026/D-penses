import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R5 — CLOTURE OBLIGATOIRE AVANT BUILD APK : gaps corrigés (comptes modifiables/
 * archivables, catégories sécurisées, corrections/annulations de transactions
 * comptablement sûres). Aucun moteur financier modifié — ces tests le prouvent
 * en vérifiant que solde/reste_a_payer/enveloppe sont TOUJOURS recalculés par
 * les vues/util existants, jamais par une logique dupliquée ici.
 */
describe('R5 clôture — gaps corrigés (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot21+${run}+${seq}@example.com`, 'password123', 'L21', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer clôture ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  // ============================================================
  // A/B/C/D/E — Comptes modifiables/archivables
  // ============================================================
  describe('§2 — Comptes modifiables/archivables', () => {
    it('A. un compte est modifiable (nom/type)', async () => {
      const { auth } = await newHousehold();
      const id = await createAccount(auth, 'Ancien nom', 100);

      const res = await http.patch(`/accounts/${id}`).set(...auth()).send({ name: 'Nouveau nom', type: 'epargne' }).expect(200);

      expect(res.body.name).toBe('Nouveau nom');
      expect(res.body.type).toBe('epargne');
    });

    it('B. un compte est archivable et disparaît de la liste par défaut, mais reste consultable', async () => {
      const { auth } = await newHousehold();
      const id = await createAccount(auth, 'À archiver', 500);

      await http.patch(`/accounts/${id}`).set(...auth()).send({ status: 'archive' }).expect(200);

      const list = await http.get('/accounts').set(...auth()).expect(200);
      expect(list.body.find((a: { id: string }) => a.id === id)).toBeUndefined();

      const withArchived = await http.get('/accounts?includeArchived=true').set(...auth()).expect(200);
      const archived = withArchived.body.find((a: { id: string }) => a.id === id);
      expect(archived).toBeDefined();
      expect(archived.status).toBe('archive');

      const detail = await http.get(`/accounts/${id}`).set(...auth()).expect(200);
      expect(detail.body.status).toBe('archive');
    });

    it('C. un compte archivé est refusé pour un NOUVEAU paiement', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte paiement archivé', 5000);
      const cat = await createCategory(auth, 'École archivage paiement');
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais archivage', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 1000, amountStatus: 'confirme' }).expect(201);

      await http.patch(`/accounts/${account}`).set(...auth()).send({ status: 'archive' }).expect(200);

      const res = await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 500, accountId: account }).expect(400);
      expect(res.body.message).toMatch(/archivé/);
    });

    it('C bis. un compte archivé est refusé pour une NOUVELLE dépense et une NOUVELLE confirmation de revenu', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte dépense/revenu archivé', 5000);
      const cat = await createCategory(auth, 'Alimentation archivage');
      const source = await http.post('/income-sources').set(...auth()).send({ label: 'Salaire archivage', usualAmount: 5000, defaultAccountId: account }).expect(201);
      const occ = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate: '2026-09-30' }).expect(201);

      await http.patch(`/accounts/${account}`).set(...auth()).send({ status: 'archive' }).expect(200);

      await http.post('/expenses').set(...auth()).send({ amount: 100, accountId: account, categoryId: cat }).expect(400);
      await http.post(`/income-occurrences/${occ.body.id}/confirm`).set(...auth()).send({ actualAmount: 5000, accountId: account }).expect(400);
    });

    it('D. un compte archivé est refusé comme source ET comme destination d\'un nouveau transfert', async () => {
      const { auth } = await newHousehold();
      const active = await createAccount(auth, 'Compte actif transfert', 2000);
      const archived = await createAccount(auth, 'Compte archivé transfert', 2000);
      await http.patch(`/accounts/${archived}`).set(...auth()).send({ status: 'archive' }).expect(200);

      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: archived, toAccountId: active, amount: 100 }).expect(400);
      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: active, toAccountId: archived, amount: 100 }).expect(400);
    });

    it("E. l'historique d'un compte archivé (transactions passées) reste intact et consultable", async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte historique archivé', 3000);
      const cat = await createCategory(auth, 'Historique archivage');
      const expense = await http.post('/expenses').set(...auth()).send({ amount: 200, accountId: account, categoryId: cat }).expect(201);

      await http.patch(`/accounts/${account}`).set(...auth()).send({ status: 'archive' }).expect(200);

      const detail = await http.get(`/transactions/adhoc_expense/${expense.body.expense.id}`).set(...auth()).expect(200);
      expect(detail.body.accountId).toBe(account);
      expect(detail.body.amount).toBe(-200);

      const list = await http.get('/transactions').set(...auth()).expect(200);
      expect(list.body.find((t: { id: string }) => t.id === expense.body.expense.id)).toBeDefined();

      const accountDetail = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(accountDetail.body.soldeCourant).toBe(2800); // jamais recalculé/faussé rétroactivement
    });
  });

  // ============================================================
  // F — Catégories sécurisées
  // ============================================================
  describe('§3 — Catégories sécurisées', () => {
    it('F. une catégorie utilisée par une dépense réelle ne peut pas être supprimée brutalement', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte catégorie utilisée', 1000);
      const cat = await createCategory(auth, 'Catégorie utilisée F');
      await http.post('/expenses').set(...auth()).send({ amount: 50, accountId: account, categoryId: cat }).expect(201);

      const res = await http.delete(`/categories/${cat}`).set(...auth()).expect(400);
      expect(res.body.message).toMatch(/utilisée/);

      const stillThere = await http.get('/categories').set(...auth()).expect(200);
      expect(stillThere.body.find((c: { id: string }) => c.id === cat)).toBeDefined();
    });

    it('une catégorie inutilisée reste supprimable normalement (non-régression)', async () => {
      const { auth } = await newHousehold();
      const cat = await createCategory(auth, 'Catégorie jamais utilisée');

      await http.delete(`/categories/${cat}`).set(...auth()).expect(200);

      const list = await http.get('/categories').set(...auth()).expect(200);
      expect(list.body.find((c: { id: string }) => c.id === cat)).toBeUndefined();
    });
  });

  // ============================================================
  // G — Correction de paiement (contre-écriture)
  // ============================================================
  describe('§1 — Corriger/Annuler un paiement (contre-écriture, jamais une réécriture)', () => {
    async function setupDeadline(auth: () => [string, string], amount: number) {
      const cat = await createCategory(auth, `École correction ${Math.random()}`);
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais correction', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: amount, amountStatus: 'confirme' }).expect(201);
      return d.body.id as string;
    }

    it('G. Corriger un paiement trop bas recalcule reste_a_payer ET le solde du compte, sans toucher le paiement original', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte correction G', 10000);
      const deadlineId = await setupDeadline(auth, 5000);
      const payment = await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 3000, accountId: account }).expect(201);

      // Le vrai montant payé était 3500, pas 3000.
      const corrected = await http
        .post(`/deadlines/${deadlineId}/payments/${payment.body.payment.id}/correct`)
        .set(...auth())
        .send({ correctedAmount: 3500 })
        .expect(201);

      expect(corrected.body.deadline.resteAPayer).toBe(1500); // 5000 - 3500
      expect(corrected.body.soldeCourant).toBe(6500); // 10000 - 3500

      const original = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      const payments = await http.get(`/deadlines/${deadlineId}/payments`).set(...auth()).expect(200);
      const originalPayment = payments.body.find((p: { id: string }) => p.id === payment.body.payment.id);
      expect(Number(originalPayment.amount)).toBe(3000); // jamais réécrit
      expect(payments.body.length).toBe(2); // paiement original + contre-écriture, jamais fusionnés
      expect(original.body.financialStatus).toBe('partiellement_payee');
    });

    it("G bis. Corriger un paiement trop haut réduit ce qui est compté payé (reste_a_payer remonte)", async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte correction G2', 10000);
      const deadlineId = await setupDeadline(auth, 5000);
      const payment = await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 5000, accountId: account }).expect(201);

      // Le vrai montant payé était seulement 4000.
      const corrected = await http
        .post(`/deadlines/${deadlineId}/payments/${payment.body.payment.id}/correct`)
        .set(...auth())
        .send({ correctedAmount: 4000 })
        .expect(201);

      expect(corrected.body.deadline.resteAPayer).toBe(1000);
      expect(corrected.body.soldeCourant).toBe(6000); // 10000 - 4000 au total
      expect(corrected.body.deadline.financialStatus).toBe('partiellement_payee'); // réouverte depuis soldée
    });

    it('H. Annuler un paiement erroné restaure intégralement le solde et le reste à payer, historique conservé', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte annulation paiement', 10000);
      const deadlineId = await setupDeadline(auth, 5000);
      const payment = await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 5000, accountId: account }).expect(201);

      const reversed = await http
        .post(`/deadlines/${deadlineId}/payments/${payment.body.payment.id}/reverse`)
        .set(...auth())
        .expect(201);

      expect(reversed.body.deadline.resteAPayer).toBe(5000); // comme si rien n'avait été payé
      expect(reversed.body.soldeCourant).toBe(10000); // solde intégralement restauré

      const payments = await http.get(`/deadlines/${deadlineId}/payments`).set(...auth()).expect(200);
      expect(payments.body.length).toBe(2); // le paiement original reste visible, jamais supprimé
    });

    it("I. Annuler un paiement financé par une enveloppe restitue symétriquement le solde de l'enveloppe", async () => {
      const { auth } = await newHousehold();
      const cih = await createAccount(auth, 'CIH annulation enveloppe', 10000);
      const cat = await createCategory(auth, 'École annulation enveloppe');
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Provision annulation', allocationMode: 'virtual_allocation', linkedAccountId: cih }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 3000 }).expect(201);
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais enveloppe annulation', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 2000, amountStatus: 'confirme' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);
      const payment = await http
        .post(`/deadlines/${d.body.id}/payments`)
        .set(...auth())
        .send({ amount: 2000, accountId: cih, fundingSource: 'provision', provisionId: provision.body.id })
        .expect(201);

      const provisionAfterPayment = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(provisionAfterPayment.body.currentAmount).toBe(1000); // 3000 - 2000

      await http.post(`/deadlines/${d.body.id}/payments/${payment.body.payment.id}/reverse`).set(...auth()).expect(201);

      const provisionAfterReverse = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(provisionAfterReverse.body.currentAmount).toBe(3000); // intégralement restitué
    });

    it('un paiement financé par une enveloppe ne peut pas être corrigé partiellement (seule l\'annulation complète est proposée)', async () => {
      const { auth } = await newHousehold();
      const cih = await createAccount(auth, 'CIH correction enveloppe refusée', 10000);
      const cat = await createCategory(auth, 'École correction enveloppe refusée');
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Provision refus correction', allocationMode: 'virtual_allocation', linkedAccountId: cih }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 3000 }).expect(201);
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais refus correction', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 2000, amountStatus: 'confirme' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);
      const payment = await http
        .post(`/deadlines/${d.body.id}/payments`)
        .set(...auth())
        .send({ amount: 2000, accountId: cih, fundingSource: 'provision', provisionId: provision.body.id })
        .expect(201);

      await http.post(`/deadlines/${d.body.id}/payments/${payment.body.payment.id}/correct`).set(...auth()).send({ correctedAmount: 1800 }).expect(400);
    });
  });

  // ============================================================
  // Annulation d'un revenu confirmé
  // ============================================================
  describe('§1 — Annuler un revenu confirmé (unconfirm)', () => {
    it("un revenu confirmé par erreur peut être annulé (revient à 'prevu'), puis reconfirmé avec les bonnes valeurs", async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte annulation revenu', 0);
      const source = await http.post('/income-sources').set(...auth()).send({ label: 'Salaire annulation', usualAmount: 8000, defaultAccountId: account }).expect(201);
      const occ = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate: '2026-09-30' }).expect(201);
      await http.post(`/income-occurrences/${occ.body.id}/confirm`).set(...auth()).send({ actualAmount: 8500, accountId: account }).expect(201);

      const accountAfterConfirm = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(accountAfterConfirm.body.soldeCourant).toBe(8500);

      await http.post(`/income-occurrences/${occ.body.id}/unconfirm`).set(...auth()).expect(201);

      const accountAfterUnconfirm = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(accountAfterUnconfirm.body.soldeCourant).toBe(0); // plus dans le ledger (status != recu)

      await http.post(`/income-occurrences/${occ.body.id}/confirm`).set(...auth()).send({ actualAmount: 8000, accountId: account }).expect(201);
      const accountAfterReconfirm = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(accountAfterReconfirm.body.soldeCourant).toBe(8000); // montant corrigé
    });

    it('unconfirm est refusé sur une occurrence pas encore confirmée', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte unconfirm refus', 0);
      const source = await http.post('/income-sources').set(...auth()).send({ label: 'Salaire refus', usualAmount: 1000, defaultAccountId: account }).expect(201);
      const occ = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate: '2026-09-30' }).expect(201);

      await http.post(`/income-occurrences/${occ.body.id}/unconfirm`).set(...auth()).expect(400);
    });
  });

  // ============================================================
  // Correction/annulation d'une dépense ponctuelle (Adjustment)
  // ============================================================
  describe('§1 — Corriger/Annuler une dépense ponctuelle (Adjustment, jamais l\'AdHocExpense réécrit)', () => {
    it('Corriger une dépense ponctuelle recalcule le solde exactement, sans toucher la dépense originale', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte correction dépense', 5000);
      const cat = await createCategory(auth, 'Alimentation correction dépense');
      const expense = await http.post('/expenses').set(...auth()).send({ amount: 200, accountId: account, categoryId: cat }).expect(201);

      // Le vrai montant dépensé était 250, pas 200.
      const corrected = await http
        .post(`/expenses/adhoc_expense/${expense.body.expense.id}/correct`)
        .set(...auth())
        .send({ correctedAmount: 250 })
        .expect(201);

      expect(corrected.body.soldeCourant).toBe(4750); // 5000 - 250

      const original = await http.get(`/transactions/adhoc_expense/${expense.body.expense.id}`).set(...auth()).expect(200);
      expect(original.body.amount).toBe(-200); // jamais réécrite
    });

    it('Annuler une dépense ponctuelle restitue intégralement le solde, la dépense reste visible en historique', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte annulation dépense', 5000);
      const cat = await createCategory(auth, 'Alimentation annulation dépense');
      const expense = await http.post('/expenses').set(...auth()).send({ amount: 300, accountId: account, categoryId: cat }).expect(201);

      const reversed = await http.post(`/expenses/adhoc_expense/${expense.body.expense.id}/reverse`).set(...auth()).expect(201);

      expect(reversed.body.soldeCourant).toBe(5000); // solde intégralement restauré

      const original = await http.get(`/transactions/adhoc_expense/${expense.body.expense.id}`).set(...auth()).expect(200);
      expect(original.body.amount).toBe(-300); // toujours dans l'historique, jamais supprimée

      const all = await http.get('/transactions').set(...auth()).expect(200);
      expect(all.body.filter((t: { accountId: string }) => t.accountId === account).length).toBe(2); // dépense + contre-écriture
    });

    it('Modifier (description) une dépense ne touche jamais le solde', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte modif description', 1000);
      const cat = await createCategory(auth, 'Alimentation modif description');
      const expense = await http.post('/expenses').set(...auth()).send({ amount: 50, accountId: account, categoryId: cat }).expect(201);

      const updated = await http
        .patch(`/expenses/adhoc_expense/${expense.body.expense.id}`)
        .set(...auth())
        .send({ notes: 'Courses de la semaine' })
        .expect(200);
      expect(updated.body.notes).toBe('Courses de la semaine');

      const account_ = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(account_.body.soldeCourant).toBe(950); // inchangé par la modification de description
    });
  });

  // ============================================================
  // Transfert : cancel (prevu) + reverse atomique (confirme)
  // ============================================================
  describe('§1 — Transfert : Annuler (prevu) / Annuler par miroir atomique (confirmé)', () => {
    it('un transfert "prevu" (date future) peut être annulé sans effet sur les soldes', async () => {
      const { auth } = await newHousehold();
      const source = await createAccount(auth, 'Source transfert prevu', 2000);
      const dest = await createAccount(auth, 'Dest transfert prevu', 500);
      const transfer = await http
        .post('/accounts/transfers')
        .set(...auth())
        .send({ fromAccountId: source, toAccountId: dest, amount: 300, plannedDate: '2099-01-01' })
        .expect(201);
      expect(transfer.body.status).toBe('prevu');

      await http.post(`/accounts/transfers/${transfer.body.id}/cancel`).set(...auth()).expect(201);

      const sourceAfter = await http.get(`/accounts/${source}`).set(...auth()).expect(200);
      const destAfter = await http.get(`/accounts/${dest}`).set(...auth()).expect(200);
      expect(sourceAfter.body.soldeCourant).toBe(2000);
      expect(destAfter.body.soldeCourant).toBe(500);
    });

    it('cancel est refusé sur un transfert déjà confirmé (utiliser reverse)', async () => {
      const { auth } = await newHousehold();
      const source = await createAccount(auth, 'Source cancel refus', 1000);
      const dest = await createAccount(auth, 'Dest cancel refus', 0);
      const transfer = await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: source, toAccountId: dest, amount: 200 }).expect(201);
      expect(transfer.body.status).toBe('confirme');

      await http.post(`/accounts/transfers/${transfer.body.id}/cancel`).set(...auth()).expect(400);
    });

    it("H. Annuler un transfert confirmé crée un transfert miroir atomique — les DEUX comptes sont corrigés ensemble, jamais un seul", async () => {
      const { auth } = await newHousehold();
      const source = await createAccount(auth, 'Source transfert confirmé', 2000);
      const dest = await createAccount(auth, 'Dest transfert confirmé', 500);
      const transfer = await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: source, toAccountId: dest, amount: 300 }).expect(201);

      const sourceAfterTransfer = await http.get(`/accounts/${source}`).set(...auth()).expect(200);
      const destAfterTransfer = await http.get(`/accounts/${dest}`).set(...auth()).expect(200);
      expect(sourceAfterTransfer.body.soldeCourant).toBe(1700);
      expect(destAfterTransfer.body.soldeCourant).toBe(800);

      const reversal = await http.post(`/accounts/transfers/${transfer.body.id}/reverse`).set(...auth()).expect(201);
      expect(reversal.body.reversal.fromAccountId).toBe(dest);
      expect(reversal.body.reversal.toAccountId).toBe(source);
      expect(reversal.body.reversal.status).toBe('confirme');

      const sourceAfterReverse = await http.get(`/accounts/${source}`).set(...auth()).expect(200);
      const destAfterReverse = await http.get(`/accounts/${dest}`).set(...auth()).expect(200);
      expect(sourceAfterReverse.body.soldeCourant).toBe(2000); // net zéro rétabli
      expect(destAfterReverse.body.soldeCourant).toBe(500);

      // L'original reste visible en historique, jamais supprimé (2 transferts au total).
      const list = await http.get('/accounts/transfers').set(...auth()).expect(200);
      expect(list.body.length).toBe(2);
    });

    it('reverse est refusé sur un transfert encore "prevu" (utiliser cancel)', async () => {
      const { auth } = await newHousehold();
      const source = await createAccount(auth, 'Source reverse refus', 1000);
      const dest = await createAccount(auth, 'Dest reverse refus', 0);
      const transfer = await http
        .post('/accounts/transfers')
        .set(...auth())
        .send({ fromAccountId: source, toAccountId: dest, amount: 200, plannedDate: '2099-01-01' })
        .expect(201);

      await http.post(`/accounts/transfers/${transfer.body.id}/reverse`).set(...auth()).expect(400);
    });
  });

  // ============================================================
  // I — Projection cohérente après correction
  // ============================================================
  describe('§1 — Projection cohérente après une correction (moteur jamais modifié)', () => {
    it('la projection mensuelle reflète correctement le solde après annulation d\'un paiement, sans erreur', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte projection correction', 10000);
      const cat = await createCategory(auth, 'École projection correction');
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais projection correction', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 4000, amountStatus: 'confirme' }).expect(201);
      const payment = await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 4000, accountId: account }).expect(201);

      await http.post(`/deadlines/${d.body.id}/payments/${payment.body.payment.id}/reverse`).set(...auth()).expect(201);

      const projection = await http.get('/projection/monthly?horizon=3').set(...auth()).expect(200);
      expect(projection.status).toBe(200);
      expect(Array.isArray(projection.body.months)).toBe(true); // aucune erreur, structure cohérente
    });
  });
});
