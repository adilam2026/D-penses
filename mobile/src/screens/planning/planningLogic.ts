import type { MonthBucketApi } from '../../api/client';

export type PlanningSection = 'revenus' | 'charges' | 'enveloppes' | 'exceptionnel';

export const SECTION_LABEL: Record<PlanningSection, string> = {
  revenus: 'Revenus',
  charges: 'Charges connues',
  enveloppes: 'Enveloppes',
  exceptionnel: 'Exceptionnel',
};

export const SECTION_ORDER: PlanningSection[] = ['revenus', 'charges', 'enveloppes', 'exceptionnel'];

export interface PlanningRow {
  key: string;
  label: string;
  section: PlanningSection;
  valuesByMonth: Record<string, number>;
  // Convergence V6 §7/§8 — quand la charge appartient à un plan financier
  // (regroupement simple de charges, RIEN d'autre : pas d'objectif d'épargne,
  // pas de couverture), ce champ permet de nicher la ligne sous le total du
  // plan dans CHARGES CONNUES, jamais recalculé ici (déjà exposé par le
  // backend sur MonthlyLineItem.financialPlanId).
  financialPlanId?: string | null;
}

export interface FinancialPlanRef {
  id: string;
  label: string;
}

/** Ligne synthétique = total mensuel du plan (somme de ses charges). */
export interface PlanningPlanTotalRow {
  key: string;
  label: string;
  section: PlanningSection;
  valuesByMonth: Record<string, number>;
  financialPlanId: string;
  children: PlanningRow[];
}

export type PlanningTreeItem = { kind: 'standalone'; row: PlanningRow } | { kind: 'plan'; row: PlanningPlanTotalRow };

export interface PlanningProvision {
  id: string;
  name: string;
  monthlyCalendar: { month: string; recommendedAmount: number }[];
}

/**
 * Refonte maquette V6B §5 — transforme la projection mensuelle (déjà calculée
 * côté backend, jamais recalculée ici) en une grille façon tableur : chaque
 * ligne est une série identifiée par (section, entité/libellé) et porte un
 * montant par mois, pour permettre un tableau multi-mois avec 1re colonne
 * figée. Les postes "projet" (rattachés à un plan financier à échéances)
 * vont en EXCEPTIONNEL, jamais mélangés aux charges récurrentes connues.
 * `provisions` (optionnel) exploite le calendrier mensuel de recommandation
 * (buildMonthlyRecommendationCalendar côté backend, cf. GET
 * /provisions/:id/sufficiency) : chaque plan financier apparaît en ENVELOPPES
 * avec son montant recommandé RÉEL par mois, jamais un second calcul.
 */
export function buildPlanningRows(months: MonthBucketApi[], provisions: PlanningProvision[] = []): PlanningRow[] {
  const rows = new Map<string, PlanningRow>();

  function addRow(section: PlanningSection, rowKey: string, label: string, month: string, amount: number, financialPlanId?: string | null) {
    const key = `${section}:${rowKey}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, label, section, valuesByMonth: {}, financialPlanId: financialPlanId ?? null };
      rows.set(key, row);
    }
    row.valuesByMonth[month] = (row.valuesByMonth[month] ?? 0) + amount;
  }

  for (const m of months) {
    for (const item of m.income_items) {
      addRow('revenus', `${item.entityType}:${item.label}`, item.label, m.month, item.amount);
    }
    for (const item of m.expense_items) {
      // Convergence V6 §3 — un plan financier (regroupement de charges) doit
      // TOUJOURS apparaître dans CHARGES CONNUES, jamais en EXCEPTIONNEL :
      // le backend classe toute charge rattachée à un plan en category=
      // 'projet' (monthly-projection.util.ts classify()), ce qui l'envoyait
      // ici à tort en 'exceptionnel'. financialPlanId prime désormais sur
      // category pour le choix de section.
      const section: PlanningSection = item.financialPlanId ? 'charges' : item.category === 'projet' ? 'exceptionnel' : 'charges';
      addRow(section, `${item.entityType}:${item.label}`, item.label, m.month, item.amount, item.financialPlanId);
    }
    for (const b of m.budget_items_this_period) {
      addRow('enveloppes', b.budget_id, b.label, m.month, b.amount);
    }
  }

  for (const p of provisions) {
    for (const c of p.monthlyCalendar) {
      if (c.recommendedAmount > 0) addRow('enveloppes', `provision:${p.id}`, p.name, c.month, c.recommendedAmount);
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.section !== b.section) return SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    return a.label.localeCompare(b.label, 'fr');
  });
}

/**
 * Convergence V6 §8 — regroupe, à l'intérieur de chaque section, les lignes
 * portant le même financialPlanId sous une ligne totalisée dépliable ([+]/[-]),
 * triée avant les lignes autonomes. Le total du plan = somme, mois par mois,
 * des charges qui lui appartiennent (jamais un second calcul de montant).
 */
export function groupRowsByPlan(rows: PlanningRow[], plans: FinancialPlanRef[]): PlanningTreeItem[] {
  const planLabel = new Map(plans.map((p) => [p.id, p.label]));
  const byPlan = new Map<string, PlanningRow[]>();
  const standalone: PlanningRow[] = [];

  for (const row of rows) {
    if (row.financialPlanId) {
      const list = byPlan.get(row.financialPlanId) ?? [];
      list.push(row);
      byPlan.set(row.financialPlanId, list);
    } else {
      standalone.push(row);
    }
  }

  const planItems: PlanningTreeItem[] = Array.from(byPlan.entries()).map(([planId, children]) => {
    const valuesByMonth: Record<string, number> = {};
    for (const child of children) {
      for (const [month, amount] of Object.entries(child.valuesByMonth)) {
        valuesByMonth[month] = (valuesByMonth[month] ?? 0) + amount;
      }
    }
    const label = planLabel.get(planId) ?? 'Plan financier';
    return {
      kind: 'plan',
      row: {
        key: `plan:${planId}`,
        label,
        section: children[0].section,
        valuesByMonth,
        financialPlanId: planId,
        children: children.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr')),
      },
    };
  });

  const standaloneItems: PlanningTreeItem[] = standalone.map((row) => ({ kind: 'standalone', row }));

  return [...planItems, ...standaloneItems].sort((a, b) => a.row.label.localeCompare(b.row.label, 'fr'));
}

export function rowsBySection(rows: PlanningRow[]): Array<{ section: PlanningSection; rows: PlanningRow[] }> {
  return SECTION_ORDER.map((section) => ({ section, rows: rows.filter((r) => r.section === section) })).filter(
    (group) => group.rows.length > 0,
  );
}

export function isCurrentMonth(monthKey: string, now: Date = new Date()): boolean {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return monthKey === current;
}
