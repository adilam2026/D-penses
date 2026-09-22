/**
 * Refonte maquette V6B §6/§7 — logique pure (testable sans rendu) pour les
 * cartes Enveloppes : jamais additif au solde du compte (§2B), toujours
 * dérivé des montants réellement versés (RG-071, cf. backend
 * computePocketCurrentAmount/computeProvisionSufficiency — aucun moteur
 * dupliqué ici, uniquement de la présentation).
 */

export interface PocketLike {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  linkedAccountId: string | null;
  targetAmount: number | string | null;
  targetDate: string | null;
  monthlyContribution: number | string | null;
  currentAmount: number | string;
}

export interface PocketCardView {
  percent: number;
  status: 'objectif_atteint' | 'en_cours' | 'sans_objectif';
  statusLabel: string;
}

export function toNum(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export function computePocketCardView(pocket: PocketLike): PocketCardView {
  const target = toNum(pocket.targetAmount);
  const current = toNum(pocket.currentAmount);
  if (!target) {
    return { percent: 0, status: 'sans_objectif', statusLabel: 'Réserve libre' };
  }
  const percent = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  if (current >= target) {
    return { percent: 100, status: 'objectif_atteint', statusLabel: 'Objectif atteint' };
  }
  return { percent, status: 'en_cours', statusLabel: 'En cours' };
}

export interface SufficiencyStepLike {
  deadlineId: string;
  dueDate: string;
  resteAPayer: number | string;
  cumulativeNeed: number | string;
  moisRestants: number;
  gap: number | string;
  tauxRequis: number | string | null;
}

export interface ProvisionSufficiencyLike {
  currentAmount: number | string;
  steps: SufficiencyStepLike[];
  versementMensuelRecommande: number | string;
  tensionAlert: { deadlineId: string; dueDate: string; manque: number | string } | null;
}

export interface ProvisionCardView {
  percent: number;
  nextDueDate: string | null;
  nextAmount: number;
  hasOpenSteps: boolean;
}

/**
 * §8 — le % "constitué" se lit contre le besoin CUMULÉ jusqu'à la PROCHAINE
 * échéance ouverte (steps[0]) — jamais contre un total global qui inclurait
 * des échéances plus lointaines (sinon le % chuterait artificiellement dès
 * qu'une échéance lointaine est ajoutée, RG-090).
 */
export function computeProvisionCardView(s: ProvisionSufficiencyLike): ProvisionCardView {
  const current = toNum(s.currentAmount);
  if (s.steps.length === 0) {
    return { percent: 100, nextDueDate: null, nextAmount: 0, hasOpenSteps: false };
  }
  const next = s.steps[0];
  const need = toNum(next.cumulativeNeed);
  const percent = need > 0 ? Math.max(0, Math.min(100, Math.round((current / need) * 100))) : 100;
  return { percent, nextDueDate: next.dueDate, nextAmount: toNum(next.resteAPayer), hasOpenSteps: true };
}
