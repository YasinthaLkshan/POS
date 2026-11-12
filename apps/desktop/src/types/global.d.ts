import type { DesktopBridge } from '@agripos/shared';
declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
