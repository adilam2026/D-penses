import { cellResponsibleMemberId, memberColorMap } from '../memberColors';
import { colors } from '../theme';
import type { HouseholdMembershipApi, PlanningCellApi } from '../../api/client';

const member = (id: string, joinedAt?: string, firstName = 'X'): HouseholdMembershipApi => ({ id, role: 'member', joinedAt, user: { id: `u-${id}`, firstName, lastName: 'L', email: `${id}@t.local`, color: null } });

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

describe('memberColorMap', () => {
  it('1er membre arrivé = bleu, 2e = rose (joinedAt), indépendamment du prénom et de l’ordre de la liste', () => {
    const map = memberColorMap([member('b', '2026-02-01', 'Adil'), member('a', '2026-01-01', 'Lamiaa')]);
    expect(map.get('a')).toBe(colors.memberBlue);
    expect(map.get('b')).toBe(colors.memberPink);
  });
  it('sans joinedAt : ordre du foyer conservé ; au-delà de 2 membres, aucune couleur dédiée', () => {
    const map = memberColorMap([member('a'), member('b'), member('c')]);
    expect(map.get('a')).toBe(colors.memberBlue);
    expect(map.get('b')).toBe(colors.memberPink);
    expect(map.has('c')).toBe(false);
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
