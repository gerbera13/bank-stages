import { building } from '../data/building.js'
import { UiStore } from './UiStore.js'
import { SelectionStore } from './SelectionStore.js'

/**
 * Корневой стор: собирает подсторы и хранит статичные данные здания.
 * См. specs/state-stores.md.
 */
export class RootStore {
  constructor() {
    // building — константа (мок), observable не нужен
    this.building = building
    this.ui = new UiStore(this)
    this.selection = new SelectionStore(this)
  }
}
