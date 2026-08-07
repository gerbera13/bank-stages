import { makeAutoObservable } from 'mobx'

/** Все типы объектов видимы по умолчанию */
const ALL_TYPES = ['elevator', 'camera', 'atm', 'stairs']

/**
 * UI-состояние: активный этаж и видимость типов объектов.
 * См. specs/state-stores.md.
 */
export class UiStore {
  /** @type {string} */
  activeFloorId = 'f1'
  /** @type {Set<string>} */
  visibleTypes = new Set(ALL_TYPES)

  /** @param {import('./RootStore.js').RootStore} root */
  constructor(root) {
    this.root = root
    makeAutoObservable(this)
  }

  // --- Computed ---

  /** Активный этаж (объект) или undefined */
  get activeFloor() {
    return this.root.building.floors.find((f) => f.id === this.activeFloorId)
  }

  /** Все этажи */
  get floors() {
    return this.root.building.floors
  }
  // --- Actions ---

  /** Сменить активный этаж (сбрасывает выбор объекта) */
  setActiveFloor(id) {
    this.activeFloorId = id
    this.root.selection.clear()
  }

  /** Переключить видимость типа объекта */
  toggleType(type) {
    if (this.visibleTypes.has(type)) this.visibleTypes.delete(type)
    else this.visibleTypes.add(type)
  }

  /** Виден ли тип объекта */
  isTypeVisible(type) {
    return this.visibleTypes.has(type)
  }
}
