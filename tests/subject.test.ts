import { describe, it, expect } from 'vitest'
import { buildIndex, type CbdIndexRow } from '../shared/cbd'
import { MINISTRY_LIMIT, SUBJECT_ARTICLES, isSubject, paperCount, subjectArticles } from '../client/src/lib/subject'

const row = (id: string, headword: string, aliases: string[] = []): CbdIndexRow => [id, headword, aliases, [], [], '', 0, []]
const index = buildIndex([row('grace', 'Grace'), row('grace-throne-of', 'Grace, Throne of'), row('gracious', 'Gracious'), row('mercy', 'Mercy', ['Lovingkindness']), ...Array.from({ length: 12 }, (_, i) => row(`faith-${i}`, `Faith ${i}`))])

describe('what else there is on a subject', () => {
  it('takes words as a subject, not a Strong\'s number or a scrap', () => {
    expect(['grace', 'the Spirit', '"loving-kindness"'].map(isSubject)).toEqual([true, true, true])
    expect(['G1320', 'h430', 'ab', '  ', '3:16', '"a"'].map(isSubject)).toEqual([false, false, false, false, false, false])
  })
  it('offers the dictionary\'s articles on it, a row\'s worth, and says when there are more', () => {
    expect(subjectArticles(index, 'grace')).toEqual({ rows: [index.rows[0], index.rows[1]], more: false })
    expect(subjectArticles(index, 'grac').rows.map(r => r[0])).toEqual(['grace', 'grace-throne-of', 'gracious'])
    expect(subjectArticles(index, '"Lovingkindness"').rows.map(r => r[0])).toEqual(['mercy'])
    const many = subjectArticles(index, 'faith')
    expect([many.rows.length, many.more]).toEqual([SUBJECT_ARTICLES, true])
    expect([subjectArticles(null, 'grace'), subjectArticles(index, 'G5485'), subjectArticles(index, 'zzzz')]).toEqual([{ rows: [], more: false }, { rows: [], more: false }, { rows: [], more: false }])
  })
  it('counts the ministry honestly at the server\'s limit', () => {
    expect([paperCount(1), paperCount(12), paperCount(MINISTRY_LIMIT)]).toEqual(['1 paper', '12 papers', '30 or more papers'])
  })
})
