import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type WalletPassNative = {
  canAddPasses(): boolean;
  addPassFromUrl(url: string): Promise<void>;
};

/** iOS only: null elsewhere, and in a build made before this module existed. */
const native = requireOptionalNativeModule<WalletPassNative>('WalletPass');

export type AddPassButtonProps = {
  /** `black` on light backgrounds, `blackOutline` (default) on dark ones. */
  variant?: 'black' | 'blackOutline';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

/** True when this device can show Apple's Wallet button and add-pass sheet. */
export function canAddPasses(): boolean {
  return native?.canAddPasses() ?? false;
}

/** Downloads the .pkpass at `url` and shows Apple's add-to-Wallet sheet over the app. */
export function addPassFromUrl(url: string): Promise<void> {
  if (!native) return Promise.reject(new Error('Wallet is not available'));
  return native.addPassFromUrl(url);
}

type NativeProps = Omit<AddPassButtonProps, 'onPress'> & { onAddPass: () => void };
// Not `onPress`: React Native already registers a bubbling `press` event under that name.
const NativeButton = native ? requireNativeView<NativeProps>('WalletPass') : null;

/** Apple's own "Add to Apple Wallet" button (PKAddPassButton). Null where it is unavailable. */
export const AddPassButton: ComponentType<AddPassButtonProps> | null = NativeButton
  ? ({ onPress, ...rest }) => <NativeButton {...rest} onAddPass={onPress} />
  : null;
