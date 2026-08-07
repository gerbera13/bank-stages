import { building } from '../data/building.js'
import { BlueprintStore } from './BlueprintStore.js'
import { UiStore } from './UiStore.js'
import { SelectionStore } from './SelectionStore.js'

/**
 * Корневой стор: собирает подсторы и хранит статичные данные здания.
 * См. specs/state-stores.md.
 */
export class RootStore {
  constructor() {
    // Мок-здание «Меридиан» (см. ADR-008); подменяется импортом чертежа
    this.defaultBuilding = building
    this.blueprint = new BlueprintStore(this)
    this.ui = new UiStore(this)
    this.selection = new SelectionStore(this)
  }

  /** Активное здание: импортированный чертёж или мок */
  get building() {
    return this.blueprint.building
  }
}
