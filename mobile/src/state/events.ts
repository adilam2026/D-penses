type Listener<T> = (payload: T) => void;

/**
 * Bus d'événements minimal en mémoire — permet à un écran de création
 * "rapide" (ex. QuickCreateAccountScreen) de prévenir l'écran appelant
 * qu'un prérequis vient d'être créé, sans dépendre du graphe de navigation.
 */
class EventBus<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: T): void {
    for (const listener of this.listeners) listener(payload);
  }
}

export interface AccountCreatedEvent {
  id: string;
  name: string;
  type: string;
}

export const accountCreatedBus = new EventBus<AccountCreatedEvent>();
