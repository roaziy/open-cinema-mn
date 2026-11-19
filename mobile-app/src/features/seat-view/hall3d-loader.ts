/**
 * The 3D view's code (three.js and the hall) loads on first use. Starting it when the viewer picks
 * a seat, instead of on the "view from seat" tap, hides that load behind their next move.
 */
export const loadHall3D = () => import('./Hall3D');
