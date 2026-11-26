// While the explosion plays after logging in, the entry page must not redirect away yet.
let holding = false;
export const holdRedirect = value => { holding = value; };
export const isHoldingRedirect = () => holding;

// Opening an item from the guest page: where the guest page was scrolled to is saved on its history entry, so that coming back
// (the < arrow or the browser's back button) lands in the same place instead of at the logo.
const GUEST_PATHS = ['/', '/login', '/register'];
let guestSpot = false;
export function rememberGuestSpot() {
    guestSpot = GUEST_PATHS.includes(window.location.pathname);
    if (!guestSpot) return;
    const state = window.history.state ?? {};
    window.history.replaceState({ ...state, usr: { ...(state.usr ?? {}), guestY: window.scrollY } }, '');
}
export const cameFromGuestPage = () => guestSpot;
export const clearGuestSpot = () => { guestSpot = false; };
