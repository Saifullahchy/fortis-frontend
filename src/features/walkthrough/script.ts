import type { StepContext, TourChapter } from './types'

/** The demo vehicle every chapter flies. The fixture gives it an uploaded survey plan. */
export const DEMO_VEHICLE = 'UAV-001'

const stageOf = (ctx: StepContext) => ctx.sim(DEMO_VEHICLE).getState().stage
const flying = (ctx: StepContext) => stageOf(ctx) === 'active' || stageOf(ctx) === 'holding'

/** Press a real control for the visitor, once it is enabled. */
const press = async (ctx: StepContext, selector: string) => {
  const el = await ctx.waitFor(`${selector}:not([disabled])`, 15_000)
  if (el) (el as HTMLElement).click()
}

const explore: TourChapter = {
  id: 'interface',
  title: 'Explore the Interface',
  blurb: 'One screen for every vehicle. Here is how it is laid out.',
  minutes: 1,
  steps: [
    {
      id: 'interface-rail',
      route: '/',
      target: '[data-tour="sidebar"]',
      placement: 'right',
      title: 'Menu',
      text: 'The menu is on the left. Fleet shows your vehicles. Missions shows all missions.',
    },
    {
      id: 'interface-stats',
      target: '[data-tour="fleet-stats"]',
      placement: 'bottom',
      title: 'Fleet status',
      text: 'This line shows how many vehicles are online, offline, or need attention.',
    },
    {
      id: 'interface-card',
      target: '[data-tour="fleet-card-UAV-001"]',
      placement: 'right',
      title: 'Vehicle card',
      text: 'Each card is one vehicle. It shows the type, the link, the battery and the current mission.',
    },
    {
      id: 'interface-live',
      target: '[data-tour="live-badge"]',
      placement: 'bottom',
      title: 'Simulation',
      text: 'Everything in this demo runs in simulation. No real hardware is connected.',
    },
    {
      id: 'interface-board',
      route: '/missions',
      target: '[data-tour="mission-board"]',
      placement: 'top',
      title: 'Mission board',
      text: 'The mission board lists every mission and its live status. From here you can plan a mission or watch it live.',
    },
  ],
}

const fleet: TourChapter = {
  id: 'fleet',
  title: 'Build the Fleet',
  blurb: 'Add air, ground, surface and underwater vehicles in one place.',
  minutes: 1,
  steps: [
    {
      id: 'fleet-add',
      route: '/',
      target: '[data-tour="fleet-add"]',
      placement: 'left',
      title: 'Add a vehicle',
      text: 'New vehicles are added with this button.',
    },
    {
      id: 'fleet-wizard-types',
      target: '.fleet-modal .fleet-add-types',
      placement: 'bottom',
      before: ctx => ctx.click('[data-tour="fleet-add"]'),
      settle: 300,
      title: 'Choose a type',
      text: 'Pick a drone, a rover, a boat or a submarine. The screens and commands change to match.',
    },
    {
      id: 'fleet-wizard-steps',
      target: '.fleet-modal .wz-steps',
      placement: 'bottom',
      title: 'Four short steps',
      text: 'Then choose the controller, the firmware, the board and the radio link.',
    },
    {
      id: 'fleet-mixed',
      route: '/',
      target: '[data-tour="fleet-grid"]',
      placement: 'top',
      before: ctx => ctx.click('.fleet-modal button[aria-label="Close"]'),
      settle: 300,
      title: 'One fleet',
      text: 'All vehicle types sit together in one fleet, with one way of working.',
    },
  ],
}

