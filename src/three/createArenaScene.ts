import * as THREE from "three";
import { targetingOverlay } from "@/three/targetingOverlay";
import { blockShield } from "@/three/blockShield";
import type { ArenaSceneProps } from "@/three/arena.types";
import { cardTexture } from "@/three/cardTexture";
import { updatePileBadge, clearPileBadge } from "@/three/pileBadge";
import { arenaLayout } from "@/three/arenaLayout";
import { tableTexture } from "@/three/tableTexture";
import { cardGeometry, CARD_WIDTH, CARD_HEIGHT } from "@/three/cardGeometry";
import { recordCastOrigin } from "@/three/castMotion";
import { cardGlow, disposeCardGlow } from "@/three/cardGlow";
import { arenaAtmosphere } from "@/three/arenaAtmosphere";
import { combatMotion } from "@/three/combatMotion";
import { createZonePiles } from "@/three/zonePiles";
import { LONG_PRESS_PREVIEW_MS, LONG_PRESS_CANCEL_DIST_SQ } from "@/lib/responsive";

export function createArenaScene(element: HTMLDivElement, live: { current: ArenaSceneProps }) {
  const { colors } = live.current;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  element.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colors.background);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.5, 80);
  let sceneWidth = 1;
  let handZ = 8.5;
  let handOrder: string[] = [];
  const resize = () => {
    const width = element.clientWidth;
    const height = element.clientHeight;
    renderer.setSize(width, height);
    const gutter = width <= 1000 || height <= 620 ? Math.min(220, width * 0.3) : 0;
    sceneWidth = Math.max(1, width - gutter);
    renderer.setViewport(0, 0, sceneWidth, height);
    camera.aspect = sceneWidth / Math.max(height, 1);
    const distance = Math.max(22, (22 / camera.aspect) * 1.45);
    camera.position.set(0, distance * 0.99, distance * 0.28);
    camera.lookAt(0, 0, 0.5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const handRay = new THREE.Raycaster();
    handRay.setFromCamera(new THREE.Vector2(0, -0.98), camera);
    const anchor = handRay.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.65),
      new THREE.Vector3(),
    );
    if (anchor) handZ = anchor.z;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  resize();
  scene.add(new THREE.HemisphereLight(colors.foreground, colors.background, 2.4));
  const sun = new THREE.DirectionalLight(colors.foreground, 3);
  sun.position.set(-5, 13, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
  scene.add(sun);
  const stone = tableTexture(colors);
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(25, 0.65, 26),
    new THREE.MeshStandardMaterial({ map: stone, roughness: 0.93, metalness: 0.25 }),
  );
  table.position.y = -0.5;
  table.receiveShadow = true;
  scene.add(table);
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.3 + i * 0.2, 3.32 + i * 0.2, 96),
      new THREE.MeshBasicMaterial({ color: colors.border, transparent: true, opacity: 0.3 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.16 + i * 0.001;
    scene.add(ring);
  }
  for (const x of [-11.4, 11.4])
    for (const z of [-10, 0, 9]) {
      const crystal = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 8),
        new THREE.MeshStandardMaterial({
          color: colors.accent,
          emissive: colors.accent,
          emissiveIntensity: 0.35,
          metalness: 0.5,
          roughness: 0.2,
        }),
      );
      crystal.position.set(x, 0.35, z);
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.68, 0.24, 6),
        new THREE.MeshStandardMaterial({ color: colors.border, metalness: 0.75, roughness: 0.4 }),
      );
      plinth.position.set(x, -0.02, z);
      scene.add(plinth);
      crystal.scale.y = 0.75;
      scene.add(crystal);
      const light = new THREE.PointLight(colors.accent, 8, 7);
      light.position.set(x, 2, z);
      scene.add(light);
    }
  type Tile = {
    mesh: THREE.Mesh<THREE.ExtrudeGeometry, [THREE.MeshBasicMaterial, THREE.MeshStandardMaterial]>;
    hitMesh: THREE.Mesh;
    glow: ReturnType<typeof cardGlow>;
    signature: string;
    side: string;
    born: number;
    departing?: number;
    departureDelay?: number;
    rest?: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 };
    dispose: () => void;
  };
  const tiles = new Map<string, Tile>();
  const targets = targetingOverlay(element.closest(".arena-root") ?? element, live, (event) =>
    hit(event),
  );
  const combat = combatMotion();
  const atmosphere = arenaAtmosphere(scene, colors);
  const zonePiles = createZonePiles(scene, colors);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered: string | null = null;
  let pressed: { id: string; x: number; y: number; pointerId: number; held: boolean } | null = null;
  let hold = 0;
  let dragPosition: THREE.Vector3 | null = null;
  let dragKey = "";
  let blockTarget: string | null = null;
  const blocking = () => Boolean(pressed && live.current.blockTargets?.[pressed.id]);
  const blockArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(),
    1,
    colors.accent,
    0.5,
    0.32,
  );
  blockArrow.visible = false;
  blockArrow.line.visible = false;
  const blockShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 8),
    new THREE.MeshBasicMaterial({ color: colors.accent }),
  );
  blockArrow.add(blockShaft);
  scene.add(blockArrow);
  const blockColor = colors.block ?? colors.playable ?? colors.accent;
  const dragShield = blockShield(colors);
  scene.add(...dragShield);
  const blockHalo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 1, 8),
    new THREE.MeshBasicMaterial({
      color: blockColor,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  blockArrow.add(blockHalo);
  const playArea = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-9, 0.08, -4.5),
      new THREE.Vector3(9, 0.08, -4.5),
      new THREE.Vector3(9, 0.08, 4.5),
      new THREE.Vector3(-9, 0.08, 4.5),
    ]),
    new THREE.LineBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.8 }),
  );
  playArea.visible = false;
  scene.add(playArea);
  const canDropHand = () =>
    Boolean(dragPosition && Math.abs(dragPosition.x) < 9 && Math.abs(dragPosition.z) < 4.5);
  const dragFeedback = (id: string | null, canPlay = false) => {
    const key = id ? `${id}:${canPlay}` : "";
    if (key === dragKey) return;
    dragKey = key;
    live.current.onDrag?.(id ? { id, canPlay } : null);
  };
  const hit = (e: PointerEvent, exclude?: string) => {
    const rect = element.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / sceneWidth) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const object = raycaster.intersectObjects(
      [...tiles.values()]
        .filter(
          (t) => t.mesh.userData.id !== exclude && !t.mesh.userData.opponentHand && !t.departing,
        )
        .map((t) => t.hitMesh)
        .concat(hovered && tiles.get(hovered)?.side === "hand" ? [tiles.get(hovered)!.mesh] : [])
        .concat(zonePiles.picks()),
      false,
    )[0]?.object;
    return object?.userData.zoneId
      ? `zone:${object.userData.zoneId}`
      : (object?.userData.id ?? null);
  };
  const preview = (id: string | null) => {
    hovered = id;
    element.style.cursor = id ? "pointer" : "default";
    const pos = id ? tiles.get(id)?.mesh.position.clone().project(camera) : null;
    const r = element.getBoundingClientRect();
    live.current.onHover?.(
      id,
      pos
        ? new DOMRect(
            r.left + ((pos.x + 1) * sceneWidth) / 2 - 50,
            r.top + ((1 - pos.y) * r.height) / 2 - 70,
            100,
            140,
          )
        : undefined,
    );
  };
  const down = (e: PointerEvent) => {
    if (pressed || e.button !== 0) return;
    const id = hit(e);
    if (!id) return;
    pressed = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, held: false };
    renderer.domElement.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch")
      hold = window.setTimeout(() => {
        if (pressed) {
          pressed.held = true;
          preview(id);
        }
      }, LONG_PRESS_PREVIEW_MS);
  };
  const move = (e: PointerEvent) => {
    if (live.current.targeting) {
      preview(hit(e));
      return;
    }
    if (pressed && pressed.pointerId !== e.pointerId) return;
    if (
      pressed &&
      (e.clientX - pressed.x) ** 2 + (e.clientY - pressed.y) ** 2 > LONG_PRESS_CANCEL_DIST_SQ
    ) {
      clearTimeout(hold);
      if (!pressed.held && tiles.has(pressed.id)) {
        const targetId = hit(e, pressed.id);
        dragPosition = raycaster.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9),
          new THREE.Vector3(),
        );
        const card = live.current.cards.find((c) => c.id === pressed?.id);
        blockTarget =
          blocking() && targetId && live.current.blockTargets?.[pressed.id]?.includes(targetId)
            ? targetId
            : null;
        if (blocking()) {
          preview(null);
          element.style.cursor = blockTarget ? "crosshair" : "default";
        }
        dragFeedback(pressed.id, Boolean(card?.side === "hand" && card.playable && canDropHand()));
      }
    }
    if (e.pointerType !== "touch" && !pressed) {
      const id = hit(e);
      if (id !== hovered) preview(id);
    }
  };
  const up = (e: PointerEvent) => {
    if (!pressed || pressed.pointerId !== e.pointerId) return;
    clearTimeout(hold);
    const previous = pressed;
    const wasDragged = dragPosition !== null;
    const card = live.current.cards.find((c) => c.id === previous.id);
    const validHandDrop = Boolean(card?.playable && canDropHand());
    const bounds = element.getBoundingClientRect();
    if (
      card?.side === "hand" &&
      wasDragged &&
      !validHandDrop &&
      e.clientY >= bounds.top + bounds.height * 0.72 &&
      e.clientY <= bounds.bottom &&
      e.clientX >= bounds.left &&
      e.clientX <= bounds.left + sceneWidth
    ) {
      const others = handOrder.filter((id) => id !== card.id);
      const insertion = others.findIndex((id) => {
        const tile = tiles.get(id);
        if (!tile?.rest) return false;
        const screen = tile.rest.position.clone().project(camera);
        return bounds.left + ((screen.x + 1) * sceneWidth) / 2 > e.clientX;
      });
      others.splice(insertion < 0 ? others.length : insertion, 0, card.id);
      handOrder = others;
    }
    pressed = null;
    blockTarget = null;
    dragPosition = null;
    dragFeedback(null);
    if (previous.held) {
      preview(null);
      return;
    }
    const distance = Math.hypot(e.clientX - previous.x, e.clientY - previous.y);
    if (distance > 12 || wasDragged) {
      if (card?.side !== "hand" || validHandDrop)
        live.current.onDrop?.(previous.id, hit(e, previous.id));
    } else if (hit(e) === previous.id) {
      if (previous.id.startsWith("zone:")) live.current.onZone?.(previous.id.slice(5));
      else live.current.onCard(previous.id);
    }
  };
  const cancel = () => {
    clearTimeout(hold);
    pressed = null;
    blockTarget = null;
    dragPosition = null;
    dragFeedback(null);
    preview(null);
  };
  const leave = () => {
    if (!pressed) preview(null);
  };
  const canvas = renderer.domElement;
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("keydown", escape);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("pointerleave", leave);
  const links = new THREE.Group();
  scene.add(links);
  let linkKey = "";
  let frame = 0;
  let lastTime = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const render = (time: number) => {
    frame = requestAnimationFrame(render);
    if (document.hidden) return;
    const ease = reduced.matches ? 1 : 1 - Math.exp(-Math.min(time - lastTime, 50) / 90);
    lastTime = time;
    const current = live.current;
    zonePiles.update(current.zones ?? [], hovered);
    const focusCard = current.cards.find((c) => c.id === (pressed?.id ?? hovered));
    playArea.visible = Boolean(focusCard?.side === "hand" && focusCard.playable);
    playArea.material.opacity = dragPosition && canDropHand() ? 0.95 : 0.38;
    const hand = current.cards.filter((card) => card.side === "hand");
    const handIds = new Set(hand.map((card) => card.id));
    handOrder = handOrder.filter((id) => handIds.has(id));
    const known = new Set(handOrder);
    for (const card of hand) if (!known.has(card.id)) handOrder.push(card.id);
    const byId = new Map(hand.map((card) => [card.id, card]));
    const layout = arenaLayout([
      ...current.cards.filter((card) => card.side !== "hand"),
      ...handOrder.map((id) => byId.get(id)!),
    ]);
    for (const card of current.cards)
      if (card.side === "hand") {
        const position = layout.get(card.id)!;
        position.z = handZ + Math.abs(position.x) * 0.05;
      }
    for (const card of current.cards)
      if (card.side === "opponentHand") {
        const target = layout.get(card.id)!;
        const screen = new THREE.Vector3(target.x, target.y, target.z).project(camera);
        screen.y = 0.99 - Math.abs(target.x) * 0.01;
        const held = screen.unproject(camera);
        target.x = held.x;
        target.y = held.y;
        target.z = held.z;
      }
    const hadCards = tiles.size > 0;
    for (const tile of tiles.values())
      if (tile.rest) {
        tile.mesh.position.copy(tile.rest.position);
        tile.mesh.rotation.copy(tile.rest.rotation);
        tile.mesh.scale.copy(tile.rest.scale);
      }
    const combatPositions = new Map(
      [...tiles].map(([id, t]) => [id, { x: t.mesh.position.x, z: t.mesh.position.z }]),
    );
    const bounds = element.getBoundingClientRect();
    for (const side of ["self", "opponent", "player-0", "player-1", "player-2", "player-3"]) {
      const badge = element
        .closest(".arena-root")
        ?.querySelector(`[data-player-side="${side}"], [data-player-id="${side}"]`);
      if (!badge) continue;
      const rect = badge.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((rect.left + rect.width / 2 - bounds.left) / sceneWidth) * 2 - 1,
          1 - ((rect.top + rect.height / 2 - bounds.top) / bounds.height) * 2,
        ),
        camera,
      );
      const target = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8),
        new THREE.Vector3(),
      );
      if (target) combatPositions.set(`player:${side}`, target);
    }
    combat.update(current, time, combatPositions);
    for (const [id, tile] of tiles)
      if (!layout.has(id)) {
        if (tile.departing === undefined) {
          tile.departing = time;
          tile.departureDelay = !reduced.matches
            ? Math.max(0, combat.remaining(id, time) - 300)
            : 0;
        }
        const duration = reduced.matches ? 150 : (tile.departureDelay ?? 0) + 480;
        if (time - tile.departing < duration && (tile.side === "self" || tile.side === "opponent"))
          continue;
        clearPileBadge(tile.mesh);
        scene.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        tile.mesh.material.forEach((m) => m.dispose());
        disposeCardGlow(tile.glow);
        tile.dispose();
        tiles.delete(id);
      }
    for (const card of current.cards) {
      let tile = tiles.get(card.id);
      const signature = JSON.stringify([
        card.name,
        card.type,
        card.cost,
        card.text,
        card.stats,
        card.statsChanged,
        card.keywords,
        card.counters,
        card.damage,
        card.actionCount,
        card.image,
        card.artImage,
        card.side,
        card.side !== "hand" && card.tapped,
        card.side !== "hand" && card.selected,
        card.side !== "hand" && card.attacking,
        card.color,
        card.frame,
        card.hidden,
      ]);
      if (!tile) {
        const edge = new THREE.MeshStandardMaterial({
          color: new THREE.Color(colors.border).multiplyScalar(0.3),
          roughness: 0.9,
        });
        const face = new THREE.MeshBasicMaterial({ toneMapped: false });
        const materials: [THREE.MeshBasicMaterial, THREE.MeshStandardMaterial] = [face, edge];
        const mesh = new THREE.Mesh(cardGeometry(card.side !== "hand" && !card.hidden), materials);
        mesh.userData.id = card.id;
        mesh.userData.compact = card.side !== "hand" && !card.hidden;
        mesh.castShadow = true;
        mesh.userData.opponentHand = card.side === "opponentHand";
        const initial = layout.get(card.id)!;
        const dealing =
          hadCards && (card.side === "hand" || card.side === "opponentHand") && !reduced.matches;
        mesh.position.set(
          dealing ? (card.side === "hand" ? -9.4 : 9.4) : initial.x,
          initial.y + (hadCards && !dealing ? 1.1 : 0.3),
          dealing ? (card.side === "hand" ? 4.9 : -9.8) : initial.z,
        );
        mesh.scale.setScalar(initial.scale);
        mesh.rotation.y = initial.angle;
        const hitMesh = new THREE.Mesh(mesh.geometry, face);
        hitMesh.userData.id = card.id;
        scene.add(mesh);
        const glow = cardGlow(
          card.side !== "hand" && !card.hidden,
          colors.playable ?? colors.accent,
        );
        mesh.add(glow);
        tile = {
          mesh,
          hitMesh,
          glow,
          side: card.side,
          born: hadCards ? time : time - 500,
          signature: "",
          dispose: () => {},
        };
        tiles.set(card.id, tile);
      }
      tile.side = card.side;
      tile.departing = undefined;
      tile.mesh.castShadow = true;
      tile.mesh.material.forEach((m) => {
        m.opacity = 1;
        m.transparent = false;
      });
      if (signature !== tile.signature) {
        tile.dispose();
        const compact = card.side !== "hand" && !card.hidden;
        if (tile.mesh.userData.compact !== compact) {
          tile.mesh.geometry.dispose();
          tile.mesh.geometry = cardGeometry(compact);
          tile.hitMesh.geometry = tile.mesh.geometry;
          tile.mesh.userData.compact = compact;
          tile.mesh.remove(tile.glow);
          disposeCardGlow(tile.glow);
          tile.glow = cardGlow(compact, colors.playable ?? colors.accent);
          tile.mesh.add(tile.glow);
        }
        const art = cardTexture(card, colors);
        art.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tile.mesh.material[0].map = art.texture;
        tile.mesh.material[0].needsUpdate = true;
        tile.dispose = art.dispose;
        tile.signature = signature;
      }
      const target = layout.get(card.id)!;
      updatePileBadge(tile.mesh, target.pileCount, colors);
      tile.hitMesh.position.set(target.x, target.y, target.z);
      tile.hitMesh.rotation.y = target.angle;
      tile.hitMesh.scale.setScalar(target.scale);
      tile.hitMesh.updateMatrixWorld(true);
      const destination = new THREE.Vector3(target.x, target.y, target.z);
      if (hovered === card.id) {
        if (card.side === "hand") {
          destination.project(camera);
          destination.y += 0.15;
          destination.unproject(camera);
        } else destination.y += 0.65;
      }
      tile.mesh.position.lerp(
        pressed?.id === card.id && dragPosition && !blocking() ? dragPosition : destination,
        ease,
      );
      if (card.side === "opponentHand") {
        const heldRotation = camera.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              Math.PI + (target.angle - Math.PI),
            ),
          )
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
          );
        tile.mesh.quaternion.slerp(heldRotation, ease);
        tile.mesh.castShadow = false;
      } else {
        const angle =
          hovered === card.id && card.side === "hand" ? target.angle * 0.35 : target.angle;
        tile.mesh.rotation.y += (angle - tile.mesh.rotation.y) * ease;
      }
      const scale =
        target.scale * (hovered === card.id ? (card.side === "hand" ? 1.035 : 1.12) : 1);
      tile.mesh.scale.lerp(new THREE.Vector3(scale, scale, scale), ease);
      const glow = card.selected || card.playable || hovered === card.id || blockTarget === card.id;
      tile.glow.material.opacity +=
        ((blockTarget === card.id
          ? 1
          : card.playable || card.selected
            ? hovered === card.id
              ? 1
              : 0.7
            : 0) -
          tile.glow.material.opacity) *
        ease;
      for (const child of tile.glow.children)
        (child as THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>).material.opacity =
          tile.glow.material.opacity * child.userData.strength;
      tile.mesh.material[1].emissive.set(card.attacking ? colors.hostile : colors.accent);
      tile.mesh.material[1].emissiveIntensity +=
        ((glow ? 0.8 : 0) - tile.mesh.material[1].emissiveIntensity) * ease;
    }
    for (const [id, tile] of tiles) {
      tile.rest = {
        position: tile.mesh.position.clone(),
        rotation: tile.mesh.rotation.clone(),
        scale: tile.mesh.scale.clone(),
      };
      combat.apply(id, tile.mesh, time, reduced.matches);
      const impact = combat.impact(id, time);
      if (impact) {
        if (!reduced.matches) atmosphere.impact(impact.position, time);
        if (impact.player) {
          const badge = element
            .closest(".arena-root")
            ?.querySelector(
              `[data-player-side="${impact.player}"], [data-player-id="${impact.player}"]`,
            );
          badge?.animate(
            [
              {
                boxShadow: `0 0 0 3px ${colors.hostile}, 0 0 36px ${colors.hostile}`,
                transform: "translateX(0)",
              },
              { transform: reduced.matches ? "none" : "translateX(-7px)" },
              { transform: reduced.matches ? "none" : "translateX(5px)" },
              { boxShadow: "none", transform: "translateX(0)" },
            ],
            { duration: 460, easing: "ease-out" },
          );
        }
      }
      if (tile.departing !== undefined) {
        const wait = tile.departureDelay ?? 0;
        const fade = THREE.MathUtils.clamp(
          (time - tile.departing - wait) / (reduced.matches ? 150 : 480),
          0,
          1,
        );
        tile.glow.visible = false;
        tile.mesh.castShadow = fade < 0.5;
        tile.mesh.material.forEach((m) => {
          m.transparent = true;
          m.opacity = 1 - fade;
        });
        if (!reduced.matches) {
          tile.mesh.position.y += fade * 0.7;
          tile.mesh.rotation.z += fade * 0.09;
          tile.mesh.scale.multiplyScalar(1 - fade * 0.18);
        }
      } else {
        tile.glow.visible = true;
        const arrival = reduced.matches ? 1 : THREE.MathUtils.clamp((time - tile.born) / 320, 0, 1);
        if (arrival < 1) {
          tile.mesh.material.forEach((m) => {
            m.transparent = true;
            m.opacity = arrival;
          });
          tile.mesh.rotation.z += Math.sin(arrival * Math.PI) * 0.045;
        }
      }
    }
    blockArrow.visible = Boolean(blocking() && dragPosition);
    dragShield.forEach((mesh) => {
      mesh.visible = blockArrow.visible;
    });
    if (blockArrow.visible && pressed && dragPosition) {
      const source = layout.get(pressed.id);
      const target = blockTarget ? layout.get(blockTarget) : undefined;
      if (source) {
        const start = new THREE.Vector3(source.x, 1, source.z);
        const end = target
          ? new THREE.Vector3(target.x, 1, target.z)
          : dragPosition.clone().setY(1);
        const direction = end.clone().sub(start);
        blockArrow.position.copy(start);
        blockArrow.setDirection(direction.clone().normalize());
        blockArrow.setLength(Math.max(0.01, direction.length()), 0.5, 0.32);
        blockShaft.scale.y = Math.max(0.01, direction.length() - 0.3);
        blockShaft.position.y = blockShaft.scale.y / 2;
        blockShaft.material.color.set(blockColor);
        blockArrow.setColor(blockColor);
        blockHalo.scale.y = blockShaft.scale.y;
        blockHalo.position.y = blockShaft.position.y;
        dragShield.forEach((mesh) => {
          mesh.position.copy(start).lerp(end, 0.3);
          mesh.quaternion.copy(camera.quaternion);
          mesh.translateZ(mesh.userData.shieldOffset);
        });
      }
    }
    const attackLinks = current.cards
      .filter((c) => c.attacking)
      .map((c) => ({
        from: c.id,
        to:
          c.attackTargetId && layout.has(c.attackTargetId)
            ? c.attackTargetId
            : `player:${c.attackingPlayerId ?? (c.side === "self" ? "opponent" : "self")}`,
        color: current.colors.attack ?? current.colors.hostile,
        attack: true,
      }));
    const nextLinkKey = JSON.stringify([
      current.links,
      attackLinks,
      [...layout],
      [...combatPositions].filter(([id]) => id.startsWith("player:")),
    ]);
    if (nextLinkKey !== linkKey) {
      links.children.forEach((o) => {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      links.clear();
      for (const link of [
        ...(current.links ?? []).map((l) => ({ ...l, color: blockColor, attack: false })),
        ...attackLinks,
      ]) {
        const a = layout.get(link.from),
          b = layout.get(link.to) ?? combatPositions.get(link.to);
        if (!a || !b) continue;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(a.x, 0.4, a.z),
          new THREE.Vector3((a.x + b.x) / 2, 2, (a.z + b.z) / 2),
          new THREE.Vector3(b.x, 0.4, b.z),
        );
        links.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(curve, 28, 0.045, 6, false),
            new THREE.MeshBasicMaterial({ color: link.color }),
          ),
        );
        {
          const glow = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 28, 0.14, 6, false),
            new THREE.MeshBasicMaterial({
              color: link.color,
              transparent: true,
              opacity: 0.2,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          links.add(glow);
          const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.23, 0.65, 3),
            new THREE.MeshBasicMaterial({ color: link.color }),
          );
          tip.position.copy(curve.getPoint(0.94));
          tip.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            curve.getTangent(0.94).normalize(),
          );
          links.add(tip);
        }
        if (!link.attack) {
          const shield = blockShield(colors);
          shield.forEach((mesh) => {
            mesh.position.copy(curve.getPoint(0.3));
            mesh.quaternion.copy(camera.quaternion);
            mesh.translateZ(mesh.userData.shieldOffset);
          });
          links.add(...shield);
        }
      }
      linkKey = nextLinkKey;
    }
    atmosphere.update(time, reduced.matches);
    const root = element.closest(".arena-root");
    if (root)
      for (const card of current.cards.filter((c) => c.side === "hand")) {
        const tile = tiles.get(card.id);
        if (!tile) continue;
        tile.mesh.updateMatrixWorld(true);
        const corners = [
          [-1, -1],
          [1, -1],
          [-1, 1],
        ].map(([x, z]) => {
          const point = tile.mesh
            .localToWorld(new THREE.Vector3((x * CARD_WIDTH) / 2, 0.04, (z * CARD_HEIGHT) / 2))
            .project(camera);
          return {
            x: bounds.left + ((point.x + 1) * sceneWidth) / 2,
            y: bounds.top + ((1 - point.y) * bounds.height) / 2,
          };
        });
        recordCastOrigin(root, card.id, corners);
      }
    targets.update(
      new Map(
        [...tiles].map(([id, tile]) => {
          const point = tile.mesh.position.clone().project(camera);
          return [
            id,
            {
              x: bounds.left + ((point.x + 1) * sceneWidth) / 2,
              y: bounds.top + ((1 - point.y) * bounds.height) / 2,
            },
          ];
        }),
      ),
      hovered,
    );
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(render);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(hold);
    observer.disconnect();
    targets.dispose();
    zonePiles.dispose();
    atmosphere.dispose();
    window.removeEventListener("keydown", escape);
    playArea.geometry.dispose();
    playArea.material.dispose();
    blockArrow.dispose();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", cancel);
    canvas.removeEventListener("pointerleave", leave);
    for (const tile of tiles.values()) {
      clearPileBadge(tile.mesh);
      tile.dispose();
    }
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
      }
    });
    renderer.dispose();
    stone.dispose();
    canvas.remove();
  };
}
