/** Portable Electron runs from a temporary extraction directory; startup must
 * point at its persistent launcher, otherwise the login item breaks on exit. */
export function loginTarget(packaged: boolean, executable: string, appPath: string, portableFile?: string): { path: string; args: string[] } {
  return { path: packaged && portableFile ? portableFile : executable, args: packaged ? [] : [appPath] };
}
