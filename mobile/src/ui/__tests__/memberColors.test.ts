import { cellResponsibleMemberId, memberColorMap } from '../memberColors';
import { PERSON_COLOR_OPTIONS, personColor } from '../personPalette';
import { ACCOUNT_COLOR_OPTIONS } from '../accountPalette';
import { colors } from '../theme';
import type { HouseholdMembershipApi, PlanningCellApi } from '../../api/client';

const member = (id: string, color: string | null, firstName = 'X'): HouseholdMembershipApi => ({ id, role: 'member', user: { id: `u-${id}`, firstName, lastName: 'L', email: `${id}@t.local`, color } });

function cell(items: Partial<PlanningCellApi['items'][number]>[]): PlanningCellApi {
  return {
    displayAmount: 0,
    budgetAmount: 0,
    pendingAmount: 0,
    realizedAmount: 0,
    status: items.length ? 'PENDING' : 'EMPTY',
    singleOccurrence: null,
    items: items.map((i) => ({ type: 'PLANNED_PENDING', label: 'x', amount: 1, date: '2026-10-01', sourceAccountId: null, sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, ...i })) as PlanningCellApi['items'],
  };
}

describe('palette des personnes', () => {
  it('mêmes clés que le backend, teintes reprises de la palette des comptes', () => {
    expect(PERSON_COLOR_OPTIONS.map((o) => o.key)).toEqual(['bleu', 'rose', 'violet', 'turquoise', 'azur', 'mauve']);
    const accountHexes = ACCOUNT_COLOR_OPTIONS.map((o) => o.bg);
    for (const o of PERSON_COLOR_OPTIONS) expect(accountHexes).toContain(o.bg);
  });
  it('aucune teinte d’état (vert payé, orange partiel, rouge négatif)', () => {
    const hexes = PERSON_COLOR_OPTIONS.map((o) => o.bg);
    for (const state of [colors.success, colors.warning, colors.danger]) expect(hexes).not.toContain(state);
  });
  it('clé absente ou inconnue : aucune couleur', () => {
    expect(personColor(null)).toBeUndefined();
    expect(personColor('jaune')).toBeUndefined();
    expect(personColor('bleu')).toBe(ACCOUNT_COLOR_OPTIONS.find((o) => o.key === 'bleu_electrique')!.bg);
  });
});

describe('memberColorMap', () => {
  it('lit User.color de chaque membre, jamais son prénom ni sa position', () => {
    const map = memberColorMap([member('a', 'rose', 'Adil'), member('b', 'bleu', 'Lamiaa')]);
    expect(map.get('a')).toBe(personColor('rose'));
    expect(map.get('b')).toBe(personColor('bleu'));
  });
  it('sans couleur : absent de la table (neutre) ; deux personnes peuvent partager une couleur', () => {
    const map = memberColorMap([member('a', null), member('b', 'violet'), member('c', 'violet')]);
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe(map.get('c'));
  });
});

describe('cellResponsibleMemberId', () => {
  it('responsable unique de toutes les opérations de la case', () => {
    expect(cellResponsibleMemberId(cell([{ responsibleMemberId: 'a' }, { type: 'PLANNED_REALIZED', responsibleMemberId: 'a' }]))).toBe('a');
  });
  it('sans responsable, responsables mélangés, opération réelle non planifiée ou case vide : aucun', () => {
    expect(cellResponsibleMemberId(cell([{ responsibleMemberId: null }]))).toBeNull();
    expect(cellResponsibleMemberId(cell([{}]))).toBeNull();
    expect(cellResponsibleMemberId(cell([{ responsibleMemberId: 'a' }, { responsibleMemberId: 'b' }]))).toBeNull();
    expect(cellResponsibleMemberId(cell([{ responsibleMemberId: 'a' }, { type: 'REAL_UNPLANNED' }]))).toBeNull();
    expect(cellResponsibleMemberId(cell([]))).toBeNull();
  });
  it('jamais déduit du libellé de l’opération', () => {
    expect(cellResponsibleMemberId(cell([{ label: 'Salaire Adil', responsibleMemberId: 'lamiaa' }]))).toBe('lamiaa');
    expect(cellResponsibleMemberId(cell([{ label: 'Salaire Adil', responsibleMemberId: null }]))).toBeNull();
  });
});
