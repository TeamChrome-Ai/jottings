import { afterEach, describe, expect, it } from 'vitest'
import { carCatalogue, carFind, carSearch, catalogueKey, chapterId, continueItem, placeOf } from '../client/src/lib/carCatalogue'
import { setNamesLang } from '../shared/books'
import { setLang } from '../shared/i18n'
import { BRAND } from '../shared/brand'

afterEach(() => { setLang('en', {}); setNamesLang('en') })

describe('the tree a car browses', () => {
  it('has two roots, Continue listening and Bible, and the Bible its two testaments', () => {
    const { nodes } = carCatalogue()
    expect(nodes.root.c).toEqual(['continue', 'bible'])
    expect(nodes.continue).toMatchObject({ t: 'Continue listening', i: 'continue', c: ['@place'] })
    expect(nodes.bible).toMatchObject({ t: 'Bible', i: 'bible', c: ['ot', 'nt'] })
    expect(nodes.ot.t).toBe('Old Testament')
    expect(nodes.nt.t).toBe('New Testament')
  })

  it('lists the 66 books in order, 39 and 27', () => {
    const { nodes } = carCatalogue()
    expect(nodes.ot.c).toHaveLength(39)
    expect(nodes.nt.c).toHaveLength(27)
    expect(nodes.ot.c![0]).toBe('b/1')
    expect(nodes.nt.c![0]).toBe('b/40')
    expect(nodes.nt.c![26]).toBe('b/66')
    expect(nodes['b/1'].t).toBe('Genesis')
    expect(nodes['b/43'].t).toBe('John')
  })

  it('lists every chapter of a book, each one played', () => {
    const { nodes } = carCatalogue()
    expect(nodes['b/43'].c).toHaveLength(21)
    expect(nodes['b/43'].c![2]).toBe('c/43/3')
    expect(nodes['c/43/3']).toEqual({ t: 'John 3' })
    expect(nodes['b/19'].c).toHaveLength(150)
    expect(nodes['b/65'].c).toEqual(['c/65/1'])
    expect(Object.keys(nodes).filter(id => id.startsWith('c/'))).toHaveLength(1189)
  })

  it('names no entry that is not there, and browses exactly the ones with entries under them', () => {
    const { nodes } = carCatalogue()
    for (const [id, n] of Object.entries(nodes)) {
      for (const child of n.c ?? []) if (child !== '@place') expect(nodes[child], `${id} lists ${child}`).toBeDefined()
      expect(n.c === undefined, id).toBe(id.startsWith('c/'))
    }
  })

  it('is written in the app\'s language, and says so in its key', () => {
    const english = catalogueKey()
    setLang('fr', { 'Continue listening': 'Reprendre l’écoute', 'Old Testament': 'Ancien Testament' })
    setNamesLang('fr')
    const { key, nodes } = carCatalogue()
    expect(nodes.continue.t).toBe('Reprendre l’écoute')
    expect(nodes.ot.t).toBe('Ancien Testament')
    expect(nodes['b/43'].t).toBe('Jean')
    expect(nodes['c/43/3'].t).toBe('Jean 3')
    expect(key).not.toBe(english)
    expect(key).toBe(catalogueKey())
  })
})

describe('what a driver asks for by voice', () => {
  it('finds the chapter named', () => {
    expect(carSearch('John 3')).toEqual({ book: 43, chapter: 3, verse: 1 })
    expect(carSearch('first John 2')).toEqual({ book: 62, chapter: 2, verse: 1 })
    expect(carSearch('Psalm 23')).toEqual({ book: 19, chapter: 23, verse: 1 })
    expect(carSearch('third John')).toEqual({ book: 64, chapter: 1, verse: 1 })
  })

  it('hears through the words around a reference', () => {
    expect(carSearch('play John chapter 3')).toEqual({ book: 43, chapter: 3, verse: 1 })
    expect(carSearch('the gospel of John chapter 3 verse 16')).toEqual({ book: 43, chapter: 3, verse: 16 })
    expect(carSearch(`Psalm 23 on ${BRAND.name}`)).toEqual({ book: 19, chapter: 23, verse: 1 })
    expect(carSearch('Romans')).toEqual({ book: 45, chapter: 1, verse: 1 })
    expect(carSearch('Jhon 3')).toEqual({ book: 43, chapter: 3, verse: 1 })
  })

  it('finds nothing in words that name no book, or a chapter the book has not', () => {
    expect(carSearch('the weather tomorrow')).toBeNull()
    expect(carSearch('some music')).toBeNull()
    expect(carSearch('')).toBeNull()
    expect(carSearch('John 99')).toBeNull()
  })

  it('lists what a search names: the chapter, or the chapters of a book', () => {
    expect(carFind('John 3')).toEqual([{ id: 'c/43/3', t: 'John 3' }])
    expect(carFind('Ruth').map(x => x.id)).toEqual(['c/8/1', 'c/8/2', 'c/8/3', 'c/8/4'])
    expect(carFind('the weather tomorrow')).toEqual([])
  })
})

describe('the place to continue from', () => {
  it('is the chapter, from its verse', () => {
    expect(continueItem({ book: 43, chapter: 3, verse: 16 })).toEqual({ id: 'c/43/3/16', t: 'John 3', s: 'From verse 16' })
    expect(continueItem({ book: 43, chapter: 3, verse: 1 })).toEqual({ id: 'c/43/3', t: 'John 3' })
  })

  it('is read back from an id, and only from one that names a chapter', () => {
    expect(placeOf(chapterId(43, 3, 16))).toEqual({ book: 43, chapter: 3, verse: 16 })
    expect(placeOf('c/43/3')).toEqual({ book: 43, chapter: 3, verse: 1 })
    expect(placeOf('b/43')).toBeNull()
    expect(placeOf('c/43/99')).toBeNull()
    expect(placeOf('c/67/1')).toBeNull()
    expect(placeOf('c/43/x')).toBeNull()
  })
})
