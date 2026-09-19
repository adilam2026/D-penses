import { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

/**
 * Architecture Web v3 §3 — source PARTAGÉE des entrées de navigation
 * "structurelles" (menu ☰ mobile ET sidebar Web), extraite telle quelle de
 * HamburgerMenuScreen (Vague 3 §5) : contenu et ordre strictement inchangés,
 * comportement mobile préservé à l'identique. Les actions quotidiennes
 * (dépense, revenu, paiement...) n'y figurent jamais : elles vivent dans la
 * bottom sheet du bouton "+" (mobile) — sujet non traité par ce lot Web.
 */
export const HAMBURGER_SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Mon foyer',
    items: [
      { label: 'Comptes', icon: 'card-outline', route: 'Accounts' },
      { label: 'Membres du foyer', icon: 'people-circle-outline', route: 'HouseholdMembers' },
      { label: 'Enfants', icon: 'people-outline', route: 'Children' },
      // Corrections consolidées §16/§17 — atteignable à tout moment, pas
      // seulement au premier onboarding (HouseholdSetupScreen reste réservé à
      // ce cas-là) : change de foyer actif parmi les memberships existants ET
      // permet d'en rejoindre un nouveau via invitation, sur le même écran.
      { label: 'Mes foyers', icon: 'enter-outline', route: 'JoinHousehold' },
    ],
  },
  {
    title: 'Mes finances',
    items: [
      { label: 'Revenus réguliers', icon: 'trending-up-outline', route: 'Income' },
      { label: 'Charges récurrentes', icon: 'receipt-outline', route: 'Charges' },
      { label: 'Budgets', icon: 'pie-chart-outline', route: 'Budgets' },
      { label: 'Objectifs', icon: 'flag-outline', route: 'Goals' },
      { label: 'Transferts récurrents', icon: 'swap-horizontal-outline', route: 'RecurringTransfers' },
    ],
  },
  {
    title: 'Mes plans',
    items: [
      { label: 'Plans financiers', icon: 'folder-outline', route: 'FinancialPlans' },
      { label: 'Frais scolaires', icon: 'school-outline', route: 'SchoolWizard' },
      { label: 'Voyages', icon: 'airplane-outline', route: 'TravelWizard' },
    ],
  },
  {
    title: 'Anticiper',
    items: [
      { label: 'Projection', icon: 'analytics-outline', route: 'Projection' },
      { label: 'Calendrier', icon: 'calendar-outline', route: 'Calendrier' },
      { label: 'Simulateur', icon: 'help-buoy-outline', route: 'Simulator' },
    ],
  },
  {
    title: 'Paramètres',
    items: [
      { label: 'Catégories', icon: 'pricetags-outline', route: 'Categories' },
      { label: 'Types de dépenses', icon: 'list-outline', route: 'CategoryTypes' },
      { label: 'Préférences', icon: 'options-outline', route: 'Preferences' },
      { label: 'Configuration du foyer', icon: 'home-outline', route: 'HouseholdConfig' },
      { label: 'Réinitialiser mes données financières', icon: 'trash-outline', route: 'ResetFinancialData' },
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
 * Architecture Web v3 §3/§13 — navigation primaire de la Sidebar Web. Sous-
 * ensemble DÉDIÉ Web (jamais forcé dans HAMBURGER_SECTIONS) : reprend
 * uniquement les écrans déjà atteignables aujourd'hui depuis la bottom bar
 * mobile (Accueil/Transactions/Projection/Calendrier) + les entrées listées
 * par la maquette Sidebar validée (Comptes/Budgets/Plans financiers/
 * Charges·Échéances). Aucune route inventée — toutes existent déjà dans
 * RootNavigator/RootTabs.
 */
export const WEB_SIDEBAR_PRIMARY: WebNavItem[] = [
  { label: 'Accueil', icon: 'home-outline', route: 'Accueil', parent: 'Tabs' },
  { label: 'Transactions', icon: 'swap-horizontal-outline', route: 'Transactions', parent: 'Tabs' },
  { label: 'Comptes', icon: 'card-outline', route: 'Accounts' },
  { label: 'Budgets', icon: 'pie-chart-outline', route: 'Budgets' },
  { label: 'Plans financiers', icon: 'folder-outline', route: 'FinancialPlans' },
  { label: 'Projection', icon: 'analytics-outline', route: 'Projection' },
  { label: 'Charges / Échéances', icon: 'receipt-outline', route: 'Charges' },
  { label: 'Calendrier', icon: 'calendar-outline', route: 'Calendrier', parent: 'Tabs' },
];
