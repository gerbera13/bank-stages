import { makeAutoObservable } from 'mobx'

/**
 * Состояние выбора объекта на плане.
 * См. specs/state-stores.md.
 */
export class SelectionStore {
  /** @type {string | null} */
  selectedObjectId = null

  /** @param {import('./RootStore.js').RootStore} root */
  constructor(root) {
    this.root = root
    makeAutoObservable(this)
  }

  // --- Computed ---

  /** Выбранный объект на активном этаже или null */
  get selectedObject() {
    const floor = this.root.ui.activeFloor
    if (!floor || !this.selectedObjectId) return null
    return floor.objects.find((o) => o.id === this.selectedObjectId) ?? null
  }

  // --- Actions ---

  /** Выбрать объект по id */
  select(id) {
    this.selectedObjectId = id
  }

  /** Снять выбор */
  clear() {
    this.selectedObjectId = null
  }

  /** Выбран ли объект с этим id */
  isSelected(id) {
    return this.selectedObjectId === id
  }
}
