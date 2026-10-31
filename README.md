# Jetshoes Fairy — The Flight Lab

A browser-playable, single-player physics prototype based on the Jetshoes Fairy brief. One articulated fairy, three gameplay inputs, a short floating course, and a live physics tuning panel. No backend, accounts, external assets, or runtime API credentials.

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
| A / ← | Run left | Rotate counterclockwise |
| D / → | Run right | Rotate clockwise |
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
- Both shoes receive thrust forces along the torso's local up axis. A bounded torque stabilizer cancels most shoe/centre-of-mass misalignment. The balance setting controls this assistance as well as ground support. It does not reset body angle, remove momentum, or align the fairy automatically in open air.
- Input torque controls rotation while airborne. Wings apply velocity-dependent forces to each body. Impacts use relative normal contact speed and weaken joint motors and control for a short, bounded recovery period. Running and flight do not teleport or set character velocity.
- These explicit assists make this an **active ragdoll**, rather than a passive human-body simulation. Reducing balance or joint strength exposes more instability; the Chaos preset demonstrates that tradeoff.
- The seesaw is a real dynamic body on a limited revolute joint with weak bearing resistance. Reset recreates the world, fairy, joints, platform, fuel, and timer; it retains tuning settings.
- `src/game/renderer.ts`: PixiJS presentation, procedural scenery, camera, cosmetic wings/arms, and exhaust particles. Cosmetic randomness never feeds back into physics.
- `src/main.ts`: fixed-step accumulator, keyboard and pointer input, pause/visibility handling, HUD, local persistence, preset import/export, and optional synthesized feedback.

The Tuning Lab exposes thrust, rotation torque, fuel capacity and refill rate, wing resistance, balance, joint strength, mass, damping, friction, and impact tolerance. Inertia follows the body shapes and fixture densities. Changes apply live; Retry is useful for comparing identical starting conditions. Presets can be exported/imported as JSON. Import validates finite numbers and supported ranges.

## Validation

```sh
npm test           # Physics tests
npm run build     # Strict TypeScript check and static production build
npm run test:browser
```

Browser validation builds the production app, then uses `playwright-core` and an installed Chromium. It starts and closes its own Vite servers on 5174 (development) and 4174 (production). Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. It exercises real keyboard/touch input, launch, rotation, pause, retry, settings persistence, preset validation/export, desktop/mobile layout, and browser errors. It also checks that the production bundle runs physics and excludes development instrumentation. Screenshots and the exported preset are written under ignored `test-results/`. The test-only `window.__FAIRY__` instrumentation is exposed only by Vite's development build.

Physics tests cover standing, running, launching from a gait, directional thrust, torque, finite fuel, intentional wing braking, refill eligibility, impact continuity, seesaw reactions, settings changes, finish/fall/reset, and repeated fixed-step input sequences. Repeatability is verified within this engine/runtime; bit-identical cross-browser or network determinism is not promised.

## Next playtest

Treat the current settings as a starting hypothesis. Watch people try a small burst, cross the first gap, recover from a tilted landing, and influence the seesaw. Record whether they can explain failures, reproduce a success, improve over several attempts, and voluntarily retry. Compare Original Fairy and Training Wings before adding content.

Current limitations: gait and recovery still need human tuning; arms and wings are cosmetic; impacts temporarily weaken control rather than simulating injuries; no multiplayer, mobile usability study, or cross-browser compatibility sweep has been performed. Large-scale shared physics needs a separate server-authority and latency feasibility phase. There are no leaderboards, accounts, gore, progression, or production networking systems.
