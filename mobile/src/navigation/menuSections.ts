import { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

/**
 * Convergence V6 (passe unification Web/Android) — menu "Plus" restructuré en
 * 4 sections nommées, GESTION/SANTÉ/PARAMÈTRES en premier (structure demandée
 * explicitement), tout le reste regroupé sous AUTRES plutôt que supprimé
 * (aucune fonction perdue). "Enveloppes (détail)" (EnveloppesLegacy, l'ancien
 * écran Épargne/Provisions) est volontairement retiré de cette liste : la
 * route reste enregistrée dans RootNavigator pour ne rien casser, mais n'est
 * plus un point d'entrée du parcours utilisateur normal.
 */
export const HAMBURGER_SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Gestion',
    items: [
      { label: 'Comptes', icon: 'card-outline', route: 'Accounts' },
      { label: 'Catégories', icon: 'pricetags-outline', route: 'Categories' },
      { label: 'Plans financiers', icon: 'folder-outline', route: 'FinancialPlans' },
      { label: 'Charges / échéances', icon: 'receipt-outline', route: 'Charges' },
      { label: 'Transactions', icon: 'swap-horizontal-outline', route: 'Transactions' },
    ],
  },
  {
    title: 'Santé',
    items: [{ label: 'Suivi mutuelle', icon: 'medkit-outline', route: 'MedicalClaims' }],
  },
  {
    title: 'Paramètres',
    items: [
      { label: 'Profil / foyer', icon: 'home-outline', route: 'HouseholdConfig' },
      { label: 'Préférences', icon: 'options-outline', route: 'Preferences' },
      { label: 'Réinitialiser mes données financières', icon: 'trash-outline', route: 'ResetFinancialData' },
    ],
  },
  {
    title: 'Autres',
    items: [
      { label: 'Revenus réguliers', icon: 'trending-up-outline', route: 'Income' },
      { label: 'Budgets', icon: 'pie-chart-outline', route: 'Budgets' },
      { label: 'Objectifs', icon: 'flag-outline', route: 'Goals' },
      { label: 'Transferts récurrents', icon: 'swap-horizontal-outline', route: 'RecurringTransfers' },
      { label: 'Frais scolaires', icon: 'school-outline', route: 'SchoolWizard' },
      { label: 'Voyages', icon: 'airplane-outline', route: 'TravelWizard' },
      { label: 'Projection', icon: 'analytics-outline', route: 'Projection' },
      { label: 'Calendrier', icon: 'calendar-outline', route: 'Calendrier' },
      { label: 'Simulateur', icon: 'help-buoy-outline', route: 'Simulator' },
      { label: 'Types de dépenses', icon: 'list-outline', route: 'CategoryTypes' },
      { label: 'Membres du foyer', icon: 'people-circle-outline', route: 'HouseholdMembers' },
      { label: 'Enfants', icon: 'people-outline', route: 'Children' },
      { label: 'Mes foyers', icon: 'enter-outline', route: 'JoinHousehold' },
    ],
  },
];

export interface WebNavItem extends MenuItem {
  // Écran atteint via le Tab.Navigator imbriqué (route "Tabs") plutôt qu'une
  // Stack.Screen racine — cf. RootNavigator (Accueil/Transactions/Calendrier
  // n'existent qu'à l'intérieur de "Tabs", jamais en racine).
  parent?: 'Tabs';
}

/**
 * Refonte maquette V6B §6 — navigation PRIMAIRE de la Sidebar Web réduite au
 * strict noyau que l'utilisateur voit en premier (Accueil/Planning/
 * Enveloppes/Transactions), jamais pollué par les anciens modules. Tout le
 * reste (Comptes, Budgets, Plans financiers, Projection, Charges/Échéances,
 * Calendrier…) reste entièrement fonctionnel et atteignable via "Plus"
 * (HamburgerMenuScreen, HAMBURGER_SECTIONS ci-dessus, déjà exhaustif) — rien
 * n'est supprimé, seule la liste vue en premier est simplifiée. Aucune route
 * inventée — toutes existent déjà dans RootNavigator/RootTabs.
 */
export const WEB_SIDEBAR_PRIMARY: WebNavItem[] = [
  { label: 'Accueil', icon: 'home-outline', route: 'Accueil', parent: 'Tabs' },
  { label: 'Planning', icon: 'grid-outline', route: 'Planning', parent: 'Tabs' },
  { label: 'Enveloppes', icon: 'wallet-outline', route: 'Enveloppes', parent: 'Tabs' },
  { label: 'Transactions', icon: 'swap-horizontal-outline', route: 'Transactions', parent: 'Tabs' },
];
