# Jetshoes Fairy — The Flight Lab

A browser-playable, single-player physics prototype based on the Jetshoes Fairy brief. One articulated fairy, three gameplay inputs, a short floating course, and a live physics tuning panel. No backend, accounts, external assets, or runtime API credentials.

## v0.2 playtest: Flow + First Flight

The default is now **Flow**, with guided lean, capped target turn speed, braking when directions are released, and gentle upright recovery from ordinary flight poses. This replaces the original unbounded spin acceleration for the initial playtest. All assistance uses bounded forces and torque; contacts can still tip or tumble the body. Severe tumbles still require player input.

Air resistance keeps coast distances shorter, jet strength is gentler, fuel refills faster, and moderate landings no longer trigger such a severe loss of steering. Hard impacts loosen the legs while retaining 75% steering authority. The camera starts at 70% of its old scale so the fairy appears smaller and more of the course is visible; collision geometry stays the same.

**First Flight** is a shorter course with a nearer, wider first landing, a step, a seesaw, and a broad finish platform. Use the toolbar's course selector to return to the full Floating Garden. Flow, Classic, Training, and Chaos can be selected directly from the flight manual or the Tuning Lab. Select **Classic** and the full course to compare the original prototype.

Saved v0.1 tuning remains untouched under `jf-settings` and appears as **Your saved v0.1 tuning**. New tuning uses `jf-settings-v2`, and old JSON exports import with Classic steering/camera semantics. Completed times use separate records for each course and Flow/Classic mode. The first visit to v0.2 starts with Flow even when v0.1 tuning is saved.

## Run locally

Use Node.js 22.12+ (Node 24 works) and npm. From this checkout:

```sh
npm ci
npm run dev
```

Open the address Vite prints in your own browser. The development server uses port 5173. WebGL is required. Sound starts muted and can be enabled in the game toolbar. Keyboard on desktop is the primary playtest target; touch direction/thrust buttons are available on smaller screens and touch devices.

For a static production build:

```sh
npm run build
npm run preview
```

The `dist/` directory is the deployable artifact. No site has been deployed by this implementation. Preview uses port 4173. To host beneath a URL subdirectory, set Vite's `base` for that deployment.

## Try it on Netlify

In Netlify, choose **Add new project → Import an existing project**, connect GitHub, and select `has-he/jetshoesfairy` with branch `main`. The included `netlify.toml` sets Node 24, build command `npm run build`, and publish directory `dist`. No environment variables or API keys are required. Deploy the project and open the URL Netlify provides.

For manual hosting, build locally and upload the `dist/` folder to Netlify Drop.

## Controls

| Input | On supporting feet | In the air |
| --- | --- | --- |
| A / ← | Run left | Flow: lean left; Classic: rotate counterclockwise |
| D / → | Run right | Flow: lean right; Classic: rotate clockwise |
| Release direction | Slow and balance | Flow: brake rotation and settle; Classic: coast |
| Hold Space | Fire both shoe jets | Fire jets; deploy wings when fuel is exhausted |
| Release Space | Refill fuel on suitable foot contact | Freefall |
| R | Reset the entire attempt and moving obstacles | Same |
| P / Escape | Pause / resume | Same |
| G | Toggle collision bodies, joint anchors, contacts, and velocity | Same |

Wings apply gradual drag rather than cancelling velocity. Once exhaustion deploys the wings, that mode stays latched until Space is released. Refilling while still holding Space therefore cannot rapidly alternate between jets and wings. Airborne, wall-only, and head-only contacts do not refill fuel. Keyboard gameplay input is suspended while editing form controls; click the play area to return to flight.

The goal is to reach the flag **and land** on the final platform. A bad impact weakens the character's control temporarily; it does not automatically end the attempt. Falling out of the course displays retry. The timer starts with the first gameplay input and best completed time is saved locally in this browser.

## Physics architecture

