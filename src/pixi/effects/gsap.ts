/**
 * GSAP set up for Pixi: registers `PixiPlugin` against our Pixi v8 classes so
 * tweens can target Pixi display objects (color/tint formats, the `pixi:{…}`
 * shorthand, etc.). Import `gsap` from here — never from `"gsap"` directly —
 * so the plugin is always registered before any tween runs.
 */

import { gsap } from "gsap";
import { PixiPlugin } from "gsap/PixiPlugin";
import * as PIXI from "pixi.js";

gsap.registerPlugin(PixiPlugin);
PixiPlugin.registerPIXI(PIXI);

export { gsap };
