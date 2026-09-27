import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';

interface GuideSection {
  key: string;
  title: string;
  text: string;
}

const SECTIONS: GuideSection[] = [
  {
    key: 'comptes',
    title: 'Comptes',
    text: 'Un compte représente un compte bancaire réel (courant, épargne, espèces…). Son solde est toujours le montant réellement disponible, calculé à partir de l\'historique de ses opérations — jamais une valeur saisie à la main.',
  },
  {
    key: 'sous-comptes',
    title: 'Sous-comptes',
    text: 'Un sous-compte réserve une partie de l\'argent d\'un compte bancaire pour un usage précis (voiture, voyage, santé…). Cet argent reste physiquement sur le compte bancaire support : Finance Maison l\'identifie simplement comme réservé. Le reste, non réservé, s\'appelle le « non affecté ».',
  },
  {
    key: 'planning',
    title: 'Planning',
    text: 'Le Planning affiche mois par mois ce qui est prévu (échéances à venir) et ce qui a été réalisé. Une échéance non encore payée reste modifiable ; une fois payée, elle passe dans l\'historique du compte concerné.',
  },
  {
    key: 'epargne',
    title: 'Épargne',
    text: 'L\'onglet Épargne regroupe tous vos comptes d\'épargne et sous-comptes de réserve, avec la progression de vos objectifs éventuels. C\'est une vue de suivi ; la gestion (créer, renommer, désactiver) se fait depuis Organisation → Épargne & sous-comptes.',
  },
  {
    key: 'sante',
    title: 'Santé / Mutuelle',
    text: 'Chaque dépense de santé peut être marquée comme remboursable par la mutuelle. Finance Maison suit alors le dossier jusqu\'au remboursement reçu, et affiche ce qui reste à charge tant que le dossier n\'est pas clôturé.',
  },
  {
    key: 'plans',
    title: 'Plans financiers',
    text: 'Un plan financier regroupe des postes récurrents ou ponctuels autour d\'échéances (ex. rentrée scolaire). Il calcule combien mettre de côté chaque mois pour être prêt à temps, à partir de ce qui est déjà disponible sur le compte lié.',
  },
];

/** Application → Guide (§15) — aide simple et courte, jamais une réinvention de l'aide contextuelle "?" existante. */
export function GuideScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  return (
    <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Guide</Text>
        <View style={{ width: 20 }} />
      </View>

      {SECTIONS.map((section) => (
        <View key={section.key} style={styles.card}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          <Text style={styles.cardText}>{section.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { ...typography.sectionTitle, marginBottom: spacing.xs },
  cardText: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
});
