// Stockage sécurisé simulé en mémoire pour Jest (aucun Keystore en test).
const store = new Map();

module.exports = {
  __esModule: true,
  getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key) => {
    store.delete(key);
  }),
  __store: store,
};