const plan: TourChapter = {
  id: 'plan',
  title: 'Plan a Mission',
  blurb: 'Draw the survey, set the flight, check it and send it to the drone.',
  minutes: 2,
  steps: [
    {
      id: 'plan-modes',
      route: `/missions/${DEMO_VEHICLE}`,
      target: '[data-tour="plan-modes"]',
      waitFor: '[data-tour="plan-presets"]',
      placement: 'left',
      title: 'Mission planner',
      text: 'This is the mission planner. Choose the mission type at the top. For a drone the choices are survey, point to point, encircle and manoeuvre.',
    },
    {
      id: 'plan-preset',
      target: '[data-tour="plan-presets"]',
      placement: 'left',
      before: ctx => ctx.click('[data-tour="plan-presets"] button:first-child'),
      settle: 400,
      title: 'Ready-made survey',
      text: 'We pick a ready-made survey. The flight lines are drawn on the map for you.',
    },
    {
      id: 'plan-area',
      target: '[data-tour="plan-area"]',
      placement: 'left',
      title: 'Survey area',
      text: 'The area has four corners. You can drag a corner, or click the map to draw your own area.',
    },
    {
      id: 'plan-zones',
      target: '[data-tour="plan-zones"]',
      placement: 'left',
      title: 'No-fly zones',
      text: 'Zones mark places to keep out of. The flight lines go around them on their own.',
    },
    {
      id: 'plan-summary',
      target: '.mission-map-summary',
      placement: 'bottom',
      title: 'Summary',
      text: 'Route length, flight time, photos and battery use update as the plan changes.',
    },
    {
      id: 'plan-params',
      target: '[data-tour="plan-params"]',
      placement: 'left',
      before: async ctx => {
        // The plan panel is tall: fold it so the flight panel opens with room to show its sliders.
        await ctx.closePanel('plan')
        await ctx.openPanel('flight')
      },
      settle: 350,
      title: 'Flight settings',
      text: 'Height, speed and photo overlap are set with these sliders.',
    },
    {
      id: 'plan-failsafe',
      target: '[data-tour="plan-failsafe"]',
      placement: 'left',
      before: async ctx => {
        await ctx.closePanel('plan')
        await ctx.openPanel('flight')
      },
      settle: 200,
      title: 'Failsafe',
      text: 'If the radio link drops, the drone comes home by itself. You choose what it does here.',
    },
    {
      id: 'plan-preflight',
      target: '[data-panel-id="preflight"]',
      placement: 'left',
      before: async ctx => {
        await ctx.closePanel('flight')
        await ctx.openPanel('preflight')
      },
      settle: 350,
      title: 'Safety checks',
      text: 'Safety checks run before upload. Height, battery and the flight zone must all pass.',
    },
    {
      id: 'plan-upload',
      target: '[data-tour="plan-upload"]',
      placement: 'left',
      before: async ctx => {
        await ctx.openPanel('preflight')
        await press(ctx, '[data-tour="plan-upload"]')
        await ctx.waitFor('[data-tour="plan-open-live"]', 10_000)
      },
      settle: 300,
      title: 'Upload',
      text: 'The plan is sent to the drone. It is ready to fly.',
    },
  ],
}

const types: TourChapter = {
  id: 'types',
  title: 'Mission Types',
  blurb: 'Point to point, encircle and manoeuvre: each type has its own presets and settings.',
  minutes: 1,
  steps: [
    {
      id: 'types-p2p',
      route: `/missions/${DEMO_VEHICLE}`,
      target: '[data-tour="plan-points"]',
      // The summary only renders once the saved plan has loaded; switching modes before that is undone.
      waitFor: '.mission-map-summary',
      placement: 'left',
      before: async ctx => {
        await ctx.click('[data-tour="plan-modes"] button:nth-child(2)')
        await ctx.click('[data-tour="plan-point-presets"] button:nth-child(2)')
      },
      settle: 500,
      title: 'Point to point',
      text: 'Point to point flies a list of waypoints in order. Click the map to add a point, or pick a preset.',
    },
    {
      id: 'types-orbit',
      target: '[data-tour="plan-orbit"]',
      placement: 'left',
      before: async ctx => {
        await ctx.click('[data-tour="plan-modes"] button:nth-child(3)')
        await ctx.click('[data-tour="plan-orbit-presets"] button:first-child')
      },
      settle: 500,
      title: 'Encircle',
      text: 'Encircle flies circles around one target. You set the radius and the number of laps.',
    },
    {
      id: 'types-maneuver',
      target: '[data-tour="plan-maneuver"]',
      placement: 'left',
      before: async ctx => {
        await ctx.click('[data-tour="plan-modes"] button:nth-child(4)')
        await ctx.click('[data-tour="plan-maneuver-presets"] button:first-child')
      },
      settle: 500,
      title: 'Manoeuvre',
      text: 'Manoeuvre flies a fixed pattern, such as a figure of eight or a racetrack.',
    },
    {
      id: 'types-survey',
      target: '[data-tour="plan-modes"]',
      placement: 'left',
      before: ctx => ctx.click('[data-tour="plan-modes"] button:first-child'),
      settle: 400,
      title: 'Pick the one that fits',
      text: 'Every type is planned, checked and uploaded the same way. Pick the one that fits the job.',
    },
  ],
}

