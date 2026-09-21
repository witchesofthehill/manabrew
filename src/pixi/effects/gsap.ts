// Import `gsap` from here — never from `"gsap"` directly — so PixiPlugin is registered before any tween runs.

import { gsap } from "gsap";
import { PixiPlugin } from "gsap/PixiPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import * as PIXI from "pixi.js";

gsap.registerPlugin(PixiPlugin, MotionPathPlugin);
PixiPlugin.registerPIXI(PIXI);

export { gsap };
