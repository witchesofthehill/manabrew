// Import `gsap` from here — never from `"gsap"` directly — so PixiPlugin is registered before any tween runs.

import { gsap } from "gsap";
import { PixiPlugin } from "gsap/PixiPlugin";
import * as PIXI from "pixi.js";

gsap.registerPlugin(PixiPlugin);
PixiPlugin.registerPIXI(PIXI);

export { gsap };
