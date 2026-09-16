import { Prisma } from '@prisma/client';
import type { RecurrenceRule } from './recurrence.util';

type TxClient = Prisma.TransactionClient;

/**
 * M7+M8 — un poste saisi dans un assistant Voiture/Maison/Abonnements. La
 * périodicité est TOUJOURS choisie par l'utilisateur (guard-rail §6/§7) : jamais
 * imposée par le type de poste (une "Assurance" peut être annuelle, mensuelle,
 * ou toute autre valeur proposée — aucune règle métier ne la fixe).
 */
export interface WizardPosteItem {
  label: string;
  amount?: number | null;
  recurrenceRule: RecurrenceRule;
  dueDate: string; // date ponctuelle, ou prochaine échéance si récurrent
  endDate?: string | null;
}

/**
 * M7+M8 (guard-rails §8/§9/§17) — création d'UN poste (ChargePlan + première
 * Deadline) pour les assistants Voiture/Maison/Abonnements. Calqué EXACTEMENT
 * sur SchoolWizardService/TravelWizardService (même transaction, même
 * convention amount null → amount_status=inconnu) : réutilise le moteur de
 * récurrence existant (RecurrenceFrequency + ensureChargeDeadlinesUntil),
 * jamais un second moteur financier créé pour les Plans. `vehicleId`/`housingId`
 * rattachent directement le ChargePlan à son entité (guard-rail §4) — jamais
 * uniquement déduit via financialPlanId.
 */
export async function createWizardPoste(
  tx: TxClient,
  params: {
    householdId: string;
    financialPlanId: string;
    item: WizardPosteItem;
    vehicleId?: string | null;
    housingId?: string | null;
  },
) {
  const { householdId, financialPlanId, item, vehicleId, housingId } = params;
  const amountStatus = item.amount === null || item.amount === undefined ? 'inconnu' : 'estime';
  const isPeriodic = item.recurrenceRule !== 'ponctuel';

  const chargePlan = await tx.chargePlan.create({
    data: {
      householdId,
      label: item.label,
      generationMode: isPeriodic ? 'auto_frequence' : 'calendrier_manuel',
      recurrenceRule: item.recurrenceRule,
      obligationStatus: 'obligatoire',
      financialPlanId,
      vehicleId: vehicleId ?? undefined,
      housingId: housingId ?? undefined,
      // Ancre de la récurrence = la date de CE poste (même convention que
      // SchoolWizardService) — jamais une date de plan globale.
      startDate: new Date(item.dueDate),
      endDate: item.endDate ? new Date(item.endDate) : null,
    },
  });

  const deadline = await tx.deadline.create({
    data: {
      chargePlanId: chargePlan.id,
      dueDate: new Date(item.dueDate),
      amountCurrent: amountStatus === 'inconnu' ? null : item.amount,
      amountStatus,
    },
  });

  return { chargePlan, deadline };
}

/**
 * M7+M8 (guard-rail §16) — les Plans Voiture/Maison/Abonnements sont ouverts,
 * sans période naturelle (contrairement École/Voyage). FinancialPlan.periodStart/
 * periodEnd restent NOT NULL en base (métadonnée informative, jamais utilisée
 * pour filtrer/plafonner la génération — seul ChargePlan.endDate, facultatif par
 * poste, joue ce rôle) : convention "aujourd'hui → +50 ans" pour signifier
 * l'absence de fin naturelle, jamais lue ailleurs comme une contrainte réelle.
 */
export function openEndedPeriod(): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 50);
  return { periodStart, periodEnd };
}

/**
 * Corrections UI/UX — garde-fou anti-doublon (point 3) : un plan École
 * équivalent (même(s) enfant(s), même année scolaire) existe-t-il déjà ?
 * Ne bloque JAMAIS la création — signale seulement (l'appelant décide via
 * dto.confirmDuplicate) : un second plan volontaire (redoublement compté à
 * part, correction manuelle...) reste toujours possible. Sans schoolYear
 * fourni, aucune identité fiable à comparer : jamais de faux positif.
 */
export async function findDuplicateSchoolPlan(
  tx: TxClient,
  householdId: string,
  params: { childIds: string[]; schoolYear?: string },
) {
  if (!params.schoolYear || params.childIds.length === 0) return null;
  return tx.financialPlan.findFirst({
    where: {
      householdId,
      planType: 'school',
      schoolYear: params.schoolYear,
      beneficiaries: { some: { childId: { in: params.childIds } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Même principe que findDuplicateSchoolPlan, pour les plans Voiture/Maison :
 * l'identité est le véhicule/logement lui-même (vehicleId/housingId d'un
 * véhicule/logement EXISTANT sélectionné, jamais lors d'une création par nom
 * — dans ce cas aucun plan ne peut déjà exister pour une entité qui vient
 * d'être créée).
 */
export async function findDuplicateEntityPlan(
  tx: TxClient,
  householdId: string,
  criteria: { planType: 'vehicle'; vehicleId: string } | { planType: 'housing'; housingId: string },
) {
  return tx.financialPlan.findFirst({
    where: {
      householdId,
      planType: criteria.planType,
      vehicleId: criteria.planType === 'vehicle' ? criteria.vehicleId : undefined,
      housingId: criteria.planType === 'housing' ? criteria.housingId : undefined,
    },
    orderBy: { createdAt: 'desc' },
  });
}
