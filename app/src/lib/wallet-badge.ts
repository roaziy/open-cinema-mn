/**
 * Slot for Apple's official "Add to Apple Wallet" badge (Mongolian artwork).
 *
 * The artwork is licensed by Apple and is not in this repo yet. When it is supplied, put it
 * at app/assets/wallet/add-to-apple-wallet-mn.svg, make Metro treat `.svg` as an asset or
 * convert it to PNG, and replace `null` with `require('../../assets/wallet/add-to-apple-wallet-mn.png')`.
 * Until then the Wallet button is a plain styled text button. Do not draw the badge by hand.
 */
export const WALLET_BADGE_SOURCE: number | null = null;
