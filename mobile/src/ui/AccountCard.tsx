import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type * as api from '../api/client';
import { colors, elevation, fontFamily, radius, spacing, typography } from './theme';
import { formatDh } from './formatMoney';
import { segmentColor } from './SegmentBar';
import { paletteForAccount } from './accountPalette';

function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * Pastille compte (Accueil, lot correctif §E) — affiche le sigle de la banque
 * (ex. "SG", "BCP", "CIH") quand `account.bank` est renseigné, jamais une
 * banque en dur : seule la valeur réelle du compte est utilisée. À défaut de
 * banque, retombe sur les initiales du nom du compte (comportement historique
 * inchangé).
 */
export function accountBadgeLabel(account: api.AccountApi): string {
  const bank = account.bank?.trim();
  return bank ? bank.toUpperCase() : accountInitials(account.name);
}

/**
 * Carte compte réel + ses enveloppes (sous-comptes) et le non affecté —
 * composant visuel UNIQUE de « MES COMPTES » (Accueil), réutilisé tel quel par
 * Épargne pour que les deux écrans aient la même identité. `renderSubaccountExtra`
 * / `accountExtra` ajoutent une info discrète (objectif) sans changer la carte.
 */
export function AccountCard({
  account,
  accountIdx,
  testIDPrefix,
  onPressAccount,
  onPressSubaccount,
  accountExtra,
  renderSubaccountExtra,
}: {
  account: api.AccountApi;
  accountIdx: number;
  testIDPrefix: string;
  onPressAccount: () => void;
  onPressSubaccount: (sub: api.SubaccountApi) => void;
  accountExtra?: React.ReactNode;
  renderSubaccountExtra?: (sub: api.SubaccountApi) => React.ReactNode;
}) {
  const hasSubaccounts = account.subaccounts.length > 0;
  const palette = paletteForAccount(account.colorKey, accountIdx);

  return (
    <View style={styles.accountCard} testID={`${testIDPrefix}-account-card-${account.id}`}>
      <TouchableOpacity style={styles.accountRow} onPress={onPressAccount} testID={`${testIDPrefix}-account-${account.id}`}>
        <View style={[styles.accountBadge, { backgroundColor: palette.bg }]}>
          <Text style={styles.accountBadgeText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {accountBadgeLabel(account)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountName}>{account.name}</Text>
          <Text style={styles.accountMeta}>
            {account.bank ?? (hasSubaccounts ? `${account.subaccounts.length} sous-compte${account.subaccounts.length > 1 ? 's' : ''}` : 'Compte courant')}
          </Text>
        </View>
        <Text style={styles.accountBalance}>{formatDh(account.balance)}</Text>
      </TouchableOpacity>
      {accountExtra ? <View style={styles.accountExtra}>{accountExtra}</View> : null}

      {hasSubaccounts && (
        <View style={styles.subaccountsList}>
          {account.subaccounts.map((sub, idx) => (
            <TouchableOpacity key={sub.id} style={styles.subaccountItem} onPress={() => onPressSubaccount(sub)} testID={`${testIDPrefix}-subaccount-${sub.id}`}>
              <View style={styles.subaccountRow}>
                <View style={styles.subaccountNameRow}>
                  <View style={[styles.colorDot, { backgroundColor: segmentColor(idx) }]} testID={`${testIDPrefix}-subaccount-dot-${sub.id}`} />
                  <Text style={styles.subaccountName}>{sub.name}</Text>
                </View>
                <Text style={styles.subaccountBalance}>{formatDh(sub.balance)}</Text>
              </View>
              {renderSubaccountExtra?.(sub)}
            </TouchableOpacity>
          ))}
          <View style={styles.subaccountRow}>
            <View style={styles.subaccountNameRow}>
              <View style={[styles.colorDot, { backgroundColor: colors.border }]} />
              <Text style={styles.nonAffecteLabel}>Non affecté</Text>
            </View>
            <Text style={styles.nonAffecteValue} testID={`${testIDPrefix}-non-affecte-${account.id}`}>
              {formatDh(account.nonAffecte)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/** Objectif discret sous une ligne : "6 000 / 20 000 DH" + petite barre — jamais une grosse carte. */
export function GoalProgressLine({ goal, testID }: { goal: api.GoalApi; testID?: string }) {
  return (
    <View style={styles.goalLine} testID={testID}>
      <View style={styles.goalBarTrack}>
        <View style={[styles.goalBarFill, { width: `${Math.max(0, Math.min(100, goal.percent))}%` }]} />
      </View>
      <Text style={styles.goalText}>
        {formatDh(goal.current).replace(/\s*DH$/, '')} / {formatDh(goal.targetAmount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  accountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.sm, ...elevation.card },
  accountRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  accountBadge: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  // fontSize réduit (13 -> 12) pour que des sigles de 3 lettres ("BCP", "CIH")
  // tiennent sans débordement ; adjustsFontSizeToFit (ci-dessus) couvre le cas
  // d'un nom de banque saisi plus long.
  accountBadgeText: { color: colors.textOnPrimary, fontFamily: fontFamily.sansBold, fontSize: 12 },
  accountName: { fontSize: 14, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  accountMeta: { ...typography.caption, marginTop: 2 },
  accountBalance: { fontSize: 15, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  accountExtra: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },

  subaccountsList: { marginTop: 0, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.divider },
  subaccountItem: {},
  subaccountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  subaccountNameRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  subaccountName: { ...typography.body },
  subaccountBalance: { ...typography.body, fontFamily: fontFamily.sansSemiBold },
  nonAffecteLabel: { ...typography.bodySecondary },
  nonAffecteValue: { ...typography.bodySecondary, fontFamily: fontFamily.sansSemiBold },

  goalLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 10 + spacing.sm, paddingBottom: spacing.xs },
  goalBarTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceSecondary, overflow: 'hidden' },
  goalBarFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  goalText: { ...typography.caption, color: colors.textSecondary },
});
