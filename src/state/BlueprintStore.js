import { makeAutoObservable } from 'mobx'
import { building as defaultBuilding } from '../data/building.js'
import { parseBlueprint, blueprintSummary } from '../utils/blueprintParser.js'

/**
 * Стор импорта чертежей: принимает «сырой» чертёж (JSON), парсит его в контракт
 * Building и подменяет активное здание. Мок «Меридиан» остаётся запасным.
 *
 * См. specs/blueprint-import.md.
 */
export class BlueprintStore {
  /** @type {object | null} импортированное здание (в контракте Building) */
  importedBuilding = null

  /** @type {string | null} имя файла/источника импорта (для UI) */
  importedFrom = null

  /** @type {string | null} текст ошибки последнего импорта */
  lastError = null

  /** @type {string | null} резюме последнего успешного импорта */
  lastSummary = null

  /** @type {object | null} сырые данные последнего импорта (до нормализации) */
  rawData = null

  /** @type {boolean} показывать ли «некрасивый» исходный чертёж вместо красивого плана */
  showRaw = false

  /** @param {import('./RootStore.js').RootStore} root */
  constructor(root) {
    this.root = root
    makeAutoObservable(this)
  }

  // --- Computed ---

  /** Активное здание: импортированное или мок по умолчанию */
  get building() {
    return this.importedBuilding ?? defaultBuilding
  }

  /** Импортирован ли чертёж */
  get hasImported() {
    return this.importedBuilding !== null
  }

  // --- Actions ---

  /**
   * Импортировать чертёж из строки JSON.
   * @param {string} text — содержимое чертежа (JSON)
   * @param {string} [source] — имя источника ("файл", "вставка", "демо")
   * @returns {boolean} успех
   */
  importText(text, source = 'вставка') {
    this.lastError = null
    this.lastSummary = null
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      this.lastError = 'Не удалось разобрать JSON: проверьте синтаксис файла.'
      return false
    }
    try {
      const parsed = parseBlueprint(raw)
      this.importedBuilding = parsed
      this.rawData = raw
      this.importedFrom = source
      this.showRaw = false
      this.lastSummary = blueprintSummary(parsed)
      // Переключаемся на первый этаж импортированного здания
      this.root.ui.setActiveFloor(parsed.floors[0]?.id ?? 'f1')
      return true
    } catch (err) {
      this.lastError = err.message
      return false
    }
  }

  /**
   * Импортировать чертёж из файла (чтение через FileReader).
   * @param {File} file
   */
  importFile(file) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      this.importText(text, `файл «${file.name}»`)
    }
    reader.onerror = () => {
      this.lastError = 'Не удалось прочитать файл.'
    }
    reader.readAsText(file)
  }

  /** Сбросить импорт — вернуться к зданию по умолчанию («Меридиан») */
  clear() {
    this.importedBuilding = null
    this.importedFrom = null
    this.lastError = null
    this.lastSummary = null
    this.rawData = null
    this.showRaw = false
    this.root.ui.setActiveFloor('f1')
  }

  /** Переключить вид: «некрасивый» исходный чертёж ↔ красивый план */
  toggleRaw() {
    this.showRaw = !this.showRaw
  }
}
