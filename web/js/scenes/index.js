// Scene registry: id -> factory(dat) -> { id, palette, basePalette?(tick), render(fb, tick, rt) }
import intro from './intro.js'; import logo from './logo.js'; import credits from './credits.js'; import nigga from './nigga.js';
import flower from './flower.js'; import flight from './flight.js'; import water from './water.js'; import twirl from './twirl.js'; import tunnel2 from './tunnel2.js';
export const FACTORIES = { intro, logo, credits, nigga, flower, flight, water, twirl, tunnel2 };
