/**
 * Slot for an "Add to Apple Wallet" button image. Apple asks apps to use the system's own button
 * (PKAddPassButton, which needs a native module) rather than the badge artwork, which is meant for
 * websites and email. So the app shows a plain text button and this stays `null`. Never draw the
 * badge by hand.
 */
export const WALLET_BADGE_SOURCE: number | null = null;
