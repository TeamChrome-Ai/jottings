import { describe, it, expect } from 'vitest'
import { AUTHORED_TEMPO, HOUSE_TEMPO, SLOW_TEMPO, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, TURN_TEMPO, clampSpeed, motionSpeed, scaleMs, scaleSpringConfig, scaleSpringParams, scaleTimingConfig, setMotionSpeed, tempoSpeed, userSpeed } from '../client/src/lib/motionSpeed'
import { dampingRatio, fromOrigami, springPeak, springSettleMs } from '../client/src/lib/springs'
import { WOBBLE_SPRING } from '../client/src/lib/springs'
import { RISE_SPRING } from '../client/src/lib/motion'

describe('animation speed', () => {
  it('stays between 0.5x and 1.5x, 1x by default and for anything unreadable', () => {
    expect([SPEED_MIN, SPEED_DEFAULT, SPEED_MAX]).toEqual([0.5, 1, 1.5])
    expect(clampSpeed(3)).toBe(1.5)
    expect(clampSpeed(0.1)).toBe(0.5)
    expect(clampSpeed('fast')).toBe(1)
    expect(clampSpeed(NaN)).toBe(1)
    expect(clampSpeed(1.2345)).toBe(1.23)
  })
  it('scales durations and delays inversely', () => {
    expect(scaleMs(300, 1.5)).toBe(200)
    expect(scaleMs(300, 0.5)).toBe(600)
    expect(scaleTimingConfig({ toValue: 1, duration: 220, delay: 60 }, 2)).toEqual({ toValue: 1, duration: 110, delay: 30 })
    // Animated's own default duration is 500 ms
    expect(scaleTimingConfig({ toValue: 1 }, 0.5)).toEqual({ toValue: 1, duration: 1000 })
  })
  it('plays a spring faster or slower without changing its shape', () => {
    for (const cfg of [WOBBLE_SPRING, RISE_SPRING]) for (const s of [0.5, 0.8, 1.25, 1.5]) {
      const p = scaleSpringParams(cfg, s)
      expect(dampingRatio(p)).toBeCloseTo(dampingRatio(cfg), 6)
      expect(springPeak(p)).toBeCloseTo(springPeak(cfg), 6)
      expect(springSettleMs(p)).toBeCloseTo(springSettleMs(cfg) / s, -1)
    }
  })
  it('reads friction / tension and the default spring too, and carries delay and velocity', () => {
    const f = scaleSpringConfig({ toValue: 1, friction: 7, tension: 40, delay: 100, velocity: 2 }, 2)
    const base = fromOrigami(7, 40)
    expect(f).toEqual({ toValue: 1, stiffness: base.stiffness * 4, damping: base.damping * 2, mass: 1, delay: 50, velocity: 4 })
    expect(scaleSpringConfig({ toValue: 1 }, 2)).toEqual({ toValue: 1, ...scaleSpringParams(fromOrigami(7, 40), 2) })
  })
  it('leaves configs alone at speed 1, and the setting clamps what it is given', () => {
    const cfg = { toValue: 1, stiffness: 500, damping: 30 }
    expect(scaleSpringConfig(cfg, 1)).toBe(cfg)
    setMotionSpeed(9)
    expect(userSpeed()).toBe(1.5)
    expect(motionSpeed()).toBeCloseTo(1.5 * HOUSE_TEMPO)
    setMotionSpeed(1)
    expect(userSpeed()).toBe(1)
  })
  it('plays the app at the house tempo: 1x is 0.7 of the written numbers, the turns, ring and tab fade at half, the tour as written', () => {
    setMotionSpeed(1)
    expect(HOUSE_TEMPO).toBe(0.7)
    expect(motionSpeed()).toBeCloseTo(0.7)
    expect(scaleMs(210)).toBeCloseTo(300)
    expect([TURN_TEMPO, SLOW_TEMPO, AUTHORED_TEMPO]).toEqual([0.5, 0.5, 1])
    expect(tempoSpeed(TURN_TEMPO)).toBe(0.5)
    setMotionSpeed(1.5)
    // the slider stays relative to each tempo
    expect(tempoSpeed(TURN_TEMPO)).toBe(0.75)
    expect(motionSpeed()).toBeCloseTo(1.05)
    setMotionSpeed(1)
  })
})
