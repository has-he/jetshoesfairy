import { describe, expect, it } from 'vitest';
import { Vec2 } from 'planck';
import { DEFAULTS, NO_INPUT, Simulation, STEP } from '../src/game/physics';
import type { Input } from '../src/game/physics';

function advance(sim: Simulation, seconds: number, input: Input = NO_INPUT) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.step(input);
}
function place(sim: Simulation, x: number, y: number, angle = 0, vx = 0, vy = 0) {
  const origin = sim.torso.getPosition().clone();
  for (const { body } of sim.parts) {
    const p = body.getPosition();
    const dx = p.x - origin.x, dy = p.y - origin.y;
    body.setTransform(Vec2(x + dx * Math.cos(angle) - dy * Math.sin(angle), y + dx * Math.sin(angle) + dy * Math.cos(angle)), body.getAngle() + angle);
    body.setLinearVelocity(Vec2(vx, vy)); body.setAngularVelocity(0);
  }
  sim.grounded = false;
}
const thrust = { ...NO_INPUT, action: true };

describe('the physical fairy', () => {
  it('has eight independently simulated bodies joined into one articulated character', () => {
    const sim = new Simulation();
    expect(sim.parts).toHaveLength(8);
    expect(sim.joints).toHaveLength(7);
    expect(sim.parts.every(p => p.body.isDynamic())).toBe(true);
  });

  it('stands on supporting feet without input and keeps the timer stopped', () => {
    const sim = new Simulation(); advance(sim, 3);
    const s = sim.snapshot();
    expect(s.grounded).toBe(true);
    expect(s.y).toBeGreaterThan(1);
    expect(Math.abs(s.angle)).toBeLessThan(0.3);
    expect(s.state).toBe('ready'); expect(s.elapsed).toBe(0);
  });

  it('runs across the runway using the same rig and actual foot contacts', () => {
    const sim = new Simulation(); advance(sim, 0.4);
    advance(sim, 1, { ...NO_INPUT, right: true });
    expect(sim.snapshot().x).toBeGreaterThan(4);
    expect(sim.snapshot().y).toBeGreaterThan(0.9);
    expect(Math.abs(sim.snapshot().angle)).toBeLessThan(0.55);
    expect(sim.state).toBe('running');
    expect(sim.elapsed).toBeCloseTo(1, 3);
  });

  it('can launch from a moving gait without automatically faceplanting', () => {
    const sim = new Simulation(); advance(sim, 0.5);
    advance(sim, 0.45, { ...NO_INPUT, right: true });
    advance(sim, 0.45, thrust);
    expect(sim.snapshot().y).toBeGreaterThan(1.5);
    expect(sim.snapshot().fuel).toBeLessThan(0.9);
  });

  it('lifts under thrust and consumes a finite fuel reserve', () => {
    const sim = new Simulation(); place(sim, 2, 5);
    advance(sim, 0.4, thrust);
    expect(sim.snapshot().vy).toBeGreaterThan(1);
    expect(sim.fuel).toBeCloseTo(DEFAULTS.fuelCapacity - 0.4, 3);
  });

  it('directs shoe thrust along the body orientation', () => {
    const sim = new Simulation(); place(sim, 2, 8, Math.PI / 2);
    advance(sim, 0.25, thrust);
    expect(sim.snapshot().vx).toBeLessThan(-3);
    expect(sim.snapshot().vy).toBeLessThan(-1);
  });

  it('uses right for clockwise air rotation and left for counterclockwise rotation', () => {
    const right = new Simulation(), left = new Simulation();
    place(right, 2, 10); place(left, 2, 10);
    advance(right, 0.2, { ...NO_INPUT, right: true });
    advance(left, 0.2, { ...NO_INPUT, left: true });
    expect(right.snapshot().angle).toBeLessThan(-0.05);
    expect(left.snapshot().angle).toBeGreaterThan(0.05);
  });

  it('opens wings on held-input exhaustion, and requires intentional input for braking', () => {
    const sim = new Simulation(); place(sim, 2, 12); sim.fuel = 0.01;
    advance(sim, 0.03, thrust);
    expect(sim.wings).toBe(true); expect(sim.jets).toBe(false);
    sim.step(NO_INPUT); expect(sim.wings).toBe(false);
  });

  it('brakes falling gradually rather than cancelling velocity', () => {
    const wings = new Simulation(), free = new Simulation();
    place(wings, 2, 30, 0, 0, -12); place(free, 2, 30, 0, 0, -12);
    wings.fuel = 0; free.fuel = 0;
    wings.step(thrust);
    expect(wings.snapshot().vy).toBeLessThan(-10);
    advance(wings, 0.4, thrust); advance(free, 0.4);
    expect(wings.snapshot().vy).toBeGreaterThan(free.snapshot().vy + 6);
    expect(wings.snapshot().vy).toBeLessThan(-2);
  });

  it('refills on supporting feet, and keeps wings latched until release', () => {
    const sim = new Simulation(); advance(sim, 0.4); sim.fuel = 0;
    advance(sim, 0.25, thrust);
    expect(sim.fuel).toBeGreaterThan(0.1);
    expect(sim.wings).toBe(true); expect(sim.jets).toBe(false);
    sim.step(); sim.step(thrust);
    expect(sim.jets).toBe(true);
  });

  it('does not refill while airborne or just resting on the head', () => {
    const air = new Simulation(); place(air, 2, 10); air.fuel = 0; advance(air, 0.3);
    expect(air.fuel).toBe(0);
    const head = new Simulation(); place(head, 3, 0.84, Math.PI); head.fuel = 0;
    advance(head, 0.12);
    expect(head.grounded).toBe(false); expect(head.fuel).toBe(0);
  });

  it('lets the fairy physically tip the pivoting platform', () => {
    const sim = new Simulation(); place(sim, 27, 1.55);
    let rotation = 0;
    for (let i = 0; i < 120; i++) { sim.step(); rotation = Math.max(rotation, Math.abs(sim.pivot.getAngle())); }
    expect(rotation).toBeGreaterThan(0.05);
  });

  it('produces asymmetric foot contact and rotation on a ledge catch', () => {
    const sim = new Simulation(); place(sim, 9.3, 1.8, -0.35, 0.4, -1);
    let singleFoot = false, rotated = false;
    for (let i = 0; i < 120; i++) {
      sim.step();
      const feet = new Set();
      for (let c = sim.world.getContactList(); c; c = c.getNext()) {
        if (!c.isTouching()) continue;
        for (const fixture of [c.getFixtureA(), c.getFixtureB()]) {
          const data = fixture.getBody().getUserData() as { name?: string };
          if (data?.name?.startsWith('foot')) feet.add(data.name);
        }
      }
      singleFoot ||= feet.size === 1;
      rotated ||= Math.abs(sim.torso.getAngularVelocity()) > 0.5;
    }
    expect(singleFoot).toBe(true); expect(rotated).toBe(true);
  });

  it('can physically recover from a moderately tilted landing', () => {
    const sim = new Simulation(); place(sim, 4, 1.5, -0.4);
    advance(sim, 3);
    expect(sim.grounded).toBe(true);
    expect(sim.snapshot().y).toBeGreaterThan(1);
    expect(Math.abs(sim.snapshot().angle)).toBeLessThan(0.25);
  });

  it('detects a heavy impact and keeps the jointed body physically continuous', () => {
    const sim = new Simulation(); place(sim, 4, 3, 0, 0, -22);
    let stunned = false;
    for (let i = 0; i < 70; i++) {
      sim.step(); stunned ||= sim.stun > 0;
      for (const { joint } of sim.joints) {
        const a = joint.getAnchorA(), b = joint.getAnchorB();
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.2);
      }
    }
    expect(stunned).toBe(true);
    expect(Number.isFinite(sim.snapshot().y)).toBe(true);
  });

  it('updates fixture mass and materials without rebuilding or teleporting the character', () => {
    const sim = new Simulation(); const mass = sim.totalMass; const p = sim.snapshot();
    sim.updateSettings({ mass: 1.5, friction: 0.4, fuelCapacity: 3 });
    expect(sim.totalMass).toBeCloseTo(mass * 1.5, 5);
    expect(sim.fuel).toBeCloseTo(3, 5);
    expect(sim.snapshot().x).toBe(p.x); expect(sim.snapshot().y).toBe(p.y);
    expect(sim.parts[0].body.getFixtureList()!.getFriction()).toBe(0.4);
  });

  it('finishes only after reaching the flag with supporting foot contact', () => {
    const sim = new Simulation(); sim.state = 'running'; place(sim, 46.5, 4);
    sim.step(); expect(sim.state).toBe('running');
    advance(sim, 1.5);
    expect(sim.state).toBe('finished');
    expect(sim.snapshot().progress).toBe(1);
  });

  it('ends a fallen attempt and resets fuel, timer, character, and dynamic obstacles', () => {
    const sim = new Simulation(); sim.pivot.setTransform(sim.pivot.getPosition(), 0.3);
    place(sim, 11, -9); sim.step(thrust); expect(sim.state).toBe('fallen');
    sim.updateSettings({ thrust: 36 }); sim.reset();
    expect(sim.pivot.getAngle()).toBe(0); expect(sim.state).toBe('ready');
    expect(sim.elapsed).toBe(0); expect(sim.fuel).toBe(sim.settings.fuelCapacity);
    expect(sim.settings.thrust).toBe(36); expect(sim.snapshot().x).toBeCloseTo(2.1);
  });

  it('repeats a fixed-step input sequence consistently within this engine/runtime', () => {
    const run = () => {
      const sim = new Simulation(); advance(sim, 0.4);
      advance(sim, 0.35, { ...NO_INPUT, right: true }); advance(sim, 0.25, thrust);
      advance(sim, 0.2, { ...thrust, right: true }); advance(sim, 0.3);
      return sim.snapshot();
    };
    expect(run()).toEqual(run());
  });
});