const fly: TourChapter = {
  id: 'fly',
  title: 'Live Flight',
  blurb: 'The drone takes off and flies the uploaded plan. Try the flight commands yourself.',
  minutes: 1,
  steps: [
    {
      id: 'fly-view',
      route: `/vehicles/${DEMO_VEHICLE}`,
      target: '[data-tour="live-view"]',
      waitFor: '[data-tour="cmd-arm"]',
      placement: 'auto',
      before: ctx => ctx.sim(DEMO_VEHICLE).setRate(1),
      title: 'Live view',
      text: 'This is the live view for a real flight. The map shows the route, home and the drone. The panel on the right holds the flight commands.',
    },
    {
      id: 'fly-launch',
      target: '[data-tour="cmd-grid"]',
      placement: 'left',
      advance: 'auto',
      dwell: 10,
      before: async ctx => {
        await ctx.openPanel('commands')
        if (stageOf(ctx) === 'standby') await press(ctx, '[data-tour="cmd-arm"]')
        if (stageOf(ctx) === 'armed') await press(ctx, '[data-tour="cmd-launch"]')
      },
      settle: 600,
      title: 'Take off',
      text: 'The drone is armed and takes off. It flies the uploaded plan by itself, in real time.',
    },
    {
      id: 'fly-commands',
      target: '[data-tour="cmd-grid"]',
      placement: 'left',
      interactive: true,
      title: 'Flight commands',
      text: 'One button for each command. The drone is flying now, so you can try them:',
      say: 'One button for each command. Arm gets the drone ready. Take off starts the flight. Hold pauses it in the air, and hold again continues. R T L brings it back home and lands. Land puts it down where it is. Abort stops everything. The drone is flying now, so you can try them.',
      items: [
        'Arm: gets the drone ready to fly.',
        'Takeoff: starts the flight.',
        'Hold: pauses in the air. Press again to continue.',
        'RTL: returns to home and lands.',
        'Land: lands where it is.',
        'Abort: stops everything at once.',
      ],
      hint: 'Try HOLD, then HOLD again to continue. Press Next when you are done.',
    },
    {
      id: 'fly-data',
      target: '[data-tour="instruments"]',
      placement: 'top',
      title: 'Live data',
      text: 'Height, speed and heading update live, with the camera feed and the mission progress above.',
    },
  ],
}

const maritime: TourChapter = {
  id: 'maritime',
  title: 'Go Maritime',
  blurb: 'The same planning and live screens work at sea, for boats and submarines.',
  minutes: 1,
  steps: [
    {
      id: 'sea-view',
      route: '/vehicles/USV-001',
      target: '[data-tour="live-view"]',
      waitFor: '[data-tour="instruments"]',
      placement: 'auto',
      title: 'Boat',
      text: 'A boat gets the same screens, with the chart, home and the boat on the water.',
    },
    {
      id: 'sea-instruments',
      target: '[data-tour="instruments"]',
      placement: 'top',
      title: 'Heading and current',
      text: 'The dial shows the heading, the real track over the ground, and the current pushing the boat.',
    },
    {
      id: 'uuv-view',
      route: '/vehicles/UUV-001',
      target: '[data-tour="instruments"]',
      waitFor: '[data-tour="instruments"]',
      placement: 'top',
      title: 'Submarine',
      text: 'A submarine adds depth, height above the seabed and dive lights.',
    },
  ],
}

export const CHAPTERS: TourChapter[] = [explore, fleet, plan, types, fly, maritime]

export const chapterById = (id: string | null | undefined) =>
  CHAPTERS.find(c => c.id === id) ?? null
