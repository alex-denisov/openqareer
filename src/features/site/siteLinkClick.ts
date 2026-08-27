export interface ClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A left click with no modifier belongs to the app router; every other click
 * is the browser's own — a new tab, a new window, a download — and must reach
 * the `href` untouched.
 */
export function shouldHandleInApp(event: ClickLike): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  return true;
}
