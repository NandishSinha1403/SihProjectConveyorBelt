import * as THREE from 'three';
import type { Stage } from './stage';

/**
 * Conveyor belt health-monitoring rig — model + live-sensor-bound animation.
 * Real-world metres, y-up, belt centred on the origin.
 *
 * This rig has no simulated physics of its own: belt motion, jitter, and alarm/rupture visuals
 * are all driven by `setLive()`, fed from the physical ESP32 belt-monitor node's readings over
 * Supabase (see lib/rig/useLiveBeltFeed.ts). In particular, the belt only animates while the live
 * `vibration` reading says the rig is actually moving (see MOTION_THRESHOLD) — it sits still
 * otherwise, rather than animating on regardless of real state.
 */

const W = 1.0; // belt width
const R = 0.2; // pulley radius
const HX = 2.6; // pulley centre |x|
const YC = 0.85; // pulley centre height
const RUN = HX * 2; // straight run length
const LOOP = 2 * RUN + 2 * Math.PI * R;
const BT = 0.018; // belt thickness
const CAM_X = 1.75; // vision camera station (decorative — no live vision sensor)
const CLEATS = 26;
const HOLE_POOL = 3;

/** Fixed X position of the laser-gantry carriage — no live sensor commands it, so it's parked. */
const MOUNT_X_FIXED = -0.35;
/** Belt speed (m/s) while the live accelerometer says the rig is actually running. */
const LIVE_BELT_SPEED = 1.6;
/**
 * Smoothed |vibration| above this (m/s²) is read as "the belt is physically moving"; below it,
 * the visual belt sits still. No firmware change needed — this is purely a client-side read of
 * the `vibration` field already being logged. Idle/ambient noise on the rig sits ~0.03–0.09;
 * real activity (a tap, or the motor actually running) reads noticeably higher. Retune here if
 * the real motor's running vibration turns out lower/higher than that.
 */
const MOTION_THRESHOLD = 0.12;
/** Seconds; belt speed ramps toward its start/stop target instead of snapping. */
const SPEED_SMOOTH_TAU = 0.35;
/** Vibration-jitter tuning — gain/cap in metres of shake per unit |vibration|. */
const JITTER_GAIN = 0.02;
const JITTER_MAX = 0.01;
/** Seconds; jitter amplitude ramps toward its target instead of snapping. */
const VIBRATION_SMOOTH_TAU = 0.25;

/** A live sensor reading from the physical rig, pushed in via `ConveyorRig.setLive()`. */
export type LiveReading = {
  status: 'NORMAL' | 'WARNING' | null;
  vibration: number | null;
};

/** [text, x, y, z, px dx, px dy] — dx/dy separate labels whose anchors project close together. */
export const LABEL_ANCHORS: Array<[string, number, number, number, number, number]> = [
  ['CNN CAMERA', 1.75, 2.15, 0.6, 0, 0],
  ['3× OVERHEAD LASER', -0.35, 2.35, 0, 0, -26],
  ['LDR ARRAY — BETWEEN BELT RUNS', 0.9, 0.86, 0, 74, 18],
  ['ACCELEROMETER', 2.6, 1.62, 0.75, -60, 0],
  ['DRIVE UNIT', 2.6, 0.3, -1.25, 40, 34],
  ['FEED / SKIRTBOARDS', -2.15, 1.75, 0, 0, 0],
];

export type ConveyorRig = {
  setLive(reading: LiveReading): void;
  dispose(): void;
};