- `src/game/physics.ts`: renderer-independent Planck simulation. Metres, seconds, kilograms; Y points up; gravity is 18 m/s² downward. Physics runs at a fixed 120 Hz, with 10 velocity and 5 position iterations.
- Eight dynamic, continuous-collision bodies: torso, head, two thighs, two shins, and two feet. Seven limited revolute joints use bounded proportional/derivative motors. Character self-collision is disabled; feet and limbs collide with the course.
- Ground running combines a motor-driven gait, bounded horizontal traction, torso balance torque, and a contact-gated virtual leg-extension spring. A 70 ms support grace avoids changing running controls during tiny contact interruptions. Fuel regeneration always requires actual foot support.
- Both shoes receive thrust forces along the torso's local up axis. A bounded torque stabilizer cancels shoe/centre-of-mass misalignment. The balance setting controls this assistance as well as ground support. It never resets body angle or velocity.
- Flow maps direction to a target lean, then a limited target angular rate, then a bounded inertia-aware torque controller. Release brakes spin and gently rights poses within 90 degrees of upright. Classic retains direct input torque and angular inertia. Wings apply velocity-dependent forces to each body; separate air damping controls unpowered coasting without slowing supported running.
- Impacts use relative normal contact speed and temporarily weaken joints. Flow keeps steering available during recovery and has a higher impact threshold; Classic retains the original 16% control during stun. Clean-landing feedback waits for stable foot support and low vertical speed, rather than firing on first contact. Running and flight do not teleport or set character velocity.
- These explicit assists make this an **active ragdoll**, rather than a passive human-body simulation. Reducing balance or joint strength exposes more instability; the Chaos preset demonstrates that tradeoff.
- The seesaw is a real dynamic body on a limited revolute joint with weak bearing resistance. Reset recreates the world, fairy, joints, platform, fuel, and timer; it retains tuning settings.
- `src/game/renderer.ts`: PixiJS presentation, procedural scenery, camera, cosmetic wings/arms, and exhaust particles. Cosmetic randomness never feeds back into physics.
- `src/game/settings.ts`: Flow/Classic presets, input ranges, validation, and compatibility with v0.1 tuning exports.
- `src/main.ts`: fixed-step accumulator, keyboard and pointer input, pause/visibility handling, HUD, course selection, versioned local persistence, preset import/export, and optional synthesized feedback.

The Tuning Lab exposes guided/free steering, turn speed, turn braking, lean angle, camera scale, air resistance, thrust, rotation torque, fuel capacity and refill rate, wing resistance, balance, joint strength, mass, damping, friction, and impact tolerance. Inertia follows the body shapes and fixture densities. Changes apply live; switching presets, steering modes, or courses starts a fresh attempt. Presets can be exported/imported as JSON. Import validates finite numbers and supported ranges.

## Validation

```sh
npm test           # Physics tests
npm run build     # Strict TypeScript check and static production build
npm run test:browser
```

Browser validation builds the production app, then uses `playwright-core` and an installed Chromium. It starts and closes its own Vite servers on 5174 (development) and 4174 (production). Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. It exercises real keyboard/touch input, launch, rotation, pause, retry, settings persistence, preset validation/export, desktop/mobile layout, and browser errors. It also checks that the production bundle runs physics and excludes development instrumentation. Screenshots and the exported preset are written under ignored `test-results/`. The test-only `window.__FAIRY__` instrumentation is exposed only by Vite's development build.

Physics tests cover standing, running, launching from a gait, directional thrust, torque, finite fuel, intentional wing braking, refill eligibility, impact continuity, seesaw reactions, settings changes, finish/fall/reset, and repeated fixed-step input sequences. Flow regressions verify bounded lean under held input, braking after release, steering during impact recovery, first-gap landings over several burst lengths, and completing the short course with normal gameplay inputs. Settings tests and browser checks verify legacy tuning is preserved and remains selectable. Repeatability is verified within this engine/runtime; bit-identical cross-browser or network determinism is not promised.

## Next playtest

Start with Flow and First Flight. Judge one short burst and landing before the full race: is it understandable, satisfying, and repeatable? Then watch people cross the course, recover from tilted landings, and influence the seesaw. Record whether they can explain failures, reproduce a success, improve over several attempts, and voluntarily retry. Compare Flow and Classic on the same course. Automated completion establishes playability; it does not establish that either version is fun.

Current limitations: gait and recovery still need human tuning; arms and wings are cosmetic; impacts temporarily weaken control rather than simulating injuries; no multiplayer, mobile usability study, or cross-browser compatibility sweep has been performed. Large-scale shared physics needs a separate server-authority and latency feasibility phase. There are no leaderboards, accounts, gore, progression, or production networking systems.