export function createConveyorRig(stage: Stage, onFrame?: () => void): ConveyorRig {
  const M = {
    steel: new THREE.MeshStandardMaterial({ name: 'steel_frame', color: 0x5980a6, roughness: 0.5, metalness: 0.35 }),
    graphite: new THREE.MeshStandardMaterial({ name: 'belt_rubber', color: 0x23272b, roughness: 0.85, metalness: 0.05 }),
    zinc: new THREE.MeshStandardMaterial({ name: 'roller_zinc', color: 0xb7bec6, roughness: 0.4, metalness: 0.38 }),
    panel: new THREE.MeshStandardMaterial({ name: 'guard_panel', color: 0xdcdee2, roughness: 0.7, metalness: 0.08 }),
    amber: new THREE.MeshStandardMaterial({ name: 'signal_amber', color: 0xd08a10, roughness: 0.5, metalness: 0.1 }),
    laser: new THREE.MeshStandardMaterial({ name: 'laser_beam', color: 0xd6402c, roughness: 0.9, emissive: 0x501008 }),
  };

  const root = new THREE.Group();
  root.name = 'conveyor_rig';

  function box(
    name: string,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.name = name;
    m.position.set(x, y, z);
    return m;
  }

  /** Cylinder whose axis lies along z (spin with rotation.z). */
  function roll(
    name: string,
    r: number,
    len: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    seg = 32,
  ) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.position.set(x, y, z);
    return m;
  }

  /* ---------- structure ---------- */
  const frame = new THREE.Group();
  frame.name = 'frame';
  const SZ = W / 2 + 0.1;
  for (const s of [1, -1]) {
    frame.add(box(`stringer_${s > 0 ? 'a' : 'b'}`, RUN + 0.7, 0.1, 0.055, M.steel, 0, YC + 0.02, s * SZ));
    frame.add(box(`stringer_low_${s > 0 ? 'a' : 'b'}`, RUN + 0.7, 0.06, 0.05, M.steel, 0, YC - 0.42, s * SZ));
  }
  [-2.25, -0.75, 0.75, 2.25].forEach((x, i) => {
    for (const s of [1, -1]) {
      frame.add(box(`leg_${i}${s > 0 ? 'a' : 'b'}`, 0.075, YC + 0.02, 0.075, M.steel, x, (YC + 0.02) / 2, s * SZ));
      frame.add(box(`foot_${i}${s > 0 ? 'a' : 'b'}`, 0.22, 0.02, 0.18, M.steel, x, 0.01, s * SZ));
    }
    frame.add(box(`crossmember_${i}`, 0.06, 0.06, W + 0.2, M.steel, x, 0.16, 0));
  });
  root.add(frame);

  /* ---------- pulleys, idlers ---------- */
  const spinners: Array<{ mesh: THREE.Mesh; radius: number }> = [];
  function addSpinner(mesh: THREE.Mesh, radius: number) {
    spinners.push({ mesh, radius });
    return mesh;
  }

  const pulleys = new THREE.Group();
  pulleys.name = 'pulleys';
  for (const [nm, x] of [['head_pulley', HX], ['tail_pulley', -HX]] as const) {
    const p = addSpinner(roll(nm, R, W + 0.05, M.zinc, x, YC, 0, 48), R);
    pulleys.add(p);
    // lagging ribs so rotation reads
    for (let i = 0; i < 6; i++) {
      const rib = box(`${nm}_rib_${i}`, 0.03, R * 2 - 0.004, W + 0.052, M.graphite, 0, 0, 0);
      rib.rotation.z = (i * Math.PI) / 6;
      p.add(rib);
    }
    for (const s of [1, -1]) {
      pulleys.add(box(`${nm}_pillow_block_${s > 0 ? 'a' : 'b'}`, 0.16, 0.2, 0.1, M.steel, x, YC - 0.06, s * (W / 2 + 0.09)));
      pulleys.add(roll(`${nm}_shaft_${s > 0 ? 'a' : 'b'}`, 0.032, 0.2, M.zinc, x, YC, s * (W / 2 + 0.12), 16));
    }
  }
  root.add(pulleys);

  const idlers = new THREE.Group();
  idlers.name = 'idlers';
  for (let i = 0; i < 7; i++) {
    const x = -2.1 + i * 0.7;
    idlers.add(addSpinner(roll(`carry_idler_${i}`, 0.055, W * 0.62, M.zinc, x, YC + R - 0.058, 0, 24), 0.055));
    for (const s of [1, -1]) {
      idlers.add(addSpinner(roll(`wing_idler_${i}${s > 0 ? 'a' : 'b'}`, 0.048, W * 0.3, M.zinc, x, YC + R - 0.062, s * (W * 0.3), 20), 0.048));
    }
  }
  [-1.6, 0, 1.6].forEach((x, i) => {
    idlers.add(addSpinner(roll(`return_idler_${i}`, 0.05, W * 0.92, M.zinc, x, YC - R - 0.055, 0, 24), 0.05));
  });
  root.add(idlers);

  /* ---------- belt ---------- */
  const belt = new THREE.Group();
  belt.name = 'belt';
  belt.position.y = YC;
  belt.add(box('belt_carry_strand', RUN, BT, W, M.graphite, 0, R + BT / 2, 0));
  belt.add(box('belt_return_strand', RUN, BT, W, M.graphite, 0, -R - BT / 2, 0));
  for (const [nm, x, tStart] of [
    ['belt_head_wrap', HX, 0],
    ['belt_tail_wrap', -HX, Math.PI],
  ] as const) {
    const g = new THREE.CylinderGeometry(R + BT, R + BT, W, 40, 1, true, tStart, Math.PI);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, M.graphite.clone());
    m.name = nm;
    m.position.x = x;
    m.material.side = THREE.DoubleSide;
    belt.add(m);
  }
  root.add(belt);

  /** Loop parametrisation: s = 0 at tail top, travelling +x. */
  function loopPoint(s: number) {
    let u = ((s % LOOP) + LOOP) % LOOP;
    if (u < RUN) return { x: -HX + u, y: R, a: 0 };
    u -= RUN;
    if (u < Math.PI * R) {
      const p = u / R;
      return { x: HX + R * Math.sin(p), y: R * Math.cos(p), a: -p };
    }
    u -= Math.PI * R;
    if (u < RUN) return { x: HX - u, y: -R, a: -Math.PI };
    const p = (u - RUN) / R;
    return { x: -HX - R * Math.sin(p), y: -R * Math.cos(p), a: -Math.PI - p };
  }

  // chevron cleats riding the loop
  const cleats: THREE.Group[] = [];
  for (let i = 0; i < CLEATS; i++) {
    const g = new THREE.Group();
    g.name = `belt_chevron_${i}`;
    for (const s of [1, -1]) {
      const bar = box(`chevron_bar_${i}${s > 0 ? 'a' : 'b'}`, 0.3, 0.012, 0.045, M.panel, 0, 0, s * W * 0.19);
      bar.rotation.y = s * 0.42;
      g.add(bar);
    }
    belt.add(g);
    cleats.push(g);
  }

  /* ---------- loading hopper + skirtboards ---------- */
  const feed = new THREE.Group();
  feed.name = 'loading_point';
  const hop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.3, 0.55, 4, 1, true),
    M.panel.clone(),
  );
  hop.name = 'loading_hopper';
  hop.material.side = THREE.DoubleSide;
  hop.position.set(-2.15, YC + R + 0.42, 0);
  hop.rotation.y = Math.PI / 4;
  feed.add(hop);
  for (const s of [1, -1]) {
    feed.add(box(`skirtboard_${s > 0 ? 'a' : 'b'}`, 1.5, 0.14, 0.02, M.panel, -1.85, YC + R + 0.08, s * (W / 2 - 0.06)));
  }
  root.add(feed);

  /* ---------- discharge chute ---------- */
  const chute = new THREE.Group();
  chute.name = 'discharge_chute';
  const chuteBack = box('chute_back', 0.95, 0.02, W + 0.1, M.panel, 0, 0, 0);
  chuteBack.rotation.z = -0.75;
  chuteBack.position.set(HX + 0.42, YC - 0.18, 0);
  chute.add(chuteBack);
  for (const s of [1, -1]) {
    const side = box(`chute_side_${s > 0 ? 'a' : 'b'}`, 0.95, 0.34, 0.02, M.panel, HX + 0.42, YC - 0.14, s * (W / 2 + 0.05));
    side.rotation.z = -0.75;
    chute.add(side);
  }
  root.add(chute);

  /* ---------- drive ---------- */
  const drive = new THREE.Group();
  drive.name = 'drive_unit';
  drive.add(box('gearbox', 0.34, 0.3, 0.26, M.steel, HX, YC - 0.05, -(W / 2 + 0.3)));
  drive.add(roll('motor', 0.15, 0.42, M.steel, HX - 0.02, YC - 0.05, -(W / 2 + 0.72), 32));
  for (let i = 0; i < 9; i++) {
    drive.add(roll(`motor_fin_${i}`, 0.158, 0.02, M.steel, HX - 0.02, YC - 0.05, -(W / 2 + 0.54) - i * 0.04, 24));
  }
  drive.add(roll('motor_fan_cowl', 0.12, 0.1, M.panel, HX - 0.02, YC - 0.05, -(W / 2 + 0.98), 24));
  drive.add(box('drive_guard', 0.4, 0.44, 0.05, M.panel, HX, YC - 0.02, -(W / 2 + 0.14)));
  root.add(drive);

  /* ---------- sensors ---------- */
  const sensors = new THREE.Group();
  sensors.name = 'sensors';

  // Vision camera — decorative only. There is no camera on the physical ESP32 rig, so this
  // mast/lens/FOV cone never reacts to live data; it just sits at its idle look.
  const camMast = new THREE.Group();
  camMast.name = 'vision_camera';
  camMast.add(box('camera_mast', 0.06, 1.15, 0.06, M.steel, CAM_X, YC + 0.57, W / 2 + 0.34));
  camMast.add(box('camera_arm', 0.06, 0.06, 0.42, M.steel, CAM_X, YC + 1.12, W / 2 + 0.13));
  const housing = box('camera_housing', 0.16, 0.13, 0.22, M.panel, CAM_X, YC + 1.02, 0.02);
  housing.rotation.x = 0.25;
  camMast.add(housing);
  const lens = roll('camera_lens', 0.045, 0.06, M.graphite, CAM_X, YC + 0.95, 0.02, 24);
  lens.rotation.x = Math.PI / 2 + 0.25;
  camMast.add(lens);
  // field of view drawn as edges only — a wireframe cone, not a solid volume
  const coneMat = new THREE.LineBasicMaterial({ name: 'vision_fov', color: 0x5980a6, transparent: true, opacity: 0.55 });
  const cone = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.ConeGeometry(0.42, 0.86, 4, 1, true)),
    coneMat,
  );
  cone.name = 'vision_fov_cone';
  cone.position.set(CAM_X, YC + R + 0.42, 0.01);
  cone.rotation.set(Math.PI, Math.PI / 4, 0);
  camMast.add(cone);
  sensors.add(camMast);

  const accel = new THREE.Group();
  accel.name = 'accelerometer';
  accel.add(box('accel_housing', 0.09, 0.06, 0.07, M.amber, HX, YC + 0.1, W / 2 + 0.09));
  accel.add(box('accel_cable', 0.012, 0.012, 0.3, M.graphite, HX, YC + 0.07, W / 2 + 0.26));
  sensors.add(accel);

  const beacon = new THREE.Group();
  beacon.name = 'alarm_beacon';
  beacon.add(box('beacon_post', 0.05, 0.55, 0.05, M.steel, -2.5, YC + 0.28, -(W / 2 + 0.2)));
  const domeMat = M.amber.clone();
  domeMat.name = 'beacon_lens';
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat,
  );
  dome.name = 'beacon_dome';
  dome.position.set(-2.5, YC + 0.56, -(W / 2 + 0.2));
  beacon.add(dome);
  sensors.add(beacon);
  root.add(sensors);

  /* ---------- rip-detection gantry: 3 lasers on an X mount ----------
     The carriage has no live sensor to command it, so it's parked at MOUNT_X_FIXED for good. */
  const GZ = W / 2 + 0.26;
  const RAIL_Y = 2.1;
  const gantry = new THREE.Group();
  gantry.name = 'rip_gantry';
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      gantry.add(box(`gantry_leg_${sx > 0 ? 'h' : 't'}${sz > 0 ? 'a' : 'b'}`, 0.06, RAIL_Y, 0.06, M.steel, sx * 1.55, RAIL_Y / 2, sz * GZ));
    }
  }
  for (const sz of [1, -1]) {
    gantry.add(box(`gantry_x_rail_${sz > 0 ? 'a' : 'b'}`, 3.45, 0.05, 0.07, M.steel, 0, RAIL_Y, sz * GZ));
    gantry.add(box(`gantry_x_scale_${sz > 0 ? 'a' : 'b'}`, 3.45, 0.02, 0.012, M.panel, 0, RAIL_Y + 0.04, sz * GZ));
  }
  // carriage — parked on the rails, carries the Y post
  const bridge = new THREE.Group();
  bridge.name = 'gantry_x_carriage';
  bridge.position.x = MOUNT_X_FIXED;
  bridge.add(box('carriage_cross_beam', 0.11, 0.07, W + 0.66, M.steel, 0, RAIL_Y - 0.06, 0));
  for (const sz of [1, -1]) {
    bridge.add(box(`carriage_shoe_${sz > 0 ? 'a' : 'b'}`, 0.17, 0.1, 0.12, M.panel, 0, RAIL_Y, sz * GZ));
  }
  bridge.add(box('carriage_y_post', 0.05, 0.95, 0.05, M.steel, 0, RAIL_Y - 0.52, 0));
  bridge.add(box('carriage_y_scale', 0.014, 0.95, 0.02, M.panel, 0.035, RAIL_Y - 0.52, 0));
  // sensor head — carries the three downward lasers
  const head = new THREE.Group();
  head.name = 'sensor_head_ldr_array';
  head.add(box('head_slide_block', 0.1, 0.13, 0.09, M.panel, 0, 0.06, 0));
  head.add(box('head_body', 0.2, 0.09, 0.44, M.steel, 0, 0, 0));
  const BELT_TOP = YC + R + BT;
  head.position.y = BELT_TOP + 0.5;
  const lasers: Array<{
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    x: number;
    z: number;
  }> = [];
  [-0.16, 0, 0.16].forEach((z, i) => {
    head.add(box(`laser_emitter_${i + 1}`, 0.07, 0.07, 0.07, M.panel, 0.075, -0.05, z));
    const beamMat = M.laser.clone();
    beamMat.name = `rip_laser_${i + 1}`;
    const b = roll(`rip_laser_beam_${i + 1}`, 0.005, 1, beamMat, 0.075, 0, z, 10);
    b.geometry.rotateZ(Math.PI / 2); // axis along y
    head.add(b);
    lasers.push({ mesh: b, mat: beamMat, x: 0.075, z });
  });
  bridge.add(head);
  gantry.add(bridge);
  root.add(gantry);

  /* ---------- LDR receiver array: BETWEEN the belt runs, looking up at the carcass ----------
     Overhead lasers strike the belt from above; light only reaches these cells through a
     hole or rip, so the array reads the BELT itself and never the ore riding on top. */
  const LDR_Y = YC + R - 0.19;
  const ldrRig = new THREE.Group();
  ldrRig.name = 'ldr_receiver_array';
  ldrRig.add(box('ldr_mount_rail', 3.5, 0.05, 0.09, M.steel, 0, LDR_Y - 0.07, 0));
  for (const sx of [1, -1]) {
    ldrRig.add(box(`ldr_rail_post_${sx > 0 ? 'a' : 'b'}`, 0.05, LDR_Y - 0.25, 0.05, M.steel, sx * 1.62, (LDR_Y - 0.09 + 0.16) / 2, 0));
  }
  const ldrLanes: Array<{ mesh: THREE.Mesh; z: number }> = [];
  [-0.16, 0, 0.16].forEach((z, i) => {
    ldrRig.add(box(`ldr_cell_housing_${i + 1}`, 3.34, 0.05, 0.11, M.amber, 0, LDR_Y, z));
    const cellLens = box(`ldr_cell_lens_${i + 1}`, 3.3, 0.014, 0.065, M.graphite, 0, LDR_Y + 0.031, z);
    ldrRig.add(cellLens);
    ldrLanes.push({ mesh: cellLens, z });
  });
  ldrRig.add(box('ldr_signal_cable', 0.014, 0.014, 0.62, M.graphite, 1.62, LDR_Y - 0.07, -0.3));
  root.add(ldrRig);

  /* ---------- belt holes / rips ----------
     A punched void with a frayed bright rim so it reads clearly against the
     dark carcass from any orbit angle. Activated by triggerRupture() on a live NORMAL→WARNING
     edge — this is the rig's stand-in for "a rupture just tripped the light sensor." */
  const holes: Array<{ group: THREE.Group; s: number; z: number; active: boolean }> = [];
  const voidMat = new THREE.MeshStandardMaterial({ name: 'belt_rip_void', color: 0x08090b, roughness: 1, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ name: 'belt_rip_rim', color: 0xd9d2c4, roughness: 0.8, emissive: 0x2a2213 });
  const HL = 0.42;
  const HW = 0.2; // hole footprint (m)
  for (let i = 0; i < HOLE_POOL; i++) {
    const g = new THREE.Group();
    g.name = `belt_rip_${i}`;
    g.add(box(`belt_rip_void_${i}`, HL, 0.012, HW, voidMat, 0, 0.016, 0));
    // rim frame: four bars around the void, standing just above the belt face
    g.add(box(`belt_rip_rim_${i}_a`, HL + 0.05, 0.022, 0.026, rimMat, 0, 0.026, HW / 2 + 0.013));
    g.add(box(`belt_rip_rim_${i}_b`, HL + 0.05, 0.022, 0.026, rimMat, 0, 0.026, -(HW / 2 + 0.013)));
    g.add(box(`belt_rip_rim_${i}_c`, 0.026, 0.022, HW, rimMat, HL / 2 + 0.013, 0.026, 0));
    g.add(box(`belt_rip_rim_${i}_d`, 0.026, 0.022, HW, rimMat, -(HL / 2 + 0.013), 0.026, 0));
    // torn flaps at each end, lifted off the carcass
    for (const sx of [1, -1]) {
      const f = box(`belt_rip_flap_${i}_${sx > 0 ? 'a' : 'b'}`, 0.1, 0.014, HW * 0.8, rimMat, sx * (HL / 2 + 0.055), 0.055, 0);
      f.rotation.z = sx * -0.5;
      g.add(f);
    }
    g.visible = false;
    belt.add(g);
    holes.push({ group: g, s: 0, z: 0, active: false });
  }

  stage.setObject(root);
  // closer default framing than the auto-fit (the rig is long and low)
  stage.camera.position.set(1.3, 2.9, 8.4);
  stage.controls.target.set(-0.25, 0.8, 0);
  stage.controls.update();

  /* ================= live-sensor-bound animation ================= */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {
    beltS: 0,
    speed: 0, // ramped belt speed — 0 when the live data says the rig is idle
    tripped: false,
    vibration: 0, // smoothed |vibration| — drives both jitter amplitude and the moving/idle read
    targetVibration: 0, // latest |live vibration| from Supabase
    ldr: 0,
    ripAt: null as number | null,
    ripUntil: 0,
    ldrLane: -1,
  };
  let prevStatus: LiveReading['status'] = null;

  function triggerRupture() {
    const h = holes.find((x) => !x.active) ?? holes[0];
    h.active = true;
    h.s = 0.35 - state.beltS; // enters the top run just past the tail pulley
    h.z = (Math.random() - 0.5) * 0.34;
    h.group.visible = true;
  }

  function setLive(r: LiveReading) {
    state.tripped = r.status === 'WARNING';
    state.targetVibration = r.vibration != null ? Math.abs(r.vibration) : 0;
    if (r.status === 'WARNING' && prevStatus !== 'WARNING') {
      triggerRupture(); // edge-triggered, mirrors the firmware's own `events` log
    }
    prevStatus = r.status;
  }

  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // Smoothed |vibration| first — both the belt's start/stop decision and the jitter amplitude
    // read off this, so it belongs ahead of everything it drives.
    state.vibration +=
      (state.targetVibration - state.vibration) * (1 - Math.exp(-dt / VIBRATION_SMOOTH_TAU));

    // The belt only runs when live data says the rig is actually moving (see MOTION_THRESHOLD);
    // otherwise it ramps down to a stop instead of animating on regardless of real state.
    const speedTarget = state.vibration > MOTION_THRESHOLD ? LIVE_BELT_SPEED : 0;
    state.speed += (speedTarget - state.speed) * (1 - Math.exp(-dt / SPEED_SMOOTH_TAU));
    if (state.speed < 0.004 && speedTarget === 0) state.speed = 0;
    state.beltS += state.speed * dt;

    // belt surface + rollers
    for (let i = 0; i < CLEATS; i++) {
      const p = loopPoint(state.beltS + (i * LOOP) / CLEATS);
      const c = cleats[i];
      c.position.set(p.x, p.y * 1.045, 0);
      c.rotation.z = p.a;
    }
    for (const s of spinners) s.mesh.rotation.z = -state.beltS / s.radius;

    // vibration jitter — ramps toward the live reading, never snaps
    if (!reduce) {
      const amp = Math.min(state.vibration * JITTER_GAIN, JITTER_MAX);
      const t = now / 1000;
      root.position.set(
        Math.sin(t * 37) * amp,
        Math.sin(t * 61) * amp * 0.5,
        Math.cos(t * 47) * amp * 0.4,
      );
    } else {
      root.position.set(0, 0, 0);
    }

    // Belt holes ride the loop; light reaches an LDR cell only through a hole in the carcass.
    let seen: number | null = null;
    let hitLane = -1;
    const gap = Math.max(0.02, head.position.y - BELT_TOP - 0.085);
    for (const h of holes) {
      if (!h.active) continue;
      const q = loopPoint(state.beltS + h.s);
      h.group.position.set(q.x * 1.01, q.y * 1.075, h.z);
      h.group.rotation.z = q.a;
      if (q.y > 0) {
        lasers.forEach((l, li) => {
          if (Math.abs(q.x - (bridge.position.x + l.x)) < 0.09 && Math.abs(h.z - l.z) < 0.1) {
            seen = q.x;
            hitLane = li;
          }
        });
      }
    }
    // a beam that found a hole carries on down to the receiver below the belt
    lasers.forEach((l, li) => {
      const len = li === hitLane ? head.position.y - 0.085 - LDR_Y : gap;
      l.mesh.scale.set(1, len, 1);
      l.mesh.position.y = -0.085 - len / 2;
    });
    if (seen !== null) {
      state.ldr = 1;
      state.ripAt = seen;
      state.ripUntil = now + 900;
      state.ldrLane = hitLane;
    } else {
      state.ldr = Math.max(0, state.ldr - dt / 0.5);
    }
    const lk = reduce ? (state.ldr > 0 ? 1 : 0) : state.ldr;
    for (const l of lasers) {
      l.mat.color.setRGB(0.84 + 0.16 * lk, 0.25 - 0.12 * lk, 0.17 - 0.1 * lk);
      l.mat.emissive.setRGB(0.3 + 0.6 * lk, 0.05, 0.03);
    }
    ldrLanes.forEach((lane, i) => {
      lane.mesh.material = lk > 0.05 && state.ldrLane === i ? M.laser : M.graphite;
    });

    // beacon — pulses while a live WARNING is active
    const alarm = state.tripped && !reduce ? 0.5 + 0.5 * Math.sin(now / 130) : 0;
    domeMat.color.setRGB(
      0.82 * (0.55 + alarm * 0.45),
      0.54 * (0.5 - alarm * 0.3) + alarm * 0.1,
      0.06,
    );
    domeMat.emissive.setRGB(state.tripped ? 0.45 * alarm : 0, 0, 0);

    onFrame?.();
  }

  stage.onFrame(tick);

  return {
    setLive,
    dispose() {
      stage.onFrame(null);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const m of Object.values(M)) m.dispose();
    },
  };
}
